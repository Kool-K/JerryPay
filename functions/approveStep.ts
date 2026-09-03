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

import type { Request, Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type StepType =
  | "llm_call"
  | "http_request"
  | "db_write"
  | "notify"
  | "conditional_branch"
  | "approval_gate";

type RunStatus = "running" | "paused" | "completed" | "failed" | "cancelled";
type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval";
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
  adminSecret: (): string => mustEnv("NHOST_ADMIN_SECRET"),
  graphqlUrl: (): string => mustEnv("NHOST_GRAPHQL_URL"),
  llmProvider: (): string => process.env.LLM_PROVIDER ?? "gemini",
  llmApiKey: (): string => mustEnv("LLM_API_KEY"),
  llmDefaultModel: (): string => process.env.LLM_DEFAULT_MODEL ?? "gemini-1.5-flash",
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

function extractUserId(req: Request): string {
  const auth = (req as Request & { auth?: { sub?: string } }).auth;
  const userId = auth?.sub;
  if (!userId) throw new AuthError("Unauthenticated: missing or invalid token");
  return userId;
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

async function updateStepRun(
  stepRunId: string,
  status: StepStatus,
  output: Record<string, unknown> | null,
  error: string | null,
  attemptCount: number
): Promise<void> {
  await gql(
    `mutation UpdateStepRun(
       $id: uuid!, $status: String!, $output: jsonb,
       $error: String, $attemptCount: Int!
     ) {
       update_step_runs_by_pk(
         pk_columns: { id: $id },
         _set: {
           status: $status, output: $output,
           error: $error, attempt_count: $attemptCount, ended_at: "now()"
         }
       ) { id }
     }`,
    { id: stepRunId, status, output, error, attemptCount }
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

function resolveTemplate(template: string, ctx: Record<string, unknown>): string {
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
  const userPrompt = resolveTemplate(config.user_prompt_template, context);

  try {
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
      return { text: json.candidates?.[0]?.content?.parts?.[0]?.text ?? "", model, finish_reason: json.candidates?.[0]?.finishReason, usage: { total_tokens: json.usageMetadata?.totalTokenCount } };
    } else {
      const url = `${env.llmBaseUrl()}/chat/completions`;
      const messages: Array<{ role: string; content: string }> = [];
      if (config.system_prompt) messages.push({ role: "system", content: config.system_prompt });
      messages.push({ role: "user", content: userPrompt });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.llmApiKey()}` }, body: JSON.stringify({ model, messages, temperature: config.temperature ?? 0.7, max_tokens: config.max_tokens ?? 1024 }) });
      if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { total_tokens?: number }; model?: string };
      return { text: json.choices?.[0]?.message?.content ?? "", model: json.model ?? model, finish_reason: json.choices?.[0]?.finish_reason, usage: { total_tokens: json.usage?.total_tokens } };
    }
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

  let previousOutput: Record<string, unknown> = gateOutput;
  const skippedStepOrders = new Set<number>();

  for (const step of remainingSteps) {
    if (skippedStepOrders.has(step.step_order)) {
      const skippedRunId = await createStepRun(workflowRun.id, step.id, {});
      await markStepRunSkipped(skippedRunId);
      continue;
    }

    console.info(`[run:${workflowRun.id}] Continuing — step ${step.step_order}: ${step.type}`);

    if (step.type === "approval_gate") {
      // Nested approval gate — pause again
      const stepRunId = await createStepRun(workflowRun.id, step.id, previousOutput);
      const gateConfig = step.config as ApprovalGateConfig;
      await updateStepRun(stepRunId, "awaiting_approval", {
        instructions: gateConfig.instructions ?? null,
        approver_role: gateConfig.approver_role ?? "owner",
        timeout_hours: gateConfig.timeout_hours ?? 24,
      }, null, 1);
      await pauseWorkflowRun(workflowRun.id, step.id);
      return "paused";
    }

    const stepRunId = await createStepRun(workflowRun.id, step.id, previousOutput);

    try {
      let output: Record<string, unknown>;
      const context = { output: previousOutput };

      switch (step.type) {
        case "llm_call":          output = await callLLM(step.config as LLMCallConfig, context); break;
        case "http_request":      output = await executeHttpRequest(step.config as HttpRequestConfig, context); break;
        case "db_write":          output = await executeDbWrite(step.config as DbWriteConfig, context); break;
        case "notify":            output = await executeNotify(step.config as NotifyConfig, context); break;
        case "conditional_branch": {
          const branchConfig = step.config as ConditionalBranchConfig;
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

export default async function approveStep(req: Request, res: Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    // 1. Auth
    const userId = extractUserId(req);

    const {
      workflow_run_id: workflowRunId,
      step_run_id: stepRunId,
      decision,
      note = null,
    } = req.body as {
      workflow_run_id?: string;
      step_run_id?: string;
      decision?: Decision;
      note?: string | null;
    };

    if (!workflowRunId || !stepRunId || !decision) {
      res.status(400).json({ error: "workflow_run_id, step_run_id, and decision are required" });
      return;
    }

    if (!["approve", "reject"].includes(decision)) {
      res.status(400).json({ error: 'decision must be "approve" or "reject"' });
      return;
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

    // 4. Verify the step_run is awaiting approval
    const stepRun = await fetchStepRun(stepRunId);
    if (!stepRun) throw new NotFoundError("Step run not found");
    if (stepRun.status !== "awaiting_approval") {
      throw new ConflictError(`Step run status is '${stepRun.status}', not 'awaiting_approval'`);
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
      res.status(200).json({ success: true, run_id: workflowRunId, status: "failed", decision: "reject" });
      return;
    }

    // 8. Resume execution after the gate
    await setWorkflowRunRunning(workflowRun.id);

    const finalStatus = await continueWorkflowFromStep(
      workflowRun,
      gateStep.step_order,
      stepRun.output ?? {}
    );

    res.status(200).json({
      success: true,
      run_id: workflowRunId,
      status: finalStatus,
      decision: "approve",
    });

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
    res.status(statusCode).json({ error: message });
  }
}
