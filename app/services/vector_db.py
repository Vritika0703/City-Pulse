import chromadb
from chromadb import Documents, EmbeddingFunction, Embeddings
from google import genai
from app.core.config import get_settings
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

class GeminiEmbeddingFunction(EmbeddingFunction):
    """Custom embedding function using google-genai SDK."""
    def __init__(self):
        self._client = genai.Client(api_key=settings.GOOGLE_API_KEY)

    def __call__(self, input: Documents) -> Embeddings:
        embeddings = []
        for text in input:
            result = self._client.models.embed_content(
                model=settings.EMBEDDING_MODEL,
                contents=text,
            )
            embeddings.append(result.embeddings[0].values)
        return embeddings

class VectorDB:
    def __init__(self):
        self.chroma_client = chromadb.PersistentClient(path=settings.CHROMA_DB_PATH)
        self.embedding_fn = GeminiEmbeddingFunction()
        self.collection = self.chroma_client.get_or_create_collection(
            name="city_reports",
            embedding_function=self.embedding_fn
        )
        logger.info("VectorDB initialized with Gemini embeddings.")

    def add_documents(self, documents: list, metadatas: list, ids: list):
        try:
            self.collection.add(
                documents=documents,
                metadatas=metadatas,
                ids=ids
            )
            logger.info(f"Added {len(documents)} documents to ChromaDB")
        except Exception as e:
            logger.error(f"Error adding to ChromaDB: {e}")

    def query(self, text: str, n_results: int = 3):
        try:
            count = self.collection.count()
            if count == 0:
                return {"documents": [[]], "metadatas": [[]]}
            results = self.collection.query(
                query_texts=[text],
                n_results=min(n_results, count)
            )
            return results
        except Exception as e:
            logger.error(f"Error querying ChromaDB: {e}")
            return {"documents": [[]], "metadatas": [[]]}
