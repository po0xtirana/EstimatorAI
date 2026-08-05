import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "../../../src/lib/supabase/server";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const requestedNext = url.searchParams.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const redirectUrl = new URL(next, url.origin);
  if (!code && (!tokenHash || !type)) return NextResponse.redirect(new URL("/login?error=invalid_link", url.origin));
  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(new URL("/login?error=auth_not_configured", url.origin));
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash as string });
  if (error) {
    const errorUrl = new URL("/login", url.origin);
    errorUrl.searchParams.set("error", error.message.toLowerCase().includes("expired") ? "expired_link" : "auth_callback_failed");
    return NextResponse.redirect(errorUrl);
  }
  const { data: claims } = await supabase.auth.getClaims();
  const subject = claims?.claims?.sub;
  const admin = createAdminClient();
  if (subject && admin) {
    const { data: membership } = await admin.from("organization_members").select("organization_id").eq("auth_subject", subject).limit(1).maybeSingle();
    if (!membership) return NextResponse.redirect(new URL("/onboarding/company", url.origin));
  }
  return NextResponse.redirect(redirectUrl);
}
