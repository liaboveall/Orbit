"""Create an optional single-file reading copy or a transferable zip pack."""
from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["bundle", "zip"])
args = parser.parse_args()

if args.mode == "bundle":
    sections = ["# 有序 Orbit · 完整项目开发规划", "", "版本1.0 / 2026-09-08。此文件是专题文档的阅读副本；修改源文件后重新生成。实际实现和验收状态以 PROGRESS.md 为准。", "", "开发Agent从 [README](README.md)、[AGENTS](AGENTS.md) 和 [当前进度](PROGRESS.md) 入手，按里程碑加载专题；不要把本阅读副本与全部源文件重复加载。机器契约见 [OpenAPI](contracts/openapi.json)，任务见 [backlog](planning/backlog.json)。", ""]
    for source in sorted((ROOT / "docs").glob("[0-9][0-9]-*.md")):
        text = source.read_text(encoding="utf-8")

        def rebase(match):
            label, target = match.groups()
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                return match.group(0)
            raw, *fragment = target.split("#", 1)
            resolved = (source.parent / unquote(raw)).resolve()
            relative = resolved.relative_to(ROOT).as_posix()
            suffix = "#" + fragment[0] if fragment else ""
            return f"[{label}]({relative}{suffix})"

        text = re.sub(r"\[([^\]]*)\]\(([^)]+)\)", rebase, text)
        sections += [f"<!-- Source: {source.relative_to(ROOT).as_posix()} -->", text, "\n---\n"]
    target = ROOT / "DEVELOPMENT-PLAN.md"
    target.write_text("\n".join(sections), encoding="utf-8")
    print(f"Created {target} ({target.stat().st_size} bytes)")
else:
    target = ROOT.parent / "Orbit-development-plan-v1.0.zip"
    excluded = {".git", "node_modules", ".next", "__pycache__"}
    files = []
    allowed_roots = {"docs", "planning", "prompts", "templates", "contracts"}
    allowed_files = {"README.md", "AGENTS.md", "PROGRESS.md", "DEVELOPMENT-PLAN.md", ".env.example"}
    for source in ROOT.rglob("*"):
        if not source.is_file() or any(part in excluded for part in source.relative_to(ROOT).parts):
            continue
        relative = source.relative_to(ROOT)
        if relative.parts[0] not in allowed_roots and relative.as_posix() not in allowed_files:
            continue
        if source.name.startswith(".env") and source.name != ".env.example":
            continue
        files.append(source)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for source in sorted(files):
            archive.write(source, Path("Orbit") / source.relative_to(ROOT))
    with zipfile.ZipFile(target) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f"Zip integrity failure: {bad}")
    print(f"Created {target} ({len(files)} files, {target.stat().st_size} bytes)")
