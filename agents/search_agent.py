"""
agents/search_agent.py - Retrieval agent.

Calls POST /api/search on the TwistedCollab3 server (semantic + keyword).
Supports action:
  search_literature(topic, max_papers, search_scope)  →  {query, results, count}
"""

from typing import Any, Dict, Optional

from agents.base_agent import BaseAgent


class SearchAgent(BaseAgent):
    role = "search_agent"

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "search_literature":
            return self._search_literature(inputs)
        raise ValueError(f"SearchAgent: unknown action '{action}'")

    # ------------------------------------------------------------------

    def _search_literature(self, inputs: Dict) -> Dict:
        topic: str = inputs.get("topic") or inputs.get("query", "")
        max_papers: int = min(int(inputs.get("max_papers", 20)), 50)  # server caps k at 50
        search_scope: Optional[Dict] = inputs.get("search_scope") or {
            "reference_papers": True,
            "my_papers": True,
            "sessions": False,
            "web_cache": False,
        }

        self.log.info("Searching for '%s' (k=%d)", topic, max_papers)
        results = self._search(
            query=topic,
            k=max_papers,
            search_scope=search_scope,
            search_mode="both",
        )
        return {
            "query": topic,
            "results": results.get("results", []),
            "count": results.get("count", 0),
        }
