"""
skills/skill_schema.py - Pydantic models for skill YAML definitions.

Every *.yaml file in the skills/ directory must conform to SkillDefinition.

Example minimal YAML:
    name: my_skill
    version: "1.0"
    description: "Does something useful"
    parameters:
      query:
        type: str
        required: true
        description: "Search query"
    agents:
      - role: search_agent
        name: "Searcher"
    workflow:
      pattern: sequential
      steps:
        - step: 1
          agent: search_agent
          action: search_literature
          output: raw_results
    security:
      max_execution_time: 300
      max_memory_mb: 512
      allowed_tools: [faiss_search, ollama_llm]
      file_access: none
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ParameterSpec(BaseModel):
    type: str
    required: bool = True
    default: Optional[Any] = None
    description: str = ""
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    allowed_values: Optional[List[str]] = None


class AgentRole(BaseModel):
    role: str
    name: str


class WorkflowStep(BaseModel):
    step: int
    agent: str
    action: str
    output: str
    input_mapping: Optional[Dict[str, str]] = None


class SkillDefinition(BaseModel):
    name: str
    version: str
    description: str
    parameters: Dict[str, ParameterSpec] = Field(default_factory=dict)
    agents: List[AgentRole] = Field(default_factory=list)
    workflow: Dict[str, Any] = Field(default_factory=dict)
    security: Dict[str, Any] = Field(default_factory=dict)

    def get_default_params(self) -> Dict[str, Any]:
        """Return a dict of parameter_name → default_value for params that have defaults."""
        return {
            name: spec.default
            for name, spec in self.parameters.items()
            if spec.default is not None
        }

    def validate_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Merge user-supplied params with defaults and check required fields.

        Raises ValueError if a required parameter is missing.
        Returns the merged parameter dict.
        """
        merged = {**self.get_default_params(), **params}
        for name, spec in self.parameters.items():
            if spec.required and name not in merged:
                raise ValueError(
                    f"Skill '{self.name}': missing required parameter '{name}'"
                )
        return merged
