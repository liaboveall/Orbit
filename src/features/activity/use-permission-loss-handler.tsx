"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { clearProjectDrafts } from "@/features/tasks/draft-storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type PermissionLossReason = "removed" | "expired" | "revoked";

export type UsePermissionLossOptions = {
  /** 监听权限变化的项目 ID（仅用于 401 回跳 returnTo）。 */
  projectId: string;
  /** 检测到权限丢失时的回调（同步调用，无自动跳转定时器）。 */
  onLoss?: (reason: PermissionLossReason) => void;
};

/**
 * 权限丢失检测与恢复（F22 修复）。
 *
 * 与旧实现的差异：
 *  - **移除 300ms 自动强跳与无效定时器**：检测到 401/403 后只置状态、弹遮罩，
 *    由用户点击选择去向（按钮可达、可键盘操作）；
 *  - **401 与 403 分流**：401（会话过期）引导重新登录并保留 returnTo；
 *    403/被移除（revoked/removed）退出项目回「全部项目」，不再跳登录页
 *    （会话仍有效时登录页会立即弹回，形成登录循环）；
 *  - 组件卸载（用户自行导航离开）不触发任何跳转，不会跳回旧项目。
 */
export function usePermissionLossHandler({ projectId, onLoss }: UsePermissionLossOptions) {
  const router = useRouter();

  const [permissionLossReason, setPermissionLossReason] = useState<PermissionLossReason | null>(
    null,
  );

  /**
   * 数据请求收到 401/403 时调用：置权限丢失状态并弹出恢复遮罩。
   * reason 语义：expired=会话失效（401）；removed/revoked=被移出或无权限（403）。
   */
  const handlePermissionError = (
    error: Error,
    reason: PermissionLossReason = "removed",
  ): void => {
    void error;
    void projectId; // 保留入参形状；回跳目标见 goToLogin（当前页作为 returnTo）。
    onLoss?.(reason);
    setPermissionLossReason(reason);
  };

  /** 清除权限丢失状态（用户显式选择留下时使用）。 */
  const clearPermissionError = (): void => {
    setPermissionLossReason(null);
  };

  /** 401（会话失效）：带 returnTo 前往登录页；登录后回到当前页面。 */
  const goToLogin = (): void => {
    setPermissionLossReason(null);
    router.push(loginPathWithReturnTo(location.pathname + location.search));
  };

  /** 403/被移除：离开本项目，回到可访问的「全部项目」列表（私有数据不再展示）。 */
  const leaveProject = (): void => {
    setPermissionLossReason(null);
    // 失去项目访问：该项目的本机任务草稿不再可保存，离开时删除。
    clearProjectDrafts(projectId);
    router.push("/app/projects");
  };

  return {
    hasPermissionError: permissionLossReason !== null,
    permissionLossReason,
    handlePermissionError,
    clearPermissionError,
    goToLogin,
    leaveProject,
  };
}

/**
 * 权限丢失恢复遮罩（F22 修复）：用现有 Dialog 原语提供焦点陷阱 / Escape / 焦点恢复，
 * 样式全部来自设计 token（不再使用 bg-black/50、text-red-500 等脱离 token 的组合）。
 *  - expired（401）：「前往登录」为主操作，可留在当前页；
 *  - removed/revoked（403）：唯一出口是「返回全部项目」，Escape 同样离开，
 *    不保留旧项目的私有活动列表。
 */
export function PermissionLossOverlay({
  isVisible,
  reason,
  onDismiss,
  onGoToLogin,
  onLeaveProject,
}: {
  isVisible: boolean;
  reason: PermissionLossReason;
  onDismiss: () => void;
  onGoToLogin: () => void;
  onLeaveProject: () => void;
}) {
  const expired = reason === "expired";

  const handleOpenChange = (open: boolean): void => {
    if (open) return;
    // Escape / 遮罩点击：expired 允许留下；被移除则必须离开（不残留私有数据）。
    if (expired) onDismiss();
    else onLeaveProject();
  };

  return (
    <Dialog open={isVisible} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{expired ? "登录状态已失效" : "访问权限失效"}</DialogTitle>
          <DialogDescription>
            {expired
              ? "你的会话可能已过期。重新登录后，我们会把你带回原来的页面。"
              : "你已不再属于此项目，无法继续查看其活动。项目列表仍可正常访问。"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {expired ? (
            <Button variant="secondary" onClick={onDismiss}>
              留在本页
            </Button>
          ) : null}
          {expired ? (
            <Button onClick={onGoToLogin}>前往登录</Button>
          ) : (
            <Button onClick={onLeaveProject}>返回全部项目</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
