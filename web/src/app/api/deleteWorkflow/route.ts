import { NextRequest, NextResponse } from "next/server";
import { adminGql } from "@/lib/nhost";
import { cookies } from "next/headers";
import { resolveOrgId, USERS } from "@/lib/orgs";

const DELETE_WORKFLOW_MUTATION = `
  mutation DeleteWorkflowCascading($id: uuid!) {
    delete_workflow_runs(where: { workflow_id: { _eq: $id } }) {
      affected_rows
    }
    delete_workflow_triggers(where: { workflow_id: { _eq: $id } }) {
      affected_rows
    }
    delete_workflow_steps(where: { workflow_id: { _eq: $id } }) {
      affected_rows
    }
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

export async function POST(req: NextRequest) {
  try {
    const { workflow_id, org_id } = await req.json();

    if (!workflow_id || !org_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Authorization check
    const jar = await cookies();
    const activeOrgId = resolveOrgId(jar.get("jerry_active_org")?.value);
    const activeUserId = jar.get("jerry_active_user")?.value || USERS[0].id;
    const activeUser = USERS.find(u => u.id === activeUserId);

    if (org_id !== activeOrgId) {
      return NextResponse.json({ error: "Unauthorized: Invalid organization context" }, { status: 403 });
    }

    if (activeUser?.role !== "owner") {
      return NextResponse.json({ error: "Unauthorized: Only owners can delete workflows" }, { status: 403 });
    }

    // Execute cascading deletion
    const result = await adminGql(DELETE_WORKFLOW_MUTATION, {
      id: workflow_id,
    });

    return NextResponse.json({ success: true, deleted_id: workflow_id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
