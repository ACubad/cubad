How to get a session cookie for the k6 authenticated scenarios (B and C):

1. Create or reuse a disposable test student account through the normal sign-up flow, then
   confirm its email. Never use a real student's account for load testing.
2. Log in through a real browser at $BASE_URL/auth/sign-in.
3. In browser DevTools, open Application -> Cookies. Copy every cookie whose name starts with
   "sb-". There may be two or more pieces when the auth cookie is chunked. Format them as one
   Cookie header value, for example:
   "sb-<ref>-auth-token=<value>; sb-<ref>-auth-token.0=<value>; ..."
4. Save only that Cookie header value into scripts/load/.session-cookie. The file is gitignored.
5. This is a real live session. Supabase access tokens expire (about one hour by default), and a
   cookie replayed by k6 is not refreshed like a browser session. Re-capture it before any run
   that starts after expiry or lasts longer than about one hour.

If .session-cookie is ever committed or shared, treat the test session as compromised. In the
Supabase Dashboard, sign that disposable user out of all sessions, then capture a fresh cookie.
