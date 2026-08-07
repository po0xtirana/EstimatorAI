import { NextResponse } from "next/server";
import { PREVIEW_COOKIE, isLocalHost } from "../../src/lib/preview";

export function GET(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/", url.origin));

  if (!isLocalHost(url.hostname)) {
    return NextResponse.redirect(new URL("/login?error=preview_local_only", url.origin));
  }

  if (url.searchParams.get("exit") === "1") {
    response.cookies.delete(PREVIEW_COOKIE);
    return response;
  }

  response.cookies.set(PREVIEW_COOKIE, "1", {
    httpOnly: false,
    maxAge: 60 * 60,
    path: "/",
    sameSite: "lax",
    secure: false
  });
  return response;
}
