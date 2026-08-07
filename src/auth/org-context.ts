import { cookies, headers } from "next/headers";
import { PREVIEW_COOKIE, isLocalHost } from "../lib/preview";

/**
 * Authentication adapter boundary.
 *
 * A standard auth provider integration will implement this in a later phase.
 * Route handlers must obtain an organization context through this boundary and
 * pass it to data access; they must never accept organization_id from a form.
 */
export type OrganizationRole = "owner" | "admin" | "estimator" | "viewer";

export type OrganizationContext = {
  organizationId: string;
  authSubject: string;
  role: OrganizationRole;
};

export async function requireOrganizationContext(): Promise<OrganizationContext> {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "").split(":")[0];
  const previewCookie = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (isLocalHost(host) && previewCookie === "1") {
    return { organizationId: "00000000-0000-0000-0000-000000000000", authSubject: "local-preview", role: "owner" };
  }

  const { createClient } = await import("../lib/supabase/server");
  const supabase = await createClient();
  if (!supabase) throw new Error("AUTH_PROVIDER_NOT_CONFIGURED: set Supabase public environment variables");
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;
  if (error || !subject) throw new Error("UNAUTHENTICATED: sign in is required");
  const admin = (await import("../lib/supabase/admin")).createAdminClient();
  if (!admin) throw new Error("AUTH_SERVER_NOT_CONFIGURED: set SUPABASE_SECRET_KEY for organization lookup");
  const membership = await admin.from("organization_members").select("organization_id, role").eq("auth_subject", subject).limit(1).maybeSingle();
  if (membership.error || !membership.data) throw new Error("ORGANIZATION_MEMBERSHIP_REQUIRED: no organization membership found");
  return { organizationId: membership.data.organization_id, authSubject: subject, role: membership.data.role as OrganizationRole };
}
