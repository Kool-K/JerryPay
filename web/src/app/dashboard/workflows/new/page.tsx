"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";

import { Brain, Globe, GitBranch, ShieldCheck, Database, Bell, Check, Loader2, ChevronUp, ChevronDown, X, AlertTriangle, MessageSquare, Code } from "lucide-react";

const DEMO_ORG_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const STEP_TYPES = [
  { value: "llm_call", label: "LLM Call", desc: "Call an AI model with a prompt", icon: <Brain className="w-4 h-4 shrink-0" /> },
  { value: "http_request", label: "HTTP Request", desc: "Make an outbound HTTP call", icon: <Globe className="w-4 h-4 shrink-0" /> },
  { value: "conditional_branch", label: "Conditional Branch", desc: "Branch based on a condition", icon: <GitBranch className="w-4 h-4 shrink-0" /> },
  { value: "approval_gate", label: "Approval Gate", desc: "Pause for human approval", icon: <ShieldCheck className="w-4 h-4 shrink-0" /> },
  { value: "db_write", label: "DB Write", desc: "Write results to the database", icon: <Database className="w-4 h-4 shrink-0" /> },
  { value: "notify", label: "Notify", desc: "Send a notification", icon: <Bell className="w-4 h-4 shrink-0" /> },
  {
    value: "whatsapp_msg",
    label: "WhatsApp Message",
    desc: "Send a message via WhatsApp API",
    icon: <MessageSquare className="w-4 h-4 shrink-0" />
  },
  {
    value: "code_transform",
    label: "Data Transformer",
    desc: "Format or calculate data using JavaScript",
    icon: <Code className="w-4 h-4 shrink-0" />
  },
];

type StepDraft = {
  type: string;
  label: string;
  config: Record<string, unknown>;
};

// Sensible defaults so newly-created steps execute without crashing
const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  llm_call: {
    model: "gemini-3.5-flash",
    system_prompt: "You are a helpful assistant. Return JSON only.",
    user_prompt_template: "Analyse this lead profile. Return strictly a JSON object with keys 'summary' (string) and 'score' (number 0-100):\n\n{{input}}",
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
    channel: "log",
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

export default function NewWorkflowPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
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
      // Build the GraphQL mutation payload
      const stepInserts = steps.map((s, i) => ({
        step_order: i + 1,
        type: s.type,
        label: s.label,
        config: s.config ?? DEFAULT_CONFIGS[s.type] ?? {},
      }));

      const mutation = `
        mutation CreateWorkflow(
          $orgId: uuid!
          $name: String!
          $description: String
          $steps: [workflow_steps_insert_input!]!
        ) {
          insert_workflows_one(object: {
            org_id: $orgId
            name: $name
            description: $description
            is_active: true
            workflow_steps: { data: $steps }
            workflow_triggers: { data: [{ trigger_type: "manual", is_active: true, config: {} }] }
          }) {
            id
          }
        }
      `;

      const res = await fetch("/api/gql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: mutation,
          variables: {
            orgId: DEMO_ORG_ID,
            name: name.trim(),
            description: description.trim() || null,
            steps: stepInserts,
          },
        }),
      });

      const json = (await res.json()) as {
        data?: { insert_workflows_one: { id: string } };
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        setError(json.errors.map((e) => e.message).join("; "));
        return;
      }

      const newId = json.data?.insert_workflows_one?.id;
      router.push(newId ? `/dashboard/workflows/${newId}` : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fade-in max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm text-gray-500">
          <Link href="/dashboard" className="hover:text-gray-300">← Workflows</Link>
        </div>
        <h1 className="text-2xl font-bold text-white">New Workflow</h1>
        <p className="text-sm text-gray-400 mt-1">
          Build an AI agent workflow for Org A — Acme Corp
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Details</h2>
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

        {/* Steps builder */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider">
            Steps · {steps.length}
          </h2>

          {/* Current steps */}
          {steps.length > 0 && (
            <ol className="space-y-2">
              {steps.map((step, idx) => {
                const meta = STEP_TYPES.find((s) => s.value === step.type);
                return (
                  <li key={idx} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-[#2A1F18] border border-[#3A2E24] flex items-center justify-center text-xs font-bold text-[#A89584] shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 bg-[#1C1510] border border-[#3A2E24] rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="text-[#CD8309]">{meta?.icon}</span>
                      <input
                        value={step.label}
                        onChange={(e) =>
                          setSteps((prev) =>
                            prev.map((s, i) => i === idx ? { ...s, label: e.target.value } : s)
                          )
                        }
                        className="flex-1 bg-transparent text-sm text-[#FFE5C0] focus:outline-none"
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
                  </li>
                );
              })}
            </ol>
          )}

          {/* Add step buttons */}
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

        {/* Error */}
        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className={clsx("btn-primary flex-1 justify-center", submitting && "opacity-60 cursor-not-allowed")}
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} Create Workflow
          </button>
          <Link href="/dashboard" className="btn-ghost">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
