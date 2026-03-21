"""
skills/skill_registry.py - Loads and caches skill definitions from YAML files.

All *.yaml files in the skills/ directory are auto-loaded on first access.
"""

import logging
from pathlib import Path
from typing import Dict, Optional

import yaml

from skills.skill_schema import SkillDefinition

logger = logging.getLogger(__name__)

_SKILLS_DIR = Path(__file__).parent


class SkillRegistry:
    """Lazy-loading, file-based registry for skill definitions."""

    _skills: Dict[str, SkillDefinition] = {}
    _loaded: bool = False

    # ------------------------------------------------------------------

    @classmethod
    def _load_all(cls) -> None:
        if cls._loaded:
            return
        for yaml_path in _SKILLS_DIR.glob("*.yaml"):
            try:
                with open(yaml_path, encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                skill = SkillDefinition(**data)
                cls._skills[skill.name] = skill
                logger.debug("Loaded skill '%s' from %s", skill.name, yaml_path.name)
            except Exception as exc:
                logger.warning("Failed to load skill from %s: %s", yaml_path.name, exc)
        cls._loaded = True

    @classmethod
    def get(cls, name: str) -> Optional[SkillDefinition]:
        cls._load_all()
        return cls._skills.get(name)

    @classmethod
    def list_all(cls) -> Dict[str, SkillDefinition]:
        cls._load_all()
        return dict(cls._skills)

    @classmethod
    def reload(cls) -> None:
        """Force re-read of all YAML files (useful during development)."""
        cls._loaded = False
        cls._skills = {}
        cls._load_all()
