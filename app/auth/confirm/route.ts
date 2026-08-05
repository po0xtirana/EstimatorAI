import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "../../../src/lib/supabase/server";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/";
  const redirectUrl = new URL(next, url.origin);
  if (!tokenHash || !type) return NextResponse.redirect(new URL("/login?error=invalid_link", url.origin));
  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(new URL("/login?error=auth_not_configured", url.origin));
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(new URL("/login?error=expired_link", url.origin));
  const { data: claims } = await supabase.auth.getClaims();
  const subject = claims?.claims?.sub;
  const admin = createAdminClient();
  if (subject && admin) {
    const { data: membership } = await admin.from("organization_members").select("organization_id").eq("auth_subject", subject).limit(1).maybeSingle();
    if (!membership) return NextResponse.redirect(new URL("/onboarding/company", url.origin));
  }
  return NextResponse.redirect(redirectUrl);
}
