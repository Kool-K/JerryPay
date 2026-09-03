-- =============================================================================
-- Jerry: Multi-Tenant AI Agent Workflow Builder
-- Hasura Layer 1 & Layer 2 Permissions — Section 2
-- =============================================================================
--
-- STRATEGY:
--   Layer 1 (Database / RLS): PostgreSQL Row-Level Security enforces that
--     every row returned or mutated belongs to an org the current user is a
--     member of. This is the "blast-blast" safety net — even if Hasura
--     permission rules have a bug, the DB itself refuses cross-tenant access.
--
--   Layer 2 (Hasura Permission Rules): Fine-grained role-based rules layered
--     on top of RLS. Hasura injects `x-hasura-user-id` and `x-hasura-role`
--     (resolved via the Nhost JWT) into every session. These rules are
--     expressed below as both:
--       (a) SQL RLS policies (applied at the DB level), and
--       (b) Hasura metadata YAML comments showing the equivalent permission
--           expression to paste into the Hasura Console / metadata files.
--
-- NOTE: Run this AFTER schema.sql. Nhost creates the auth.users table; the
--       user_id references below point to that table implicitly.
-- =============================================================================

-- =============================================================================
-- 0. HASURA SESSION VARIABLE HELPERS
-- =============================================================================
-- Hasura passes session variables as PostgreSQL config parameters.
-- These two helper functions make policies readable:
--
--   jerry_current_user_id()  → UUID of the authenticated Nhost user
--   jerry_current_role()     → 'owner' | 'editor' | 'viewer'
-- =============================================================================

CREATE OR REPLACE FUNCTION jerry_current_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hasura.user.id', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION jerry_current_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hasura.user.role', true), '');
$$;

-- =============================================================================
-- 1. ENABLE ROW LEVEL SECURITY ON ALL TENANT-SCOPED TABLES
-- =============================================================================

ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_triggers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_runs          ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner (important: Hasura connects as a
-- superuser-like role; we bypass that with FORCE ROW LEVEL SECURITY).
ALTER TABLE organizations      FORCE ROW LEVEL SECURITY;
ALTER TABLE org_members        FORCE ROW LEVEL SECURITY;
ALTER TABLE workflows          FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps     FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_triggers  FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs      FORCE ROW LEVEL SECURITY;
ALTER TABLE step_runs          FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. HELPER: Org isolation sub-select
--    Returns the set of org_ids the current user is a member of.
-- =============================================================================

-- Used inline in RLS policies — avoids repeating the membership check.
CREATE OR REPLACE FUNCTION jerry_user_org_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM org_members WHERE user_id = jerry_current_user_id();
$$;

-- =============================================================================
-- 3. RLS POLICIES: organizations
-- =============================================================================

-- SELECT: see only orgs you are a member of
CREATE POLICY organizations_select
  ON organizations FOR SELECT
  USING (id IN (SELECT jerry_user_org_ids()));

-- INSERT: allowed by service role only (org creation is handled server-side)
-- Owners may not self-create orgs from the client; the backend function does it.
-- Hasura 'owner' role: no direct INSERT permission on this table.

-- UPDATE: only owners of this org can update it
CREATE POLICY organizations_update
  ON organizations FOR UPDATE
  USING (
    id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() = 'owner'
  )
  WITH CHECK (
    id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() = 'owner'
  );

-- DELETE: not allowed via client; use serverless function
CREATE POLICY organizations_delete
  ON organizations FOR DELETE
  USING (false); -- hard deny

-- =============================================================================
-- 4. RLS POLICIES: org_members
-- =============================================================================

-- SELECT: see members of your orgs
CREATE POLICY org_members_select
  ON org_members FOR SELECT
  USING (org_id IN (SELECT jerry_user_org_ids()));

-- INSERT: only owners can add members
CREATE POLICY org_members_insert
  ON org_members FOR INSERT
  WITH CHECK (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() = 'owner'
  );

-- UPDATE: only owners can change roles
CREATE POLICY org_members_update
  ON org_members FOR UPDATE
  USING (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() = 'owner'
  )
  WITH CHECK (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() = 'owner'
  );

-- DELETE: only owners can remove members (cannot remove self if sole owner — enforce in app logic)
CREATE POLICY org_members_delete
  ON org_members FOR DELETE
  USING (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() = 'owner'
  );

-- =============================================================================
-- 5. RLS POLICIES: workflows
-- =============================================================================

-- SELECT: any member of the org
CREATE POLICY workflows_select
  ON workflows FOR SELECT
  USING (org_id IN (SELECT jerry_user_org_ids()));

-- INSERT: owner or editor
CREATE POLICY workflows_insert
  ON workflows FOR INSERT
  WITH CHECK (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() IN ('owner', 'editor')
  );

-- UPDATE: owner or editor
CREATE POLICY workflows_update
  ON workflows FOR UPDATE
  USING (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() IN ('owner', 'editor')
  )
  WITH CHECK (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() IN ('owner', 'editor')
  );

-- DELETE: owner only
CREATE POLICY workflows_delete
  ON workflows FOR DELETE
  USING (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() = 'owner'
  );

-- =============================================================================
-- 6. RLS POLICIES: workflow_steps
-- =============================================================================

CREATE POLICY workflow_steps_select
  ON workflow_steps FOR SELECT
  USING (
    workflow_id IN (SELECT id FROM workflows)  -- RLS on workflows already applied
  );

CREATE POLICY workflow_steps_insert
  ON workflow_steps FOR INSERT
  WITH CHECK (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() IN ('owner', 'editor')
  );

CREATE POLICY workflow_steps_update
  ON workflow_steps FOR UPDATE
  USING (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() IN ('owner', 'editor')
  )
  WITH CHECK (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() IN ('owner', 'editor')
  );

CREATE POLICY workflow_steps_delete
  ON workflow_steps FOR DELETE
  USING (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() IN ('owner', 'editor')
  );

-- =============================================================================
-- 7. RLS POLICIES: workflow_triggers
-- =============================================================================

CREATE POLICY workflow_triggers_select
  ON workflow_triggers FOR SELECT
  USING (workflow_id IN (SELECT id FROM workflows));

CREATE POLICY workflow_triggers_insert
  ON workflow_triggers FOR INSERT
  WITH CHECK (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() IN ('owner', 'editor')
  );

CREATE POLICY workflow_triggers_update
  ON workflow_triggers FOR UPDATE
  USING (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() IN ('owner', 'editor')
  )
  WITH CHECK (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() IN ('owner', 'editor')
  );

CREATE POLICY workflow_triggers_delete
  ON workflow_triggers FOR DELETE
  USING (
    workflow_id IN (SELECT id FROM workflows)
    AND jerry_current_role() = 'owner'
  );

-- =============================================================================
-- 8. RLS POLICIES: workflow_runs
-- =============================================================================

CREATE POLICY workflow_runs_select
  ON workflow_runs FOR SELECT
  USING (org_id IN (SELECT jerry_user_org_ids()));

-- Only owner/editor can trigger runs (INSERT is done by the serverless fn
-- using an admin/service-role connection, so this policy guards direct access)
CREATE POLICY workflow_runs_insert
  ON workflow_runs FOR INSERT
  WITH CHECK (
    org_id IN (SELECT jerry_user_org_ids())
    AND jerry_current_role() IN ('owner', 'editor')
  );

-- No client-side UPDATE of runs (status changes happen in serverless fn)
CREATE POLICY workflow_runs_update
  ON workflow_runs FOR UPDATE
  USING (false);  -- hard deny; updates come from backend only

-- No client-side DELETE of runs
CREATE POLICY workflow_runs_delete
  ON workflow_runs FOR DELETE
  USING (false);

-- =============================================================================
-- 9. RLS POLICIES: step_runs
-- =============================================================================

CREATE POLICY step_runs_select
  ON step_runs FOR SELECT
  USING (
    workflow_run_id IN (SELECT id FROM workflow_runs) -- RLS on workflow_runs applied
  );

-- All mutations to step_runs come from the serverless engine (service role)
CREATE POLICY step_runs_insert
  ON step_runs FOR INSERT
  WITH CHECK (false); -- client cannot insert directly

CREATE POLICY step_runs_update
  ON step_runs FOR UPDATE
  USING (false);

CREATE POLICY step_runs_delete
  ON step_runs FOR DELETE
  USING (false);

-- =============================================================================
-- 10. HASURA METADATA PERMISSION RULES (YAML reference)
-- =============================================================================
--
-- Paste these into hasura/metadata/databases/default/tables/ YAML files
-- or apply via the Hasura Console → Data → [table] → Permissions.
--
-- The session variables referenced below are automatically injected by
-- Nhost's JWT claim mapping:
--   x-hasura-user-id  → auth.users.id
--   x-hasura-org-id   → dynamically resolved per-request (see note)
--   x-hasura-role     → org_members.role for the active org
--
-- NOTE: Nhost JWT custom claims require a Hasura Action or Auth hook to
--   embed `x-hasura-org-id` and `x-hasura-role` per org context. The RLS
--   functions above use PostgreSQL config vars set by Hasura at query time.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- workflows table permissions (YAML):
-- ─────────────────────────────────────────────────────────────────────────────
--
-- role: viewer
--   select:
--     filter:
--       org_id:
--         _in: X-Hasura-Org-Id   (single org context)
--     columns: [id, org_id, name, description, is_active, created_at, updated_at]
--
-- role: editor
--   select:   (same as viewer)
--   insert:
--     check:  { org_id: { _eq: X-Hasura-Org-Id } }
--     columns: [org_id, name, description, is_active]
--   update:
--     filter: { org_id: { _eq: X-Hasura-Org-Id } }
--     check:  { org_id: { _eq: X-Hasura-Org-Id } }
--     columns: [name, description, is_active, updated_at]
--
-- role: owner
--   select: (same as viewer)
--   insert: (same as editor)
--   update: (same as editor, all columns)
--   delete:
--     filter: { org_id: { _eq: X-Hasura-Org-Id } }
--
-- ─────────────────────────────────────────────────────────────────────────────
-- workflow_runs table permissions (YAML):
-- ─────────────────────────────────────────────────────────────────────────────
--
-- role: viewer
--   select:
--     filter: { org_id: { _eq: X-Hasura-Org-Id } }
--     columns: [id, workflow_id, org_id, status, started_at, ended_at]
--
-- role: editor
--   select: (same as viewer, all columns)
--   insert:
--     check:  { org_id: { _eq: X-Hasura-Org-Id } }
--     columns: [workflow_id, org_id, triggered_by, metadata]
--
-- role: owner
--   select/insert: (same as editor)
--   delete:
--     filter: { org_id: { _eq: X-Hasura-Org-Id } }
--
-- ─────────────────────────────────────────────────────────────────────────────
-- org_members table permissions (YAML):
-- ─────────────────────────────────────────────────────────────────────────────
--
-- role: viewer / editor
--   select:
--     filter: { org_id: { _eq: X-Hasura-Org-Id } }
--     columns: [id, user_id, org_id, role, created_at]
--   (no insert / update / delete)
--
-- role: owner
--   select: (all columns)
--   insert:
--     check:  { org_id: { _eq: X-Hasura-Org-Id } }
--     columns: [user_id, org_id, role]
--   update:
--     filter: { org_id: { _eq: X-Hasura-Org-Id } }
--     check:  { org_id: { _eq: X-Hasura-Org-Id } }
--     columns: [role]
--   delete:
--     filter:
--       _and:
--         - org_id: { _eq: X-Hasura-Org-Id }
--         - user_id: { _neq: X-Hasura-User-Id }  # prevent self-removal
-- =============================================================================
