"""
agents/ - Multi-agent skill execution system for TwistedCollab3.

Architecture:
  BaseAgent       - Abstract base; all agents make HTTP calls to the
                    TwistedCollab3 /api/search and Ollama /api/chat.
  AgentRegistry   - Maps role names → agent classes (register_all_agents).
  SkillOrchestrator - Executes a skill's sequential workflow steps.
  SkillRunner     - Manages job queue; spawns subprocess per skill run
                    with RLIMIT_CPU resource limits applied by the worker.
  worker          - Subprocess entry point (python -m agents.worker).
  
Concrete agents:
  SearchAgent         - FAISS + keyword search via /api/search.
  FilterAgent         - LLM-based relevance scoring via Ollama.
  SummarizationAgent  - LLM synthesis via Ollama.
  WebDiscoveryAgent   - Web search via /api/web-search (supports site: filter).
  ExtractionAgent     - LLM-based source ranking and annotation.
"""

from agents.registry import AgentRegistry, register_all_agents
from agents.runner import SkillRunner, SkillJob, JobStatus, get_runner

__all__ = [
    "AgentRegistry",
    "register_all_agents",
    "SkillRunner",
    "SkillJob",
    "JobStatus",
    "get_runner",
]
