/**
 * Jerry — GraphQL Query Strings
 * Server-side only — used with adminGql() for dashboard data loading.
 */

// ─── Workflows ────────────────────────────────────────────────────────────────

export const GET_WORKFLOWS = `
  query GetWorkflows($orgId: uuid!) {
    workflows(
      where: { org_id: { _eq: $orgId } }
      order_by: { created_at: desc }
    ) {
      id
      name
      description
      is_active
      created_at
      workflow_triggers {
        id
        trigger_type
        is_active
      }
      workflow_runs_aggregate {
        aggregate { count }
      }
    }
  }
`;

export const GET_WORKFLOW_DETAIL = `
  query GetWorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      is_active
      created_at
      org_id
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        label
        config
      }
      workflow_triggers {
        id
        trigger_type
        config
        is_active
      }
      workflow_runs(order_by: { started_at: desc }, limit: 10) {
        id
        status
        started_at
        ended_at
        triggered_by
      }
    }
  }
`;

// ─── Workflow Runs ─────────────────────────────────────────────────────────────

export const GET_WORKFLOW_RUNS = `
  query GetWorkflowRuns($orgId: uuid!, $limit: Int!) {
    workflow_runs(
      where: { org_id: { _eq: $orgId } }
      order_by: { started_at: desc }
      limit: $limit
    ) {
      id
      status
      started_at
      ended_at
      paused_at
      metadata
      workflow_id
      paused_step_id
    }
  }
`;

export const GET_RUN_DETAIL = `
  query GetRunDetail($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      status
      started_at
      ended_at
      paused_at
      metadata
      org_id
      workflow_id
      paused_step_id
      step_runs(order_by: { created_at: asc }) {
        id
        status
        input
        output
        audit_log
        error
        attempt_count
        started_at
        ended_at
        approved_by
        approved_at
        approval_note
        workflow_step {
          id
          step_order
          type
          label
          config
        }
      }
    }
  }
`;

// ─── Organizations ─────────────────────────────────────────────────────────────

export const GET_ORG = `
  query GetOrg($id: uuid!) {
    organizations_by_pk(id: $id) {
      id
      name
      slug
      usage_allowed
      usage_count
      billing_cycle_start
    }
  }
`;

export const GET_ALL_ORGS = `
  query GetAllOrgs {
    organizations(order_by: { id: asc }) {
      id
      name
      slug
    }
  }
`;

export const GET_ORG_MEMBERS = `
  query GetOrgMembers($orgId: uuid!) {
    org_members(
      where: { org_id: { _eq: $orgId } }
      order_by: { created_at: asc }
    ) {
      id
      user_id
      role
      created_at
    }
  }
`;
