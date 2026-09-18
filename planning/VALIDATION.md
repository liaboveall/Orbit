# 规划静态校验结果

- Result: PASS
- Run at: 2026-09-18T10:06:41.616078+00:00
- Scope: planning files only. Application code, business behavior, deployment and runtime tests are NOT verified.

## Checks

- Markdown UTF-8 and 184 local file links checked across 60 files.
- OpenAPI structural checks: 25 paths, 37 operations, 37 schemas; refs and auth boundaries resolved.
- JSON Schema draft 2020-12 metaschema validation run for every component schema.
- Backlog checks: 25 tasks, 8 milestones; unique IDs, valid specs, acceptance IDs, state/evidence rules, bidirectional audit linkage (132 entries, 10 open) and acyclic dependencies.

## Limits

Checks cover local link targets, JSON syntax, selected OpenAPI structure, local refs, backlog consistency and audit registry linkage. They do not prove all OpenAPI semantic rules, external URLs, browser rendering or the feasibility of every implementation detail.
