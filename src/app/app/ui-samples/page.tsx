"use client";

import { useState, type ReactNode } from "react";
import {
  Bell,
  Calendar,
  Check,
  Flag,
  Inbox,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  type ButtonSize,
  type ButtonVariant,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  InlineError,
  Input,
  Label,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SkeletonBlock,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  useToast,
} from "@/components/ui";

/**
 * /app/ui-samples · 组件样例页（M0 · 仅开发环境）。
 *
 * docs/02 §8：M0 产出包含「可浏览的组件样例页，仅开发环境可见」。此页在
 * src/app/app/layout.tsx 的 NODE_ENV 门禁保护下渲染（生产 build/start 只显示
 * 「仅开发环境可见」提示，不渲染本页），逐一展示 src/components/ui 下全部基础
 * UI 组件的 variant / size / state，供设计走查与验收。
 *
 * 全部交互均由 Radix primitives 提供键盘可达性：Tab 遍历、Enter/Space 激活、
 * 方向键导航、Escape 关闭弹层、焦点陷阱与关闭后焦点恢复。不在此新造组件。
 */

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

export default function UiSamplesPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-16">
      <header className="space-y-2">
        <h1 className="text-page font-semibold tracking-tight text-foreground">
          组件样例页（M0 · 仅开发环境）
        </h1>
        <p className="text-label text-foreground-secondary">
          逐一展示 <code className="font-mono">src/components/ui</code> 下全部基础
          UI 组件的 variant / size / state。样式全部消费设计 tokens；弹层与菜单基于
          Radix primitives，键盘完全可操作。数据与交互均为样例，未连接后端。
        </p>
      </header>

      <ButtonSection />
      <IconButtonSection />
      <FieldSection />
      <SelectSection />
      <DialogSection />
      <DrawerSection />
      <TooltipSection />
      <DropdownMenuSection />
      <TabsSection />
      <BadgeSection />
      <AvatarSection />
      <SkeletonSection />
      <ToastSection />
      <InlineErrorSection />
      <EmptyStateSection />
      <PaginationSection />
      <UtilitySection />

      <p className="rounded-control border border-line bg-surface-sunken px-4 py-3 text-caption text-foreground-muted">
        此页面仅用于 M0 验收与设计走查，生产环境不可见。
      </p>
    </div>
  );
}

/* ── 通用版式（页面内部布局，非新增 UI 基础组件） ─────────────────────────── */

function Section({
  id,
  title,
  desc,
  children,
}: {
  id: string;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-card border border-line bg-surface p-5 shadow-popover"
    >
      <h2 id={id} className="text-section font-semibold text-foreground">
        {title}
      </h2>
      <p className="mt-1 text-label text-foreground-secondary">{desc}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-caption font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ── 1. Button ─────────────────────────────────────────────────────────── */

function ButtonSection() {
  return (
    <Section
      id="s-button"
      title="Button"
      desc="四种 variant × 三种 size，含 disabled 态。高度 md=40 / lg=44 满足触控目标，焦点环由全局 :focus-visible 提供。"
    >
      {VARIANTS.map((variant) => (
        <Row key={variant} label={variant}>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              {variant} · {size}
            </Button>
          ))}
          <Button variant={variant} size="md" disabled>
            disabled
          </Button>
        </Row>
      ))}
      <Row label="含图标">
        <Button>
          <Plus className="h-4 w-4" aria-hidden="true" />
          新建任务
        </Button>
        <Button variant="secondary">
          <Search className="h-4 w-4" aria-hidden="true" />
          搜索
        </Button>
        <Button variant="danger">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          删除
        </Button>
      </Row>
    </Section>
  );
}

/* ── 2. IconButton ─────────────────────────────────────────────────────── */

function IconButtonSection() {
  return (
    <Section
      id="s-iconbutton"
      title="IconButton"
      desc="仅图标按钮，强制 label 映射到 aria-label 提供可访问名称。展示各 variant 与 size（触控端 lg=44px）。"
    >
      <Row label="variant（size=md）">
        <IconButton label="设置" variant="primary">
          <Settings className="h-5 w-5" />
        </IconButton>
        <IconButton label="编辑" variant="secondary">
          <Pencil className="h-5 w-5" />
        </IconButton>
        <IconButton label="更多" variant="ghost">
          <MoreHorizontal className="h-5 w-5" />
        </IconButton>
        <IconButton label="删除" variant="danger">
          <Trash2 className="h-5 w-5" />
        </IconButton>
        <IconButton label="禁用的通知" variant="secondary" disabled>
          <Bell className="h-5 w-5" />
        </IconButton>
      </Row>
      <Row label="size">
        <IconButton label="小尺寸" size="sm" variant="secondary">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="中尺寸" size="md" variant="secondary">
          <Settings className="h-5 w-5" />
        </IconButton>
        <IconButton label="大尺寸" size="lg" variant="secondary">
          <Settings className="h-5 w-5" />
        </IconButton>
      </Row>
    </Section>
  );
}

/* ── 3. Input / Textarea ───────────────────────────────────────────────── */

function FieldSection() {
  return (
    <Section
      id="s-field"
      title="Input / Textarea / Label"
      desc="表单控件：默认、带错误（aria-invalid 切 danger 边界 + InlineError 驻留提示）、disabled。焦点环走全局规则。"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="f-default">任务标题（默认）</Label>
          <Input id="f-default" placeholder="输入任务标题" defaultValue="整理季度汇报" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-disabled">任务标题（禁用）</Label>
          <Input id="f-disabled" placeholder="不可编辑" disabled defaultValue="只读内容" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="f-error">邮箱（带错误）</Label>
        <Input
          id="f-error"
          type="email"
          aria-invalid="true"
          aria-describedby="f-error-msg"
          defaultValue="not-an-email"
        />
        <InlineError id="f-error-msg">请输入有效的邮箱地址，例如 name@example.com。</InlineError>
      </div>
      <div className="space-y-2">
        <Label htmlFor="f-textarea">描述（Textarea）</Label>
        <Textarea id="f-textarea" placeholder="补充任务细节……" defaultValue={"第一行\n第二行"} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="f-textarea-disabled">描述（禁用）</Label>
        <Textarea id="f-textarea-disabled" disabled defaultValue="不可编辑的描述内容" />
      </div>
    </Section>
  );
}

/* ── 4. Select ─────────────────────────────────────────────────────────── */

function SelectSection() {
  const [value, setValue] = useState("medium");
  return (
    <Section
      id="s-select"
      title="Select"
      desc="基于 @radix-ui/react-select，提供方向键 / Home / End / 输入跳转与 aria 角色。展示可用与 disabled 两种状态。"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label id="sel-priority-label">优先级</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger aria-labelledby="sel-priority-label">
              <SelectValue placeholder="选择优先级" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">高</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="none">无</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-caption text-foreground-muted">
            当前值：<span className="font-mono">{value}</span>
          </p>
        </div>
        <div className="space-y-2">
          <Label id="sel-disabled-label">负责人（禁用）</Label>
          <Select disabled>
            <SelectTrigger aria-labelledby="sel-disabled-label">
              <SelectValue placeholder="未分配" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">成员 A</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Section>
  );
}

/* ── 5. Dialog ─────────────────────────────────────────────────────────── */

function DialogSection() {
  return (
    <Section
      id="s-dialog"
      title="Dialog"
      desc="基于 @radix-ui/react-dialog：焦点陷阱、打开移入焦点、关闭后焦点恢复触发元素、Escape 关闭、aria-labelledby/describedby 关联标题与描述。"
    >
      <Row label="触发">
        <Dialog>
          <DialogTrigger asChild>
            <Button>打开对话框</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认删除任务？</DialogTitle>
              <DialogDescription>
                此操作会移除任务「整理季度汇报」及其评论。删除后无法撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">取消</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  确认删除
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Row>
    </Section>
  );
}

/* ── 6. Drawer ─────────────────────────────────────────────────────────── */

function DrawerSection() {
  return (
    <Section
      id="s-drawer"
      title="Drawer"
      desc="侧滑面板，复用 Radix Dialog 的焦点陷阱 / Escape / 焦点恢复。side=left 用于导航，side=right 用于详情。"
    >
      <Row label="触发">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="secondary">打开左侧抽屉</Button>
          </DrawerTrigger>
          <DrawerContent side="left" closeLabel="关闭抽屉" className="p-4 pt-12">
            <DrawerTitle>导航抽屉</DrawerTitle>
            <DrawerDescription>这是 side=left 的抽屉导航样例</DrawerDescription>
            <ul className="mt-4 space-y-1">
              {["我的工作台", "全部项目", "个人设置"].map((item) => (
                <li key={item}>
                  <DrawerClose asChild>
                    <button
                      type="button"
                      className="flex w-full items-center rounded-control px-3 py-2 text-left text-label text-foreground-secondary outline-none hover:bg-surface-sunken hover:text-foreground"
                    >
                      {item}
                    </button>
                  </DrawerClose>
                </li>
              ))}
            </ul>
          </DrawerContent>
        </Drawer>

        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="secondary">打开右侧抽屉</Button>
          </DrawerTrigger>
          <DrawerContent side="right" closeLabel="关闭面板" className="p-4 pt-12">
            <DrawerTitle>详情侧面板</DrawerTitle>
            <DrawerDescription>这是 side=right 的详情面板样例</DrawerDescription>
            <p className="mt-3 text-label text-foreground-secondary">
              手机或直链进入时，任务详情以侧面板形式呈现，Escape 可关闭。
            </p>
          </DrawerContent>
        </Drawer>
      </Row>
    </Section>
  );
}

/* ── 7. Tooltip ────────────────────────────────────────────────────────── */

function TooltipSection() {
  return (
    <Section
      id="s-tooltip"
      title="Tooltip"
      desc="基于 @radix-ui/react-tooltip：hover 与键盘 focus 均可触发（Provider 已在 /app 布局挂载）。四个方向 side 示例。"
    >
      <Row label="方向">
        <Tooltip content="顶部提示" side="top">
          <Button variant="secondary">top</Button>
        </Tooltip>
        <Tooltip content="右侧提示" side="right">
          <Button variant="secondary">right</Button>
        </Tooltip>
        <Tooltip content="底部提示" side="bottom">
          <Button variant="secondary">bottom</Button>
        </Tooltip>
        <Tooltip content="左侧提示" side="left">
          <Button variant="secondary">left</Button>
        </Tooltip>
        <Tooltip content="图标按钮的完整标签">
          <IconButton label="更多操作" variant="secondary">
            <MoreHorizontal className="h-5 w-5" />
          </IconButton>
        </Tooltip>
      </Row>
    </Section>
  );
}

/* ── 8. DropdownMenu ───────────────────────────────────────────────────── */

function DropdownMenuSection() {
  return (
    <Section
      id="s-dropdown"
      title="DropdownMenu"
      desc="基于 @radix-ui/react-dropdown-menu：Enter/Space/方向键打开与导航、Escape 关闭、焦点管理。含 label、item、separator 与 disabled 项。"
    >
      <Row label="触发">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              任务操作
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>编辑</DropdownMenuLabel>
            <DropdownMenuItem>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Calendar className="h-4 w-4" aria-hidden="true" />
              修改截止日
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Check className="h-4 w-4" aria-hidden="true" />
              标记完成
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Mail className="h-4 w-4" aria-hidden="true" />
              发送通知（禁用）
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
    </Section>
  );
}

/* ── 9. Tabs ───────────────────────────────────────────────────────────── */

function TabsSection() {
  return (
    <Section
      id="s-tabs"
      title="Tabs"
      desc="基于 @radix-ui/react-tabs：方向键切换、Home/End、aria-selected 与 role=tablist。用于项目二级导航与手机按状态切换。"
    >
      <Tabs defaultValue="board">
        <TabsList aria-label="视图切换样例">
          <TabsTrigger value="board">看板</TabsTrigger>
          <TabsTrigger value="list">列表</TabsTrigger>
          <TabsTrigger value="activity">活动</TabsTrigger>
        </TabsList>
        <TabsContent value="board">
          <p className="text-label text-foreground-secondary">
            看板视图：三列固定（待办 / 进行中 / 已完成），列头显示匹配总数。
          </p>
        </TabsContent>
        <TabsContent value="list">
          <p className="text-label text-foreground-secondary">
            列表视图：按排序展示全部任务（M0 仅样例文案）。
          </p>
        </TabsContent>
        <TabsContent value="activity">
          <p className="text-label text-foreground-secondary">
            活动视图：任务变更历史时间线（M0 仅样例文案）。
          </p>
        </TabsContent>
      </Tabs>
    </Section>
  );
}

/* ── 10. Badge ─────────────────────────────────────────────────────────── */

function BadgeSection() {
  return (
    <Section
      id="s-badge"
      title="Badge"
      desc="小标签：五种语义 tone（均过 AA 对比）。任务卡「最多一个重点色」，高优先级 / 逾期用图标 + 文案而非整卡染色。"
    >
      <Row label="tone">
        <Badge tone="neutral">neutral</Badge>
        <Badge tone="brand">brand</Badge>
        <Badge tone="success">success</Badge>
        <Badge tone="warning">warning</Badge>
        <Badge tone="danger">danger</Badge>
      </Row>
      <Row label="优先级">
        <Badge tone="danger" icon={<Flag className="h-3 w-3" />}>
          高
        </Badge>
        <Badge tone="warning">中</Badge>
        <Badge tone="neutral">低</Badge>
        <Badge tone="neutral">无</Badge>
      </Row>
      <Row label="状态 / 计数">
        <Badge tone="neutral">待办</Badge>
        <Badge tone="brand">进行中</Badge>
        <Badge tone="success" icon={<Check className="h-3 w-3" />}>
          已完成
        </Badge>
        <Badge tone="danger" icon={<Calendar className="h-3 w-3" />}>
          逾期 3 天
        </Badge>
      </Row>
    </Section>
  );
}

/* ── 11. Avatar / AvatarStack ──────────────────────────────────────────── */

function AvatarSection() {
  return (
    <Section
      id="s-avatar"
      title="Avatar / AvatarStack"
      desc="基于 @radix-ui/react-avatar。V1 不上传头像，用姓名首字母占位（Fallback）。AvatarStack 超出显示 +N，并提供完整成员名称的可访问标签。"
    >
      <Row label="单个（size）">
        <Avatar name="林可" size="sm" />
        <Avatar name="周予安" size="md" />
        <Avatar name="陈墨" size="lg" />
      </Row>
      <Row label="堆叠（max=3）">
        <AvatarStack names={["林可", "周予安", "陈墨", "赵昀", "孙一"]} max={3} />
        <AvatarStack names={["林可", "周予安"]} max={3} size="sm" />
      </Row>
    </Section>
  );
}

/* ── 12. Skeleton ──────────────────────────────────────────────────────── */

function SkeletonSection() {
  return (
    <Section
      id="s-skeleton"
      title="Skeleton / SkeletonBlock"
      desc="加载占位：与真实布局同形，避免整屏 spinner。SkeletonBlock 附 role=status + 文本向辅助技术宣告「加载中」。pulse 在 prefers-reduced-motion 下降级。"
    >
      <SkeletonBlock label="任务卡加载中" className="space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-20 rounded-card" />
        <Skeleton className="h-4 w-2/3" />
      </SkeletonBlock>
    </Section>
  );
}

/* ── 13. Toast ─────────────────────────────────────────────────────────── */

function ToastSection() {
  const { toast } = useToast();
  return (
    <Section
      id="s-toast"
      title="Toast"
      desc="基于 @radix-ui/react-toast + useToast。管理 aria-live 宣告、自动消失、不影响焦点。约束：Toast 不作为唯一错误反馈（错误须由 InlineError 驻留）。"
    >
      <Row label="variant">
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              title: "信息提示",
              description: "这是一条 info toast 样例。",
              variant: "info",
            })
          }
        >
          info
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              title: "保存成功",
              description: "任务已更新（success）。",
              variant: "success",
            })
          }
        >
          success
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            toast({
              title: "操作失败",
              description: "网络异常，请重试（error → danger）。",
              variant: "danger",
            })
          }
        >
          error
        </Button>
      </Row>
    </Section>
  );
}

/* ── 14. InlineError ───────────────────────────────────────────────────── */

function InlineErrorSection() {
  return (
    <Section
      id="s-inlineerror"
      title="InlineError"
      desc="字段旁 / 局部区域内的驻留错误提示。默认 role=alert 让屏幕阅读器即时宣告，配 danger 图标 + 文案（不单靠颜色）。"
    >
      <InlineError>无法保存更改：请检查网络后重试。</InlineError>
      <InlineError id="ie-example">标题不能为空，且长度不超过 120 个字符。</InlineError>
    </Section>
  );
}

/* ── 15. EmptyState ────────────────────────────────────────────────────── */

function EmptyStateSection() {
  return (
    <Section
      id="s-emptystate"
      title="EmptyState"
      desc="真正无数据 / 筛选无结果时使用：标题说明现状，描述给出意义，action 提供明确下一步。用简单线形图标，不做庆祝动画。"
    >
      <EmptyState
        icon={<Inbox className="h-6 w-6" />}
        title="今天没有到期任务"
        description="享受这份清闲，或提前规划明天的工作。"
        action={
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            新建任务
          </Button>
        }
      />
    </Section>
  );
}

/* ── 16. Pagination ────────────────────────────────────────────────────── */

function PaginationSection() {
  const [page, setPage] = useState(1);
  const [page2, setPage2] = useState(8);
  return (
    <Section
      id="s-pagination"
      title="Pagination"
      desc="以 button 呈现，Tab 可聚焦、Enter/Space 可激活；当前页用 aria-current 标注，上一页/下一页有可访问名称。pageCount≤1 时不渲染。"
    >
      <Row label="短序列（7 页）">
        <Pagination page={page} pageCount={7} onChange={setPage} />
      </Row>
      <Row label="长序列（省略号，20 页）">
        <Pagination page={page2} pageCount={20} onChange={setPage2} />
      </Row>
    </Section>
  );
}

/* ── 17. 工具型导出（非视觉组件） ───────────────────────────────────────── */

function UtilitySection() {
  return (
    <Section
      id="s-utility"
      title="工具型导出（非视觉组件）"
      desc="src/components/ui 还导出两个无渲染的工具，供业务组件复用，故此处以文字说明而非可视样例呈现。"
    >
      <ul className="space-y-2 text-label text-foreground-secondary">
        <li>
          <code className="font-mono text-foreground">useFocusReturn</code>
          ：编程式打开弹层时记录触发焦点，关闭后自动归还（AppShell 手机汉堡抽屉已使用）。
        </li>
        <li>
          <code className="font-mono text-foreground">buttonVariants</code>
          ：生成按钮外观类名，供需要按钮视觉的非 button 元素复用。
        </li>
      </ul>
    </Section>
  );
}
