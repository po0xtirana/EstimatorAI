import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "../../../src/lib/supabase/server";

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
  return NextResponse.redirect(error ? new URL("/login?error=expired_link", url.origin) : redirectUrl);
}
