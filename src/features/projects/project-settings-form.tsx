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
  const [conflictPending, setConflictPending] = useState(false);
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
    // 🛡️ R1 修复补充：冲突待处理时，禁止任何保存操作
    // 原因：baseline.version 可能已落后于远程，盲目提交会导致数据丢失
    if (savingProfile || archiving || conflictPending || fetchingRemote || !profileValid || archived) return;
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
        setConflictPending(true);
        await handleRetryFetchRemote();
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
    setRemoteConflict(null);
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
        // ⚠️ R1 修复补充：GET 失败时不清除 conflictPending
        // 原因：baseline 仍停留在旧版本，此时若用户重试 PATCH，会导致旧草稿覆盖远端新数据
        // 策略：保持 conflictPending=true，直到成功获取远端内容或用户重置
      }
    } catch (err) {
      const message = err instanceof ApiClientError 
        ? (err.status === 500 ? "服务器错误，无法获取远端内容。请重试或保留草稿。" : err.message)
        : "网络错误，请检查连接后重试。";
      setRemoteFetchError(message);
      // ⚠️ 关键 R1 修复：GET 失败时严禁推进 baseline.version
      // 原因：若隐式升版 (如从 1→2)，用户未见到远端内容即再次保存，
      //       会用旧草稿的字段值覆盖远端新修改 (如 name="Local draft")
      // 策略：保持 baseline 停留在冲突发生前的版本，等待用户决策
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
    setConflictPending(false);
    setRemoteFetchError(null);
    setProfileError(null);
  }

  /** Explicitly rebase only the user's edited fields after reviewing the remote snapshot. */
  function keepDraftAgainstRemote(): void {
    if (!remoteConflict) return;
    if (trimmedName === baseline.name) setName(remoteConflict.name);
    if (trimmedDescription === baseline.description) setDescription(remoteConflict.description);
    setBaseline({...remoteConflict});
    setRemoteConflict(null);
    setConflictPending(false);
    setRemoteFetchError(null);
    setProfileError(null);
  }

  async function handleToggleArchive(): Promise<void> {
    if (archiving || savingProfile || conflictPending) return;
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
        if (trimmedName === baseline.name) setName(result.data.name);
        if (trimmedDescription === baseline.description) setDescription(result.data.description);
        setBaseline({name: result.data.name, description: result.data.description, version: result.data.version});
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
              disabled={savingProfile || archiving || fetchingRemote || archived}
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
              disabled={savingProfile || archiving || fetchingRemote || archived}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <InlineError>{profileError}</InlineError>

          {conflictPending ? (
            <div className="space-y-3 rounded-card border border-warning/30 bg-warning-soft p-4">
              <InlineError>{remoteFetchError}</InlineError>
              <Button type="button" variant="secondary" disabled={fetchingRemote || savingProfile} onClick={() => void handleRetryFetchRemote()}>
                {fetchingRemote ? "正在获取远端内容…" : "重新获取远端内容"}
              </Button>
              {remoteConflict ? (
                <>
                  <p>远端最新内容（version {remoteConflict.version}）</p>
                  <p className="whitespace-pre-wrap break-words">{remoteConflict.name}</p>
                  <p className="whitespace-pre-wrap break-words">{remoteConflict.description || "（空）"}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={acceptRemoteAndRetry}>采用远端内容重新编辑</Button>
                    <Button type="button" variant="secondary" onClick={keepDraftAgainstRemote}>保留我的修改并重试</Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!profileDirty || !profileValid || savingProfile || archiving || conflictPending || archived}
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
            disabled={savingProfile || conflictPending || archiving}
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
