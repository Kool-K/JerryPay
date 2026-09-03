import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { adminGql } from "@/lib/nhost";
import { GET_WORKFLOW_DETAIL } from "@/lib/queries";
import TriggerRunButton from "@/components/TriggerRunButton";
import DeleteWorkflowButton from "@/components/DeleteWorkflowButton";
import { USERS } from "@/lib/orgs";
import clsx from "clsx";
import { Brain, Globe, Database, Bell, GitBranch, ShieldCheck, Pencil, MessageSquare, Code, ShoppingCart, ShieldAlert, CreditCard, LifeBuoy } from "lucide-react";

type Step = {
  id: string;
  step_order: number;
  type: string;
  label: string | null;
  config: Record<string, unknown>;
};

type Run = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
};

type Trigger = {
  id: string;
  trigger_type: string;
  config: Record<string, unknown>;
  is_active: boolean;
};

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  org_id: string;
  workflow_steps: Step[];
  workflow_triggers: Trigger[];
  workflow_runs: Run[];
};

const STEP_TYPE_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  llm_call:           { icon: <Brain className="w-4 h-4 shrink-0" />, label: "LLM Call",             color: "text-[#FFE5C0]" },
  http_request:       { icon: <Globe className="w-4 h-4 shrink-0" />, label: "HTTP Request",          color: "text-[#FFE5C0]" },
  db_write:           { icon: <Database className="w-4 h-4 shrink-0" />, label: "DB Write",              color: "text-[#FFE5C0]" },
  notify:             { icon: <Bell className="w-4 h-4 shrink-0" />, label: "Notify",                color: "text-[#FFE5C0]" },
  conditional_branch: { icon: <GitBranch className="w-4 h-4 shrink-0" />,  label: "Conditional Branch",   color: "text-[#FFE5C0]" },
  approval_gate:      { icon: <ShieldCheck className="w-4 h-4 shrink-0" />, label: "Approval Gate",         color: "text-[#FFE5C0]" },
  whatsapp_msg:       { icon: <MessageSquare className="w-4 h-4 shrink-0" />, label: "WhatsApp Message",    color: "text-[#FFE5C0]" },
  code_transform:     { icon: <Code className="w-4 h-4 shrink-0" />,          label: "Data Transformer",    color: "text-[#FFE5C0]" },
  // JerryPay agentic commerce step types
  AI_AGENT_RECOMMENDER:  { icon: <ShoppingCart className="w-4 h-4 shrink-0" />, label: "AI Recommender",   color: "text-[#CD8309]" },
  POLICY_GATE:           { icon: <ShieldAlert className="w-4 h-4 shrink-0" />,  label: "Policy Gate",       color: "text-[#F97316]" },
  RAZORPAY_ORDER_CREATE: { icon: <CreditCard className="w-4 h-4 shrink-0" />,   label: "Razorpay Order",    color: "text-[#22C55E]" },
  RECOVERY_HANDLER:      { icon: <LifeBuoy className="w-4 h-4 shrink-0" />,     label: "Recovery Handler",  color: "text-[#EF4444]" },
};

const STATUS_BADGE: Record<string, string> = {
  running:   "badge-running",
  completed: "badge-completed",
  failed:    "badge-failed",
  paused:    "badge-paused",
  cancelled: "badge-pending",
};

// No longer using FUNCTIONS_URL since we migrated to local API route

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Guard: "new" is a static route collision — redirect before firing UUID query
  if (id === "new" || !id.match(/^[0-9a-f-]{36}$/i)) {
    redirect("/dashboard/workflows/new");
  }

  // Resolve the active user's role from the cookie
  const jar = await cookies();
  const userId = jar.get("jerry_active_user")?.value;
  const userRole = (USERS.find((u) => u.id === userId)?.role ?? "viewer") as "owner" | "editor" | "viewer";

  const data = await adminGql<{ workflows_by_pk: Workflow | null }>(
    GET_WORKFLOW_DETAIL,
    { id }
  );

  const wf = data.workflows_by_pk;
  if (!wf) {
    return (
      <div className="card p-16 text-center fade-in">
        <div className="text-4xl mb-4">🔍</div>
        <h1 className="text-lg font-semibold text-gray-200">Workflow not found</h1>
        <Link href="/dashboard" className="btn-ghost mt-4 inline-flex">← Back</Link>
      </div>
    );
  }

  return (
    <div className="fade-in space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-400 text-sm">← Workflows</Link>
          </div>
          <h1 className="text-2xl font-bold text-white">{wf.name}</h1>
          {wf.description && <p className="text-sm text-gray-400 mt-1">{wf.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <DeleteWorkflowButton workflowId={wf.id} orgId={wf.org_id} userRole={userRole} variant="full" />
          <Link href={`/dashboard/workflows/${wf.id}/edit`} className="btn-ghost flex items-center text-[#A89584] hover:text-[#CD8309]">
            <Pencil className="w-4 h-4 mr-1.5" /> Edit Workflow
          </Link>
          {/* Trigger Run button — client-side fetch with spinner + redirect */}
          <TriggerRunButton workflowId={wf.id} orgId={wf.org_id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Steps ───────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 card p-5">
          <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-4">
            Steps · {wf.workflow_steps.length}
          </h2>
          <ol className="space-y-3">
            {wf.workflow_steps.map((step, idx) => {
              const meta = STEP_TYPE_META[step.type] ?? { icon: <span className="mr-1">•</span>, label: step.type, color: "text-[#A89584]" };
              return (
                <li key={step.id} className="flex items-start gap-4">
                  {/* order bubble */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#2A1F18] border border-[#3A2E24] flex items-center justify-center text-xs font-bold text-[#A89584]">
                    {step.step_order}
                  </div>
                  <div className="flex-1 card p-3.5 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#CD8309]">{meta.icon}</span>
                      <span className={clsx("text-xs font-semibold uppercase tracking-wider", meta.color)}>
                        {meta.label}
                      </span>
                      {step.label && (
                        <span className="text-sm font-medium text-[#FFE5C0] ml-1">— {step.label}</span>
                      )}
                    </div>
                    <pre className="text-xs text-[#A89584] font-mono overflow-auto max-h-24 leading-relaxed">
                      {JSON.stringify(step.config, null, 2)}
                    </pre>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* ── Sidebar: Triggers + Recent Runs ─────────────────────────────── */}
        <div className="space-y-4">
          {/* Triggers */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-3">Triggers</h2>
            <ul className="space-y-2">
              {wf.workflow_triggers.map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span className="text-sm text-[#FFE5C0] capitalize">{t.trigger_type}</span>
                  <span className={clsx("badge", t.is_active ? "badge-completed" : "badge-pending")}>
                    {t.is_active ? "on" : "off"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Recent Runs */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-3">Recent Runs</h2>
            {wf.workflow_runs.length === 0 ? (
              <p className="text-xs text-[#A89584]">No runs yet.</p>
            ) : (
              <ul className="space-y-2">
                {wf.workflow_runs.map((run) => (
                  <li key={run.id}>
                    <Link
                      href={`/dashboard/runs/${run.id}`}
                      className="flex items-center justify-between hover:bg-gray-800/50 rounded-lg px-2 py-1.5 transition-colors"
                    >
                      <span className={clsx("badge", STATUS_BADGE[run.status] ?? "badge-pending")}>
                        {run.status}
                      </span>
                      <span className="text-xs text-gray-600">
                        {new Date(run.started_at).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/dashboard/runs?workflow=${wf.id}`}
              className="block mt-3 text-xs text-[#CD8309] hover:text-[#FFC97A]"
            >
              View all runs →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
