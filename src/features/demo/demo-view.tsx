"use client";
import Link from "next/link";
import { useState } from "react";
import { DEMO_DATE } from "./board-data";
import { DEMO_PROJECTS, demoTasks } from "./fixtures";
import { DemoTaskCard } from "./demo-task-card";
import { STATUS_COLUMN_ORDER, STATUS_LABEL } from "@/features/tasks/task-meta";
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui";

/** Synthetic data only. This module has no API client, session or database imports. */
export function DemoView() {
  const [projectKey, setProjectKey] = useState("CAMP");
  const allTasks = demoTasks(projectKey);
  const project = DEMO_PROJECTS.find(p => p.key === projectKey)!;
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"board" | "list" | "activity">("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const tasks = allTasks.filter(t => `${t.identifier} ${t.title}`.toLowerCase().includes(query.toLowerCase()));
  const task = allTasks.find(t => t.id === selected);
  return <main className="mx-auto min-h-dvh max-w-7xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><Link href="/" className="text-brand">有序 Orbit</Link><h1 className="text-page font-semibold">{project.name}</h1><p className="text-foreground-secondary">只读演示 · 全部为合成数据，与私人项目完全隔离。日期快照：{DEMO_DATE}，截止提示以此日为准。</p></div>
      <Link href="/auth/register" className="text-brand underline">注册并创建自己的项目</Link>
    </header>
    <label className="flex items-center gap-3">演示项目<select aria-label="演示项目" className="rounded-control border border-line bg-surface p-2" value={projectKey} onChange={e=>{setProjectKey(e.target.value);setSelected(null);setQuery("");}}>{DEMO_PROJECTS.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
    <nav aria-label="演示视图" className="flex gap-2">{(["board", "list", "activity"] as const).map(v => <Button key={v} variant={view === v ? "primary" : "secondary"} onClick={() => setView(v)}>{({board:"看板",list:"列表",activity:"活动"})[v]}</Button>)}</nav>
    <div className="flex flex-wrap gap-3"><Input aria-label="搜索演示任务" placeholder="搜索任务标题或编号" value={query} onChange={e => setQuery(e.target.value)} className="max-w-md"/><Button onClick={() => setNotice("演示为只读。注册后即可创建任务、发表评论和上传附件。")}>新建任务</Button></div>
    <p role="status" className="text-foreground-secondary">{notice}</p>
    {view === "activity" ? <section aria-label="演示活动" className="rounded-card border border-line bg-surface p-6"><h2 className="font-semibold">项目动态（演示）</h2><p className="mt-4">小林创建了项目「{project.name}」。</p><p className="mt-4">小周完成了报名表单任务。</p><p className="mt-4">小陈添加了验收清单。</p></section> :
      tasks.length === 0 ? <p>没有匹配的任务，试试其他关键词。</p> :
      <div className={view === "board" ? "grid gap-4 md:grid-cols-3" : "space-y-4"}>{STATUS_COLUMN_ORDER.map(status => <section key={status} aria-label={STATUS_LABEL[status]} className="space-y-3 rounded-card bg-surface-sunken p-3"><h2 className="font-semibold">{STATUS_LABEL[status]} · {tasks.filter(t=>t.status===status).length}</h2>{tasks.filter(t=>t.status===status).map(t=><DemoTaskCard key={t.id} task={t} onOpen={()=>setSelected(t.id)} onChangeStatus={()=>setNotice("演示任务为只读，注册后可在自己的项目中移动任务。")} />)}</section>)}</div>}
    <Dialog open={!!task} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent><DialogTitle>{task?.title ?? "任务详情"}</DialogTitle><DialogDescription>合成任务详情 · 不读取或修改私人项目</DialogDescription>{task && <div className="space-y-4"><p>{task.identifier} · {STATUS_LABEL[task.status]}</p><p>负责人：{task.assignee?.name ?? "未分配"}</p><h3 className="font-semibold">验收清单</h3><ul className="list-inside list-disc"><li>键盘可以完成主要操作</li><li>错误时保留已输入的内容</li></ul><h3 className="font-semibold">评论（演示）</h3><p>小周：已核对交互，等待验收。</p><p>附件样例：验收说明.txt（演示占位）</p><Link href="/auth/register" className="text-brand underline">注册后参与真实协作</Link></div>}</DialogContent></Dialog>
  </main>;
}
