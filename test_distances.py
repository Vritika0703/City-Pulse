import asyncio
from app.services.vector_db import VectorDB

async def main():
    db = VectorDB()
    # Good match for noise
    res = db.query("noise complaints manhattan")
    print("GOOD MATCH DISTANCES:", res.get("distances", [[]])[0])
    
    # Bad match for noise (should return whatever)
    res2 = db.query("unresolved complaints highest ratio")
    print("BAD MATCH DISTANCES:", res2.get("distances", [[]])[0])

asyncio.run(main())
