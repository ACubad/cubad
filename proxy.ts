import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Areas that require a signed-in user (optimistic, cookie-based check only).
const PROTECTED = ["/onboarding", "/account"];
// Auth pages a signed-in user shouldn't see (recovery pages are intentionally NOT here).
const GUEST_ONLY = ["/auth/sign-in", "/auth/sign-up"];

export async function proxy(request: NextRequest) {
  // Start with a passthrough response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  // getUser() revalidates the token and triggers the cookie refresh above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Carry refreshed cookies onto any redirect we return.
  const redirectWithCookies = (pathname: string, withNext = false) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    if (withNext) url.searchParams.set("next", path);
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    return redirectWithCookies("/auth/sign-in", true);
  }
  if (user && GUEST_ONLY.includes(path)) {
    return redirectWithCookies("/account");
  }

  return response;
}

export const config = {
  // Run on everything EXCEPT api routes, Next internals, and static assets.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
