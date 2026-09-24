"use client";

import { FolderPlus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { UnsavedChangesProvider, useUnsavedChanges, confirmLeave } from "@/features/tasks/unsaved-changes";
import {
  ApiClientError,
  PROJECT_COLOR,
  ProjectSchema,
  createApiClient,
  type CreateProjectDTO,
  type ProjectColor,
} from "@/contracts";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/features/auth/auth-form";
import { cn } from "@/lib/cn";
import { PROJECT_COLOR_DOT, PROJECT_COLOR_LABEL } from "@/lib/project-color";

/**
 * 创建项目表单（M2 Phase 6，POST /api/v1/projects）。
 *
 * 范式沿用 settings-form：契约层 `createApiClient().post` + 幂等键 + toast +
 * 成功后由父组件 `router.refresh()`（Server Component 重读列表）。
 *
 * 校验分层：客户端预校验只为即时反馈（name 1–80、key `^[A-Z][A-Z0-9]{1,7}$`
 * 自动转大写、description ≤2000），服务端仍是权威（配额/唯一性在事务锁内判定）。
 *
 * 错误映射（docs/05 §3）：
 *  - 400 → fieldErrors 映射到字段 InlineError + 信封 message 驻留；
 *  - 409 PROJECT_KEY_TAKEN → 「该项目标识已被使用」；
 *  - 422 LIMIT_EXCEEDED → 「活跃项目已达上限（10 个）」；
 *  - 401 → 父组件硬跳转登录页；传输失败 → 可重试提示（保留幂等键，见下）。
 *
 * 幂等键（docs/05 §5：commit 仅在业务事务成功后落库）：
 *  - 挂载时生成一次，同一表单实例内的**同内容重试**复用；
 *  - 传输层歧义失败（catch ApiClientError：超时/断网/信封非法）时**保留原键**——
 *    请求可能已在服务端成功提交并落库幂等记录，换键会让重试变成新请求从而创建
 *    重复项目；保留原键则重试命中服务端 replay 分支，返回同一项目；
 *  - 仅在两种「原键已失效」的情形换新键：① 用户修改了表单字段（onChange）——
 *    内容变更后旧键会触发 409 IDEMPOTENCY_CONFLICT；② 服务端明确返回业务错误
 *    （result.ok===false，请求已被拒绝、未落库，无幂等记录可复用）。
 */

const api = createApiClient();

const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;
/** Project.key：2–8 位大写字母数字，首字符为字母（契约 ProjectKeySchema）。 */
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;
/** 活跃项目配额（docs/01 §4，服务端锁内权威校验，此处仅用于文案）。 */
const ACTIVE_PROJECT_LIMIT = 10;

type FieldErrors = { name?: string; key?: string; description?: string };

export type ProjectCreateFormProps = {
  /** 创建成功（toast 已发出）后回调：父组件收起表单并 await router.refresh()。可返回 Promise，表单会等待其完成再解除 loading。 */
  onCreated: () => void | Promise<void>;
  onCancelled: () => void;
  /** 401（会话失效）→ 父组件负责硬跳转登录页。 */
  onUnauthorized: () => void;
};

/**
 * B6 修复：项目创建草稿保护（结构与任务创建表单一致，见 unsaved-changes.tsx）。
 */
export function ProjectCreateForm(props: ProjectCreateFormProps) {
  return (
    <UnsavedChangesProvider>
      <ProjectCreateFormContent {...props} />
    </UnsavedChangesProvider>
  );
}

function ProjectCreateFormContent({
  onCreated,
  onCancelled,
  onUnauthorized,
}: ProjectCreateFormProps) {
  const nameId = useId();
  const keyId = useId();
  const descriptionId = useId();
  const colorId = useId();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ProjectColor>("BLUE");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const keyValid = KEY_PATTERN.test(key);
  const canSubmit =
    trimmedName.length >= 1 &&
    trimmedName.length <= NAME_MAX &&
    keyValid &&
    trimmedDescription.length <= DESCRIPTION_MAX;

  // B6：任一字段被修改或提交在途即视为「不可静默离开」。
  useUnsavedChanges(
    trimmedName.length > 0 || key.length > 0 || trimmedDescription.length > 0 || color !== "BLUE",
    pending,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    // 客户端预校验（服务端仍是权威）：即时反馈，省一次往返。
    const nextErrors: FieldErrors = {};
    if (trimmedName.length < 1) nextErrors.name = "项目名称不能为空。";
    else if (trimmedName.length > NAME_MAX) {
      nextErrors.name = `项目名称不能超过 ${NAME_MAX} 个字符。`;
    }
    if (!keyValid) {
      nextErrors.key = "项目标识须为 2—8 位大写字母或数字，且以字母开头（如 ORB、DEMO2）。";
    }
    if (trimmedDescription.length > DESCRIPTION_MAX) {
      nextErrors.description = `项目描述不能超过 ${DESCRIPTION_MAX} 个字符。`;
    }
    setFieldErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    const body: CreateProjectDTO = { name: trimmedName, key };
    if (trimmedDescription.length > 0) body.description = trimmedDescription;
    body.color = color;

    setPending(true);
    try {
      const result = await api.post("/projects", ProjectSchema, body, { idempotencyKey });
      if (result.ok) {
        setFieldErrors({});
        toast({
          title: "项目已创建",
          description: `${result.data.name}（${result.data.key}）`,
          variant: "success",
        });
        await onCreated();
        return;
      }

      // 业务错误：请求已被服务端拒绝、未落库（幂等记录仅在业务事务成功后 commit），
      // 旧键无 replay 价值；换新键，避免用户修正内容后旧键触发 409 IDEMPOTENCY_CONFLICT。
      setIdempotencyKey(crypto.randomUUID());

      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (result.status === 409 && result.error.code === "PROJECT_KEY_TAKEN") {
        setFieldErrors({ key: "该项目标识已被使用，换一个试试。" });
        setFormError(null);
        return;
      }
      if (result.status === 422 && result.error.code === "LIMIT_EXCEEDED") {
        setFormError(`活跃项目已达上限（${ACTIVE_PROJECT_LIMIT} 个），请先归档不再使用的项目。`);
        return;
      }
      // 其余业务错误：400 fieldErrors 映射到字段 + 信封 message 驻留展示。
      const errors = result.error.fieldErrors;
      setFieldErrors({
        name: firstOf(errors?.name),
        key: firstOf(errors?.key),
        description: firstOf(errors?.description),
      });
      setFormError(result.error.message);
    } catch (error) {
      // 传输层歧义失败（超时/断网/信封非法）：不吞错误，但**保留原幂等键**——
      // 请求可能已在服务端成功提交，换键会让重试创建重复项目；保留原键则重试
      // 命中服务端 replay 分支返回同一项目。仅当用户改动字段（onChange）才换新键。
      setFormError(
        error instanceof ApiClientError
          ? "无法连接服务器，请检查网络后重试。"
          : "创建失败，请稍后重试。",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      noValidate
      className="overflow-hidden rounded-card border border-line bg-surface shadow-popover"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-sunken px-5 py-3">
        <h2 className="text-section font-semibold tracking-tight text-foreground">
          新建项目
        </h2>
        <span className="font-mono text-caption uppercase tracking-widest text-foreground-muted">
          post · /projects
        </span>
      </header>

      <div className="grid gap-5 px-5 py-5 md:grid-cols-2">
        {/* 项目名称 */}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor={nameId}>项目名称</Label>
          <div className="relative">
            <Input
              id={nameId}
              name="name"
              type="text"
              maxLength={NAME_MAX}
              placeholder="例如：毕业设计进度追踪"
              value={name}
              disabled={pending}
              autoFocus
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                // 内容变更：换新幂等键（旧键对应旧内容，复用会撞 409 IDEMPOTENCY_CONFLICT）。
                setIdempotencyKey(crypto.randomUUID());
                if (fieldErrors.name) {
                  setFieldErrors((prev) => ({ ...prev, name: undefined }));
                }
              }}
              className="pr-16"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-caption tabular-nums text-foreground-muted"
            >
              {trimmedName.length}/{NAME_MAX}
            </span>
          </div>
          <InlineError id={`${nameId}-error`}>{fieldErrors.name}</InlineError>
        </div>

        {/* 项目标识 key */}
        <div className="space-y-1.5">
          <Label htmlFor={keyId}>项目标识</Label>
          <Input
            id={keyId}
            name="key"
            type="text"
            autoComplete="off"
            maxLength={8}
            placeholder="ORB"
            value={key}
            disabled={pending}
            aria-invalid={fieldErrors.key ? true : undefined}
            aria-describedby={`${keyId}-hint${fieldErrors.key ? ` ${keyId}-error` : ""}`}
            onChange={(event) => {
              // 自动转大写并过滤非法字符（格式预校验，服务端仍权威判定唯一性）。
              const normalized = event.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 8);
              setKey(normalized);
              // 内容变更：换新幂等键。
              setIdempotencyKey(crypto.randomUUID());
              if (fieldErrors.key) {
                setFieldErrors((prev) => ({ ...prev, key: undefined }));
              }
            }}
            className="font-mono uppercase"
          />
          <p id={`${keyId}-hint`} className="text-caption text-foreground-muted">
            2—8 位大写字母或数字，以字母开头；任务编号将形如 {keyValid ? `${key}-1` : "ORB-1"}。
          </p>
          <InlineError id={`${keyId}-error`}>{fieldErrors.key}</InlineError>
        </div>

        {/* 标记色 */}
        <div className="space-y-1.5">
          <Label htmlFor={colorId}>标记色</Label>
          <Select
            value={color}
            onValueChange={(value) => {
              setColor(value as ProjectColor);
              // 内容变更：换新幂等键。
              setIdempotencyKey(crypto.randomUUID());
            }}
            disabled={pending}
          >
            <SelectTrigger id={colorId} aria-label="项目标记色">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_COLOR.map((option) => (
                <SelectItem key={option} value={option}>
                  <span
                    className={cn(
                      "inline-block h-2.5 w-2.5 rounded-full",
                      PROJECT_COLOR_DOT[option],
                    )}
                    aria-hidden="true"
                  />
                  {PROJECT_COLOR_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-caption text-foreground-muted">
            用于侧栏与列表中的项目圆点标识。
          </p>
        </div>

        {/* 描述（可选） */}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor={descriptionId}>
            项目描述<span className="ml-1 text-foreground-muted">（可选）</span>
          </Label>
          <Textarea
            id={descriptionId}
            name="description"
            rows={3}
            maxLength={DESCRIPTION_MAX}
            placeholder="这个项目要达成什么？（不会出现在任务编号里）"
            value={description}
            disabled={pending}
            aria-invalid={fieldErrors.description ? true : undefined}
            aria-describedby={fieldErrors.description ? `${descriptionId}-error` : undefined}
            onChange={(event) => {
              setDescription(event.target.value);
              // 内容变更：换新幂等键。
              setIdempotencyKey(crypto.randomUUID());
              if (fieldErrors.description) {
                setFieldErrors((prev) => ({ ...prev, description: undefined }));
              }
            }}
          />
          <InlineError id={`${descriptionId}-error`}>{fieldErrors.description}</InlineError>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-sunken px-5 py-4">
        <Button type="submit" disabled={!canSubmit || pending} aria-busy={pending || undefined}>
          {pending ? <Spinner /> : <FolderPlus className="h-4 w-4" aria-hidden="true" />}
          <span>{pending ? "正在创建…" : "创建项目"}</span>
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => { if (confirmLeave()) onCancelled(); }}>
          <X className="h-4 w-4" aria-hidden="true" />
          取消
        </Button>
        <p className="ml-auto text-caption text-foreground-muted">
          活跃项目上限 {ACTIVE_PROJECT_LIMIT} 个（服务端校验）
        </p>
      </footer>

      <div className="px-5 pb-4">
        <InlineError>{formError}</InlineError>
      </div>
    </form>
  );
}

/** 取字段错误数组的第一条（信封 fieldErrors 是 string[]）。 */
function firstOf(values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  return values[0];
}
