<!-- BEGIN CURRENT STATUS -->
# 当前交付状态

由 planning/current_status.py 从 backlog 生成；详细边界见当前状态文档。

- 状态：V1_RELEASE_ACCEPTANCE_PENDING
- 当前依据：[CURRENT-STATUS.md](docs/CURRENT-STATUS.md)
- 说明：2026-11-09 新增的 7 组问题已修复并经冻结门禁验收：980 项测试通过（304 unit、172 contract、381 integration、110 E2E、13 UI），源码指纹一致；真实并发备份/成对恢复、故障注入、默认恢复、迁移历史和全依赖审计 0 均通过。仍保留 7 组外部或历史事项；修复尚未提交/部署，M6 review、M7 todo。生产只读核查确认可沿用 ChatApp 的 OCI 主机、Resend 和 R2 服务，Orbit 容器可连接 Resend；下一步锁定候选版本、配置独立凭证并完成 AC-12。
- 里程碑：M0 done；M1 done；M2 done；M3 done；M4 done；M5 done；M6 review；M7 todo
- 历史数据恢复：missing_original_records_and_backup

<!-- END CURRENT STATUS -->
