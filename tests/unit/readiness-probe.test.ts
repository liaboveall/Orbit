import { describe, expect, it, vi } from "vitest";
import { createReadinessProbe } from "@/server/modules/maintenance/readiness-probe";

/**
 * /health/ready 被容器健康检查每 30 秒调用一次。完整的迁移与列核对只在启动、失败之后
 * 和每个间隔到期时执行，其余探测只做一次连通性查询；数据库中断必须在下一次探测就被发现。
 */
describe("createReadinessProbe", () => {
  function setup(interval = 1000) {
    let clock = 0;
    const verify = vi.fn(async () => true);
    const ping = vi.fn(async () => undefined);
    const probe = createReadinessProbe(verify, ping, () => clock, interval);
    return { verify, ping, probe, advance: (ms: number) => { clock += ms; } };
  }

  it("verifies the schema on the first probe and only pings until the interval expires", async () => {
    const { verify, ping, probe, advance } = setup();
    expect(await probe()).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(ping).not.toHaveBeenCalled();

    advance(999);
    expect(await probe()).toBe(true);
    expect(await probe()).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(2);

    advance(1);
    expect(await probe()).toBe(true);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("never trusts a failed verification", async () => {
    const { verify, ping, probe } = setup();
    verify.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    expect(await probe()).toBe(false);
    expect(await probe()).toBe(false);
    expect(await probe()).toBe(true);
    expect(verify).toHaveBeenCalledTimes(3);
    expect(ping).not.toHaveBeenCalled();
  });

  it("reports an outage on the next probe and re-verifies after recovery", async () => {
    const { verify, ping, probe } = setup();
    expect(await probe()).toBe(true);
    ping.mockRejectedValueOnce(new Error("synthetic outage"));
    expect(await probe()).toBe(false);
    // The database is back: the schema is checked again before readiness is reported.
    expect(await probe()).toBe(true);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});
