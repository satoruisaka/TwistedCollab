"""
agents/summarization_agent.py - LLM literature synthesis agent.

Receives the top-ranked filtered results and asks Ollama to produce a
structured academic literature review.

Supports action:
  synthesize(topic, filtered_results, top_n)
      →  {report: str, sources: [...], source_count: int}
"""

from typing import Any, Dict, List

from agents.base_agent import BaseAgent


_REVIEW_TEMPLATE = """\
Write a comprehensive literature review on the topic: '{topic}'

Base your review on the {n} sources provided below.
Cite sources using their index numbers [1], [2], etc.

--- SOURCES ---
{sources_text}
--- END SOURCES ---

Structure your review with ALL of these sections:
1. Executive Summary  (2-3 sentences)
2. Key Themes and Findings  (group related ideas, cite sources)
3. Synthesis and Connections  (how sources relate / agree / disagree)
4. Gaps and Future Research Directions
5. Conclusion

Write in clear academic prose. Be specific and cite sources throughout.\
"""


class SummarizationAgent(BaseAgent):
    role = "summarization_agent"

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "synthesize":
            return self._synthesize(inputs)
        raise ValueError(f"SummarizationAgent: unknown action '{action}'")

    # ------------------------------------------------------------------

    def _synthesize(self, inputs: Dict) -> Dict:
        topic: str = inputs.get("topic", "")

        # filtered_results may be the raw dict from FilterAgent output
        filtered_data = inputs.get("filtered_results", {})
        if isinstance(filtered_data, dict):
            filtered_results: List[Dict] = filtered_data.get("filtered_results", [])
        elif isinstance(filtered_data, list):
            filtered_results = filtered_data
        else:
            filtered_results = []

        # Cap source list to avoid exceeding context window
        sources = filtered_results[:15]

        if not sources:
            self.log.warning("No sources to synthesize")
            return {"report": "No relevant literature found for this topic.", "sources": [], "source_count": 0}

        # Build numbered source block
        source_parts: List[str] = []
        source_meta: List[Dict] = []
        for i, result in enumerate(sources, start=1):
            text = result.get("text", "")[:600]
            filename = result.get("filename", "Unknown")
            relevance = result.get("relevance_score", 0.0)
            source_parts.append(
                f"[{i}] {filename} (relevance: {relevance:.1f})\n{text}"
            )
            source_meta.append({"index": i, "filename": filename, "relevance_score": relevance})

        sources_text = "\n\n".join(source_parts)
        prompt = _REVIEW_TEMPLATE.format(
            topic=topic, n=len(sources), sources_text=sources_text
        )

        self.log.info("Synthesizing review for '%s' from %d sources", topic, len(sources))
        report = self._llm_chat(
            [{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=8000,
        )

        return {
            "report": report,
            "sources": source_meta,
            "source_count": len(sources),
        }
