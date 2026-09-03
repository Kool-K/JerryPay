/**
 * Jerry — Nhost Client Singleton
 * Uses the new @nhost/nhost-js v4 SDK (auto-generated, isomorphic)
 *
 * Usage:
 *   import { nhost } from "@/lib/nhost";
 *   const session = await nhost.auth.signInEmailPassword({ email, password });
 */

import { createNhostClient } from "@nhost/nhost-js";

export const nhost = createNhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN!,
  region: process.env.NEXT_PUBLIC_NHOST_REGION ?? "ap-south-1",
});

// ─── GraphQL helper (server-safe, uses admin secret when available) ───────────

const GRAPHQL_URL =
  process.env.NHOST_GRAPHQL_URL ??
  `https://${process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN}.nhost.run/v1/graphql`;

/**
 * Server-side Hasura admin GraphQL client.
 * Never call this from a Client Component — use nhost.graphql (with JWT) instead.
 */
export async function adminGql<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": process.env.NHOST_ADMIN_SECRET!,
    },
    body: JSON.stringify({ query, variables }),
    // Use Next.js cache semantics for server-side fetches
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Hasura HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `Hasura GQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }

  return json.data as T;
}
