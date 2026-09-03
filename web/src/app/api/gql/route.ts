/**
 * /api/gql — server-side Hasura admin GraphQL proxy
 * Used by client components that need to mutate data without exposing the admin secret.
 * In production, add auth checks here before forwarding.
 */
import { NextRequest, NextResponse } from "next/server";

const GRAPHQL_URL =
  process.env.NHOST_GRAPHQL_URL ??
  `https://${process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN}.nhost.run/v1/graphql`;

export async function POST(req: NextRequest) {
  const body = await req.json();

  const upstream = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": process.env.NHOST_ADMIN_SECRET!,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = await upstream.json();
  return NextResponse.json(json, { status: upstream.status });
}
