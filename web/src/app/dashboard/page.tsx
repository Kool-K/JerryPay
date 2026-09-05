import Link from "next/link";
import { cookies } from "next/headers";
import DeleteWorkflowButton from "@/components/DeleteWorkflowButton";
import { adminGql } from "@/lib/nhost";
import { GET_WORKFLOWS, GET_ORG } from "@/lib/queries";
import { resolveOrgId, USERS } from "@/lib/orgs";
import clsx from "clsx";
import { Play, Clock, Webhook, Zap, Layers } from "lucide-react";

async function getActiveOrgId(): Promise<string> {
  const jar = await cookies();
  return resolveOrgId(jar.get("jerry_active_org")?.value);
}

async function getActiveUserRole(): Promise<"owner" | "editor" | "viewer"> {
  const jar = await cookies();
  const userId = jar.get("jerry_active_user")?.value;
  const user = USERS.find((u) => u.id === userId);
  return user?.role ?? "viewer";
}

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  workflow_triggers: Array<{ id: string; trigger_type: string; is_active: boolean }>;
  workflow_runs_aggregate: { aggregate: { count: number } };
};

type Org = {
  id: string;
  name: string;
  slug: string;
  usage_allowed: number;
  usage_count: number;
  billing_cycle_start: string;
};

const STEP_TYPE_COLORS: Record<string, string> = {
  llm_call:           "text-violet-400",
  http_request:       "text-sky-400",
  db_write:           "text-emerald-400",
  notify:             "text-amber-400",
  conditional_branch: "text-orange-400",
  approval_gate:      "text-pink-400",
};

const TRIGGER_ICONS: Record<string, React.ReactNode> = {
  manual:    <Play className="w-3 h-3 inline-block -mt-0.5 mr-0.5" />,
  scheduled: <Clock className="w-3 h-3 inline-block -mt-0.5 mr-0.5" />,
  webhook:   <Webhook className="w-3 h-3 inline-block -mt-0.5 mr-0.5" />,
  event:     <Zap className="w-3 h-3 inline-block -mt-0.5 mr-0.5" />,
};

export default async function DashboardPage() {
  const [orgId, userRole] = await Promise.all([
    getActiveOrgId(),
    getActiveUserRole(),
  ]);

  const [workflowsData, orgData] = await Promise.all([
    adminGql<{ workflows: Workflow[] }>(GET_WORKFLOWS, { orgId }),
    adminGql<{ organizations_by_pk: Org }>(GET_ORG, { id: orgId }),
  ]);

  const workflows = workflowsData.workflows ?? [];
  const org = orgData.organizations_by_pk;
  const usagePercent = org
    ? Math.min(100, Math.round((org.usage_count / org.usage_allowed) * 100))
    : 0;

  /**
   * nextResetDate — rolls `billing_cycle_start` forward by 1 calendar month
   * until the result is strictly in the future. This ensures the displayed date
   * is always the *next* upcoming renewal, even if the seed value is in the past.
   */
  function nextResetDate(cycleStart: string): string {
    const start = new Date(cycleStart);
    const now = new Date();
    // Advance by 1 month increments until we are past today
    const next = new Date(start);
    while (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
    return next.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  const resetLabel = org ? nextResetDate(org.billing_cycle_start) : "—";
  const isAtQuota = org ? org.usage_count >= org.usage_allowed : false;

  return (
    <div className="fade-in">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflows</h1>
          <p className="mt-1 text-sm text-[#A89584]">
            {org?.name ?? "Loading…"} ·{" "}
            <span className={clsx(
              "font-medium",
              isAtQuota ? "text-red-400" : usagePercent > 80 ? "text-amber-400" : "text-[#FFE5C0]"
            )}>
              {org?.usage_count ?? 0}/{org?.usage_allowed ?? 0} runs used
            </span>
            {isAtQuota && (
              <span className="ml-2 text-xs bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded-full font-semibold">
                Quota exceeded
              </span>
            )}
          </p>
        </div>
        <Link href="/dashboard/workflows/new" className="btn-primary">
          <span>＋</span> New Workflow
        </Link>
      </div>

      {/* ── Usage bar ──────────────────────────────────────────────────────── */}
      {org && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between mb-1.5">
                <span className="text-xs text-[#A89584] font-medium">Monthly Usage</span>
                <span className={clsx(
                  "text-xs font-semibold",
                  isAtQuota ? "text-red-400" : usagePercent > 80 ? "text-amber-400" : "text-[#FFE5C0]"
                )}>
                  {org.usage_count} / {org.usage_allowed} runs · {usagePercent}%
                </span>
              </div>
              <div className="h-2.5 bg-[#2A1F18] rounded-full overflow-hidden">
                <div
                  className={clsx(
                    "h-full rounded-full transition-all duration-500",
                    isAtQuota
                      ? "bg-red-500"
                      : usagePercent > 80
                      ? "bg-amber-500"
                      : usagePercent > 60
                      ? "bg-[#CD8309]"
                      : "bg-emerald-500"
                  )}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>
            <div className="text-right text-xs text-[#A89584] shrink-0 min-w-[90px]">
              <span className="block text-[10px] text-[#6B5C4E] uppercase tracking-wider mb-0.5">Resets</span>
              <span className="font-medium text-[#FFE5C0]">{resetLabel}</span>
            </div>
          </div>
          {isAtQuota && (
            <p className="mt-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              ⚠️ Monthly quota reached. New workflow runs will be blocked until the next billing cycle ({resetLabel}).
            </p>
          )}
        </div>
      )}

      {/* ── Workflow grid ───────────────────────────────────────────────────── */}
      {workflows.length === 0 ? (
        <div className="card p-16 text-center">
          <Layers className="w-12 h-12 text-[#A89584] mx-auto mb-4 opacity-50" />
          <h2 className="text-lg font-semibold text-[#FFE5C0] mb-2">No workflows yet</h2>
          <p className="text-sm text-[#A89584] mb-6">
            Create your first AI agent workflow to get started.
          </p>
          <Link href="/dashboard/workflows/new" className="btn-primary inline-flex">
            Create Workflow
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {workflows.map((wf) => (
            <Link
              key={wf.id}
              href={`/dashboard/workflows/${wf.id}`}
              className="card p-5 block hover:border-[#CD8309]/40 transition-all hover:-translate-y-0.5 group"
            >
              {/* title row */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-white truncate group-hover:text-[#FFC97A] transition-colors">
                    {wf.name}
                  </h2>
                  {wf.description && (
                    <p className="text-xs text-[#A89584] mt-0.5 line-clamp-2">{wf.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className={clsx("badge", wf.is_active ? "badge-completed" : "badge-pending")}>
                    {wf.is_active ? "Active" : "Inactive"}
                  </span>
                  <DeleteWorkflowButton workflowId={wf.id} orgId={orgId} userRole={userRole} variant="icon" />
                </div>
              </div>

              {/* triggers */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {wf.workflow_triggers.map((t) => (
                  <span
                    key={t.id}
                    className="text-xs flex items-center bg-[#2A1F18] text-[#FFE5C0] px-2 py-0.5 rounded-full border border-[#3A2E24]"
                  >
                    {TRIGGER_ICONS[t.trigger_type] ?? <span className="mr-1">•</span>} {t.trigger_type}
                  </span>
                ))}
              </div>

              {/* footer */}
              <div className="flex items-center justify-between text-xs text-[#A89584] pt-3 border-t border-[#3A2E24]">
                <span>{wf.workflow_runs_aggregate.aggregate.count} runs</span>
                <span>{new Date(wf.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
