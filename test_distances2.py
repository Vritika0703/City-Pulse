import asyncio
from app.services.vector_db import VectorDB

async def main():
    db = VectorDB()
    res = db.query("Which borough has improved the most in resolving complaints this month?")
    print("DISTANCES:", res.get("distances", [[]])[0])

asyncio.run(main())
