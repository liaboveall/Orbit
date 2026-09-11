"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArchiveRestore, Save } from "lucide-react";
import {
  ApiClientError,
  ProjectSchema,
  createApiClient,
  type ProjectDTO,
} from "@/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineError } from "@/components/ui/inline-error";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/features/auth/auth-form";
import { loginPathWithReturnTo } from "@/lib/return-to";

/**
 * 项目设置表单（M4 / ORB-007，`/app/projects/[id]/settings`，owner-only）。
 *
 * 两类写操作，均走 PATCH /api/v1/projects/{id}（契约 UpdateProjectSchema：expectedVersion
 * 必填 + 至少再带一个可修改字段）：
 *  1. 资料编辑：{expectedVersion, name, description} —— 归档项目只读，禁用编辑；
 *  2. 归档/恢复：{expectedVersion, archived} —— 二次确认对话框，恢复不受只读限制。
 *
 * 乐观并发（docs/05 §3）：expectedVersion 取自 props（Server Component 权威读取，
 * router.refresh() 后为最新）；409 VERSION_CONFLICT → 提示并 refresh 拉取最新版本。
 * 成功后 toast + `router.refresh()` 让 Server Component 重读项目（props 是唯一数据真源）。
 *
 * 边界（features 层）：不导入 @/server / @/generated。
 */

const api = createApiClient();
const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;

export type ProjectSettingsFormProps = {
  project: ProjectDTO;
};

export function ProjectSettingsForm({ project }: ProjectSettingsFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const archived = project.archivedAt !== null;
  const settingsPath = `/app/projects/${project.id}/settings`;

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const profileDirty =
    trimmedName !== project.name || trimmedDescription !== project.description;
  const profileValid =
    trimmedName.length >= 1 &&
    trimmedName.length <= NAME_MAX &&
    trimmedDescription.length <= DESCRIPTION_MAX;

  function goToLogin(): void {
    window.location.assign(loginPathWithReturnTo(settingsPath));
  }

  async function handleSaveProfile(): Promise<void> {
    if (savingProfile || !profileValid || archived) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      const result = await api.patch(`/projects/${project.id}`, ProjectSchema, {
        expectedVersion: project.version,
        name: trimmedName,
        description: trimmedDescription,
      });
      if (result.ok) {
        toast({ title: "项目设置已保存", variant: "success" });
        await router.refresh();
        return;
      }
      if (result.status === 401) {
        goToLogin();
        return;
      }
      if (result.status === 409 && result.error.code === "VERSION_CONFLICT") {
        setProfileError("项目已被他人更新，已为你刷新到最新版本，请重新保存。");
        await router.refresh();
        return;
      }
      setProfileError(result.error.message);
    } catch (err) {
      setProfileError(
        err instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "保存失败，请稍后重试。",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleToggleArchive(): Promise<void> {
    if (archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const result = await api.patch(`/projects/${project.id}`, ProjectSchema, {
        expectedVersion: project.version,
        archived: !archived,
      });
      if (result.ok) {
        setArchiveOpen(false);
        toast({
          title: archived ? "项目已恢复" : "项目已归档",
          variant: "success",
        });
        await router.refresh();
        return;
      }
      if (result.status === 401) {
        goToLogin();
        return;
      }
      if (result.status === 409 && result.error.code === "VERSION_CONFLICT") {
        setArchiveError("项目已被他人更新，已为你刷新到最新版本，请重试。");
        setArchiveOpen(false);
        await router.refresh();
        return;
      }
      setArchiveError(result.error.message);
    } catch (err) {
      setArchiveError(
        err instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "操作失败，请稍后重试。",
      );
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 项目资料 */}
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-popover">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-sunken px-5 py-3">
          <h2 className="text-section font-semibold tracking-tight text-foreground">
            项目资料
          </h2>
          <span className="font-mono text-caption uppercase tracking-widest text-foreground-muted">
            patch · /projects/{project.id}
          </span>
        </header>

        <div className="space-y-5 px-5 py-5">
          {archived ? (
            <InlineError>
              项目已归档，处于只读状态。恢复项目后才能编辑资料。
            </InlineError>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="project-name">项目名称</Label>
            <Input
              id="project-name"
              name="name"
              type="text"
              maxLength={NAME_MAX}
              value={name}
              disabled={savingProfile || archived}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-caption text-foreground-muted">
              显示在侧栏、列表与看板页头（{trimmedName.length}/{NAME_MAX}）。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-description">
              项目描述<span className="ml-1 text-foreground-muted">（可选）</span>
            </Label>
            <Textarea
              id="project-description"
              name="description"
              rows={3}
              maxLength={DESCRIPTION_MAX}
              value={description}
              disabled={savingProfile || archived}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <InlineError>{profileError}</InlineError>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!profileDirty || !profileValid || savingProfile || archived}
              aria-busy={savingProfile || undefined}
              onClick={() => {
                void handleSaveProfile();
              }}
            >
              {savingProfile ? <Spinner /> : <Save className="h-4 w-4" aria-hidden="true" />}
              <span>{savingProfile ? "正在保存…" : "保存修改"}</span>
            </Button>
            {profileDirty && !savingProfile ? (
              <Button
                type="button"
                variant="ghost"
                disabled={archived}
                onClick={() => {
                  setName(project.name);
                  setDescription(project.description);
                  setProfileError(null);
                }}
              >
                重置
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* 归档 / 恢复 */}
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-popover">
        <header className="border-b border-line bg-surface-sunken px-5 py-3">
          <h2 className="text-section font-semibold tracking-tight text-foreground">
            {archived ? "恢复项目" : "归档项目"}
          </h2>
        </header>
        <div className="space-y-4 px-5 py-5">
          <p className="text-label leading-relaxed text-foreground-secondary">
            {archived
              ? "该项目当前已归档，处于只读状态。恢复后即可继续编辑任务与设置。"
              : "归档后项目进入只读状态：无法创建或修改任务、邀请与设置，但历史内容全部保留。可随时恢复。"}
          </p>
          <InlineError>{archiveError}</InlineError>
          <Button
            type="button"
            variant={archived ? "primary" : "danger"}
            onClick={() => {
              setArchiveError(null);
              setArchiveOpen(true);
            }}
          >
            {archived ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Archive className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{archived ? "恢复项目" : "归档项目"}</span>
          </Button>
        </div>
      </section>

      {/* 归档 / 恢复确认对话框 */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{archived ? "恢复项目" : "归档项目"}</DialogTitle>
            <DialogDescription>
              {archived
                ? `确定恢复「${project.name}」吗？恢复后项目将重新变为可编辑状态。`
                : `确定归档「${project.name}」吗？归档后项目将变为只读，无法创建或修改其中的任务、邀请与设置。你可以随时恢复。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={archiving}
              onClick={() => setArchiveOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={archived ? "primary" : "danger"}
              disabled={archiving}
              aria-busy={archiving || undefined}
              onClick={() => {
                void handleToggleArchive();
              }}
            >
              {archiving ? <Spinner /> : null}
              <span>
                {archiving ? "正在处理…" : archived ? "确认恢复" : "确认归档"}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
