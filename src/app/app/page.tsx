import { redirect } from "next/navigation";

/**
 * /app 入口（F31 ⑦ 修复）：此前 /app 无 page，直接访问返回 404。
 * 按导航需求重定向到默认落地页「我的工作台」（docs/02 §3 路由表）。
 */
export default function AppIndexPage() {
  redirect("/app/today");
}
