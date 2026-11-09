/**
 * src/components/ui 统一导出（ORB-002）。
 *
 * 通用视觉原语：基于 Radix primitives + lucide-react，样式全部消费 tokens（docs/02 §2、docs/03 §1）。
 * 只选一种组件原语体系（Radix），不自造不可访问的弹窗/菜单/下拉。
 * 业务组件（AppShell、TaskCard、ProjectHeader 等）在 src/features 下按领域组织。
 */

export * from "./button";
export * from "./input";
export * from "./badge";
export * from "./skeleton";
export * from "./empty-state";
export * from "./inline-error";
export * from "./pagination";
export * from "./avatar";
export * from "./tooltip";
export * from "./dialog";
export * from "./drawer";
export * from "./dropdown-menu";
export * from "./tabs";
export * from "./select";
export * from "./toast";
export * from "./use-focus-return";
export * from "./segments";
export * from "./page-header";
export * from "./link-label";
