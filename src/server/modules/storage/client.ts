import "server-only";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { OrbitEnv } from "@/server/env";

/**
 * MinIO/S3 客户端（M5 / ORB-018）。
 *
 * 用途：
 *  - 上传：由路由层直接调用 multer + MinIO PUT（不经过本模块）；
 *  - 下载：**服务端流式代理**（GetObject → Node.js 响应流转发），不用 presigned URL，
 *    防止 objectKey 泄漏给客户端（docs/05 §8、docs/01 §8：私有存储只提供下载）。
 *
 * 配置：从 env.ts 校验的 STORAGE_* 变量获取 endpoint/bucket/credentials，支持公开 S3
 * 或兼容对象存储（MinIO/Ceph/OSS 等）。
 */

/** 创建 S3 客户端单例（复用连接池）。 */
export function createS3Client(env: Pick<OrbitEnv, "STORAGE_ENDPOINT" | "STORAGE_REGION" | "STORAGE_FORCE_PATH_STYLE">): S3Client {
  return new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT.replace(/\/+$/, ""), // 去除末尾斜杠
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    },
  });
}

/** 已配置的 S3 客户端实例（应用单例）。 */
export const s3Client = (() => {
  // env.ts 会校验所有必要变量，TS 静态检查确保不存在未定义情况。
  const env = {
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT!,
    STORAGE_REGION: process.env.STORAGE_REGION!,
    STORAGE_FORCE_PATH_STYLE: Boolean(process.env.STORAGE_FORCE_PATH_STYLE),
  } as const;
  return createS3Client(env);
})();

/**
 * 流式下载对象内容（docs/05 §8：服务端代理下载，返回 ReadableStream）。
 *
 * @param key 对象键，格式 projects/{projectId}/tasks/{taskId}/{attachmentId}（不含原始文件名）。
 */
export async function streamDownload(key: string): Promise<{ stream: ReadableStream; fileName: string }> {
  const [folder, projectId, tasksFolder, taskId, attachmentId] = key.split("/");
  if (folder !== "projects" || !projectId || tasksFolder !== "tasks" || !taskId || !attachmentId) {
    throw new Error("Invalid object key format");
  }

  const command = new GetObjectCommand({
    Bucket: process.env.STORAGE_BUCKET!,
    Key: key,
  });

  const response = await s3Client.send(command);
  const metadata = response.Metadata || {};
  const fileName = metadata["originalname"] || `attachment-${attachmentId}.bin`;

  // AWS SDK v3 returns Body as a Node.js ReadableStream-like object
  // Convert to Web Stream API for compatibility
  const rawStream = response.Body as any;
  const stream = new ReadableStream({
    start(controller) {
      if (rawStream) {
        rawStream.on("data", (chunk: Buffer) => {
          controller.enqueue(chunk);
        });
        rawStream.on("end", () => {
          controller.close();
        });
        rawStream.on("error", (err: Error) => {
          controller.error(err);
        });
      } else {
        controller.close();
      }
    },
  });

  return { stream, fileName };
}
