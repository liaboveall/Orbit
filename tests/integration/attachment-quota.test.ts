import {
  afterEach,
  beforeEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/server/db/prisma";
import { getEnv } from "@/server/env";
import * as storage from "@/server/modules/storage/client";
import {
  uploadAttachment,
  listAttachments,
  deleteAttachment,
  downloadAttachment,
  downloadContent,
} from "@/server/modules/attachments/service";
import { uploadMultipart } from "@/server/modules/attachments/multipart";
import { cleanupOrphanAttachmentsLocked } from "@/server/modules/attachments/cleanup";
import { AttachmentSchema } from "@/contracts";
import { m5Fixture } from "../support/m5-fixture";
let f: Awaited<ReturnType<typeof m5Fixture>>;
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
async function upload(
  data = Buffer.from("真实附件内容"),
  user = f.member,
  id = randomUUID(),
  name = "说明.txt",
  mime = "text/plain",
) {
  return uploadAttachment(
    f.taskId,
    user,
    { uploadId: id, declaredSizeBytes: data.length, sha256: sha(data) },
    { fileName: name, mimeType: mime, stream: Readable.from([data]) },
    { signal: AbortSignal.timeout(120000) },
  );
}
beforeAll(async () => {
  const env = getEnv();
  if (
    !["localhost", "127.0.0.1"].includes(new URL(env.STORAGE_ENDPOINT).hostname)
  )
    throw new Error("M5 storage tests require local MinIO");
  try {
    await storage
      .getStorageClient()
      .send(new HeadBucketCommand({ Bucket: env.STORAGE_BUCKET }));
  } catch (error) {
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode !== 404
    )
      throw error;
    await storage
      .getStorageClient()
      .send(new CreateBucketCommand({ Bucket: env.STORAGE_BUCKET }));
  }
});
beforeEach(async () => {
  f = await m5Fixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (f) await f.cleanup();
});
describe("M5 private attachments: real PostgreSQL and MinIO", () => {
  it("同 uploadId 并发只保留一份预留，完成后可重放", async () => {
    const data = Buffer.from("same upload identity"), id = randomUUID();
    let entered!: () => void, resume!: () => void;
    const atStorage = new Promise<void>(resolve => { entered = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    const put = storage.putFile;
    vi.spyOn(storage, "putFile").mockImplementationOnce(async (...args) => {
      entered(); await released; return put(...args);
    });
    const first = upload(data, f.member, id);
    try {
      await atStorage;
      await expect(upload(data, f.member, id)).rejects.toMatchObject({ code: "UPLOAD_IN_PROGRESS" });
    } finally { resume(); }
    const saved = await first;
    const replay = await upload(data, f.member, id);
    expect(replay.replayed).toBe(true);
    expect(replay.attachment.id).toBe(saved.attachment.id);
    expect(await prisma.attachment.count({ where: { projectId: f.projectId } })).toBe(1);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } });
    expect(project.reservedBytes).toBe(0n);
    expect(project.usedBytes).toBe(BigInt(data.length));
  });
  it("rejects incomplete or misordered multipart without retaining a reservation", async () => {
    const form = new FormData();
    form.append("file", new File(["x"], "x.txt", { type: "text/plain" }));
    form.append("uploadId", randomUUID());
    form.append("declaredSizeBytes", "1");
    form.append("sha256", sha(Buffer.from("x")));
    // Model inbound HTTP bytes, not undici's outbound FormData producer (whose
    // cancellation in Node 26 can enqueue into its own already-closed stream).
    const encoded = new Request("http://localhost/upload", {method:"POST",body:form});
    const incoming = new Request(encoded.url, {method:"POST",headers:encoded.headers,body:await encoded.arrayBuffer()});
    await expect(
      uploadMultipart(
        incoming,
        f.taskId,
        f.member,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      await prisma.attachment.count({ where: { projectId: f.projectId } }),
    ).toBe(0);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } }))
        .reservedBytes,
    ).toBe(0n);
  });
  it("aborted body releases its durable reservation and remains eligible for cleanup", async () => {
    const data = Buffer.from("cancelled"),
      controller = new AbortController();
    controller.abort();
    await expect(
      uploadAttachment(
        f.taskId,
        f.member,
        {
          uploadId: randomUUID(),
          declaredSizeBytes: data.length,
          sha256: sha(data),
        },
        {
          fileName: "cancel.txt",
          mimeType: "text/plain",
          stream: Readable.from([data]),
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    const row = await prisma.attachment.findFirstOrThrow({
      where: { projectId: f.projectId },
    });
    expect(row).toMatchObject({ state: "FAILED", cleanupPending: true });
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } }))
        .reservedBytes,
    ).toBe(0n);
    await cleanupOrphanAttachmentsLocked({
      projectId: f.projectId,
      now: new Date(Date.now() + 181000),
    });
    expect(
      (await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } }))
        .cleanupPending,
    ).toBe(false);
  });
  it("database composite foreign key rejects attachment references to another project", async () => {
    const other = await m5Fixture();
    try {
      await expect(
        prisma.attachment.create({
          data: {
            taskId: f.taskId,
            projectId: other.projectId,
            uploaderId: f.member,
            clientUploadId: randomUUID(),
            claimedSha256: sha(Buffer.from("x")),
            originalName: "x.txt",
            objectKey: randomUUID(),
            mimeType: "text/plain",
            declaredSizeBytes: 1n,
            state: "UPLOADING",
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    } finally {
      await other.cleanup();
    }
  });
  it("multipart UI payload uploads, lists DTO, downloads exact bytes without exposing object key", async () => {
    const data = Buffer.from("中文文件内容"),
      form = new FormData();
    form.append("uploadId", randomUUID());
    form.append("declaredSizeBytes", String(data.length));
    form.append("sha256", sha(data));
    form.append(
      "file",
      new File([data], "中文说明.txt", { type: "text/plain" }),
    );
    const result = await uploadMultipart(
      new Request("http://localhost/upload", { method: "POST", body: form }),
      f.taskId,
      f.member,
    );
    expect(AttachmentSchema.safeParse(result.attachment).success).toBe(true);
    const listed = await listAttachments(f.taskId, f.owner);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("objectKey");
    const link = await downloadAttachment(result.attachment.id, f.member),
      url = new URL(link.url);
    expect(url.pathname).toContain("/content");
    expect(url.href).not.toContain("projects/");
    const content = await downloadContent(
      result.attachment.id,
      f.member,
      url.searchParams.get("expires")!,
      url.searchParams.get("signature")!,
    );
    expect(
      Buffer.from(await new Response(content.stream).arrayBuffer()),
    ).toEqual(data);
    expect(content.fileName).toBe("中文说明.txt");
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: f.projectId },
    });
    expect(project.usedBytes).toBe(BigInt(data.length));
    expect(project.reservedBytes).toBe(0n);
    expect(
      await prisma.activityLog.count({
        where: { projectId: f.projectId, action: "FILE_UPLOADED" },
      }),
    ).toBe(1);
  });
  it("forbids nonmembers, removed members, deleted tasks, expired and other-user signed links", async () => {
    const { attachment: a } = await upload();
    await expect(listAttachments(f.taskId, f.outsider)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(listAttachments(randomUUID(), f.owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const url = new URL((await downloadAttachment(a.id, f.member)).url);
    await expect(
      downloadContent(
        a.id,
        f.owner,
        url.searchParams.get("expires")!,
        url.searchParams.get("signature")!,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      downloadContent(
        a.id,
        f.member,
        String(Date.now() - 1000),
        url.searchParams.get("signature")!,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.projectMember.deleteMany({
      where: { projectId: f.projectId, userId: f.member },
    });
    await expect(listAttachments(f.taskId, f.member)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      downloadContent(
        a.id,
        f.member,
        url.searchParams.get("expires")!,
        url.searchParams.get("signature")!,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.task.update({
      where: { id: f.taskId },
      data: { deletedAt: new Date() },
    });
    await expect(downloadAttachment(a.id, f.owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(deleteAttachment(a.id, f.owner)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("replays only identical uploads; different users have independent object keys", async () => {
    const id = randomUUID(),
      data = Buffer.from("same");
    const a = await upload(data, f.member, id),
      b = await upload(data, f.member, id);
    expect(b.replayed).toBe(true);
    expect(b.attachment.id).toBe(a.attachment.id);
    await expect(
      upload(Buffer.from("different"), f.member, id),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const c = await upload(data, f.owner, id);
    expect(c.attachment.id).not.toBe(a.attachment.id);
    await deleteAttachment(a.attachment.id, f.member);
    await expect(upload(data, f.member, id)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
  it("concurrent deletion releases quota and creates activity once; archived project is read-only", async () => {
    const { attachment: a } = await upload();
    const results = await Promise.allSettled([
      deleteAttachment(a.id, f.member),
      deleteAttachment(a.id, f.owner),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } }))
        .usedBytes,
    ).toBe(0n);
    expect(
      await prisma.activityLog.count({
        where: { projectId: f.projectId, action: "FILE_DELETED" },
      }),
    ).toBe(1);
    const b = await upload();
    await prisma.project.update({
      where: { id: f.projectId },
      data: { archivedAt: new Date() },
    });
    await expect(
      deleteAttachment(b.attachment.id, f.owner),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
    expect(await listAttachments(f.taskId, f.owner)).toHaveLength(1);
  });
  it.each([
    ["fake.pdf", "application/pdf", Buffer.from("not pdf")],
    ["danger.svg", "image/png", Buffer.from("<svg/>")],
    [
      "danger.txt",
      "text/plain",
      Buffer.from("<html><script>alert(1)</script></html>"),
    ],
    ["bad.txt", "text/plain", Buffer.from([0xff, 0xfe, 0])],
    ["bad.exe", "text/plain", Buffer.from("abc")],
  ])("rejects actual content or extension: %s", async (name, mime, data) => {
    await expect(
      upload(data, f.member, randomUUID(), name, mime),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } }))
        .reservedBytes,
    ).toBe(0n);
  });
  it("rejects checksum/size mismatch and oversized requests before consuming body", async () => {
    await expect(
      uploadAttachment(
        f.taskId,
        f.member,
        {
          uploadId: randomUUID(),
          declaredSizeBytes: 1,
          sha256: "0".repeat(64),
        },
        {
          fileName: "bad.txt",
          mimeType: "text/plain",
          stream: Readable.from([Buffer.from("too big")]),
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      uploadMultipart(
        new Request("http://localhost/upload", {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=x",
            "content-length": String(20 * 1024 * 1024),
          },
          body: "x",
        }),
        f.taskId,
        f.member,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("persists reservation without holding a project lock; membership is rechecked after storage", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r)),
      original = storage.putFile;
    vi.spyOn(storage, "putFile").mockImplementationOnce(async (...args) => {
      enter();
      await gate;
      await original(...args);
    });
    const pending = upload();
    void pending.catch(() => undefined);
    try {
      await entered;
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: f.projectId },
      });
      expect(project.reservedBytes).toBeGreaterThan(0n);
      await prisma.project.update({
        where: { id: f.projectId },
        data: { description: "Concurrent write succeeds" },
      });
      await prisma.projectMember.deleteMany({
        where: { projectId: f.projectId, userId: f.member },
      });
    } finally {
      release();
    }
    await expect(pending).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rows = await prisma.attachment.findMany({
      where: { projectId: f.projectId },
    });
    expect(rows[0]).toMatchObject({ state: "FAILED", cleanupPending: true });
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } }))
        .reservedBytes,
    ).toBe(0n);
    await cleanupOrphanAttachmentsLocked({
      projectId: f.projectId,
      now: new Date(Date.now() + 181000),
    });
    expect(
      (
        await prisma.attachment.findUniqueOrThrow({
          where: { id: rows[0]!.id },
        })
      ).cleanupPending,
    ).toBe(false);
  });
  it("storage outage leaves retryable failure and cleanup retries object deletion", async () => {
    vi.spyOn(storage, "putFile").mockRejectedValueOnce(
      new Error("secret storage details"),
    );
    await expect(upload()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message: expect.not.stringContaining("secret"),
    });
    const row = await prisma.attachment.findFirstOrThrow({
      where: { projectId: f.projectId },
    });
    expect(row.state).toBe("FAILED");
    vi.spyOn(storage, "deleteObject").mockRejectedValueOnce(
      new Error("temporary"),
    );
    expect(
      (
        await cleanupOrphanAttachmentsLocked({
          projectId: f.projectId,
          now: new Date(Date.now() + 181000),
        })
      ).failedCount,
    ).toBe(1);
    expect(
      (await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } }))
        .cleanupPending,
    ).toBe(true);
    expect(
      (
        await cleanupOrphanAttachmentsLocked({
          projectId: f.projectId,
          now: new Date(Date.now() + 181000),
        })
      ).cleanedCount,
    ).toBe(1);
    expect(
      (
        await cleanupOrphanAttachmentsLocked({
          projectId: f.projectId,
          now: new Date(Date.now() + 181000),
        })
      ).cleanedCount,
    ).toBe(0);
  });
  it("deletion during PUT retains cleanup intent until the upload has settled", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = storage.putFile;
    vi.spyOn(storage, "putFile").mockImplementationOnce(async (...args) => {
      enter();
      await gate;
      await original(...args);
    });
    const pending = upload();
    void pending.catch(() => undefined);
    try {
      await entered;
      const row = await prisma.attachment.findFirstOrThrow({
        where: { projectId: f.projectId },
      });
      await deleteAttachment(row.id, f.member);
      expect(
        (await cleanupOrphanAttachmentsLocked({ projectId: f.projectId }))
          .cleanedCount,
      ).toBe(0);
      expect(
        (await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } }))
          .cleanupPending,
      ).toBe(true);
    } finally {
      release();
    }
    await expect(pending).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (
        await cleanupOrphanAttachmentsLocked({
          projectId: f.projectId,
          now: new Date(Date.now() + 181000),
        })
      ).cleanedCount,
    ).toBe(1);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: f.projectId },
    });
    expect(project.reservedBytes).toBe(0n);
    expect(project.usedBytes).toBe(0n);
  });
  it("concurrent task quota permits only five reservations", async () => {
    const result = await Promise.allSettled(
      Array.from({ length: 6 }, () => upload()),
    );
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.attachment.count({
        where: { projectId: f.projectId, state: "READY" },
      }),
    ).toBe(5);
  });
  it("project quota includes reservations", async () => {
    await prisma.project.update({
      where: { id: f.projectId },
      data: { reservedBytes: 200n * 1024n * 1024n },
    });
    await expect(upload()).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(
      await prisma.attachment.count({ where: { projectId: f.projectId } }),
    ).toBe(0);
  });
  it("orphan cleanup concurrently releases each reservation only once", async () => {
    const id = randomUUID(),
      size = 10n;
    await prisma.attachment.create({
      data: {
        id,
        taskId: f.taskId,
        projectId: f.projectId,
        uploaderId: f.member,
        clientUploadId: randomUUID(),
        objectKey: "projects/" + f.projectId + "/tasks/" + f.taskId + "/" + id,
        originalName: "old.txt",
        mimeType: "text/plain",
        claimedSha256: "0".repeat(64),
        declaredSizeBytes: size,
        state: "UPLOADING",
        updatedAt: new Date(Date.now() - 7200000),
      },
    });
    await prisma.project.update({
      where: { id: f.projectId },
      data: { reservedBytes: size },
    });
    await Promise.all([
      cleanupOrphanAttachmentsLocked({
        projectId: f.projectId,
        now: new Date(Date.now() + 181000),
      }),
      cleanupOrphanAttachmentsLocked({
        projectId: f.projectId,
        now: new Date(Date.now() + 181000),
      }),
    ]);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } }))
        .reservedBytes,
    ).toBe(0n);
    expect(
      await prisma.attachment.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      state: "FAILED",
      cleanupPending: false,
      deletedAt: null,
    });
  });
});
