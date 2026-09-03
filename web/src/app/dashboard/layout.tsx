import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ORGS, resolveOrgId, USERS, type OrgId, type UserId } from "@/lib/orgs";
import { OrgProvider } from "@/contexts/OrgContext";
import TopNav from "@/components/TopNav";
import UserSwitcher from "@/components/UserSwitcher";
import OrgSwitcher from "@/components/OrgSwitcher";
import { JerryLogo } from "@/components/JerryLogo";
import { adminGql } from "@/lib/nhost";
import { GET_ORG } from "@/lib/queries";

import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

function getInitialOrgId(cookieStore: ReadonlyRequestCookies): OrgId {
  return resolveOrgId(cookieStore.get("jerry_active_org")?.value);
}

function getInitialUserId(cookieStore: ReadonlyRequestCookies): UserId {
  const val = cookieStore.get("jerry_active_user")?.value;
  return USERS.find(u => u.id === val)?.id ?? USERS[0].id;
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const initialOrgId = getInitialOrgId(cookieStore);
  const initialUserId = getInitialUserId(cookieStore);

  let liveOrgName: string | undefined;
  try {
    const orgData = await adminGql<any>(GET_ORG, { id: initialOrgId });
    if (orgData?.organizations_by_pk?.name) {
      liveOrgName = orgData.organizations_by_pk.name;
    }
  } catch (e) {
    console.error("Failed to fetch org name for layout", e);
  }

  return (
    <OrgProvider initialOrgId={initialOrgId} initialUserId={initialUserId}>
      <div className="flex min-h-screen bg-[#0E0B08]">
        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto flex flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-10 border-b border-[#3A2E24] bg-[#0E0B08]/80 backdrop-blur px-6 py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Left: Brand/Logo */}
            <div className="flex items-center gap-2.5">
              <JerryLogo />
              <span className="font-semibold text-white tracking-tight text-lg">
                Jerry<span className="text-[#CD8309]">Pay</span>
              </span>
            </div>
            
            {/* Center: TopNav tabs */}
            <TopNav />
            
            {/* Right: UserSwitcher */}
            <div className="hidden sm:block">
              <UserSwitcher />
            </div>
          </header>

          <div className="flex-1 w-full max-w-7xl mx-auto px-6 py-7">
            {children}
          </div>

          {/* Fixed OrgSwitcher */}
          <div className="fixed bottom-3 left-3 sm:bottom-5 sm:left-5 z-50 bg-[#1C1510] border border-[#3A2E24] rounded-xl shadow-xl w-64">
            <OrgSwitcher liveOrgName={liveOrgName} />
          </div>
        </main>
      </div>
    </OrgProvider>
  );
}
