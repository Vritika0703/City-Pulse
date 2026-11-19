import asyncio
import os
import sys
import time
import httpx
import logging
import pandas as pd
from collections import OrderedDict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

NYC_311_ENDPOINT = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"

# Only the columns the analysis actually reads: cuts payloads ~6x (13 MB -> 2 MB)
FIELDS = ("created_date", "closed_date", "status", "borough",
          "complaint_type", "latitude", "longitude")
_INTERNED = {"status", "borough", "complaint_type"}  # highly repetitive values

# Socrata answers in 4-6s even for tiny queries, so the only way to answer in
# well under a second is to already have the rows. Results are cached for
# CACHE_TTL seconds; rows are stored as compact tuples to stay within the
# 512 MB of a free Render instance.
CACHE_TTL = 30 * 60
CACHE_MAX_ENTRIES = 30
_cache = OrderedDict()  # key -> (expires_at, packed_rows)
_inflight: dict = {}

_client = None  # shared httpx.AsyncClient (connection reuse)


def _get_client():
    global _client
    if _client is None or _client.is_closed:
        headers = {}
        token = os.getenv("NYC_APP_TOKEN")
        if token:
            headers["X-App-Token"] = token
        # Large borough pulls take 4-13s from Socrata; httpx's 5s default
        # silently turned those into "0 complaints"
        _client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), headers=headers)
    return _client


def _pack(rows: list) -> list:
    return [tuple(sys.intern(v) if (k in _INTERNED and isinstance(v, str)) else v
                  for k, v in ((f, r.get(f)) for f in FIELDS)) for r in rows]


def _unpack(rows: list) -> list:
    return [{f: v for f, v in zip(FIELDS, row) if v is not None} for row in rows]


async def _download(borough, complaint_type, days):
    date_limit = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
    where = f"created_date > '{date_limit}'"
    if borough:
        where += f" AND borough = '{borough.upper()}'"
    if complaint_type:
        # Partial matching for broader categories (e.g. 'Noise' -> '%Noise%')
        where += f" AND complaint_type like '%{complaint_type}%'"
    params = {
        "$select": ",".join(FIELDS),
        "$where": where,
        "$order": "created_date DESC",
        "$limit": "10000",
    }
    t0 = time.perf_counter()
    response = await _get_client().get(NYC_311_ENDPOINT, params=params)
    response.raise_for_status()
    rows = response.json()
    logger.info(f"311 fetch {borough}/{complaint_type}: {len(rows)} rows in {time.perf_counter() - t0:.1f}s")
    return _pack(rows)


async def fetch_311_data(borough: str = None, complaint_type: str = None, days: int = 30):
    """
    Fetches 311 complaint data from NYC Open Data, served from a 30-minute
    in-memory cache when possible. Identical concurrent requests share one download.
    """
    key = ((borough or "").upper(), (complaint_type or "").upper(), days)

    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        _cache.move_to_end(key)
        return _unpack(hit[1])

    task = _inflight.get(key)
    if task is None:
        task = asyncio.ensure_future(_download(borough, complaint_type, days))
        _inflight[key] = task
    try:
        packed = await asyncio.shield(task)
    except Exception as e:
        logger.error(f"Error fetching 311 data: {e}")
        return []
    finally:
        if _inflight.get(key) is task and task.done():
            _inflight.pop(key, None)

    _cache[key] = (time.time() + CACHE_TTL, packed)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)
    return _unpack(packed)


# Trend aggregation + IsolationForest anomaly detection depend only on the rows,
# so results are memoized by a fingerprint of the data. On a free Render instance
# (~0.1 vCPU) this fitting otherwise costs ~0.5s per query.
_trend_cache = OrderedDict()


def trends_with_anomalies(data: list):
    from app.tools.analysis import detect_anomalies
    if not data:
        return {}, []
    fp = (len(data), data[0].get("created_date"), data[-1].get("created_date"),
          data[len(data) // 2].get("created_date"))
    hit = _trend_cache.get(fp)
    if hit:
        _trend_cache.move_to_end(fp)
        return hit
    result = detect_anomalies(process_311_trends(data))
    _trend_cache[fp] = result
    while len(_trend_cache) > 64:
        _trend_cache.popitem(last=False)
    return result


# Borough x category combinations behind the suggested questions and the most
# common queries; kept warm so they answer without waiting on Socrata.
PREWARM_BOROUGHS = ["BROOKLYN", "QUEENS", "BRONX", "MANHATTAN", "STATEN ISLAND"]
PREWARM_TYPES = ["Rodent", "HEAT/HOT WATER", "Noise", "Sewer"]


async def prewarm_cache(days: int = 60, concurrency: int = 4):
    sem = asyncio.Semaphore(concurrency)

    async def one(b, t):
        async with sem:
            key = (b.upper(), t.upper(), days)
            _cache.pop(key, None)  # force refresh
            data = await fetch_311_data(borough=b, complaint_type=t, days=days)
            trends_with_anomalies(data)  # precompute so first queries skip model fitting

    t0 = time.perf_counter()
    await asyncio.gather(*(one(b, t) for t in PREWARM_TYPES for b in PREWARM_BOROUGHS),
                         return_exceptions=True)
    logger.info(f"311 cache prewarmed ({len(_cache)} entries) in {time.perf_counter() - t0:.0f}s")


async def prewarm_loop(interval: int = 25 * 60):
    while True:
        try:
            await prewarm_cache()
        except Exception as e:
            logger.error(f"311 prewarm failed: {e}")
        await asyncio.sleep(interval)

def process_311_trends(data):
    """
    Processes 311 data into a format suitable for Plotly.
    Drops the current (incomplete) day so the chart doesn't show a false cliff.
    """
    if not data:
        return {}
    
    df = pd.DataFrame(data)
    df['created_date'] = pd.to_datetime(df['created_date'])
    
    # Simple daily counts
    trends = df.groupby(df['created_date'].dt.date).size().reset_index(name='count')
    
    # Drop today's partial data — it will always look like a cliff
    today = datetime.now().date()
    trends = trends[trends['created_date'] < today]
    
    trends['created_date'] = trends['created_date'].astype(str)
    
    return trends.to_dict(orient='records')
