# JerryPay — Agentic Commerce Gateway

**🌟 Live Demo: [https://jerrypay.vercel.app/dashboard](https://jerrypay.vercel.app/dashboard)**  
**📹 Video Walkthrough (Loom): [Watch Demo](https://www.loom.com/share/8f363fa027c942659819a0a1e7c7478a)**

> **Razorpay AI Buildathon · Track 01: AI Growth & Agentic Commerce**

JerryPay is an **Agentic Commerce Gateway** that lets AI agents autonomously initiate, evaluate, policy-gate, and reconcile payments through Razorpay — with deterministic guardrails, explainable decision traces, and human-in-the-loop approval for high-risk transactions.

---

## 🧭 Problem Statement

Modern agentic commerce protocols — **ACP (Agent Commerce Protocol)** and **x402 (HTTP Payment Extension)** — enable AI agents to transact on behalf of users. But autonomous payment agents create a critical trust gap:

- **Who validates the AI's pricing decisions?** LLMs can hallucinate discounts, misread context, or be adversarially prompted to recommend overpriced or underpriced bundles.
- **Who enforces the merchant's risk policies?** An agent that can negotiate any price is an agent that can exceed the merchant's acceptable thresholds without audit.
- **Who approves anomalous transactions?** High-value or suspicious orders require a human checkpoint — not a retry loop.

JerryPay solves this with a **four-stage agentic commerce pipeline** that separates AI reasoning from deterministic policy enforcement, and provides full explainability at every step.

---

## 🏗️ Architecture

```
  Buyer Request
       │
       ▼
┌─────────────────────────────┐
│   1. AI_AGENT_RECOMMENDER   │  LLM evaluates buyer intent
│                             │  → recommends SKU bundle
│  • Gemini / Groq / OR       │  → calculates price & discount %
│  • Returns structured JSON  │  → writes reasoning to audit_log
└──────────────┬──────────────┘
               │  { bundle, recommended_price_inr, discount_pct }
               ▼
┌─────────────────────────────┐
│      2. POLICY_GATE         │  Deterministic — no LLM
│                             │
│  ✓ discount_pct ≤ 15%       │  PASS → continue
│  ✓ total_inr ≤ ₹5,000       │  BREACH → status: waiting_approval
│  ✓ no blocked risk tags     │          workflow PAUSED
│                             │          merchant notified
└──────────────┬──────────────┘
               │  (PASS only)
               ▼
┌─────────────────────────────┐
│  3. RAZORPAY_ORDER_CREATE   │  Calls Razorpay test-mode API
│                             │  → POST /v1/orders
│  • amount in paise          │  → stores order_id, receipt
│  • receipt: JPAY_<ts>       │  → writes full Razorpay response
│  • Razorpay Basic auth      │    to audit_log
└──────────────┬──────────────┘
               │  (on error or post-breach rejection)
               ▼
┌─────────────────────────────┐
│    4. RECOVERY_HANDLER      │  Fallback — logs + notifies
│                             │  → exception_type, fallback_action
│  • Slack / email / webhook  │  → notified: true/false
│  • Structured incident log  │  → audit_log written
└─────────────────────────────┘
```

### State Machine

```
[running] → POLICY_GATE PASS  → [running] → Razorpay OK → [completed]
[running] → POLICY_GATE BREACH → [paused / waiting_approval]
                                        │
                              merchant approves ──→ [running] → [completed]
                              merchant rejects  ──→ [cancelled]
```

---

## ✨ The Bar: What Makes JerryPay Different

| Feature | JerryPay |
|---------|----------|
| **Explainable AI decisions** | Every AI recommendation writes a full `audit_log` with reasoning, bundle table, discount %, and total |
| **Dual-threshold policy gating** | Deterministic checks — no LLM involved — for discount cap (15%) and order cap (₹5000) |
| **Structured policy verdicts** | `audit_log` records each check rule, actual value, limit, and pass/fail individually |
| **Human-in-the-loop** | `waiting_approval` step status pauses the workflow; merchant approves/rejects via UI |
| **Razorpay test-mode integration** | Real `POST /v1/orders` call; real `order_id` and `receipt` stored in audit trail |
| **Cascading recovery** | `RECOVERY_HANDLER` step provides structured fallback logging for any exception type |
| **Multi-tenant RBAC** | Owner / Editor / Viewer roles with per-org usage quotas and approval gates |
| **Zero-hallucination policy layer** | Policy Gate is pure arithmetic — guaranteed deterministic, auditable, and explainable |

---

## 🗂️ Project Structure

```
JerryPay/
├── db/
│   ├── schema.sql                      # Full PostgreSQL schema
│   ├── seed.sql                        # 3 demo workflows with audit_log data
│   ├── reset_seed.sql                  # Idempotent seed wipe
│   ├── permissions.sql                 # Row-level security / Hasura permissions
│   └── migrations/
│       └── 001_add_new_step_types.sql  # Adds 4 JerryPay step types + audit_log
│
└── web/                                # Next.js 14 App Router
    ├── src/
    │   ├── app/
    │   │   ├── api/
    │   │   │   ├── triggerWorkflowRun/ # Main execution engine (all 4 step types)
    │   │   │   └── approveStep/        # Human approval handler
    │   │   └── dashboard/
    │   │       ├── workflows/[id]/     # Workflow detail + step canvas
    │   │       └── runs/[id]/          # Run detail + Audit Trail UI
    │   ├── components/
    │   │   ├── JerryLogo.tsx           # JerryPay shield + ₹ logo mark
    │   │   ├── ApprovalPanel.tsx       # Human approval UI (approve/reject)
    │   │   └── TopNav.tsx
    │   └── lib/
    │       ├── types.ts                # Canonical StepType union + config interfaces
    │       └── queries.ts              # GraphQL queries (incl. audit_log)
    └── .env.local                      # Razorpay + Nhost credentials
```

---

## 🚀 Quickstart

### Prerequisites

- Node.js 18+
- [Nhost](https://nhost.io) project (PostgreSQL + Hasura GraphQL)
- Razorpay test-mode account ([dashboard.razorpay.com](https://dashboard.razorpay.com))

### 1. Clone & Install

```bash
git clone <repo-url> JerryPay
cd JerryPay/web
npm install
```

### 2. Configure Environment

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env.local
```

Edit `web/.env.local`:

```env
# Nhost (from your Nhost project settings)
NHOST_SUBDOMAIN=your-subdomain
NHOST_REGION=ap-south-1
NHOST_ADMIN_SECRET=your-nhost-admin-secret
NHOST_GRAPHQL_URL=https://your-subdomain.hasura.ap-south-1.nhost.run/v1/graphql

# LLM (Gemini recommended)
LLM_PROVIDER=gemini
LLM_API_KEY=your-gemini-api-key
LLM_DEFAULT_MODEL=gemini-1.5-flash

# Razorpay Test Mode Keys (from Razorpay Dashboard → Settings → API Keys)
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```

### 3. Apply Database Schema

In the **Nhost SQL Editor** (or via `psql`):

```sql
-- 1. Apply base schema
\i db/schema.sql

-- 2. Apply JerryPay migration (adds 4 new step types + audit_log)
\i db/migrations/001_add_new_step_types.sql

-- 3. Load demo workflows (2 JerryPay agentic commerce scenarios)
\i db/seed.sql
```

### 4. Run Dev Server

```bash
cd web
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

---

## 🎬 Demo Scenarios

Two pre-seeded workflows demonstrate the full agentic commerce pipeline:

### Scenario A — Autonomous Micro-Checkout ✅

> *"Buyer requests home decor under ₹3,000. AI recommends a ₹2,396 bundle with 10% loyalty discount. Policy Gate passes. Razorpay test order created autonomously."*

- **Run ID:** `a1b2c3d4-0000-0000-0000-000000000002`
- **Outcome:** Completed — all 3 steps pass without human intervention
- **Razorpay Order:** `order_TestJPAY_MICRO_001` · ₹2,160 (₹216,000 paise)
- **URL:** `/dashboard/runs/a1b2c3d4-0000-0000-0000-000000000002`

### Scenario B — High-Value Order (Human Approval Gated) ⏸️

> *"Buyer orders a Panchadhatu brass idol collector set at ₹10,500 with 25% bulk discount. Policy Gate detects two breaches: discount > 15% AND total > ₹5,000. Workflow pauses for merchant approval."*

- **Run ID:** `a1b2c3d4-0000-0000-0000-000000000003`
- **Outcome:** Paused — waiting for merchant to approve or reject
- **Breached Rules:** `discount_pct_limit`, `order_total_limit_inr`
- **URL:** `/dashboard/runs/a1b2c3d4-0000-0000-0000-000000000003`

---

## 🔑 Policy Gate Rules

The `POLICY_GATE` step enforces hard limits — no LLM involved:

| Rule | Default Limit | Behaviour on Breach |
|------|-------------|-------------------|
| `discount_pct_limit` | ≤ 15% | Pause + `waiting_approval` |
| `order_total_limit_inr` | ≤ ₹5,000 | Pause + `waiting_approval` |
| `no_blocked_risk_tags` | No `fraud`, `high_risk`, `restricted` tags | Pause + `waiting_approval` |

Limits are configurable per workflow step via the `config` JSONB field.

---

## 📊 Audit Trail Schema

Every JerryPay step writes a structured `audit_log` to `step_runs.audit_log` (JSONB):

```jsonc
// AI_AGENT_RECOMMENDER
{
  "reasoning": "Curated warm earthy bundle within ₹3000 budget...",
  "bundle": [{ "product_id": "SKU_HD_001", "name": "Terracotta Vase Set", "price_inr": 899, "qty": 1 }],
  "recommended_price_inr": 2160,
  "discount_pct": 10
}

// POLICY_GATE (BREACH example)
{
  "verdict": "BREACH",
  "checks": [
    { "rule": "discount_pct_limit",    "value": 25,    "limit": 15,   "passed": false },
    { "rule": "order_total_limit_inr", "value": 10500, "limit": 5000, "passed": false },
    { "rule": "no_blocked_risk_tags",  "value": [],    "limit": ["fraud","high_risk"], "passed": true }
  ],
  "breached_rules": ["discount_pct_limit", "order_total_limit_inr"]
}

// RAZORPAY_ORDER_CREATE
{
  "order_id": "order_TestJPAY_MICRO_001",
  "amount_paise": 216000,
  "currency": "INR",
  "receipt": "JPAY_MICRO_1725353000000",
  "status": "created",
  "razorpay_response": { /* full Razorpay API response */ }
}

// RECOVERY_HANDLER
{
  "exception_type": "RAZORPAY_ORDER_FAILED",
  "handled": true,
  "fallback_action": "JerryPay Alert: High-value order ₹10500 failed...",
  "notified": true
}
```

---

## 🛡️ Step Types Reference

| Type | Category | Description |
|------|----------|-------------|
| `AI_AGENT_RECOMMENDER` | JerryPay | LLM evaluates buyer request → structured bundle + pricing |
| `POLICY_GATE` | JerryPay | Deterministic boundary check → PASS or BREACH |
| `RAZORPAY_ORDER_CREATE` | JerryPay | Calls `POST /v1/orders` on Razorpay test API |
| `RECOVERY_HANDLER` | JerryPay | Structured fallback + notification on exception |
| `llm_call` | Core | Generic LLM step |
| `http_request` | Core | Outbound HTTP call |
| `conditional_branch` | Core | JS expression routing |
| `approval_gate` | Core | Human approval (approve/reject) |
| `notify` | Core | Email / Slack / webhook notification |
| `db_write` | Core | Hasura mutation |
| `whatsapp_msg` | Core | WhatsApp outbound |
| `code_transform` | Core | JS data transformer |

---

## 🧪 TypeScript Verification

```bash
cd web
npx tsc --noEmit   # must exit 0 — zero type errors
```

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind-free Vanilla CSS |
| Database | PostgreSQL via [Nhost](https://nhost.io) |
| GraphQL | Hasura (auto-generated from schema) |
| AI / LLM | Google Gemini 1.5 Flash (configurable: Groq, OpenRouter) |
| Payments | Razorpay Orders API (test mode) |
| Icons | Lucide React |

---

## 👤 Built By

**Ketaki Sachin Kulkarni** — Razorpay AI Buildathon 2026  
Track 01: AI Growth & Agentic Commerce

---

*JerryPay: Where AI agents meet deterministic commerce guardrails.*
