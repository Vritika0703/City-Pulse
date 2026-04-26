import httpx
import logging
import pandas as pd
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

NYC_311_ENDPOINT = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"

async def fetch_311_data(borough: str = None, complaint_type: str = None, days: int = 30):
    """
    Fetches 311 complaint data from NYC Open Data.
    """
    date_limit = (datetime.now() - timedelta(days=days)).isoformat()
    
    query = f"$where=created_date > '{date_limit}'"
    if borough:
        query += f" AND borough = '{borough.upper()}'"
    if complaint_type:
        # Use partial matching for broader categories (e.g., 'Noise' -> '%Noise%')
        query += f" AND complaint_type like '%25{complaint_type}%25'"
    
    url = f"{NYC_311_ENDPOINT}?{query}&$order=created_date DESC&$limit=10000"    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
            return data
        except Exception as e:
            logger.error(f"Error fetching 311 data: {e}")
            return []

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
