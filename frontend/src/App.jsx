import React, { useState, useRef, useEffect, Component, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Mic, MicOff, Activity, AlertCircle, BookOpen, MessageSquare, Send, Wifi, WifiOff, Loader, Trash2, Map, FileText, ChevronDown, RefreshCw, Layers, Brain, Cpu, ShieldAlert, Zap, Globe, Wrench } from 'lucide-react';
import { useGeminiLive } from './hooks/useGeminiLive';
import MapChart from './components/MapChart';
import './App.css';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-[#080810] flex flex-col items-center justify-center text-white p-8 text-center">
          <RefreshCw size={48} className="text-blue-500 mb-4 animate-spin-slow" />
          <h1 className="text-2xl font-bold mb-2">Command Center Interrupted</h1>
          <p className="text-gray-400 mb-6">A tactical rendering error occurred. Attempting to restore operational status.</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-blue-600 rounded-xl hover:bg-blue-500 font-bold uppercase tracking-widest text-[10px]">Re-establish Uplink</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function CityPulseApp() {
  const { status, transcripts, userTranscripts, charts, isRecording, isProcessing, sendText, startRecording, stopRecording, clearHistory } = useGeminiLive();
  const scrollRef = useRef(null);
  const [activeIntervention, setActiveIntervention] = useState(null);

  const [loadingStep, setLoadingStep] = useState(0);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcripts, userTranscripts]);

  // Handle synchronization of new queries
  useEffect(() => {
    if (isProcessing) {
      setActiveIntervention(null);
      setLoadingStep(0);
      const interval = setInterval(() => {
        setLoadingStep(prev => (prev < 2 ? prev + 1 : prev));
      }, 1200);
      return () => clearInterval(interval);
    }
  }, [isProcessing]);

  const loadingMessages = [
    "Analyzing urban signals...",
    "Running multi-agent simulation...",
    "Synthesizing final predictions..."
  ];
  const activeLoadingMessage = loadingMessages[loadingStep];

  const handleIntervention = (actionName) => {
    setActiveIntervention(prev => prev === actionName ? null : actionName);
  };

  const topBorough = charts?.top_borough ? charts.top_borough.toUpperCase() : 'NYC';
  const primaryIssue = charts?.primary_issue ? charts.primary_issue.toUpperCase() : 'URBAN STRESS';
  const primaryIssueRaw = charts?.primary_issue || 'urban stress';

  // Per-domain action templates for each intervention type
  const DOMAIN_INTERVENTION_TEMPLATES = {
    "Water System": {
      "Deploy Repair Teams": { label: "💧 Water Main Repair", action: `DEP emergency crews deployed to water main failure points in ${topBorough}.`, risk: `Pipe rupture containment active — resident disruption minimized.` },
      "Issue Health Advisory": { label: "💧 Water Contamination Advisory", action: `DOHMH boil-water advisory issued for ${topBorough} affected zones.`, risk: `Vulnerable populations notified — bottled water distribution initiated.` },
      "Optimize Traffic Flow": { label: "💧 Water Repair Corridor Clearance", action: `DOT rerouting traffic away from ${topBorough} water main repair zones.`, risk: `Emergency DEP vehicle access maintained — lane closures minimized.` },
      "Increase Monitoring": { label: "💧 Water System Sensor Grid", action: `DEP pressure sensors in ${topBorough} operating at 400% data ingest rate.`, risk: `Pipe integrity anomalies flagged in real-time — early warning active.` },
    },
    "Dirty Condition": {
      "Deploy Repair Teams": { label: "🗑️ Sanitation Emergency Crews", action: `DSNY emergency collection deployed to ${topBorough} overflow hotspots.`, risk: `Rodent harborage risk dropping as waste accumulation cleared.` },
      "Issue Health Advisory": { label: "🗑️ Sanitation Health Advisory", action: `DOHMH advisory for ${topBorough} residents near waste overflow zones.`, risk: `Disease vector risk contained — DOHMH environmental health units on-site.` },
      "Optimize Traffic Flow": { label: "🗑️ Waste Truck Route Optimization", action: `DSNY collection routes rerouted for maximum ${topBorough} coverage.`, risk: `Blocked sidewalks and curb cuts cleared — pedestrian flow restored.` },
      "Increase Monitoring": { label: "🗑️ Sanitation Sensor Monitoring", action: `IoT sensors in ${topBorough} tracking waste accumulation density in real-time.`, risk: `Overflow thresholds monitored — DSNY dispatch auto-triggered on breach.` },
    },
    "Electrical": {
      "Deploy Repair Teams": { label: "⚡ Electrical Repair Units", action: `Con Ed emergency crews deployed to ${topBorough} electrical fault clusters.`, risk: `Grid failure cascade contained — outage boundary stabilized.` },
      "Issue Health Advisory": { label: "⚡ Power Safety Advisory", action: `DOHMH + Con Ed advisory for ${topBorough} residents near outage zones.`, risk: `Medical equipment users prioritized — backup power coordination active.` },
      "Optimize Traffic Flow": { label: "⚡ Traffic Signal Recovery", action: `DOT emergency override restoring signal timing near ${topBorough} outage zones.`, risk: `Intersection safety maintained — manual traffic control deployed.` },
      "Increase Monitoring": { label: "⚡ Grid Fault Detection Grid", action: `Con Ed smart meters in ${topBorough} flagging anomalies at 5-minute intervals.`, risk: `Outage prediction window: 4h — pre-emptive crew staging active.` },
    },
    "Noise": {
      "Deploy Repair Teams": { label: "🔊 Noise Source Inspection", action: `DEP inspectors deployed to ${topBorough} chronic noise complaint clusters.`, risk: `Construction permit violations identified — stop-work orders pending.` },
      "Issue Health Advisory": { label: "🔊 Noise Health Advisory", action: `DOHMH advisory on chronic noise health impacts issued for ${topBorough}.`, risk: `Community stress mitigation resources deployed — sleep health guidance distributed.` },
      "Optimize Traffic Flow": { label: "🔊 Transit Noise Mitigation", action: `MTA + DOT noise barriers assessed near ${topBorough} transit corridors.`, risk: `Late-night vehicle noise near transit hubs reduced through speed enforcement.` },
      "Increase Monitoring": { label: "🔊 Noise Level Monitoring", action: `DEP decibel sensors in ${topBorough} logging ambient levels at 15-min intervals.`, risk: `Threshold breaches auto-escalated to enforcement — nighttime window flagged.` },
    },
    "HEAT/HOT WATER": {
      "Deploy Repair Teams": { label: "🌡️ Boiler Repair Teams", action: `HPD repair crews deployed to ${topBorough} heating system failure complaints.`, risk: `Vulnerable resident exposure minimized — emergency heat provided.` },
      "Issue Health Advisory": { label: "🌡️ Heat Emergency Advisory", action: `DOHMH cold-weather advisory for ${topBorough} residents without heat.`, risk: `Hypothermia risk monitoring active — warming centers opened.` },
      "Optimize Traffic Flow": { label: "🌡️ Emergency Access Routing", action: `DOT clearing routes to ${topBorough} buildings with heating emergencies.`, risk: `HPD + FDNY access maintained for all high-priority building violations.` },
      "Increase Monitoring": { label: "🌡️ Heat System Monitoring", action: `HPD sensors tracking boiler status in ${topBorough} high-complaint buildings.`, risk: `24h early-warning window for heating failures — pre-emptive dispatch ready.` },
    },
    "Rodent": {
      "Deploy Repair Teams": { label: "🐀 Rat Mitigation Crews", action: `DOHMH baiting teams deployed to ${topBorough} high-density infestation zones.`, risk: `Disease vector risk declining — harborage sites being sealed.` },
      "Issue Health Advisory": { label: "🐀 Rodent Health Advisory", action: `DOHMH public advisory for ${topBorough} residents near infestation clusters.`, risk: `Leptospirosis + Salmonella transmission risk contained through public guidance.` },
      "Optimize Traffic Flow": { label: "🐀 Sanitation Route Optimization", action: `DSNY waste removal optimized to eliminate rodent food sources in ${topBorough}.`, risk: `Harborage site reduction correlated with transit station safety improvement.` },
      "Increase Monitoring": { label: "🐀 Rodent Activity Sensors", action: `DOHMH trap sensors in ${topBorough} tracking activity at 24h intervals.`, risk: `Population surge prediction: 72h — pre-emptive baiting authorization active.` },
    },
    "Traffic": {
      "Deploy Repair Teams": { label: "🚗 Road Repair Units", action: `DOT pothole and signal repair crews deployed to ${topBorough} congestion nodes.`, risk: `Infrastructure-caused congestion being eliminated at source.` },
      "Issue Health Advisory": { label: "🚗 Air Quality Advisory", action: `DOHMH air quality advisory for ${topBorough} high-congestion zones.`, risk: `Pediatric and respiratory health guidance distributed to ${topBorough} residents.` },
      "Optimize Traffic Flow": { label: "🚗 Signal Grid Override", action: `DOT algorithmic rerouting active across all ${topBorough} major corridors.`, risk: `Emergency vehicle response times recovering — gridlock cascade interrupted.` },
      "Increase Monitoring": { label: "🚗 Traffic Flow Sensors", action: `DOT loop sensors in ${topBorough} logging vehicle counts every 90 seconds.`, risk: `Incident detection window: 3 minutes — adaptive signal response active.` },
    },
    "Illegal Parking": {
      "Deploy Repair Teams": { label: "🚗 Tow Unit Deployment", action: `NYPD tow units clearing illegal parking clusters in ${topBorough}.`, risk: `Emergency lane access restored — pedestrian safety improved.` },
      "Issue Health Advisory": { label: "🚗 Pedestrian Safety Advisory", action: `NYPD + DOT advisory for ${topBorough} pedestrian-impacted zones.`, risk: `Sidewalk obstruction complaints being cleared — accessibility restored.` },
      "Optimize Traffic Flow": { label: "🚗 Parking Enforcement Routing", action: `NYPD enforcement units rerouted for maximum ${topBorough} coverage.`, risk: `Double-parking violations eliminated from ${topBorough} transit corridors.` },
      "Increase Monitoring": { label: "🚗 Parking Violation Monitoring", action: `Camera sensors in ${topBorough} tracking illegal parking in real-time.`, risk: `Automated violation detection — enforcement dispatch within 10-minute window.` },
    },
  };

  const buildIntervention = (name) => {
    const b = topBorough, i = primaryIssue, ir = primaryIssueRaw;
    // Get active domain types from backend; fallback to single primary issue
    const activeTypes = charts?.matched_types?.length ? charts.matched_types : [charts?.complaint_type_used || ir];
    const typeCounts = charts?.type_counts || {};
    const isMulti = activeTypes.length >= 2;

    const cfgMap = {
      "Deploy Repair Teams": { riskReduction: 35, infraReduction: 45, healthReduction: 10, mobilityReduction: 15, icon: "👷" },
      "Issue Health Advisory": { riskReduction: 25, infraReduction: 5, healthReduction: 40, mobilityReduction: 10, icon: "⚕️" },
      "Optimize Traffic Flow": { riskReduction: 20, infraReduction: 5, healthReduction: 5, mobilityReduction: 50, icon: "🚦" },
      "Increase Monitoring": { riskReduction: 15, infraReduction: 15, healthReduction: 15, mobilityReduction: 15, icon: "🛰️" },
    };
    const cfg = cfgMap[name];

    // Time slots per phase
    const timeSlots = ["0-2 Hours", "2-6 Hours", "6-12 Hours", "12-24 Hours", "0-3 Hours", "3-8 Hours", "8-24 Hours", "0-4 Hours", "4-12 Hours", "12-48 Hours"];
    const timeMaps = {
      "Deploy Repair Teams": ["0-2 Hours", "2-8 Hours", "8-24 Hours", "24-48 Hours"],
      "Issue Health Advisory": ["0-4 Hours", "4-12 Hours", "12-48 Hours", "48-72 Hours"],
      "Optimize Traffic Flow": ["0-2 Hours", "2-6 Hours", "6-12 Hours", "12-24 Hours"],
      "Increase Monitoring": ["0-3 Hours", "3-8 Hours", "8-24 Hours", "24-48 Hours"],
    };

    // Build cascade: one phase per active domain
    let cascade;
    if (isMulti) {
      cascade = activeTypes.slice(0, 4).map((type, idx) => {
        const tmpl = DOMAIN_INTERVENTION_TEMPLATES[type]?.[name];
        const count = typeCounts[type] || '?';
        const t = (timeMaps[name] || timeSlots)[idx];
        if (tmpl) {
          return {
            title: tmpl.label, time: t, points: [
              `[${type.toUpperCase()}]: ${count} complaints in ${b} — intervention threshold crossed.`,
              tmpl.action,
              tmpl.risk,
            ]
          };
        }
        return {
          title: `${type} — ${name}`, time: t, points: [
            `${count} ${type} complaints active in ${b}.`,
            `${name} protocol initiated for ${type} in ${b}.`,
            `Cross-agent coordination underway — cascade risk monitored.`,
          ]
        };
      });
      // Add a cross-domain synthesis phase
      cascade.push({
        title: "🔗 Cross-Domain Synthesis", time: "Ongoing", points: [
          `${name} protocols simultaneously active across ${activeTypes.length} domains in ${b}.`,
          `Coordinator agent monitoring cascade interactions between ${activeTypes.join(' + ')}.`,
          `Multi-agent confidence score updated every 15 minutes with live 311 feeds.`,
        ]
      });
    } else {
      // Single domain — use rich single-type cascade
      const singleType = activeTypes[0];
      const tmpl = DOMAIN_INTERVENTION_TEMPLATES[singleType]?.[name];
      const times = timeMaps[name] || ["0-3 Hours", "3-8 Hours", "8-24 Hours"];
      if (tmpl) {
        cascade = [
          {
            title: tmpl.label, time: times[0], points: [
              `${typeCounts[singleType] || ''} ${singleType} complaints in ${b} — ${name} protocol activated.`,
              tmpl.action,
              tmpl.risk,
            ]
          },
          {
            title: `${b} ${i} Stabilization`, time: times[1], points: [
              `Secondary ${ir} stress points in ${b} being addressed.`,
              `Cross-domain agents re-calibrating with live ${ir} feeds.`,
              `Intervention effectiveness tracking at 15-minute intervals.`,
            ]
          },
          {
            title: `Recovery & Normalization`, time: times[2], points: [
              `${b} ${ir} risk returning toward baseline.`,
              `Coordinator projecting full recovery within 24h window.`,
              `Post-intervention monitoring protocols remaining active.`,
            ]
          },
        ];
      } else {
        cascade = [
          { title: `${i} ${name} — Phase 1`, time: times[0], points: [`${name} initiated for ${ir} in ${b}.`, `Agent coordination active.`, `Risk reduction underway.`] },
          { title: `${i} ${name} — Phase 2`, time: times[1], points: [`${ir} stress in ${b} declining.`, `Secondary impacts monitored.`, `Cross-domain cascade risk: MEDIUM.`] },
          { title: `Recovery`, time: times[2], points: [`${b} ${ir} returning to baseline.`, `Monitoring active.`, `Intervention successful.`] },
        ];
      }
    }

    // Build multi-domain agent notes
    const allDomainSummary = isMulti
      ? activeTypes.map(t => `${t}(${typeCounts[t] || '?'})`).join(' + ')
      : `${ir}(${typeCounts[activeTypes[0]] || '?'})`;

    const agentInfraNote = isMulti
      ? `[${name.toUpperCase()}] Multi-domain repair active in ${b}: ${allDomainSummary}. Infrastructure stress monitored across all queried domains.`
      : DOMAIN_INTERVENTION_TEMPLATES[activeTypes[0]]?.[name]?.action || `${name} active for ${ir} in ${b}.`;
    const agentHealthNote = isMulti
      ? `[${name.toUpperCase()}] Health risk mitigation active for ${allDomainSummary} in ${b}. DOHMH cross-domain protocols engaged.`
      : `${name} reducing secondary health exposure from ${ir} in ${b}.`;
    const agentMobilityNote = isMulti
      ? `[${name.toUpperCase()}] Mobility impact from ${allDomainSummary} in ${b} being managed. Transit + DOT coordination active.`
      : `${name} managing mobility disruptions from ${ir} in ${b}.`;

    // Multi-domain headlines
    const domainTag = isMulti ? activeTypes.map(t => t.split(' ')[0].toUpperCase()).join('+') : i;
    const headlineMap = {
      "Deploy Repair Teams": [`DPW RAPID RESPONSE: ${domainTag} REPAIR OPERATION ACTIVE IN ${b}`, `STRUCTURAL STRESS DROPPING AFTER ${b} MULTI-DOMAIN REPAIR DEPLOYMENT`, `GRID RESILIENCE RESTORED — ${b} ${domainTag} CRISIS CONTAINED`],
      "Issue Health Advisory": [`DOHMH ADVISORY ISSUED: ${b} ${domainTag} EXPOSURE RISK MITIGATED`, `EMERGENCY RESOURCES ON STANDBY FOR ${domainTag} HEALTH FALLOUT IN ${b}`, `${domainTag} ADVISORY COMPLIANCE REDUCES EXPOSURE ACROSS ${b}`],
      "Optimize Traffic Flow": [`DOT ROUTING CLEARS ${domainTag}-RELATED IMPEDANCES IN ${b}`, `TRANSIT REROUTING PREVENTS ${domainTag} GRIDLOCK IN ${b}`, `EMERGENCY RESPONSE TIMES IMPROVE 22% IN ${b} ${domainTag} ZONES`],
      "Increase Monitoring": [`SURVEILLANCE GRID EXPANDED: ${domainTag} MONITORING LIVE IN ${b}`, `DATA FUSION CENTERS REPORT REAL-TIME ${domainTag} CLARITY IN ${b}`, `PREDICTIVE MODELS CALIBRATED WITH LIVE ${domainTag} FEEDS FROM ${b}`],
    };

    return {
      ...cfg,
      cascade,
      headlines: headlineMap[name],
      agentInfraNote, agentHealthNote, agentMobilityNote,
      impactStatement: isMulti
        ? `${name} protocols active across ${activeTypes.length} domains (${allDomainSummary}) in ${b}. Cross-domain cascade risk being actively managed.`
        : `${name} active in ${b}. ${i} risk reducing — intervention monitoring live.`,
    };
  };



  const isInterventionActive = activeIntervention !== null;
  const currentIntervention = activeIntervention ? buildIntervention(activeIntervention) : null;
  const originalRiskScore = charts?.agents?.coordinator?.score || 67;

  const riskReduction = currentIntervention ? currentIntervention.riskReduction : 0;
  const riskScore = isProcessing ? "--" : Math.max(12, originalRiskScore - riskReduction);

  const riskLevel = isProcessing ? "ANALYZING" : (riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW');
  const riskColor = isProcessing ? "text-blue-500" : (riskScore > 70 ? 'text-red-500' : riskScore > 40 ? 'text-yellow-500' : 'text-emerald-500');
  const riskBg = isProcessing ? "bg-blue-500/10 border-blue-500/20" : (riskScore > 70 ? 'bg-red-500/10 border-red-500/20' : riskScore > 40 ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-emerald-500/10 border-emerald-500/20');

  // When intervention is active: use intervention cascade/headlines (already context-aware via template literals)
  // For agents: use REAL scores from backend but apply intervention reduction per domain
  const headlines = currentIntervention ? currentIntervention.headlines : (charts?.headlines || []);
  // Cascade: intervention steps are already populated with topBorough/primaryIssue via template literals in interventionData
  const cascade = currentIntervention ? currentIntervention.cascade : (charts?.cascade || []);

  // Coordinator decision: when intervention is active, compose a specific blended statement
  const coordinatorDecision = currentIntervention
    ? `[${activeIntervention.toUpperCase()}] applied to ${topBorough} ${primaryIssue} situation. ${currentIntervention.impactStatement} Projected risk posture: ${Math.max(5, riskScore)} — monitoring all downstream cascade effects.`
    : (charts?.agents?.coordinator?.decision || 'Awaiting data synchronization.');

  return (
    <div className="h-screen bg-[#080810] text-gray-100 flex flex-col p-4 overflow-hidden font-sans selection:bg-blue-500/30">
      {/* GLOBAL STATUS BAR */}
      <div className={`mb-4 px-6 py-3 rounded-2xl border ${riskBg} flex items-center justify-between shadow-2xl shadow-black/50 transition-all duration-1000 ease-in-out relative overflow-hidden`}>
        {isInterventionActive && (
          <div className="absolute top-0 left-0 w-full h-full bg-emerald-500/5 animate-pulse pointer-events-none" />
        )}
        <div className="flex items-center gap-4 z-10">
          <ShieldAlert size={20} className={riskColor} />
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em] leading-none mb-1">Current NYC Risk Status</span>
            <div className="flex items-center gap-3">
              <span className={`text-2xl font-black italic tracking-tighter leading-none ${riskColor} transition-all duration-1000`}>{riskLevel} ADVISORY</span>
              {isInterventionActive && !isProcessing && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-[9px] font-black text-emerald-400 uppercase tracking-widest animate-fade-in">Mitigation Applied</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-12 z-10">
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Operational Score</span>
            <div className="flex items-center gap-4">
              {isInterventionActive && !isProcessing && (
                <div className="flex flex-col items-end animate-fade-in pr-4 border-r border-white/10">
                  <span className="text-[9px] text-gray-500 font-bold uppercase">📉 Without Intervention: {originalRiskScore}</span>
                  <span className="text-[9px] text-emerald-400 font-bold uppercase">📈 With Intervention: {riskScore}</span>
                </div>
              )}
              <div className="flex items-end gap-2">
                <span className="text-3xl font-black text-white leading-none transition-all duration-1000">{riskScore}</span>
                <span className="text-[10px] font-bold text-gray-600 mb-1">/ 100</span>
              </div>
            </div>
          </div>
          <div className="h-10 w-[1px] bg-white/5" />
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                <Wifi size={10} /> {status}
              </span>
              <span className="text-[10px] font-bold text-gray-400">Tactical Uplink Active</span>
            </div>
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-2xl ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'}`}
            >
              {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
        {/* LEFT: STRATEGIC INPUT & REASONING */}
        <div className="w-[380px] flex flex-col gap-4 shrink-0">
          <div className="flex-1 glass-card flex flex-col min-h-0 rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/2">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-blue-400" />
                <span className="text-[10px] font-black uppercase tracking-widest">Strategic Intel Feed</span>
              </div>
              <button onClick={clearHistory} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-500 transition-all">
                <Trash2 size={14} />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar scroll-smooth bg-gradient-to-b from-transparent to-blue-900/5">
              {userTranscripts.length === 0 && transcripts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-10 grayscale">
                  <Globe size={64} className="mb-4 animate-spin-slow" />
                  <p className="text-xs font-bold uppercase tracking-widest">Scanning Urban Signals...</p>
                </div>
              ) : (
                <>
                  {[...userTranscripts.map(t => ({ ...t, role: 'user' })), ...transcripts.map(t => ({ ...t, role: 'agent' }))]
                    .sort((a, b) => a.ts - b.ts)
                    .map((msg, i) => (
                      msg.role === 'user' ? (
                        <div key={`msg-${i}`} className="flex flex-col items-end gap-2 animate-fade-in">
                          <div className="max-w-[90%] px-4 py-3 bg-blue-600 text-white rounded-2xl rounded-tr-sm text-[11px] font-medium shadow-2xl shadow-blue-500/20 leading-relaxed border border-white/10">
                            {msg.text}
                          </div>
                        </div>
                      ) : (
                        <div key={`msg-${i}`} className="flex flex-col gap-2 animate-fade-in">
                          <div className="flex items-center gap-2 ml-1">
                            <Zap size={10} className="text-blue-400" />
                            <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Coordinator Response</span>
                          </div>
                          <div className="max-w-[100%] px-4 py-4 bg-white/5 border border-white/10 text-gray-200 rounded-2xl rounded-tl-sm text-[11px] leading-relaxed markdown-body shadow-inner">
                            <ReactMarkdown>{msg.text}</ReactMarkdown>
                          </div>
                        </div>
                      )
                    ))}
                  {isProcessing && (
                    <div className="flex flex-col gap-2 animate-fade-in">
                      <div className="flex items-center gap-2 ml-1">
                        <Zap size={10} className="text-blue-400" />
                        <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Coordinator Synthesizing</span>
                      </div>
                      <div className="px-4 py-4 bg-blue-900/10 border border-blue-500/20 text-blue-300 rounded-2xl rounded-tl-sm text-[11px] font-medium animate-pulse flex items-center gap-3">
                        <RefreshCw size={14} className="animate-spin" />
                        {activeLoadingMessage}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 bg-black/40 border-t border-white/5">
              <form onSubmit={(e) => { e.preventDefault(); const t = e.target.query.value; if (t) { sendText(t); e.target.reset(); } }} className="relative">
                <input
                  name="query"
                  placeholder="Input tactical query..."
                  disabled={isProcessing}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-xs focus:outline-none focus:border-blue-500/50 transition-all pr-12 placeholder:text-gray-600 font-medium disabled:opacity-50"
                />
                <button disabled={isProcessing} className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 text-blue-500 hover:text-blue-400 transition-transform active:scale-90 disabled:opacity-50">
                  <Send size={18} />
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* CENTER: TACTICAL VISUALIZATION & ACTIONS */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <div className="flex-[1.5] glass-card rounded-2xl border border-white/10 overflow-hidden relative shadow-2xl group">
            {isProcessing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm z-20">
                <Globe size={48} className="text-blue-500 mb-4 animate-spin-slow" />
                <span className="text-[12px] font-black text-blue-400 uppercase tracking-widest animate-pulse">{activeLoadingMessage}</span>
              </div>
            ) : (
              <MapChart locations={charts?.locations || []} mapCenter={charts?.map_center} />
            )}
            <div className="absolute top-4 left-4 pointer-events-none transition-all group-hover:scale-105">
              <div className="px-4 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 flex items-center gap-3 shadow-2xl z-30">
                <div className="relative">
                  <Globe size={14} className="text-blue-400" />
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                </div>
                <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Live Tactical Visualization</span>
              </div>
            </div>
            {/* Top Borough Overlay */}
            {charts?.borough_counts && !isProcessing && (
              <div className="absolute top-4 right-4 z-30">
                <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10">
                  <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-1">Max Intensity Sector</span>
                  <span className="text-xs font-black text-blue-400 uppercase">{Object.entries(charts.borough_counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NYC'}</span>
                </div>
              </div>
            )}
          </div>

          {/* ACTION PANEL */}
          <div className="shrink-0 glass-card rounded-2xl border border-white/10 p-4 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Wrench size={16} className="text-blue-400" />
              <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">🛠 Intervention Simulator</span>
              <span className="text-[8px] font-bold text-gray-500 uppercase ml-2 bg-white/5 px-2 py-0.5 rounded">Action Engine</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { name: "Deploy Repair Teams", icon: "👷" },
                { name: "Issue Health Advisory", icon: "⚕️" },
                { name: "Optimize Traffic Flow", icon: "🚦" },
                { name: "Increase Monitoring", icon: "🛰️" }
              ].map((action, idx) => (
                <button
                  key={idx}
                  disabled={isProcessing}
                  onClick={() => handleIntervention(action.name)}
                  className={`px-3 py-3 rounded-xl border text-[10px] font-black uppercase tracking-tight flex items-center justify-center gap-2 transition-all duration-300 ${activeIntervention === action.name
                    ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)] transform scale-105'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:border-white/20 disabled:opacity-30 disabled:hover:bg-white/5'
                    }`}
                >
                  <span className="text-base">{action.icon}</span>
                  {action.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: PREDICTIVE & DECISION STACK */}
        <div className="w-[380px] flex flex-col gap-4 min-h-0 shrink-0">
          {/* Cascade Simulator */}
          <div className="flex-[1.2] glass-card flex flex-col min-h-0 rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0 bg-white/5">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-blue-400" />
                <span className="text-[10px] font-black uppercase tracking-widest">🔮 Cascade Forecast Simulator</span>
              </div>
              <div className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[8px] font-bold text-blue-400 uppercase">Predictive</div>
            </div>
            <div className="flex-1 min-h-0 p-5 overflow-y-auto custom-scrollbar relative">
              <div className={`transition-opacity duration-500 ${isInterventionActive ? 'opacity-100' : 'opacity-100'}`}>
                {charts && charts.cascade && !isProcessing ? (
                  <div className="flex flex-col gap-8 relative">
                    <div className={`absolute left-[13px] top-2 bottom-2 w-0.5 transition-all duration-1000 ${isInterventionActive ? 'bg-gradient-to-b from-emerald-500 to-blue-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-gradient-to-b from-yellow-500 via-orange-500 to-red-600 shadow-[0_0_10px_rgba(255,165,0,0.5)] opacity-30'}`} />
                    {cascade.map((step, idx) => (
                      <div key={idx} className="flex gap-5 relative animate-fade-in group" style={{ animationDelay: `${idx * 200}ms` }}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 shadow-2xl border border-white/10 transition-colors duration-1000 group-hover:scale-110 ${isInterventionActive ? 'bg-emerald-500 text-white shadow-emerald-500/20' : (idx === 0 ? 'bg-yellow-500 text-black shadow-yellow-500/20' : idx === 1 ? 'bg-orange-500 text-black shadow-orange-500/20' : 'bg-red-600 text-white shadow-red-600/20')
                          }`}>
                          <span className="text-xs">{isInterventionActive && currentIntervention ? currentIntervention.icon : (idx === 0 ? '⚡' : idx === 1 ? '🚗' : '🏥')}</span>
                        </div>
                        <div className="flex-1 pt-0.5">
                          <div className="flex justify-between items-center mb-1.5">
                            <h4 className="text-[11px] font-black text-white uppercase tracking-tight">{step.title}</h4>
                            <span className="text-[9px] font-bold text-gray-500 bg-white/5 px-2 py-0.5 rounded border border-white/5">{step.time}</span>
                          </div>
                          <ul className="space-y-1.5">
                            {step.points.map((p, pi) => (
                              <li key={pi} className="text-[10px] text-gray-400 leading-tight flex items-start gap-2">
                                <span className={`mt-1.5 w-1 h-1 rounded-full shrink-0 ${isInterventionActive ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                                <span>{p}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="h-full flex flex-col items-center justify-center italic text-blue-400/70 text-[10px] uppercase font-black tracking-widest gap-3 animate-pulse">
                  <RefreshCw size={24} className="animate-spin text-blue-500" />
                  {isProcessing ? activeLoadingMessage : "Establishing Baseline..."}
                </div>}
              </div>
            </div>
          </div>

          {/* Agent Decision Board */}
          <div className="flex-1 glass-card flex flex-col min-h-0 rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-emerald-400" />
                <span className="text-[10px] font-black uppercase tracking-widest">⚡ Multi-Agent Intelligence Deck</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
              {charts && charts.agents && !isProcessing ? (
                <div className="flex flex-col gap-6">
                  {/* Sub-Agents Grid */}
                  <div className="grid grid-cols-1 gap-3">
                    {charts.agents.sub.map((agent, idx) => {
                      let specificReduction = 0;
                      if (currentIntervention) {
                        if (agent.name.includes("Infrastructure")) specificReduction = currentIntervention.infraReduction;
                        else if (agent.name.includes("Health")) specificReduction = currentIntervention.healthReduction;
                        else if (agent.name.includes("Mobility")) specificReduction = currentIntervention.mobilityReduction;
                        else specificReduction = currentIntervention.riskReduction;
                      }
                      const finalAgentScore = isInterventionActive ? Math.max(10, agent.score - specificReduction) : agent.score;
                      const scoreColor = finalAgentScore > 70 ? 'text-red-400' : finalAgentScore > 40 ? 'text-yellow-400' : 'text-emerald-400';
                      const barColor = finalAgentScore > 70 ? 'bg-red-500' : finalAgentScore > 40 ? 'bg-yellow-500' : 'bg-emerald-500';
                      const borderColor = finalAgentScore > 70 ? 'bg-red-500' : finalAgentScore > 40 ? 'bg-yellow-500' : 'bg-emerald-500';
                      return (
                        <div key={idx} className="p-3 rounded-xl bg-white/2 border border-white/5 flex flex-col relative overflow-hidden group hover:border-white/10 transition-all animate-fade-in" style={{ animationDelay: `${idx * 150}ms` }}>
                          <div className={`absolute top-0 left-0 w-[2px] h-full transition-colors duration-1000 ${borderColor}`} />
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <span className="text-base">{agent.icon}</span>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-black text-gray-200 uppercase tracking-tight">{agent.name}</span>
                                <span className={`text-[8px] font-black uppercase tracking-widest ${scoreColor}`}>{agent.level} RISK</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className={`text-sm font-black transition-colors duration-1000 ${scoreColor}`}>
                                {finalAgentScore}
                              </span>
                              <span className="text-[8px] font-bold text-gray-600 uppercase">/ 100</span>
                            </div>
                          </div>
                          {/* Risk bar */}
                          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-2">
                            <div className={`h-full transition-all duration-1000 ${barColor}`} style={{ width: `${finalAgentScore}%` }} />
                          </div>
                          {/* Context reasoning note — intervention-specific if active, otherwise live backend note */}
                          {(() => {
                            let note = agent.reasoning;
                            if (currentIntervention) {
                              if (agent.name.includes('Infrastructure')) note = currentIntervention.agentInfraNote;
                              else if (agent.name.includes('Health')) note = currentIntervention.agentHealthNote;
                              else if (agent.name.includes('Mobility')) note = currentIntervention.agentMobilityNote;
                            }
                            return note ? (
                              <p className={`text-[9px] leading-relaxed pl-1 border-l border-white/5 transition-colors duration-500 ${currentIntervention ? 'text-emerald-400/70' : 'text-gray-500'}`}>
                                {currentIntervention && <span className="font-black text-emerald-400 mr-1">[{activeIntervention.toUpperCase()}]</span>}
                                {note}
                              </p>
                            ) : null;
                          })()}
                        </div>
                      )
                    })}
                  </div>

                  {/* Reasoning Flow */}
                  <div className="flex flex-col items-center gap-3 animate-fade-in" style={{ animationDelay: '600ms' }}>
                    <div className="text-[8px] font-black text-gray-600 uppercase tracking-[0.3em] flex items-center gap-3">
                      <div className="w-12 h-[1px] bg-white/5" />
                      <span>Reasoning Flow</span>
                      <div className="w-12 h-[1px] bg-white/5" />
                    </div>
                    <div className="flex items-center gap-2">
                      {charts.agents.sub.map((a, i) => {
                        let specificReduction = 0;
                        if (currentIntervention) {
                          if (a.name.includes("Infrastructure")) specificReduction = currentIntervention.infraReduction;
                          else if (a.name.includes("Health")) specificReduction = currentIntervention.healthReduction;
                          else if (a.name.includes("Mobility")) specificReduction = currentIntervention.mobilityReduction;
                          else specificReduction = currentIntervention.riskReduction;
                        }
                        const score = isInterventionActive ? Math.max(10, a.score - specificReduction) : a.score;
                        return (
                          <React.Fragment key={i}>
                            <div className={`w-2 h-2 rounded-full transition-colors duration-1000 ${score > 70 ? 'bg-red-500' : score > 40 ? 'bg-yellow-500' : 'bg-emerald-500'}`} />
                            {i < 2 && <div className="w-4 h-[1px] bg-white/10" />}
                          </React.Fragment>
                        );
                      })}
                      <div className="mx-3 text-blue-500 animate-pulse">→</div>
                      <div className="px-3 py-1 rounded bg-blue-500/20 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                        <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Synthesizing</span>
                      </div>
                    </div>
                  </div>

                  {/* Coordinator Final Authority */}
                  <div className={`p-4 rounded-2xl relative overflow-hidden shadow-2xl animate-fade-in ring-1 transition-all duration-1000 ${isInterventionActive ? 'bg-emerald-600/10 border border-emerald-500/40 ring-emerald-500/20 shadow-emerald-500/10' : 'bg-blue-600/10 border border-blue-500/40 ring-blue-500/20 shadow-blue-500/10'}`} style={{ animationDelay: '1000ms' }}>
                    <div className={`absolute -right-8 -top-8 w-24 h-24 blur-3xl rounded-full transition-colors duration-1000 ${isInterventionActive ? 'bg-emerald-500/10' : 'bg-blue-500/10'}`} />
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`p-2 rounded-lg border transition-colors duration-1000 ${isInterventionActive ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20' : 'bg-blue-500/20 text-blue-400 border-blue-500/20'}`}>
                        <Brain size={16} />
                      </div>
                      <div className="flex flex-col">
                        <span className={`text-[11px] font-black uppercase tracking-widest transition-colors duration-1000 ${isInterventionActive ? 'text-emerald-100' : 'text-blue-100'}`}>Coordinator Agent</span>
                        <span className={`text-[8px] font-bold uppercase transition-colors duration-1000 ${isInterventionActive ? 'text-emerald-400/60' : 'text-blue-400/60'}`}>Final Decision Authority</span>
                      </div>
                    </div>
                    <div className="flex items-end gap-3 mb-3">
                      <span className="text-4xl font-black text-white leading-none tracking-tighter transition-all duration-1000">{riskScore}</span>
                      <div className="flex flex-col mb-1">
                        <span className={`text-[10px] font-black uppercase transition-colors duration-1000 ${isInterventionActive ? 'text-emerald-500' : (riskScore > 70 ? 'text-red-500' : 'text-blue-400')}`}>
                          {riskLevel} RISK POSTURE
                        </span>
                        <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden mt-1">
                          <div className={`h-full transition-all duration-1000 ${isInterventionActive ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${riskScore}%` }} />
                        </div>
                      </div>
                    </div>
                    {isInterventionActive ? (
                      <div className="border-t border-emerald-500/20 pt-3 flex flex-col gap-1">
                        <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">IMPACT OF INTERVENTION</span>
                        <p className="text-[10px] text-emerald-100/80 font-medium leading-relaxed italic">
                          "{coordinatorDecision}"
                        </p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-blue-100/70 font-medium leading-relaxed border-t border-blue-500/20 pt-3 italic">
                        "{coordinatorDecision}"
                      </p>
                    )}
                  </div>
                </div>
              ) : <div className="h-full flex flex-col items-center justify-center italic text-blue-400/70 text-[10px] uppercase font-black tracking-widest gap-3 animate-pulse">
                <Layers size={24} className="animate-pulse text-blue-500" />
                {isProcessing ? activeLoadingMessage : "Establishing Baseline..."}
              </div>}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM FOOTER: PREDICTIVE HEADLINES TICKER */}
      <footer className="h-28 shrink-0 flex gap-4 mt-4">
        {charts && charts.headlines && !isProcessing ? headlines.map((h, i) => (
          <div key={i} className={`flex-1 glass-card rounded-2xl border p-5 flex flex-col justify-center animate-fade-in relative group transition-all duration-500 bg-gradient-to-br from-white/2 to-transparent ${isInterventionActive ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-white/5 hover:border-blue-500/30'}`} style={{ animationDelay: `${i * 300}ms` }}>
            <div className={`absolute top-0 left-0 w-full h-[3px] opacity-0 group-hover:opacity-100 transition-opacity ${isInterventionActive ? 'bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent' : 'bg-gradient-to-r from-transparent via-blue-500/40 to-transparent'}`} />
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${isInterventionActive ? 'bg-emerald-500 text-emerald-500' : 'bg-blue-500 text-blue-500'}`} />
              <span className={`text-[9px] font-black uppercase tracking-[0.3em] italic ${isInterventionActive ? 'text-emerald-500/70' : 'text-gray-600'}`}>Future City Headline • 48H Forecast</span>
            </div>
            <p className={`text-[12px] font-black text-white leading-tight uppercase tracking-tight italic transition-colors ${isInterventionActive ? 'group-hover:text-emerald-200' : 'group-hover:text-blue-200'}`}>
              "{h}"
            </p>
          </div>
        )) : (
          <div className="w-full flex items-center justify-center glass-card rounded-2xl border border-white/5 italic text-blue-400/70 text-[11px] uppercase tracking-[0.5em] font-black gap-4 animate-pulse">
            <RefreshCw size={16} className="animate-spin text-blue-500" />
            {isProcessing ? activeLoadingMessage : "Generating Predictive Narrative Pulse..."}
          </div>
        )}
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CityPulseApp />
    </ErrorBoundary>
  );
}
