import "server-only";
import type { Project } from "@/generated/prisma/client";

/**
 * 原始 SQL（`SELECT p.* FROM "Project" p …`）返回的项目行 → Prisma 的 Project 模型。
 *
 * 驱动适配器对 int4、timestamptz、枚举、uuid 的返回形态与模型一致；int8 列
 * （reservedBytes / usedBytes）按实际形态归一成 bigint，配额运算全程不经 Number。
 */
export type RawProjectRow = Omit<Project, "reservedBytes" | "usedBytes"> & {
  reservedBytes: bigint | string | number;
  usedBytes: bigint | string | number;
};

export function toProjectRow<T extends RawProjectRow>(row: T): Omit<T, "reservedBytes" | "usedBytes"> & Pick<Project, "reservedBytes" | "usedBytes"> {
  return { ...row, reservedBytes: BigInt(row.reservedBytes), usedBytes: BigInt(row.usedBytes) };
}
