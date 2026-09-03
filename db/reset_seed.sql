-- =============================================================================
-- JerryPay: Reset Seed Data
-- Run this to wipe seeded demo data before re-running seed.sql
-- WARNING: Deletes ALL rows with the known seed UUIDs — safe to run in dev only.
-- NOTE: schema.sql must have been run with the latest migration (001) applied
--       so that step_runs.audit_log and the 4 JerryPay step types exist.
-- =============================================================================

-- Step runs first (deepest FK dependency — all 3 demo runs)
DELETE FROM step_runs
WHERE workflow_run_id IN (
  'a1b2c3d4-0000-0000-0000-000000000001',  -- AI Lead Enricher run
  'a1b2c3d4-0000-0000-0000-000000000002',  -- Autonomous Micro-Checkout run
  'a1b2c3d4-0000-0000-0000-000000000003'   -- High-Value Order (paused) run
);

-- Workflow runs
DELETE FROM workflow_runs
WHERE id IN (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'a1b2c3d4-0000-0000-0000-000000000002',
  'a1b2c3d4-0000-0000-0000-000000000003'
);

-- Workflow triggers (4 triggers across 3 workflows)
DELETE FROM workflow_triggers
WHERE id IN (
  'ffffffff-0000-0000-0000-000000000001',  -- AI Lead Enricher / manual
  'ffffffff-0000-0000-0000-000000000002',  -- AI Lead Enricher / webhook
  'ffffffff-0000-0000-0000-000000000003',  -- Autonomous Micro-Checkout / manual
  'ffffffff-0000-0000-0000-000000000004'   -- High-Value Order / manual
);

-- Workflow steps (all 3 workflows × their steps)
DELETE FROM workflow_steps
WHERE id IN (
  -- AI Lead Enricher (original 4)
  'eeeeeeee-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000002',
  'eeeeeeee-0000-0000-0000-000000000003',
  'eeeeeeee-0000-0000-0000-000000000004',
  -- Autonomous Micro-Checkout (Workflow A — 3 steps)
  'eeeeeeee-0000-0000-0000-000000000005',  -- AI_AGENT_RECOMMENDER
  'eeeeeeee-0000-0000-0000-000000000006',  -- POLICY_GATE
  'eeeeeeee-0000-0000-0000-000000000007',  -- RAZORPAY_ORDER_CREATE
  -- High-Value Order (Workflow B — 4 steps, suffix a–d)
  'eeeeeeee-0000-0000-0000-00000000000a',  -- AI_AGENT_RECOMMENDER
  'eeeeeeee-0000-0000-0000-00000000000b',  -- POLICY_GATE
  'eeeeeeee-0000-0000-0000-00000000000c',  -- RAZORPAY_ORDER_CREATE
  'eeeeeeee-0000-0000-0000-00000000000d'   -- RECOVERY_HANDLER
);

-- Workflows (all 3)
DELETE FROM workflows
WHERE id IN (
  'dddddddd-0000-0000-0000-000000000001',  -- AI Lead Enricher
  'dddddddd-0000-0000-0000-000000000002',  -- Autonomous Micro-Checkout
  'dddddddd-0000-0000-0000-000000000003'   -- High-Value Order
);

-- Org members
DELETE FROM org_members
WHERE id IN (
  'cccccccc-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000002',
  'cccccccc-0000-0000-0000-000000000003'
);

-- Organizations (cascades will catch remaining children if any)
DELETE FROM organizations
WHERE id IN (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000001'
);

SELECT 'JerryPay seed data reset complete. Safe to re-run seed.sql.' AS status;
