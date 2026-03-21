"""
agents/registry.py - Agent type registry.

Maps role name strings → agent classes.
Call register_all_agents() once at worker startup to load all built-ins.
"""

from typing import Dict, Optional, Type

from agents.base_agent import BaseAgent


class AgentRegistry:
    """Singleton registry: role_name → agent class."""

    _registry: Dict[str, Type[BaseAgent]] = {}

    @classmethod
    def register(cls, agent_class: Type[BaseAgent]) -> Type[BaseAgent]:
        """Register *agent_class* by its .role attribute.  Returns the class
        unchanged so it can be used as a decorator."""
        cls._registry[agent_class.role] = agent_class
        return agent_class

    @classmethod
    def create(cls, role: str, **kwargs) -> BaseAgent:
        """Instantiate an agent by role name, forwarding **kwargs to __init__."""
        if role not in cls._registry:
            raise ValueError(
                f"Unknown agent role '{role}'. "
                f"Registered roles: {list(cls._registry.keys())}"
            )
        return cls._registry[role](**kwargs)

    @classmethod
    def list_roles(cls) -> list:
        return list(cls._registry.keys())


def register_all_agents() -> None:
    """Import and register every built-in agent type.
    Call this once at subprocess startup (worker.py)."""
    from agents.search_agent import SearchAgent
    from agents.filter_agent import FilterAgent
    from agents.summarization_agent import SummarizationAgent
    from agents.web_discovery_agent import WebDiscoveryAgent
    from agents.extraction_agent import ExtractionAgent

    AgentRegistry.register(SearchAgent)
    AgentRegistry.register(FilterAgent)
    AgentRegistry.register(SummarizationAgent)
    AgentRegistry.register(WebDiscoveryAgent)
    AgentRegistry.register(ExtractionAgent)
