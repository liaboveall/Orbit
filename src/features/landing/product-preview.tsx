import { ChevronsUpDown, House, LayoutGrid, Plus, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { TaskCardFace } from "@/features/board/task-card-face";
import { BOARD_TASKS, DEMO_DATE } from "@/features/demo/board-data";
import { ProjectGlyph } from "@/features/projects/project-glyph";
import { OrbitWordmark } from "@/features/shell/orbit-logo";
import { StatusGlyph } from "@/features/tasks/status-glyph";
import { STATUS_COLUMN_ORDER, STATUS_LABEL } from "@/features/tasks/task-meta";
import { cn } from "@/lib/cn";

/**
 * 介绍页的界面预览：用真实的组件和合成数据拼出一屏看板。
 *
 * 不用截图，所以它跟随深色模式，界面改版后也不会过期。整块是一张图
 * （role="img"），内部不可聚焦也不响应指针。
 */

const RECENT = [
  { name: "校园活动报名系统", color: "BLUE" },
  { name: "个人作品集", color: "PURPLE" },
  { name: "数据库课程设计", color: "TEAL" },
  { name: "社团招新海报", color: "ORANGE" },
] as const;

const SECTIONS = ["看板", "列表", "活动", "成员", "设置"];
const FILTERS = ["全部状态", "全部优先级", "全部负责人"];

const navItem = "flex h-10 items-center gap-3 rounded-item px-2.5 text-label font-medium";

export function ProductPreview({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Orbit 看板界面预览：左侧是导航，任务按待办、进行中和已完成分成三列"
      className={cn("glass rounded-[32px] p-2 md:p-2.5", className)}
    >
      <div
        inert
        className="relative isolate flex h-[430px] select-none gap-3 overflow-hidden rounded-[24px] bg-background p-2.5 text-left md:h-[600px] md:p-3"
      >
        {/* 与应用相同的背景光斑，缩到预览框里 */}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_0%_0%,var(--aurora-1),transparent_70%),radial-gradient(60%_55%_at_100%_0%,var(--aurora-2),transparent_68%),radial-gradient(70%_60%_at_85%_100%,var(--aurora-3),transparent_70%)]" />

        <div className="glass hidden w-[216px] shrink-0 flex-col rounded-[22px] p-2.5 lg:flex">
          <OrbitWordmark className="h-12 px-2.5" />
          <div className="space-y-0.5">
            <span className={cn(navItem, "text-foreground-secondary")}>
              <House className="h-5 w-5" />
              我的工作台
            </span>
            <span className={cn(navItem, "text-foreground-secondary")}>
              <LayoutGrid className="h-5 w-5" />
              全部项目
            </span>
          </div>
          <p className="mb-1 mt-5 px-2.5 text-caption font-medium text-foreground-muted">最近项目</p>
          <div className="space-y-0.5">
            {RECENT.map((project, index) => (
              <span
                key={project.name}
                className={cn(navItem, index === 0 ? "surface-selected text-foreground" : "text-foreground-secondary")}
              >
                <ProjectGlyph name={project.name} color={project.color} />
                <span className="truncate">{project.name}</span>
              </span>
            ))}
          </div>
          <div className="mt-auto flex items-center gap-2.5 p-1.5">
            <Avatar name="林夏" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-medium text-foreground">林夏</span>
              <span className="block truncate text-caption text-foreground-muted">linxia@example.com</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-foreground-muted" />
          </div>
        </div>

        <div className="relative min-w-0 flex-1 px-1 md:px-3">
          {/* 内容在预览框底部淡出，不留一排被切断的卡片 */}
          <div className="absolute inset-x-0 -bottom-3 z-10 h-24 bg-linear-to-t from-background to-transparent" />
          <div className="flex items-center justify-between gap-4 py-2 md:py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <ProjectGlyph name="校园活动报名系统" color="BLUE" size="md" />
              <div className="min-w-0">
                <p className="truncate text-title font-semibold tracking-[-0.01em] text-foreground">校园活动报名系统</p>
                <p className="truncate text-caption text-foreground-muted">CAMP · 4 名成员</p>
              </div>
            </div>
            <div className="glass hidden shrink-0 items-center rounded-full p-1 md:flex">
              {SECTIONS.map((label, index) => (
                <span
                  key={label}
                  className={cn(
                    "flex h-9 items-center rounded-full px-4 text-label font-medium",
                    index === 0 ? "surface-selected text-foreground" : "text-foreground-secondary",
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="mb-3 flex items-center gap-2 md:mb-4">
            <span className="surface-chip flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full px-3 text-label text-foreground-muted md:w-56 md:flex-none">
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">搜索标题或编号</span>
            </span>
            {FILTERS.map((label) => (
              <span
                key={label}
                className="surface-chip hidden h-9 shrink-0 items-center gap-1.5 rounded-full pl-3.5 pr-2.5 text-label text-foreground xl:flex"
              >
                {label}
                <ChevronsUpDown className="h-3.5 w-3.5 text-foreground-muted" />
              </span>
            ))}
            <span className={buttonVariants({ size: "sm", className: "ml-auto h-9 shrink-0" })}>
              <Plus className="h-4 w-4" />
              新建任务
            </span>
          </div>

          {/* 手机上和应用一样，一次看一列 */}
          <div className="mb-3 flex rounded-full bg-surface-sunken p-1 md:hidden">
            {STATUS_COLUMN_ORDER.map((status, index) => (
              <span
                key={status}
                className={cn(
                  "flex h-9 flex-1 items-center justify-center rounded-full text-label font-medium",
                  index === 0 ? "surface-selected text-foreground" : "text-foreground-secondary",
                )}
              >
                {STATUS_LABEL[status]}
              </span>
            ))}
          </div>

          <div className="grid items-start gap-3 md:grid-cols-3">
            {STATUS_COLUMN_ORDER.map((status, index) => {
              const tasks = BOARD_TASKS.filter((task) => task.status === status);
              return (
                <div
                  key={status}
                  className={cn(
                    "rounded-card bg-surface-tray p-1.5 shadow-[inset_0_0_0_0.5px_var(--color-line)]",
                    index > 0 && "hidden md:block",
                  )}
                >
                  <p className="hidden h-10 items-center gap-2 px-2.5 text-label font-semibold text-foreground md:flex">
                    <StatusGlyph status={status} className="h-4 w-4" />
                    {STATUS_LABEL[status]}
                    <span className="font-medium tabular-nums text-foreground-muted">{tasks.length}</span>
                  </p>
                  <div className="space-y-1.5">
                    {tasks.map((task) => (
                      <div key={task.id} className="surface-card rounded-tile p-3">
                        <TaskCardFace
                          task={task}
                          today={DEMO_DATE}
                          status={<StatusGlyph status={task.status} className="mt-px" />}
                          title={<p className="line-clamp-2 text-label font-medium text-foreground">{task.title}</p>}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
