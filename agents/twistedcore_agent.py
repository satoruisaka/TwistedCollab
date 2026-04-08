"""
agents/twistedcore_agent.py — TwistedCore bridge agent for TwistedCollab skills.

Forwards requests to the TwistedCore daemon (default :8020) so that
TwistedCollab skills can leverage TwistedCore's persistent memory,
intent engine, and multi-service orchestration.

Supported actions
-----------------
query(question, source)
    Send a natural-language question through TwistedCore's full pipeline
    (IntentEngine → Orchestrator) and return the assistant response.
    Returns: {response, handler, success, metadata}

get_pending()
    Fetch all open [PENDING] items from TwistedCore's L2 journal —
    things TwistedCore flagged as unresolved across past sessions.
    Returns: {pending: [...], count: N}

get_context(n)
    Fetch the N most recent compressed session summaries from TwistedCore's
    L2 journal, including extracted topics, decisions, and pending items.
    Returns: {entries: [...], count: N}
"""

from typing import Any, Dict, Optional

import requests

from agents.base_agent import BaseAgent


class TwistedCoreAgent(BaseAgent):
    role = "twistedcore_agent"

    def __init__(
        self,
        server_url: str = "http://localhost:8000",
        session_id: Optional[str] = None,
    ):
        super().__init__(server_url=server_url, session_id=session_id)
        # TwistedCore runs on its own port — read from TwistedCollab config
        try:
            from config import TWISTEDCORE_URL
            self._tc_url = TWISTEDCORE_URL.rstrip("/")
        except (ImportError, AttributeError):
            self._tc_url = "http://localhost:8020"

    # ------------------------------------------------------------------
    # Action dispatcher
    # ------------------------------------------------------------------

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "query":
            return self._query(inputs)
        if action == "get_pending":
            return self._get_pending(inputs)
        if action == "get_context":
            return self._get_context(inputs)
        raise ValueError(f"TwistedCoreAgent: unknown action '{action}'")

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def _query(self, inputs: Dict) -> Dict:
        """Send a question to TwistedCore and return the structured response."""
        question: str = inputs.get("question") or inputs.get("query", "")
        source:   str = inputs.get("source", "api")   # text | voice | api

        if not question:
            return {
                "response": "",
                "handler": "none",
                "success": False,
                "metadata": {"error": "No question supplied"},
            }

        self.log.info("Forwarding question to TwistedCore: %.80s", question)
        try:
            resp = requests.post(
                f"{self._tc_url}/process",
                json={"message": question, "source": source},
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            self.log.error("TwistedCore /process unreachable: %s", exc)
            return {
                "response": f"TwistedCore unavailable: {exc}",
                "handler":  "none",
                "success":  False,
                "metadata": {"error": str(exc)},
            }

    def _get_pending(self, inputs: Dict) -> Dict:
        """Retrieve all open [PENDING] items from TwistedCore's L2 journal."""
        self.log.info("Fetching pending items from TwistedCore")
        try:
            resp = requests.get(
                f"{self._tc_url}/memory/pending",
                timeout=10,
            )
            resp.raise_for_status()
            return resp.json()   # {pending: [...], count: N}
        except requests.RequestException as exc:
            self.log.error("TwistedCore /memory/pending failed: %s", exc)
            return {"pending": [], "count": 0, "error": str(exc)}

    def _get_context(self, inputs: Dict) -> Dict:
        """Retrieve recent compressed session summaries from TwistedCore's L2 journal."""
        n: int = int(inputs.get("n", 3))
        self.log.info("Fetching %d context entries from TwistedCore", n)
        try:
            resp = requests.get(
                f"{self._tc_url}/memory/context",
                params={"n": n},
                timeout=10,
            )
            resp.raise_for_status()
            return resp.json()   # {entries: [...], count: N}
        except requests.RequestException as exc:
            self.log.error("TwistedCore /memory/context failed: %s", exc)
            return {"entries": [], "count": 0, "error": str(exc)}
