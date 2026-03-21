"""
agents/worker.py - Subprocess entry point for skill execution.

Usage (spawned by SkillRunner):
    python -m agents.worker \\
        --skill literature_review \\
        --params '{"topic": "quantum computing"}' \\
        --server-url http://localhost:8000

Behaviour:
  1. Parse CLI args.
  2. Load the skill definition from the YAML registry.
  3. Apply RLIMIT_CPU resource limit (best-effort, non-fatal).
  4. Register all built-in agent types.
  5. Run SkillOrchestrator and print the JSON result to stdout.

The parent process (SkillRunner._execute) reads stdout and parses it.
All logging goes to stderr so it does not corrupt the JSON result.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

# Ensure the project root (TwistedCollab3/) is importable regardless of
# the working directory the subprocess is started from.
sys.path.insert(0, str(Path(__file__).parent.parent))

# Suppress noisy INFO logs from sub-modules; only WARNING+ reaches stderr.
logging.basicConfig(
    level=logging.WARNING,
    format="%(levelname)s %(name)s: %(message)s",
    stream=sys.stderr,
)


def _apply_resource_limits(max_cpu_seconds: int, max_memory_mb: int) -> None:
    """Apply OS resource limits to this process (best-effort)."""
    try:
        import resource

        # CPU time: hard limit = soft + 60 s grace period
        resource.setrlimit(
            resource.RLIMIT_CPU,
            (max_cpu_seconds, max_cpu_seconds + 60),
        )
    except Exception as exc:
        print(f"Warning: could not set CPU limit: {exc}", file=sys.stderr)

    try:
        import resource

        # Virtual address space: 4× the logical memory cap gives enough
        # headroom for the Python runtime while still bounding runaway allocs.
        mem_bytes = max_memory_mb * 1024 * 1024 * 4
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        if hard == resource.RLIM_INFINITY or hard > mem_bytes:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, resource.RLIM_INFINITY))
    except Exception as exc:
        print(f"Warning: could not set memory limit: {exc}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="TwistedCollab3 skill worker")
    parser.add_argument("--skill", required=True, help="Skill name (matches YAML filename)")
    parser.add_argument("--params", required=True, help="JSON-encoded skill parameters")
    parser.add_argument(
        "--server-url",
        default="http://localhost:8000",
        help="TwistedCollab3 server base URL (for /api/search calls)",
    )
    parser.add_argument("--session-id", default=None, help="Active session ID (optional)")
    args = parser.parse_args()

    # --- parse params ---
    try:
        params = json.loads(args.params)
    except json.JSONDecodeError as exc:
        _fail(f"Invalid --params JSON: {exc}")

    # --- load skill definition ---
    from skills.skill_registry import SkillRegistry

    skill_def = SkillRegistry.get(args.skill)
    if skill_def is None:
        _fail(f"Skill '{args.skill}' not found in registry")

    # --- resource limits from skill security config ---
    security = skill_def.security or {}
    _apply_resource_limits(
        max_cpu_seconds=security.get("max_execution_time", 300),
        max_memory_mb=security.get("max_memory_mb", 512),
    )

    # --- register agents ---
    from agents.registry import register_all_agents

    register_all_agents()

    # --- run orchestrator ---
    from agents.orchestrator import SkillOrchestrator

    orchestrator = SkillOrchestrator(
        skill_def=skill_def,
        server_url=args.server_url,
        session_id=args.session_id,
    )
    result = orchestrator.run(params)

    # Output JSON result to stdout (parent reads this)
    print(json.dumps(result))
    sys.exit(0)


def _fail(message: str) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(1)


if __name__ == "__main__":
    main()
