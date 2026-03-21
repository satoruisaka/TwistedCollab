"""
skills/ - Skill definition registry.

Skills are defined as YAML files in this directory.
Load all skills:  SkillRegistry.list_all()
Get one skill:    SkillRegistry.get("literature_review")
"""

from skills.skill_schema import SkillDefinition, ParameterSpec
from skills.skill_registry import SkillRegistry

__all__ = ["SkillDefinition", "ParameterSpec", "SkillRegistry"]
