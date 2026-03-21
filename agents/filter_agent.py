"""
agents/filter_agent.py - LLM-based relevance filtering agent.

Scores each retrieved result against the research topic using a fast
Ollama inference call, then returns the top-N results.

Supports action:
  filter_by_relevance(topic, raw_results, top_n)
      →  {filtered_results: [...], topic: str}
"""

from typing import Any, Dict, List

from agents.base_agent import BaseAgent


class FilterAgent(BaseAgent):
    role = "filter_agent"

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "filter_by_relevance":
            return self._filter_by_relevance(inputs)
        raise ValueError(f"FilterAgent: unknown action '{action}'")

    # ------------------------------------------------------------------

    def _filter_by_relevance(self, inputs: Dict) -> Dict:
        topic: str = inputs.get("topic", "")
        raw_results: Dict = inputs.get("raw_results", {})
        results: List[Dict] = raw_results.get("results", [])
        top_n: int = int(inputs.get("top_n", 10))

        if not results:
            self.log.warning("No results to filter")
            return {"filtered_results": [], "topic": topic}

        self.log.info("Scoring %d results for relevance to '%s'", len(results), topic)

        scored: List[Dict] = []
        for result in results:
            text = result.get("text", "")[:800]
            score = self._score_relevance(text, topic)
            scored.append({**result, "relevance_score": score})

        scored.sort(key=lambda x: x.get("relevance_score", 0.0), reverse=True)
        filtered = scored[:top_n]

        self.log.info(
            "Filtered to %d results (top score=%.1f)",
            len(filtered),
            filtered[0]["relevance_score"] if filtered else 0.0,
        )
        return {"filtered_results": filtered, "topic": topic}

    def _score_relevance(self, text: str, topic: str) -> float:
        """Ask Ollama to rate relevance 0-10. Fast, low-temperature call."""
        prompt = (
            f"Rate how relevant the following text is to the research topic "
            f"'{topic}' on a scale of 0 to 10.\n"
            f"Reply with ONLY a single integer or decimal number (e.g. '7' or '6.5').\n\n"
            f"Text:\n{text}"
        )
        try:
            response = self._llm_chat(
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=10,
            )
            return self._extract_number(response)
        except Exception as exc:
            self.log.warning("Relevance scoring failed: %s", exc)
            return 5.0  # neutral default on failure
