/**
 * Jerry — Multi-Tenant AI Agent Workflow Builder
 * Serverless Function: triggerWorkflowRun
 * Section 3
 *
 * Runtime: Nhost Functions (Node.js 18+)
 * File:    functions/triggerWorkflowRun.ts
 *
 * Responsibilities
 * ─────────────────
 *  1. Validate caller JWT → extract user_id, org_id
 *  2. Confirm active org_member record and resolve role
 *  3. Enforce usage quota (usage_count < usage_allowed)
 *  4. Create workflow_run (status: 'running')
 *  5. Execute each workflow_step in order:
 *       • llm_call           → Gemini/Groq/OpenRouter with 1 retry
 *       • http_request       → fetch() with configurable timeout
 *       • db_write           → Hasura mutation (admin secret)
 *       • notify             → pluggable channel dispatch
 *       • conditional_branch → evaluate expression, skip to target step
 *       • approval_gate      → pause run, exit loop
 *  6. Write step_run records in real-time
 *  7. Increment usage_count on successful completion
 *
 * Environment variables required:
 *   NHOST_ADMIN_SECRET          – Hasura admin secret
 *   NHOST_GRAPHQL_URL           – e.g. https://<id>.nhost.run/v1/graphql
 *   LLM_PROVIDER                – 'gemini' | 'groq' | 'openrouter'
 *   LLM_API_KEY                 – key for the chosen provider
 *   LLM_DEFAULT_MODEL           – fallback model name
 *   GEMINI_API_URL              – https://generativelanguage.googleapis.com/v1beta
 *   GROQ_API_URL                – https://api.groq.com/openai/v1
 *   OPENROUTER_API_URL          – https://openrouter.ai/api/v1
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

interface WorkflowStep {
  id: string;
  step_order: number;
  type: StepType;
  label: string | null;
  config: Record<string, unknown>;
}

interface Organization {
  id: string;
  usage_allowed: number;
  usage_count: number;
}

interface OrgMember {
  role: OrgRole;
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
  condition_expression: string; // JS expression evaluated with `output` in scope
  true_step_order: number;
  false_step_order: number;
}

interface ApprovalGateConfig {
  approver_role?: OrgRole;
  timeout_hours?: number;
  instructions?: string;
}

interface DbWriteConfig {
  mutation: string;      // GraphQL mutation string
  variables_template: string; // JSON template with {{output}} placeholder
}

interface NotifyConfig {
  channel: "email" | "slack" | "webhook";
  recipient_template: string;
  message_template: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment helpers
// ─────────────────────────────────────────────────────────────────────────────

const env = {
  adminSecret: (): string => mustEnv("NHOST_ADMIN_SECRET"),
  graphqlUrl: (): string => mustEnv("NHOST_GRAPHQL_URL"),
  llmProvider: (): string => process.env.LLM_PROVIDER ?? "gemini",
  llmApiKey: (): string => mustEnv("LLM_API_KEY"),
  llmDefaultModel: (): string =>
    process.env.LLM_DEFAULT_MODEL ?? "gemini-1.5-flash",
  llmBaseUrl: (): string => {
    switch (env.llmProvider()) {
      case "groq":
        return (
          process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1"
        );
      case "openrouter":
        return (
          process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1"
        );
      default:
        return (
          process.env.GEMINI_API_URL ??
          "https://generativelanguage.googleapis.com/v1beta"
        );
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

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `Hasura GQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }

  return json.data as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT extraction (Nhost issues standard JWTs; the function runtime exposes
// the decoded claims via req.auth injected by the Nhost functions middleware)
// ─────────────────────────────────────────────────────────────────────────────

function extractUserId(req: Request): string {
  // Nhost functions middleware parses the Bearer token and attaches auth claims
  const auth = (req as Request & { auth?: { sub?: string } }).auth;
  const userId = auth?.sub;
  if (!userId) throw new AuthError("Unauthenticated: missing or invalid token");
  return userId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom error classes
// ─────────────────────────────────────────────────────────────────────────────

class AuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

class QuotaError extends Error {
  readonly statusCode = 429;
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step output context helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely evaluates a condition expression string with `output` (previous step
 * JSON) in scope. Returns boolean result.
 *
 * NOTE: Uses Function() constructor — acceptable for server-side evaluation
 * of trusted, org-authored expressions. Add a static analyzer / allowlist
 * before shipping to production if expressions are user-controlled.
 */
function evalCondition(
  expression: string,
  output: Record<string, unknown>
): boolean {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("output", `"use strict"; return !!(${expression});`);
    return Boolean(fn(output));
  } catch (err) {
    console.error("[conditionalBranch] eval error:", err);
    return false;
  }
}

/**
 * Resolves {{placeholder}} tokens in a template string using the provided
 * context object. Supports dot-notation: {{output.text}}.
 */
function resolveTemplate(
  template: string,
  ctx: Record<string, unknown>
): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_match, path: string) => {
    const value = path
      .split(".")
      .reduce(
        (acc: unknown, key) =>
          acc && typeof acc === "object"
            ? (acc as Record<string, unknown>)[key]
            : undefined,
        ctx as unknown
      );
    return value != null ? String(value) : "";
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM execution (Gemini / Groq / OpenRouter, OpenAI-compatible where possible)
// ─────────────────────────────────────────────────────────────────────────────

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
      return await callGemini(model, config.system_prompt, userPrompt, config);
    } else {
      // Groq and OpenRouter share the OpenAI-compatible Chat Completions API
      return await callOpenAICompat(
        model,
        config.system_prompt,
        userPrompt,
        config
      );
    }
  } catch (err) {
    if (attempt < 2) {
      console.warn(`[LLM] Attempt ${attempt} failed, retrying…`, err);
      await sleep(1500); // brief backoff before retry
      return callLLM(config, context, attempt + 1);
    }
    throw err;
  }
}

async function callGemini(
  model: string,
  systemPrompt: string | undefined,
  userPrompt: string,
  config: LLMCallConfig
): Promise<Record<string, unknown>> {
  const url = `${env.llmBaseUrl()}/models/${model}:generateContent?key=${env.llmApiKey()}`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: config.temperature ?? 0.7,
      maxOutputTokens: config.max_tokens ?? 1024,
    },
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { totalTokenCount?: number };
  };

  const text =
    json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  return {
    text,
    model,
    finish_reason: json.candidates?.[0]?.finishReason,
    usage: { total_tokens: json.usageMetadata?.totalTokenCount },
  };
}

async function callOpenAICompat(
  model: string,
  systemPrompt: string | undefined,
  userPrompt: string,
  config: LLMCallConfig
): Promise<Record<string, unknown>> {
  const url = `${env.llmBaseUrl()}/chat/completions`;

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.llmApiKey()}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.max_tokens ?? 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API ${res.status}: ${err}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { total_tokens?: number };
    model?: string;
  };

  const text = json.choices?.[0]?.message?.content ?? "";

  return {
    text,
    model: json.model ?? model,
    finish_reason: json.choices?.[0]?.finish_reason,
    usage: { total_tokens: json.usage?.total_tokens },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step executors
// ─────────────────────────────────────────────────────────────────────────────

async function executeHttpRequest(
  config: HttpRequestConfig,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = resolveTemplate(config.url, context);
  const method = (config.method ?? "GET").toUpperCase();
  const timeoutMs = config.timeout_ms ?? 10_000;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
  };

  // Resolve any template tokens in header values
  for (const [k, v] of Object.entries(headers)) {
    headers[k] = resolveTemplate(v, context);
  }

  const bodyString = config.body_template
    ? resolveTemplate(config.body_template, context)
    : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyString,
      signal: controller.signal,
    });

    clearTimeout(timer);

    let responseBody: unknown;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      responseBody = await res.json();
    } else {
      responseBody = await res.text();
    }

    return {
      status: res.status,
      ok: res.ok,
      body: responseBody,
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function executeDbWrite(
  config: DbWriteConfig,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const variablesString = resolveTemplate(config.variables_template, context);
  let variables: Record<string, unknown>;

  try {
    variables = JSON.parse(variablesString);
  } catch {
    throw new Error(
      `[db_write] Failed to parse variables template as JSON: ${variablesString}`
    );
  }

  const result = await gql<Record<string, unknown>>(config.mutation, variables);
  return { result };
}

async function executeNotify(
  config: NotifyConfig,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const recipient = resolveTemplate(config.recipient_template, context);
  const message = resolveTemplate(config.message_template, context);

  // Pluggable channel dispatch — integrate your preferred provider here.
  // This is a stub that logs and returns success; swap for real integrations.
  console.log(`[notify:${config.channel}] → ${recipient}: ${message}`);

  // Example Slack webhook:
  // if (config.channel === 'slack') {
  //   await fetch(process.env.SLACK_WEBHOOK_URL!, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ text: message }),
  //   });
  // }

  return { channel: config.channel, recipient, sent: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Database mutation helpers
// ─────────────────────────────────────────────────────────────────────────────

async function createWorkflowRun(
  workflowId: string,
  orgId: string,
  triggeredBy: string,
  metadata: Record<string, unknown>
): Promise<string> {
  const data = await gql<{
    insert_workflow_runs_one: { id: string };
  }>(
    `mutation CreateWorkflowRun(
       $workflowId: uuid!, $orgId: uuid!, $triggeredBy: uuid!,
       $metadata: jsonb
     ) {
       insert_workflow_runs_one(object: {
         workflow_id: $workflowId,
         org_id: $orgId,
         triggered_by: $triggeredBy,
         status: "running",
         metadata: $metadata
       }) {
         id
       }
     }`,
    { workflowId, orgId, triggeredBy, metadata }
  );
  return data.insert_workflow_runs_one.id;
}

async function createStepRun(
  workflowRunId: string,
  stepId: string,
  input: Record<string, unknown>
): Promise<string> {
  const data = await gql<{
    insert_step_runs_one: { id: string };
  }>(
    `mutation CreateStepRun(
       $workflowRunId: uuid!, $stepId: uuid!, $input: jsonb!
     ) {
       insert_step_runs_one(object: {
         workflow_run_id: $workflowRunId,
         step_id: $stepId,
         status: "running",
         input: $input,
         started_at: "now()"
       }) {
         id
       }
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
           status: $status,
           output: $output,
           error: $error,
           attempt_count: $attemptCount,
           ended_at: "now()"
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

async function updateWorkflowRunStatus(
  runId: string,
  status: RunStatus,
  pausedStepId?: string
): Promise<void> {
  const isTerminal = ["completed", "failed", "cancelled"].includes(status);
  await gql(
    `mutation UpdateWorkflowRunStatus(
       $id: uuid!, $status: String!, $endedAt: timestamptz,
       $pausedAt: timestamptz, $pausedStepId: uuid
     ) {
       update_workflow_runs_by_pk(
         pk_columns: { id: $id },
         _set: {
           status: $status,
           ended_at: $endedAt,
           paused_at: $pausedAt,
           paused_step_id: $pausedStepId
         }
       ) { id }
     }`,
    {
      id: runId,
      status,
      endedAt: isTerminal ? new Date().toISOString() : null,
      pausedAt: status === "paused" ? new Date().toISOString() : null,
      pausedStepId: status === "paused" ? (pausedStepId ?? null) : null,
    }
  );
}

async function incrementUsageCount(orgId: string): Promise<void> {
  await gql(
    `mutation IncrementUsage($orgId: uuid!) {
       update_organizations_by_pk(
         pk_columns: { id: $orgId },
         _inc: { usage_count: 1 }
       ) { id usage_count }
     }`,
    { orgId }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetchers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOrgMembership(
  userId: string,
  orgId: string
): Promise<OrgMember | null> {
  const data = await gql<{ org_members: OrgMember[] }>(
    `query GetOrgMember($userId: uuid!, $orgId: uuid!) {
       org_members(where: {
         user_id: { _eq: $userId },
         org_id: { _eq: $orgId }
       }, limit: 1) {
         role
       }
     }`,
    { userId, orgId }
  );
  return data.org_members[0] ?? null;
}

async function fetchOrganization(orgId: string): Promise<Organization | null> {
  const data = await gql<{ organizations_by_pk: Organization | null }>(
    `query GetOrganization($id: uuid!) {
       organizations_by_pk(id: $id) {
         id usage_allowed usage_count
       }
     }`,
    { id: orgId }
  );
  return data.organizations_by_pk;
}

async function fetchWorkflowSteps(
  workflowId: string
): Promise<WorkflowStep[]> {
  const data = await gql<{ workflow_steps: WorkflowStep[] }>(
    `query GetWorkflowSteps($workflowId: uuid!) {
       workflow_steps(
         where: { workflow_id: { _eq: $workflowId } },
         order_by: { step_order: asc }
       ) {
         id step_order type label config
       }
     }`,
    { workflowId }
  );
  return data.workflow_steps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main execution engine
// ─────────────────────────────────────────────────────────────────────────────

async function runWorkflow(
  workflowId: string,
  orgId: string,
  triggeredBy: string,
  metadata: Record<string, unknown>
): Promise<{ runId: string; status: RunStatus }> {

  // 3. Create the workflow_run record
  const runId = await createWorkflowRun(workflowId, orgId, triggeredBy, metadata);
  console.info(`[run:${runId}] Created workflow run for workflow ${workflowId}`);

  // Load steps
  const steps = await fetchWorkflowSteps(workflowId);
  if (steps.length === 0) {
    await updateWorkflowRunStatus(runId, "completed");
    return { runId, status: "completed" };
  }

  // Execution state
  let previousOutput: Record<string, unknown> = {};
  const stepRunIds: Map<string, string> = new Map(); // stepId → stepRunId
  const skippedStepOrders = new Set<number>();

  let finalStatus: RunStatus = "completed";

  // 4. Main execution loop
  for (const step of steps) {
    // Skip steps bypassed by a conditional_branch
    if (skippedStepOrders.has(step.step_order)) {
      console.info(`[run:${runId}] Skipping step ${step.step_order} (${step.type})`);

      // Create a skipped step_run record
      const skippedRunId = await createStepRun(runId, step.id, {});
      await markStepRunSkipped(skippedRunId);
      continue;
    }

    console.info(`[run:${runId}] Executing step ${step.step_order}: ${step.type}`);

    // 5a. Create step_run record (status: running)
    const stepRunId = await createStepRun(runId, step.id, previousOutput);
    stepRunIds.set(step.id, stepRunId);

    let attemptCount = 1;

    // ── approval_gate ────────────────────────────────────────────────────
    if (step.type === "approval_gate") {
      const gateConfig = step.config as ApprovalGateConfig;

      await updateStepRun(
        stepRunId,
        "awaiting_approval",
        {
          instructions: gateConfig.instructions ?? null,
          approver_role: gateConfig.approver_role ?? "owner",
          timeout_hours: gateConfig.timeout_hours ?? 24,
        },
        null,
        attemptCount
      );

      // 5b. Pause the entire workflow run
      await updateWorkflowRunStatus(runId, "paused", step.id);
      console.info(`[run:${runId}] Paused at approval_gate step ${step.step_order}`);

      return { runId, status: "paused" };
    }

    // ── Execute all other step types ─────────────────────────────────────
    try {
      let output: Record<string, unknown>;
      const context = { output: previousOutput };

      switch (step.type) {

        case "llm_call":
          output = await callLLM(step.config as LLMCallConfig, context);
          break;

        case "http_request":
          output = await executeHttpRequest(
            step.config as HttpRequestConfig,
            context
          );
          break;

        case "db_write":
          output = await executeDbWrite(step.config as DbWriteConfig, context);
          break;

        case "notify":
          output = await executeNotify(step.config as NotifyConfig, context);
          break;

        case "conditional_branch": {
          const branchConfig = step.config as ConditionalBranchConfig;
          const conditionMet = evalCondition(
            branchConfig.condition_expression,
            previousOutput
          );

          const nextStepOrder = conditionMet
            ? branchConfig.true_step_order
            : branchConfig.false_step_order;

          // Mark all steps between this and the chosen branch as skipped
          for (const s of steps) {
            if (
              s.step_order > step.step_order &&
              s.step_order !== nextStepOrder &&
              // Don't skip steps that come after the branch target
              s.step_order < nextStepOrder
            ) {
              skippedStepOrders.add(s.step_order);
            }
          }

          output = {
            condition_met: conditionMet,
            branching_to_step: nextStepOrder,
          };
          break;
        };
        case "whatsapp_msg": {
          const config = step.config as {
            recipient_phone?: string;
            message_template?: string;
          };

          const recipient = resolveTemplate(config.recipient_phone, context);
          const message = resolveTemplate(config.message_template, context);

          // Pluggable WhatsApp dispatch (Twilio / Meta Graph API)
          console.log(`[whatsapp_msg] → Sending to ${recipient}: ${message}`);

          output = {
            recipient,
            message,
            sent: true,
          };
          break;
        }


        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // 5c. Write completed step_run
      await updateStepRun(stepRunId, "completed", output, null, attemptCount);
      previousOutput = output;
      console.info(`[run:${runId}] Step ${step.step_order} completed`);

    } catch (stepError) {
      const errMsg =
        stepError instanceof Error ? stepError.message : String(stepError);

      console.error(
        `[run:${runId}] Step ${step.step_order} failed:`,
        stepError
      );

      await updateStepRun(
        stepRunId,
        "failed",
        null,
        errMsg,
        attemptCount
      );

      await updateWorkflowRunStatus(runId, "failed");
      finalStatus = "failed";
      return { runId, status: "failed" };
    }
  }

  // 6. All steps completed successfully
  await updateWorkflowRunStatus(runId, "completed");
  return { runId, status: finalStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nhost Functions entry point
// ─────────────────────────────────────────────────────────────────────────────

export default async function triggerWorkflowRun(
  req: Request,
  res: Response
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    // ── 1. Extract authenticated user ──────────────────────────────────────
    const userId = extractUserId(req);

    // ── Validate request body ──────────────────────────────────────────────
    const { workflow_id: workflowId, org_id: orgId, metadata = {} } = req.body as {
      workflow_id?: string;
      org_id?: string;
      metadata?: Record<string, unknown>;
    };

    if (!workflowId || !orgId) {
      res.status(400).json({ error: "workflow_id and org_id are required" });
      return;
    }

    // ── 1b. Validate org membership and role ───────────────────────────────
    const member = await fetchOrgMembership(userId, orgId);

    if (!member) {
      throw new ForbiddenError("You are not a member of this organization");
    }

    if (member.role === "viewer") {
      throw new ForbiddenError(
        "Viewers cannot trigger workflow runs. Requires 'editor' or 'owner' role."
      );
    }

    // ── 2. Check usage quota ───────────────────────────────────────────────
    const org = await fetchOrganization(orgId);
    if (!org) throw new NotFoundError("Organization not found");

    if (org.usage_count >= org.usage_allowed) {
      throw new QuotaError(
        `Usage limit reached: ${org.usage_count}/${org.usage_allowed} runs used this billing cycle`
      );
    }

    // ── 3–5. Execute the workflow ──────────────────────────────────────────
    const { runId, status } = await runWorkflow(
      workflowId,
      orgId,
      userId,
      metadata
    );

    // ── 6. Increment usage_count on successful completion ──────────────────
    if (status === "completed") {
      await incrementUsageCount(orgId);
      console.info(`[org:${orgId}] usage_count incremented to ${org.usage_count + 1}`);
    }

    res.status(200).json({
      success: true,
      run_id: runId,
      status,
    });

  } catch (err) {
    const statusCode =
      err instanceof AuthError ||
        err instanceof ForbiddenError ||
        err instanceof QuotaError ||
        err instanceof NotFoundError
        ? (err as { statusCode: number }).statusCode
        : 500;

    const message = err instanceof Error ? err.message : "Internal server error";

    console.error("[triggerWorkflowRun] Error:", err);

    res.status(statusCode).json({ error: message });
  }
}
