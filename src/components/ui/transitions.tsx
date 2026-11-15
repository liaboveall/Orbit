"use client";

import { ViewTransition, type ReactNode } from "react";
import { useOverlayOpen } from "./overlay-presence";

/**
 * 视图过渡的三种边界（动画定义在 src/styles/glass.css 末尾）。
 *
 * React 只在 Transition 里的更新上触发它们：路由切换、`startTransition` 包住的
 * 状态更新、`router.refresh()`。普通的 setState（例如拖拽落位）不触发，
 * 那些地方由各自的交互动画负责。不支持视图过渡的浏览器直接更新。
 *
 * 每个边界的第一个子节点必须是 DOM 元素，中间不能再隔一层组件外的包裹元素。
 */

/**
 * 页面内容：只在整页换内容（路由切换）时入场和退场。
 * 同一页内的刷新、筛选不触发，由 default="none" 关掉。
 * `page` 用于顶层页面（淡入并升起），`swap` 用于项目内切换分区（原地交叉淡化）。
 * 放在各 page.tsx 里；布局跨导航保留，放在布局里不会触发。
 */
export function PageTransition({ variant = "page", children }: { variant?: "page" | "swap"; children: ReactNode }) {
  return (
    <ViewTransition enter={variant} exit={variant} default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * 列表项：新增的长出来，移除的收回去。
 * 用法：`items.map((item) => <ItemTransition key={item.id}>…</ItemTransition>)`，
 * key 写在这一层，直接放在列表容器下面。
 *
 * `move` 让留下的条目在顺序变化时滑到新位置。React 把「边界里有组件重新渲染」当作更新，
 * 所以只有子组件做了 memo（数据没变就不重渲染）的列表才打开它，否则每次后台刷新
 * 整个列表都会被拍成快照。
 *
 * `name` 给条目一个全页唯一的身份：它从一个容器消失、同时在另一个容器出现时
 * （任务换列），不是一退一进，而是从旧位置滑到新位置。同一条数据在页面上渲染两份
 * （例如表格行和手机卡片）时不要用。
 *
 * 屏幕上有对话框或抽屉时自动停用：快照画在整页之上，会盖住弹层。
 */
export function ItemTransition({
  move = false,
  name,
  children,
}: {
  move?: boolean;
  name?: string;
  children: ReactNode;
}) {
  const covered = useOverlayOpen();
  const item = covered ? "none" : "item";
  return (
    <ViewTransition
      name={name}
      enter={item}
      exit={item}
      update={move ? item : "none"}
      share={name ? item : undefined}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
