import os
import asyncio
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv('GOOGLE_API_KEY'))

def test_tool(x: int):
    """Test tool."""
    return {"result": x * 2}

async def main():
    chat = client.aio.chats.create(
        model="gemini-flash-latest",
        config=genai.types.GenerateContentConfig(tools=[test_tool])
    )
    response = await chat.send_message("What is test_tool(5)?")
    print(f"RESPONSE: {response.text}")

asyncio.run(main())
