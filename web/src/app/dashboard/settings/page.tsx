import { cookies } from "next/headers";
import { resolveOrgId } from "@/lib/orgs";
import { adminGql } from "@/lib/nhost";
import { GET_ORG, GET_ORG_MEMBERS } from "@/lib/queries";
import { Users } from "lucide-react";
import SettingsForm from "./SettingsForm";

function getInitialOrgId(cookieStore: any) {
  return resolveOrgId(cookieStore.get("jerry_active_org")?.value);
}

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const orgId = getInitialOrgId(cookieStore);

  const [orgData, membersData] = await Promise.all([
    adminGql<any>(GET_ORG, { id: orgId }),
    adminGql<any>(GET_ORG_MEMBERS, { orgId })
  ]);

  const org = orgData?.organizations_by_pk;
  const members = membersData?.org_members || [];

  if (!org) return <div>Organization not found.</div>;

  const usagePercent = Math.min(100, Math.round((org.usage_count / org.usage_allowed) * 100));

  return (
    <div className="fade-in max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#FFE5C0]">Workspace Settings</h1>
        <p className="text-sm text-[#A89584] mt-1">Manage your team and organization preferences.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-4">Organization Profile</h2>
          <SettingsForm orgId={orgId} initialName={org.name} />
        </div>

        <div className="card p-6">
          <h2 className="text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-4">Usage & Quotas</h2>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#A89584]">Monthly Workflow Runs</span>
                <span className="text-[#FFE5C0]">{org.usage_count} / {org.usage_allowed}</span>
              </div>
              <div className="w-full bg-[#0E0B08] rounded-full h-2">
                <div 
                  className="bg-[#CD8309] h-2 rounded-full shadow-[0_0_10px_rgba(205,131,9,0.5)] transition-all duration-500" 
                  style={{ width: `${usagePercent}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#A89584]">Active Team Members</span>
                <span className="text-[#FFE5C0]">{members.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[#A89584] uppercase tracking-wider mb-4">
          <Users className="w-4 h-4" /> Team Members
        </h2>
        <div className="border border-[#3A2E24] rounded-xl overflow-hidden bg-[#0E0B08]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#1C1510] border-b border-[#3A2E24]">
              <tr>
                <th className="px-4 py-3 text-[#A89584] font-medium">User ID</th>
                <th className="px-4 py-3 text-[#A89584] font-medium">Role</th>
                <th className="px-4 py-3 text-[#A89584] font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3A2E24]">
              {members.map((m: any) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 text-[#FFE5C0] font-mono text-xs">{m.user_id}</td>
                  <td className="px-4 py-3 text-[#A89584] capitalize">{m.role}</td>
                  <td className="px-4 py-3"><span className="text-emerald-400 text-xs bg-emerald-400/10 px-2 py-1 rounded-full border border-emerald-500/20">Active</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
