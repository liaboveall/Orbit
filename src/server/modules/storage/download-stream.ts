import "server-only";
import { logEvent } from "@/server/http/log";

/** Own the body lifecycle after headers: enforce length, cancel the source and
 * release deadline listeners/timers on success, failure and consumer cancel. */
export function guardDownloadStream(source: ReadableStream<Uint8Array>, length: number | null, signal: AbortSignal, release: () => void) {
  const reader = source.getReader();
  let received = 0, finished = false;
  let abort: () => void;
  const finish = () => {
    if (finished) return false;
    finished = true;
    signal.removeEventListener("abort", abort);
    release();
    return true;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (!finish()) return;
        logEvent("warn", { event: "storage_download_aborted", stage: "stream" });
        controller.error(new Error("Download aborted"));
        void reader.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          if (length !== null && received !== length) throw new Error("Download length mismatch");
          finish();
          controller.close();
          return;
        }
        received += value.byteLength;
        if (length !== null && received > length) throw new Error("Download length mismatch");
        controller.enqueue(value);
      } catch (error) {
        if (!finish()) return;
        logEvent("error", { event: "storage_download_failed", stage: "stream" });
        controller.error(error);
        void reader.cancel().catch(() => undefined);
      }
    },
    cancel() {
      finish();
      void reader.cancel().catch(() => undefined);
    },
  });
}
