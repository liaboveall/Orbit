"use client";

import { RouteError } from "@/features/shell/state-views";

/** /app 下各页面的错误边界：项目、任务、成员、设置等读取或渲染出错时显示。 */
export default function AppError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError {...props} message="页面加载失败，请稍后重试。" />;
}
