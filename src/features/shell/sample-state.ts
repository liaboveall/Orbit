/**
 * M0 布局样例的「六态」模型（ORB-002）。
 *
 * 页面默认展示正常数据态；通过 URL 查询参数 `?state=` 切换到
 * loading / empty / error / permission / long-content 五种演示态，
 * 便于验收人员在浏览器直接查看每种状态。第六态「mobile」由视口宽度决定
 * （把浏览器调到 390px 即可，AppShell 与页面均响应式），不占用 state 参数。
 *
 * 纯函数与常量，无服务端依赖，可被 Server Component（读 searchParams）
 * 与 Client Component（状态切换面板）共享。
 */

export const SAMPLE_STATES = [
  "data",
  "loading",
  "empty",
  "error",
  "permission",
  "long-content",
] as const;

export type SampleState = (typeof SAMPLE_STATES)[number];

export const SAMPLE_STATE_LABELS: Record<SampleState, string> = {
  data: "正常数据",
  loading: "加载中",
  empty: "空数据",
  error: "错误",
  permission: "无权限",
  "long-content": "长内容",
};

export const SAMPLE_STATE_HINTS: Record<SampleState, string> = {
  data: "默认态：展示 fixture 正常数据",
  loading: "内容区骨架，外壳尺寸稳定",
  empty: "解释价值 + 下一步操作",
  error: "局部错误 + 重试 + 保留草稿说明",
  permission: "统一不可访问页面，不泄露项目名",
  "long-content": "长中文/英文/URL 的折行演示",
};

/** 把 URL 中的 state 参数解析为合法 SampleState，非法/缺省一律回落 data。 */
export function parseSampleState(
  raw: string | string[] | undefined,
): SampleState {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (SAMPLE_STATES as readonly string[]).includes(value ?? "")
    ? (value as SampleState)
    : "data";
}
