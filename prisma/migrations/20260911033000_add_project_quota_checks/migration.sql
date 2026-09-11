-- A-02: Project reservedBytes 和 usedBytes 的非负性 CHECK 约束
-- 防止配额字段为负数（数据库级别保护）
-- 应用至 orbit_test 验证边界处理，不碰 orbit_dev（按用户要求）

ALTER TABLE "Project" 
ADD CONSTRAINT "non_negative_reserved" CHECK ("reservedBytes" >= 0);

ALTER TABLE "Project" 
ADD CONSTRAINT "non_negative_used" CHECK ("usedBytes" >= 0);
