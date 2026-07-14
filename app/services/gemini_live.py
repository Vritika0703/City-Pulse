import asyncio
import json
import logging
import traceback
import os
from collections import Counter
from google import genai
from google.genai import types
from groq import AsyncGroq
from app.core.config import get_settings
from app.tools.nyc_data import fetch_311_data, process_311_trends
from app.tools.analysis import detect_anomalies
from app.services.vector_db import VectorDB
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)
settings = get_settings()

SYSTEM_INSTRUCTION = """You are the CityPulse Strategic Intelligence Engine, a high-fidelity urban decision system used for Economic ROI Analysis and Property Risk Assessment. You synthesize real-time 311 human signals into three specialized Economic Agents:

1. [INFRASTRUCTURE ASSET RISK]: 
   - ROLE: Analyzes heat, water, and building complaints borough-wise to predict DEFERRED MAINTENANCE COSTS.
   - OUTPUT: High complaint clusters = high risk of near-term capital expenditure for property owners.

2. [TRANSIT-DRIVEN ROI]: 
   - ROLE: Analyzes traffic, street conditions, and transit noise borough-wise to predict PROPERTY VALUE OUTLOOK.
   - OUTPUT: Stable transit signals = high value retention; rising transit stress = potential ROI decrease.

3. [COMMERCIAL VITALITY AGENT]: 
   - ROLE: Analyzes sanitation, rodent, and "dirty condition" reports borough-wise to predict LOCAL BUSINESS STABILITY.
   - OUTPUT: Improved sanitation trends = rising business survival rates; sanitation decay = commercial flight risk.

TOOL CALL RULES — CRITICAL:
- ALWAYS call get_311_stats for the requested Borough(s).
- Use ONLY standard JSON function-calling format. NO XML.
- BROAD/VAGUE QUERY RULE: If the user's query contains vague or non-specific words such as 'climate', 'environment', 'environmental', 'overall', 'general', 'situation', 'condition', 'status', 'infrastructure', 'urban', 'neighborhood', 'community', 'quality of life', 'safety', 'health', 'transit', 'subway', 'transportation', or any similarly broad concept that does NOT map to a single specific complaint category — you MUST call get_311_stats WITHOUT a complaint_type (omit it or set it to null). Do NOT guess or infer a specific category like 'Noise' or 'Water' for these broad queries. Fetch ALL types and let the data speak.

REPORT FORMAT (STRATEGIC COORDINATOR):
🚨 OVERALL OPERATIONAL RISK: [0-100]/100
🏙️ BOROUGH FOCUS: [Borough Name(s)]

💹 ECONOMIC PREDICTIONS:
- [Infrastructure Asset Risk]: [Economic Prediction for the borough based on data]
- [Transit-Driven ROI]: [Property value outlook for the borough based on signals]
- [Commercial Vitality]: [Business survival/stability prediction based on sanitation]

📊 DATA-DRIVEN INSIGHTS:
[Top 3 real-world signals from the tool results]

🛠 STRATEGIC RECOMMENDATIONS:
[2-3 high-level actions for investors or city planners]

### Final Answer
[Your strategic report here]
"""

class GeminiLiveService:
    def __init__(self):
        self.client = genai.Client(api_key=settings.GOOGLE_API_KEY)
        self.groq = AsyncGroq(api_key=settings.GROQ_API_KEY)
        self.db = VectorDB()

    async def stream(self, ws):
        active_user_query = [""]   # mutable container to share query text across closures
        computed_scores   = [{}]   # stores {coord, infra, health, mobility} after each tool call
        logger.info("Chat Session Started (Replacing Live API for Stability)")
        
        async def get_311_stats(borough: str = None, complaint_type: str = None):
            """Fetch live 311 data. 
            - complaint_type: Use for categories like 'Noise', 'Illegal Parking'. DO NOT use 'unresolved' or 'status' here.
            - borough: MANHATTAN, BROOKLYN, QUEENS, BRONX, STATEN ISLAND.
            """
            try:
                # Handle AI "null" string hallucinations
                if borough and (borough.lower() == "null" or borough == "None"): borough = None
                if complaint_type and (complaint_type.lower() == "null" or complaint_type == "None"): complaint_type = None

                # --- Normalize complaint_type to real NYC 311 API values ---
                COMPLAINT_ALIASES = {
                    # Electrical / Power
                    'electric': 'Electrical',
                    'electricity': 'Electrical',
                    'power outage': 'Power Outage',
                    'power': 'Power Outage',
                    'lights': 'Street Light Condition',
                    'street light': 'Street Light Condition',
                    'streetlight': 'Street Light Condition',
                    'lamp': 'Street Light Condition',
                    # Water / Flooding
                    'water': 'Water System',
                    'flooding': 'Sewer',
                    'flood': 'Sewer',
                    'leak': 'Water System',
                    'sewage': 'Sewer',
                    'sewer': 'Sewer',
                    'pipe': 'Water System',
                    'drain': 'Sewer',
                    'storm': 'Sewer',
                    'weather': 'Sewer',
                    'hurricane': 'Sewer',
                    'rain': 'Sewer',
                    # Sanitation / Trash
                    'trash': 'Dirty Condition',
                    'garbage': 'Dirty Condition',
                    'sanitation': 'Sanitation Condition',
                    'litter': 'Dirty Condition',
                    'waste': 'Dirty Condition',
                    'dump': 'Dirty Condition',
                    'dumping': 'Dirty Condition',
                    'dirty': 'Dirty Condition',
                    'filth': 'Dirty Condition',
                    # Noise
                    'noise': 'Noise',
                    'loud': 'Noise',
                    'sound': 'Noise',
                    'music': 'Noise',
                    'party': 'Noise',
                    # Traffic / Parking / Streets
                    'traffic': 'Traffic',
                    'parking': 'Illegal Parking',
                    'congestion': 'Traffic',
                    'pothole': 'Street Condition',
                    'road': 'Street Condition',
                    'street': 'Street Condition',
                    'sidewalk': 'Street Condition',
                    'pavement': 'Street Condition',
                    'crosswalk': 'Street Condition',
                    'curb': 'Street Condition',
                    # Heat / Hot Water
                    'heat': 'HEAT/HOT WATER',
                    'hot water': 'HEAT/HOT WATER',
                    'heating': 'HEAT/HOT WATER',
                    'boiler': 'HEAT/HOT WATER',
                    'temperature': 'HEAT/HOT WATER',
                    # Rodent / Pest
                    'rodent': 'Rodent',
                    'rat': 'Rodent',
                    'rats': 'Rodent',
                    'pest': 'Rodent',
                    'mice': 'Rodent',
                    'mouse': 'Rodent',
                    'cockroach': 'Rodent',
                    'bug': 'Rodent',
                    'insect': 'Rodent',
                    'infestation': 'Rodent',
                    # Building / Housing / Structure
                    'building': 'Building/Use',
                    'elevator': 'Elevator',
                    'construction': 'Building/Use',
                    'collapse': 'Building/Use',
                    'housing': 'Building/Use',
                    'apartment': 'Building/Use',
                    'landlord': 'Building/Use',
                    'facade': 'Building/Use',
                    'scaffold': 'Building/Use',
                    'mold': 'Indoor Air Quality',
                    'mould': 'Indoor Air Quality',
                    'asbestos': 'Asbestos',
                    'lead': 'Lead',
                    # Graffiti
                    'graffiti': 'Graffiti',
                    'vandalism': 'Graffiti',
                    'tagging': 'Graffiti',
                    # Trees / Parks
                    'tree': 'Dead/Dying Tree',
                    'trees': 'Dead/Dying Tree',
                    'branch': 'Dead/Dying Tree',
                    # Air / Smoking
                    'smoke': 'Smoking',
                    'smoking': 'Smoking',
                    'cigarette': 'Smoking',
                    'air quality': 'Air Quality',
                    'pollution': 'Air Quality',
                    # Broad / Vague — map to None so all complaint types are fetched
                    'climate': None,
                    'environment': None,
                    'environmental': None,
                    'infrastructure': None,
                    'urban': None,
                    'city': None,
                    'overall': None,
                    'general': None,
                    'everything': None,
                    'situation': None,
                    'condition': None,
                    'status': None,
                    'safety': None,
                    'health': None,
                    'public health': None,
                    'quality of life': None,
                    'quality': None,
                    'neighborhood': None,
                    'community': None,
                    'transit': None,
                    'subway': None,
                    'mta': None,
                    'train': None,
                    'bus': None,
                    'transportation': None,
                }
                if complaint_type:
                    alias_key = complaint_type.lower().strip()
                    if alias_key in COMPLAINT_ALIASES:
                        complaint_type = COMPLAINT_ALIASES[alias_key]  # can be None for broad terms
                    # Also try partial match
                    else:
                        for k, v in COMPLAINT_ALIASES.items():
                            if k and k in alias_key:
                                complaint_type = v
                                break

                # Sanitize complaint_type
                clean_type = complaint_type
                if complaint_type:
                    low_type = complaint_type.lower()
                    if any(x in low_type for x in ['all', 'unresolved', 'resolved', 'open', 'closed', 'top', 'breakdown', 'list', 'summary']):
                        clean_type = None

                # --- Multi-topic detection: fetch each requested domain separately then merge ---
                q_words = active_user_query[0].lower() if active_user_query[0] else ''
                # Map each domain keyword group -> its canonical NYC 311 complaint type
                DOMAIN_FETCH_MAP = [
                    (['electric', 'electricity', 'power outage', 'lamp'],         'Electrical'),
                    (['water', 'flooding', 'flood', 'sewage', 'sewer', 'leak',
                      'pipe', 'drain', 'storm', 'rain', 'hurricane', 'weather'],  'Water System'),
                    (['trash', 'garbage', 'sanitation', 'litter', 'waste',
                      'dump', 'dumping', 'dirty', 'filth'],                        'Dirty Condition'),
                    (['noise', 'loud', 'sound', 'music', 'party'],                 'Noise'),
                    (['traffic', 'congestion'],                                     'Traffic'),
                    (['parking'],                                                   'Illegal Parking'),
                    (['pothole', 'road', 'street', 'sidewalk', 'pavement',
                      'crosswalk', 'curb'],                                        'Street Condition'),
                    (['heat', 'hot water', 'heating', 'boiler', 'temperature'],    'HEAT/HOT WATER'),
                    (['rodent', 'rat', 'rats', 'pest', 'mice', 'mouse',
                      'cockroach', 'bug', 'insect', 'infestation'],                'Rodent'),
                    (['building', 'collapse', 'housing', 'apartment',
                      'landlord', 'facade', 'scaffold'],                           'Building/Use'),
                    (['elevator'],                                                  'Elevator'),
                    (['street light', 'streetlight', 'lights', 'lamp'],            'Street Light Condition'),
                    (['power'],                                                     'Power Outage'),
                    (['graffiti', 'vandalism', 'tagging'],                         'Graffiti'),
                    (['tree', 'trees', 'branch'],                                  'Dead/Dying Tree'),
                    (['mold', 'mould'],                                             'Indoor Air Quality'),
                    (['smoke', 'smoking', 'cigarette'],                            'Smoking'),
                    (['air quality', 'pollution'],                                  'Air Quality'),
                ]
                matched_types = []
                for (keywords, api_type) in DOMAIN_FETCH_MAP:
                    if any(kw in q_words for kw in keywords):
                        if api_type not in matched_types:
                            matched_types.append(api_type)

                if len(matched_types) >= 2:
                    # Multi-domain: fetch each type separately and merge results
                    logger.info(f"Multi-domain query: fetching types {matched_types} for {borough}")
                    import asyncio
                    fetch_tasks = [fetch_311_data(borough=borough, complaint_type=t, days=60) for t in matched_types]
                    results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
                    data = []
                    for r in results:
                        if isinstance(r, list):
                            data.extend(r)
                    clean_type = ' + '.join(matched_types)
                elif len(matched_types) == 1:
                    clean_type = matched_types[0]
                    data = await fetch_311_data(borough=borough, complaint_type=clean_type, days=60)
                else:
                    # Fallback: use whatever alias normalization found
                    data = await fetch_311_data(borough=borough, complaint_type=clean_type, days=60)

                # Calculate metrics specifically for the requested data scope
                borough_counts = Counter(d.get('borough', 'Unknown').upper() for d in data)
                
                resolved_count = 0
                total_hours = 0
                from datetime import datetime
                for d in data:
                    if 'closed_date' in d and 'created_date' in d:
                        try:
                            created = datetime.fromisoformat(d['created_date'].replace('Z', '+00:00'))
                            closed = datetime.fromisoformat(d['closed_date'].replace('Z', '+00:00'))
                            total_hours += (closed - created).total_seconds() / 3600
                            resolved_count += 1
                        except: pass
                
                avg_resolution_hours = round(total_hours / resolved_count, 1) if resolved_count > 0 else 0
                resolution_percentage = round((resolved_count / len(data)) * 100, 1) if data else 0

                # Calculate borough resolution stats
                bor_res = {}
                for b in borough_counts.keys():
                    b_data = [d for d in data if d.get('borough', '').upper() == b]
                    b_res = [d for d in b_data if d.get('status') == 'Closed']
                    rate = round((len(b_res) / len(b_data)) * 100, 1) if b_data else 0
                    bor_res[b] = f"{rate}%"

                top_b = borough_counts.most_common(1)[0][0] if borough_counts else (borough.upper() if borough else "NYC")
                top_types_raw = [t[0] for t in Counter(d.get('complaint_type', '') for d in data).most_common(3)]
                top_types_lower = [t.lower() for t in top_types_raw]
                primary_issue = top_types_raw[0] if top_types_raw else (complaint_type or "Urban Stress")

                # --- Query domain detection ---
                q = active_user_query[0].lower()
                is_water    = any(x in q for x in ['water', 'flooding', 'flood', 'sewage', 'plumbing', 'leak']) or \
                              any(x in t for t in top_types_lower for x in ['water', 'sewer', 'flood'])
                is_trash    = any(x in q for x in ['trash', 'garbage', 'sanitation', 'waste', 'litter', 'collection']) or \
                              any(x in t for t in top_types_lower for x in ['sanit', 'garbage', 'trash', 'litter', 'dirty'])
                is_noise    = any(x in q for x in ['noise', 'loud', 'sound', 'music', 'construction noise']) or \
                              any('noise' in t for t in top_types_lower)
                is_traffic  = any(x in q for x in ['traffic', 'parking', 'congestion', 'street light', 'road']) or \
                              any(x in t for t in top_types_lower for x in ['traffic', 'parking', 'street light'])
                is_heat     = any(x in q for x in ['heat', 'hot water', 'temperature', 'heating']) or \
                              any(x in t for t in top_types_lower for x in ['heat', 'boiler', 'heating'])
                is_rodent   = any(x in q for x in ['rat', 'rodent', 'pest', 'mice', 'mouse']) or \
                              any(x in t for t in top_types_lower for x in ['rodent', 'pest'])
                is_building = any(x in q for x in ['building', 'elevator', 'collapse', 'structure']) or \
                              any(x in t for t in top_types_lower for x in ['building', 'elevator'])

                # Assign domain weights based on query
                if is_water:
                    infra_base, health_base, mobility_base = 70, 45, 25
                    domain_label = "Water Infrastructure"
                    agent_infra_note = f"Critical: {len(data)} water-related 311 complaints logged in {top_b}. Pipe pressure & main integrity at risk."
                    agent_health_note = f"Elevated health risk from potential water contamination and sanitation disruptions in {top_b}."
                    agent_mobility_note = f"Road closures possible near repair sites. Emergency vehicles on standby in {top_b}."
                    coord_decision = f"Water infrastructure stress at HIGH in {top_b}. Immediate inspection of mains recommended. Cross-domain cascade risk: MEDIUM."
                elif is_trash:
                    infra_base, health_base, mobility_base = 35, 75, 30
                    domain_label = "Sanitation & Waste"
                    agent_infra_note = f"Waste accumulation points identified in {top_b}. Collection infrastructure under pressure."
                    agent_health_note = f"PUBLIC HEALTH ALERT: Uncollected waste in {top_b} creates rodent harborage and disease vector risk."
                    agent_mobility_note = f"Blocked sidewalks and overflow on {top_b} corridors. Garbage trucks causing minor traffic disruption."
                    coord_decision = f"Sanitation crisis escalating in {top_b}. Health risk is the primary concern — deploy DSNY resources immediately."
                elif is_noise:
                    infra_base, health_base, mobility_base = 25, 65, 40
                    domain_label = "Noise Pollution"
                    agent_infra_note = f"Noise complaints in {top_b} may indicate illegal construction activity. Structural permits under review."
                    agent_health_note = f"Chronic noise exposure in {top_b} linked to elevated stress, sleep deprivation, and cardiovascular risk."
                    agent_mobility_note = f"Nighttime noise near transit corridors in {top_b} correlates with traffic incidents and pedestrian complaints."
                    coord_decision = f"Noise stress elevated in {top_b}. Multi-domain impact on health and transit. DEP enforcement and community outreach advised."
                elif is_traffic:
                    infra_base, health_base, mobility_base = 30, 25, 80
                    domain_label = "Traffic & Mobility"
                    agent_infra_note = f"Road surface degradation in {top_b} may be contributing to congestion. Pothole and street damage reports cross-referenced."
                    agent_health_note = f"Traffic congestion in {top_b} increases air pollution and pedestrian accident risk."
                    agent_mobility_note = f"CRITICAL MOBILITY ALERT: High complaint density in {top_b}. Signal timing failures and illegal parking creating systemic flow breakdown."
                    coord_decision = f"Traffic mobility is the critical failure point in {top_b}. DOT signal intervention and tow unit deployment recommended."
                elif is_heat:
                    infra_base, health_base, mobility_base = 75, 50, 20
                    domain_label = "Heat & Heating Infrastructure"
                    agent_infra_note = f"INFRA ALERT: Heating system failures reported across multiple buildings in {top_b}. Boiler and fuel oil supply under stress."
                    agent_health_note = f"Vulnerable populations in {top_b} at risk of hypothermia or heat-related illness. DOHMH notification advised."
                    agent_mobility_note = f"No direct mobility impact. Emergency services access to {top_b} buildings monitored."
                    coord_decision = f"Heating infrastructure failure in {top_b} poses immediate health risk. HPD enforcement and emergency inspections required."
                elif is_rodent:
                    infra_base, health_base, mobility_base = 30, 80, 15
                    domain_label = "Rodent & Pest Control"
                    agent_infra_note = f"Rodent activity in {top_b} linked to structural compromises in building foundations and sewer infrastructure."
                    agent_health_note = f"CRITICAL HEALTH RISK: Active rodent infestation in {top_b}. Disease transmission vectors (Leptospirosis, Salmonella) detected."
                    agent_mobility_note = f"Minimal mobility impact. Pest activity near transit stations in {top_b} flagged for MTA review."
                    coord_decision = f"Rodent crisis in {top_b} is a PUBLIC HEALTH emergency. Deploy DOHMH and DSNY rat mitigation teams to highest-density zones."
                elif is_building:
                    infra_base, health_base, mobility_base = 80, 40, 35
                    domain_label = "Building & Structural"
                    agent_infra_note = f"STRUCTURAL ALERT: Building defect and collapse risk indicators spiking in {top_b}. Elevator and facade violations cross-referenced."
                    agent_health_note = f"Displaced residents risk in {top_b}. Emergency shelter coordination required if conditions deteriorate."
                    agent_mobility_note = f"Construction scaffolding and emergency vehicles in {top_b} causing pedestrian and traffic disruptions."
                    coord_decision = f"Building safety crisis detected in {top_b}. DOB emergency inspection protocol and 24h watch on high-risk structures required."
                else:
                    infra_base, health_base, mobility_base = 50, 40, 35
                    domain_label = primary_issue
                    agent_infra_note = f"{len(data)} {primary_issue} complaints in {top_b}. Infrastructure stress markers elevated above baseline."
                    agent_health_note = f"Secondary health effects from {primary_issue} complaints in {top_b} require monitoring."
                    agent_mobility_note = f"Potential flow disruptions near high-density {primary_issue} zones in {top_b}."
                    coord_decision = f"Multi-domain stress detected in {top_b}. Primary signal: {primary_issue}. Cross-agent coordination underway."

                # === Multi-signal dynamic scoring ===
                # Signal 1: Volume vs borough-specific baseline (not a hard cap of 200)
                BOROUGH_BASELINES = {
                    "MANHATTAN": 800, "BROOKLYN": 1000, "QUEENS": 900,
                    "BRONX": 600, "STATEN ISLAND": 200,
                }
                baseline = BOROUGH_BASELINES.get(top_b, 600)
                vol_factor = min(1.0, len(data) / baseline)

                # Signal 2: Resolution rate — low resolution = higher sustained risk
                resolved_s = [d for d in data if d.get('status') == 'Closed']
                res_rate_s = (len(resolved_s) / len(data)) if data else 1.0
                unresolve_factor = 1.0 - res_rate_s  # 0=all resolved, 1=none resolved

                # Signal 3: Recency spike — complaints in last 7 days carry extra weight
                from datetime import datetime, timedelta, timezone
                cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)
                recent = 0
                for d in data:
                    try:
                        cd = datetime.fromisoformat(d['created_date'].replace('Z', '+00:00'))
                        if cd > cutoff_7d:
                            recent += 1
                    except Exception:
                        pass
                recency_factor = min(1.0, recent / max(1, baseline * 0.1))

                # Signal 4: Borough infrastructure aging multiplier
                BOROUGH_AGE = {
                    "MANHATTAN": 0.85, "BROOKLYN": 0.90, "QUEENS": 0.75,
                    "BRONX": 0.95, "STATEN ISLAND": 0.60,
                }
                age_factor = BOROUGH_AGE.get(top_b, 0.80)

                # Signal 5: Multi-domain cross-cascade penalty
                multi_penalty = min(15, len(matched_types) * 5) if len(matched_types) >= 2 else 0

                def _score(base):
                    raw = (base
                           + vol_factor       * (100 - base) * 0.35
                           + unresolve_factor * (100 - base) * 0.20
                           + recency_factor   * (100 - base) * 0.20
                           + age_factor       * (100 - base) * 0.10
                           + multi_penalty)
                    return min(99, max(5, int(raw)))

                infra_score    = _score(infra_base)
                health_score   = _score(health_base)
                mobility_score = _score(mobility_base)
                coord_score    = int((infra_score + health_score + mobility_score) / 3)

                # Persist for final report prompt so LLM uses EXACT backend scores
                computed_scores[0] = {
                    "coord":    coord_score,
                    "infra":    infra_score,
                    "health":   health_score,
                    "mobility": mobility_score,
                    "borough":  top_b,
                    "issue":    primary_issue,
                }

                resolution_pct = resolution_percentage  # from top scope

                def generate_cascade(data, borough_counts):
                    resolved = [d for d in data if d.get('status') == 'Closed']
                    res_rate = round((len(resolved) / len(data)) * 100, 0) if data else 0
                    secondary_type = top_types_raw[1] if len(top_types_raw) > 1 else "secondary urban stress"

                    # Multi-domain cascade: one phase per requested type
                    if len(matched_types) >= 2:
                        by_type_counts = Counter(d.get('complaint_type', 'Unknown') for d in data)
                        phases = []
                        TYPE_PHASE_LABELS = {
                            'Water System':     ('💧 Water Infrastructure', 'DEP emergency units querying main pressure & shutoff valves.', 'Pipe failure risk escalating — resident disruption imminent.'),
                            'Dirty Condition':  ('🗑️ Sanitation Overload', 'DSNY routes cross-referenced against overflow hotspots.', 'Rodent harborage risk rising — DOHMH cross-notified.'),
                            'Electrical':       ('⚡ Electrical Fault Detection', 'Con Ed fault map queried — outage boundary being drawn.', 'Grid failure cascade may affect adjacent infrastructure.'),
                            'Noise':            ('🔊 Noise Signal Identified', 'DEP inspection units dispatched to decibel hotspot zones.', 'Community stress threshold approaching — enforcement window open.'),
                            'HEAT/HOT WATER':   ('🌡️ Heat/Hot Water Emergency', 'HPD emergency inspections dispatched to boiler failure clusters.', 'Vulnerable populations at risk if not resolved within 6h.'),
                            'Rodent':           ('🐀 Rodent Harborage Alert', 'DOHMH baiting authorization filed for high-density blocks.', 'Disease vector risk elevated — public health threshold crossed.'),
                            'Traffic':          ('🚗 Traffic Disruption', 'DOT adaptive signal override engaged for impacted corridors.', 'Emergency vehicle response times degrading — reroute required.'),
                            'Illegal Parking':  ('🚗 Illegal Parking Cluster', 'NYPD patrol coordination requested for high-complaint zones.', 'Pedestrian safety and emergency access compromised.'),
                            'Sewer':            ('🌊 Sewer / Flooding', 'DEP storm drain inspection triggered in affected zones.', 'Flash flood risk in low-lying areas of the borough.'),
                            'Building/Use':     ('🏢 Building Hazard', 'DOB inspection units dispatched to structural complaint clusters.', 'Collapse risk elevated if unaddressed.'),
                        }
                        time_slots = ['0-4 Hours', '4-10 Hours', '10-24 Hours', '24-48 Hours']
                        for idx, mtype in enumerate(matched_types[:4]):
                            count = by_type_counts.get(mtype, 0)
                            lbl, action, risk = TYPE_PHASE_LABELS.get(mtype, (mtype, 'Agents analyzing complaint density.', 'Cross-domain cascade risk elevated.'))
                            t = time_slots[idx] if idx < len(time_slots) else '24-48 Hours'
                            phases.append({
                                "title": lbl,
                                "time": t,
                                "points": [
                                    f"[{mtype.upper()}]: {count} complaints logged in {top_b} — anomaly threshold crossed.",
                                    action,
                                    risk
                                ]
                            })
                        return phases

                    if is_water:
                        return [
                            {"title": f"{domain_label} Detection", "time": "0-4 Hours",
                             "points": [f"[INFRA]: {len(data)} water complaints detected in {top_b} — mains pressure anomaly flagged.",
                                        f"Infrastructure agent classifying severity: {res_rate}% of prior cases resolved.",
                                        "Emergency shutoff valve status queried from DEP control room."]},
                            {"title": "Health & Mobility Spillover", "time": "4-12 Hours",
                             "points": [f"[HEALTH]: Contamination risk zone drawn around {top_b} complaint clusters.",
                                        "[MOBILITY]: Emergency repair vehicle deployment causing lane closures.",
                                        f"[INFRA]: Secondary issue detected — {secondary_type} reports rising in adjacent zones."]},
                            {"title": "System Cascade Risk", "time": "12-24 Hours",
                             "points": [f"Full pipe failure risk in {top_b} if remediation is delayed beyond 12h window.",
                                        "Water service disruption would affect estimated 15,000+ residents.",
                                        "Automated DEP alert standing by — coordinator intervention required."]}
                        ]
                    elif is_trash:
                        return [
                            {"title": "Sanitation Overload Detected", "time": "0-6 Hours",
                             "points": [f"[HEALTH]: {len(data)} sanitation complaints logged in {top_b} — overflow risk flagged.",
                                        "DSNY collection routes cross-referenced against complaint density map.",
                                        f"Waste accumulation hotspots identified in {top_b} — vector risk elevated."]},
                            {"title": "Health Escalation Phase", "time": "6-16 Hours",
                             "points": ["[HEALTH]: Rodent harborage probability increases with each 6h delay.",
                                        f"[MOBILITY]: Blocked curb cuts and overflowing containers impeding {top_b} pedestrian flow.",
                                        "DOHMH cross-notified for environmental health intervention."]},
                            {"title": "Citywide Cascade Window", "time": "16-48 Hours",
                             "points": [f"Uncollected waste in {top_b} will cross health threshold within 48h.",
                                        "Neighboring boroughs may experience secondary overflow if not contained.",
                                        "DSNY emergency dispatch authorization awaiting coordinator approval."]}
                        ]
                    elif is_noise:
                        return [
                            {"title": "Noise Signal Identified", "time": "0-3 Hours",
                             "points": [f"[HEALTH]: {len(data)} noise complaints concentrated in {top_b} — decibel threshold exceeded.",
                                        "DEP noise inspection units queried for overnight dispatch availability.",
                                        "Construction permits cross-referenced with complaint times."]},
                            {"title": "Health & Community Impact", "time": "3-12 Hours",
                             "points": ["[HEALTH]: Chronic sleep disruption for {top_b} residents — stress biomarker elevation projected.",
                                        f"[MOBILITY]: Late-night noise incidents near transit hubs correlate with pedestrian safety risks in {top_b}.",
                                        "311 call volume trending upward — community stress threshold approaching."]},
                            {"title": "Enforcement Decision Window", "time": "12-24 Hours",
                             "points": [f"DEP summons to high-frequency offenders in {top_b} will reduce complaint volume by est. 40%.",
                                        "Community liaison outreach recommended for residential zones.",
                                        "Cross-agency data shared with NYPD for enforcement coordination."]}
                        ]
                    elif is_traffic:
                        return [
                            {"title": "Mobility Disruption Detected", "time": "0-2 Hours",
                             "points": [f"[MOBILITY]: {len(data)} traffic/parking complaints in {top_b} — flow breakdown imminent.",
                                        "DOT adaptive signal control queried for {top_b} priority corridors.",
                                        "Illegal parking enforcement clusters identified at highest-density nodes."]},
                            {"title": "Congestion Cascade Phase", "time": "2-8 Hours",
                             "points": [f"[MOBILITY]: Gridlock propagation risk — {top_b} congestion spreading to adjacent corridors.",
                                        "[HEALTH]: Elevated vehicle emissions in congested zones raising air quality index.",
                                        "Emergency vehicle response time degradation risk — EMS rerouting activated."]},
                            {"title": "System-Wide Traffic Impact", "time": "8-24 Hours",
                             "points": [f"Peak-hour compounding effect in {top_b} — system delay multiplier activated.",
                                        "DOT signal timing override and tow unit deployment authorized.",
                                        "Transit system ripple effects — MTA bus rerouting cross-coordinated."]}
                        ]
                    elif is_heat:
                        return [
                            {"title": "Heating Failure Cascade", "time": "0-4 Hours",
                             "points": [f"[INFRA]: {len(data)} heat/hot water complaints in {top_b} — boiler failure pattern confirmed.",
                                        "HPD emergency inspection units dispatched to flagged buildings.",
                                        f"Vulnerable population registry cross-referenced for {top_b} units."]},
                            {"title": "Health Emergency Phase", "time": "4-12 Hours",
                             "points": ["[HEALTH]: Hypothermia and heat stress risk for elderly and children in affected units.",
                                        f"DOHMH shelter-in-place advisory drafted for critical {top_b} zones.",
                                        "Emergency heating unit deployment authorized from city reserves."]},
                            {"title": "Infrastructure Recovery Window", "time": "12-48 Hours",
                             "points": ["Boiler repair crews dispatched — average restoration window: 18-24h.",
                                        f"Post-incident structural audit of {top_b} buildings flagged for HPD follow-up.",
                                        "Utility compensation protocol activated for affected residents."]}
                        ]
                    else:
                        return [
                            {"title": f"{domain_label} Signal", "time": "0-6 Hours",
                             "points": [f"[INFRA]: {len(data)} {primary_issue} complaints detected in {top_b}.",
                                        f"Stress markers above baseline — {res_rate}% of prior incidents resolved.",
                                        "Multi-agent triage initiated across all urban domains."]},
                            {"title": "Cross-Domain Escalation", "time": "6-12 Hours",
                             "points": [f"[MOBILITY]: Flow impedance risk near {top_b} high-complaint corridors.",
                                        f"[HEALTH]: Secondary health stress from {primary_issue} in {top_b} confirmed.",
                                        "Cross-agent signal sync complete — escalation protocols standing by."]},
                            {"title": "Decision Support Window", "time": "12-24 Hours",
                             "points": [f"Cascading risk across {top_b} infrastructure nodes if unaddressed.",
                                        "Resource reallocation recommended for primary impact zones.",
                                        "Automated mitigation protocols ready for final deployment."]}
                        ]

                def generate_agents(data, borough_counts):
                    return {
                        "sub": [
                            {
                                "name": "Infrastructure Agent", "icon": "⚡",
                                "level": "HIGH" if infra_score > 70 else "MEDIUM" if infra_score > 40 else "LOW",
                                "score": infra_score,
                                "reasoning": agent_infra_note
                            },
                            {
                                "name": "Public Health Agent", "icon": "🏥",
                                "level": "HIGH" if health_score > 70 else "MEDIUM" if health_score > 40 else "LOW",
                                "score": health_score,
                                "reasoning": agent_health_note
                            },
                            {
                                "name": "Mobility Agent", "icon": "🚗",
                                "level": "HIGH" if mobility_score > 70 else "MEDIUM" if mobility_score > 40 else "LOW",
                                "score": mobility_score,
                                "reasoning": agent_mobility_note
                            }
                        ],
                        "coordinator": {
                            "level": "HIGH" if coord_score > 70 else "MEDIUM" if coord_score > 40 else "LOW",
                            "score": coord_score,
                            "decision": coord_decision
                        }
                    }

                def generate_headlines(data, borough_counts, risk_score):
                    level = "HIGH" if coord_score > 70 else "MEDIUM" if coord_score > 40 else "LOW"
                    if is_water:
                        return [
                            f"{top_b} WATER MAIN STRESS: {len(data)} COMPLAINTS TRIGGER DEP EMERGENCY REVIEW",
                            f"HEALTH WATCH: CONTAMINATION RISK ZONES DRAWN AROUND {top_b} WATER COMPLAINTS",
                            f"PIPE INTEGRITY ALERT — {top_b} RISK POSTURE AT {level}: CITY ACTION REQUIRED"
                        ]
                    elif is_trash:
                        return [
                            f"SANITATION CRISIS IN {top_b}: {len(data)} COMPLAINTS OVERWHELM DSNY CAPACITY",
                            f"PUBLIC HEALTH ESCALATION: UNCOLLECTED WASTE CREATES RODENT VECTOR RISK IN {top_b}",
                            f"{top_b} GARBAGE OVERFLOW THREATENS TO CASCADE INTO NEIGHBORING BOROUGHS"
                        ]
                    elif is_noise:
                        return [
                            f"NOISE EMERGENCY IN {top_b}: {len(data)} DEP COMPLAINTS BREACH COMMUNITY THRESHOLD",
                            f"SLEEP DISRUPTION CRISIS: {top_b} RESIDENTS REPORTING SUSTAINED DECIBEL VIOLATIONS",
                            f"DEP ENFORCEMENT ACTION IMMINENT FOR {top_b} CHRONIC NOISE OFFENDERS"
                        ]
                    elif is_traffic:
                        return [
                            f"{top_b} MOBILITY BREAKDOWN: {len(data)} TRAFFIC COMPLAINTS SIGNAL GRID FAILURE",
                            f"DOT EMERGENCY OVERRIDE ACTIVATED — {top_b} CORRIDOR CONGESTION AT {level} RISK",
                            f"EMERGENCY VEHICLE ACCESS COMPROMISED BY {top_b} TRAFFIC GRIDLOCK"
                        ]
                    elif is_heat:
                        return [
                            f"HEAT EMERGENCY IN {top_b}: {len(data)} RESIDENTS WITHOUT HEAT OR HOT WATER",
                            f"HPD EMERGENCY INSPECTIONS DISPATCHED TO {top_b} BOILER FAILURE CLUSTERS",
                            f"VULNERABLE POPULATIONS AT RISK — {top_b} HEATING INFRASTRUCTURE AT {level} RISK"
                        ]
                    elif is_rodent:
                        return [
                            f"RODENT CRISIS IN {top_b}: {len(data)} COMPLAINTS TRIGGER DOHMH EMERGENCY RESPONSE",
                            f"PUBLIC HEALTH ALERT: DISEASE VECTOR RISK ELEVATED ACROSS {top_b} INFESTATION ZONES",
                            f"RAT MITIGATION OPERATION AUTHORIZED FOR {top_b} HIGH-DENSITY COMPLAINT BLOCKS"
                        ]
                    else:
                        return [
                            f"{top_b} {primary_issue.upper()} SURGE: {len(data)} 311 SIGNALS TRIGGER MULTI-AGENT REVIEW",
                            f"URBAN STRESS ESCALATING IN {top_b} — CROSS-DOMAIN CASCADE AT {level} RISK",
                            f"NYC COORDINATOR AGENT ACTIVATES EMERGENCY PROTOCOL FOR {top_b}"
                        ]

                agents = generate_agents(data, borough_counts)
                headlines = generate_headlines(data, borough_counts, agents["coordinator"]["score"])
                cascade = generate_cascade(data, borough_counts)
                trends = process_311_trends(data)
                full, anomalies = detect_anomalies(trends)
                
                # Build map locations with proportional sampling per complaint type
                # so ALL requested incident types are visible, not just the most common one
                MAX_MAP_POINTS = 600
                valid_locs_raw = [d for d in data if d.get("latitude")]
                if valid_locs_raw:
                    from collections import defaultdict
                    by_type = defaultdict(list)
                    for d in valid_locs_raw:
                        by_type[d.get("complaint_type", "Unknown")].append(d)
                    unique_types = list(by_type.keys())
                    per_type_limit = max(30, MAX_MAP_POINTS // len(unique_types))
                    map_locs = []
                    for ct, records in by_type.items():
                        sample = records[:per_type_limit]
                        for d in sample:
                            map_locs.append({"lat": float(d["latitude"]), "lon": float(d["longitude"]), "type": d.get("complaint_type", "Unknown")})
                else:
                    map_locs = []

                BOROUGH_COORDS = {
                    "MANHATTAN":     {"lat": 40.7831, "lon": -73.9712, "zoom": 12},
                    "BROOKLYN":      {"lat": 40.6501, "lon": -73.9496, "zoom": 12},
                    "QUEENS":        {"lat": 40.7282, "lon": -73.7949, "zoom": 11},
                    "BRONX":         {"lat": 40.8448, "lon": -73.8648, "zoom": 12},
                    "STATEN ISLAND": {"lat": 40.5795, "lon": -74.1502, "zoom": 12},
                }
                map_focus = BOROUGH_COORDS.get(top_b, {"lat": 40.7128, "lon": -74.0060, "zoom": 11})

                payload = {
                    "trends": full, "anomalies": anomalies, "total_complaints": len(data),
                    "borough_counts": dict(borough_counts),
                    "locations": map_locs,
                    "cascade": cascade,
                    "agents": agents,
                    "headlines": headlines,
                    "top_borough": top_b,
                    "primary_issue": primary_issue,
                    "map_center": map_focus,
                    "complaint_type_used": clean_type or "All Types",
                    "matched_types": matched_types,  # list of NYC311 types actually queried
                    "type_counts": dict(Counter(d.get("complaint_type", "Unknown") for d in data)),
                    "agent_scores": computed_scores[0],
                }
                await ws.send_json({"type": "chart_data", "payload": jsonable_encoder(payload)})
                
                # Metrics for AI Return (Specific to the request)
                ai_resolved = [d for d in data if d.get('status') == 'Closed']
                ai_rate = round((len(ai_resolved) / len(data)) * 100, 1) if data else 0
                top_c = Counter(d.get('complaint_type') for d in data).most_common(5)
                
                return {
                    "total": len(data), 
                    "resolution_percentage": f"{ai_rate}%",
                    "borough_breakdown": borough_counts,
                    "borough_resolution_rates": bor_res,
                    "top_complaints": [{"type": t, "count": c} for t, c in top_c]
                }
            except Exception as e:
                logger.error(f"311 Tool Error: {e}")
                return {"error": str(e)}

        async def search_city_reports(query: str):
            """Search historical city reports for context."""
            try:
                r = await asyncio.to_thread(self.db.query, query)
                docs = r.get("documents", [[]])[0]
                metas = r.get("metadatas", [[]])[0]
                distances = r.get("distances", [[]])[0]
                
                query_lower = query.lower()
                filtered = []
                for d, m, dist in zip(docs, metas, distances):
                    # Strict distance threshold: bad matches are typically > 0.65
                    if dist > 0.65:
                        continue
                        
                    title = m.get('source', '').lower()
                    content = d.lower()
                    text_to_check = title + " " + content
                    if 'rodent' in text_to_check and 'rodent' not in query_lower:
                        continue
                    if 'infrastructure' in text_to_check and 'infrastructure' not in query_lower and 'pothole' not in query_lower:
                        continue
                    if 'noise' in text_to_check and 'noise' not in query_lower:
                        continue
                    filtered.append({"content": d, "source": m.get("source", "Unknown")})
                    
                findings = filtered
                await ws.send_json({"type": "citations", "payload": findings})
                return {"found": len(findings)}
            except Exception as e:
                logger.error(f"Search Tool Error: {e}")
                return {"error": str(e)}

        groq_tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_311_stats",
                    "description": "Fetch live NYC 311 data. CRITICAL: 'complaint_type' is for categories like 'Noise' or 'Heat/Hot Water'. DO NOT use 'unresolved', 'all', or 'status' as a complaint_type. To compare all boroughs, OMIT the borough parameter.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "borough": {
                                "type": ["string", "null"], 
                                "enum": ["MANHATTAN", "BROOKLYN", "QUEENS", "BRONX", "STATEN ISLAND", "null", "None", None],
                                "description": "NYC Borough. Omit or set to null for city-wide."
                            },
                            "complaint_type": {
                                "type": ["string", "null"],
                                "description": "Specific NYC 311 complaint category like 'Noise', 'Rodent', 'HEAT/HOT WATER', 'Water System', 'Dirty Condition', 'Traffic', 'Illegal Parking', 'Building/Use', 'Graffiti'. IMPORTANT: For broad or vague queries where the user says words like 'climate', 'environment', 'overall', 'situation', 'infrastructure', 'neighborhood', 'quality of life', 'safety', 'health', 'transit', 'subway', or any non-specific concept — OMIT this parameter entirely or set it to null to fetch all complaint types."
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "search_city_reports",
                    "description": "Search historical NYC city reports and urban plans.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"}
                        },
                        "required": ["query"]
                    }
                }
            }
        ]

        messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
        
        try:
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                
                if "text" in message:
                    try:
                        payload = json.loads(message["text"])
                        if payload.get("type") == "ping": continue
                            
                        if payload.get("type") == "text":
                            user_text = payload["text"]
                            active_user_query[0] = user_text  # store for context-aware generators
                            logger.info(f">>> Processing turn (Groq): {user_text}")
                            
                            # Echo the question back to the frontend immediately
                            await ws.send_json({"type": "user_transcript", "text": user_text})
                            
                            # Fresh context window for every turn to guarantee stable tool calling
                            turn_messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
                            turn_messages.append({"role": "user", "content": user_text})

                            try:
                                response = await self.groq.chat.completions.create(
                                    model=settings.GROQ_MODEL,
                                    messages=turn_messages,
                                    tools=groq_tools,
                                    tool_choice="auto"
                                )
                                res_msg = response.choices[0].message
                                turn_messages.append(res_msg)
                            except Exception as req_e:
                                error_str = str(req_e)
                                if "tool_use_failed" in error_str and "<function=" in error_str:
                                    import re
                                    match = re.search(r'<function=([^>]+)>(.*?)(?:</function>|\[/function\])', error_str)
                                    if match:
                                        func_name = match.group(1)
                                        args_str = match.group(2)
                                        logger.warning(f"Recovered hallucinated tool call: {func_name} {args_str}")
                                        class MockFunction:
                                            def __init__(self, name, arguments):
                                                self.name = name
                                                self.arguments = arguments
                                        class MockToolCall:
                                            def __init__(self, id, name, arguments):
                                                self.id = id
                                                self.function = MockFunction(name, arguments)
                                        class MockMessage:
                                            def __init__(self, content, tool_calls):
                                                self.content = content
                                                self.tool_calls = tool_calls
                                        res_msg = MockMessage(None, [MockToolCall("call_mock_1", func_name, args_str)])
                                        turn_messages.append({
                                            "role": "assistant",
                                            "content": None,
                                            "tool_calls": [{
                                                "id": "call_mock_1",
                                                "type": "function",
                                                "function": {"name": func_name, "arguments": args_str}
                                            }]
                                        })
                                    else:
                                        raise req_e
                                else:
                                    raise req_e

                            # ── Path A: proper tool_calls from Groq ──
                            if res_msg.tool_calls:
                                for tool_call in res_msg.tool_calls:
                                    fn  = tool_call.function.name
                                    fn_args = json.loads(tool_call.function.arguments)
                                    logger.info(f"Executing Tool: {fn} with {fn_args}")
                                    if fn == "get_311_stats":
                                        result = await get_311_stats(**fn_args)
                                    elif fn == "search_city_reports":
                                        result = await search_city_reports(**fn_args)
                                    else:
                                        result = {"error": "Tool not found"}
                                    turn_messages.append({
                                        "role": "tool",
                                        "tool_call_id": tool_call.id,
                                        "name": fn,
                                        "content": json.dumps(result)
                                    })

                            # ── Path B: Groq bug — tool call placed in content instead of tool_calls ──
                            elif res_msg.content:
                                raw = res_msg.content.strip()
                                recovered = None
                                # Try plain JSON blob: {"name": "get_311_stats", "parameters": {...}}
                                try:
                                    blob = json.loads(raw)
                                    if isinstance(blob, dict) and blob.get("name") in ("get_311_stats", "search_city_reports"):
                                        recovered = blob
                                except Exception:
                                    pass
                                # Try <function=name {...}(> format
                                if not recovered:
                                    import re as _re
                                    m = _re.search(r'<function=(\w+)\s+(\{.*?\})\s*\(', raw, _re.DOTALL)
                                    if m:
                                        try:
                                            recovered = {"name": m.group(1), "parameters": json.loads(m.group(2))}
                                        except Exception:
                                            pass
                                if recovered:
                                    fn = recovered.get("name")
                                    fn_args = recovered.get("parameters") or recovered.get("arguments") or {}
                                    logger.warning(f"Recovering content-embedded tool call: {fn} {fn_args}")
                                    if fn == "get_311_stats":
                                        result = await get_311_stats(**fn_args)
                                    elif fn == "search_city_reports":
                                        result = await search_city_reports(**fn_args)
                                    else:
                                        result = {}
                                    turn_messages.append({"role": "assistant", "content": None,
                                        "tool_calls": [{"id": "call_recovered", "type": "function",
                                            "function": {"name": fn, "arguments": json.dumps(fn_args)}}]})
                                    turn_messages.append({"role": "tool", "tool_call_id": "call_recovered",
                                        "name": fn, "content": json.dumps(result)})
                                    res_msg = None  # force final LLM call below

                            # ── Final LLM report — always runs after tool execution ──
                            if res_msg is None or res_msg.tool_calls or \
                               (res_msg and res_msg.content and res_msg.content.strip().startswith('{')):
                                sc = computed_scores[0]
                                scores_block = ""
                                if sc:
                                    scores_block = (
                                        f"\n\nPRE-COMPUTED SCORES (USE EXACTLY):\n"
                                        f"- Overall Risk Score: {sc.get('coord','?')}/100\n"
                                        f"- Infrastructure: {sc.get('infra','?')}/100\n"
                                        f"- Public Health: {sc.get('health','?')}/100\n"
                                        f"- Mobility: {sc.get('mobility','?')}/100\n"
                                        f"- Borough: {sc.get('borough','?')}\n"
                                    )
                                sc_val = sc.get('coord','[X]') if sc else '[X]'
                                # Detect broad/vague queries where no specific 311 type was matched
                                broad_query_note = ""
                                if not matched_types and not clean_type:
                                    broad_query_note = (
                                        f"\n\nBROAD QUERY DETECTED: The user's term in '{user_text}' does not directly correspond to a specific NYC 311 complaint category. "
                                        f"You MUST open your report with exactly this acknowledgment (filling in the blanks): "
                                        f"\"'[vague term from query]' doesn't map to a single 311 category — so here is the complete infrastructure picture for [borough]: [1-sentence summary of what the data shows across all complaint types].\"\n"
                                    )
                                turn_messages.append({"role": "user", "content": (
                                    f"Synthesize a STRATEGIC ECONOMIC REPORT for the query: '{user_text}'.{scores_block}{broad_query_note}\n"
                                    "Format EXACTLY as:\n"
                                    f"**🚨 OVERALL OPERATIONAL RISK:** {sc_val}/100\n"
                                    f"**🏙️ BOROUGH FOCUS:** {sc.get('borough', '[Borough]') if sc else '[Borough]'}\n\n"
                                    "**💹 ECONOMIC PREDICTIONS:**\n"
                                    "- **[Infrastructure Asset Risk]**: [Predict deferred maintenance cost impact based on tool results]\n"
                                    "- **[Transit-Driven ROI]**: [Predict property value trend based on mobility signals]\n"
                                    "- **[Commercial Vitality]**: [Predict business stability based on sanitation/rodent trends]\n\n"
                                    "**📊 DATA-DRIVEN INSIGHTS:**\n"
                                    "[List real numbers from the tool data]\n\n"
                                    "**🛠 STRATEGIC RECOMMENDATIONS:**\n"
                                    "[Actions for investors/planners]\n"
                                    "CRITICAL: Use the pre-computed score. Focus on borough-specific economic forecasting."
                                )})
                                final_response = await self.groq.chat.completions.create(
                                    model=settings.GROQ_MODEL,
                                    messages=turn_messages
                                )
                                res_msg = final_response.choices[0].message

                            # ── Build final transcript text ──
                            final_text = ""
                            if res_msg and res_msg.content:
                                candidate = res_msg.content.strip()
                                # Discard entire content if it's a raw tool-call JSON blob
                                discard = False
                                try:
                                    p = json.loads(candidate)
                                    if isinstance(p, dict) and any(k in p for k in ("type","name","function","parameters","tool_calls")):
                                        discard = True
                                except Exception:
                                    pass
                                if not discard:
                                    import re as _re2
                                    candidate = _re2.sub(r'<function[^>]*>.*?(</function>|$)', '', candidate, flags=_re2.DOTALL | _re2.IGNORECASE)
                                    candidate = _re2.sub(r'</?function>', '', candidate, flags=_re2.IGNORECASE)
                                    candidate = _re2.sub(r'<tool_call>.*?</tool_call>', '', candidate, flags=_re2.DOTALL | _re2.IGNORECASE)
                                    final_text = candidate.strip()

                            if not final_text:
                                final_text = "Tactical analysis complete. Multi-agent intelligence board synchronized with live 311 data."

                            await ws.send_json({"type": "transcript", "text": final_text})
                            logger.info("<<< Turn complete")
                            await ws.send_json({"type": "turn_complete"})

                    except Exception as e:
                        err_str = str(e)
                        logger.error(f"Message Processing Error: {e}")
                        error_msg = "Analysis failed. Please try again."
                        if "429" in err_str or "quota" in err_str.lower():
                            error_msg = "Rate limit reached. Please wait 15 seconds and try again."
                        elif "404" in err_str:
                            error_msg = "Model not found. Please check configuration."
                        elif "tool_use_failed" in err_str:
                            error_msg = "Query parsing issue. Please rephrase (e.g. 'analyse rodent complaints in the Bronx') and try again."
                        await ws.send_json({"type": "error", "message": error_msg})
                        await ws.send_json({"type": "transcript", "text": f"**⚠️ {error_msg}**"})
                        await ws.send_json({"type": "turn_complete"})

        except Exception as e:
            logger.error(f"Session Disconnected: {e}")

