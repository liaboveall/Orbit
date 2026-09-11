# M4 里程碑 - R07 安全修复：邀请约束逻辑错误

## 问题背景

**严重性**: 🔴 CRITICAL SECURITY BUG  
**影响**: 可能导致已使用的邀请被重复使用  
**发现时间**: 2026-09-10  
**修复状态**: ✅ 代码已修复，待迁移应用

## 问题分析

### Original BROKEN Logic (Line 37)

```typescript
WHERE ("acceptedAt" IS NULL) != ("acceptedById" IS NOT NULL)
```

这个 XOR 逻辑错误选择了**合法的记录**，而不是有问题的记录！

#### 错误分析表

| acceptedAt | acceptedById | 预期结果 | Broken 逻辑选择 | 正确结果 |
|------------|--------------|----------|-----------------|----------|
| NULL | NULL | ✅ Valid | ❌ Skipped (wrong) | Should keep |
| **NOT NULL** | **NULL** | ❌ **INVALID** | ❌ Skipped (dangerous!) | Must detect! |
| NULL | NOT NULL | ❌ INVALID | ✅ Selected (wrong) | Should detect |
| NOT NULL | NOT NULL | ✅ Valid | ❌ Skipped (wrong) | Should keep |

**致命问题**: Line 37 会跳过真正的问题记录 `(acceptedAt NOT NULL, acceptedById NULL)`，这允许攻击者重用已消耗的邀请！

### Root Cause

1. XOR 条件表达式写错：应该用 `(acceptedAt IS NULL) != (acceptedById IS NULL)`，却用了 `(acceptedAt IS NULL) != (acceptedById IS NOT NULL)`
2. 没有单元测试来捕获这种业务逻辑层面的 bug
3. 只有 trigger 能防止新数据，无法清理历史脏数据

## 解决方案

### Task 1: 修复清理脚本 (✅ DONE)

文件：`scripts/cleanup-invitation-constraints.ts`

**主要变更**:
- ❌ 删除自动修正逻辑（原 line 60-78）
- ✅ 改为只读检查模式，不修改任何数据
- ✅ 使用正确的 XOR 逻辑：
  ```typescript
  WHERE: {
    OR: [
      { acceptedAt: { not: null }, acceptedById: null },  // accepted but no user
      { acceptedAt: null, acceptedById: { not: null } }   // user but not accepted
    ]
  }
  ```
- ✅ 详细的诊断输出，明确每种不一致情况的含义
- ✅ 发现不一致时退出码为 1，阻止自动继续执行

**Safety Features**:
- ✅ 不再自动删除或修改数据
- ✅ 对所有问题记录进行详细日志记录
- ✅ 发现不一致时拒绝继续执行
- ✅ 要求手动审查每个问题记录

### Task 2: 创建新的迁移文件 (✅ DONE)

文件：`prisma/migrations/20260910001347_add_invitation_accepted_constraint/migration.sql`

**采用 CHECK CONSTRAINT 而非 TRIGGER 的原因**:
- 更简单，由 PostgreSQL 内核支持
- 自动在 INSERT/UPDATE 时强制执行
- 与 Prisma 集成更好，无需自定义函数维护
- 性能开销更小（数据库层 vs 触发器调用）

**迁移内容**:
1. 清理之前失败的迁移尝试（trigger & function）
2. 添加 CHECK constraint：`(acceptedAt IS NULL AND acceptedById IS NULL) OR (acceptedAt IS NOT NULL AND acceptedById IS NOT NULL)`
3. 查询 pg_catalog 验证约束已成功添加

**时间戳**: `20260910001347` > `20260910001346`（确保更高优先级）

### Task 3: 更新 Schema 注释 (✅ DONE)

已在 `schema.prisma` line 197-198 添加清晰的注释:
```prisma
acceptedAt   DateTime?    // Must be NULL if acceptedById is NULL, and vice versa (docs/04 §5)
acceptedById String?      // Both must be NULL or both non-NULL - enforced by DB CHECK constraint
```

将 "trigger" 更正为 "CHECK constraint" 以反映实际实现。

## 验证流程

### Step A: 测试环境验证（必须在 orbit_test 先执行）

#### 1. 运行清理脚本检查

```bash
cd d:\FullStack\Orbit
tsx scripts/cleanup-invitation-constraints.ts
```

**Expected output (success)**:
```
🔍 Checking for inconsistent Invitation records (R07 security check)...

✅ No inconsistent Invitation records found.
🛡️  Database state is consistent with R07 constraint requirements.

💡 Ready to apply CHECK constraint via migration.
```

**如果发现问题记录** (应不存在):
```
⚠️  Found N INCONSISTENT record(s):

───────────────────────────────────────────────
ID: xxx-xxx-xxx
Token Hash: abc123...
Project ID: xxx-xxx-xxx
⚠️  PROBLEM: Has acceptance timestamp but NO assigned user!
   acceptedAt: 2026-09-10T12:34:56.789Z
   acceptedById: NULL (should not be NULL)
   🔴 This allows reusing invitation without actual user assignment!

═══════════════════════════════════════════════
⚠️  CRITICAL WARNING: INCONSISTENT DATA DETECTED!
```

在这种情况下：
1. ❌ **DO NOT** 继续执行迁移
2. 🔍 手动检查每条问题记录的来源
3. 📝 根据业务需求决定如何处理（UPDATE/DELETE）
4. ↩️ 重新运行脚本报复性检查直到零问题

#### 2. 应用迁移到 test 环境

```bash
pnpm db:migrate dev --name add_invitation_accepted_constraint
```

Expected: Migration applies successfully with zero warnings.

#### 3. 测试约束强制行为

```sql
-- Connect to orbit_test database
psql "postgresql://user:pass@localhost:5432/orbit_test"

-- Test 1: Both NULL should succeed
INSERT INTO "Invitation" ("tokenHash", "projectId", "createdById", "expiresAt")
VALUES ('test_hash_1', 'project-id', 'user-id', NOW() + INTERVAL '7 days');
-- Expected: ✅ SUCCESS

-- Test 2: Both NOT NULL should succeed
INSERT INTO "Invitation" ("tokenHash", "projectId", "createdById", "expiresAt", 
                          "acceptedAt", "acceptedById")
VALUES ('test_hash_2', 'project-id', 'user-id', NOW() + INTERVAL '7 days', 
        NOW(), 'user-id');
-- Expected: ✅ SUCCESS

-- Test 3: Mixed state should FAIL
INSERT INTO "Invitation" ("tokenHash", "projectId", "createdById", "expiresAt", 
                          "acceptedAt")
VALUES ('test_hash_3', 'project-id', 'user-id', NOW() + INTERVAL '7 days', 
        NOW());
-- Expected: ❌ ERROR: duplicate key value violates unique constraint...
-- Wait, this should give constraint violation:
-- ERROR:  new row for relation "Invitation" violates check constraint "checked_accepted_at_and_by_id"
```

#### 4. 验证失败消息

Should see error like:
```
ERROR:  new row for "Invitation" violates check constraint "checked_accepted_at_and_by_id"
DETAIL:  Failing row contains (id-xxx, project-xxx, user-xxx, hash..., 2026-09-17, NULL, ..., ...).
```

### Step B: 生产环境执行计划

If test environment passes all checks above:

#### 1. Schedule maintenance window

- Notify team of brief write-blocking period
- Prepare rollback plan (database backup before migration)
- Monitor channel ready for incident response

#### 2. Backup production database

```bash
pg_dump orbit_dev -f backup_pre_r07_migration_$(date +%Y%m%d).sql
```

Verify backup integrity before proceeding.

#### 3. Run verification script in production

```bash
tsx scripts/cleanup-invitation-constraints.ts
```

Expected: Zero inconsistent records (same as test env).

If any issues found:
- Stop immediately
- Investigate root cause
- Manually clean data outside maintenance window
- Reschedule migration

#### 4. Apply migration

```bash
pnpm db:migrate dev --name add_invitation_accepted_constraint
```

Monitor output for any errors or warnings.

#### 5. Verify application behavior

- Test invitation creation flow (no accepted fields)
- Test invitation acceptance flow (both fields set atomically)
- Check application logs for constraint violations (should be zero)

#### 6. Post-migration monitoring

Watch for 24 hours:
- Database error logs for constraint violations
- Application exception reports
- Unexpected invitation-related bugs

## 审计追踪

### Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `scripts/cleanup-invitation-constraints.ts` | Fixed | Corrected XOR logic, removed auto-delete |
| `prisma/schema.prisma` | Updated | Changed comment from trigger to CHECK constraint |
| `prisma/migrations/20260910001347_add_invitation_accepted_constraint/migration.sql` | Created | New migration with correct CHECK constraint |
| `docs/M4-MIGRATION-R07-FIX.md` | Created | Documentation and validation procedure |

### Previous Failed Migration

File: `prisma/migrations/20260910001346_add_invitation_accepted_constraint/migration.sql`

**Status**: ⚠️ Kept in version control, not applied  
**Reason**: Historical record of attempted fix; provides context for why new approach needed  
**Action**: Do NOT delete from git history, just don't execute it

### Security Impact Assessment

**Before Fix**:
- 🔴 Vulnerable: Inconsistent state allowed reused invitations
- 🔴 Risk: Unauthorized access, privilege escalation potential
- 🔴 Attack vector: Exploit race condition in acceptance flow

**After Fix**:
- 🟢 Protected: Database-level invariant prevents any inconsistency
- 🟢 Defense in depth: Even if app code has bugs, DB enforces correctness
- 🟢 Audit trail: Clear constraint violation errors for debugging

## 测试建议

### Unit Tests Needed

1. `tests/unit/invitation/constraint-validation.test.ts`
   - Test successful invitation creation (no accepted fields)
   - Test atomic acceptance (both fields set together)
   - Test rejection of partial updates

2. `tests/integration/database/check-constraint.test.ts`
   - Direct SQL attempts to violate constraint
   - Transaction isolation testing
   - Concurrent update scenarios

### Integration Tests

1. End-to-end invitation flow with database constraints active
2. Load test simulating concurrent acceptance attempts
3. Failure recovery testing when constraint violations occur

## Rollback Plan

If issues arise after migration:

1. Quick rollback:
   ```sql
   ALTER TABLE "Invitation" DROP CONSTRAINT checked_accepted_at_and_by_id;
   ```

2. Full restoration from backup if needed

3. Hotfix path:
   - Identify specific issue
   - Create emergency migration in same timestamp sequence
   - Re-test thoroughly before re-applying

## 成功标准

✅ Cleanup script runs and reports zero inconsistencies  
✅ Migration applies successfully in orbit_test  
✅ Manual constraint violation tests produce expected errors  
✅ Migration applied to orbit_dev without errors  
✅ Application passes all existing integration tests  
✅ No new constraint violations appear in 24h monitoring  

---

**Author**: Qoder (M4 security fix execution)  
**Date**: 2026-09-10  
**Review Status**: Pending team review before production application  
**Linked Issues**: R07 Security Fix (M4 Milestone)
