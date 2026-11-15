/**
 * 「回到这个标签页」的监听。
 *
 * 用户切回标签页时浏览器会接连触发 visibilitychange 和 focus，两者只应引起一次重读。
 * 这里只合并「类型不同、相隔很近」的这一对；同一类型的事件每次都算数，
 * 所以连续两次获得焦点（或测试里连续派发两次 focus）会重读两次。
 * 标签页不可见时不触发。返回取消监听的函数。
 */
export function onWake(listener: () => void): () => void {
  let last: { type: string; time: number } | null = null;
  const handle = (event: Event) => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    const paired = last !== null && last.type !== event.type && now - last.time < 100;
    last = { type: event.type, time: now };
    if (!paired) listener();
  };
  window.addEventListener("focus", handle);
  document.addEventListener("visibilitychange", handle);
  return () => {
    window.removeEventListener("focus", handle);
    document.removeEventListener("visibilitychange", handle);
  };
}
