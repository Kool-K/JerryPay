import { redirect } from "next/navigation";
import { adminGql } from "@/lib/nhost";
import { GET_WORKFLOW_DETAIL } from "@/lib/queries";
import EditForm from "./EditForm";

export default async function EditWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id === "new" || !id.match(/^[0-9a-f-]{36}$/i)) {
    redirect("/dashboard/workflows/new");
  }

  const data = await adminGql<{ workflows_by_pk: any }>(
    GET_WORKFLOW_DETAIL,
    { id }
  );

  const wf = data.workflows_by_pk;
  if (!wf) {
    return (
      <div className="card p-16 text-center fade-in">
        <h1 className="text-lg font-semibold text-gray-200">Workflow not found</h1>
      </div>
    );
  }

  return <EditForm workflow={wf} />;
}
