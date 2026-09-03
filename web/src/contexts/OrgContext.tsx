"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { 
  ORGS, DEFAULT_ORG_ID, resolveOrgId, 
  type OrgId, type OrgInfo,
  USERS, type UserId, type UserInfo
} from "@/lib/orgs";

// Re-export so existing imports from OrgContext still work
export { ORGS, DEFAULT_ORG_ID, type OrgId, type OrgInfo, USERS, type UserId, type UserInfo };

const ORG_COOKIE_KEY = "jerry_active_org";
const USER_COOKIE_KEY = "jerry_active_user";

function readOrgCookie(): OrgId {
  if (typeof document === "undefined") return DEFAULT_ORG_ID;
  const match = document.cookie.match(new RegExp(`(?:^|; )${ORG_COOKIE_KEY}=([^;]*)`));
  return match ? resolveOrgId(match[1]) : DEFAULT_ORG_ID;
}

function writeOrgCookie(id: OrgId) {
  document.cookie = `${ORG_COOKIE_KEY}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function readUserCookie(): UserId {
  if (typeof document === "undefined") return USERS[0].id;
  const match = document.cookie.match(new RegExp(`(?:^|; )${USER_COOKIE_KEY}=([^;]*)`));
  const val = match ? match[1] : null;
  return USERS.find(u => u.id === val)?.id ?? USERS[0].id;
}

function writeUserCookie(id: UserId) {
  document.cookie = `${USER_COOKIE_KEY}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

// ── Context ────────────────────────────────────────────────────────────────────
interface OrgContextValue {
  orgId: OrgId;
  org: OrgInfo;
  switchOrg: (id: OrgId) => void;
  userId: UserId;
  user: UserInfo;
  switchUser: (id: UserId) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  initialOrgId,
  initialUserId,
  children,
}: {
  initialOrgId?: OrgId;
  initialUserId?: UserId;
  children: ReactNode;
}) {
  const [orgId, setOrgId] = useState<OrgId>(() => {
    if (initialOrgId) return initialOrgId;
    return readOrgCookie();
  });

  const [userId, setUserId] = useState<UserId>(() => {
    if (initialUserId) return initialUserId;
    return readUserCookie();
  });

  const switchOrg = useCallback((id: OrgId) => {
    writeOrgCookie(id);
    setOrgId(id);
    // Hard-navigate so the Server Component re-fetches with the new org cookie
    window.location.href = "/dashboard";
  }, []);

  const switchUser = useCallback((id: UserId) => {
    writeUserCookie(id);
    setUserId(id);
    // Hard-navigate so the Server Component re-fetches with the new user cookie
    window.location.href = "/dashboard";
  }, []);

  const org = ORGS.find((o) => o.id === orgId) ?? ORGS[0];
  const user = USERS.find((u) => u.id === userId) ?? USERS[0];

  return (
    <OrgContext.Provider value={{ orgId, org, switchOrg, userId, user, switchUser }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside <OrgProvider>");
  return ctx;
}
