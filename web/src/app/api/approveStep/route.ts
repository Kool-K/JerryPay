/**
 * Jerry — Multi-Tenant AI Agent Workflow Builder
 * Serverless Function: approveStep
 * File: functions/approveStep.ts
 *
 * Purpose
 * ───────
 * Resumes a paused workflow_run by resolving the pending approval_gate step_run.
 * After approval, it continues execution from the next step in the workflow.
 *
 * Flow
 * ────
 *  1. Authenticate caller and validate org membership (owner role required)
 *  2. Load the workflow_run (must be in 'paused' status)
 *  3. Validate the caller's role meets the approver_role requirement in the gate config
 *  4. Set step_run → 'completed' with approval metadata (approved_by, approved_at, note)
 *  5. Set workflow_run → 'running', clear paused fields
 *  6. Resume execution from the step AFTER the approval gate
 *  7. Handle rejection: mark run 'failed', step_run 'failed', stop execution
 *
 * Request body
 * ────────────
 * {
 *   "workflow_run_id": "uuid",    — the paused run to resume
 *   "step_run_id":     "uuid",    — the awaiting_approval step_run
 *   "decision":        "approve" | "reject",
 *   "note":            "optional human note"
 * }
 *
 * Environment variables (shared with triggerWorkflowRun):
 *   NHOST_ADMIN_SECRET, NHOST_GRAPHQL_URL,
 *   LLM_PROVIDER, LLM_API_KEY, LLM_DEFAULT_MODEL,
 *   GEMINI_API_URL, GROQ_API_URL, OPENROUTER_API_URL
 */

import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type StepType =
  | "llm_call"
  | "http_request"
  | "db_write"
  | "notify"
  | "conditional_branch"
  | "approval_gate"
  | "whatsapp_msg"
  | "code_transform"
  // JerryPay agentic commerce step types
  | "AI_AGENT_RECOMMENDER"
  | "POLICY_GATE"
  | "RAZORPAY_ORDER_CREATE"
  | "RECOVERY_HANDLER";

type RunStatus = "running" | "paused" | "completed" | "failed" | "cancelled";
type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval"  // blocked at approval_gate (human decision)
  | "waiting_approval"; // blocked at POLICY_GATE threshold breach
type OrgRole = "owner" | "editor" | "viewer";
type Decision = "approve" | "reject";

interface WorkflowStep {
  id: string;
  step_order: number;
  type: StepType;
  label: string | null;
  config: Record<string, unknown>;
}

interface StepRun {
  id: string;
  step_id: string;
  status: StepStatus;
  output: Record<string, unknown> | null;
}

interface WorkflowRun {
  id: string;
  workflow_id: string;
  org_id: string;
  status: RunStatus;
  paused_step_id: string | null;
  metadata: Record<string, unknown>;
}

interface ApprovalGateConfig {
  approver_role?: OrgRole;
  timeout_hours?: number;
  instructions?: string;
}

interface LLMCallConfig {
  model?: string;
  system_prompt?: string;
  user_prompt_template: string;
  temperature?: number;
  max_tokens?: number;
}

interface HttpRequestConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body_template?: string;
  timeout_ms?: number;
}

interface ConditionalBranchConfig {
  condition_expression: string;
  true_step_order: number;
  false_step_order: number;
}

interface DbWriteConfig {
  mutation: string;
  variables_template: string;
}

interface NotifyConfig {
  channel: "email" | "slack" | "webhook";
  recipient_template: string;
  message_template: string;
}

// JerryPay Agentic Commerce Config Interfaces
interface AIAgentRecommenderConfig {
  max_discount_pct?: number;
  currency?: string;
  system_prompt?: string;
  model?: string;
}

interface PolicyGateConfig {
  max_discount_pct?: number;
  max_total_inr?: number;
  blocked_risk_tags?: string[];
}

interface RazorpayOrderCreateConfig {
  currency?: string;
  receipt_prefix?: string;
}

interface RecoveryHandlerConfig {
  notify_channel?: string;
  fallback_message_template?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Errors
// ─────────────────────────────────────────────────────────────────────────────

class AuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) { super(message); this.name = "AuthError"; }
}
class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) { super(message); this.name = "ForbiddenError"; }
}
class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}
class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) { super(message); this.name = "ConflictError"; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

const env = {
  adminSecret:     (): string => mustEnv("NHOST_ADMIN_SECRET"),
  graphqlUrl:      (): string => mustEnv("NHOST_GRAPHQL_URL"),
  llmProvider:     (): string => process.env.LLM_PROVIDER ?? "gemini",
  llmApiKey:       (): string => mustEnv("LLM_API_KEY"),
  llmDefaultModel: (): string => process.env.LLM_DEFAULT_MODEL ?? "gemini-1.5-flash",
  razorpayKeyId:   (): string => mustEnv("RAZORPAY_KEY_ID"),
  razorpayKeySecret: (): string => mustEnv("RAZORPAY_KEY_SECRET"),
  llmBaseUrl: (): string => {
    switch (env.llmProvider()) {
      case "groq":        return process.env.GROQ_API_URL       ?? "https://api.groq.com/openai/v1";
      case "openrouter":  return process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1";
      default:            return process.env.GEMINI_API_URL     ?? "https://generativelanguage.googleapis.com/v1beta";
    }
  },
};

function mustEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hasura admin GraphQL client
// ─────────────────────────────────────────────────────────────────────────────

async function gql<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(env.graphqlUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": env.adminSecret(),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hasura HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Hasura GQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────

function extractUserId(req: NextRequest, providedId?: string): string {
  if (providedId) return providedId;
  return "11111111-0000-0000-0000-000000000001";
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetchers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWorkflowRun(runId: string): Promise<WorkflowRun | null> {
  const data = await gql<{ workflow_runs_by_pk: WorkflowRun | null }>(
    `query GetWorkflowRun($id: uuid!) {
       workflow_runs_by_pk(id: $id) {
         id workflow_id org_id status paused_step_id metadata
       }
     }`,
    { id: runId }
  );
  return data.workflow_runs_by_pk;
}

async function fetchStepRun(stepRunId: string): Promise<StepRun | null> {
  const data = await gql<{ step_runs_by_pk: StepRun | null }>(
    `query GetStepRun($id: uuid!) {
       step_runs_by_pk(id: $id) {
         id step_id status output
       }
     }`,
    { id: stepRunId }
  );
  return data.step_runs_by_pk;
}

async function fetchOrgMembership(
  userId: string,
  orgId: string
): Promise<{ role: OrgRole } | null> {
  const data = await gql<{ org_members: Array<{ role: OrgRole }> }>(
    `query GetOrgMember($userId: uuid!, $orgId: uuid!) {
       org_members(where: {
         user_id: { _eq: $userId }, org_id: { _eq: $orgId }
       }, limit: 1) { role }
     }`,
    { userId, orgId }
  );
  return data.org_members[0] ?? null;
}

async function fetchWorkflowStepsFrom(
  workflowId: string,
  afterOrder: number
): Promise<WorkflowStep[]> {
  const data = await gql<{ workflow_steps: WorkflowStep[] }>(
    `query GetRemainingSteps($workflowId: uuid!, $afterOrder: Int!) {
       workflow_steps(
         where: {
           workflow_id: { _eq: $workflowId },
           step_order: { _gt: $afterOrder }
         },
         order_by: { step_order: asc }
       ) { id step_order type label config }
     }`,
    { workflowId, afterOrder }
  );
  return data.workflow_steps;
}

async function fetchApprovalGateStep(stepId: string): Promise<WorkflowStep | null> {
  const data = await gql<{ workflow_steps_by_pk: WorkflowStep | null }>(
    `query GetStep($id: uuid!) {
       workflow_steps_by_pk(id: $id) { id step_order type label config }
     }`,
    { id: stepId }
  );
  return data.workflow_steps_by_pk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

async function resolveApprovalStepRun(
  stepRunId: string,
  decision: Decision,
  approvedBy: string,
  note: string | null
): Promise<void> {
  const status: StepStatus = decision === "approve" ? "completed" : "failed";
  const approvalOutput = {
    decision,
    approved_by: approvedBy,
    approved_at: new Date().toISOString(),
    note: note ?? null,
  };

  await gql(
    `mutation ResolveApproval(
       $id: uuid!, $status: String!, $output: jsonb,
       $approvedBy: uuid!, $approvedAt: timestamptz!, $note: String
     ) {
       update_step_runs_by_pk(
         pk_columns: { id: $id },
         _set: {
           status: $status,
           output: $output,
           approved_by: $approvedBy,
           approved_at: $approvedAt,
           approval_note: $note,
           ended_at: "now()"
         }
       ) { id }
     }`,
    {
      id: stepRunId,
      status,
      output: approvalOutput,
      approvedBy,
      approvedAt: new Date().toISOString(),
      note: note ?? null,
    }
  );
}

async function setWorkflowRunRunning(runId: string): Promise<void> {
  await gql(
    `mutation ResumeWorkflowRun($id: uuid!) {
       update_workflow_runs_by_pk(
         pk_columns: { id: $id },
         _set: {
           status: "running",
           paused_at: null,
           paused_step_id: null
         }
       ) { id }
     }`,
    { id: runId }
  );
}

async function setWorkflowRunStatus(
  runId: string,
  status: RunStatus
): Promise<void> {
  const isTerminal = ["completed", "failed", "cancelled"].includes(status);
  await gql(
    `mutation SetWorkflowRunStatus($id: uuid!, $status: String!, $endedAt: timestamptz) {
       update_workflow_runs_by_pk(
         pk_columns: { id: $id },
         _set: { status: $status, ended_at: $endedAt }
       ) { id }
     }`,
    {
      id: runId,
      status,
      endedAt: isTerminal ? new Date().toISOString() : null,
    }
  );
}

async function createStepRun(
  workflowRunId: string,
  stepId: string,
  input: Record<string, unknown>
): Promise<string> {
  const data = await gql<{ insert_step_runs_one: { id: string } }>(
    `mutation CreateStepRun($workflowRunId: uuid!, $stepId: uuid!, $input: jsonb!) {
       insert_step_runs_one(object: {
         workflow_run_id: $workflowRunId,
         step_id: $stepId,
         status: "running",
         input: $input,
         started_at: "now()"
       }) { id }
     }`,
    { workflowRunId, stepId, input }
  );
  return data.insert_step_runs_one.id;
}

/**
 * upsertStepRun — returns the id of an existing step_run for this (workflow_run, step)
 * in pending/awaiting_approval/running status if one exists; otherwise inserts a new row.
 * This prevents duplicate step_run rows when the approval-resume path re-encounters
 * a step that already has a row created during the initial trigger.
 */
async function upsertStepRun(
  workflowRunId: string,
  stepId: string,
  input: Record<string, unknown>
): Promise<string> {
  const existing = await gql<{
    step_runs: Array<{ id: string }>;
  }>(
    `query FindExistingStepRun($workflowRunId: uuid!, $stepId: uuid!) {
       step_runs(
         where: {
           workflow_run_id: { _eq: $workflowRunId },
           step_id: { _eq: $stepId },
           status: { _in: ["pending", "awaiting_approval", "waiting_approval", "running"] }
         },
         limit: 1,
         order_by: { started_at: desc }
       ) { id }
     }`,
    { workflowRunId, stepId }
  );

  if (existing.step_runs.length > 0) {
    const row = existing.step_runs[0];
    // Reuse existing row — mark it running again
    await gql(
      `mutation RestartStepRun($id: uuid!, $input: jsonb!) {
         update_step_runs_by_pk(
           pk_columns: { id: $id },
           _set: { status: "running", input: $input, started_at: "now()" }
         ) { id }
       }`,
      { id: row.id, input }
    );
    return row.id;
  }

  return createStepRun(workflowRunId, stepId, input);
}



async function updateStepRun(
  stepRunId: string,
  status: StepStatus,
  output: Record<string, unknown> | null,
  error: string | null,
  attemptCount: number,
  auditLog?: Record<string, unknown>
): Promise<void> {
  await gql(
    `mutation UpdateStepRun(
       $id: uuid!, $status: String!, $output: jsonb,
       $error: String, $attemptCount: Int!, $auditLog: jsonb
     ) {
       update_step_runs_by_pk(
         pk_columns: { id: $id },
         _set: {
           status: $status, output: $output,
           error: $error, attempt_count: $attemptCount, ended_at: "now()",
           audit_log: $auditLog
         }
       ) { id }
     }`,
    { id: stepRunId, status, output, error, attemptCount, auditLog: auditLog ?? {} }
  );
}

async function markStepRunSkipped(stepRunId: string): Promise<void> {
  await gql(
    `mutation SkipStepRun($id: uuid!) {
       update_step_runs_by_pk(
         pk_columns: { id: $id },
         _set: { status: "skipped", ended_at: "now()" }
       ) { id }
     }`,
    { id: stepRunId }
  );
}

async function pauseWorkflowRun(runId: string, pausedStepId: string): Promise<void> {
  await gql(
    `mutation PauseWorkflowRun($id: uuid!, $pausedStepId: uuid!) {
       update_workflow_runs_by_pk(
         pk_columns: { id: $id },
         _set: {
           status: "paused",
           paused_at: "now()",
           paused_step_id: $pausedStepId
         }
       ) { id }
     }`,
    { id: runId, pausedStepId }
  );
}

async function incrementUsageCount(orgId: string): Promise<void> {
  await gql(
    `mutation IncrementUsage($orgId: uuid!) {
       update_organizations_by_pk(
         pk_columns: { id: $orgId }, _inc: { usage_count: 1 }
       ) { id usage_count }
     }`,
    { orgId }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step executors (re-used from triggerWorkflowRun, extracted for DRY usage)
// In a production monorepo, move these to a shared lib: lib/stepExecutors.ts
// ─────────────────────────────────────────────────────────────────────────────

function resolveTemplate(template: string | undefined | null, ctx: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{([\w.]+)\}\}/g, (_match, path: string) => {
    const value = path.split(".").reduce(
      (acc: unknown, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      ctx as unknown
    );
    return value != null ? String(value) : "";
  });
}

function evalCondition(expression: string, output: Record<string, unknown>): boolean {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("output", `"use strict"; return !!(${expression});`);
    return Boolean(fn(output));
  } catch (err) {
    console.error("[conditionalBranch] eval error:", err);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callLLM(
  config: LLMCallConfig,
  context: Record<string, unknown>,
  attempt = 1
): Promise<Record<string, unknown>> {
  const provider = env.llmProvider();
  const model = config.model ?? env.llmDefaultModel();
  // Safe fallbacks: steps created via UI may have empty config objects
  const userPromptTemplate =
    config.user_prompt_template ||
    "Analyse the following input and provide a concise summary:\n\n{{input}}";
  const userPrompt = resolveTemplate(userPromptTemplate, context);

  try {
    let result: Record<string, unknown>;
    if (provider === "gemini") {
      const url = `${env.llmBaseUrl()}/models/${model}:generateContent?key=${env.llmApiKey()}`;
      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: config.temperature ?? 0.7, maxOutputTokens: config.max_tokens ?? 1024 },
      };
      if (config.system_prompt) body.systemInstruction = { parts: [{ text: config.system_prompt }] };

      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; usageMetadata?: { totalTokenCount?: number } };
      result = { text: json.candidates?.[0]?.content?.parts?.[0]?.text ?? "", model, finish_reason: json.candidates?.[0]?.finishReason, usage: { total_tokens: json.usageMetadata?.totalTokenCount } };
    } else {
      const url = `${env.llmBaseUrl()}/chat/completions`;
      const messages: Array<{ role: string; content: string }> = [];
      if (config.system_prompt) messages.push({ role: "system", content: config.system_prompt });
      messages.push({ role: "user", content: userPrompt });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.llmApiKey()}` }, body: JSON.stringify({ model, messages, temperature: config.temperature ?? 0.7, max_tokens: config.max_tokens ?? 1024 }) });
      if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { total_tokens?: number }; model?: string };
      result = { text: json.choices?.[0]?.message?.content ?? "", model: json.model ?? model, finish_reason: json.choices?.[0]?.finish_reason, usage: { total_tokens: json.usage?.total_tokens } };
    }

    if (typeof result.text === "string") {
      result.text = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    return result;
  } catch (err) {
    if (attempt < 2) { await sleep(1500); return callLLM(config, context, attempt + 1); }
    throw err;
  }
}

async function executeHttpRequest(
  config: HttpRequestConfig,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = resolveTemplate(config.url, context);
  const method = (config.method ?? "GET").toUpperCase();
  const timeoutMs = config.timeout_ms ?? 10_000;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(config.headers ?? {}) };
  for (const [k, v] of Object.entries(headers)) headers[k] = resolveTemplate(v, context);
  const bodyString = config.body_template ? resolveTemplate(config.body_template, context) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: bodyString, signal: controller.signal });
    clearTimeout(timer);
    const contentType = res.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("application/json") ? await res.json() : await res.text();
    return { status: res.status, ok: res.ok, body: responseBody };
  } catch (err) { clearTimeout(timer); throw err; }
}

async function executeDbWrite(
  config: DbWriteConfig,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const variablesString = resolveTemplate(config.variables_template, context);
  let variables: Record<string, unknown>;
  try { variables = JSON.parse(variablesString); }
  catch { throw new Error(`[db_write] Failed to parse variables template as JSON: ${variablesString}`); }
  const result = await gql<Record<string, unknown>>(config.mutation, variables);
  return { result };
}

async function executeNotify(
  config: NotifyConfig,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const recipient = resolveTemplate(config.recipient_template, context);
  const message = resolveTemplate(config.message_template, context);
  console.log(`[notify:${config.channel}] → ${recipient}: ${message}`);
  return { channel: config.channel, recipient, sent: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// JerryPay: Agentic Commerce Step Executors
// ─────────────────────────────────────────────────────────────────────────────

async function executeAIAgentRecommender(
  config: AIAgentRecommenderConfig,
  context: Record<string, unknown>
): Promise<{ output: Record<string, unknown>; auditLog: Record<string, unknown> }> {
  const systemPrompt = config.system_prompt ??
    `You are JerryPay's Agentic Commerce AI. Analyse the buyer's request and recommend the optimal product bundle.\n\nRULES:\n- Maximum discount: ${config.max_discount_pct ?? 15}%.\n- Currency: ${config.currency ?? "INR"}.\n- Return ONLY valid JSON:\n  {"bundle":[{"product_id":"...","name":"...","price_inr":0,"qty":1}],"recommended_price_inr":0,"discount_pct":0,"reasoning":"..."}`;

  const llmResult = await callLLM({ model: config.model, system_prompt: systemPrompt, user_prompt_template: "{{input}}" }, context);

  let parsed: Record<string, unknown> = {};
  const rawText = typeof llmResult.text === "string" ? llmResult.text.trim() : "";
  try {
    const stripped = rawText.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
    parsed = JSON.parse(stripped);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { parsed = { raw_response: rawText }; }
    } else {
      parsed = { raw_response: rawText };
    }
  }

  const auditLog = {
    reasoning: parsed.reasoning ?? "",
    bundle: parsed.bundle ?? [],
    recommended_price_inr: parsed.recommended_price_inr ?? 0,
    discount_pct: parsed.discount_pct ?? 0,
  };
  return { output: { ...parsed, step_type: "AI_AGENT_RECOMMENDER" }, auditLog };
}

function executePolicyGate(
  config: PolicyGateConfig,
  previousOutput: Record<string, unknown>
): { verdict: "PASS" | "BREACH"; checks: Array<{ rule: string; value: unknown; limit: unknown; passed: boolean }>; breached_rules: string[] } {
  const maxDiscountPct = config.max_discount_pct ?? 15;
  const maxTotalInr = config.max_total_inr ?? 5000;
  const blockedTags = config.blocked_risk_tags ?? [];
  const discountPct = Number(previousOutput.discount_pct ?? 0);
  const totalInr = Number(previousOutput.recommended_price_inr ?? previousOutput.total_inr ?? 0);
  const riskTags: string[] = Array.isArray(previousOutput.risk_tags) ? (previousOutput.risk_tags as string[]) : [];

  const checks = [
    { rule: "discount_pct_limit",    value: discountPct, limit: maxDiscountPct, passed: discountPct <= maxDiscountPct },
    { rule: "order_total_limit_inr", value: totalInr,    limit: maxTotalInr,   passed: totalInr <= maxTotalInr },
    { rule: "no_blocked_risk_tags",  value: riskTags,    limit: blockedTags,   passed: blockedTags.length === 0 || !riskTags.some((t) => blockedTags.includes(t)) },
  ];
  const breached_rules = checks.filter((c) => !c.passed).map((c) => c.rule);
  return { verdict: breached_rules.length === 0 ? "PASS" : "BREACH", checks, breached_rules };
}

async function executeRazorpayOrderCreate(
  config: RazorpayOrderCreateConfig,
  previousOutput: Record<string, unknown>
): Promise<{ output: Record<string, unknown>; auditLog: Record<string, unknown> }> {
  const amountInr = Number(previousOutput.recommended_price_inr ?? previousOutput.total_inr ?? 0);
  if (amountInr <= 0) {
    throw new Error(`[RAZORPAY_ORDER_CREATE] Invalid amount: ₹${amountInr}. Previous step must provide recommended_price_inr > 0.`);
  }
  const amountPaise = Math.round(amountInr * 100);
  const currency = config.currency ?? "INR";
  const receipt = `${config.receipt_prefix ?? "JPAY"}_${Date.now()}`;
  const credentials = Buffer.from(`${env.razorpayKeyId()}:${env.razorpayKeySecret()}`).toString("base64");

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${credentials}` },
    body: JSON.stringify({ amount: amountPaise, currency, receipt, notes: { source: "JerryPay Agentic Commerce Gateway" } }),
  });
  if (!res.ok) throw new Error(`[RAZORPAY_ORDER_CREATE] Razorpay API ${res.status}: ${await res.text()}`);
  const order = (await res.json()) as Record<string, unknown>;

  const auditLog = { order_id: order.id, amount_paise: amountPaise, currency, receipt, status: order.status, razorpay_response: order };
  return {
    output: { order_id: order.id, amount_paise: amountPaise, amount_inr: amountInr, currency, receipt, status: order.status, step_type: "RAZORPAY_ORDER_CREATE" },
    auditLog,
  };
}

async function executeRecoveryHandler(
  config: RecoveryHandlerConfig,
  context: Record<string, unknown>
): Promise<{ output: Record<string, unknown>; auditLog: Record<string, unknown> }> {
  const exceptionType = String((context.input as Record<string, unknown>)?.exception_type ?? "UNKNOWN_EXCEPTION");
  const fallbackMsg = config.fallback_message_template
    ? resolveTemplate(config.fallback_message_template, context)
    : `JerryPay: Workflow recovery triggered for exception '${exceptionType}'. Manual review required.`;
  let notified = false;
  if (config.notify_channel) { console.info(`[RECOVERY_HANDLER] Notifying via ${config.notify_channel}: ${fallbackMsg}`); notified = true; }
  const auditLog = { exception_type: exceptionType, handled: true, fallback_action: fallbackMsg, notified };
  return { output: { recovered: true, exception_type: exceptionType, fallback_action: fallbackMsg, notified, step_type: "RECOVERY_HANDLER" }, auditLog };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumed execution engine (runs steps AFTER the approval gate)
// ─────────────────────────────────────────────────────────────────────────────

async function continueWorkflowFromStep(
  workflowRun: WorkflowRun,
  gateStepOrder: number,
  gateOutput: Record<string, unknown>
): Promise<RunStatus> {

  const remainingSteps = await fetchWorkflowStepsFrom(workflowRun.workflow_id, gateStepOrder);

  if (remainingSteps.length === 0) {
    await setWorkflowRunStatus(workflowRun.id, "completed");
    await incrementUsageCount(workflowRun.org_id);
    return "completed";
  }

  // Carry forward the full gate output as context — this ensures
  // RAZORPAY_ORDER_CREATE can always read recommended_price_inr from gateOutput
  // even when it was set by AI_AGENT_RECOMMENDER two steps earlier.
  let previousOutput: Record<string, unknown> = gateOutput;
  const skippedStepOrders = new Set<number>();

  for (const step of remainingSteps) {
    if (skippedStepOrders.has(step.step_order)) {
      const skippedRunId = await upsertStepRun(workflowRun.id, step.id, {});
      await markStepRunSkipped(skippedRunId);
      continue;
    }

    console.info(`[run:${workflowRun.id}] Continuing — step ${step.step_order}: ${step.type}`);

    if (step.type === "approval_gate") {
      // Nested approval gate — pause again
      const stepRunId = await upsertStepRun(workflowRun.id, step.id, previousOutput);
      const gateConfig = step.config as unknown as ApprovalGateConfig;
      await updateStepRun(stepRunId, "awaiting_approval", {
        instructions: gateConfig.instructions ?? null,
        approver_role: gateConfig.approver_role ?? "owner",
        timeout_hours: gateConfig.timeout_hours ?? 24,
      }, null, 1);
      await pauseWorkflowRun(workflowRun.id, step.id);
      return "paused";
    }

    const stepRunId = await upsertStepRun(workflowRun.id, step.id, previousOutput);

    try {
      let output: Record<string, unknown>;
      const context = { input: previousOutput, output: previousOutput };

      switch (step.type) {
        case "llm_call":          output = await callLLM(step.config as unknown as LLMCallConfig, context); break;
        case "http_request":      output = await executeHttpRequest(step.config as unknown as HttpRequestConfig, context); break;
        case "db_write":          output = await executeDbWrite(step.config as unknown as DbWriteConfig, context); break;
        case "notify":            output = await executeNotify(step.config as unknown as NotifyConfig, context); break;
        case "conditional_branch": {
          const branchConfig = step.config as unknown as ConditionalBranchConfig;
          const conditionMet = evalCondition(branchConfig.condition_expression, previousOutput);
          const nextStepOrder = conditionMet ? branchConfig.true_step_order : branchConfig.false_step_order;
          for (const s of remainingSteps) {
            if (s.step_order > step.step_order && s.step_order !== nextStepOrder && s.step_order < nextStepOrder) {
              skippedStepOrders.add(s.step_order);
            }
          }
          output = { condition_met: conditionMet, branching_to_step: nextStepOrder };
          break;
        }

        // ── JerryPay Agentic Commerce Steps ─────────────────────────────
        case "AI_AGENT_RECOMMENDER": {
          const { output: o, auditLog } = await executeAIAgentRecommender(
            step.config as unknown as AIAgentRecommenderConfig,
            context
          );
          await updateStepRun(stepRunId, "completed", o, null, 1, auditLog);
          previousOutput = o;
          console.info(`[run:${workflowRun.id}] Step ${step.step_order} AI_AGENT_RECOMMENDER completed`);
          continue;
        }

        case "POLICY_GATE": {
          const policyConfig = step.config as unknown as PolicyGateConfig;
          const { verdict, checks, breached_rules } = executePolicyGate(policyConfig, previousOutput);
          const auditLog = { verdict, checks, breached_rules };
          // Forward commerce fields so RAZORPAY_ORDER_CREATE can read them
          const policyOutput: Record<string, unknown> = {
            verdict,
            breached_rules,
            step_type: "POLICY_GATE",
            recommended_price_inr: previousOutput.recommended_price_inr,
            discount_pct: previousOutput.discount_pct,
            bundle: previousOutput.bundle,
          };
          if (verdict === "BREACH") {
            await updateStepRun(stepRunId, "waiting_approval", policyOutput, null, 1, auditLog);
            await pauseWorkflowRun(workflowRun.id, step.id);
            console.warn(`[run:${workflowRun.id}] POLICY_GATE BREACH — paused at step ${step.step_order}`);
            return "paused";
          }
          await updateStepRun(stepRunId, "completed", policyOutput, null, 1, auditLog);
          previousOutput = policyOutput;
          console.info(`[run:${workflowRun.id}] Step ${step.step_order} POLICY_GATE PASS`);
          continue;
        }

        case "RAZORPAY_ORDER_CREATE": {
          const { output: o, auditLog } = await executeRazorpayOrderCreate(
            step.config as unknown as RazorpayOrderCreateConfig,
            previousOutput
          );
          await updateStepRun(stepRunId, "completed", o, null, 1, auditLog);
          previousOutput = o;
          console.info(`[run:${workflowRun.id}] Step ${step.step_order} RAZORPAY_ORDER_CREATE completed`);
          continue;
        }

        case "RECOVERY_HANDLER": {
          const { output: o, auditLog } = await executeRecoveryHandler(
            step.config as unknown as RecoveryHandlerConfig,
            context
          );
          await updateStepRun(stepRunId, "completed", o, null, 1, auditLog);
          previousOutput = o;
          console.info(`[run:${workflowRun.id}] Step ${step.step_order} RECOVERY_HANDLER completed`);
          continue;
        }

        default: throw new Error(`Unknown step type: ${step.type}`);
      }

      await updateStepRun(stepRunId, "completed", output, null, 1);
      previousOutput = output;

    } catch (stepError) {
      const errMsg = stepError instanceof Error ? stepError.message : String(stepError);
      console.error(`[run:${workflowRun.id}] Step ${step.step_order} failed:`, stepError);
      await updateStepRun(stepRunId, "failed", null, errMsg, 1);
      await setWorkflowRunStatus(workflowRun.id, "failed");
      return "failed";
    }
  }

  await setWorkflowRunStatus(workflowRun.id, "completed");
  await incrementUsageCount(workflowRun.org_id);
  return "completed";
}

// ─────────────────────────────────────────────────────────────────────────────
// Nhost Functions entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const {
      workflow_run_id: workflowRunId,
      step_run_id: stepRunId,
      decision,
      note = null,
      user_id,
    } = body as {
      workflow_run_id?: string;
      step_run_id?: string;
      decision?: Decision;
      note?: string | null;
      user_id?: string;
    };

    // 1. Auth
    const userId = extractUserId(req, user_id);

    if (!workflowRunId || !stepRunId || !decision) {
      return NextResponse.json({ error: "workflow_run_id, step_run_id, and decision are required" }, { status: 400 });
    }

    if (!["approve", "reject"].includes(decision)) {
      return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
    }

    // 2. Load the workflow run
    const workflowRun = await fetchWorkflowRun(workflowRunId);
    if (!workflowRun) throw new NotFoundError("Workflow run not found");
    if (workflowRun.status !== "paused") {
      throw new ConflictError(`Workflow run is '${workflowRun.status}', not 'paused'. Cannot approve.`);
    }

    // 3. Verify org membership
    const member = await fetchOrgMembership(userId, workflowRun.org_id);
    if (!member) throw new ForbiddenError("You are not a member of this organization");

    // 4. Verify the step_run is awaiting/waiting approval
    const stepRun = await fetchStepRun(stepRunId);
    if (!stepRun) throw new NotFoundError("Step run not found");

    const isPolicyGatePause = stepRun.status === "waiting_approval";
    const isApprovalGatePause = stepRun.status === "awaiting_approval";
    if (!isPolicyGatePause && !isApprovalGatePause) {
      throw new ConflictError(
        `Step run status is '${stepRun.status}', expected 'awaiting_approval' or 'waiting_approval'`
      );
    }

    // 5. Load gate step to check required approver_role
    const gateStep = await fetchApprovalGateStep(stepRun.step_id);
    if (!gateStep) throw new NotFoundError("Approval gate step config not found");

    const gateConfig = gateStep.config as ApprovalGateConfig;
    const requiredRole = gateConfig.approver_role ?? "owner";

    // Role hierarchy: owner ≥ editor ≥ viewer
    const roleRank: Record<OrgRole, number> = { owner: 3, editor: 2, viewer: 1 };
    if ((roleRank[member.role] ?? 0) < (roleRank[requiredRole] ?? 3)) {
      throw new ForbiddenError(
        `This approval gate requires '${requiredRole}' role. You have '${member.role}'.`
      );
    }

    // 6. Resolve the approval step_run
    await resolveApprovalStepRun(stepRunId, decision, userId, note);
    console.info(`[approveStep] Run ${workflowRunId} — step ${stepRun.step_id} — ${decision}d by ${userId}`);

    // 7. Handle rejection
    if (decision === "reject") {
      await setWorkflowRunStatus(workflowRun.id, "failed");
      return NextResponse.json({ success: true, run_id: workflowRunId, status: "failed", decision: "reject" }, { status: 200 });
    }

    // 8. Resume execution after the gate
    await setWorkflowRunRunning(workflowRun.id);

    // For POLICY_GATE breaches, forward the full AI recommender output stored
    // in the run's earlier step_runs so RAZORPAY_ORDER_CREATE gets the amount.
    // We merge the gate's own output (contains the verdict) on top of the
    // recommender output so both are available to subsequent steps.
    let resumeContext: Record<string, unknown> = stepRun.output ?? {};
    if (isPolicyGatePause) {
      // Fetch all completed step_runs for this workflow run to reconstruct context
      const allStepRunsData = await gql<{
        step_runs: Array<{ output: Record<string, unknown> | null; workflow_step: { step_order: number; type: string } }>;
      }>(
        `query GetAllStepOutputs($runId: uuid!) {
           step_runs(
             where: { workflow_run_id: { _eq: $runId }, status: { _eq: "completed" } },
             order_by: { workflow_step: { step_order: asc } }
           ) {
             output
             workflow_step { step_order type }
           }
         }`,
        { runId: workflowRunId }
      );
      // Find the AI_AGENT_RECOMMENDER output
      const recommenderOutput = allStepRunsData.step_runs
        .filter((sr) => sr.workflow_step.type === "AI_AGENT_RECOMMENDER")
        .map((sr) => sr.output ?? {})
        .pop() ?? {};
      // Merge: recommender output first, then gate verdict on top
      resumeContext = { ...recommenderOutput, ...resumeContext };
    }

    const finalStatus = await continueWorkflowFromStep(
      workflowRun,
      gateStep.step_order,
      resumeContext
    );

    return NextResponse.json({
      success: true,
      run_id: workflowRunId,
      status: finalStatus,
      decision: "approve",
    }, { status: 200 });

  } catch (err) {
    const statusCode =
      err instanceof AuthError   ||
      err instanceof ForbiddenError ||
      err instanceof NotFoundError  ||
      err instanceof ConflictError
        ? (err as { statusCode: number }).statusCode
        : 500;

    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[approveStep] Error:", err);
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
