"""Validate the planning pack only. This is not an application test suite."""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import unquote

# Governance invariants are constants in this validator, deliberately NOT read
# from the user-editable backlog: the checked data must not define its own rules.
TASK_STATUSES = {"todo", "in_progress", "review", "done", "blocked"}
MILESTONE_STATUSES = {"todo", "in_progress", "review", "done"}
AUDIT_STATUSES = {"fixed", "accepted_design", "not_reproduced", "pending", "in_progress", "blocked_external", "deferred"}
OPEN_AUDIT_STATUSES = {"pending", "in_progress", "blocked_external", "deferred"}
CLOSED_AUDIT_STATUSES = {"fixed", "accepted_design", "not_reproduced"}
APPLICATION_STATUSES = {
    "PLANNING",
    "LOCAL_VERIFIED",
    "V1_RELEASE_ACCEPTANCE_PENDING",
    "V1_RELEASE_ACCEPTANCE_COMPLETE",
}
V1_COMPLETE_STATUS = "V1_RELEASE_ACCEPTANCE_COMPLETE"

IGNORED_DIRS = {".git", ".next", "node_modules"}


def is_ignored(path: Path, root: Path) -> bool:
    return any(part in IGNORED_DIRS for part in path.relative_to(root).parts)


def resolve_ref(document, reference):
    value = document
    for part in reference.removeprefix("#/").split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def walk(value, path="$"):
    yield path, value
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk(item, f"{path}[{index}]")


def run_validation(root: Path) -> dict:
    errors: list[str] = []
    checks: list[str] = []

    def require(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)

    scan_roots = [root / name for name in ("docs", "planning", "prompts", "contracts", "src", "tests", "scripts", "infra", ".github")]

    def pack_files(pattern):
        files = list(root.glob(pattern))
        for directory in scan_roots:
            if directory.is_dir():
                files.extend(file for file in directory.rglob(pattern) if not is_ignored(file, root))
        return sorted(set(files))

    markdown_files = pack_files("*.md")
    local_links = 0
    for file in markdown_files:
        content = file.read_text(encoding="utf-8")
        require("\ufffd" not in content, f"Replacement character in {file.relative_to(root)}")
        for raw_target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
            target = raw_target.strip().strip("<>").split("#", 1)[0]
            if not target or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                continue
            target_path = (file.parent / unquote(target)).resolve()
            local_links += 1
            require(target_path.is_relative_to(root), f"Link escapes pack: {file.name}: {target}")
            require(target_path.exists(), f"Missing link: {file.relative_to(root)} -> {target}")
    checks.append(f"Markdown UTF-8 and {local_links} local file links checked across {len(markdown_files)} files.")

    documents = {}
    for file in pack_files("*.json"):
        if is_ignored(file, root):
            continue
        try:
            documents[str(file.relative_to(root)).replace('\\', '/')] = json.loads(file.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"Invalid JSON {file.name}: {exc}")

    contract = documents.get("contracts/openapi.json", {})
    require(contract.get("openapi") == "3.1.0", "Expected OpenAPI 3.1.0")
    operations = []
    for route, path_item in contract.get("paths", {}).items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                continue
            operations.append(operation.get("operationId"))
            expected_params = set(re.findall(r"{([^}]+)}", route))
            actual_params = {p["name"] for p in operation.get("parameters", []) if p.get("in") == "path"}
            require(expected_params == actual_params, f"Path params mismatch: {method} {route}")
            for p in operation.get("parameters", []):
                if p.get("in") == "path":
                    require(p.get("required") is True, f"Path param not required: {route} {p['name']}")
            param_keys = [(p.get("in"), p.get("name")) for p in operation.get("parameters", [])]
            require(len(param_keys) == len(set(param_keys)), f"Duplicate parameter: {method} {route}")
            require(any(code.startswith("2") for code in operation.get("responses", {})), f"No success response: {route}")
            public = method == "post" and route == "/invitations/preview"
            require(bool(operation.get("security")) != public, f"Unexpected auth setting: {method} {route}")
    require(len(operations) == len(set(operations)), "Duplicate operationId")
    require(all(operations), "Missing operationId")

    for path, value in walk(contract):
        if not isinstance(value, dict):
            continue
        if "$ref" in value:
            reference = value["$ref"]
            require(reference.startswith("#/"), f"External ref not bundled: {reference}")
            try:
                resolve_ref(contract, reference)
            except (KeyError, TypeError):
                errors.append(f"Broken OpenAPI ref at {path}: {reference}")
        if isinstance(value.get("required"), list):
            require(set(value["required"]).issubset(value.get("properties", {})), f"Required property missing at {path}")
    checks.append(f"OpenAPI structural checks: {len(contract.get('paths', {}))} paths, {len(operations)} operations, {len(contract.get('components', {}).get('schemas', {}))} schemas; refs and auth boundaries resolved.")

    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        checks.append("Optional jsonschema library unavailable; schema metaschema validation not run.")
    else:
        for name, schema in contract.get("components", {}).get("schemas", {}).items():
            try:
                Draft202012Validator.check_schema(schema)
            except Exception as exc:
                errors.append(f"JSON Schema {name}: {exc}")
        checks.append("JSON Schema draft 2020-12 metaschema validation run for every component schema.")

    backlog = documents.get("planning/backlog.json", {})
    tasks = backlog.get("tasks", [])
    task_ids = [task["id"] for task in tasks]
    require(len(task_ids) == len(set(task_ids)), "Duplicate task IDs")
    by_id = {task["id"]: task for task in tasks}
    # Task states use the validator's own whitelist, independent of stateRules in backlog.
    for task in tasks:
        require(task["status"] in TASK_STATUSES, f"Invalid task state: {task['id']}")
    declared = set(backlog.get("stateRules", {}).get("allowed", []))
    require(declared == TASK_STATUSES, "stateRules.allowed must match the governance whitelist; editing it cannot relax validation")
    milestones = {m["id"]: m for m in backlog.get("milestones", [])}
    expected_releases = {**{f"M{i}": "V1" for i in range(7)}, "M7": "V1.1"}
    require(len(backlog.get("milestones", [])) == len(milestones), "Duplicate milestone IDs")
    require(set(milestones) == set(expected_releases), "Missing or unexpected milestone IDs")
    for mid, release in expected_releases.items():
        require(milestones.get(mid, {}).get("release") == release, f"Invalid milestone release: {mid}")
    for milestone in backlog.get("milestones", []):
        require(milestone["status"] in MILESTONE_STATUSES, f"Invalid milestone state: {milestone['id']}")
        milestone_tasks = [task for task in tasks if task["milestone"] == milestone["id"]]
        if milestone["status"] == "done":
            require(bool(milestone_tasks), f"Done milestone has no tasks: {milestone['id']}")
            require(bool(milestone.get("evidence")), f"Done milestone lacks evidence: {milestone['id']}")
            require(all(task["status"] == "done" for task in milestone_tasks), f"Done milestone has non-done tasks: {milestone['id']} -> {[t['id'] for t in milestone_tasks if t['status'] != 'done']}")
    v1_milestones = [m for m in backlog.get("milestones", []) if m.get("release") == "V1"]
    v1_done = all(m["status"] == "done" for m in v1_milestones)
    application_status = backlog.get("applicationStatus")
    require(application_status in APPLICATION_STATUSES, f"Unknown applicationStatus: {application_status}")
    if application_status == V1_COMPLETE_STATUS:
        require(v1_done, "applicationStatus claims V1 complete but not every V1 milestone is done")
        release = backlog.get("releaseAcceptance", {})
        for evidence in ("currentRevisionCi", "deploymentUrl", "httpsTwoAccounts", "mailAndStorage", "scheduledBackup", "capacity", "recovery"):
            record = release.get(evidence, {})
            require(isinstance(record, dict) and record.get("verified") is True and bool(record.get("evidence")), f"V1 release lacks verified evidence: {evidence}")
    elif v1_done:
        require(False, "All V1 milestones are done; applicationStatus must be V1_RELEASE_ACCEPTANCE_COMPLETE")
    require(v1_milestones, "No V1 milestones found")
    implementation = (root / "docs/06-IMPLEMENTATION-PLAN.md").read_text(encoding="utf-8")
    product = (root / "docs/01-PRODUCT-SPEC.md").read_text(encoding="utf-8")
    for task in tasks:
        require(task["milestone"] in milestones, f"Missing milestone: {task['id']}")
        require(bool(task.get("acceptanceChecks")), f"Task lacks acceptance: {task['id']}")
        if task["status"] == "done":
            require(bool(task.get("evidence")), f"Done task has no evidence: {task['id']}")
            require(not task.get("openAuditGroups"), f"Done task has unresolved audit groups: {task['id']}")
        for dep in task.get("dependsOn", []):
            require(dep in task_ids, f"Unknown dependency: {task['id']} -> {dep}")
        for file in task.get("specFiles", []):
            require((root / file).is_file(), f"Missing task spec: {task['id']} -> {file}")
        for acceptance in task.get("acceptanceChecks", []):
            if re.fullmatch(r"AC-\d+", acceptance):
                require(acceptance in product, f"Unknown acceptance: {acceptance}")

    # Audit registries: every entry needs non-empty, duplicate-free, valid taskIds;
    # open entries and task openAuditGroups must agree in BOTH directions.
    registries = backlog.get("auditRegistries", [backlog.get("auditRegistry")])
    audit_entries = {}
    for registry in registries:
        require(registry in documents, f"Missing audit registry: {registry}")
        for entry in documents.get(registry, {}).get("entries", []):
            entry_id = entry["id"]
            require(entry_id not in audit_entries, f"Duplicate audit ID: {entry_id}")
            status = entry.get("status")
            require(status in AUDIT_STATUSES, f"Unknown audit status: {entry_id}")
            task_refs = entry.get("taskIds")
            require(isinstance(task_refs, list) and len(task_refs) > 0, f"Audit entry lacks non-empty taskIds: {entry_id}")
            if isinstance(task_refs, list):
                require(len(task_refs) == len(set(task_refs)), f"Duplicate taskId in audit entry: {entry_id}")
                for task_id in task_refs:
                    require(task_id in task_ids, f"Audit references unknown task: {entry_id} -> {task_id}")
                    task = by_id.get(task_id)
                    if task is not None and status in OPEN_AUDIT_STATUSES:
                        require(entry_id in task.get("openAuditGroups", []), f"Unresolved audit absent from task: {entry_id} -> {task_id}")
            if status in CLOSED_AUDIT_STATUSES:
                require(bool(entry.get("closureEvidence")), f"Closed audit lacks evidence: {entry_id}")
            for subitem in entry.get("subitems", []):
                sub_status = subitem.get("status")
                require(sub_status in AUDIT_STATUSES, f"Unknown subitem status: {subitem['id']}")
                if status in CLOSED_AUDIT_STATUSES and sub_status in OPEN_AUDIT_STATUSES:
                    errors.append(f"Open subitem masked by closed parent: {subitem['id']} under {entry_id}")
            audit_entries[entry_id] = entry
    for task in tasks:
        for issue in task.get("openAuditGroups", []):
            require(issue in audit_entries, f"Unknown audit ID: {task['id']} -> {issue}")
            entry = audit_entries.get(issue, {})
            require(entry.get("status") in OPEN_AUDIT_STATUSES, f"Closed audit still marked open: {task['id']} -> {issue}")
            require(task["id"] in entry.get("taskIds", []), f"Audit entry does not reference back: {issue} missing taskId {task['id']}")
    require((root / "docs/14-CHANGE-AND-UPGRADE-CHECKLIST.md").is_file(), "Missing change/upgrade checklist")

    visited, active = set(), set()

    def visit(task_id):
        if task_id in active:
            errors.append(f"Dependency cycle at {task_id}")
            return
        if task_id in visited or task_id not in by_id:
            return
        active.add(task_id)
        for dependency in by_id[task_id].get("dependsOn", []):
            visit(dependency)
        active.remove(task_id)
        visited.add(task_id)

    for task_id in task_ids:
        visit(task_id)
    require(len(tasks) == 25, "Expected 25 planned tasks; update validator if scope intentionally changes")
    open_entries = sum(1 for entry in audit_entries.values() if entry.get("status") in OPEN_AUDIT_STATUSES)
    checks.append(f"Backlog checks: {len(tasks)} tasks, {len(milestones)} milestones; unique IDs, valid specs, acceptance IDs, state/evidence rules, bidirectional audit linkage ({len(audit_entries)} entries, {open_entries} open) and acyclic dependencies.")

    return {
        "result": "PASS" if not errors else "FAIL",
        "markdownFiles": len(markdown_files),
        "localLinks": local_links,
        "operations": len(operations),
        "tasks": len(tasks),
        "auditEntries": len(audit_entries),
        "errors": errors,
        "checks": checks,
    }


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    outcome = run_validation(root)
    print(json.dumps({key: outcome[key] for key in ("result", "markdownFiles", "localLinks", "operations", "tasks", "auditEntries", "errors")}, ensure_ascii=True, indent=2))
    raise SystemExit(1 if outcome["errors"] else 0)


if __name__ == "__main__":
    main()
