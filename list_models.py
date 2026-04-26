import os
import asyncio
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv('GOOGLE_API_KEY'))

async def main():
    models = await client.aio.models.list()
    for m in models:
        if "flash" in m.name.lower():
            print(m.name)

asyncio.run(main())
