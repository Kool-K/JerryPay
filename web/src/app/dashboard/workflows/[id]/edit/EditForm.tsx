"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { Brain, Globe, GitBranch, ShieldCheck, Database, Bell, Check, Loader2, ChevronUp, ChevronDown, X, AlertTriangle, MessageSquare, Code } from "lucide-react";

const STEP_TYPES = [
  { value: "llm_call",           label: "LLM Call",           desc: "Call an AI model with a prompt",    icon: <Brain className="w-4 h-4 shrink-0" /> },
  { value: "http_request",       label: "HTTP Request",       desc: "Make an outbound HTTP call",        icon: <Globe className="w-4 h-4 shrink-0" /> },
  { value: "conditional_branch", label: "Conditional Branch", desc: "Branch based on a condition",       icon: <GitBranch className="w-4 h-4 shrink-0" /> },
  { value: "approval_gate",      label: "Approval Gate",      desc: "Pause for human approval",          icon: <ShieldCheck className="w-4 h-4 shrink-0" /> },
  { value: "db_write",           label: "DB Write",           desc: "Write results to the database",     icon: <Database className="w-4 h-4 shrink-0" /> },
  { value: "notify",             label: "Notify",             desc: "Send a notification",               icon: <Bell className="w-4 h-4 shrink-0" /> },
  { value: "whatsapp_msg",       label: "WhatsApp Message",   desc: "Send a message via WhatsApp API",   icon: <MessageSquare className="w-4 h-4 shrink-0" /> },
  { value: "code_transform",     label: "Data Transformer",   desc: "Format or calculate data using JS", icon: <Code className="w-4 h-4 shrink-0" /> },
];

const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  llm_call: {
    model: "gemini-2.5-flash",
    system_prompt: "You are a helpful assistant. Return JSON only.",
    user_prompt_template: "Analyse this lead profile. Return strictly JSON in this format: {\"summary\": \"...\", \"score\": 85}\n\nLead profile: {{input}}",
    temperature: 0.7,
    max_tokens: 512,
  },
  http_request: {
    url: "https://httpbin.org/post",
    method: "POST",
    body_template: '{"input": "{{input}}"}',
    timeout_ms: 10000,
  },
  conditional_branch: {
    condition_expression: "output.score > 70",
    true_step_order: null,
    false_step_order: null,
  },
  approval_gate: {
    instructions: "Please review the previous step output and approve or reject.",
    approver_role: "owner",
    timeout_hours: 24,
  },
  db_write: {
    mutation: "mutation { __typename }",
    variables_template: "{}",
  },
  notify: {
    channel: "email",
    recipient_template: "admin",
    message_template: "Workflow step completed: {{input}}",
  },
  whatsapp_msg: {
    recipient_phone: "{{input.phone}}",
    message_template: "Hello {{input.name}}, your lead score is updated!",
  },
  code_transform: {
    code: "return { transformed: input.text ? input.text.trim() : '' };",
  },
};

type StepDraft = {
  id?: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
};

export default function EditForm({ workflow }: { workflow: any }) {
  const router = useRouter();
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description || "");
  const [isActive, setIsActive] = useState(workflow.is_active);
  
  // Sort initial steps by step_order
  const initialSteps = [...workflow.workflow_steps].sort((a, b) => a.step_order - b.step_order).map(s => ({
    id: s.id,
    type: s.type,
    label: s.label || s.type,
    config: s.config || {},
  }));
  const [steps, setSteps] = useState<StepDraft[]>(initialSteps);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addStep(type: string) {
    const meta = STEP_TYPES.find((s) => s.value === type);
    setSteps((prev) => [
      ...prev,
      {
        type,
        label: meta?.label.replace(/^[^\s]+\s/, "") ?? type,
        config: DEFAULT_CONFIGS[type] ?? {},
      },
    ]);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Workflow name is required."); return; }
    if (steps.length === 0) { setError("Add at least one step."); return; }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/updateWorkflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: workflow.id,
          name: name.trim(),
          description: description.trim() || null,
          is_active: isActive,
          steps,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Failed to update workflow");
      }

      router.push(`/dashboard/workflows/${workflow.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fade-in max-w-2xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm text-gray-500">
          <Link href={`/dashboard/workflows/${workflow.id}`} className="hover:text-gray-300">← Back to Workflow</Link>
        </div>
        <h1 className="text-2xl font-bold text-white">Edit Workflow</h1>
        <p className="text-sm text-gray-400 mt-1">
          Modify the workflow configuration and steps
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Details</h2>
          
          <div className="flex items-center gap-3 bg-[#1C1510] border border-[#3A2E24] p-3 rounded-lg mb-4">
            <label className="text-sm font-medium text-gray-300 flex-1">Active Status</label>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={clsx(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                isActive ? "bg-[#CD8309]" : "bg-gray-600"
              )}
            >
              <span className={clsx("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", isActive ? "translate-x-4" : "translate-x-0")} />
            </button>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">
              Workflow Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. AI Lead Enricher"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#CD8309] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">
              Description <span className="text-gray-700">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this workflow does…"
              rows={2}
              className="w-full bg-[#1C1510] border border-[#3A2E24] rounded-lg px-3 py-2 text-sm text-[#FFE5C0] placeholder-[#A89584] resize-none focus:outline-none focus:border-[#CD8309] transition-colors"
            />
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider">
            Steps · {steps.length}
          </h2>

          {steps.length > 0 && (
            <ol className="space-y-2">
              {steps.map((step, idx) => {
                const meta = STEP_TYPES.find((s) => s.value === step.type);
                return (
                  <li key={idx} className="flex flex-col gap-2 p-3 bg-[#1C1510] border border-[#3A2E24] rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-[#2A1F18] border border-[#3A2E24] flex items-center justify-center text-xs font-bold text-[#A89584] shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-[#CD8309]">{meta?.icon}</span>
                        <input
                          value={step.label}
                          onChange={(e) =>
                            setSteps((prev) =>
                              prev.map((s, i) => i === idx ? { ...s, label: e.target.value } : s)
                            )
                          }
                          className="flex-1 bg-transparent text-sm font-semibold text-[#FFE5C0] focus:outline-none"
                        />
                      </div>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => moveStep(idx, -1)} disabled={idx === 0}
                          className="w-6 h-6 flex items-center justify-center rounded text-[#A89584] hover:text-[#FFE5C0] disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                        <button type="button" onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1}
                          className="w-6 h-6 flex items-center justify-center rounded text-[#A89584] hover:text-[#FFE5C0] disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                        <button type="button" onClick={() => removeStep(idx)}
                          className="w-6 h-6 flex items-center justify-center rounded text-red-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                    {/* Basic config JSON editor for power users */}
                    <textarea 
                      value={JSON.stringify(step.config, null, 2)}
                      onChange={(e) => {
                        try {
                          const newConfig = JSON.parse(e.target.value);
                          setSteps((prev) => prev.map((s, i) => i === idx ? { ...s, config: newConfig } : s));
                        } catch (err) {
                          // Invalid JSON, don't update state yet but let them type
                        }
                      }}
                      className="w-full mt-2 bg-[#0E0B08] border border-[#3A2E24] rounded px-3 py-2 text-xs font-mono text-[#A89584] h-24 focus:outline-none focus:border-[#CD8309]"
                    />
                  </li>
                );
              })}
            </ol>
          )}

          <div>
            <p className="text-xs text-[#A89584] mb-2 font-medium">Add Step</p>
            <div className="grid grid-cols-2 gap-2">
              {STEP_TYPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => addStep(s.value)}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-[#1C1510] border border-[#3A2E24] hover:border-[#CD8309]/40 hover:bg-[#2A1F18]/60 transition-all text-left"
                >
                  <span className="text-[#CD8309] mt-0.5 shrink-0">{s.icon}</span>
                  <div>
                    <p className="text-xs font-medium text-[#FFE5C0]">{s.label}</p>
                    <p className="text-[10px] text-[#A89584]">{s.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className={clsx("btn-primary flex-1 justify-center", submitting && "opacity-60 cursor-not-allowed")}
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} Save Workflow
          </button>
          <Link href={`/dashboard/workflows/${workflow.id}`} className="btn-ghost">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
