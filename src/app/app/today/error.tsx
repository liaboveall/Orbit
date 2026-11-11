"use client";

import { RouteError } from "@/features/shell/state-views";

/** 工作台的错误边界。 */
export default function TodayError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} message="工作台加载失败，请稍后重试。" />;
}
