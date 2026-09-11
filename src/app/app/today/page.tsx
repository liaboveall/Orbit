import type { Metadata } from "next";
import { parseSampleState } from "@/features/shell/sample-state";
import { TodayView } from "@/features/today/today-view";

/**
 * /app/today · 我的工作台布局样例（ORB-002）。
 *
 * Server Component：读取 `?state=` 决定演示态，渲染客户端 TodayView。
 * Next 16 中 searchParams 为 Promise，需 await。真实数据获取（TanStack Query）属后续里程碑。
 */

export const metadata: Metadata = {
  title: "我的工作台 · Orbit（M0 样例）",
};

type PageProps = {
  searchParams: Promise<{ state?: string | string[] }>;
};

export default async function TodayPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const state = parseSampleState(sp.state);
  return <TodayView state={state} />;
}
