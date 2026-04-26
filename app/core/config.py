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

    # ChromaDB
    CHROMA_DB_PATH: str = "./chroma_db"

    model_config = {"env_file": ".env"}

@lru_cache()
def get_settings():
    return Settings()
