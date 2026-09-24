"use client";

import { Plus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { UnsavedChangesProvider, useUnsavedChanges, confirmLeave } from "../unsaved-changes";
import {
  ApiClientError,
  TASK_PRIORITY,
  TASK_STATUS,
  TaskSchema,
  createApiClient,
  type CreateTaskDTO,
  type TaskPriority,
  type TaskStatus,
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
import { PRIORITY_LABEL, STATUS_LABEL } from "@/features/tasks/task-meta";

/**
 * 创建任务表单（M2 Phase 6，POST /api/v1/projects/{projectId}/tasks）。
 *
 * 范式沿用 settings-form / project-create-form：契约层 api.post + 幂等键 +
 * toast + 成功后父组件 `router.refresh()`。
 *
 * 校验分层：客户端预校验 title 1–120（必填）、description ≤10000、dueDate 为
 * 合法 YYYY-MM-DD（date input 保证，空值 = 无截止）；服务端仍是权威
 * （成员/归档/配额/负责人在事务锁内判定）。
 *
 * 错误映射：400 → fieldErrors；409 PROJECT_ARCHIVED → 归档只读提示；
 * 422 LIMIT_EXCEEDED → 未删除任务达上限（1000）；401 → 父组件硬跳转登录。
 *
 * 幂等键（docs/05 §5：commit 仅在业务事务成功后落库）：挂载时生成一次，
 * 同内容重试复用；传输层歧义失败（catch ApiClientError）时**保留原键**（请求
 * 可能已服务端提交，换键会创建重复任务；保留则重试命中 replay）；仅当用户改动
 * 字段（onChange）或服务端明确返回业务错误（result.ok===false，未落库）时换新键。
 */

const api = createApiClient();

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 10000;
/** 每项目未删除任务上限（docs/01 §6，服务端锁内权威校验，此处仅用于文案）。 */
const OPEN_TASK_LIMIT = 1000;

type FieldErrors = { title?: string; description?: string; dueDate?: string };

export type TaskCreateFormProps = {
  projectId: string;
  /** 创建成功（toast 已发出）后回调：父组件收起表单并发起路由刷新。可返回 Promise，用于等待额外的提交后操作。 */
  onCreated: () => void | Promise<void>;
  onCancelled: () => void;
  /** 401（会话失效）→ 父组件负责硬跳转登录页。 */
  onUnauthorized: () => void;
};

/**
 * B6 修复：任务创建草稿保护。Provider 安装链接点击/关闭/前进后退守卫；
 * 内容组件经 useUnsavedChanges 注册 dirty/pending，程序化导航经模块级
 * confirmLeave 询问（草稿只在组件内存，不写 URL / 不进共享缓存）。
 */
export function TaskCreateForm(props: TaskCreateFormProps) {
  return (
    <UnsavedChangesProvider>
      <TaskCreateFormContent {...props} />
    </UnsavedChangesProvider>
  );
}

function TaskCreateFormContent({
  projectId,
  onCreated,
  onCancelled,
  onUnauthorized,
}: TaskCreateFormProps) {
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const priorityId = useId();
  const dueDateId = useId();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  /** date input 的值（YYYY-MM-DD 或空 = 无截止日）。 */
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const canSubmit =
    trimmedTitle.length >= 1 &&
    trimmedTitle.length <= TITLE_MAX &&
    trimmedDescription.length <= DESCRIPTION_MAX;

  // B6：任一字段被修改或提交在途即视为「不可静默离开」；成功创建后父组件收起表单，
  // 组件卸载自动解除保护。
  useUnsavedChanges(
    trimmedTitle.length > 0 ||
      trimmedDescription.length > 0 ||
      status !== "TODO" ||
      priority !== "MEDIUM" ||
      dueDate.length > 0,
    pending,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    // 客户端预校验（服务端仍是权威）：即时反馈，省一次往返。
    const nextErrors: FieldErrors = {};
    if (trimmedTitle.length < 1) nextErrors.title = "任务标题不能为空。";
    else if (trimmedTitle.length > TITLE_MAX) {
      nextErrors.title = `任务标题不能超过 ${TITLE_MAX} 个字符。`;
    }
    if (trimmedDescription.length > DESCRIPTION_MAX) {
      nextErrors.description = `任务描述不能超过 ${DESCRIPTION_MAX} 个字符。`;
    }
    if (dueDate.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      nextErrors.dueDate = "截止日格式无效，请使用日期选择器。";
    }
    setFieldErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    const body: CreateTaskDTO = { title: trimmedTitle, status, priority };
    if (trimmedDescription.length > 0) body.description = trimmedDescription;
    if (dueDate.length > 0) body.dueDate = dueDate;

    setPending(true);
    try {
      const result = await api.post(
        `/projects/${projectId}/tasks`,
        TaskSchema,
        body,
        { idempotencyKey },
      );
      if (result.ok) {
        setFieldErrors({});
        toast({
          title: "任务已创建",
          description: `${result.data.identifier} · ${result.data.title}`,
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
      if (result.status === 409 && result.error.code === "PROJECT_ARCHIVED") {
        setFormError("项目已归档，处于只读状态，无法创建任务。");
        return;
      }
      if (result.status === 422 && result.error.code === "LIMIT_EXCEEDED") {
        setFormError(`未删除任务已达上限（${OPEN_TASK_LIMIT} 个），请删除不再需要的任务，或联系项目所有者处理。`);
        return;
      }
      // 其余业务错误：400 fieldErrors 映射到字段 + 信封 message 驻留展示。
      const errors = result.error.fieldErrors;
      setFieldErrors({
        title: firstOf(errors?.title),
        description: firstOf(errors?.description),
        dueDate: firstOf(errors?.dueDate),
      });
      setFormError(result.error.message);
    } catch (error) {
      // 传输层歧义失败（超时/断网/信封非法）：不吞错误，但**保留原幂等键**——
      // 请求可能已在服务端成功提交，换键会让重试创建重复任务；保留原键则重试
      // 命中服务端 replay 分支返回同一任务。仅当用户改动字段（onChange）才换新键。
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
          新建任务
        </h2>
        <span className="font-mono text-caption uppercase tracking-widest text-foreground-muted">
          post · /projects/:id/tasks
        </span>
      </header>

      <div className="grid gap-5 px-5 py-5 md:grid-cols-2">
        {/* 标题 */}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor={titleId}>任务标题</Label>
          <div className="relative">
            <Input
              id={titleId}
              name="title"
              type="text"
              maxLength={TITLE_MAX}
              placeholder="例如：完成活动详情页的报名表单校验"
              value={title}
              disabled={pending}
              autoFocus
              aria-invalid={fieldErrors.title ? true : undefined}
              aria-describedby={fieldErrors.title ? `${titleId}-error` : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                // 内容变更：换新幂等键（旧键对应旧内容，复用会撞 409 IDEMPOTENCY_CONFLICT）。
                setIdempotencyKey(crypto.randomUUID());
                if (fieldErrors.title) {
                  setFieldErrors((prev) => ({ ...prev, title: undefined }));
                }
              }}
              className="pr-20"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-caption tabular-nums text-foreground-muted"
            >
              {trimmedTitle.length}/{TITLE_MAX}
            </span>
          </div>
          <InlineError id={`${titleId}-error`}>{fieldErrors.title}</InlineError>
        </div>

        {/* 状态 */}
        <div className="space-y-1.5">
          <Label htmlFor={statusId}>状态</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as TaskStatus);
              // 内容变更：换新幂等键。
              setIdempotencyKey(crypto.randomUUID());
            }}
            disabled={pending}
          >
            <SelectTrigger id={statusId} aria-label="任务状态">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUS.map((option) => (
                <SelectItem key={option} value={option}>
                  {STATUS_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 优先级 */}
        <div className="space-y-1.5">
          <Label htmlFor={priorityId}>优先级</Label>
          <Select
            value={priority}
            onValueChange={(value) => {
              setPriority(value as TaskPriority);
              // 内容变更：换新幂等键。
              setIdempotencyKey(crypto.randomUUID());
            }}
            disabled={pending}
          >
            <SelectTrigger id={priorityId} aria-label="任务优先级">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITY.map((option) => (
                <SelectItem key={option} value={option}>
                  {PRIORITY_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 截止日 */}
        <div className="space-y-1.5">
          <Label htmlFor={dueDateId}>
            截止日<span className="ml-1 text-foreground-muted">（可选）</span>
          </Label>
          <Input
            id={dueDateId}
            name="dueDate"
            type="date"
            value={dueDate}
            disabled={pending}
            aria-invalid={fieldErrors.dueDate ? true : undefined}
            aria-describedby={fieldErrors.dueDate ? `${dueDateId}-error` : undefined}
            onChange={(event) => {
              setDueDate(event.target.value);
              // 内容变更：换新幂等键。
              setIdempotencyKey(crypto.randomUUID());
              if (fieldErrors.dueDate) {
                setFieldErrors((prev) => ({ ...prev, dueDate: undefined }));
              }
            }}
          />
          <p className="text-caption text-foreground-muted">
            按 UTC 日期存储，逾期/今天到期语义与服务端一致。
          </p>
          <InlineError id={`${dueDateId}-error`}>{fieldErrors.dueDate}</InlineError>
        </div>

        {/* 描述（可选） */}
        <div className="space-y-1.5">
          <Label htmlFor={descriptionId}>
            描述<span className="ml-1 text-foreground-muted">（可选）</span>
          </Label>
          <Textarea
            id={descriptionId}
            name="description"
            rows={4}
            maxLength={DESCRIPTION_MAX}
            placeholder="补充上下文、验收标准或链接"
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
          {pending ? <Spinner /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          <span>{pending ? "正在创建…" : "创建任务"}</span>
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => { if (confirmLeave()) onCancelled(); }}>
          <X className="h-4 w-4" aria-hidden="true" />
          取消
        </Button>
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
