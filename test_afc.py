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
    response_stream = await chat.send_message_stream("What is test_tool(5)?")
    async for chunk in response_stream:
        print(f"CHUNK: {chunk.text}")
    print("DONE")

asyncio.run(main())
