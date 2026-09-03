-- =============================================================================
-- Migration 001: JerryPay — Agentic Commerce Step Types + audit_log
-- Extends workflow_steps.type CHECK to include 4 new agentic commerce step types.
-- Adds audit_log JSONB column and waiting_approval status to step_runs.
-- Idempotent: safe to re-run on an already-migrated database.
-- Run against your Nhost/PostgreSQL database.
-- =============================================================================

-- ── 1. Extend workflow_steps.type CHECK constraint ───────────────────────────
-- Drop the existing constraint (covers original 8 types)
ALTER TABLE workflow_steps
  DROP CONSTRAINT IF EXISTS workflow_steps_type_check;

-- Re-add with all 12 step types (8 original + 4 JerryPay agentic commerce)
ALTER TABLE workflow_steps
  ADD CONSTRAINT workflow_steps_type_check
  CHECK (type IN (
    -- Original step types
    'llm_call',
    'http_request',
    'db_write',
    'notify',
    'conditional_branch',
    'approval_gate',
    'whatsapp_msg',
    'code_transform',
    -- JerryPay agentic commerce step types
    'AI_AGENT_RECOMMENDER',   -- AI evaluates buyer request & computes bundle pricing
    'POLICY_GATE',            -- Deterministic boundary check (discount<=15%, total<=₹5000, risk tags)
    'RAZORPAY_ORDER_CREATE',  -- Creates Razorpay order via test-mode API
    'RECOVERY_HANDLER'        -- Fallback for payment/boundary exceptions
  ));

-- ── 2. Extend step_runs.status CHECK constraint ──────────────────────────────
-- Drop the existing constraint
ALTER TABLE step_runs
  DROP CONSTRAINT IF EXISTS step_runs_status_check;

-- Re-add with waiting_approval (POLICY_GATE breach state) added
ALTER TABLE step_runs
  ADD CONSTRAINT step_runs_status_check
  CHECK (status IN (
    'pending',
    'running',
    'completed',
    'failed',
    'skipped',            -- bypassed by conditional_branch
    'awaiting_approval',  -- blocked at approval_gate (human approval)
    'waiting_approval'    -- blocked at POLICY_GATE threshold breach (policy approval)
  ));

-- ── 3. Add audit_log JSONB column to step_runs ───────────────────────────────
-- Stores structured reasoning, policy verdicts, and payment receipts per step.
-- Schema per step type:
--   AI_AGENT_RECOMMENDER: { reasoning, bundle, recommended_price_inr, discount_pct }
--   POLICY_GATE:          { verdict: 'PASS'|'BREACH', checks: [...], breached_rules: [...] }
--   RAZORPAY_ORDER_CREATE:{ order_id, amount_paise, currency, receipt, status, razorpay_response }
--   RECOVERY_HANDLER:     { exception_type, handled, fallback_action, notified }
ALTER TABLE step_runs
  ADD COLUMN IF NOT EXISTS audit_log JSONB DEFAULT '{}';

COMMENT ON COLUMN step_runs.audit_log IS
  'JerryPay: structured audit log per step — AI reasoning, policy verdicts, Razorpay receipts, recovery actions.';

-- ── 4. Index for efficient POLICY_GATE breach queries ────────────────────────
CREATE INDEX IF NOT EXISTS idx_step_runs_waiting_approval
  ON step_runs (workflow_run_id, status)
  WHERE status = 'waiting_approval';

SELECT 'Migration 001 applied: JerryPay agentic commerce step types + audit_log + waiting_approval.' AS status;
