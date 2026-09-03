#!/usr/bin/env node
/**
 * db/seed.js — Jerry Demo Seed Script (v2 — hybrid SQL + GraphQL)
 * ─────────────────────────────────────────────────────────────────────────────
 * • SQL via /v1/query  : DDL (RLS toggle), simple scalar inserts
 * • GraphQL mutations  : JSON-config rows (workflow_steps, step_runs) —
 *                        avoids all SQL quoting complexity for JSONB columns
 *
 * Usage:
 *   node db/seed.js
 *
 * Reads NHOST_GRAPHQL_URL and NHOST_ADMIN_SECRET from web/.env.local
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── 1. Load env from web/.env.local ─────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../web/.env.local");

if (!fs.existsSync(envPath)) {
  console.error("❌  web/.env.local not found.");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().split(/\s+#/)[0].trim()];
    })
);

const GRAPHQL_URL  = env.NHOST_GRAPHQL_URL;
const ADMIN_SECRET = env.NHOST_ADMIN_SECRET;

if (!GRAPHQL_URL || !ADMIN_SECRET) {
  console.error("❌  NHOST_GRAPHQL_URL or NHOST_ADMIN_SECRET missing in web/.env.local");
  process.exit(1);
}

const SQL_URL = GRAPHQL_URL.replace(/\/v1\/graphql$/, "/v1/query");

console.log("🔗  Hasura SQL  :", SQL_URL);
console.log("🔗  Hasura GQL  :", GRAPHQL_URL);
console.log("🔑  Admin secret:", ADMIN_SECRET.slice(0, 6) + "…\n");

// ─── 2. Helpers ───────────────────────────────────────────────────────────────
async function runSQL(sql, label) {
  process.stdout.write(`  ⏳ ${label}… `);
  const res = await fetch(SQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({ type: "run_sql", args: { sql, cascade: false } }),
  });
  const body = await res.json();
  if (!res.ok || body.code) {
    console.log("❌");
    console.error("    Error:", JSON.stringify(body?.internal?.error ?? body, null, 2));
    throw new Error(`SQL failed (${label}): ${body?.internal?.error?.message ?? body.error ?? res.statusText}`);
  }
  console.log("✓");
  return body;
}

async function runGQL(query, variables = {}, label = "") {
  if (label) process.stdout.write(`  ⏳ ${label}… `);
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    if (label) console.log("❌");
    throw new Error(`GQL failed (${label}): ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (label) console.log("✓");
  return json.data;
}

// ─── 3. Seed data definitions (JS objects — zero quoting issues) ─────────────
const STEP_CONFIGS = {
  step1: {
    model: "gemini-1.5-flash",
    temperature: 0.3,
    max_tokens: 512,
    system_prompt:
      "You are an expert B2B sales analyst. Given a lead profile, produce a JSON object with two fields: \"summary\" (2-3 sentence description) and \"score\" (integer 0-100 reflecting purchase intent). Respond with valid JSON only.",
    user_prompt_template:
      "Analyse this lead:\n\n{{output.lead_profile}}\n\nReturn JSON with keys: summary, score.",
  },
  step2: {
    condition_expression:
      "(() => { try { const p = typeof output.text === 'string' ? JSON.parse(output.text) : output; return Number(p.score) > 70; } catch(e) { return false; } })()",
    true_step_order: 3,
    false_step_order: 4,
    description: "Routes high-scoring leads (>70) through human approval before CRM push.",
  },
  step3: {
    approver_role: "owner",
    timeout_hours: 24,
    instructions:
      "A high-value lead (score > 70) has been identified. Please review the AI summary and approve or reject sending to the CRM pipeline.",
  },
  step4: {
    url: "https://httpbin.org/post",
    method: "POST",
    timeout_ms: 8000,
    headers: {
      "Content-Type": "application/json",
      "X-Jerry-Workflow": "ai-lead-enricher",
    },
    body_template: '{"lead_summary":"{{output.text}}","source":"jerry-ai-enricher"}',
  },
};

// ─── 4. Main ──────────────────────────────────────────────────────────────────
async function main() {
  // ── Check for existing seed ─────────────────────────────────────────────────
  console.log("🔍  Checking for existing seed data…");
  const check = await runSQL(
    `SELECT COUNT(*)::int FROM organizations WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';`,
    "Check seed state"
  );
  const already = parseInt(check.result?.[1]?.[0] ?? "0", 10);
  if (already > 0) {
    console.log("\n⚠️   Seed already present — skipping inserts. Running verification…\n");
    await printVerification();
    return;
  }

  // ── Disable FORCE RLS ───────────────────────────────────────────────────────
  console.log("\n🔓  Disabling FORCE RLS…");
  const tables = [
    "organizations", "org_members", "workflows",
    "workflow_steps", "workflow_triggers", "workflow_runs", "step_runs",
  ];
  for (const t of tables) {
    await runSQL(
      `ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;`,
      `RLS off: ${t}`
    );
  }

  // ── Insert orgs + members via SQL (no JSON) ─────────────────────────────────
  console.log("\n🌱  Inserting seed data…");

  await runSQL(`
    INSERT INTO organizations (id, name, slug, usage_allowed, usage_count, billing_cycle_start)
    VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A - Acme Corp', 'acme-corp', 100, 0, NOW()),
      ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B - Beta Inc',  'beta-inc',   50, 0, NOW())
    ON CONFLICT (id) DO NOTHING;
  `, "Organizations (2)");

  await runSQL(`
    INSERT INTO org_members (id, user_id, org_id, role)
    VALUES
      ('cccccccc-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','owner'),
      ('cccccccc-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','editor'),
      ('cccccccc-0000-0000-0000-000000000003','33333333-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','owner')
    ON CONFLICT (id) DO NOTHING;
  `, "Org Members (3)");

  await runSQL(`
    INSERT INTO workflows (id, org_id, name, description, is_active, created_by)
    VALUES (
      'dddddddd-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001',
      'AI Lead Enricher',
      'Scores an inbound lead using an LLM, conditionally routes for human approval, then fires a webhook to the CRM.',
      true,
      '11111111-0000-0000-0000-000000000001'
    ) ON CONFLICT (id) DO NOTHING;
  `, "Workflow: AI Lead Enricher");

  // ── Workflow Steps via GraphQL mutation (JSONB config sent as GQL variable) ──
  await runGQL(`
    mutation InsertSteps($steps: [workflow_steps_insert_input!]!) {
      insert_workflow_steps(
        objects: $steps
        on_conflict: { constraint: workflow_steps_pkey, update_columns: [] }
      ) { affected_rows }
    }
  `, {
    steps: [
      { id: "eeeeeeee-0000-0000-0000-000000000001", workflow_id: "dddddddd-0000-0000-0000-000000000001", step_order: 1, type: "llm_call",           label: "Score & Summarise Lead",   config: STEP_CONFIGS.step1 },
      { id: "eeeeeeee-0000-0000-0000-000000000002", workflow_id: "dddddddd-0000-0000-0000-000000000001", step_order: 2, type: "conditional_branch", label: "High-Value Lead Gate",    config: STEP_CONFIGS.step2 },
      { id: "eeeeeeee-0000-0000-0000-000000000003", workflow_id: "dddddddd-0000-0000-0000-000000000001", step_order: 3, type: "approval_gate",      label: "Manager Approval",       config: STEP_CONFIGS.step3 },
      { id: "eeeeeeee-0000-0000-0000-000000000004", workflow_id: "dddddddd-0000-0000-0000-000000000001", step_order: 4, type: "http_request",       label: "Push Lead to CRM Webhook", config: STEP_CONFIGS.step4 },
    ],
  }, "Workflow Steps (4)");

  // ── Triggers via GraphQL ────────────────────────────────────────────────────
  await runGQL(`
    mutation InsertTriggers($triggers: [workflow_triggers_insert_input!]!) {
      insert_workflow_triggers(
        objects: $triggers
        on_conflict: { constraint: workflow_triggers_pkey, update_columns: [] }
      ) { affected_rows }
    }
  `, {
    triggers: [
      { id: "ffffffff-0000-0000-0000-000000000001", workflow_id: "dddddddd-0000-0000-0000-000000000001", trigger_type: "manual",  is_active: true, config: {} },
      { id: "ffffffff-0000-0000-0000-000000000002", workflow_id: "dddddddd-0000-0000-0000-000000000001", trigger_type: "webhook", is_active: true, config: { secret_hash: "sha256:REPLACE_WITH_HMAC", allowed_ips: [], description: "Inbound lead capture form." } },
    ],
  }, "Workflow Triggers (2)");

  // ── Workflow Run via SQL (simple scalars) ───────────────────────────────────
  await runSQL(`
    INSERT INTO workflow_runs (
      id, workflow_id, org_id, triggered_by, trigger_id,
      status, metadata, started_at, paused_at, paused_step_id
    ) VALUES (
      'a1b2c3d4-0000-0000-0000-000000000001',
      'dddddddd-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001',
      '11111111-0000-0000-0000-000000000001',
      'ffffffff-0000-0000-0000-000000000001',
      'paused',
      '{"lead_profile":"Jane Smith VP Engineering TechCorp 500 employees","source":"demo_seed"}',
      NOW() - INTERVAL '5 minutes',
      NOW() - INTERVAL '2 minutes',
      'eeeeeeee-0000-0000-0000-000000000003'
    ) ON CONFLICT (id) DO NOTHING;
  `, "Workflow Run (paused sample)");

  // ── Step Runs via GraphQL ───────────────────────────────────────────────────
  await runGQL(`
    mutation InsertStepRuns($rows: [step_runs_insert_input!]!) {
      insert_step_runs(
        objects: $rows
        on_conflict: { constraint: step_runs_pkey, update_columns: [] }
      ) { affected_rows }
    }
  `, {
    rows: [
      {
        id: "b1000000-0000-0000-0000-000000000001",
        workflow_run_id: "a1b2c3d4-0000-0000-0000-000000000001",
        step_id: "eeeeeeee-0000-0000-0000-000000000001",
        status: "completed",
        attempt_count: 1,
        input:  { lead_profile: "Jane Smith VP Engineering TechCorp 500 employees. Downloaded whitepaper. Budget: high." },
        output: { text: JSON.stringify({ summary: "Jane Smith is a senior technical decision-maker at a mid-market company with strong intent signals. Ideal ICP match for enterprise tier.", score: 87 }), model: "gemini-1.5-flash", finish_reason: "STOP" },
        started_at: new Date(Date.now() - 5 * 60000).toISOString(),
        ended_at:   new Date(Date.now() - 4.5 * 60000).toISOString(),
      },
      {
        id: "b1000000-0000-0000-0000-000000000002",
        workflow_run_id: "a1b2c3d4-0000-0000-0000-000000000001",
        step_id: "eeeeeeee-0000-0000-0000-000000000002",
        status: "completed",
        attempt_count: 1,
        input:  { text: JSON.stringify({ summary: "Jane Smith...", score: 87 }) },
        output: { condition_met: true, branching_to_step: 3 },
        started_at: new Date(Date.now() - 4.5 * 60000).toISOString(),
        ended_at:   new Date(Date.now() - 4.4 * 60000).toISOString(),
      },
      {
        id: "b1000000-0000-0000-0000-000000000003",
        workflow_run_id: "a1b2c3d4-0000-0000-0000-000000000001",
        step_id: "eeeeeeee-0000-0000-0000-000000000003",
        status: "awaiting_approval",
        attempt_count: 1,
        input:  { condition_met: true, branching_to_step: 3 },
        output: STEP_CONFIGS.step3,
        started_at: new Date(Date.now() - 2 * 60000).toISOString(),
      },
      {
        id: "b1000000-0000-0000-0000-000000000004",
        workflow_run_id: "a1b2c3d4-0000-0000-0000-000000000001",
        step_id: "eeeeeeee-0000-0000-0000-000000000004",
        status: "pending",
        attempt_count: 1,
        input: {},
      },
    ],
  }, "Step Runs (4)");

  // ── Re-enable FORCE RLS ─────────────────────────────────────────────────────
  console.log("\n🔒  Re-enabling FORCE RLS…");
  for (const t of tables) {
    await runSQL(
      `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;`,
      `RLS on: ${t}`
    );
  }

  console.log("\n✅  Seed complete!\n");
  await printVerification();
}

// ─── 5. Verification ─────────────────────────────────────────────────────────
async function printVerification() {
  console.log("🔎  Verifying via GraphQL…\n");
  const data = await runGQL(`
    query Verify {
      workflows_aggregate { aggregate { count } }
      workflow_runs_aggregate { aggregate { count } }
      step_runs_aggregate { aggregate { count } }
      workflows(limit: 5) {
        name is_active
        workflow_steps_aggregate  { aggregate { count } }
        workflow_triggers_aggregate { aggregate { count } }
      }
      workflow_runs(limit: 5) {
        id status paused_step_id
      }
    }
  `);

  const wf = data.workflows_aggregate.aggregate.count;
  const wr = data.workflow_runs_aggregate.aggregate.count;
  const sr = data.step_runs_aggregate.aggregate.count;

  console.log(`  📊  Workflows   : ${wf}`);
  console.log(`  📊  Runs        : ${wr}`);
  console.log(`  📊  Step Runs   : ${sr}`);

  for (const w of data.workflows) {
    console.log(`\n  📋  "${w.name}" [${w.is_active ? "active" : "inactive"}]`);
    console.log(`       Steps: ${w.workflow_steps_aggregate.aggregate.count}  Triggers: ${w.workflow_triggers_aggregate.aggregate.count}`);
  }

  for (const r of data.workflow_runs) {
    const gate = r.paused_step_id ? ` ⏸ paused at ${r.paused_step_id.slice(0, 8)}…` : "";
    console.log(`\n  🏃  Run ${r.id.slice(0, 8)}… [${r.status}]${gate}`);
  }

  console.log("");
  if (wf === 0 || wr === 0) {
    console.warn("⚠️   WARNING: counts are 0 — something may not have committed.");
    process.exit(1);
  }
  console.log("🎉  Open http://localhost:3000/dashboard to see the data!\n");
}

main().catch((err) => {
  console.error("\n❌  Seed failed:", err.message);
  process.exit(1);
});
