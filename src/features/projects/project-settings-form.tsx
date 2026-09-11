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
  // 编辑基准：仅随「成功保存」或「用户显式重置」前进，refresh 后的新 project.version/
  // project.name/description 不会隐式覆盖草稿（否则冲突后无条件重新提交会把未修改字段
  // 一并带上旧草稿值，参见 A06 审查报告）。
  const [baseline, setBaseline] = useState({
    name: project.name,
    description: project.description,
    version: project.version,
  });
  // 冲突后展示的远端最新值（供用户核对，不自动合并进输入框）。
  const [remoteConflict, setRemoteConflict] = useState<{
    version: number;
    name: string;
    description: string;
  } | null>(null);
  // 重试获取远端内容时的状态
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [remoteFetchError, setRemoteFetchError] = useState<string | null>(null);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const archived = project.archivedAt !== null;
  const settingsPath = `/app/projects/${project.id}/settings`;

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const profileDirty =
    trimmedName !== baseline.name || trimmedDescription !== baseline.description;
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
      // 只提交相对编辑基准实际变化的字段，不把未修改字段的旧草稿值一起带上
      // （否则冲突后仅刷新 version 重新提交会用旧草稿覆盖远端在此期间的其它字段改动）。
      const patch: { expectedVersion: number; name?: string; description?: string } = {
        expectedVersion: baseline.version,
      };
      if (trimmedName !== baseline.name) patch.name = trimmedName;
      if (trimmedDescription !== baseline.description) patch.description = trimmedDescription;

      const result = await api.patch(`/projects/${project.id}`, ProjectSchema, patch);
      if (result.ok) {
        toast({ title: "项目设置已保存", variant: "success" });
        setBaseline({
          name: result.data.name,
          description: result.data.description,
          version: result.data.version,
        });
        setRemoteConflict(null);
        setName(result.data.name);
        setDescription(result.data.description);
        await router.refresh();
        return;
      }
      if (result.status === 401) {
        goToLogin();
        return;
      }
      if (result.status === 409 && result.error.code === "VERSION_CONFLICT") {
        // 遭遇 409 冲突：尝试获取远端最新内容供用户核对。
        // 关键点：不自动推进 baseline.version（无论 GET 成功或失败）！
        // 这样做的目的：
        // 1. 防止用户在无法核对远端改了什么的情况下被强制覆盖
        // 2. 避免远程获取失败后 baseline 仍被推进，导致后续提交使用错误的 expectedVersion
        // 3. 必须由用户显式选择「采用远端」才更新 baseline（acceptRemoteAndRetry 是唯一路径）
        try {
          const latest = await api.get(`/projects/${project.id}`, ProjectSchema);
          if (latest.ok) {
            // 成功获取远端内容，设置为 remoteConflict 用于展示对比 UI
            // 注意：此处不更新 baseline.version！由 acceptRemoteAndRetry() 处理
            setRemoteConflict({
              version: latest.data.version,
              name: latest.data.name,
              description: latest.data.description,
            });
          } else {
            // GET 非 ok 响应（如 500/404）→ 视为网络错误，显示在 UI 上供用户重试
            // 注意：即使是非 ok 响应，也可能有 data 字段用于展示
            // 但根据 ApiFailure 类型定义，它没有 data 字段，所以我们需要特殊处理
            setProfileError(
              "获取远端最新版本失败。你的输入已保留，点击\"重新获取远端内容\"按钮重试。"
            );
            return;
          }
        } catch {
          // GET 失败：不自动推进 baseline.version，避免用户无法核对远端改了什么
          setProfileError(
            "获取远端最新版本失败。你的输入已保留，点击\"重新获取远端内容\"按钮重试。"
          );
          return;
        }
        setProfileError(
          "项目已被他人更新。你的输入已保留，请核对下方远端最新内容后决定是否覆盖再保存。",
        );
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

  /**
   * 重试获取远端内容，用于首次 GET 失败时由用户触发重新拉取。
   */
  async function handleRetryFetchRemote(): Promise<void> {
    setFetchingRemote(true);
    setRemoteFetchError(null);
    
    try {
      const latest = await api.get(`/projects/${project.id}`, ProjectSchema);
      if (latest.ok) {
        // 成功获取，设置 remoteConflict 用于显示给用户
        setRemoteConflict({
          version: latest.data.version,
          name: latest.data.name,
          description: latest.data.description,
        });
        // 注意：此时不更新 baseline.version！由 acceptRemoteAndRetry() 处理
      } else {
        setRemoteFetchError(`获取失败 (${latest.status})，请检查服务器连接。`);
      }
    } catch (err) {
      setRemoteFetchError(err instanceof ApiClientError ? err.message : "网络错误，请重试。");
    } finally {
      setFetchingRemote(false);
    }
  }

  /** 用户核对远端最新值后，显式确认基于远端重新编辑（丢弃自己冲突的草稿字段）。 */
  function acceptRemoteAndRetry(): void {
    if (!remoteConflict) return;
    setBaseline({
      name: remoteConflict.name,
      description: remoteConflict.description,
      version: remoteConflict.version,
    });
    setName(remoteConflict.name);
    setDescription(remoteConflict.description);
    setRemoteConflict(null);
    setProfileError(null);
  }

  async function handleToggleArchive(): Promise<void> {
    if (archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const result = await api.patch(`/projects/${project.id}`, ProjectSchema, {
        expectedVersion: baseline.version,
        archived: !archived,
      });
      if (result.ok) {
        setArchiveOpen(false);
        toast({
          title: archived ? "项目已恢复" : "项目已归档",
          variant: "success",
        });
        setBaseline({
          name: result.data.name,
          description: result.data.description,
          version: result.data.version,
        });
        await router.refresh();
        return;
      }
      if (result.status === 401) {
        goToLogin();
        return;
      }
      if (result.status === 409 && result.error.code === "VERSION_CONFLICT") {
        setArchiveError("项目已被他人更新，请刷新页面确认最新状态后重试。");
        setArchiveOpen(false);
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

          {remoteConflict ? (
            <div className="space-y-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-3">
              <p className="text-label font-medium text-foreground">
                远端检测到更改（version {remoteConflict.version}）：
              </p>
              
              {/* 显示远端 vs 本地的对比 */}
              <div className="space-y-3">
                <div>
                  <span className="text-caption text-foreground-muted">名称 - 远端：</span>
                  <span className="font-medium text-foreground">{remoteConflict.name}</span>
                </div>
                <div>
                  <span className="text-caption text-foreground-muted">名称 - 你的输入：</span>
                  <span className="font-medium text-primary">{name}</span>
                </div>
                {trimmedDescription !== baseline.description && (
                  <>
                    <div>
                      <span className="text-caption text-foreground-muted">描述 - 远端：</span>
                      <span className="font-medium text-foreground break-words inline-block">{remoteConflict.description || "（空）"}</span>
                    </div>
                    <div>
                      <span className="text-caption text-foreground-muted">描述 - 你的输入：</span>
                      <span className="font-medium text-primary break-words inline-block">{description}</span>
                    </div>
                  </>
                )}
              </div>
              
              {remoteFetchError && (
                <div className="rounded-card bg-warning p-4 border border-warning-border">
                  <p className="text-caption text-warning-text mb-2">
                    {remoteFetchError}
                  </p>
                  <Button
                    type="button"
                    onClick={handleRetryFetchRemote}
                    variant="secondary"
                    disabled={fetchingRemote}
                  >
                    {fetchingRemote ? (
                      <><Spinner /> 重新获取...</>
                    ) : (
                      "重新获取远端内容"
                    )}
                  </Button>
                </div>
              )}
              
              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  type="button"
                  onClick={acceptRemoteAndRetry}
                  disabled={!!remoteFetchError}
                  variant="secondary"
                >
                  采用远端内容重新编辑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setRemoteConflict(null);
                    setRemoteFetchError(null);
                    setProfileError(null);
                  }}
                >
                  保留我的输入，稍后重试
                </Button>
              </div>
            </div>
          ) : null}

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
                  setName(baseline.name);
                  setDescription(baseline.description);
                  setProfileError(null);
                  setRemoteConflict(null);
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
