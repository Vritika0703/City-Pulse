import os
import asyncio
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv('GOOGLE_API_KEY'))

async def test_model(model_name):
    try:
        response = await client.aio.models.generate_content(
            model=model_name,
            contents='Say hi'
        )
        print(f"[SUCCESS] {model_name} worked!")
        return True
    except Exception as e:
        print(f"[FAILED] {model_name}: {e}")
        return False

async def main():
    models = ['gemini-2.5-flash-lite', 'gemma-3-12b-it', 'gemini-1.5-flash-8b', 'gemini-flash-lite-latest']
    for m in models:
        await test_model(m)

asyncio.run(main())
