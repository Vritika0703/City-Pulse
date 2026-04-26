import os
import uuid
from app.services.vector_db import VectorDB

def ingest_sample_data():
    db = VectorDB()
    
    samples = [
        {
            "text": "NYC Mayor's Management Report 2024: Noise complaints have increased by 15% in the Bronx due to increased construction activity.",
            "source": "MMR_2024_BRONX"
        },
        {
            "text": "MTA Performance Report Q1 2024: Subways experienced a 10% increase in delays on the 4/5/6 lines due to signal upgrades.",
            "source": "MTA_Q1_2024"
        },
        {
            "text": "NYC Open Data Study: Residential noise is the primary source of 311 complaints in Brooklyn during summer months.",
            "source": "NYC_OPEN_DATA_STUDY"
        }
    ]
    
    docs = [s["text"] for s in samples]
    metas = [{"source": s["source"]} for s in samples]
    ids = [str(uuid.uuid4()) for _ in samples]
    
    db.add_documents(docs, metas, ids)
    print("Sample data ingested into ChromaDB.")

if __name__ == "__main__":
    ingest_sample_data()
