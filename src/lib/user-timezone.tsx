"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 事件时间展示的统一用户时区（F23 修复，docs/02 §3、docs/01 §3）。
 *
 * 背景之分（同 F23 裁定）：
 *  - **事件时间**（评论/附件/活动/邀请/回收站的 createdAt 等，UTC 存储）：
 *    展示必须使用**账户设置的 IANA 时区**，设备时区变化不影响显示；
 *  - **date-only 截止日**（YYYY-MM-DD）：按产品语义本就是「日历日」，不参与时区
 *    换算（服务端按账户时区计算逾期，前端原样展示）。
 *
 * Provider 在 AppShell（已有会话 UserDTO）挂载；兜底为设备时区（Provider 之外
 * 的场景，如登录前页面），行为与旧实现一致。
 */

const UserTimezoneContext = createContext<string | null>(null);

export function UserTimezoneProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return <UserTimezoneContext value={value}>{children}</UserTimezoneContext>;
}

/** 账户时区（未挂 Provider 时回退设备时区）。 */
export function useUserTimezone(): string {
  const tz = useContext(UserTimezoneContext);
  return tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const dateOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function cachedFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(options);
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("zh-CN", { timeZone, ...options });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** 时区名非法时的兜底（不让格式化异常进入渲染路径）。 */
function resolveFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  try {
    return cachedFormatter(timeZone, options);
  } catch {
    return cachedFormatter(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      options,
    );
  }
}

/**
 * 事件时间 → 「2026年9月10日 14:03」（账户时区）。
 * 所有 UTC 事件时间戳的展示统一走本函数，替代各自的设备时区格式化。
 */
export function formatEventDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return resolveFormatter(timeZone, dateTimeOptions).format(date);
}

/** 事件日期（只需日期精度，如加入日期）→ 「2026年9月10日」（账户时区）。 */
export function formatEventDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return resolveFormatter(timeZone, dateOptions).format(date);
}
