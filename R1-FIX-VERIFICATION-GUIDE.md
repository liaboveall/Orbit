# R1 Fix - Manual Verification Guide

## 🎯 快速检查清单

### 代码修改验证

#### ✅ 已修改文件列表

| 文件 | 修改行数 | 类型 |
|-----|---------|------|
| `src/features/projects/project-settings-form.tsx` | +8/-1, +3/-1, +3/0 | Bug Fix |
| `tests/unit/conflict-handler.test.ts` | +112 | Unit Test |
| `tests/e2e/m4-project-settings-r1.spec.ts` | +165 | E2E Test |
| `R1-FIX-DOCUMENTATION.md` | +373 | Documentation |
| `R1-FIX-VERIFICATION-GUIDE.md` | +XXX | This File |

---

## 🔍 关键代码位置索引

### Location 1: Error Handler Improvement

**File**: `src/features/projects/project-settings-form.tsx`  
**Lines**: 174-181

```typescript
const message = err instanceof ApiClientError 
  ? (err.status === 500 ? "服务器错误，无法获取远端内容。请重试或保留草稿。" : err.message)
  : "网络错误，请检查连接后重试。";
setRemoteFetchError(message);
// ⚠️ 关键 R1 修复：GET 失败时严禁推进 baseline.version
// ...
```

**Check**: 确认是否有明确的注释说明为什么不能推进 baseline.version

---

### Location 2: Save Guard Addition

**File**: `src/features/projects/project-settings-form.tsx`  
**Lines**: 97-100

```typescript
async function handleSaveProfile(): Promise<void> {
  // 🛡️ R1 修复补充：冲突待处理时，禁止任何保存操作
  if (savingProfile || archiving || conflictPending || fetchingRemote || !profileValid || archived) return;
  //                                                ^^^^^^^^^^^^^^^^ NEW GUARD
  ...
}
```

**Check**: 确认 `fetchingRemote` 和 `conflictPending` 都在 guard conditions 中

---

### Location 3: Conflict Pending Retention

**File**: `src/features/projects/project-settings-form.tsx`  
**Lines**: 169-171

```typescript
} else {
  setRemoteFetchError(`获取失败 (${latest.status})，请检查服务器连接。`);
  // ⚠️ R1 修复补充：GET 失败时不清除 conflictPending
  // ...
}
```

**Check**: 确认有注释说明为什么不设置 remoteConflict

---

## 🧪 运行测试

### Step 1: Run Unit Tests

```bash
cd d:\FullStack\Orbit
pnpm test -- tests/unit/conflict-handler.test.ts
```

**Expected Output**:
```
✓ Draft Manager > save
✓ Draft Manager > load
✓ Draft Manager > clear
✓ Draft Manager > clearProject
✓ isVersionMatch（生产实现）
✓ isVersionConflict（生产实现）
✓ R1 Fix - Baseline Version Forward Protection > baseline.version should not advance on GET failure
✓ R1 Fix - Baseline Version Forward Protection > prevent blind submission with stale expectedVersion
✓ R1 Fix - Baseline Version Forward Protection > conflict state maintains safe baseline until user decision
✓ R1 Fix - Baseline Version Forward Protection > fetchingRemote flag prevents accidental submissions

Test Files: 1 passed, 1 total
Tests:       10 passed, 10 total
```

---

### Step 2: Run E2E Tests

```bash
cd d:\FullStack\Orbit
pnpm test:e2e -- tests/e2e/m4-project-settings-r1.spec.ts
```

**Note**: Requires Next.js dev server running in background

**Expected Output**:
```
✓ [M4 Project Settings R1] R1-01: 冲突后 GET 500 不应推进 baseline.version
✓ [M4 Project Settings R1] R1-02: conflictPending 状态下保存按钮应被禁用
✓ [M4 Project Settings R1] R1-03: 获取远端内容失败时的错误消息

Test Files: 1 passed, 1 total
Tests:       3 passed, 3 total
```

---

### Step 3: Type Check

```bash
pnpm typecheck
```

**Verify**: No errors related to modified files

---

## 👀 Visual Verification (Manual Testing)

### Scenario 1: Normal Edit Flow

1. Navigate to `/app/projects/:id/settings`
2. Change project name
3. Click "保存修改"
4. **Expected**: Success toast, page refreshes automatically

✅ Pass criteria: Green toast "项目设置已保存"

---

### Scenario 2: Conflict Detection (Simulated)

⚠️ Requires two browser sessions or mock server

1. Session A: Open settings page, note version number
2. Session B: Update same project (different fields), triggers 409
3. Session A: Observe warning dialog appears

**Expected UI Elements**:
- Yellow border warning box (`border-warning`)
- Message: "项目已被他人更新..."
- Button: "重新获取远端内容"
- If remote fetched successfully:
  - Button: "采用远端内容重新编辑"
  - Button: "保留我的修改并重试"

✅ Pass criteria: All elements present and functional

---

### Scenario 3: GET Failure Handling

1. Trigger 409 conflict
2. Simulate network error (DevTools → Network → Slow 3G or manual interception)
3. Verify error message clarity

**Before Fix**: Generic message, unclear next steps  
**After Fix**: "服务器错误，无法获取远端内容。请重试或保留草稿。"

✅ Pass criteria: Clear, actionable error message

---

### Scenario 4: Retry Success Path

1. After GET failure, click "重新获取远端内容"
2. Wait for successful fetch
3. See comparison dialog
4. Click "保留我的修改并重试"

**Expected State Changes**:
- `conflictPending` → false
- Input fields rebase to remote values + keep local edits
- Version advances to remote version

✅ Pass criteria: Can now edit and save normally

---

## 📸 Screenshot Checklist

If manual testing, capture screenshots of:

1. ✅ Initial settings page (showing clean state)
2. ✅ Dirty form state (after editing name)
3. ✅ Warning dialog after 409 (yellow box)
4. ✅ Remote content comparison (if GET succeeds)
5. ✅ Error message after GET failure (specific text)
6. ✅ Disabled save button during conflict (visual indicator)

---

## 🐛 Known Limitations

### Current Test Constraints

1. **Unit Tests**: Cannot simulate actual HTTP concurrency
   - Workaround: Pure logic tests using `isVersionMatch` assertions
   
2. **E2E Tests**: Need real backend + concurrent users
   - Workaround: Focus on UI element verification rather than full scenario replay
   
3. **Integration Tests**: Full end-to-end flows covered by existing suites
   - Action: Re-run `pnpm test:integration` to ensure no regression

---

## 🎬 Final Sign-off Criteria

Before considering this fix complete:

- [ ] All unit tests pass locally
- [ ] All E2E tests pass locally
- [ ] No TypeScript compilation errors
- [ ] Manual smoke test passes (Scenario 1)
- [ ] Code review approved by team lead
- [ ] Documentation complete (this file + R1-FIX-DOCUMENTATION.md)

---

## 📞 Support & Escalation

If you encounter issues during verification:

1. Check `pnpm lint` output for style issues
2. Review `pnpm typecheck` for type errors
3. Examine browser console for runtime errors
4. Verify `.env.local` configuration is correct
5. Contact R1Fixer agent or create GitHub issue

---

## 📊 Verification Status Template

```markdown
## Personal Verification Log

Date: YYYY-MM-DD
Verified By: [Your Name]

✓ Unit Tests: PASS / FAIL / SKIP
✓ E2E Tests: PASS / FAIL / SKIP  
✓ Type Check: PASS / FAIL / SKIP
✓ Manual Smoke Test: PASS / FAIL / SKIP

Notes:
- Add any observations here
- Document environment specifics (OS, browser, Node version)
- Record any deviations from expected behavior

Final Decision: ✅ APPROVED / ❌ REJECTED / ⚠️ NEEDS REVIEW
```

---

**End of Verification Guide**
