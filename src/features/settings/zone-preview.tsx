"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  describeZoneDifference,
  deviceTimezone,
  isKnownTimezone,
  zoneClock,
  zoneDateLabel,
  zoneDayProgress,
  zoneOffsetLabel,
} from "./timezones";

/**
 * 所选时区实时预览（M1 / ORB-006，个人设置页右栏）。
 *
 * 目的：时区是抽象标识（`Asia/Kathmandu` 对多数人无感），把它翻译成
 * 「此刻那里几点」的直觉体验 —— 选择时区时立刻看到大号时钟、当地日期、
 * GMT 偏移、24 小时刻度尺上的当前位置，以及与本机时区的时钟差。
 *
 * 实现要点：
 *  - 逐秒 tick 由**模块级外部时钟存储**驱动（`useSyncExternalStore`）：本页只有一个预览卡，
 *    但把 interval 放在模块级可让多实例共享同一条计时器，且不在 effect 里 setState
 *    （避免级联渲染）；订阅数为 0 时自动停表，不泄漏定时器；
 *  - **水合安全**：`getServerSnapshot` 返回 0（占位），水合首帧同样读到 0 → 渲染「读取中」，
 *    订阅生效后 React 重读快照再渲染真实时间，避免 server/client 时间差触发 hydration mismatch；
 *  - `role="timer"`：ARIA 规定其隐式 `aria-live="off"`，逐秒变化不会刷屏读屏软件。
 *
 * 边界：features 层，不导入 @/server；所有时间计算走 ./timezones 的 Intl 封装。
 */

/** 24 小时刻度尺的色调：深夜 / 日间 / 核心工作时段三档（全部走 tokens）。 */
const HOUR_TONE_NIGHT = "bg-line";
const HOUR_TONE_DAY = "bg-brand-soft";
const HOUR_TONE_CORE = "bg-brand/25";

function hourTone(hour: number): string {
  if (hour < 6 || hour >= 21) return HOUR_TONE_NIGHT;
  if (hour >= 9 && hour < 18) return HOUR_TONE_CORE;
  return HOUR_TONE_DAY;
}

const RULER_HOURS = Array.from({ length: 24 }, (_, index) => index);
const RULER_LABELS = [0, 6, 12, 18, 24];

/* ── 模块级秒时钟（外部存储）────────────────────────────────────────────
   useSyncExternalStore 要求：subscribe 在外部变化时通知，getSnapshot 返回可比较的
   不变值（此处用毫秒数，不返回新 Date 对象，避免每次快照都被视为「已变化」而无限重渲染）。
   0 是「尚未启动」哨兵值，同时作为服务端快照，保证水合首帧一致。 */

const CLOCK_NOT_STARTED = 0;

let clockValue = CLOCK_NOT_STARTED;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(callback: () => void): () => void {
  clockListeners.add(callback);
  if (clockTimer === null) {
    clockValue = Date.now();
    clockTimer = setInterval(() => {
      clockValue = Date.now();
      for (const listener of clockListeners) listener();
    }, 1000);
  }
  return () => {
    clockListeners.delete(callback);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
      clockValue = CLOCK_NOT_STARTED;
    }
  };
}

function getClockSnapshot(): number {
  return clockValue;
}

function getClockSnapshotOnServer(): number {
  return CLOCK_NOT_STARTED;
}

export function ZonePreview({ timezone }: { timezone: string }) {
  const tick = useSyncExternalStore(
    subscribeClock,
    getClockSnapshot,
    getClockSnapshotOnServer,
  );
  const now = tick === CLOCK_NOT_STARTED ? null : new Date(tick);
  const deviceZone = useMemo(() => deviceTimezone(), []);
  const known = isKnownTimezone(timezone);

  const clock = now && known ? zoneClock(timezone, now) : null;
  const [hh, mm, ss] = (clock ?? "--:--:--").split(":");
  const progress = now && known ? zoneDayProgress(timezone, now) : 0;
  const difference = now && known ? describeZoneDifference(timezone, deviceZone, now) : null;

  return (
    <section
      aria-label="所选时区预览"
      className="overflow-hidden rounded-card border border-line bg-surface shadow-popover"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-sunken px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-caption uppercase tracking-widest text-foreground-muted">
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          当地此刻
        </span>
        <span className="truncate font-mono text-caption text-foreground-secondary">
          {known ? timezone : "时区无效"}
        </span>
      </header>

      <div className="px-4 pb-4 pt-5">
        {/* 时钟：role=timer 隐式 aria-live=off，逐秒更新不打扰读屏 */}
        <div role="timer" className="flex items-start justify-center gap-1">
          <ClockUnit value={hh ?? "--"} />
          <span aria-hidden="true" className="pt-1 font-mono text-hero leading-none text-line-strong">
            :
          </span>
          <ClockUnit value={mm ?? "--"} />
          <span aria-hidden="true" className="pt-1 font-mono text-hero leading-none text-line-strong">
            :
          </span>
          <ClockUnit value={ss ?? "--"} accent />
        </div>

        <div className="mt-3 space-y-1 text-center">
          <p className="text-label text-foreground-secondary">
            {now && known ? zoneDateLabel(timezone, now) : "读取中…"}
          </p>
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption text-foreground-muted">
            {known ? (
              <>
                <span className="rounded-control bg-brand-soft px-1.5 py-0.5 font-mono text-brand">
                  {now ? zoneOffsetLabel(timezone, now) : "GMT"}
                </span>
                <span className="font-mono">设备 {deviceZone}</span>
                {difference ? <span>{difference}</span> : null}
              </>
            ) : (
              <span className="text-danger">该标识不是有效的 IANA 时区</span>
            )}
          </p>
        </div>

        {/* 24 小时刻度尺 + 当前时刻游标 */}
        <div className="mt-5">
          <div
            aria-hidden="true"
            className="relative flex h-9 items-stretch gap-px overflow-hidden rounded-control bg-surface-sunken p-px"
          >
            {RULER_HOURS.map((hour) => (
              <span key={hour} className={cn("flex-1 rounded-[2px]", hourTone(hour))} />
            ))}
            {/* 游标：随每秒 progress 平滑移动（reduced-motion 下 tokens.css 会关闭过渡） */}
            <span
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand transition-[left] duration-1000 ease-linear"
              style={{ left: `${(progress * 100).toFixed(3)}%` }}
            />
            <span
              className="absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand transition-[left] duration-1000 ease-linear"
              style={{ left: `${(progress * 100).toFixed(3)}%` }}
            />
          </div>
          <div aria-hidden="true" className="relative mt-1 h-4">
            {RULER_LABELS.map((label) => (
              <span
                key={label}
                className="absolute -translate-x-1/2 font-mono text-caption text-foreground-muted first:translate-x-0 last:-translate-x-full"
                style={{ left: `${(label / 24) * 100}%` }}
              >
                {String(label).padStart(2, "0")}
              </span>
            ))}
          </div>
          <p className="sr-only">
            刻度尺显示该时区一天 24 小时的进度，当前位置为
            {now && known ? zoneClock(timezone, now) : "读取中"}。
          </p>
        </div>
      </div>
    </section>
  );
}

/** 时钟的一位数字块（时 / 分 / 秒）。秒位用品牌色强调，形成节奏感。 */
function ClockUnit({ value, accent = false }: { value: string; accent?: boolean }) {
  return (
    <span
      className={cn(
        "min-w-[2.6ch] rounded-control px-1 py-1 text-center font-mono text-hero leading-none tabular-nums",
        accent ? "bg-brand-soft text-brand" : "text-foreground",
      )}
    >
      {value}
    </span>
  );
}
