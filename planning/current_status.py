"""Render the concise current handoff from the backlog."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START, END = "<!-- BEGIN CURRENT STATUS -->", "<!-- END CURRENT STATUS -->"

def render(backlog):
    lines = [START, "# 当前交付状态", "", "由 planning/current_status.py 从 backlog 生成；详细边界见当前状态文档。", "",
             f"- 状态：{backlog['applicationStatus']}",
             f"- 当前依据：[{Path(backlog['latestReview']['report']).name}]({backlog['latestReview']['report']})",
             f"- 说明：{backlog['latestReview']['summary']}",
             "- 里程碑：" + "；".join(f"{m['id']} {m['status']}" for m in backlog['milestones']),
             "- 历史数据恢复：" + backlog['latestReview']['historicalDataIncident']['historicalRecovery'], "", END]
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    backlog = json.loads((ROOT / "planning/backlog.json").read_text(encoding="utf-8"))
    path = ROOT / "PROGRESS.md"
    original = path.read_text(encoding="utf-8")
    summary = render(backlog)
    if START in original:
        before, rest = original.split(START, 1)
        _, after = rest.split(END, 1)
        updated = before + summary + after
    else:
        updated = summary + "\n\n---\n\n" + original
    if args.check:
        if original != updated:
            raise SystemExit("Current summary is stale: run python planning/current_status.py")
        print("Current summary matches backlog.")
    else:
        path.write_text(updated, encoding="utf-8")
        print("Current summary generated.")

if __name__ == "__main__":
    main()
