-- F17：评论删除热路径按 resourceId 反查幂等缓存（updateMany 清理旧缓存正文），
-- 该 WHERE 形状此前无索引支撑，代表性数据量下退化为顺序扫描。
CREATE INDEX "IdempotencyRecord_resourceId_idx" ON "IdempotencyRecord"("resourceId");
