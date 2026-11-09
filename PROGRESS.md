<!-- BEGIN CURRENT STATUS -->
# 当前交付状态

由 planning/current_status.py 从 backlog 生成；详细边界见当前状态文档。

- 状态：V1_RELEASE_ACCEPTANCE_PENDING
- 当前依据：[CURRENT-STATUS.md](docs/CURRENT-STATUS.md)
- 说明：2026-11-09 候选版本 237c4f3 已部署到 https://smartorbit.tech（完整 CI 通过，服务器原生 ARM64 镜像）：自有域名与 HTTPS、Resend 发信域、R2 加密异地备份和服务器告警均已接入并实测，合成数据容量在 10 并发下达到预算；验证邮件、重置密码、邀请、双账户协作和移除成员后的权限回收已在线上验收，真实输入法和手机由本人确认。仍待首轮定时异地备份和原生缩放、辅助技术走查；M6 review、M7 todo。
- 里程碑：M0 done；M1 done；M2 done；M3 done；M4 done；M5 done；M6 review；M7 todo
- 历史数据恢复：missing_original_records_and_backup

<!-- END CURRENT STATUS -->
