// Plain server-safe constants — no "use client" directive.
// Both Server Components and Client Components can import from here.

export const ORGS = [
  {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "Acme Corp",
    letter: "A",
    color: "indigo",
  },
  {
    id: "bbbbbbbb-0000-0000-0000-000000000001",
    name: "Beta Inc",
    letter: "B",
    color: "emerald",
  },
] as const;

export type OrgId = (typeof ORGS)[number]["id"];
export type OrgInfo = (typeof ORGS)[number];

export const DEFAULT_ORG_ID: OrgId = ORGS[0].id;

export function resolveOrgId(raw: string | undefined): OrgId {
  const found = ORGS.find((o) => o.id === raw);
  return found ? found.id : DEFAULT_ORG_ID;
}

// ─────────────────────────────────────────────────────────────────────────────
// Users (for Acting User Role Switcher)
// ─────────────────────────────────────────────────────────────────────────────

export type UserId = "11111111-0000-0000-0000-000000000001" | "22222222-0000-0000-0000-000000000001";
export type UserInfo = { id: UserId; name: string; role: "owner" | "editor"; initials: string };
export const USERS: UserInfo[] = [
  { id: "11111111-0000-0000-0000-000000000001", name: "User 1 (Owner)", role: "owner", initials: "U1" },
  { id: "22222222-0000-0000-0000-000000000001", name: "User 2 (Editor)", role: "editor", initials: "U2" },
];
