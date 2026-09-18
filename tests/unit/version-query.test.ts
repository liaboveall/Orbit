import { expect, it } from "vitest";
import { VersionQuerySchema } from "@/contracts";
it("versioned delete rejects ambiguous and unsafe numeric representations", () => {
  for (const expectedVersion of [undefined, "", "0", "-1", "1e2", "0x10", "1.1", " 1", "9007199254740992"])
    expect(VersionQuerySchema.safeParse({ expectedVersion }).success).toBe(false);
  expect(VersionQuerySchema.parse({ expectedVersion: "12" })).toEqual({ expectedVersion: 12 });
});
