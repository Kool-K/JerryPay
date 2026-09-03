/**
 * JerryPay — Shared TypeScript Types
 *
 * This is the single source of truth for step types, statuses, and workflow
 * interfaces used across API routes and dashboard components.
 *
 * Import from here instead of redeclaring locally:
 *   import type { StepType, StepStatus, RunStatus } from "@/lib/types";
 */

// ─────────────────────────────────────────────────────────────────────────────
// Step Types
// ─────────────────────────────────────────────────────────────────────────────

/** Original Jerry workflow step types */
export type BaseStepType =
  | "llm_call"
  | "http_request"
  | "db_write"
  | "notify"
  | "conditional_branch"
  | "approval_gate"
  | "whatsapp_msg"
  | "code_transform";

/**
 * JerryPay agentic commerce step types.
 *
 * - AI_AGENT_RECOMMENDER:  LLM evaluates buyer request, selects products, calculates
 *                          bundle pricing and discount. Emits recommended_price_inr and
 *                          discount_pct into audit_log.
 * - POLICY_GATE:           Deterministic boundary verification — checks discount ≤ 15%,
 *                          total ≤ ₹5000, and absence of blocked risk tags. Transitions
 *                          step_run to 'waiting_approval' if any threshold is breached.
 * - RAZORPAY_ORDER_CREATE: Calls Razorpay test-mode API to create an order. Writes
 *                          order_id, amount_paise, receipt into audit_log.
 * - RECOVERY_HANDLER:      Fallback step invoked on upstream failure or policy breach.
 *                          Notifies the configured channel and marks the incident handled.
 */
export type AgenticCommerceStepType =
  | "AI_AGENT_RECOMMENDER"
  | "POLICY_GATE"
  | "RAZORPAY_ORDER_CREATE"
  | "RECOVERY_HANDLER";

/** Full union of all supported step types */
export type StepType = BaseStepType | AgenticCommerceStepType;

/** All valid step type strings (useful for runtime validation) */
export const ALL_STEP_TYPES: readonly StepType[] = [
  // Base
  "llm_call",
  "http_request",
  "db_write",
  "notify",
  "conditional_branch",
  "approval_gate",
  "whatsapp_msg",
  "code_transform",
  // JerryPay agentic commerce
  "AI_AGENT_RECOMMENDER",
  "POLICY_GATE",
  "RAZORPAY_ORDER_CREATE",
  "RECOVERY_HANDLER",
] as const;

export function isValidStepType(t: string): t is StepType {
  return (ALL_STEP_TYPES as readonly string[]).includes(t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Types
// ─────────────────────────────────────────────────────────────────────────────

export type RunStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval"  // blocked at approval_gate (human approval required)
  | "waiting_approval";  // blocked at POLICY_GATE breach (policy approval required)

export type OrgRole = "owner" | "editor" | "viewer";

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  step_order: number;
  type: StepType;
  label: string | null;
  config: Record<string, unknown>;
}

export interface Organization {
  id: string;
  usage_allowed: number;
  usage_count: number;
}

export interface OrgMember {
  role: OrgRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Config Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface LLMCallConfig {
  model?: string;
  system_prompt?: string;
  user_prompt_template: string;
  temperature?: number;
  max_tokens?: number;
}

export interface HttpRequestConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body_template?: string;
  timeout_ms?: number;
}

export interface ConditionalBranchConfig {
  condition_expression: string;
  true_step_order: number;
  false_step_order: number;
}

export interface ApprovalGateConfig {
  approver_role?: OrgRole;
  timeout_hours?: number;
  instructions?: string;
}

export interface DbWriteConfig {
  mutation: string;
  variables_template: string;
}

export interface NotifyConfig {
  channel: "email" | "slack" | "webhook";
  recipient_template: string;
  message_template: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// JerryPay Agentic Commerce Config Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI_AGENT_RECOMMENDER config.
 * The LLM receives a buyer request from previous step output and returns:
 *   { bundle: [...], recommended_price_inr: number, discount_pct: number, reasoning: string }
 */
export interface AIAgentRecommenderConfig {
  model?: string;
  system_prompt?: string;
  /** Maximum discount the AI is allowed to suggest (soft limit; POLICY_GATE enforces hard cap) */
  max_discount_pct?: number;
  currency?: "INR";
}

/**
 * POLICY_GATE config.
 * Hard limits enforced deterministically — no LLM involved.
 */
export interface PolicyGateConfig {
  /** Maximum allowable discount percentage. Default: 15 */
  max_discount_pct: number;
  /** Maximum allowable order total in INR (paise stored internally). Default: 5000 */
  max_total_inr: number;
  /** If the previous step output contains any of these tags, the gate BREACHES. */
  blocked_risk_tags?: string[];
}

/**
 * RAZORPAY_ORDER_CREATE config.
 * Reads amount_paise and buyer details from previous step output.
 */
export interface RazorpayOrderCreateConfig {
  currency?: "INR";
  /** Prefix for the Razorpay receipt field, e.g. "JP_RECEIPT". Default: "JPAY" */
  receipt_prefix?: string;
}

/**
 * RECOVERY_HANDLER config.
 * Invoked when an upstream step fails or a POLICY_GATE breach is unresolvable.
 */
export interface RecoveryHandlerConfig {
  notify_channel?: "email" | "slack" | "webhook";
  fallback_message_template?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log Interfaces (written to step_runs.audit_log)
// ─────────────────────────────────────────────────────────────────────────────

export interface AIAgentAuditLog {
  reasoning: string;
  bundle: Array<{ product_id: string; name: string; price_inr: number; qty: number }>;
  recommended_price_inr: number;
  discount_pct: number;
}

export interface PolicyCheck {
  rule: string;
  value: number | string | string[];
  limit: number | string | string[];
  passed: boolean;
}

export interface PolicyGateAuditLog {
  verdict: "PASS" | "BREACH";
  checks: PolicyCheck[];
  breached_rules: string[];
}

export interface RazorpayOrderAuditLog {
  order_id: string;
  amount_paise: number;
  currency: string;
  receipt: string;
  status: string;
  razorpay_response: Record<string, unknown>;
}

export interface RecoveryHandlerAuditLog {
  exception_type: string;
  handled: boolean;
  fallback_action: string;
  notified: boolean;
}
