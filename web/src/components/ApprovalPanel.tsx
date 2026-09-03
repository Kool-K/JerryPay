"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrg } from "@/contexts/OrgContext";
import clsx from "clsx";
import { ShieldCheck, Check, X, Loader2, AlertTriangle } from "lucide-react";

interface ApprovalPanelProps {
  workflowRunId: string;
  stepRunId: string;
  instructions: string | null;
  approverRole: string;
}

export default function ApprovalPanel({
  workflowRunId,
  stepRunId,
  instructions,
  approverRole,
}: ApprovalPanelProps) {
  const { user, userId } = useOrg();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecision(decision: "approve" | "reject") {
    setSubmitting(decision);
    setError(null);

    try {
      // Local API route proxies to Hasura using admin secret
      const res = await fetch("/api/approveStep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_run_id: workflowRunId,
          step_run_id: stepRunId,
          decision,
          note: note.trim() || null,
          user_id: userId,
        }),
      });

      const json = (await res.json()) as { success?: boolean; error?: string; status?: string };

      if (!res.ok || !json.success) {
        setError(json.error ?? "Unexpected error");
        return;
      }

      // Refresh the page to show updated run status
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="rounded-xl border border-pink-500/30 bg-pink-500/5 p-5 space-y-4">
      {/* header */}
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-pink-400" />
        <div>
          <h3 className="font-semibold text-white">Approval Required</h3>
          <p className="text-xs text-[#A89584]">
            Requires <span className="font-medium text-pink-300">{approverRole}</span> role to proceed
          </p>
        </div>
      </div>

      {/* instructions */}
      {instructions && (
        <div className="rounded-lg bg-[#1C1510]/60 border border-[#3A2E24] p-3 text-sm text-[#FFE5C0] leading-relaxed">
          {instructions}
        </div>
      )}

      {/* note textarea */}
      <div>
        <label className="block text-xs text-[#A89584] mb-1.5 font-medium">
          Decision Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note explaining your decision…"
          rows={3}
          className="w-full bg-[#1C1510] border border-[#3A2E24] rounded-lg px-3 py-2 text-sm text-[#FFE5C0] placeholder-[#A89584] resize-none focus:outline-none focus:border-[#CD8309] transition-colors"
          disabled={submitting !== null}
        />
      </div>

      {/* error */}
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Role notice */}
      {user.role === "editor" && (
        <div className="text-sm text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Approval Gate requires Owner role. Active user is Editor.
        </div>
      )}

      {/* action buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => handleDecision("approve")}
          disabled={submitting !== null || user.role === "editor"}
          className={clsx(
            "btn-primary flex-1 justify-center",
            (submitting === "approve" || user.role === "editor") && "opacity-60 cursor-not-allowed"
          )}
        >
          {submitting === "approve" ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : <Check className="w-4 h-4 mr-1" />}
          Approve
        </button>
        <button
          onClick={() => handleDecision("reject")}
          disabled={submitting !== null || user.role === "editor"}
          className={clsx(
            "btn-danger flex-1 justify-center",
            (submitting === "reject" || user.role === "editor") && "opacity-60 cursor-not-allowed"
          )}
        >
          {submitting === "reject" ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : <X className="w-4 h-4 mr-1" />}
          Reject
        </button>
      </div>
    </div>
  );
}
