import "server-only";
import { cache } from "react";
import type { Pulse } from "@/features/shell/pulse";
import { requirePageUser } from "@/server/auth/page-session";
import { getPulse } from "@/server/modules/pulse/service";

/**
 * 页面保鲜的起点令牌：在读取本页数据**之前**取当前用户的变更令牌，随页面一起交给客户端
 * （`<LiveScope seed>`，见 features/shell/live.tsx）。
 *
 * 顺序是关键：令牌先于数据，所以数据里已经包含的变化不会让令牌显得更新；此后任何变化
 * 都会让轮询到的令牌与它不同，客户端据此重读，不会漏掉「渲染之后、第一次轮询之前」的写入。
 * 页面必须先 `await readLiveSeed()`，再读自己的数据。
 *
 * 同一次请求里只查一次（React cache）。读取失败不影响页面：返回 null，客户端退回
 * 以第一次轮询结果为基线。
 */
export const readLiveSeed = cache(async (): Promise<Pulse | null> => {
  const user = await requirePageUser();
  try {
    const pulse = await getPulse(user.id);
    return {
      token: pulse.token,
      shell: pulse.shell,
      projects: Object.fromEntries(pulse.projects.map((project) => [project.id, project.token])),
    };
  } catch {
    return null;
  }
});
