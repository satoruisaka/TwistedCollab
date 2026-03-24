"""
agents/source_fetch_agent.py - Reads a single source file for commentary.

Supports action:
  fetch_source(source_type, source_file, source_text)
      → {content: str, source_label: str, char_count: int, truncated: bool}

source_type values:
  text             - use source_text directly (paste)
  notes            - data/markdown/notes/
  user_uploads     - data/markdown/user_uploads/
  skills           - data/markdown/skills/
  news_articles    - data/markdown/news_articles/
  twistednews      - data/markdown/twistednews/
  reference_papers - data/markdown/reference_papers/
  my_papers        - data/markdown/my_papers/
  sessions         - data/sessions/  (JSON → extracted as readable text)
"""

import json
from pathlib import Path
from typing import Any, Dict

from agents.base_agent import BaseAgent

_SOURCE_DIRS: Dict[str, str] = {
    "notes":            "data/markdown/notes",
    "user_uploads":     "data/markdown/user_uploads",
    "skills":           "data/markdown/skills",
    "news_articles":    "data/markdown/news_articles",
    "twistednews":      "data/markdown/twistednews",
    "reference_papers": "data/markdown/reference_papers",
    "my_papers":        "data/markdown/my_papers",
    "sessions":         "data/sessions",
}

_PROJECT_ROOT = Path(__file__).parent.parent
MAX_CHARS = 12_000


class SourceFetchAgent(BaseAgent):
    role = "source_fetch_agent"

    def run_action(self, action: str, inputs: Dict[str, Any]) -> Any:
        if action == "fetch_source":
            return self._fetch_source(inputs)
        raise ValueError(f"SourceFetchAgent: unknown action '{action}'")

    # ------------------------------------------------------------------

    def _fetch_source(self, inputs: Dict) -> Dict:
        source_type = (inputs.get("source_type") or "text").strip()
        source_file = (inputs.get("source_file") or "").strip()
        source_text = (inputs.get("source_text") or "").strip()

        if source_type == "text":
            if not source_text:
                raise ValueError("source_text is required when source_type is 'text'")
            content = source_text
            label = "Pasted text"

        else:
            rel_dir = _SOURCE_DIRS.get(source_type)
            if not rel_dir:
                raise ValueError(f"Unknown source_type: '{source_type}'")
            if not source_file:
                raise ValueError(f"source_file is required for source_type '{source_type}'")

            # Security: reject path traversal attempts before resolving
            if "/" in source_file or "\\" in source_file or source_file.startswith("."):
                raise PermissionError(f"Invalid filename: '{source_file}'")

            file_path = (_PROJECT_ROOT / rel_dir / source_file).resolve()
            allowed_root = (_PROJECT_ROOT / rel_dir).resolve()
            try:
                file_path.relative_to(allowed_root)
            except ValueError:
                raise PermissionError(f"Access denied: '{source_file}'")

            if not file_path.exists():
                raise FileNotFoundError(f"Source file not found: {file_path.name}")

            raw = file_path.read_text(encoding="utf-8")

            if source_type == "sessions":
                # JSON session file → extract conversation as readable text
                try:
                    data = json.loads(raw)
                    messages = data.get("messages", data.get("exchanges", []))
                    parts = []
                    for m in messages:
                        role = m.get("role", m.get("type", ""))
                        text = m.get("content", m.get("text", ""))
                        if text:
                            parts.append(f"[{role}]: {text}")
                    content = "\n\n".join(parts) if parts else raw
                except json.JSONDecodeError:
                    content = raw
            else:
                content = raw

            label = f"{source_type}/{source_file}"

        truncated = False
        if len(content) > MAX_CHARS:
            content = content[:MAX_CHARS]
            truncated = True

        self.log.info("Fetched source '%s' (%d chars, truncated=%s)", label, len(content), truncated)
        return {
            "content": content,
            "source_label": label,
            "char_count": len(content),
            "truncated": truncated,
        }
