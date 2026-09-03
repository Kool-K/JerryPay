# Jerry — Database Layer

This directory contains all PostgreSQL database definitions, seed data, and migrations for the Jerry workflow platform.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | Full schema DDL — creates all tables, indexes, constraints, and triggers |
| `seed.sql` | SQL seed for demo organizations, users, roles, and sample workflows |
| `seed.js` | Node.js seed runner — calls Hasura mutations to populate data programmatically |
| `reset_seed.sql` | Wipes all demo data and re-seeds from scratch (safe for local dev) |
| `permissions.sql` | Hasura RLS permission rules for each table and role |
| `migrations/` | Incremental schema change scripts |

## Schema Overview

### Tables

```
organizations           — Top-level tenant (org name, usage limits)
  └── org_members       — User ↔ Org membership with role (owner/editor/viewer)
  └── workflows         — Named workflow definitions per org
        └── workflow_steps    — Ordered steps (type + JSONB config)
        └── workflow_triggers — How workflows are invoked (manual/scheduled/webhook)
        └── workflow_runs     — Execution records (status, timing, pause state)
              └── step_runs   — Per-step execution record (input/output/error)
```

### Workflow Step Types (CHECK constraint)

The `workflow_steps.type` column enforces an allowlist:

```
llm_call            — AI model call (Gemini, Groq, OpenRouter)
http_request        — Outbound HTTP/webhook call
db_write            — GraphQL mutation to write to Hasura
notify              — Email or log notification
conditional_branch  — True/False execution branching
approval_gate       — Pause for human approval
whatsapp_msg        — WhatsApp message dispatch
code_transform      — Custom JavaScript data transformation
```

## Running Migrations

When adding new step types, run the migration to extend the CHECK constraint:

```bash
# Via psql:
psql $DATABASE_URL -f migrations/001_add_new_step_types.sql

# Or paste the contents into the Nhost Dashboard → SQL Editor
```

## Seeding Demo Data

```bash
# Make sure your .env.local has NHOST_GRAPHQL_URL and NHOST_ADMIN_SECRET set
node seed.js
```

This creates:
- **Alpha Corporation** org with Alice (owner), Bob (editor), Carol (viewer)
- **Beta Industries** org with Dave (owner)
- Sample workflows for testing all step types

## Resetting Demo Data

```bash
# Wipes all seeded data and re-seeds fresh
psql $DATABASE_URL -f reset_seed.sql
node seed.js
```

## Multi-Tenancy & Security

- **Row Level Security (RLS):** All tables use `FORCE ROW LEVEL SECURITY`. Every query is scoped to the user's `org_id`.
- **Role hierarchy:** `owner > editor > viewer` — enforced at both the Hasura permission layer and the Next.js API route middleware.
- **Admin access:** The `adminGql()` helper in the web layer uses the Hasura admin secret server-side only — never exposed to the client.
