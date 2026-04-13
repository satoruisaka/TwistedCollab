#!/usr/bin/env python3
"""
One-time migration: consolidate old-format session files into canonical naming.

Old format: {UUID}_{YYYYMMDD}_{HHMMSS}.json  (one file per LLM turn)
New format: {YYYYMMDD}_{uuid8}.json           (one canonical file per session)

Steps per session group:
  1. Pick the latest partial file (most complete history).
  2. Derive canonical name from JSON fields: created_at + session_id[:8].
  3. Write canonical file (skip if already exists).
  4. Delete all old partial files for that session.

Safe to run multiple times — skips sessions that already have a canonical file.
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SESSIONS_DIR = Path(__file__).parent / "data" / "sessions"
OLD_PATTERN = re.compile(
    r'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(\d{8})_(\d{6})\.json$',
    re.IGNORECASE
)
CANONICAL_PATTERN = re.compile(r'^\d{8}_[0-9a-f]{8}\.json$', re.IGNORECASE)


def canonical_name(session_id: str, created_at: str) -> str:
    """Return canonical filename stem, e.g. '20260321_023ff434'."""
    date_str = created_at[:10].replace('-', '')
    uuid8 = session_id[:8]
    return f"{date_str}_{uuid8}.json"


def migrate(dry_run: bool = False, verbose: bool = False) -> None:
    if not SESSIONS_DIR.exists():
        print(f"Sessions directory not found: {SESSIONS_DIR}")
        sys.exit(1)

    # Group old-format files by UUID
    groups: dict[str, list[Path]] = defaultdict(list)
    already_canonical = 0

    for f in SESSIONS_DIR.glob("*.json"):
        if CANONICAL_PATTERN.match(f.name):
            already_canonical += 1
            continue
        m = OLD_PATTERN.match(f.name)
        if m:
            groups[m.group(1)].append(f)
        else:
            if verbose:
                print(f"  [skip] Unrecognised filename: {f.name}")

    print(f"Found {len(groups)} session groups to migrate, {already_canonical} already canonical.")
    if not groups:
        print("Nothing to do.")
        return

    stats = {"written": 0, "skipped": 0, "deleted": 0, "errors": 0}

    for uuid, files in sorted(groups.items()):
        # Sort by filename timestamp; last = most complete
        files.sort(key=lambda p: p.name)
        latest = files[-1]

        try:
            with open(latest, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
        except Exception as e:
            print(f"  [ERROR] Could not read {latest.name}: {e}")
            stats["errors"] += 1
            continue

        sid = data.get("session_id", uuid)
        created = data.get("created_at", "19700101T000000")
        target = SESSIONS_DIR / canonical_name(sid, created)

        if target.exists():
            if verbose:
                print(f"  [skip]  {target.name} already exists")
            stats["skipped"] += 1
        else:
            if verbose or dry_run:
                print(f"  [write] {latest.name} -> {target.name}  ({len(files)} partial files)")
            if not dry_run:
                target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            stats["written"] += 1

        # Delete all old partial files for this session
        for old_file in files:
            if verbose or dry_run:
                print(f"    [delete] {old_file.name}")
            if not dry_run:
                old_file.unlink()
            stats["deleted"] += 1

    action = "Would migrate" if dry_run else "Migrated"
    print(f"\n{action}: {stats['written']} sessions written, "
          f"{stats['skipped']} skipped, "
          f"{stats['deleted']} old files deleted, "
          f"{stats['errors']} errors.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Migrate TwistedCollab session files to canonical naming.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without changing anything.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print every file operation.")
    args = parser.parse_args()

    if args.dry_run:
        print("DRY RUN — no files will be written or deleted.\n")

    migrate(dry_run=args.dry_run, verbose=args.verbose)
