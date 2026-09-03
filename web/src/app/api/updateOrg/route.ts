import { NextResponse } from "next/server";
import { adminGql } from "@/lib/nhost";

const UPDATE_ORG = `
  mutation UpdateOrg($id: uuid!, $name: String!) {
    update_organizations_by_pk(pk_columns: { id: $id }, _set: { name: $name }) {
      id
      name
    }
  }
`;

export async function POST(req: Request) {
  try {
    const { org_id, name } = await req.json();

    if (!org_id || !name) {
      return NextResponse.json({ error: "Missing org_id or name" }, { status: 400 });
    }

    const data = await adminGql<{ update_organizations_by_pk: { id: string, name: string } }>(UPDATE_ORG, { id: org_id, name });

    return NextResponse.json({ success: true, organization: data.update_organizations_by_pk });
  } catch (err: any) {
    console.error("updateOrg error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
