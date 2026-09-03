import Link from "next/link";
import { adminGql } from "@/lib/nhost";
import { GET_RUN_DETAIL } from "@/lib/queries";
import ApprovalPanel from "@/components/ApprovalPanel";
import clsx from "clsx";
import {
  CheckCircle, XCircle, PauseCircle, Circle, Loader2, Dot,
  GitBranch, Brain, Globe, Database, Bell, ShieldCheck, SkipForward,
  MessageSquare, Code, ShoppingCart, ShieldAlert, CreditCard, LifeBuoy,
  AlertTriangle, FileText, ChevronDown,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type StepRun = {
  id: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  audit_log: Record<string, unknown> | null;
  error: string | null;
  attempt_count: number;
  started_at: string | null;
  ended_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
  workflow_step: {
    id: string;
    step_order: number;
    type: string;
    label: string | null;
    config: Record<string, unknown>;
  };
};

type WorkflowRun = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  metadata: Record<string, unknown>;
  org_id: string;
  workflow_id: string;
  paused_step_id: string | null;
  step_runs: StepRun[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Metadata maps
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { badge: string; icon: React.ReactNode; label: string }> = {
  running:          { badge: "badge-running",   icon: <Loader2    className="w-3 h-3 inline-block -mt-0.5 animate-spin mr-1" />, label: "Running"            },
  completed:        { badge: "badge-completed", icon: <CheckCircle className="w-3 h-3 inline-block -mt-0.5 mr-1" />,            label: "Completed"           },
  failed:           { badge: "badge-failed",    icon: <XCircle    className="w-3 h-3 inline-block -mt-0.5 mr-1" />,            label: "Failed"              },
  paused:           { badge: "badge-paused",    icon: <PauseCircle className="w-3 h-3 inline-block -mt-0.5 mr-1" />,           label: "Paused"              },
  awaiting_approval:{ badge: "badge-paused",    icon: <ShieldCheck className="w-3 h-3 inline-block -mt-0.5 mr-1" />,           label: "Awaiting Approval"   },
  waiting_approval: { badge: "badge-paused",    icon: <ShieldAlert className="w-3 h-3 inline-block -mt-0.5 mr-1" />,           label: "Policy Gate Paused"  },
  pending:          { badge: "badge-pending",   icon: <Dot         className="w-3 h-3 inline-block -mt-0.5 mr-1" />,           label: "Pending"             },
  skipped:          { badge: "badge-skipped",   icon: <SkipForward className="w-3 h-3 inline-block -mt-0.5 mr-1" />,           label: "Skipped"             },
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  llm_call:             <Brain         className="w-4 h-4 shrink-0" />,
  http_request:         <Globe         className="w-4 h-4 shrink-0" />,
  db_write:             <Database      className="w-4 h-4 shrink-0" />,
  notify:               <Bell          className="w-4 h-4 shrink-0" />,
  conditional_branch:   <GitBranch     className="w-4 h-4 shrink-0" />,
  approval_gate:        <ShieldCheck   className="w-4 h-4 shrink-0" />,
  whatsapp_msg:         <MessageSquare className="w-4 h-4 shrink-0" />,
  code_transform:       <Code          className="w-4 h-4 shrink-0" />,
  // JerryPay agentic commerce
  AI_AGENT_RECOMMENDER:  <ShoppingCart className="w-4 h-4 shrink-0" />,
  POLICY_GATE:           <ShieldAlert  className="w-4 h-4 shrink-0" />,
  RAZORPAY_ORDER_CREATE: <CreditCard   className="w-4 h-4 shrink-0" />,
  RECOVERY_HANDLER:      <LifeBuoy     className="w-4 h-4 shrink-0" />,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function duration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Trail sub-components (server-side JSX helpers)
// ─────────────────────────────────────────────────────────────────────────────

function AIAgentAuditCard({ log }: { log: Record<string, unknown> }) {
  const bundle = (log.bundle ?? []) as Array<{
    product_id?: string; name?: string; price_inr?: number; qty?: number;
  }>;
  const totalMRP = bundle.reduce((s, i) => s + (i.price_inr ?? 0) * (i.qty ?? 1), 0);

  return (
    <div className="mt-3 rounded-lg border border-[#CD8309]/30 bg-[#CD8309]/5 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShoppingCart className="w-4 h-4 text-[#CD8309] shrink-0" />
        <span className="text-xs font-bold text-[#CD8309] uppercase tracking-wider">AI Recommendation Trace</span>
      </div>

      {/* Reasoning */}
      {typeof log.reasoning === "string" && log.reasoning && (
        <p className="text-xs text-[#FFE5C0] leading-relaxed italic border-l-2 border-[#CD8309]/40 pl-3">
          &ldquo;{log.reasoning}&rdquo;
        </p>
      )}

      {/* Bundle table */}
      {bundle.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#A89584] border-b border-[#3A2E24]">
                <th className="text-left pb-1.5 font-medium">SKU</th>
                <th className="text-left pb-1.5 font-medium">Product</th>
                <th className="text-right pb-1.5 font-medium">Unit</th>
                <th className="text-right pb-1.5 font-medium">Qty</th>
                <th className="text-right pb-1.5 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="text-[#FFE5C0]">
              {bundle.map((item, i) => (
                <tr key={i} className="border-b border-[#2A1F18]">
                  <td className="py-1.5 font-mono text-[#A89584] pr-3">{item.product_id ?? "—"}</td>
                  <td className="py-1.5 pr-3">{item.name ?? "—"}</td>
                  <td className="py-1.5 text-right pr-2">{fmt(item.price_inr ?? 0)}</td>
                  <td className="py-1.5 text-right pr-2">{item.qty ?? 1}</td>
                  <td className="py-1.5 text-right font-medium">{fmt((item.price_inr ?? 0) * (item.qty ?? 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      <div className="flex flex-wrap gap-4 pt-1 border-t border-[#3A2E24]">
        <div>
          <p className="text-[#A89584] text-xs mb-0.5">MRP Total</p>
          <p className="text-[#FFE5C0] font-semibold text-sm">{fmt(totalMRP)}</p>
        </div>
        <div>
          <p className="text-[#A89584] text-xs mb-0.5">Discount Applied</p>
          <p className="text-amber-400 font-semibold text-sm">{String(log.discount_pct ?? 0)}%</p>
        </div>
        <div>
          <p className="text-[#A89584] text-xs mb-0.5">Recommended Price</p>
          <p className="text-emerald-400 font-bold text-sm">{fmt(Number(log.recommended_price_inr ?? 0))}</p>
        </div>
      </div>
    </div>
  );
}

function PolicyGateAuditCard({ log }: { log: Record<string, unknown> }) {
  const verdict = String(log.verdict ?? "");
  const isPASS = verdict === "PASS";
  const checks = (log.checks ?? []) as Array<{
    rule?: string; value?: unknown; limit?: unknown; passed?: boolean;
  }>;
  const breached = (log.breached_rules ?? []) as string[];

  return (
    <div className={clsx(
      "mt-3 rounded-lg border p-4 space-y-3",
      isPASS
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-orange-500/30 bg-orange-500/5"
    )}>
      {/* Verdict banner */}
      <div className="flex items-center gap-2">
        {isPASS
          ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
        }
        <span className={clsx(
          "text-xs font-bold uppercase tracking-wider",
          isPASS ? "text-emerald-400" : "text-orange-400"
        )}>
          Policy Gate — {isPASS ? "Passed (Autonomous)" : "Breached (Paused for Approval)"}
        </span>
        <span className={clsx(
          "ml-auto text-xs font-bold px-2.5 py-0.5 rounded-full",
          isPASS
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-orange-500/20 text-orange-300"
        )}>
          {verdict}
        </span>
      </div>

      {/* Check rows */}
      <div className="space-y-1.5">
        {checks.map((c, i) => {
          const passed = Boolean(c.passed);
          const ruleLabel: Record<string, string> = {
            discount_pct_limit:   "Discount cap",
            order_total_limit_inr: "Order total cap",
            no_blocked_risk_tags: "Risk tag check",
          };
          const valueStr = Array.isArray(c.value)
            ? (c.value as string[]).join(", ") || "none"
            : String(c.value ?? "");
          const limitStr = Array.isArray(c.limit)
            ? (c.limit as string[]).join(", ") || "none"
            : String(c.limit ?? "");

          return (
            <div
              key={i}
              className={clsx(
                "flex items-center justify-between px-3 py-2 rounded-md text-xs",
                passed ? "bg-emerald-500/10" : "bg-red-500/10"
              )}
            >
              <div className="flex items-center gap-2">
                {passed
                  ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  : <XCircle    className="w-3.5 h-3.5 text-red-400 shrink-0" />
                }
                <span className={passed ? "text-emerald-200" : "text-red-200"}>
                  {ruleLabel[c.rule ?? ""] ?? c.rule}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[#A89584]">
                <span>value: <span className={passed ? "text-emerald-300" : "text-red-300"}>{valueStr}</span></span>
                <span>limit: {limitStr}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Breach summary */}
      {!isPASS && breached.length > 0 && (
        <div className="pt-1 border-t border-orange-500/20">
          <p className="text-xs text-orange-300">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            <strong>Breached rules:</strong> {breached.join(", ")} — workflow paused for merchant review.
          </p>
        </div>
      )}
    </div>
  );
}

function RazorpayAuditCard({ log }: { log: Record<string, unknown> }) {
  return (
    <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-cyan-400 shrink-0" />
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Razorpay Test Order Created</span>
        <span className="ml-auto text-xs font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">
          {String(log.status ?? "created")}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "Order ID",  value: String(log.order_id ?? "—"), mono: true },
          { label: "Amount",    value: fmt(Number(log.amount_paise ?? 0) / 100), mono: false },
          { label: "Currency",  value: String(log.currency ?? "INR"), mono: false },
          { label: "Receipt",   value: String(log.receipt ?? "—"), mono: true },
        ].map(({ label, value, mono }) => (
          <div key={label} className="bg-cyan-500/5 rounded-md px-3 py-2">
            <p className="text-[#A89584] text-xs mb-0.5">{label}</p>
            <p className={clsx("text-cyan-200 text-xs font-semibold break-all", mono && "font-mono")}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecoveryAuditCard({ log }: { log: Record<string, unknown> }) {
  const handled = Boolean(log.handled);
  return (
    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <LifeBuoy className="w-4 h-4 text-red-400 shrink-0" />
        <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Payment Error Intercepted (Recovery Triggered)</span>
        <span className={clsx(
          "ml-auto text-xs font-bold px-2.5 py-0.5 rounded-full",
          handled ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
        )}>
          {handled ? "Handled" : "Unhandled"}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-red-500/5 rounded-md px-3 py-2">
          <p className="text-[#A89584] text-xs mb-0.5">Exception Type</p>
          <p className="text-red-200 text-xs font-mono font-semibold">{String(log.exception_type ?? "UNKNOWN")}</p>
        </div>
        <div className="bg-red-500/5 rounded-md px-3 py-2">
          <p className="text-[#A89584] text-xs mb-0.5">Notified</p>
          <p className="text-xs font-semibold">
            {log.notified
              ? <span className="text-emerald-400">✓ Yes</span>
              : <span className="text-[#A89584]">No</span>
            }
          </p>
        </div>
      </div>
      {typeof log.fallback_action === "string" && log.fallback_action && (
        <div className="bg-red-500/5 rounded-md px-3 py-2">
          <p className="text-[#A89584] text-xs mb-0.5">Fallback Action</p>
          <p className="text-red-200 text-xs leading-relaxed">{log.fallback_action}</p>
        </div>
      )}
    </div>
  );
}

/** Renders the appropriate audit trail card for a step_run, or null if no audit_log */
function AuditTrailCard({ sr }: { sr: StepRun }) {
  const log = sr.audit_log;
  if (!log || Object.keys(log).length === 0) return null;

  const type = sr.workflow_step?.type;

  return (
    <details className="group mt-2" open={type === "POLICY_GATE" || type === "RAZORPAY_ORDER_CREATE"}>
      <summary className="cursor-pointer flex items-center gap-1.5 text-xs text-[#A89584] hover:text-[#FFE5C0] transition-colors select-none list-none">
        <FileText className="w-3 h-3" />
        Audit Trail &amp; Decision Trace
        <ChevronDown className="w-3 h-3 ml-auto group-open:rotate-180 transition-transform" />
      </summary>
      {type === "AI_AGENT_RECOMMENDER" && <AIAgentAuditCard log={log} />}
      {type === "POLICY_GATE"           && <PolicyGateAuditCard log={log} />}
      {type === "RAZORPAY_ORDER_CREATE" && <RazorpayAuditCard log={log} />}
      {type === "RECOVERY_HANDLER"      && <RecoveryAuditCard log={log} />}
      {/* Fallback: raw JSON for any other step type with audit_log data */}
      {!["AI_AGENT_RECOMMENDER","POLICY_GATE","RAZORPAY_ORDER_CREATE","RECOVERY_HANDLER"].includes(type ?? "") && (
        <pre className="mt-3 text-xs font-mono bg-[#1C1510] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all max-w-full max-h-40 text-[#A89584] leading-relaxed">
          {JSON.stringify(log, null, 2)}
        </pre>
      )}
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await adminGql<{ workflow_runs_by_pk: WorkflowRun | null }>(
    GET_RUN_DETAIL,
    { id }
  );

  const run = data.workflow_runs_by_pk;
  if (!run) {
    return (
      <div className="card p-16 text-center fade-in">
        <div className="text-4xl mb-4">🔍</div>
        <h1 className="text-lg font-semibold text-gray-200">Run not found</h1>
        <Link href="/dashboard" className="btn-ghost mt-4 inline-flex">← Back</Link>
      </div>
    );
  }

  const runMeta = STATUS_META[run.status] ?? STATUS_META.pending;

  // Find human approval gate step run
  const pendingApprovalStepRun = run.step_runs.find(
    (sr) => sr.status === "awaiting_approval"
  );
  const gateConfig = pendingApprovalStepRun?.workflow_step?.config as
    | { instructions?: string; approver_role?: string }
    | undefined;

  // Find policy gate breach step run (for the JerryPay approval banner)
  const policyBreachStepRun = run.step_runs.find(
    (sr) => sr.status === "waiting_approval" && sr.workflow_step?.type === "POLICY_GATE"
  );
  const policyBreachRules = policyBreachStepRun?.audit_log
    ? ((policyBreachStepRun.audit_log as Record<string, unknown>).breached_rules as string[] | undefined) ?? []
    : [];

  return (
    <div className="fade-in space-y-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm text-gray-500">
          <Link href="/dashboard" className="hover:text-gray-300">Workflows</Link>
          <span>/</span>
          <Link href={`/dashboard/workflows/${run.workflow_id}`} className="hover:text-gray-300 font-mono text-xs">
            {run.workflow_id.slice(0, 8)}…
          </Link>
          <span>/</span>
          <span className="text-[#A89584]">Run</span>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#FFE5C0]">Run Detail</h1>
            <p className="text-xs text-[#A89584] font-mono mt-1">{run.id}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={clsx("badge text-sm px-3 py-1", runMeta.badge)}>
              {runMeta.icon} {runMeta.label}
            </span>
            <span className="text-xs text-[#A89584]">
              {duration(run.started_at, run.ended_at)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Human Approval Panel ─────────────────────────────────────────── */}
      {run.status === "paused" && pendingApprovalStepRun && (
        <ApprovalPanel
          workflowRunId={run.id}
          stepRunId={pendingApprovalStepRun.id}
          instructions={gateConfig?.instructions ?? null}
          approverRole={gateConfig?.approver_role ?? "owner"}
        />
      )}

      {/* ── Policy Gate Breach Banner (waiting_approval) ─────────────────── */}
      {run.status === "paused" && policyBreachStepRun && (
        <div className="rounded-xl border border-orange-500/40 bg-orange-500/5 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-orange-400 shrink-0" />
            <div>
              <h3 className="font-semibold text-orange-200">Policy Gate Breached — Merchant Approval Required</h3>
              <p className="text-xs text-[#A89584] mt-0.5">
                The autonomous policy engine detected threshold violations. Human review is required before the Razorpay order can be created.
              </p>
            </div>
          </div>
          {policyBreachRules.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {policyBreachRules.map((rule) => (
                <span key={rule} className="text-xs font-mono bg-orange-500/15 text-orange-300 border border-orange-500/30 rounded-md px-2.5 py-1">
                  {rule}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-[#A89584]">
            <Circle className="w-3 h-3 inline mr-1 text-orange-400" />
            Use the <strong className="text-orange-300">Approve / Reject</strong> action in the Approval Panel to resume or cancel this order.
          </p>
          {/* Reuse approval panel for policy gate breaches */}
          <ApprovalPanel
            workflowRunId={run.id}
            stepRunId={policyBreachStepRun.id}
            instructions={`Policy Gate detected ${policyBreachRules.length} breach(es): ${policyBreachRules.join(", ")}. Review the Audit Trail below and approve to proceed with the Razorpay order creation, or reject to cancel.`}
            approverRole="owner"
          />
        </div>
      )}

      {/* ── Metadata strip ───────────────────────────────────────────────── */}
      <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
        <div>
          <p className="text-[#A89584] text-xs mb-1">Started</p>
          <p className="text-[#FFE5C0] font-medium">{new Date(run.started_at).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[#A89584] text-xs mb-1">Ended</p>
          <p className="text-[#FFE5C0] font-medium">{run.ended_at ? new Date(run.ended_at).toLocaleString() : "—"}</p>
        </div>
        <div>
          <p className="text-[#A89584] text-xs mb-1">Duration</p>
          <p className="text-[#FFE5C0] font-medium">{duration(run.started_at, run.ended_at)}</p>
        </div>
        <div>
          <p className="text-[#A89584] text-xs mb-1">Steps</p>
          <p className="text-[#FFE5C0] font-medium">{run.step_runs.length}</p>
        </div>
      </div>

      {/* ── Step Timeline ────────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-5">
          Step Timeline &amp; Audit Trail
        </h2>
        <ol className="space-y-3">
          {run.step_runs.map((sr, idx) => {
            const meta = STATUS_META[sr.status] ?? STATUS_META.pending;
            const isLast = idx === run.step_runs.length - 1;
            const stepType = sr.workflow_step?.type ?? "";

            const bubbleCx = clsx(
              "w-8 h-8 rounded-full border text-xs font-bold flex items-center justify-center relative z-10 shrink-0",
              sr.status === "completed"
                ? "bg-[#CD8309]/20 border-[#CD8309]/40 text-[#CD8309]"
                : sr.status === "failed"
                ? "bg-red-600/20 border-red-500/40 text-red-400"
                : sr.status === "awaiting_approval" || sr.status === "waiting_approval"
                ? "bg-orange-600/20 border-orange-500/40 text-orange-400 pulse-ring"
                : sr.status === "skipped"
                ? "bg-[#2A1F18] border-[#3A2E24] text-[#A89584]"
                : sr.status === "running"
                ? "bg-[#CD8309]/20 border-[#CD8309]/40 text-[#CD8309]"
                : "bg-[#2A1F18] border-[#3A2E24] text-[#A89584]"
            );

            return (
              <li key={sr.id} className="flex gap-4 relative">
                {/* connector + icon */}
                <div className="flex flex-col items-center">
                  <div className={bubbleCx}>
                    {STEP_ICONS[stepType] ?? meta.icon}
                  </div>
                  {!isLast && (
                    <div
                      className={clsx(
                        "absolute left-3 top-6 bottom-[-24px] w-0.5 -translate-x-1/2",
                        sr.status === "completed" ? "bg-[#CD8309]" : "bg-[#2A1F18]"
                      )}
                    />
                  )}
                </div>

                {/* content */}
                <div className="flex-1 pb-4 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-[#FFE5C0]">
                      {sr.workflow_step?.label ?? sr.workflow_step?.type ?? `Step ${sr.workflow_step?.step_order}`}
                    </span>
                    <span className={clsx("badge", meta.badge)}>{meta.label}</span>
                    <span className="ml-auto text-xs text-[#A89584] shrink-0">
                      {duration(sr.started_at, sr.ended_at)}
                    </span>
                  </div>

                  {/* ── Audit Trail (JerryPay step types) ──────────────── */}
                  <AuditTrailCard sr={sr} />

                  {/* ── Output preview (collapsible for other steps) ───── */}
                  {sr.output && !sr.audit_log && (
                    <details className="group mt-1">
                      <summary className="cursor-pointer text-xs text-[#A89584] hover:text-[#FFE5C0] mb-1 flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Output ▸
                      </summary>
                      <pre className="text-xs font-mono bg-[#1C1510] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all max-w-full max-h-40 text-[#A89584] leading-relaxed">
                        {JSON.stringify(sr.output, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* ── Error ──────────────────────────────────────────── */}
                  {sr.error && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-1">
                      <XCircle className="w-3 h-3 inline mr-1" /> {sr.error}
                    </div>
                  )}

                  {/* ── Approval meta ──────────────────────────────────── */}
                  {sr.approved_by && (
                    <p className="text-xs text-[#A89584] mt-1 flex items-center gap-1">
                      {sr.output && (sr.output as Record<string, unknown>).decision === "approve"
                        ? <><CheckCircle className="w-3 h-3 text-emerald-500" /> Approved</>
                        : <><XCircle    className="w-3 h-3 text-red-500" /> Rejected</>
                      }
                      {sr.approved_at && ` · ${new Date(sr.approved_at).toLocaleString()}`}
                      {sr.approval_note && ` · "${sr.approval_note}"`}
                    </p>
                  )}

                  {/* ── Attempts ───────────────────────────────────────── */}
                  {sr.attempt_count > 1 && (
                    <p className="text-xs text-amber-500/70 mt-1 flex items-center gap-1">
                      <Loader2 className="w-3 h-3" /> {sr.attempt_count} attempts
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── Run Metadata ─────────────────────────────────────────────────── */}
      {run.metadata && Object.keys(run.metadata).length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-3">
            Initial Metadata
          </h2>
          <pre className="text-xs font-mono bg-[#1C1510] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all max-w-full text-[#A89584] leading-relaxed">
            {JSON.stringify(run.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
