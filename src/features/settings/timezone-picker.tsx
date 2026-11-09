"use client";

import { Check, ChevronsUpDown, MonitorSmartphone, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { cn } from "@/lib/cn";
import {
  deviceTimezone,
  filterTimezoneOptions,
  type TimezoneOption,
} from "./timezones";

/**
 * 时区选择器（M1 / ORB-006）：可搜索组合框（combobox）。
 *
 * 为什么不用 Radix Select：IANA 完整列表有 400+ 项，必须支持输入过滤，
 * 而 Select 的语义是「从固定短列表中挑一个」，不含过滤框。这里按
 * WAI-ARIA APG 的「可编辑组合框 + 列表」模式实现，键盘完全可操作：
 *  - `role="combobox"` + `aria-expanded` / `aria-controls` / `aria-autocomplete="list"`；
 *  - 高亮项经 `aria-activedescendant` 宣告（焦点始终留在输入框，不搬移）；
 *  - ↑ ↓ 移动高亮、Home/End 跳首尾、Enter 选中、Esc 关闭并还原、Tab 关闭并离开；
 *  - 选项用 `onPointerDown` 阻止默认，避免鼠标点击先触发 blur 把列表关掉。
 *
 * 边界：本文件属 features，不导入 @/server；时区数据来自 ./timezones（客户端安全）。
 */

export type TimezonePickerProps = {
  /** 关联 label 的控件 id（由调用方 useId 提供，保证 SSR/CSR 一致）。 */
  id: string;
  /** 当前值（IANA 标识）。 */
  value: string;
  /** 选中后回调。 */
  onChange: (timezone: string) => void;
  /** 全量选项（由调用方 useMemo 构造，避免每次渲染重算 400+ 项偏移）。 */
  options: readonly TimezoneOption[];
  disabled?: boolean;
  /** 字段级错误 → aria-invalid。 */
  invalid?: boolean;
  /** 追加到 aria-describedby 的外部说明 id。 */
  describedBy?: string;
};

/** 列表一次最多渲染的项数（过滤后仍可能很多，虚拟滚动不在本里程碑范围）。 */
const MAX_RENDERED = 60;

export function TimezonePicker({
  id,
  value,
  onChange,
  options,
  disabled = false,
  invalid = false,
  describedBy,
}: TimezonePickerProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * 高亮项用 **id** 而非下标保存：过滤后下标会整体移位，用 id 可让高亮天然稳定，
   * 当前下标由 `filtered` **派生**（而不是用 effect 去同步两个 state，避免级联渲染）。
   * 派生结果 -1 表示高亮项不在当前可见列表里（此时 aria-activedescendant 不输出，
   * 不会指向已卸载的 option）。
   */
  const [activeId, setActiveId] = useState<string | null>(null);

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  );

  // 未输入时渲染全量（保证选中项一定在列表内且能被 scrollIntoView 定位）；
  // 过滤时取前 MAX_RENDERED 条（匹配通常很少，无需渲染数百行）。
  const isQueryEmpty = query.trim().length === 0;
  const filtered = useMemo(
    () =>
      filterTimezoneOptions(options, query, isQueryEmpty ? options.length : MAX_RENDERED),
    [options, query, isQueryEmpty],
  );

  const deviceZone = useMemo(() => deviceTimezone(), []);

  const activeIndex = activeId === null ? -1 : filtered.findIndex((o) => o.id === activeId);
  const activeOption = activeIndex >= 0 ? filtered[activeIndex] : undefined;

  // 高亮项滚动到可视区（键盘导航时列表自动跟随）。只操作 DOM，不 setState。
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function openList(): void {
    if (disabled || open) return;
    setQuery("");
    setActiveId(value); // 打开时高亮当前选中项
    setOpen(true);
  }

  const closeList = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveId(null);
  }, []);

  function commit(timezone: string): void {
    onChange(timezone);
    closeList();
    inputRef.current?.focus();
  }

  /** 输入过滤：在事件处理里直接算出新的首个匹配项作为高亮（无需 effect 事后纠正）。 */
  function handleQueryChange(nextQuery: string): void {
    setQuery(nextQuery);
    const nextFiltered = filterTimezoneOptions(
      options,
      nextQuery,
      nextQuery.trim().length === 0 ? options.length : MAX_RENDERED,
    );
    setActiveId(nextFiltered[0]?.id ?? null);
    if (!open) setOpen(true);
  }

  function moveBy(delta: number): void {
    if (filtered.length === 0) return;
    const base = activeIndex < 0 ? (delta > 0 ? -1 : 0) : activeIndex;
    const next = (base + delta + filtered.length) % filtered.length;
    setActiveId(filtered[next]?.id ?? null);
  }

  function jumpTo(edge: "first" | "last"): void {
    const target = edge === "first" ? filtered[0] : filtered[filtered.length - 1];
    setActiveId(target?.id ?? null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openList();
        else moveBy(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openList();
        else moveBy(-1);
        break;
      case "Home":
        if (!open) return;
        event.preventDefault();
        jumpTo("first");
        break;
      case "End":
        if (!open) return;
        event.preventDefault();
        jumpTo("last");
        break;
      case "Enter":
        // 列表展开时 Enter = 选中高亮项（并阻止表单提交）；收起时交给表单提交。
        if (!open) return;
        event.preventDefault();
        if (activeOption) commit(activeOption.id);
        break;
      case "Escape":
        if (!open) return;
        // F31⑬：IME 组合输入期间 Escape 归输入法（取消候选词），不关闭列表。
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        closeList();
        break;
      case "Tab":
        closeList();
        break;
      default:
        break;
    }
  }

  // 分组：查询为空时，常用时区与完整列表之间插一条分组标题（不参与 option 索引）。
  const firstNonCommonIndex = isQueryEmpty
    ? filtered.findIndex((option) => !option.common)
    : -1;

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className={cn(
          "flex items-center gap-2 rounded-control border bg-surface px-3",
          "transition-[border-color,box-shadow] duration-150 ease-standard",
          "focus-within:border-brand",
          invalid ? "border-danger bg-danger-soft/40" : "border-line-strong",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeOption ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder="搜索时区，如「上海」或 Asia/Shanghai"
          value={open ? query : (selected?.label ?? value)}
          onFocus={openList}
          onClick={openList}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="h-10 min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted md:text-label"
        />
        {selected?.offsetLabel ? (
          <span className="hidden shrink-0 text-caption tabular-nums text-foreground-muted sm:inline">
            {selected.offsetLabel}
          </span>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "收起时区列表" : "展开时区列表"}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) closeList();
            else {
              openList();
              inputRef.current?.focus();
            }
          }}
          className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-foreground-muted transition-colors duration-150 ease-standard hover:bg-surface-sunken hover:text-foreground disabled:pointer-events-none"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </button>
      </div>

      {open ? (
        <div
          className={cn(
            "absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-card",
            "border border-line bg-surface shadow-overlay",
          )}
        >
          {/* 快捷操作：使用设备时区 */}
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-sunken px-3 py-2">
            <button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commit(deviceZone)}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-control text-caption text-foreground-secondary transition-colors duration-150 ease-standard hover:text-brand-ink"
            >
              <MonitorSmartphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">使用设备时区</span>
              <span className="shrink-0 font-mono text-foreground-muted">{deviceZone}</span>
            </button>
            <span className="shrink-0 text-caption tabular-nums text-foreground-muted">
              {isQueryEmpty
                ? `${options.length} 个时区`
                : `${filtered.length} 条匹配`}
            </span>
          </div>

          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-label text-foreground-muted">
              没有匹配的时区。试试「上海」「Tokyo」或 GMT 偏移。
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="时区"
              className="max-h-72 overflow-y-auto py-1"
            >
              {filtered.map((option, index) => {
                const active = index === activeIndex;
                const isSelected = option.id === value;
                return (
                  <li key={option.id} role="presentation">
                    {index === firstNonCommonIndex ? (
                      <p
                        role="presentation"
                        className="px-3 pb-1 pt-3 text-caption font-medium uppercase tracking-wide text-foreground-muted"
                      >
                        全部时区
                      </p>
                    ) : null}
                    {index === 0 && firstNonCommonIndex !== 0 && isQueryEmpty ? (
                      <p
                        role="presentation"
                        className="px-3 pb-1 pt-1 text-caption font-medium uppercase tracking-wide text-foreground-muted"
                      >
                        常用
                      </p>
                    ) : null}
                    <div
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      data-active={active || undefined}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => commit(option.id)}
                      onMouseEnter={() => setActiveId(option.id)}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-3 px-3 py-2",
                        "transition-colors duration-150 ease-standard",
                        active ? "bg-brand-soft" : "bg-transparent",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-y-1 left-0 w-0.5 rounded-full transition-colors duration-150 ease-standard",
                          active ? "bg-brand" : "bg-transparent",
                        )}
                      />
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isSelected ? (
                          <Check className="h-4 w-4 text-brand-ink" aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-label",
                            isSelected ? "font-semibold text-brand-ink" : "text-foreground",
                          )}
                        >
                          {option.label}
                        </span>
                        <span className="block truncate text-caption tabular-nums text-foreground-muted">
                          {option.id}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-caption text-foreground-secondary">
                        {option.offsetLabel}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* 点击外部关闭（焦点仍在输入框时由 onBlur 兜底，二者互补） */}
      <ClickOutside targetRef={wrapperRef} active={open} onOutside={closeList} />
    </div>
  );
}

/**
 * 点击组合框外部时关闭列表。
 * 用 pointerdown（早于 blur）判定，避免与 input 的 onBlur 竞态导致「点选项却先关掉」。
 */
function ClickOutside({
  targetRef,
  active,
  onOutside,
}: {
  targetRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  onOutside: () => void;
}) {
  useEffect(() => {
    if (!active) return;
    function handlePointerDown(event: PointerEvent): void {
      const node = targetRef.current;
      if (!node) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      onOutside();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [active, onOutside, targetRef]);

  return null;
}
