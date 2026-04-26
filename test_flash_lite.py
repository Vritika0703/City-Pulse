import os
import asyncio
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv('GOOGLE_API_KEY'))

async def main():
    try:
        response = await client.aio.models.generate_content(
            model='gemini-2.0-flash-lite',
            contents='Hi'
        )
        print(f"[SUCCESS] gemini-2.0-flash-lite worked!")
    except Exception as e:
        print(f"[FAILED] gemini-2.0-flash-lite: {e}")

asyncio.run(main())
