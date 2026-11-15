import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/page-session";
import { DomainError } from "@/server/http/errors";
import { getProject } from "@/server/modules/project";
import { readLiveSeed } from "../../_live";

/**
 * 项目页的公共前置：校验会话、消费一次读取额度，取页面保鲜的起点令牌，再按成员关系读取项目。
 * 令牌先于一切数据读取（见 app/_live.ts）。
 *
 * 布局和页面在同一次请求里各调用一次，`cache` 保证只查一次库。不是成员和项目不存在
 * 都走统一的不可访问页，不泄露项目是否存在。
 */
export const loadProject = cache(async (projectId: string) => {
  const user = await requirePageUser();
  const seed = await readLiveSeed();
  try {
    return { user, seed, project: await getProject(projectId, user.id) };
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});

/** 项目内其它读取共用的错误映射：资源不可访问时走统一的不可访问页。 */
export async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
