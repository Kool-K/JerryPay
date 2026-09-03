import Link from "next/link";
import { cookies } from "next/headers";
import { adminGql } from "@/lib/nhost";
import { GET_WORKFLOW_RUNS } from "@/lib/queries";
import { resolveOrgId } from "@/lib/orgs";
import clsx from "clsx";
import { CheckCircle, XCircle, PauseCircle, Circle, Loader2, Activity, Pause, Dot } from "lucide-react";


type Run = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  metadata: Record<string, unknown>;
  workflow_id: string;
  paused_step_id: string | null;
};

const STATUS_META: Record<string, { badge: string; icon: React.ReactNode }> = {
  running:   { badge: "badge-running",   icon: <Loader2 className="w-3 h-3 inline-block -mt-0.5 mr-0.5 animate-spin" /> },
  completed: { badge: "badge-completed", icon: <CheckCircle className="w-3 h-3 inline-block -mt-0.5 mr-0.5" /> },
  failed:    { badge: "badge-failed",    icon: <XCircle className="w-3 h-3 inline-block -mt-0.5 mr-0.5" /> },
  paused:    { badge: "badge-paused",    icon: <PauseCircle className="w-3 h-3 inline-block -mt-0.5 mr-0.5" /> },
  cancelled: { badge: "badge-pending",   icon: <Circle className="w-3 h-3 inline-block -mt-0.5 mr-0.5" /> },
};

function duration(start: string, end: string | null): string {
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function RunsPage() {
  const jar = await cookies();
  const orgId = resolveOrgId(jar.get("jerry_active_org")?.value);

  const data = await adminGql<{ workflow_runs: Run[] }>(GET_WORKFLOW_RUNS, {
    orgId,
    limit: 50,
  });

  const runs = data.workflow_runs ?? [];

  return (
    <div className="fade-in">
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">All Runs</h1>
          <p className="text-sm text-[#A89584] mt-1">{runs.length} runs across all workflows</p>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="card p-16 text-center">
          <Activity className="w-12 h-12 text-[#A89584] mx-auto mb-4 opacity-50" />
          <p className="text-[#A89584]">No workflow runs yet. Trigger a workflow to get started.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto border border-[#3A2E24] rounded-xl">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-[#3A2E24] text-xs text-[#A89584] uppercase tracking-wider">
                <th className="text-left p-4 font-medium">Status</th>
                <th className="text-left p-4 font-medium">Workflow</th>
                <th className="text-left p-4 font-medium">Started</th>
                <th className="text-left p-4 font-medium">Duration</th>
                <th className="text-left p-4 font-medium">Note</th>
                <th className="text-right p-4 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const meta = STATUS_META[run.status] ?? { badge: "badge-pending", icon: <Dot className="w-3 h-3 inline-block -mt-0.5 mr-0.5" /> };
                return (
                  <tr
                    key={run.id}
                    className="border-b border-[#3A2E24]/50 hover:bg-[#2A1F18]/50 transition-colors"
                  >
                    <td className="p-4">
                      <span className={clsx("badge", meta.badge)}>
                        {meta.icon} {run.status}
                      </span>
                    </td>
                    <td className="p-4 text-[#FFE5C0]">
                      <Link
                        href={`/dashboard/workflows/${run.workflow_id}`}
                        className="text-[#CD8309] hover:text-[#FFC97A] text-xs"
                      >
                        {run.workflow_id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="p-4 text-[#A89584] text-xs">
                      {new Date(run.started_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-[#A89584] text-xs font-mono">
                      {duration(run.started_at, run.ended_at)}
                    </td>
                    <td className="p-4 text-[#A89584] text-xs max-w-xs truncate">
                      {run.status === "paused" && run.paused_step_id
                        ? <><Pause className="w-3 h-3 inline-block -mt-0.5 mr-1" /> Awaiting approval</>
                        : "—"}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/dashboard/runs/${run.id}`}
                        className="text-[#CD8309] hover:text-[#FFC97A] text-xs font-medium"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
