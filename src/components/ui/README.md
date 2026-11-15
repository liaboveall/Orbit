# 通用界面组件

基于 Radix UI、Lucide 和共享设计变量的按钮、表单控件、弹窗、抽屉、菜单、提示、分段选择与状态组件。

动效相关的有 `transitions.tsx`（路由和列表的视图过渡边界）、`check-mark.tsx`、`animated-number.tsx`、`use-hotkey.ts`（页面级单键快捷键）和 `overlay-presence.ts`（有弹层时暂停列表过渡）。

业务组件放在 src/features；这里维护跨功能复用的视觉与交互行为，包括键盘操作、焦点返回和无障碍语义。规范见 [交互与设计](../../../docs/02-UX-AND-DESIGN.md)。
