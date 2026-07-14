from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional

class Settings(BaseSettings):
    GOOGLE_API_KEY: str
    PROJECT_NAME: str = "City Pulse"
    GEMINI_MODEL: str = "gemini-2.5-flash-native-audio-latest"
    EMBEDDING_MODEL: str = "gemini-embedding-001"

    # NYC Open Data
    NYC_APP_TOKEN: Optional[str] = None

    # Groq API
    GROQ_API_KEY: Optional[str] = None
    # Model name — can be overridden via env var on Render without redeploying
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # ChromaDB — set USE_MEMORY_DB=true on Render (ephemeral filesystem)
    CHROMA_DB_PATH: str = "./chroma_db"
    USE_MEMORY_DB: bool = False

    model_config = {"env_file": ".env"}

@lru_cache()
def get_settings():
    return Settings()
