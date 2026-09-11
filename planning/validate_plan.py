"""Validate the planning pack only. This is not an application test suite."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []
checks: list[str] = []

# Validate the planning pack only: skip dependency/build/VCS trees that are not
# part of the project's own planning, docs, contracts or source. Without this the
# recursive rglob below would traverse third-party packages (node_modules) whose
# READMEs and JSON-with-comments tsconfigs are outside this validator's scope.
IGNORED_DIRS = {".git", ".next", "node_modules"}


def is_ignored(path: Path) -> bool:
    return any(part in IGNORED_DIRS for part in path.relative_to(ROOT).parts)


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def walk(value, path="$"):
    yield path, value
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk(item, f"{path}[{index}]")


def resolve_ref(document, reference):
    value = document
    for part in reference.removeprefix("#/").split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


markdown_files = sorted(file for file in ROOT.rglob("*.md") if not is_ignored(file))
local_links = 0
for file in markdown_files:
    content = file.read_text(encoding="utf-8")
    require("\ufffd" not in content, f"Replacement character in {file.relative_to(ROOT)}")
    for raw_target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
        target = raw_target.strip().strip("<>").split("#", 1)[0]
        if not target or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
            continue
        target_path = (file.parent / unquote(target)).resolve()
        local_links += 1
        require(target_path.is_relative_to(ROOT), f"Link escapes pack: {file.name}: {target}")
        require(target_path.exists(), f"Missing link: {file.relative_to(ROOT)} -> {target}")
checks.append(f"Markdown UTF-8 and {local_links} local file links checked across {len(markdown_files)} files.")

documents = {}
for file in ROOT.rglob("*.json"):
    if is_ignored(file):
        continue
    try:
        documents[str(file.relative_to(ROOT)).replace('\\', '/')] = json.loads(file.read_text(encoding="utf-8"))
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
allowed_status = set(backlog.get("stateRules", {}).get("allowed", []))
milestones = {m["id"]: m for m in backlog.get("milestones", [])}
implementation = (ROOT / "docs/06-IMPLEMENTATION-PLAN.md").read_text(encoding="utf-8")
product = (ROOT / "docs/01-PRODUCT-SPEC.md").read_text(encoding="utf-8")
for task in tasks:
    require(task["milestone"] in milestones, f"Missing milestone: {task['id']}")
    require(task["status"] in allowed_status, f"Invalid task state: {task['id']}")
    require(task["id"] in implementation, f"Task not documented: {task['id']}")
    require(bool(task.get("acceptanceChecks")), f"Task lacks acceptance: {task['id']}")
    if task["status"] == "done":
        require(bool(task.get("evidence")), f"Done task has no evidence: {task['id']}")
    for dep in task.get("dependsOn", []):
        require(dep in task_ids, f"Unknown dependency: {task['id']} -> {dep}")
    for file in task.get("specFiles", []):
        require((ROOT / file).is_file(), f"Missing task spec: {task['id']} -> {file}")
    for acceptance in task.get("acceptanceChecks", []):
        if re.fullmatch(r"AC-\d+", acceptance):
            require(acceptance in product, f"Unknown acceptance: {acceptance}")

by_id = {task["id"]: task for task in tasks}
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
checks.append(f"Backlog checks: {len(tasks)} tasks, {len(milestones)} milestones; unique IDs, valid specs, acceptance IDs, state/evidence rules and acyclic dependencies.")

state = "PASS" if not errors else "FAIL"
report = ["# 规划静态校验结果", "", f"- Result: {state}", f"- Run at: {datetime.now(timezone.utc).isoformat()}", "- Scope: planning files only. Application code, business behavior, deployment and runtime tests are NOT verified.", ""]
report += ["## Checks", ""] + [f"- {line}" for line in checks]
report += ["", "## Limits", "", "Checks cover local link targets, JSON syntax, selected OpenAPI structure, local refs and backlog consistency. They do not prove all OpenAPI semantic rules, external URLs, browser rendering or the feasibility of every implementation detail."]
if errors:
    report += ["", "## Errors", ""] + [f"- {error}" for error in errors]
(ROOT / "planning/VALIDATION.md").write_text("\n".join(report) + "\n", encoding="utf-8")
print(json.dumps({"result": state, "markdownFiles": len(markdown_files), "localLinks": local_links, "operations": len(operations), "tasks": len(tasks), "errors": errors}, ensure_ascii=True, indent=2))
raise SystemExit(1 if errors else 0)
