import os
import asyncio
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv('GOOGLE_API_KEY'))

async def get_311_stats(borough: str = None, complaint_type: str = None):
    return {"total": 123, "status": "Mocked Success"}

async def main():
    try:
        config = types.GenerateContentConfig(
            tools=[get_311_stats]
        )
        response = await client.aio.models.generate_content(
            model='gemma-3-12b-it',
            contents='How many complaints in Brooklyn?',
            config=config
        )
        print(f"[SUCCESS] Gemma response: {response}")
    except Exception as e:
        print(f"[FAILED] Gemma: {e}")

asyncio.run(main())
