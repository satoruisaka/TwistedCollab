"""
agents/orchestrator.py - Sequential workflow executor.

SkillOrchestrator drives workflow steps defined in a SkillDefinition,
passing outputs of earlier steps as inputs to later steps via a shared
context dict.  Only the 'sequential' pattern is implemented (parallel
and hierarchical are future extensions).
"""

import logging
from typing import Any, Callable, Dict, Optional

from skills.skill_schema import SkillDefinition

logger = logging.getLogger(__name__)


class SkillOrchestrator:
    """Executes a skill's workflow by coordinating agents sequentially."""

    def __init__(
        self,
        skill_def: SkillDefinition,
        server_url: str = "http://localhost:8000",
        session_id: Optional[str] = None,
        progress_callback: Optional[Callable[[Dict], None]] = None,
    ):
        self.skill_def = skill_def
        self.server_url = server_url
        self.session_id = session_id
        self.progress: list = []
        # Called after every step event: fn({"type": ..., "step": ..., ...})
        self._progress_callback = progress_callback

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, params: Dict[str, Any]) -> Dict:
        """Execute all workflow steps and return a result dict.

        Always returns a dict; errors are captured as
        {"status": "error", "error": "..."} rather than raised.
        """
        try:
            return self._run_sequential(params)
        except Exception as exc:
            logger.exception("Orchestrator error in skill '%s'", self.skill_def.name)
            return {
                "status": "error",
                "skill": self.skill_def.name,
                "error": str(exc),
                "progress": self.progress,
            }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run_sequential(self, params: Dict[str, Any]) -> Dict:
        from agents.registry import AgentRegistry

        # context accumulates params + step outputs
        context: Dict[str, Any] = dict(params)

        steps = self.skill_def.workflow.get("steps", [])
        total = len(steps)
        for step in steps:
            step_num = step["step"]
            agent_role = step["agent"]
            action = step["action"]
            output_key = step["output"]

            entry = {"step": step_num, "agent": agent_role, "action": action, "status": "running"}
            self.progress.append(entry)
            self._emit({"type": "step_start", "step": step_num, "total": total,
                        "agent": agent_role, "action": action})
            logger.info(
                "Step %d/%d  agent=%s  action=%s",
                step_num,
                total,
                agent_role,
                action,
            )

            # Resolve inputs: pass full context + any explicit input_mapping overrides
            inputs = self._resolve_inputs(step, context)

            # Instantiate agent fresh for each step
            agent = AgentRegistry.create(
                role=agent_role,
                server_url=self.server_url,
                session_id=self.session_id,
            )

            step_result = agent.run(action, inputs)
            context[output_key] = step_result
            self.progress[-1]["status"] = "completed"
            self._emit({"type": "step_complete", "step": step_num, "total": total,
                        "agent": agent_role, "action": action, "output_key": output_key})

        # Final output is the output_key of the last step
        final_key = steps[-1]["output"] if steps else None
        final_result = context.get(final_key) if final_key else context

        outcome = {
            "status": "completed",
            "skill": self.skill_def.name,
            "result": final_result,
            "progress": self.progress,
        }
        self._emit({"type": "done", **outcome})
        return outcome

    def _emit(self, event: Dict) -> None:
        """Fire progress_callback if one was provided."""
        if self._progress_callback is not None:
            try:
                self._progress_callback(event)
            except Exception:
                pass  # never let a callback kill the orchestrator

    @staticmethod
    def _resolve_inputs(step: Dict, context: Dict) -> Dict:
        """Build the inputs dict for a step.

        Starts with the full context, then applies any explicit
        input_mapping where values are {{variable}} templates resolved
        from context.
        """
        inputs = dict(context)
        for key, template in step.get("input_mapping", {}).items():
            if (
                isinstance(template, str)
                and template.startswith("{{")
                and template.endswith("}}")
            ):
                var_name = template[2:-2].strip()
                inputs[key] = context.get(var_name, template)
            else:
                inputs[key] = template
        return inputs
