"""
agents/extraction_agent.py - LLM-based source extraction and ranking agent.

Given a list of raw web results, uses the LLM to:
  1. Assess relevance to the research topic.
  2. Extract key metadata (authors, year, venue if detectable from snippet).
  3. Return a ranked, deduplicated source list with a brief annotation.

Action:
  extract_sources(topic, raw_results, top_n)
      → {sources: [{rank, title, url, annotation, relevance_score}], topic, count}
"""

import json
import re
from typing import Any, Dict, List

from agents.base_agent import BaseAgent


_EXTRACT_TEMPLATE = """\
You are a research librarian. Given a research topic and a list of web search \
results, your task is to:

1. Score each result's relevance to the topic (0–10).
2. Write a one-sentence annotation explaining what the source covers.
3. Return ONLY a valid JSON array — no markdown, no extra text.

Topic: {topic}

Search results (JSON array):
{results_json}

Return a JSON array of objects, one per result, in this exact schema:
[
  {{
    "index": <original 0-based index>,
    "title": "<title>",
    "url": "<url>",
    "relevance_score": <float 0-10>,
    "annotation": "<one sentence>"
  }},
  ...
]

Sort by relevance_score descending. Include only the top {top_n} results.
Return ONLY the JSON array.
"""


class ExtractionAgent(BaseAgent):
    role = "extraction_agent"

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "extract_sources":
            return self._extract_sources(inputs)
        raise ValueError(f"ExtractionAgent: unknown action '{action}'")

    # ------------------------------------------------------------------

    def _extract_sources(self, inputs: Dict) -> Dict:
        topic: str = inputs.get("topic", "")
        raw: List[Dict] = inputs.get("raw_results", {}).get("results", []) \
            if isinstance(inputs.get("raw_results"), dict) \
            else inputs.get("raw_results", [])
        top_n: int = int(inputs.get("top_n", 15))

        if not raw:
            return {"sources": [], "topic": topic, "count": 0}

        # Trim snippets to keep the prompt manageable
        trimmed = [
            {"index": i, "title": r.get("title", ""), "url": r.get("url", ""),
             "snippet": r.get("snippet", "")[:300]}
            for i, r in enumerate(raw)
        ]

        prompt = _EXTRACT_TEMPLATE.format(
            topic=topic,
            results_json=json.dumps(trimmed, indent=2),
            top_n=top_n,
        )

        raw_response = self._llm_chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4000,
        )

        sources = self._parse_sources(raw_response, raw)
        self.log.info("Extracted %d sources for topic '%s'", len(sources), topic)

        return {"sources": sources, "topic": topic, "count": len(sources)}

    # ------------------------------------------------------------------

    def _parse_sources(self, llm_text: str, original: List[Dict]) -> List[Dict]:
        """Parse the LLM JSON response; fall back gracefully on bad output."""
        # Strip markdown code fences if present
        cleaned = re.sub(r"```(?:json)?", "", llm_text).strip().strip("`")

        # Find the JSON array
        m = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if not m:
            self.log.warning("ExtractionAgent: no JSON array found in LLM output")
            # Fallback: return raw results with empty annotations
            return [
                {"rank": i + 1, "title": r.get("title", ""), "url": r.get("url", ""),
                 "annotation": r.get("snippet", "")[:150], "relevance_score": 0.0}
                for i, r in enumerate(original[:15])
            ]

        try:
            items = json.loads(m.group(0))
        except json.JSONDecodeError as exc:
            self.log.warning("ExtractionAgent: JSON parse error: %s", exc)
            return [
                {"rank": i + 1, "title": r.get("title", ""), "url": r.get("url", ""),
                 "annotation": r.get("snippet", "")[:150], "relevance_score": 0.0}
                for i, r in enumerate(original[:15])
            ]

        sources = []
        for rank, item in enumerate(items, start=1):
            orig_idx = item.get("index", 0)
            orig = original[orig_idx] if 0 <= orig_idx < len(original) else {}
            sources.append({
                "rank":            rank,
                "title":           item.get("title") or orig.get("title", ""),
                "url":             item.get("url")   or orig.get("url", ""),
                "annotation":      item.get("annotation", ""),
                "relevance_score": float(item.get("relevance_score", 0)),
            })

        return sources
