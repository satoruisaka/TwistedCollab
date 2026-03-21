"""
agents/web_discovery_agent.py - Web search discovery agent.

Calls POST /api/web-search on the TwistedCollab3 server.
Supports an optional site restriction (e.g. 'arxiv.org') that is prepended
to the query as 'site:<domain> <query>'.

Action:
  discover_sources(topic, num_results, site_filter)
      → {query, results: [{title, url, snippet, source}], count}
"""

from typing import Any, Dict, Optional
import requests

from agents.base_agent import BaseAgent


class WebDiscoveryAgent(BaseAgent):
    role = "web_discovery_agent"

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "discover_sources":
            return self._discover_sources(inputs)
        raise ValueError(f"WebDiscoveryAgent: unknown action '{action}'")

    # ------------------------------------------------------------------

    def _discover_sources(self, inputs: Dict) -> Dict:
        topic: str = inputs.get("topic") or inputs.get("query", "")
        num_results: int = min(int(inputs.get("num_results", 20)), 50)
        site_filter: str = inputs.get("site_filter", "").strip()

        query = f"site:{site_filter} {topic}" if site_filter else topic
        self.log.info("Web discovery: query='%s' num_results=%d", query, num_results)

        resp = requests.post(
            f"{self.server_url}/api/web-search",
            json={"query": query, "num_results": num_results, "use_cache": True},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()

        results = [
            {
                "title":   r.get("title", ""),
                "url":     r.get("url", ""),
                "snippet": r.get("snippet", ""),
                "source":  r.get("source", "web"),
            }
            for r in data.get("results", [])
        ]

        return {
            "query":   query,
            "results": results,
            "count":   len(results),
        }
