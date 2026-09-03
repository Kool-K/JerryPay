"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle, Loader2, ShieldX } from "lucide-react";
import clsx from "clsx";

type Props = {
  workflowId: string;
  orgId: string;
  userRole: "owner" | "editor" | "viewer";
  variant?: "full" | "icon";
};

export default function DeleteWorkflowButton({ workflowId, orgId, userRole, variant = "full" }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();

  const isOwner = userRole === "owner";

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/deleteWorkflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_id: workflowId, org_id: orgId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete workflow");
      }

      setIsOpen(false);
      router.push("/dashboard");
      router.refresh();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleOpen(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isOwner) {
      setIsOpen(true); // opens the "no permission" notice instead
      return;
    }
    setDeleteError(null);
    setIsOpen(true);
  }

  function handleClose(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
  }

  return (
    <>
      {variant === "full" ? (
        <button
          onClick={handleOpen}
          title={isOwner ? "Delete Workflow" : "Only owners can delete workflows"}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
            isOwner
              ? "bg-[#1C1510] border-[#3A2E24] text-red-400 hover:border-red-500/50 hover:bg-red-500/10"
              : "bg-[#1C1510] border-[#3A2E24] text-[#4A3F35] cursor-not-allowed opacity-50"
          )}
        >
          <Trash2 className="w-4 h-4" /> Delete Workflow
        </button>
      ) : (
        <button
          onClick={handleOpen}
          title={isOwner ? "Delete Workflow" : "Only owners can delete workflows"}
          className={clsx(
            "flex items-center justify-center p-1.5 rounded-md transition-colors",
            isOwner
              ? "text-[#A89584] hover:text-red-400 hover:bg-red-500/10"
              : "text-[#3A2E24] cursor-not-allowed opacity-40"
          )}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}

      {isOpen && !isOwner && (
        /* ── Non-owner: permission notice modal ── */
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0E0B08]/80 backdrop-blur-sm">
          <div
            className="w-full max-w-sm bg-[#1C1510] border border-[#3A2E24] rounded-xl shadow-2xl p-6 relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <ShieldX className="w-32 h-32 text-amber-500" />
            </div>

            <div className="flex items-center gap-3 mb-4 text-[#CD8309] relative z-10">
              <div className="w-10 h-10 rounded-full bg-[#CD8309]/10 flex items-center justify-center border border-[#CD8309]/30 shrink-0">
                <ShieldX className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-white">Permission Denied</h2>
            </div>

            <p className="text-sm text-[#A89584] leading-relaxed relative z-10 mb-6">
              Only <span className="text-[#FFE5C0] font-semibold">owners</span> can delete workflows.
              Contact your workspace owner to remove this workflow.
            </p>

            <button
              onClick={handleClose}
              className="w-full btn-ghost justify-center"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {isOpen && isOwner && (
        /* ── Owner: full confirmation modal ── */
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0E0B08]/80 backdrop-blur-sm">
          <div
            className="w-full max-w-sm bg-[#1C1510] border border-[#3A2E24] rounded-xl shadow-2xl p-6 relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <AlertTriangle className="w-32 h-32 text-red-500" />
            </div>

            <div className="flex items-center gap-3 mb-4 text-red-400 relative z-10">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-white">Delete Workflow?</h2>
            </div>

            <p className="text-sm text-[#A89584] leading-relaxed relative z-10 mb-6">
              This action cannot be undone. All associated run history and step data will be permanently removed.
            </p>

            {deleteError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 relative z-10">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{deleteError}</p>
              </div>
            )}

            <div className="flex gap-3 relative z-10">
              <button
                onClick={handleClose}
                disabled={isDeleting}
                className="btn-ghost flex-1 justify-center"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className={clsx(
                  "flex-1 flex justify-center items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border",
                  isDeleting
                    ? "bg-red-500/50 text-white/70 border-transparent cursor-not-allowed"
                    : "bg-red-500 hover:bg-red-600 text-white border-red-400/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                )}
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
