"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-4 p-8">
      <p role="alert">工作台加载失败，请稍后重试。</p>
      <button
        onClick={reset}
        className="rounded-control border border-line px-4 py-2"
      >
        重新加载
      </button>
    </div>
  );
}
