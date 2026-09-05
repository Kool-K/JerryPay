"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";

const COMMERCE_STEP_TYPES = new Set([
  "AI_AGENT_RECOMMENDER",
  "POLICY_GATE",
  "RAZORPAY_ORDER_CREATE",
  "RECOVERY_HANDLER",
]);

const COMMERCE_METADATA = {
  buyer_request: "Recommend 3 handcrafted home decor items under ₹3000",
  currency: "INR",
  channel: "web",
};

const LEGACY_METADATA = {
  lead_profile:
    "Jane Smith, VP of Engineering at TechCorp (500 employees). Budget signal: high. Whitepaper downloaded.",
};

interface TriggerRunButtonProps {
  workflowId: string;
  orgId: string;
  /** Step types in the workflow — used to auto-select the right trigger metadata */
  steps?: string[];
}

export default function TriggerRunButton({ workflowId, orgId, steps = [] }: TriggerRunButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isCommerceWorkflow = steps.some((t) => COMMERCE_STEP_TYPES.has(t));
  const triggerMetadata = isCommerceWorkflow ? COMMERCE_METADATA : LEGACY_METADATA;

  const handleTrigger = useCallback(async () => {
    setState("loading");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/triggerWorkflowRun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: workflowId,
          org_id: orgId,
          metadata: triggerMetadata,
        }),
      });

      const json = (await res.json()) as {
        success?: boolean;
        run_id?: string;
        status?: string;
        error?: string;
      };

      if (!res.ok || !json.success) {
        setState("error");
        setErrorMsg(json.error ?? "Failed to trigger run");
        return;
      }

      // Redirect to the newly created run details page
      if (json.run_id) {
        router.push(`/dashboard/runs/${json.run_id}`);
      } else {
        router.refresh();
        setState("idle");
      }
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    }
  }, [workflowId, orgId, router]);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        id="trigger-run-btn"
        onClick={handleTrigger}
        disabled={state === "loading"}
        className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {state === "loading" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-base" />
            Triggering…
          </>
        ) : (
          <><Play className="w-4 h-4" /> Trigger Run</>
        )}
      </button>

      {state === "error" && errorMsg && (
        <p className="text-xs text-red-400 max-w-[200px] text-right">{errorMsg}</p>
      )}
    </div>
  );
}
