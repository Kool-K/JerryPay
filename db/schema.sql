-- =============================================================================
-- JerryPay: Agentic Commerce Gateway
-- PostgreSQL Schema
-- =============================================================================
-- Run this script against your Nhost PostgreSQL database.
-- Requires: uuid-ossp extension (pre-installed on Nhost).
-- Order matters: tables are created dependency-first.
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 1. organizations
-- =============================================================================
CREATE TABLE organizations (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT          NOT NULL,
  slug            TEXT          UNIQUE NOT NULL,          -- URL-safe identifier
  usage_allowed   INT           NOT NULL DEFAULT 100,     -- max workflow runs per billing cycle
  usage_count     INT           NOT NULL DEFAULT 0,       -- current billing-cycle run count
  billing_cycle_start TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- reset anchor for usage_count
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE organizations IS 'Top-level tenant. Every resource belongs to an org.';
COMMENT ON COLUMN organizations.usage_allowed IS 'Hard cap on workflow_runs per billing cycle.';
COMMENT ON COLUMN organizations.usage_count   IS 'Incremented on each successful run completion; reset at billing cycle start.';

CREATE INDEX idx_organizations_slug ON organizations (slug);

-- =============================================================================
-- 2. org_members
-- =============================================================================
CREATE TABLE org_members (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID    NOT NULL,                                -- references auth.users(id) in Nhost
  org_id      UUID    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role        TEXT    NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, org_id)  -- one membership record per user per org
);

COMMENT ON TABLE org_members IS 'Associates Nhost users with organizations and grants a role.';
COMMENT ON COLUMN org_members.role IS 'owner: full CRUD. editor: create/edit/run workflows. viewer: read-only.';

CREATE INDEX idx_org_members_user_id ON org_members (user_id);
CREATE INDEX idx_org_members_org_id  ON org_members (org_id);

-- =============================================================================
-- 3. workflows
-- =============================================================================
CREATE TABLE workflows (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID,  -- auth.users(id) — nullable to support programmatic creation
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workflows IS 'A named, reusable workflow definition belonging to an org.';

CREATE INDEX idx_workflows_org_id    ON workflows (org_id);
CREATE INDEX idx_workflows_is_active ON workflows (org_id, is_active);

-- =============================================================================
-- 4. workflow_steps
-- =============================================================================
CREATE TABLE workflow_steps (
  id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id  UUID    NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  step_order   INT     NOT NULL,  -- 1-based execution order within the workflow
  type         TEXT    NOT NULL CHECK (type IN (
                  -- ── Original step types ───────────────────────────────
                  'llm_call',
                  'http_request',
                  'db_write',
                  'notify',
                  'conditional_branch',
                  'approval_gate',
                  'whatsapp_msg',
                  'code_transform',
                  -- ── JerryPay agentic commerce step types ─────────────
                  'AI_AGENT_RECOMMENDER',   -- AI evaluates buyer request & computes bundle pricing
                  'POLICY_GATE',            -- Deterministic boundary check (discount≤15%, total≤₹5000, risk tags)
                  'RAZORPAY_ORDER_CREATE',  -- Creates Razorpay order via test-mode API
                  'RECOVERY_HANDLER'        -- Fallback for payment/boundary exceptions
                )),
  label        TEXT,               -- human-readable step name
  config       JSONB   NOT NULL DEFAULT '{}',
  -- config schema per type (enforced in application layer):
  --   llm_call:                { model, system_prompt, user_prompt_template, temperature?, max_tokens? }
  --   http_request:            { url, method, headers?, body_template?, timeout_ms? }
  --   db_write:                { table, operation, data_template }
  --   notify:                  { channel: 'email'|'slack'|'webhook', recipient_template, message_template }
  --   conditional_branch:      { condition_expression, true_step_order, false_step_order }
  --   approval_gate:           { approver_role, timeout_hours?, instructions? }
  --   whatsapp_msg:            { recipient_phone, message_template }
  --   code_transform:          { code: string (JS snippet, receives `input` and `context`) }
  --   AI_AGENT_RECOMMENDER:    { model?, system_prompt?, max_discount_pct?, currency? }
  --   POLICY_GATE:             { max_discount_pct: 15, max_total_inr: 5000, blocked_risk_tags?: string[] }
  --   RAZORPAY_ORDER_CREATE:   { currency?: 'INR', receipt_prefix?: string }
  --   RECOVERY_HANDLER:        { notify_channel?: 'email'|'slack'|'webhook', fallback_message_template? }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workflow_id, step_order)  -- no duplicate positions in a workflow
);

COMMENT ON TABLE workflow_steps IS 'Ordered steps that define the execution logic of a workflow.';
COMMENT ON COLUMN workflow_steps.config IS 'Step-type-specific configuration object (validated in app layer).';

CREATE INDEX idx_workflow_steps_workflow_id ON workflow_steps (workflow_id, step_order);

-- =============================================================================
-- 5. workflow_triggers
-- =============================================================================
CREATE TABLE workflow_triggers (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id   UUID    NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  trigger_type  TEXT    NOT NULL CHECK (trigger_type IN (
                   'manual',        -- started via API/UI
                   'scheduled',     -- cron-based
                   'webhook',       -- inbound HTTP webhook
                   'event'          -- internal event bus
                )),
  config        JSONB   NOT NULL DEFAULT '{}',
  -- config schema per trigger_type:
  --   manual:    {}
  --   scheduled: { cron_expression, timezone }
  --   webhook:   { secret_hash, allowed_ips? }
  --   event:     { event_name, filter? }
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workflow_triggers IS 'Defines how a workflow can be invoked (manual, scheduled, webhook, event).';

CREATE INDEX idx_workflow_triggers_workflow_id ON workflow_triggers (workflow_id);
CREATE INDEX idx_workflow_triggers_type        ON workflow_triggers (trigger_type, is_active);

-- =============================================================================
-- 6. workflow_runs
-- =============================================================================
CREATE TABLE workflow_runs (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id   UUID    NOT NULL REFERENCES workflows (id) ON DELETE SET NULL,  -- preserve history
  org_id        UUID    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  triggered_by  UUID,   -- auth.users(id); NULL for automated triggers
  trigger_id    UUID    REFERENCES workflow_triggers (id) ON DELETE SET NULL,
  status        TEXT    NOT NULL DEFAULT 'running' CHECK (status IN (
                   'running',
                   'paused',      -- waiting at an approval_gate
                   'completed',
                   'failed',
                   'cancelled'
                )),
  metadata      JSONB   NOT NULL DEFAULT '{}',  -- arbitrary caller-supplied context
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,  -- NULL until terminal status reached
  paused_at     TIMESTAMPTZ,  -- set when status becomes 'paused'
  paused_step_id UUID REFERENCES workflow_steps (id) ON DELETE SET NULL
);

COMMENT ON TABLE workflow_runs IS 'A single execution instance of a workflow. Immutable once completed.';
COMMENT ON COLUMN workflow_runs.paused_step_id IS 'Points to the approval_gate step currently blocking execution.';

CREATE INDEX idx_workflow_runs_org_id      ON workflow_runs (org_id, started_at DESC);
CREATE INDEX idx_workflow_runs_workflow_id ON workflow_runs (workflow_id, started_at DESC);
CREATE INDEX idx_workflow_runs_status      ON workflow_runs (org_id, status) WHERE status IN ('running','paused');

-- =============================================================================
-- 7. step_runs
-- =============================================================================
CREATE TABLE step_runs (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id  UUID    NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  step_id          UUID    NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  status           TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending',
                      'running',
                      'completed',
                      'failed',
                      'skipped',            -- bypassed by conditional_branch
                      'awaiting_approval',  -- blocked at approval_gate
                      'waiting_approval'    -- blocked at POLICY_GATE threshold breach
                   )),
  input            JSONB   NOT NULL DEFAULT '{}',   -- resolved inputs passed to this step
  output           JSONB,                            -- result produced by this step
  error            TEXT,                             -- error message on failure
  attempt_count    INT     NOT NULL DEFAULT 1,       -- incremented on retry
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,

  -- Approval gate fields (populated by the human approver)
  approved_by      UUID,   -- auth.users(id)
  approved_at      TIMESTAMPTZ,
  approval_note    TEXT,

  -- JerryPay: structured audit log for AI reasoning, policy verdicts, and payment receipts
  -- Schema per step type:
  --   AI_AGENT_RECOMMENDER: { reasoning: string, bundle: {...}, recommended_price_inr: number, discount_pct: number }
  --   POLICY_GATE:          { verdict: 'PASS'|'BREACH', checks: [{rule, value, limit, passed}], breached_rules: string[] }
  --   RAZORPAY_ORDER_CREATE:{ order_id, amount_paise, currency, receipt, status, razorpay_response }
  --   RECOVERY_HANDLER:     { exception_type, handled: bool, fallback_action, notified: bool }
  audit_log        JSONB   DEFAULT '{}',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE step_runs IS 'Per-step execution record within a workflow_run. Written by the serverless engine.';
COMMENT ON COLUMN step_runs.attempt_count IS 'Number of times this step was attempted (including retries).';

CREATE INDEX idx_step_runs_workflow_run_id ON step_runs (workflow_run_id);
CREATE INDEX idx_step_runs_step_id         ON step_runs (step_id);
CREATE INDEX idx_step_runs_status          ON step_runs (workflow_run_id, status);

-- =============================================================================
-- TRIGGERS: updated_at auto-maintenance
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_workflows_updated_at
  BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_workflow_steps_updated_at
  BEFORE UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_workflow_triggers_updated_at
  BEFORE UPDATE ON workflow_triggers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
