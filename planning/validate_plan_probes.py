"""Governance negative probes: every bypass attempt must be REJECTED by validate_plan.

Runs each mutation against an isolated temporary copy of the repository pack.
The real planning data is never modified. Any probe that unexpectedly passes
exits non-zero so CI fails.
"""
from __future__ import annotations

import json
from contextlib import ExitStack
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "planning"))
from validate_plan import run_validation  # noqa: E402

TEMPORARIES = ExitStack()
PACK_ROOTS = {"docs", "planning", "prompts", "contracts", "src", "tests", "scripts", "infra", ".github"}
ROOT_FILES = {"README.md", "README.en.md", "AGENTS.md", "PROGRESS.md", "package.json", "tsconfig.json", "tsconfig.scripts.json"}
SAFE_SUFFIXES = {".md", ".json", ".py", ".ts", ".tsx", ".mjs", ".cjs", ".sh", ".yml", ".yaml", ".sql", ".toml", ".svg", ".png", ".css"}


def fresh_copy(base: Path) -> Path:
    target = Path(TEMPORARIES.enter_context(tempfile.TemporaryDirectory(prefix="orbit-safe-probe-"))).resolve()
    if target.parent != Path(tempfile.gettempdir()).resolve():
        raise RuntimeError("Unexpected temporary directory target")
    repo = target / "repo"
    repo.mkdir()
    for source in base.iterdir():
        if source.is_file() and source.name in ROOT_FILES:
            shutil.copy2(source, repo / source.name)
        elif source.is_dir() and source.name in PACK_ROOTS and not source.is_symlink():
            def ignore(directory, names):
                excluded = []
                for name in names:
                    path = Path(directory) / name
                    if path.is_symlink() or name in {"node_modules", ".next", "__pycache__", "generated", "secrets", "credentials", "uploads", "attachments"} or name.startswith(".env"):
                        excluded.append(name)
                    elif path.is_file() and path.suffix not in SAFE_SUFFIXES:
                        excluded.append(name)
                return excluded
            shutil.copytree(source, repo / source.name, ignore=ignore)
    return repo


def load(root: Path, name: str):
    return json.loads((root / name).read_text(encoding="utf-8"))


def save(root: Path, name: str, document) -> None:
    (root / name).write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def expect_rejection(root: Path, probe: str, expected_error: str) -> None:
    outcome = run_validation(root)
    if outcome["result"] != "FAIL":
        raise AssertionError(f"probe {probe}: mutation was ACCEPTED (validator bypass remains)")
    if not any(expected_error in error for error in outcome["errors"]):
        raise AssertionError(f"probe {probe}: failed for the wrong reason; expected '{expected_error}' in {outcome['errors']}")


def probe_missing_taskids(base: Path) -> None:
    root = fresh_copy(base)
    registry = load(root, "planning/comprehensive-audit-2026-09-13.json")
    registry["entries"][0].pop("taskIds", None)
    save(root, "planning/comprehensive-audit-2026-09-13.json", registry)
    expect_rejection(root, "missing-taskIds", "lacks non-empty taskIds")


def probe_empty_taskids(base: Path) -> None:
    root = fresh_copy(base)
    registry = load(root, "planning/comprehensive-audit-2026-09-13.json")
    registry["entries"][0]["taskIds"] = []
    save(root, "planning/comprehensive-audit-2026-09-13.json", registry)
    expect_rejection(root, "empty-taskIds", "lacks non-empty taskIds")


def probe_unknown_task(base: Path) -> None:
    root = fresh_copy(base)
    registry = load(root, "planning/comprehensive-audit-2026-09-13.json")
    registry["entries"][0]["taskIds"] = ["ORB-999"]
    save(root, "planning/comprehensive-audit-2026-09-13.json", registry)
    expect_rejection(root, "unknown-task", "references unknown task")


def probe_open_entry_unreferenced(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    task = next(t for t in backlog["tasks"] if t["id"] == "ORB-020")
    task["openAuditGroups"] = [group for group in task["openAuditGroups"] if group != "CR-2.2"]
    save(root, "planning/backlog.json", backlog)
    expect_rejection(root, "open-entry-unreferenced", "Unresolved audit absent from task")


def probe_one_sided_link(base: Path) -> None:
    root = fresh_copy(base)
    registry = load(root, "planning/comprehensive-audit-2026-09-13.json")
    entry = next(e for e in registry["entries"] if e["id"] == "CR-2.2")
    entry["taskIds"] = [task for task in entry["taskIds"] if task != "ORB-020"]
    save(root, "planning/comprehensive-audit-2026-09-13.json", registry)
    expect_rejection(root, "one-sided-link", "does not reference back")


def probe_done_task_with_open_group(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    task = next(t for t in backlog["tasks"] if t["id"] == "ORB-021")
    task["status"] = "done"
    save(root, "planning/backlog.json", backlog)
    expect_rejection(root, "done-with-open-group", "Done task has unresolved audit groups")


def probe_illegal_states(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    backlog["tasks"][0]["status"] = "finished"
    backlog["milestones"][0]["status"] = "shipped"
    backlog["applicationStatus"] = "EVERYTHING_GREEN"
    save(root, "planning/backlog.json", backlog)
    expect_rejection(root, "illegal-task-status", "Invalid task state")
    expect_rejection(root, "illegal-milestone-status", "Invalid milestone state")
    expect_rejection(root, "illegal-application-status", "Unknown applicationStatus")


def probe_false_milestone_done(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    milestone = next(m for m in backlog["milestones"] if m["id"] == "M0")
    milestone["status"] = "done"
    task = next(t for t in backlog["tasks"] if t["id"] == "ORB-001")
    task["status"] = "review"
    save(root, "planning/backlog.json", backlog)
    expect_rejection(root, "false-milestone-done", "Done milestone has non-done tasks")


def probe_v1_complete_without_evidence(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    backlog["applicationStatus"] = "V1_RELEASE_ACCEPTANCE_COMPLETE"
    save(root, "planning/backlog.json", backlog)
    expect_rejection(root, "v1-complete-without-evidence", "claims V1 complete but not every V1 milestone is done")


def probe_open_subitem_masked(base: Path) -> None:
    root = fresh_copy(base)
    registry = load(root, "planning/final-audit-2026-09-13.json")
    entry = next(e for e in registry["entries"] if e["id"] == "F31")
    entry["subitems"][0]["status"] = "deferred"
    save(root, "planning/final-audit-2026-09-13.json", registry)
    expect_rejection(root, "open-subitem-masked", "Open subitem masked by closed parent")


def probe_stale_current_summary(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    backlog["latestReview"]["summary"] += "（过期摘要）"
    save(root, "planning/backlog.json", backlog)
    completed = subprocess.run(
        [sys.executable, str(root / "planning/current_status.py"), "--check"],
        capture_output=True, text=True, cwd=root,
    )
    if completed.returncode == 0:
        raise AssertionError("probe stale-summary: mutated summary was accepted by current_status.py --check")


def probe_release_relabel(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    next(m for m in backlog["milestones"] if m["id"] == "M6")["release"] = "V1.1"
    backlog["applicationStatus"] = "V1_RELEASE_ACCEPTANCE_COMPLETE"
    save(root, "planning/backlog.json", backlog)
    expect_rejection(root, "release-relabel", "Invalid milestone release")


def probe_sensitive_files(base: Path) -> None:
    sandbox = Path(TEMPORARIES.enter_context(tempfile.TemporaryDirectory(prefix="orbit-sentinel-")))
    (sandbox / "planning").mkdir()
    (sandbox / ".env.local").write_text("SYNTHETIC_ONLY=sentinel")
    (sandbox / "planning/.env.local").write_text("SYNTHETIC_ONLY=sentinel")
    (sandbox / "planning/local.key").write_text("SYNTHETIC_ONLY")
    (sandbox / "planning/sample.json").write_text("{}")
    copied = fresh_copy(sandbox)
    assert (copied / "planning/sample.json").exists()
    assert not list(copied.rglob(".env*")) and not list(copied.rglob("*.key"))


def probe_release_evidence(base: Path) -> None:
    root = fresh_copy(base)
    backlog = load(root, "planning/backlog.json")
    backlog["applicationStatus"] = "V1_RELEASE_ACCEPTANCE_COMPLETE"
    backlog["releaseAcceptance"] = {"currentRevisionCi": {"verified": False, "evidence": "not-run"}}
    save(root, "planning/backlog.json", backlog)
    expect_rejection(root, "release-evidence", "V1 release lacks verified evidence: currentRevisionCi")


PROBES = [
    ("release-evidence", probe_release_evidence),
    ("release-relabel", probe_release_relabel),
    ("sensitive-files-excluded", probe_sensitive_files),
    ("missing-taskIds", probe_missing_taskids),
    ("empty-taskIds", probe_empty_taskids),
    ("unknown-task", probe_unknown_task),
    ("open-entry-unreferenced", probe_open_entry_unreferenced),
    ("one-sided-link", probe_one_sided_link),
    ("done-with-open-group", probe_done_task_with_open_group),
    ("illegal-states", probe_illegal_states),
    ("false-milestone-done", probe_false_milestone_done),
    ("v1-complete-without-evidence", probe_v1_complete_without_evidence),
    ("open-subitem-masked", probe_open_subitem_masked),
    ("stale-current-summary", probe_stale_current_summary),
]


def main() -> None:
    # Positive control first: the untouched pack must pass, otherwise probes
    # prove nothing about the mutations.
    baseline = run_validation(ROOT)
    if baseline["result"] != "PASS":
        print(json.dumps({"result": "FAIL", "probe": "positive-control", "errors": baseline["errors"]}, ensure_ascii=True, indent=2))
        raise SystemExit(1)
    failures = []
    for name, probe in PROBES:
        try:
            probe(ROOT)
            print(f"probe {name}: rejected as expected")
        except AssertionError as exc:
            failures.append(f"{name}: {exc}")
            print(f"probe {name}: NOT REJECTED — {exc}")
    if failures:
        raise SystemExit(1)
    print(f"All {len(PROBES)} governance probes rejected their mutations; positive control passed.")


if __name__ == "__main__":
    try:
        main()
    finally:
        TEMPORARIES.close()
