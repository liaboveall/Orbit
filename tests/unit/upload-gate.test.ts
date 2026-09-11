import { expect, test } from "vitest";
import { UploadGate } from "@/server/modules/attachments/upload-gate";

test("upload rate includes completed/replayed/failed attempts and uses a rolling minute", () => {
  const gate = new UploadGate();
  for (let i = 0; i < 10; i++) {
    const slot = gate.acquire("user", i * 100);
    expect(slot.allowed).toBe(true);
    if (slot.allowed) slot.release();
  }
  expect(gate.acquire("user", 1000)).toEqual({ allowed: false, retryAfter: 59 });
  expect(gate.acquire("user", 60_000).allowed).toBe(true);
  expect(gate.acquire("other-user", 1000).allowed).toBe(true);
});

test("two in-flight slots per user across tasks; idempotent release restores exactly one slot", () => {
  const gate = new UploadGate();
  const first = gate.acquire("user", 0), second = gate.acquire("user", 0);
  expect(first.allowed && second.allowed).toBe(true);
  expect(gate.acquire("user", 0).allowed).toBe(false);
  expect(gate.acquire("other", 0).allowed).toBe(true);
  if (first.allowed) { first.release(); first.release(); }
  expect(gate.acquire("user", 0).allowed).toBe(true);
  expect(gate.acquire("user", 0).allowed).toBe(false);
  // A new rate window cannot discard active concurrency leases.
  expect(gate.acquire("user", 60_001).allowed).toBe(false);
  if (second.allowed) second.release();
  expect(gate.acquire("user", 60_001).allowed).toBe(true);
});
