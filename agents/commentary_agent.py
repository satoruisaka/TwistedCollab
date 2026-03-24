"""
agents/commentary_agent.py - LLM-based commentary generator.

Receives fetched source content and generates structured commentary via Ollama.

Supports action:
  generate_commentary(fetched_source, commentary_focus, tone)
      → {report: str, sources: [...], source_count: int}
"""

from typing import Any, Dict

from agents.base_agent import BaseAgent

_TONE_INSTRUCTIONS: Dict[str, str] = {
    "analytical": "Analyze the content objectively, identifying structure, logic, key claims, and supporting evidence.",
    "critical":   "Critically evaluate the content, highlighting weaknesses, gaps, unsupported assumptions, and areas for improvement.",
    "supportive": "Highlight the strengths, insights, and positive value of the content.",
    "neutral":    "Summarize and comment on the content without taking a partisan stance.",
}

_COMMENTARY_TEMPLATE = """\
You are a thoughtful commentator. Generate insightful commentary on the source content below.

{focus_instruction}\
Tone: {tone_instruction}

--- SOURCE: {source_label} ---
{content}
--- END SOURCE ---

Write your commentary with ALL of the following sections:

1. **Overview** (2-3 sentences summarizing what this content is about)
2. **Key Points** (bullet list of the most important ideas or claims)
3. **Commentary** (your substantive analysis or observations, consistent with the requested tone)
4. **Connections & Implications** (how this content relates to broader ideas, or what it suggests for practice or research)
5. **Questions Raised** (open questions or areas worth exploring further)

Be specific and reference particular passages where relevant.\
"""


class CommentaryAgent(BaseAgent):
    role = "commentary_agent"

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "generate_commentary":
            return self._generate_commentary(inputs)
        raise ValueError(f"CommentaryAgent: unknown action '{action}'")

    # ------------------------------------------------------------------

    def _generate_commentary(self, inputs: Dict) -> Dict:
        fetched = inputs.get("fetched_source", {})
        if isinstance(fetched, dict):
            content      = fetched.get("content", "")
            source_label = fetched.get("source_label", "Unknown source")
            truncated    = fetched.get("truncated", False)
        else:
            content, source_label, truncated = str(fetched), "Unknown source", False

        if not content:
            return {
                "report": "No content was provided for commentary.",
                "sources": [],
                "source_count": 0,
            }

        tone             = (inputs.get("tone") or "analytical").strip()
        tone_instruction = _TONE_INSTRUCTIONS.get(tone, _TONE_INSTRUCTIONS["analytical"])
        focus            = (inputs.get("commentary_focus") or "").strip()
        focus_instruction = f"Focus specifically on: {focus}\n" if focus else ""

        prompt = _COMMENTARY_TEMPLATE.format(
            focus_instruction=focus_instruction,
            tone_instruction=tone_instruction,
            source_label=source_label,
            content=content,
        )

        self.log.info("Generating commentary on '%s' (tone=%s)", source_label, tone)
        report = self._llm_chat(
            [{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=4000,
        )

        if truncated:
            report = "> ⚠️ Note: Source content was truncated to 12,000 characters.\n\n" + report

        return {
            "report": report,
            "sources": [{"filename": source_label, "relevance_score": 10.0}],
            "source_count": 1,
        }
