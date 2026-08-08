import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE, isLocalHost } from "../preview";

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      }
    }
  });
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const publicPath = path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/preview") || path.startsWith("/pricing") || path.startsWith("/api/tender-intake/") || path.startsWith("/_next");
  const localPreview = isLocalHost(request.nextUrl.hostname) && request.cookies.get(PREVIEW_COOKIE)?.value === "1";
  if (!data?.claims && !publicPath && !localPreview) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }
  return response;
}
