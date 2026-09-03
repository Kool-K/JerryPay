-- =============================================================================
-- JerryPay: Agentic Commerce Gateway
-- Seed Data — Demo / Test Data
-- =============================================================================
-- Run this AFTER schema.sql and permissions.sql.
--
-- NOTE: Nhost manages real users via auth.users. Since seed data runs at the
-- DB level without going through Nhost Auth signup, we insert placeholder UUIDs
-- for user_id references. In production testing, replace these with real UUIDs
-- from your auth.users table (copy from Nhost Dashboard → Auth → Users).
--
-- All IDs are fixed/deterministic so you can reference them in tests.
-- =============================================================================

-- Prevent accidental double-runs
SET session_replication_role = 'replica';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = 'acme-corp') THEN
    RAISE EXCEPTION 'Seed data already loaded. Run db/reset_seed.sql first.';
  END IF;
END;
$$;

-- =============================================================================
-- 1. ORGANIZATIONS
-- =============================================================================

INSERT INTO organizations (id, name, slug, usage_allowed, usage_count, billing_cycle_start)
VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'Org A - Acme Corp',
    'acme-corp',
    100,
    0,
    NOW()
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'Org B - Beta Inc',
    'beta-inc',
    50,
    0,
    NOW()
  );

-- =============================================================================
-- 2. MOCK USER IDs (stub UUIDs — replace with real auth.users IDs for E2E tests)
-- =============================================================================
-- User: alice@acme.com  → Org A Owner
-- User: bob@acme.com   → Org A Editor
-- User: carol@beta.com → Org B Owner

-- =============================================================================
-- 3. ORG MEMBERS
-- =============================================================================

INSERT INTO org_members (id, user_id, org_id, role)
VALUES
  -- Org A Owner: Alice
  (
    'cccccccc-0000-0000-0000-000000000001',  -- org_member id
    '11111111-0000-0000-0000-000000000001',  -- alice user_id (stub)
    'aaaaaaaa-0000-0000-0000-000000000001',  -- org A
    'owner'
  ),
  -- Org A Editor: Bob
  (
    'cccccccc-0000-0000-0000-000000000002',
    '22222222-0000-0000-0000-000000000001',  -- bob user_id (stub)
    'aaaaaaaa-0000-0000-0000-000000000001',  -- org A
    'editor'
  ),
  -- Org B Owner: Carol
  (
    'cccccccc-0000-0000-0000-000000000003',
    '33333333-0000-0000-0000-000000000001',  -- carol user_id (stub)
    'bbbbbbbb-0000-0000-0000-000000000001',  -- org B
    'owner'
  );

-- =============================================================================
-- 4. WORKFLOW — "AI Lead Enricher" (Org A)
-- =============================================================================

INSERT INTO workflows (id, org_id, name, description, is_active, created_by)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'AI Lead Enricher',
  'Scores an inbound lead using an LLM, conditionally routes for human approval, then fires a webhook to the CRM.',
  true,
  '11111111-0000-0000-0000-000000000001'  -- created by Alice (Org A owner)
);

-- =============================================================================
-- 5. WORKFLOW STEPS (4 steps, order 1–4)
-- =============================================================================

-- Step 1: LLM Call — summarise & score the lead profile
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  1,
  'llm_call',
  'Score & Summarise Lead',
  '{
    "model": "gemini-1.5-flash",
    "temperature": 0.3,
    "max_tokens": 512,
    "system_prompt": "You are an expert B2B sales analyst. Given a lead profile, produce a JSON object with two fields: \"summary\" (2-3 sentence plain-English description of the lead) and \"score\" (integer 0-100 reflecting purchase intent based on job title, company size, and activity signals). Respond with valid JSON only — no markdown fences.",
    "user_prompt_template": "Here is the lead profile to analyse:\n\n{{output.lead_profile}}\n\nReturn a JSON object with keys: summary, score."
  }'
);

-- Step 2: Conditional Branch — route based on lead score
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000001',
  2,
  'conditional_branch',
  'High-Value Lead Gate',
  '{
    "condition_expression": "(() => { try { const parsed = typeof output.text === \"string\" ? JSON.parse(output.text) : output; return Number(parsed.score) > 70; } catch(e) { return false; } })()",
    "true_step_order": 3,
    "false_step_order": 4,
    "description": "Routes high-scoring leads (score > 70) through human approval (step 3) before CRM push. Low-scoring leads skip directly to the webhook (step 4)."
  }'
);

-- Step 3: Approval Gate — human review before notifying CRM
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000003',
  'dddddddd-0000-0000-0000-000000000001',
  3,
  'approval_gate',
  'Manager Approval',
  '{
    "approver_role": "owner",
    "timeout_hours": 24,
    "instructions": "A high-value lead (score > 70) has been identified. Please review the AI summary above and approve or reject sending this lead to the CRM pipeline."
  }'
);

-- Step 4: HTTP Request — push enriched lead to webhook / CRM
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000004',
  'dddddddd-0000-0000-0000-000000000001',
  4,
  'http_request',
  'Push Lead to CRM Webhook',
  '{
    "url": "https://httpbin.org/post",
    "method": "POST",
    "timeout_ms": 8000,
    "headers": {
      "Content-Type": "application/json",
      "X-Jerry-Workflow": "ai-lead-enricher",
      "X-Jerry-Org": "acme-corp"
    },
    "body_template": "{\"lead_summary\": \"{{output.text}}\", \"workflow_run_id\": \"{{output.run_id}}\", \"source\": \"jerry-ai-enricher\", \"timestamp\": \"{{output.timestamp}}\"}"
  }'
);

-- =============================================================================
-- 6. WORKFLOW TRIGGERS (2 for Org A workflow)
-- =============================================================================

-- Trigger 1: Manual (via UI / direct API call)
INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, is_active)
VALUES (
  'ffffffff-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  'manual',
  '{}',
  true
);

-- Trigger 2: Webhook (inbound HTTP POST from CRM / form submission)
INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, is_active)
VALUES (
  'ffffffff-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000001',
  'webhook',
  '{
    "secret_hash": "sha256:REPLACE_WITH_HMAC_SECRET_HASH_IN_PRODUCTION",
    "allowed_ips": [],
    "description": "Triggered by inbound form submissions from the Acme Corp marketing site lead capture form."
  }',
  true
);

-- =============================================================================
-- 7. SAMPLE WORKFLOW RUN (demonstrates a paused run at the approval gate)
-- =============================================================================

INSERT INTO workflow_runs (
  id, workflow_id, org_id, triggered_by, trigger_id,
  status, metadata, started_at, paused_at, paused_step_id
)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',  -- AI Lead Enricher
  'aaaaaaaa-0000-0000-0000-000000000001',  -- Org A
  '11111111-0000-0000-0000-000000000001',  -- triggered by Alice
  'ffffffff-0000-0000-0000-000000000001',  -- via manual trigger
  'paused',
  '{"lead_profile": "Jane Smith, VP of Engineering at TechCorp (500 employees). Recently downloaded our whitepaper on AI automation. LinkedIn activity: active. Budget signal: high.", "source": "demo_seed"}',
  NOW() - INTERVAL '5 minutes',
  NOW() - INTERVAL '2 minutes',
  'eeeeeeee-0000-0000-0000-000000000003'   -- paused at the approval_gate step
);

-- Corresponding step_runs for the sample run

-- Step 1 run: completed (LLM returned a summary and score > 70)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output,
  attempt_count, started_at, ended_at
)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000001',
  'completed',
  '{"lead_profile": "Jane Smith, VP of Engineering at TechCorp (500 employees). Recently downloaded our whitepaper on AI automation. LinkedIn activity: active. Budget signal: high."}',
  '{"text": "{\"summary\": \"Jane Smith is a senior technical decision-maker at a mid-market company showing strong intent signals including content consumption and high budget signals. Ideal ICP match for our enterprise tier.\", \"score\": 87}", "model": "gemini-1.5-flash", "finish_reason": "STOP", "usage": {"total_tokens": 234}}',
  1,
  NOW() - INTERVAL '5 minutes',
  NOW() - INTERVAL '4 minutes 30 seconds'
);

-- Step 2 run: completed (conditional branch evaluated score > 70 → true → step 3)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output,
  attempt_count, started_at, ended_at
)
VALUES (
  'b1000000-0000-0000-0000-000000000002',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000002',
  'completed',
  '{"text": "{\"summary\": \"Jane Smith is a senior technical decision-maker...\", \"score\": 87}"}',
  '{"condition_met": true, "branching_to_step": 3}',
  1,
  NOW() - INTERVAL '4 minutes 30 seconds',
  NOW() - INTERVAL '4 minutes 25 seconds'
);

-- Step 3 run: awaiting_approval (the approval gate — currently paused)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output,
  attempt_count, started_at
)
VALUES (
  'b1000000-0000-0000-0000-000000000003',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000003',
  'awaiting_approval',
  '{"condition_met": true, "branching_to_step": 3}',
  '{"instructions": "A high-value lead (score > 70) has been identified. Please review the AI summary above and approve or reject sending this lead to the CRM pipeline.", "approver_role": "owner", "timeout_hours": 24}',
  1,
  NOW() - INTERVAL '2 minutes'
);

-- Step 4 run: pending (waiting for approval gate to be resolved)
-- (not started yet — no started_at)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input,
  attempt_count
)
VALUES (
  'b1000000-0000-0000-0000-000000000004',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000004',
  'pending',
  '{}',
  1
);
SET session_replication_role = 'origin';

-- =============================================================================
-- 8. JERRPAY DEMO WORKFLOW A: "Autonomous Micro-Checkout (Auto-Approved)"
--    Org: Acme Corp (aaaaaaaa-0000-0000-0000-000000000001)
--    Steps: AI_AGENT_RECOMMENDER → POLICY_GATE → RAZORPAY_ORDER_CREATE
--    Outcome: All gates pass, Razorpay test order created autonomously.
-- =============================================================================

INSERT INTO workflows (id, org_id, name, description, is_active, created_by)
VALUES (
  'dddddddd-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Autonomous Micro-Checkout (Auto-Approved)',
  'Buyer requests home decor under ₹3,000. AI recommends SKUs, Policy Gate passes autonomously, Razorpay test order is created without human intervention.',
  true,
  '11111111-0000-0000-0000-000000000001'
);

-- Step 1: AI_AGENT_RECOMMENDER — recommend home decor bundle
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000005',
  'dddddddd-0000-0000-0000-000000000002',
  1,
  'AI_AGENT_RECOMMENDER',
  'AI Bundle Recommender',
  '{
    "max_discount_pct": 15,
    "currency": "INR",
    "system_prompt": "You are JerryPay''s Agentic Commerce AI. Analyse the buyer request and recommend a home decor product bundle under ₹3000. Return ONLY valid JSON: {\"bundle\":[...],\"recommended_price_inr\":number,\"discount_pct\":number,\"reasoning\":\"...\"}."
  }'
);

-- Step 2: POLICY_GATE — enforce 15% discount cap and ₹5000 total cap
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000006',
  'dddddddd-0000-0000-0000-000000000002',
  2,
  'POLICY_GATE',
  'Commerce Policy Gate',
  '{
    "max_discount_pct": 15,
    "max_total_inr": 5000,
    "blocked_risk_tags": ["fraud", "high_risk", "restricted"]
  }'
);

-- Step 3: RAZORPAY_ORDER_CREATE — create test mode Razorpay order
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000007',
  'dddddddd-0000-0000-0000-000000000002',
  3,
  'RAZORPAY_ORDER_CREATE',
  'Razorpay Test Order',
  '{
    "currency": "INR",
    "receipt_prefix": "JPAY_MICRO"
  }'
);

-- Trigger: Manual
INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, is_active)
VALUES (
  'ffffffff-0000-0000-0000-000000000003',
  'dddddddd-0000-0000-0000-000000000002',
  'manual', '{}', true
);

-- ── Completed run (all steps passed autonomously) ─────────────────────────────
INSERT INTO workflow_runs (
  id, workflow_id, org_id, triggered_by, trigger_id,
  status, metadata, started_at, ended_at
)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000001',
  'ffffffff-0000-0000-0000-000000000003',
  'completed',
  '{
    "buyer_request": "I want some nice home decor items for my living room, budget is ₹3000",
    "channel": "web",
    "session_id": "sess_demo_001"
  }',
  NOW() - INTERVAL ''3 minutes'',
  NOW() - INTERVAL ''30 seconds''
);

-- Run A / Step 1: AI_AGENT_RECOMMENDER — completed, with full audit_log
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output, audit_log,
  attempt_count, started_at, ended_at
)
VALUES (
  ''c1000000-0000-0000-0000-000000000001'',
  ''a1b2c3d4-0000-0000-0000-000000000002'',
  ''eeeeeeee-0000-0000-0000-000000000005'',
  ''completed'',
  ''{"buyer_request": "I want some nice home decor items for my living room, budget is ₹3000"}'',
  ''{
    "bundle": [
      {"product_id": "SKU_HD_001", "name": "Terracotta Vase Set (3 pcs)", "price_inr": 899, "qty": 1},
      {"product_id": "SKU_HD_002", "name": "Woven Jute Table Runner", "price_inr": 549, "qty": 2},
      {"product_id": "SKU_HD_003", "name": "Brass Tealight Holders (6 pcs)", "price_inr": 699, "qty": 1}
    ],
    "recommended_price_inr": 2160,
    "discount_pct": 10,
    "reasoning": "Curated a warm, earthy home decor bundle within the ₹3000 budget. Applied 10% loyalty discount on total MRP of ₹2396. All items are high-margin, in-stock SKUs.",
    "step_type": "AI_AGENT_RECOMMENDER"
  }'',
  ''{
    "reasoning": "Curated a warm, earthy home decor bundle within the ₹3000 budget. Applied 10% loyalty discount on total MRP of ₹2396. All items are high-margin, in-stock SKUs.",
    "bundle": [
      {"product_id": "SKU_HD_001", "name": "Terracotta Vase Set (3 pcs)", "price_inr": 899, "qty": 1},
      {"product_id": "SKU_HD_002", "name": "Woven Jute Table Runner", "price_inr": 549, "qty": 2},
      {"product_id": "SKU_HD_003", "name": "Brass Tealight Holders (6 pcs)", "price_inr": 699, "qty": 1}
    ],
    "recommended_price_inr": 2160,
    "discount_pct": 10
  }'',
  1,
  NOW() - INTERVAL ''3 minutes'',
  NOW() - INTERVAL ''2 minutes 30 seconds''
);

-- Run A / Step 2: POLICY_GATE — PASS (discount 10% ≤ 15%, total ₹2160 ≤ ₹5000)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output, audit_log,
  attempt_count, started_at, ended_at
)
VALUES (
  ''c1000000-0000-0000-0000-000000000002'',
  ''a1b2c3d4-0000-0000-0000-000000000002'',
  ''eeeeeeee-0000-0000-0000-000000000006'',
  ''completed'',
  ''{"recommended_price_inr": 2160, "discount_pct": 10}'',
  ''{"verdict": "PASS", "breached_rules": [], "step_type": "POLICY_GATE"}'',
  ''{
    "verdict": "PASS",
    "checks": [
      {"rule": "discount_pct_limit",   "value": 10,   "limit": 15,   "passed": true},
      {"rule": "order_total_limit_inr","value": 2160, "limit": 5000, "passed": true},
      {"rule": "no_blocked_risk_tags", "value": [],   "limit": ["fraud","high_risk","restricted"], "passed": true}
    ],
    "breached_rules": []
  }'',
  1,
  NOW() - INTERVAL ''2 minutes 30 seconds'',
  NOW() - INTERVAL ''2 minutes 29 seconds''
);

-- Run A / Step 3: RAZORPAY_ORDER_CREATE — completed, test order stored
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output, audit_log,
  attempt_count, started_at, ended_at
)
VALUES (
  ''c1000000-0000-0000-0000-000000000003'',
  ''a1b2c3d4-0000-0000-0000-000000000002'',
  ''eeeeeeee-0000-0000-0000-000000000007'',
  ''completed'',
  ''{"recommended_price_inr": 2160, "discount_pct": 10, "verdict": "PASS"}'',
  ''{
    "order_id": "order_TestJPAY_MICRO_001",
    "amount_paise": 216000,
    "amount_inr": 2160,
    "currency": "INR",
    "receipt": "JPAY_MICRO_1725353000000",
    "status": "created",
    "step_type": "RAZORPAY_ORDER_CREATE"
  }'',
  ''{
    "order_id": "order_TestJPAY_MICRO_001",
    "amount_paise": 216000,
    "currency": "INR",
    "receipt": "JPAY_MICRO_1725353000000",
    "status": "created",
    "razorpay_response": {
      "id": "order_TestJPAY_MICRO_001",
      "entity": "order",
      "amount": 216000,
      "amount_paid": 0,
      "amount_due": 216000,
      "currency": "INR",
      "receipt": "JPAY_MICRO_1725353000000",
      "status": "created",
      "attempts": 0,
      "notes": {"source": "JerryPay Agentic Commerce Gateway"}
    }
  }'',
  1,
  NOW() - INTERVAL ''2 minutes 29 seconds'',
  NOW() - INTERVAL ''30 seconds''
);

-- =============================================================================
-- 9. JERRPAY DEMO WORKFLOW B: "High-Value Order (Human Approval Gated)"
--    Org: Acme Corp (aaaaaaaa-0000-0000-0000-000000000001)
--    Steps: AI_AGENT_RECOMMENDER → POLICY_GATE (BREACH) → RAZORPAY_ORDER_CREATE → RECOVERY_HANDLER
--    Outcome: Policy Gate breaches (discount 25% > 15%, total ₹10,500 > ₹5,000).
--             Run pauses at POLICY_GATE for merchant approval.
-- =============================================================================

INSERT INTO workflows (id, org_id, name, description, is_active, created_by)
VALUES (
  ''dddddddd-0000-0000-0000-000000000003'',
  ''aaaaaaaa-0000-0000-0000-000000000001'',
  ''High-Value Order (Human Approval Gated)'',
  ''Buyer orders luxury brass idol set totaling ₹14,000 with a 25% discount. POLICY_GATE detects both threshold breaches and pauses the run for merchant approval.'',
  true,
  ''11111111-0000-0000-0000-000000000001''
);

-- Step 1: AI_AGENT_RECOMMENDER
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  ''eeeeeeee-0000-0000-0000-00000000000a'',
  ''dddddddd-0000-0000-0000-000000000003'',
  1,
  ''AI_AGENT_RECOMMENDER'',
  ''AI Bundle Recommender'',
  ''{
    "max_discount_pct": 15,
    "currency": "INR",
    "system_prompt": "You are JerryPay''s Agentic Commerce AI. Analyse the buyer request and recommend a premium handicraft bundle. Return ONLY valid JSON."
  }''
);

-- Step 2: POLICY_GATE
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  ''eeeeeeee-0000-0000-0000-00000000000b'',
  ''dddddddd-0000-0000-0000-000000000003'',
  2,
  ''POLICY_GATE'',
  ''Commerce Policy Gate'',
  ''{
    "max_discount_pct": 15,
    "max_total_inr": 5000,
    "blocked_risk_tags": ["fraud", "high_risk", "restricted"]
  }''
);

-- Step 3: RAZORPAY_ORDER_CREATE (gated — only runs post merchant approval)
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  ''eeeeeeee-0000-0000-0000-00000000000c'',
  ''dddddddd-0000-0000-0000-000000000003'',
  3,
  ''RAZORPAY_ORDER_CREATE'',
  ''Razorpay Test Order'',
  ''{
    "currency": "INR",
    "receipt_prefix": "JPAY_HV"
  }''
);

-- Step 4: RECOVERY_HANDLER (fallback if order creation fails)
INSERT INTO workflow_steps (id, workflow_id, step_order, type, label, config)
VALUES (
  ''eeeeeeee-0000-0000-0000-00000000000d'',
  ''dddddddd-0000-0000-0000-000000000003'',
  4,
  ''RECOVERY_HANDLER'',
  ''Payment Recovery Fallback'',
  ''{
    "notify_channel": "slack",
    "fallback_message_template": "JerryPay Alert: High-value order ₹{{input.recommended_price_inr}} for buyer failed checkout. Incident escalated to ops team."
  }''
);

-- Trigger: Manual
INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, is_active)
VALUES (
  ''ffffffff-0000-0000-0000-000000000004'',
  ''dddddddd-0000-0000-0000-000000000003'',
  ''manual'', ''{}'', true
);

-- ── Paused run (POLICY_GATE breached, waiting_approval) ──────────────────────
INSERT INTO workflow_runs (
  id, workflow_id, org_id, triggered_by, trigger_id,
  status, metadata, started_at, paused_at, paused_step_id
)
VALUES (
  ''a1b2c3d4-0000-0000-0000-000000000003'',
  ''dddddddd-0000-0000-0000-000000000003'',
  ''aaaaaaaa-0000-0000-0000-000000000001'',
  ''11111111-0000-0000-0000-000000000001'',
  ''ffffffff-0000-0000-0000-000000000004'',
  ''paused'',
  ''{
    "buyer_request": "I want the full Panchadhatu brass idol collector set — all 5 deities",
    "channel": "whatsapp",
    "session_id": "sess_demo_002"
  }'',
  NOW() - INTERVAL ''10 minutes'',
  NOW() - INTERVAL ''9 minutes'',
  ''eeeeeeee-0000-0000-0000-00000000000b''  -- paused at POLICY_GATE
);

-- Run B / Step 1: AI_AGENT_RECOMMENDER — completed (returned high-value bundle)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output, audit_log,
  attempt_count, started_at, ended_at
)
VALUES (
  ''c2000000-0000-0000-0000-000000000001'',
  ''a1b2c3d4-0000-0000-0000-000000000003'',
  ''eeeeeeee-0000-0000-0000-00000000000a'',
  ''completed'',
  ''{"buyer_request": "I want the full Panchadhatu brass idol collector set — all 5 deities"}'',
  ''{
    "bundle": [
      {"product_id": "SKU_IDOL_001", "name": "Ganesh Brass Idol (12 inch)",    "price_inr": 3200, "qty": 1},
      {"product_id": "SKU_IDOL_002", "name": "Lakshmi Brass Idol (10 inch)",   "price_inr": 2800, "qty": 1},
      {"product_id": "SKU_IDOL_003", "name": "Saraswati Brass Idol (10 inch)", "price_inr": 2600, "qty": 1},
      {"product_id": "SKU_IDOL_004", "name": "Shiva Brass Idol (14 inch)",     "price_inr": 3400, "qty": 1},
      {"product_id": "SKU_IDOL_005", "name": "Vishnu Brass Idol (12 inch)",    "price_inr": 2000, "qty": 1}
    ],
    "recommended_price_inr": 10500,
    "discount_pct": 25,
    "reasoning": "Full Panchadhatu collector set with 25% bulk discount from MRP ₹14,000. Premium hand-crafted idols, each individually certified. Buyer explicitly requested all 5.",
    "step_type": "AI_AGENT_RECOMMENDER"
  }'',
  ''{
    "reasoning": "Full Panchadhatu collector set with 25% bulk discount from MRP ₹14,000. Premium hand-crafted idols.",
    "bundle": [
      {"product_id": "SKU_IDOL_001", "name": "Ganesh Brass Idol (12 inch)",    "price_inr": 3200, "qty": 1},
      {"product_id": "SKU_IDOL_002", "name": "Lakshmi Brass Idol (10 inch)",   "price_inr": 2800, "qty": 1},
      {"product_id": "SKU_IDOL_003", "name": "Saraswati Brass Idol (10 inch)", "price_inr": 2600, "qty": 1},
      {"product_id": "SKU_IDOL_004", "name": "Shiva Brass Idol (14 inch)",     "price_inr": 3400, "qty": 1},
      {"product_id": "SKU_IDOL_005", "name": "Vishnu Brass Idol (12 inch)",    "price_inr": 2000, "qty": 1}
    ],
    "recommended_price_inr": 10500,
    "discount_pct": 25
  }'',
  1,
  NOW() - INTERVAL ''10 minutes'',
  NOW() - INTERVAL ''9 minutes 30 seconds''
);

-- Run B / Step 2: POLICY_GATE — BREACH (discount 25% > 15%, total ₹10,500 > ₹5,000)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, output, audit_log,
  attempt_count, started_at, ended_at
)
VALUES (
  ''c2000000-0000-0000-0000-000000000002'',
  ''a1b2c3d4-0000-0000-0000-000000000003'',
  ''eeeeeeee-0000-0000-0000-00000000000b'',
  ''waiting_approval'',
  ''{"recommended_price_inr": 10500, "discount_pct": 25}'',
  ''{"verdict": "BREACH", "breached_rules": ["discount_pct_limit", "order_total_limit_inr"], "step_type": "POLICY_GATE"}'',
  ''{
    "verdict": "BREACH",
    "checks": [
      {"rule": "discount_pct_limit",   "value": 25,    "limit": 15,   "passed": false},
      {"rule": "order_total_limit_inr","value": 10500, "limit": 5000, "passed": false},
      {"rule": "no_blocked_risk_tags", "value": [],    "limit": ["fraud","high_risk","restricted"], "passed": true}
    ],
    "breached_rules": ["discount_pct_limit", "order_total_limit_inr"]
  }'',
  1,
  NOW() - INTERVAL ''9 minutes 30 seconds'',
  NOW() - INTERVAL ''9 minutes''
);

-- Run B / Step 3: RAZORPAY_ORDER_CREATE — pending (blocked by policy gate breach)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, attempt_count
)
VALUES (
  ''c2000000-0000-0000-0000-000000000003'',
  ''a1b2c3d4-0000-0000-0000-000000000003'',
  ''eeeeeeee-0000-0000-0000-00000000000c'',
  ''pending'',
  ''{}'',
  1
);

-- Run B / Step 4: RECOVERY_HANDLER — pending (only fires if order creation fails)
INSERT INTO step_runs (
  id, workflow_run_id, step_id, status, input, attempt_count
)
VALUES (
  ''c2000000-0000-0000-0000-000000000004'',
  ''a1b2c3d4-0000-0000-0000-000000000003'',
  ''eeeeeeee-0000-0000-0000-00000000000d'',
  ''pending'',
  ''{}'',
  1
);

SET session_replication_role = ''origin'';

-- =============================================================================
-- 10. VERIFICATION QUERIES (run manually to confirm seed loaded correctly)
-- =============================================================================
-- SELECT name, slug, usage_allowed FROM organizations;
-- SELECT w.name, COUNT(ws.id) AS steps FROM workflows w JOIN workflow_steps ws ON ws.workflow_id = w.id GROUP BY w.name;
-- SELECT wr.status, sr.status AS step_status, ws.type, sr.audit_log
--   FROM workflow_runs wr
--   JOIN step_runs sr ON sr.workflow_run_id = wr.id
--   JOIN workflow_steps ws ON ws.id = sr.step_id
--   ORDER BY ws.step_order;
