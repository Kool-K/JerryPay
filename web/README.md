# Jerry Web — Next.js Frontend

This is the Next.js 16 frontend and API layer for **Jerry**, the multi-tenant AI agent workflow builder.

## Overview

The `web/` directory is a self-contained Next.js application that serves both the React UI and the server-side workflow execution API routes. It connects to a Nhost backend (PostgreSQL + Hasura GraphQL) for all persistent state.

## Quick Start

```bash
# Install dependencies
npm install

# Start the development server (with Turbopack)
npm run dev

# Type-check and build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## Environment Variables

Create a `.env.local` file in this directory. Copy from `../.env.example`:

```env
# Hasura GraphQL endpoint + admin secret (server-side only — never exposed to browser)
NHOST_GRAPHQL_URL=https://YOUR_SUBDOMAIN.nhost.run/v1/graphql
NHOST_ADMIN_SECRET=your-hasura-admin-secret

# LLM configuration
LLM_PROVIDER=gemini                         # Options: gemini | groq | openrouter
LLM_API_KEY=your-api-key
LLM_DEFAULT_MODEL=gemini-2.5-flash

# Optional: provider base URLs (only override if self-hosting)
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta
GROQ_API_URL=https://api.groq.com/openai/v1
OPENROUTER_API_URL=https://openrouter.ai/api/v1
```

> ⚠️ **Security:** `NHOST_ADMIN_SECRET` is a server-only variable. It is never prefixed with `NEXT_PUBLIC_` and is never sent to the browser.

## Key Directories

```
src/
├── app/
│   ├── api/                   # API routes (server-side execution engine)
│   │   ├── triggerWorkflowRun/  # POST — executes a full workflow run
│   │   ├── approveStep/         # POST — approves a paused approval_gate step
│   │   ├── deleteWorkflow/      # POST — cascading workflow deletion (owner only)
│   │   ├── updateWorkflow/      # POST — update workflow metadata + steps
│   │   ├── updateOrg/           # POST — live org name update
│   │   └── gql/                 # POST — generic Hasura admin proxy
│   ├── dashboard/
│   │   ├── layout.tsx           # Dashboard shell with TopNav + OrgContext provider
│   │   ├── page.tsx             # Workflow list (home)
│   │   ├── runs/
│   │   │   ├── page.tsx         # All workflow runs across org
│   │   │   └── [id]/page.tsx    # Individual run detail + step timeline
│   │   ├── settings/page.tsx    # Workspace settings (org name, live update)
│   │   └── workflows/
│   │       ├── new/page.tsx     # Visual workflow creation builder
│   │       └── [id]/
│   │           ├── page.tsx     # Workflow detail, trigger, step list
│   │           └── edit/        # Visual workflow edit builder
│   ├── globals.css              # Design tokens + utility classes
│   ├── icon.svg                 # Browser tab favicon (SVG)
│   └── layout.tsx               # Root HTML layout
├── components/
│   ├── JerryLogo.tsx            # Custom SVG brand mark
│   ├── TopNav.tsx               # Top horizontal navigation bar
│   ├── OrgSwitcher.tsx          # Multi-org context switcher
│   ├── UserSwitcher.tsx         # Demo role switcher (owner/editor/viewer)
│   ├── TriggerRunButton.tsx     # Workflow run trigger with input modal
│   ├── ApprovalPanel.tsx        # Human approval UI for paused runs
│   └── DeleteWorkflowButton.tsx # Delete button with confirmation modal + inline errors
├── contexts/
│   └── OrgContext.tsx           # React context: active org data (name, id, members)
└── lib/
    ├── nhost.ts                 # Hasura adminGql() client helper
    ├── queries.ts               # All GraphQL query/mutation strings
    └── orgs.ts                  # USERS, ORGS constants + resolveOrgId()
```

## API Routes

All API routes are Next.js Route Handlers (`route.ts`) under `src/app/api/`.

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/api/triggerWorkflowRun` | POST | Any member | Triggers and executes a workflow run end-to-end |
| `/api/approveStep` | POST | Owner | Approves a paused `approval_gate` step |
| `/api/deleteWorkflow` | POST | Owner only | Cascading delete of workflow and all associated data |
| `/api/updateWorkflow` | POST | Editor+ | Updates workflow metadata and re-syncs all steps |
| `/api/updateOrg` | POST | Owner | Updates the organization's display name |
| `/api/gql` | POST | Any (admin key) | Generic Hasura admin GraphQL proxy |

## Workflow Execution Engine

The core engine lives in `src/app/api/triggerWorkflowRun/route.ts`. It:

1. Fetches the workflow and its ordered steps from Hasura
2. Creates a `workflow_run` record in the database
3. Iterates steps sequentially, creating a `step_run` per step
4. Executes each step's handler via a `switch(step.type)` block
5. Passes each step's `output` as the next step's `input` via `context`
6. Pauses at `approval_gate` steps, recording `paused_step_id` on the run
7. Marks the run `completed` or `failed` based on final execution outcome

### Adding a New Step Type

See the root-level `README.md` for the full 5-file extensibility checklist.

## Design System

All design tokens are defined as CSS custom properties in `src/app/globals.css`:

```css
:root {
  --color-bg:      #0E0B08;  /* Page background */
  --color-surface: #1C1510;  /* Cards and panels */
  --color-primary: #CD8309;  /* Golden amber accent */
  --color-text:    #FFE5C0;  /* Cream body text */
  --color-muted:   #A89584;  /* Secondary labels */
  --color-border:  #3A2E24;  /* Subtle borders */
}
```

Reusable utility classes (`.btn-primary`, `.btn-ghost`, `.badge-completed`, etc.) are also defined in `globals.css`.
