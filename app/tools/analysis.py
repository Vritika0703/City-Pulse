import pandas as pd
from sklearn.ensemble import IsolationForest
import numpy as np

def detect_anomalies(data: list):
    """
    Detects anomalies in a time series of counts.
    Expected data format: list of dicts with 'count' key.
    """
    if len(data) < 5:  # Not enough data for Isolation Forest
        return data, []

    df = pd.DataFrame(data)
    X = df[['count']].values
    
    # Fit Isolation Forest
    model = IsolationForest(contamination=0.1, random_state=42)
    df['anomaly'] = model.fit_predict(X)
    
    # -1 is anomaly, 1 is normal
    anomalies = df[df['anomaly'] == -1].to_dict(orient='records')
    
    return df.to_dict(orient='records'), anomalies
