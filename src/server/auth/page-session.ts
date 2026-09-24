import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { UserDTO } from "@/contracts";
import { REQUEST_RETURN_TO_HEADER, loginPathWithReturnTo } from "@/lib/return-to";
import { rateLimitedPath, visiblePagePath } from "@/lib/rate-limited";
import { consumeReadQuota } from "./read-quota";
import { getSessionUser } from "./session";

/**
 * 服务端页面的会话读取（PAGE-READ-LIMIT）。
 *
 * React `cache` 让同一次页面请求中的布局与页面共享一次会话查询（Next 官方数据安全指南的
 * 做法），不再各自查询会话表。
 */

/** 当前请求的会话用户；只做身份校验、不计读取额度（布局与预取使用）。 */
export const getPageSessionUser = cache(async (): Promise<UserDTO | null> =>
  getSessionUser(await headers()),
);

/**
 * 页面数据读取准入：要求已登录，并为本次完整页面请求消费一次读取额度，与 API 的
 * GET/HEAD 共用每用户桶（生产/staging）。同一请求只计一次；链接预取只渲染到布局、
 * 不执行页面，因此不计费。未登录跳转登录页；超额跳转限流说明页并保留原地址。
 * 在页面读取任何项目数据之前调用。
 */
export const requirePageUser = cache(async (): Promise<UserDTO> => {
  const returnTo = visiblePagePath((await headers()).get(REQUEST_RETURN_TO_HEADER));
  const user = await getPageSessionUser();
  if (!user) redirect(loginPathWithReturnTo(returnTo));
  const admission = await consumeReadQuota(user.id);
  if (!admission.allowed) redirect(rateLimitedPath(returnTo, admission.retryAfter));
  return user;
});
