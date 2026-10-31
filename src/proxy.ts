import { CANDIDATE_COOKIE } from "@/lib/candidate-access";
import { candidateScope } from "@/lib/candidate-access-server";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js proxy that refreshes the Supabase auth token on every request.
 * This is the official Supabase pattern for Next.js App Router.
 */
export async function proxy(request: NextRequest) {
  // Skip cookie refresh for mobile requests using Bearer token auth
  if (process.env.AURAL_EXTERNAL_CANDIDATES !== "true" && request.headers.get("authorization")?.startsWith("Bearer ")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser(request.headers.get("authorization")?.startsWith("Bearer ") ? request.headers.get("authorization")!.slice(7) : undefined);

  if (!user) {
    const staleCookies = request.cookies
      .getAll()
      .filter((c) => c.name.startsWith("sb-"));
    for (const { name } of staleCookies) {
      supabaseResponse.cookies.delete(name);
    }
  }

  if (process.env.AURAL_EXTERNAL_CANDIDATES === "true") {
    const path = request.nextUrl.pathname;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-aural-candidate-session");
    const pageToken = /^\/i\/invite\/([A-Za-z0-9_-]{12,128})(?:\/session)?\/?$/.exec(path)?.[1];
    if (pageToken) {
      const scope = await candidateScope(pageToken);
      if (scope) supabaseResponse.cookies.set(CANDIDATE_COOKIE, pageToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 4 * 60 * 60 });
    }
    if (path.startsWith("/api/") && !user) {
      // These routes implement their own key, cron, auth or scoped tRPC checks.
      const selfAuthorized = path.startsWith("/api/v1/") || path.startsWith("/api/trpc/") || path.startsWith("/api/auth/") || path.startsWith("/api/session/video") || path === "/api/internal/video/process" || path === "/api/locale";
      if (!selfAuthorized) {
        const allowed = ["/api/voice/ticket", "/api/voice/token", "/api/voice/save", "/api/voice/tts-s2s", "/api/session/upload", "/api/session/complete", "/api/session/leave"];
        if (!allowed.includes(path)) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
        const scope = await candidateScope(request.cookies.get(CANDIDATE_COOKIE)?.value ?? request.headers.get("x-aural-video-invite"));
        if (!scope?.sessionId) return NextResponse.json({ error: "invitation_required" }, { status: 403 });
        if (!["/api/voice/ticket", "/api/voice/tts-s2s", "/api/session/upload"].includes(path)) {
          const body = await request.clone().json().catch(() => null);
          if (body?.sessionId !== scope.sessionId) return NextResponse.json({ error: "access_denied" }, { status: 403 });
        }
        requestHeaders.set("x-aural-candidate-session", scope.sessionId);
      }
    }
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    for (const cookie of supabaseResponse.cookies.getAll()) next.cookies.set(cookie);
    return next;
  }
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
