"""
agents/base_agent.py - Abstract base class for all skill agents.

All agents are lightweight Python objects that communicate via HTTP:
  - FAISS / keyword search  →  POST {server_url}/api/search
  - LLM inference           →  POST {ollama_url}/api/chat  (Ollama directly)

This avoids loading GPU models (FAISS embedder, Ollama) inside the
subprocess, keeping the worker lightweight with no GPU requirement.
"""

import logging
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Abstract base for all skill agents."""

    # Subclasses must declare their role string
    role: str = "base"

    def __init__(
        self,
        server_url: str = "http://localhost:8000",
        session_id: Optional[str] = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.session_id = session_id
        self.log = logging.getLogger(f"agent.{self.role}")

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(self, action: str, inputs: Dict[str, Any]) -> Any:
        """Execute *action* with *inputs*.  Returns action result."""
        self.log.info("action=%s", action)
        return self.run_action(action, inputs)

    @abstractmethod
    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        """Subclasses implement the actual logic here."""
        ...

    # ------------------------------------------------------------------
    # Shared helpers – callable from any subclass
    # ------------------------------------------------------------------

    def _search(
        self,
        query: str,
        k: int = 20,
        search_scope: Optional[Dict[str, bool]] = None,
        search_mode: str = "both",
    ) -> Dict:
        """POST to /api/search on the TwistedCollab3 server."""
        scope = search_scope or {
            "reference_papers": True,
            "my_papers": True,
            "sessions": False,
            "web_cache": False,
        }
        payload = {
            "query": query,
            "k": k,
            "search_scope": scope,
            "search_mode": search_mode,
        }
        resp = requests.post(
            f"{self.server_url}/api/search", json=payload, timeout=60
        )
        resp.raise_for_status()
        return resp.json()

    def _llm_chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 4000,
    ) -> str:
        """POST to Ollama /api/chat directly for LLM inference."""
        from config import OLLAMA_URL, DEFAULT_MODEL, NUM_CTX

        payload = {
            "model": model or DEFAULT_MODEL,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
                "num_ctx": NUM_CTX,
            },
        }
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat", json=payload, timeout=300
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]

    def _extract_number(self, text: str, default: float = 5.0) -> float:
        """Extract the first numeric value from a string."""
        match = re.search(r"\b(\d+(?:\.\d+)?)\b", text.strip())
        if match:
            return min(10.0, max(0.0, float(match.group(1))))
        return default
