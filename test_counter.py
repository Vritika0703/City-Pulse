import asyncio
from collections import Counter
import json

c = Counter({'A': 1, 'B': 2})
try:
    print(json.dumps(c))
except Exception as e:
    print(f"Error: {e}")

