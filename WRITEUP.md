# Jerry — Multi-Tenant AI Agent Workflow Builder
## Technical Write-Up

> **Stack:** Nhost (PostgreSQL 16 + Hasura v2 GraphQL) · Next.js 16 App Router · Gemini API

---

## 1. Schema Design Reasoning

### Entity Relationship Overview

```
organizations
  ├── org_members          (user ↔ org join table with role)
  ├── workflows
  │     ├── workflow_steps   (ordered execution steps, JSONB config)
  │     ├── workflow_triggers (manual / scheduled / webhook)
  │     └── workflow_runs
  │           └── step_runs  (per-step execution records with I/O)
```

### Key Design Decisions

**`organizations`** owns the multi-tenancy boundary. Every downstream entity carries `org_id` directly — enabling efficient RLS policies using a single `org_id` equality check without costly JOINs on the hot query path.

**`org_members`** is a many-to-many join with role enforcement (`owner | editor | viewer`) at the application layer before any write operation. Separating membership from auth allows the same Nhost user to belong to multiple orgs with different roles.

**`workflow_steps`** stores execution configuration as `JSONB` (`config` column) rather than typed columns. This keeps the schema stable as new step types are added without migrations. `step_order INT` controls sequencing; gaps are allowed intentionally so reordering doesn't require renumbering every row.

**`workflow_runs`** captures the run lifecycle (`running → paused → completed / failed`). The `paused_at TIMESTAMPTZ` and `paused_step_id UUID` columns implement the approval gate state — when the engine hits an `approval_gate` step, it writes these two fields and returns early. This intentional denormalisation means resuming a run requires only a single `workflow_runs_by_pk` lookup.

**`step_runs`** records the per-step execution audit trail: `input`, `output` (JSONB), `error`, `attempt_count`, and approval metadata (`approved_by`, `approved_at`, `approval_note`). Keeping input/output at this granularity enables full replay debugging.

**Usage quota** lives on `organizations` (`usage_count INT`, `usage_allowed INT`). `usage_count` is incremented atomically only when a run *completes* — failed or paused runs don't consume quota.

---

## 2. Multi-Tenant Permission Isolation Architecture

Jerry uses a **two-layer isolation model** that enforces tenant boundaries at the database level, not just in application code.

### Layer 1 — PostgreSQL Row Level Security (RLS)

Each table that contains tenant data has RLS enabled:

```sql
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;

CREATE POLICY "users_see_own_org_workflows"
  ON workflows FOR ALL
  USING (
    org_id = ANY(
      string_to_array(
        current_setting('hasura.user.x-hasura-user-org-ids', true), ','
      )::uuid[]
    )
  );
```

This means even if application code skips an `org_id` WHERE clause, the database itself returns zero rows for organisations the requesting user doesn't belong to.

### Layer 2 — Hasura Metadata Permission Rules

Each Hasura table has per-role `select / insert / update / delete` permissions. For example, `workflows` for the `user` role:

```json
{
  "filter": { "org_id": { "_in": "X-Hasura-User-Org-Ids" } },
  "columns": ["id", "name", "org_id", "is_active", "created_at"]
}
```

This prevents column-level data leakage even when the row passes the RLS check.

### Server-Side Admin Bypass

All Next.js API routes use the `x-hasura-admin-secret` header via `adminGql()`. This bypasses RLS intentionally for trusted server-side execution, where the application code performs its own membership check before mutating data:

```ts
const member = await fetchOrgMembership(userId, orgId);
if (!member) throw new ForbiddenError("Not a member of this org");
if (member.role === "viewer") throw new ForbiddenError("Viewers cannot trigger runs");
```

---

## 3. Pause/Resume Approval Gate Implementation

### Trigger Flow (`/api/triggerWorkflowRun`)

```
POST /api/triggerWorkflowRun { workflow_id, org_id }
  ├─ 1. Auth check (userId)
  ├─ 2. Org membership + role check (editor | owner required)
  ├─ 3. Quota check (usage_count < usage_allowed)
  ├─ 4. Create workflow_run (status: "running")
  ├─ 5. Fetch workflow_steps ORDER BY step_order ASC
  └─ 6. Step execution loop:
       FOR each step:
         ├─ IF type == "approval_gate":
         │     update step_run → "awaiting_approval"
         │     update workflow_run → status:"paused", paused_at:NOW(), paused_step_id:step.id
         │     RETURN { run_id, status: "paused" }   ← Early exit
         └─ ELSE execute step → update step_run → "completed"
  └─ 7. All steps done → workflow_run:"completed" → usage_count += 1
```

### Resume Flow (`/api/approveStep`)

```
POST /api/approveStep { workflow_run_id, step_run_id, decision, note }
  ├─ 1. Auth + membership check
  ├─ 2. Load workflow_run (verify status == "paused")
  ├─ 3. Load step_run (verify type == "approval_gate")
  ├─ 4. Update step_run → approve:"completed" | reject:"failed" → RETURN if rejected
  ├─ 5. Clear pause: paused_at=null, paused_step_id=null, status="running"
  └─ 6. continueWorkflowFromStep(workflowRun, gateStep.step_order, gateOutput)
         ├─ Fetch remaining steps (step_order > gate_order)
         └─ Execute via upsertStepRun() — prevents duplicate rows
```

### Duplicate Step Run Prevention (`upsertStepRun`)

`upsertStepRun` queries for an existing row in `pending | awaiting_approval | running` status before inserting. If found, it reuses it by resetting status to `running`:

```ts
async function upsertStepRun(workflowRunId, stepId, input) {
  const existing = await gql(`query { step_runs(where: {
    workflow_run_id: {_eq: $workflowRunId},
    step_id: {_eq: $stepId},
    status: {_in: ["pending","awaiting_approval","running"]}
  }) { id } }`);

  if (existing.step_runs.length > 0) {
    await gql(`mutation { update_step_runs_by_pk(pk_columns:{id:$id}, _set:{status:"running", input:$input}) { id } }`);
    return existing.step_runs[0].id;
  }
  return createStepRun(workflowRunId, stepId, input);
}
```

---

## 4. Quota Enforcement & Retries

### Pre-Run Quota Check

Before execution, the handler fetches `organization.usage_count` and `usage_allowed`. If at limit, a `QuotaError` (HTTP 429) is thrown *before* inserting a `workflow_run` row — quota-blocked attempts don't appear in run history.

```ts
const org = await fetchOrganization(orgId);
if (org.usage_count >= org.usage_allowed) {
  throw new QuotaError(`Limit reached: ${org.usage_count}/${org.usage_allowed}`);
}
```

### Post-Completion Increment

`usage_count` is incremented atomically only on `status === "completed"`. Failed and paused-then-rejected runs do not consume quota.

### LLM Retry with Backoff

LLM steps implement a 1-retry backoff strategy. On first failure, the engine waits 1.5 seconds before retrying. If the second attempt also fails, the error propagates and marks the step `failed`:

```ts
async function callLLM(config, context, attempt = 1) {
  try {
    return await callGemini(model, systemPrompt, userPrompt, config);
  } catch (err) {
    if (attempt < 2) {
      await sleep(1500);
      return callLLM(config, context, attempt + 1);
    }
    throw err;
  }
}
```

### Safe Template Resolution

All `{{placeholder}}` tokens are guarded against `undefined` templates:

```ts
function resolveTemplate(template: string | undefined | null, ctx): string {
  if (!template) return "";
  return template.replace(/\{\{([\w.]+)\}\}/g, ...);
}
```

New workflows always receive sensible default configs (with `user_prompt_template`, `system_prompt`, `model`) so no step ever executes with a bare `{}` config.

---

## 5. Automated Verification Results

All 5 automated E2E tests pass against `http://localhost:3000`:

| # | Scenario | Result |
|---|----------|--------|
| 1 | Org A retrieves "AI Lead Enricher" | ✅ PASS |
| 2 | Trigger run — LLM → conditional → HTTP → completes | ✅ PASS |
| 3 | Approve paused run + no duplicate step_runs | ✅ PASS |
| 4 | New LLM-only workflow — no `.replace()` crash | ✅ PASS |
| 5 | Org B returns [] workflows and [] runs (tenant isolation) | ✅ PASS |

```
═══════════════════════════════════════════════════
  Results: 5 passed, 0 failed
═══════════════════════════════════════════════════
```

Run the suite yourself:
```bash
node scripts/verify-all.js
```

---

*Generated: August 2026 — Jerry v0.1.0*
