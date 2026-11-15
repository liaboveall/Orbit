/**
 * 页面保鲜用的变更令牌（`GET /api/v1/my/pulse`）及其比较，纯函数，不依赖 React。
 * 轮询与重读的调度在 ./live.tsx。
 */

export type Pulse = {
  /** 当前用户可见的一切。 */
  token: string;
  /** 侧栏最近项目可能变化时才变。 */
  shell: string;
  /** 每个可访问项目各自的令牌。 */
  projects: Record<string, string>;
};

/** 一个页面关心的范围：某个项目，或全部（工作台、项目列表）。 */
export type PulseScope = { project?: string };

/** 解析接口响应的信封；形状不对返回 null（当作一次失败的轮询，不抛错）。 */
export function parsePulse(value: unknown): Pulse | null {
  if (!value || typeof value !== "object") return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const { token, shell, projects } = data as { token?: unknown; shell?: unknown; projects?: unknown };
  if (typeof token !== "string" || typeof shell !== "string" || !Array.isArray(projects)) return null;
  const map: Record<string, string> = {};
  for (const entry of projects) {
    if (!entry || typeof entry !== "object") return null;
    const { id, token: projectToken } = entry as { id?: unknown; token?: unknown };
    if (typeof id !== "string" || typeof projectToken !== "string") return null;
    map[id] = projectToken;
  }
  return { token, shell, projects: map };
}

/**
 * 页面上的数据是否过期：在页面关心的范围里，最新轮询到的令牌和页面数据对应的令牌不同。
 * 项目从列表里消失（被移出项目）也算变化；没有任何页面声明范围时不算过期。
 */
export function isOutdated(latest: Pulse | null, applied: Pulse | null, scopes: Iterable<PulseScope>): boolean {
  if (!latest || !applied) return false;
  for (const scope of scopes) {
    if (scope.project === undefined) {
      if (latest.token !== applied.token) return true;
    } else if (latest.projects[scope.project] !== applied.projects[scope.project]) {
      return true;
    }
  }
  return false;
}
