import { describe, expect, it } from "vitest";
import { getDueMeta } from "@/features/tasks/task-meta";

describe("历史截止日", () => {
  it("已完成任务使用中性日期文案，不提示负数天后截止或临近", () => {
    const meta = getDueMeta("2026-09-07", "2026-09-08", "DONE");
    expect(meta.label).toBe("截止 2026-09-07（已完成）");
    expect(meta.overdue).toBe(false);
    expect(meta.tone).toBe("later");
  });

  it("未完成任务仍标为逾期", () => {
    expect(getDueMeta("2026-09-07", "2026-09-08", "TODO")).toMatchObject({
      overdue: true, tone: "overdue", label: "已逾期 1 天（2026-09-07）",
    });
  });
});
