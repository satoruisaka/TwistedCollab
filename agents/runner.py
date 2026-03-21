"""
agents/runner.py - Async-capable skill job queue.

SkillRunner.submit() returns a job_id immediately.
Execution happens in a daemon background thread that spawns a subprocess
(agents/worker.py) with OS resource limits applied inside the child.

Job results are stored in-memory (local-first, single-process server).

Usage from server.py:
    runner = get_runner()
    job_id = runner.submit("literature_review", {"topic": "AI safety"})
    # ... later ...
    job = runner.get_job(job_id)
    print(job.status, job.result)
"""

import json
import logging
import subprocess
import sys
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"


@dataclass
class SkillJob:
    job_id: str
    skill_name: str
    params: Dict[str, Any]
    session_id: Optional[str]
    status: JobStatus = JobStatus.PENDING
    result: Optional[Dict] = None
    error: Optional[str] = None
    progress: List[Dict] = field(default_factory=list)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            "job_id": self.job_id,
            "skill_name": self.skill_name,
            "params": self.params,
            "session_id": self.session_id,
            "status": self.status.value,
            "result": self.result,
            "error": self.error,
            "progress": self.progress,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }


class SkillRunner:
    """Manages skill job submissions and subprocess execution."""

    def __init__(self, server_url: str = "http://localhost:8000"):
        self._jobs: Dict[str, SkillJob] = {}
        self._lock = threading.Lock()
        self.server_url = server_url
        # Project root = parent of agents/
        self._root = str(Path(__file__).parent.parent)
        self._python = sys.executable

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def submit(
        self,
        skill_name: str,
        params: Dict[str, Any],
        session_id: Optional[str] = None,
    ) -> str:
        """Validate, enqueue, and start async execution.  Returns job_id."""
        from skills.skill_registry import SkillRegistry

        skill_def = SkillRegistry.get(skill_name)
        if skill_def is None:
            raise ValueError(f"Unknown skill: '{skill_name}'")

        validated_params = skill_def.validate_params(params)

        job_id = uuid.uuid4().hex[:12]
        job = SkillJob(
            job_id=job_id,
            skill_name=skill_name,
            params=validated_params,
            session_id=session_id,
        )

        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(target=self._execute, args=(job,), daemon=True)
        thread.start()

        logger.info("Submitted skill job %s: %s", job_id, skill_name)
        return job_id

    def get_job(self, job_id: str) -> Optional[SkillJob]:
        return self._jobs.get(job_id)

    def list_jobs(self) -> List[Dict]:
        return [j.to_dict() for j in self._jobs.values()]

    # ------------------------------------------------------------------
    # Background execution
    # ------------------------------------------------------------------

    def _execute(self, job: SkillJob) -> None:
        """Runs in a daemon thread.  Spawns subprocess and waits for result."""
        job.status = JobStatus.RUNNING
        job.started_at = datetime.now().isoformat()

        # Determine timeout from skill definition
        from skills.skill_registry import SkillRegistry

        skill_def = SkillRegistry.get(job.skill_name)
        timeout = (
            skill_def.security.get("max_execution_time", 300) if skill_def else 300
        )

        cmd = [
            self._python,
            "-m",
            "agents.worker",
            "--skill",
            job.skill_name,
            "--params",
            json.dumps(job.params),
            "--server-url",
            self.server_url,
        ]
        if job.session_id:
            cmd += ["--session-id", job.session_id]

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=self._root,
            )
            stdout, stderr = proc.communicate(timeout=timeout)

            if proc.returncode == 0 and stdout.strip():
                try:
                    data = json.loads(stdout.strip())
                    # Hoist progress out of result dict
                    job.progress = data.pop("progress", [])
                    job.result = data
                    job.status = JobStatus.COMPLETED
                    logger.info("Job %s completed", job.job_id)
                except json.JSONDecodeError:
                    job.error = f"Worker returned non-JSON output: {stdout[:300]}"
                    job.status = JobStatus.FAILED
            else:
                job.error = (stderr or stdout or "Worker exited non-zero")[:2000]
                job.status = JobStatus.FAILED
                logger.error("Job %s failed: %s", job.job_id, job.error)

        except subprocess.TimeoutExpired:
            proc.kill()
            job.status = JobStatus.TIMEOUT
            job.error = f"Skill timed out after {timeout}s"
            logger.warning("Job %s timed out", job.job_id)

        except Exception as exc:
            job.status = JobStatus.FAILED
            job.error = str(exc)
            logger.exception("Job %s unexpected error", job.job_id)

        finally:
            job.completed_at = datetime.now().isoformat()


# ------------------------------------------------------------------
# Module-level singleton
# ------------------------------------------------------------------

_runner: Optional[SkillRunner] = None


def get_runner(server_url: str = "http://localhost:8000") -> SkillRunner:
    """Return (or lazily create) the module-level SkillRunner singleton."""
    global _runner
    if _runner is None:
        _runner = SkillRunner(server_url=server_url)
    return _runner
