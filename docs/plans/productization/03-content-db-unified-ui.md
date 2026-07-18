# Phase 3 — Content in the Database, Unified UI, Sprout Cutover

> **For agentic workers:** This is phase doc `03` of the cubad productization umbrella plan.
> Read `docs/plans/productization/00-MASTER-PLAN.md` FULLY before starting a task here — its
> §3 (locked decisions, especially D4, D5, D12), §4 (schema), §5 (canonical examples), and §13
> (cutover plan) are LAW for this doc. If you are a Claude Code session, use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this
> doc task-by-task. If you are another agent, execute tasks in order and obey the master doc's
> §11 (Operating Manual) exactly. Tasks are numbered and use checkbox (`- [ ]`) steps; do them
> in order, tick each box, commit when a task says to.

**Goal:** Move cubad's content off static `content/*.json` files and onto the Postgres schema
from Phase 1, serve it through cached, drop-in-compatible server fetchers, delete the `kind`
UI fork (`HomeView`/`StudyHomeView`, `UnitView`/`StudyUnitView`) in favor of one subject-home
component and one unit-page component that render sections conditionally, retarget podcasts
and passcode-sync off the borrowed "sprout" Supabase project onto the new one, and execute the
one-time cutover so production runs entirely on the new project. When this phase ends,
`hidroloji` and `insaat-yonetimi` must look and behave byte-identically to today, but every
byte now comes from Postgres instead of the filesystem, and a future subject can be
added/edited without a redeploy.

**Architecture:** Next.js 16.2.10 (App Router) reading Postgres through
`@supabase/supabase-js` service-role server clients (`lib/supabase/server.ts`, delivered by
Phase 1), cached with Next's function-level cache (`unstable_cache` + tag-based
`revalidateTag`, see the caching design note in Task 3 — this repo does **not** enable Next 16
Cache Components, so the "previous model" caching APIs are the correct ones here, not
`"use cache"`/`cacheTag`/`cacheLife`). RLS is defense-in-depth on every table; the app's own
reads always go through the service-role key and never touch RLS.

**Tech stack:** Next.js 16.2.10 · React 19 · Tailwind 4 · TypeScript 5 ·
`@supabase/supabase-js` (Phase 1 dependency) · Vitest (Phase 1 dependency) · existing
`lib/i18n.tsx` (`Bi` strings) · existing `components/ui.tsx` primitives.

---

## Prerequisites

**Depends on:** Phase 1 (`01-foundation.md`) — new Supabase project, full schema migration
(every table in master §4 created, RLS **enabled** with **no policies** on `tracks`,
`subjects`, `track_subjects`, `units`; `public.is_admin()` already defined since it's part of
the full schema), `lib/supabase/server.ts` / `lib/supabase/browser.ts` clients,
`scripts/seed-content.mjs` already run (both subjects seeded: `hidroloji` with
`section_order = 'walkthrough'`, `insaat-yonetimi` with `section_order = 'study'`, every unit
`is_free = true` and `status = 'published'`, canonical TR/University/Undergraduate track
seeded per master §5), Vitest configured (`vitest.config.ts` + a `"test": "vitest run"` script
in `package.json`), `@supabase/supabase-js` already an npm dependency.

**Parallel-safe with:** Phase 2 (`02-auth-profiles.md`). This phase does **not** read
`cookies()`, does not check `auth.uid()`, and does not gate content on any per-user state —
every page in this phase must render correctly for a completely anonymous visitor, exactly as
the app does today. This is intentional and explicit: production today has zero accounts, and
cutover (Task 12) happens at the end of *this* phase, potentially before Phase 2 has merged.
Concretely: the RLS policies added in Task 4 grant `SELECT` to **both** `anon` and
`authenticated`, and `lib/content-db.ts` uses the service-role client (bypasses RLS
regardless), so nothing in this phase depends on Phase 2 existing. **Handoff to Phase 4:**
Phase 3's access rule is "every published, `is_free = true` unit is fully visible to
everyone" (true of all seeded content today — nothing is gated yet). Phase 4 is what
introduces the real rule `is_free OR has_subject_access(...)` at the *application* level
(paywalls, sign-in walls); the `get_unit_content` RPC added in Task 4 already has the
`is_free OR is_admin()` shape and a comment marking exactly where Phase 4 adds
`OR has_subject_access(...)` — do not fork that function, extend it in place.

**Before writing ANY code in this phase, read (this is repo policy, see `AGENTS.md` — Next 16
is newer than your training data):**

- `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` and `09-revalidating.md`
  (Cache Components model — read for contrast, this repo does not use it)
- `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` (**this is
  the model this repo actually runs under** — confirmed by `cat cubad/next.config.ts`, which
  has no `cacheComponents: true`)
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-static-params.md`
  (needed for the Task 9 decision to drop `generateStaticParams`)

**Required reading in this repo** (so you understand what you're replacing, byte for byte):
`lib/content.ts`, `lib/types.ts`, `app/s/[subject]/page.tsx`,
`app/s/[subject]/unit/[slug]/page.tsx`, `app/s/[subject]/unit/[slug]/quiz/page.tsx`,
`app/s/[subject]/unit/[slug]/cards/page.tsx`, `app/s/[subject]/unit/[slug]/practice/page.tsx`,
`app/s/[subject]/q/[id]/page.tsx`, `app/s/[subject]/formulas/page.tsx`,
`components/HomeView.tsx`, `components/StudyHomeView.tsx`, `components/UnitView.tsx`,
`components/StudyUnitView.tsx`, `components/PodcastCard.tsx`, `components/ui.tsx`,
`app/page.tsx`, `components/SubjectPicker.tsx`, `app/api/podcast/route.ts`,
`app/api/sync/route.ts`, `lib/sync.ts`, `scripts/validate-content.mjs`, `docs/DESIGN.md`.

**Phase 1 contract (bound by master §14 "Post-audit contract registry"):**
`lib/supabase/server.ts` exports `createServiceRoleClient(): SupabaseClient` (server-only,
reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
`auth: { persistSession: false }`). Per §14 this is the canonical — and only — service-role
factory name (there is no `lib/supabase/admin.ts` and no other variant); every code sample in
this doc imports exactly this name. If a checkout somehow disagrees, the checkout is wrong —
fix it to match §14, do not rename the imports here.

**Env vars this phase reads (all per master §D15 except `REVALIDATE_SECRET`, new in this
phase):** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never
`NEXT_PUBLIC_*`), `GEMINI_API_KEY` (unchanged), `NEXT_PUBLIC_APP_URL`, `REVALIDATE_SECRET`
(new — a long random string, e.g. `openssl rand -hex 32`). The sprout migration script
(Task 10) additionally reads `SPROUT_URL` + `SPROUT_SERVICE_KEY`, which must **never** be set
in Vercel — that script runs locally, once.

---

## Task 0 — Branch, recon, sanity checks

- [ ] Create the phase branch: `git checkout -b feat/phase-3-content-db-unified-ui` (from
      whatever branch Phase 1's migrations landed on).
- [ ] Verify Phase 1's artifacts actually exist before proceeding:
  ```bash
  ls supabase/migrations/          # expect at least one *_schema*.sql file
  cat lib/supabase/server.ts       # note the actual exported function name
  grep -n '"@supabase/supabase-js"' package.json
  grep -n '"vitest"' package.json
  ```
  If any of these is missing, STOP — Phase 1 is a hard dependency, not something to
  improvise around. Write the gap in this doc's `## Changelog / deviations` section and
  surface it; do not invent a schema or a client here.
- [ ] Confirm today's baseline still builds before you touch anything:
  ```bash
  npm run lint
  npm run build
  ```
  Expected: both exit 0. This is your "it was clean before I started" checkpoint.

**Commit:** none (no files changed yet).

---

## Task 1 — `lib/types.ts`: add `section_order`, deprecate `kind`

Master D5: *"`SubjectMeta.kind` survives temporarily as a section-ORDER hint, then is deleted
from `subjects.json`-derived data."* The DB column is named `section_order` (master §4); the
in-repo fixture `content/subjects.json` still says `kind`. We add `section_order` as the field
every runtime consumer uses from now on, and keep `kind` only so `lib/content.ts`'s fixture
mapping doesn't need a JSON rewrite.

- [ ] Open `lib/types.ts`. Find:
  ```ts
  export interface SubjectMeta {
    slug: string;
    kind: "walkthrough" | "study";
    title: Bi;
    tagline: Bi;
  }
  ```
  Replace with:
  ```ts
  export interface SubjectMeta {
    slug: string;
    /**
     * @deprecated use `section_order` instead. Kept only so `lib/content.ts`'s fixture
     * mapping (content/subjects.json still has a `kind` key) type-checks without a data
     * rewrite. Never branch UI on this field — see
     * docs/plans/productization/03-content-db-unified-ui.md D5.
     */
    kind: "walkthrough" | "study";
    /** 'walkthrough' = questions-first section order; 'study' = podcast/notes-first. */
    section_order: "walkthrough" | "study";
    title: Bi;
    tagline: Bi;
  }
  ```
- [ ] `npm run lint` — expect it to now flag every existing `.kind` read site as unused-once
      you finish Task 9 (it will NOT flag anything yet, since `content.ts`/`content-db.ts`
      haven't been updated — that's fine, this task only changes the type).

**Commit:** `git add lib/types.ts && git commit -m "phase-3: add SubjectMeta.section_order, deprecate kind"`

**Failure modes:** If TypeScript complains that `content/subjects.json`-derived objects are
missing `section_order`, that's `lib/content.ts` not yet updated — that's Task 2, don't fix it
here.

---

## Task 2 — `lib/content.ts`: deprecation banner + `section_order` mirroring

`lib/content.ts` stays in the repo as the fixture/test data source (master D4: *"Static
`content/*.json` becomes the seed data and remains in-repo as fixtures"*) — it is **not**
deleted. It must, however, stop being imported by any runtime page after Task 9.

- [ ] Open `lib/content.ts`. Add a banner comment at the very top, before the imports:
  ```ts
  // DEPRECATED FOR RUNTIME USE. Kept only as (a) the fixture data source for tests and
  // (b) the historical input to scripts/seed-content.mjs (Phase 1). Every page/route must
  // import from lib/content-db.ts instead — see
  // docs/plans/productization/03-content-db-unified-ui.md task 3. Do not add new callers of
  // this module.
  ```
- [ ] Update `getSubjects` so its output type-checks against the now-stricter `SubjectMeta`
      (adds `section_order`, mirrored from the fixture's `kind`):
  ```ts
  export function getSubjects(): SubjectMeta[] {
    if (subjectsCache) return subjectsCache;
    if (!fs.existsSync(SUBJECTS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(SUBJECTS_FILE, "utf-8")) as Omit<
      SubjectMeta,
      "section_order"
    >[];
    subjectsCache = raw.map((s) => ({ ...s, section_order: s.kind }));
    return subjectsCache;
  }
  ```
  Everything else in the file (`getSubject`, `getUnits`, `getUnit`, `getQuestion`,
  `getQuestionOrder`) is unchanged.
- [ ] `npm run lint` — expect 0 errors.

**Commit:** `git add lib/content.ts && git commit -m "phase-3: deprecate lib/content.ts for runtime use, mirror section_order"`

**Failure modes:** Do NOT edit `content/subjects.json` in this task — the `kind` key stays as
authored; `section_order` is derived in code, not in the fixture file.

---

## Task 3 — `lib/content-db.ts`: the DB-backed content read layer

This is the drop-in replacement for `lib/content.ts` that every page will use from Task 9
onward. Same exported names, same parameter lists, same return *shapes* — the one deliberate
deviation from a byte-for-byte drop-in is that every function is now `async` (network I/O to
Postgres cannot be synchronous; callers `await` instead of calling directly).

**Caching design decision (read before copying the code):** This repo's `next.config.ts` does
**not** set `cacheComponents: true` (verified — see Task 0). That means the Next 16 "Cache
Components" model (`"use cache"` directive, `cacheTag`, `cacheLife`) is **not available**
here — per `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`: *"If you're
not using Cache Components, see the Caching and Revalidating (Previous Model) guide."* We
therefore use that previous-model API, documented in
`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`:
`unstable_cache(fn, keyParts, { tags, revalidate })` plus `revalidateTag`. Two-arg
`revalidateTag(tag, 'max')` is the required form in this Next version — verified against
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md` (the
single-argument form is deprecated) and the installed type declaration
(`node_modules/next/dist/server/web/spec-extension/revalidate.d.ts`:
`revalidateTag(tag: string, profile: string | CacheLifeConfig): undefined` — the second
argument is required, so a one-arg call is a TS2554 build error under this repo's strict
tsconfig). `unstable_cache`'s own doc
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`) notes
it has been "replaced by `use cache`" — we are deliberately NOT flipping `cacheComponents` on
in this phase, because that flag changes the rendering model for the *entire app*, including
routes this phase doesn't touch (`/api/tutor`, the auth pages Phase 2 is adding, `/api/sync`)
that would each need a Suspense-boundary audit for `cookies()`/`headers()` usage they don't
have today. That audit is out of scope here; flag it as a candidate for Phase 7 (hardening),
not Phase 3.

- [ ] `npm install server-only` (idempotent if Phase 1 already added it — check
      `grep '"server-only"' package.json` first; skip the install if present).
- [ ] Create `lib/content-db.ts`:
  ```ts
  // lib/content-db.ts
  //
  // DB-backed drop-in for lib/content.ts. Every exported function has the same name and the
  // same parameters as its lib/content.ts counterpart; every function is now async (network
  // I/O cannot be synchronous — the one deliberate deviation from a byte-for-byte drop-in).
  //
  // CACHING MODEL: this repo does NOT set `cacheComponents: true` in next.config.ts, so the
  // Next 16 "use cache" / cacheTag / cacheLife APIs are not available here (they require
  // Cache Components — see node_modules/next/dist/docs/01-app/getting-started/08-caching.md).
  // We use the *previous-model* API instead (see
  // node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md):
  // `unstable_cache` + `revalidateTag`. Two-arg `revalidateTag(tag, "max")` is the required
  // form in this Next version — verified against node_modules/next/dist/docs revalidateTag.md
  // and the installed .d.ts (the second argument is mandatory; single-arg is deprecated and a
  // TS2554 build error). See task 3 of
  // docs/plans/productization/03-content-db-unified-ui.md for the full rationale.
  //
  // TAGS: a subject's cached unit list carries BOTH its own tag (`content:<slug>`) and the
  // shared list tag (`content:list`). Calling `revalidateTag('content:list', 'max')`
  // therefore also invalidates every subject's units cache in one call (used by bulk
  // operations like the seed script); `revalidateTag('content:<slug>', 'max')` invalidates
  // just one subject (scripts/upsert-unit.mjs, after a single-unit publish).
  //
  // ACCESS MODEL: every read here uses the SERVICE ROLE client (bypasses RLS entirely) and
  // returns whatever is `status = 'published'` — no is_free/entitlement check. That is
  // deliberate and matches today's live behavior exactly: every seeded unit is
  // `is_free = true` and nothing is gated yet, so hidroloji/insaat-yonetimi keep rendering
  // byte-equivalent to before this phase. Phase 4 adds a user-aware gate INSIDE the page
  // components once entitlements exist — this module's contract stays "return whatever is
  // published," identical to what lib/content.ts already did.

  import "server-only";
  import { unstable_cache, revalidateTag } from "next/cache";
  import { createServiceRoleClient } from "@/lib/supabase/server";
  import type { Question, SubjectMeta, Unit } from "./types";

  const LIST_TAG = "content:list";
  const subjectTag = (slug: string) => `content:${slug}`;

  interface SubjectRow {
    slug: string;
    title: { tr: string; en: string };
    tagline: { tr: string; en: string };
    section_order: "walkthrough" | "study";
  }

  interface UnitRow {
    content: Unit;
  }

  export function toSubjectMeta(row: SubjectRow): SubjectMeta {
    return {
      slug: row.slug,
      title: row.title,
      tagline: row.tagline,
      section_order: row.section_order,
      kind: row.section_order, // deprecated alias — see lib/types.ts
    };
  }

  /** `units.content` IS the full Unit shape (lib/types.ts) — trust it verbatim. */
  export function toUnit(row: UnitRow): Unit {
    return row.content;
  }

  const fetchSubjects = unstable_cache(
    async (): Promise<SubjectMeta[]> => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("subjects")
        .select("slug, title, tagline, section_order")
        .eq("status", "published")
        .order("sort", { ascending: true });
      if (error) throw new Error(`getSubjects: ${error.message}`);
      return (data ?? []).map(toSubjectMeta);
    },
    ["content-db:subjects:v1"],
    { tags: [LIST_TAG], revalidate: false }
  );

  export async function getSubjects(): Promise<SubjectMeta[]> {
    return fetchSubjects();
  }

  export async function getSubject(slug: string): Promise<SubjectMeta | undefined> {
    const subjects = await getSubjects();
    return subjects.find((s) => s.slug === slug);
  }

  /**
   * `unstable_cache` is (re)created on every call, keyed by `subject` — this mirrors the
   * pattern in Next's own docs (unstable_cache.md's example wraps the cached fn *inside* the
   * exported function, keyed on the dynamic id, and invokes it immediately). Recreating the
   * wrapper does not defeat caching: Next keys the persisted entry off `keyParts` + arguments,
   * not JS closure identity.
   */
  export async function getUnits(subject: string): Promise<Unit[]> {
    const run = unstable_cache(
      async (): Promise<Unit[]> => {
        const supabase = createServiceRoleClient();
        const { data: subjectRow, error: subjectError } = await supabase
          .from("subjects")
          .select("id")
          .eq("slug", subject)
          .eq("status", "published")
          .maybeSingle();
        if (subjectError) throw new Error(`getUnits(${subject}): ${subjectError.message}`);
        if (!subjectRow) return [];

        const { data, error } = await supabase
          .from("units")
          .select("content")
          .eq("subject_id", subjectRow.id)
          .eq("status", "published")
          .order("unit_number", { ascending: true });
        if (error) throw new Error(`getUnits(${subject}): ${error.message}`);
        return (data ?? []).map(toUnit);
      },
      ["content-db:units:v1", subject],
      { tags: [subjectTag(subject), LIST_TAG], revalidate: false }
    );
    return run();
  }

  export async function getUnit(subject: string, slug: string): Promise<Unit | undefined> {
    const units = await getUnits(subject);
    return units.find((u) => u.slug === slug);
  }

  export async function getQuestion(
    subject: string,
    id: string
  ): Promise<{ unit: Unit; question: Question; index: number } | undefined> {
    for (const unit of await getUnits(subject)) {
      const index = (unit.questions ?? []).findIndex((q) => q.id === id);
      if (index >= 0) return { unit, question: unit.questions![index], index };
    }
    return undefined;
  }

  /** Flat ordered list of all question ids, for prev/next navigation. */
  export async function getQuestionOrder(
    subject: string
  ): Promise<{ id: string; unitSlug: string }[]> {
    const units = await getUnits(subject);
    return units.flatMap((u) => (u.questions ?? []).map((q) => ({ id: q.id, unitSlug: u.slug })));
  }

  /**
   * Call after any content mutation (scripts/upsert-unit.mjs, the seed script, the future
   * admin dashboard). Pass a subject slug to invalidate just that subject's units cache; call
   * with no argument to invalidate the subjects list AND every subject's units (they all carry
   * `content:list` too — see the tag design note above).
   */
  export function revalidateContent(subjectSlug?: string): void {
    // "max" = stale-while-revalidate (the recommended profile; the 2nd argument is required
    // in this Next version — see the CACHING MODEL note above).
    revalidateTag(subjectSlug ? subjectTag(subjectSlug) : LIST_TAG, "max");
  }
  ```
- [ ] `npm run lint && npm run build` — expect both to pass. (Nothing imports this file yet,
      so the build should be unaffected; this step just confirms the new file itself
      compiles.)

**Manual verification:**
1. `node -e "require('ts-node/register'); "` is unnecessary — instead run
   `npx tsc --noEmit` and confirm no new errors reference `lib/content-db.ts`.
2. Grep for any accidental client-side import: `grep -rn "from \"@/lib/content-db\"" components/`
   should show **zero** matches after Task 9 too — every consumer is a Server Component
   (a route `page.tsx`), never a `"use client"` file. If you ever see one, the `"server-only"`
   import will make `next build` fail loudly — that's the guardrail working, not a bug to
   work around.

**Failure modes:**
- **`revalidateTag` no-op pitfall:** if you ever change the tag literals in this file (e.g.
  rename `content:list` to something else) without updating every `revalidateContent` caller
  and the migration/seed scripts that reference the same string, revalidation silently stops
  working — there is no compiler check tying a string tag to its uses. Grep for the literal
  string `"content:` across the repo before renaming anything here.
- **RSC/client boundary:** if a `"use client"` component ever imports `lib/content-db.ts`
  directly (instead of receiving data as props from a Server Component), `next build` fails
  with an `import "server-only"` error — this is correct behavior, not a regression; fix the
  component to receive props instead.
- **Stale cache after a schema change:** `revalidate: false` means "cache forever until a tag
  is revalidated." If you add a new column to `units`/`subjects` and forget to bump anything,
  existing cached entries keep returning the OLD shape until `revalidateContent()` is called —
  always call the revalidate route (Task 11) after any manual DB edit during development.

**Commit:** `git add lib/content-db.ts package.json package-lock.json && git commit -m "phase-3: add lib/content-db.ts, the DB-backed content read layer"`

---

## Task 4 — Migration: catalog read policies + content-gating RPCs

Phase 1 already ran `alter table ... enable row level security` on `tracks`, `subjects`,
`track_subjects`, `units` with **no policies** — right now every role except `service_role`
gets zero rows from all four tables. This migration adds the missing `SELECT` policies.

**Mechanism decision (master task instruction: "column-split view vs RPC — decide"):** Row
Level Security is row-grained, not column-grained — a policy can make a whole row visible or
invisible, never "visible but redact one column." We need exactly that for `units`: metadata
(slug/title/tagline/is_free) about a **locked** unit must stay visible (so a catalog page can
render "🔒 Unit 7 — locked" instead of silently omitting it), while its `content` jsonb
(concept/questions/notes/flashcards/practice/quiz) must not. A plain view's row-security
behavior depends on Postgres's `security_invoker` setting for views, which is easy to get
backwards (get it wrong either direction and you either leak locked content or hide all
metadata) and hard to verify by reading the DDL alone. **We use the RPC approach instead: two
`SECURITY DEFINER` functions.** `SECURITY DEFINER` semantics are unambiguous and
well-documented — the function body always runs with the function *owner's* privileges
(typically the migration-applying role, which also owns the tables and therefore bypasses
their RLS by default, since Phase 1 did not set `FORCE ROW LEVEL SECURITY`). So:
- `list_units_meta(subject_slug)` → metadata only, every published unit regardless of
  `is_free`.
- `get_unit_content(subject_slug, unit_slug)` → the full `content` jsonb, gated by
  `is_free OR is_admin()` (Phase 4 extends this exact function, see the comment inside it).

`tracks`/`subjects`/`track_subjects` have no sensitive columns to hide — a straightforward row
policy is correct and sufficient for them.

**cubad's own server code never calls either RPC** — `lib/content-db.ts` uses the service-role
client and reads `units` directly, bypassing RLS entirely. Everything in this migration is
defense-in-depth for anyone who hits PostgREST/RPC directly with the `anon` or `authenticated`
key (a future public API, a mobile client, or someone poking the REST endpoint) — it is not on
cubad's actual render path in this phase.

- [ ] Create the migration file via the CLI (master §14 convention: always
      `npx supabase migration new <name>`; never hand-write sequence-numbered prefixes like
      `0003_...` — they sort lexicographically BEFORE Phase 1's timestamped migrations, so
      `supabase db reset` would run these policies before the tables exist and fail with
      "relation does not exist"):
  ```bash
  npx supabase migration new content_read_policies
  ```
  This creates `supabase/migrations/<timestamp>_content_read_policies.sql` (referred to by
  name below — the timestamp prefix is whatever the CLI generated).
- [ ] Paste the following into the new `*_content_read_policies.sql` file:
  ```sql
  -- Phase 3: read-side RLS for the catalog + two SECURITY DEFINER functions for unit content.
  -- See docs/plans/productization/03-content-db-unified-ui.md task 4 for the full mechanism
  -- rationale (column-split via RPC, not a view — RLS cannot redact a single jsonb column).

  -- Preflight: fail loudly, not silently, if Phase 1 didn't ship is_admin() yet.
  do $$
  begin
    perform public.is_admin();
  exception when undefined_function then
    raise exception 'public.is_admin() is missing — apply Phase 1''s schema migration (profiles + is_admin()) first, then re-run this migration';
  end $$;

  -- ---------- tracks: plain row policies (nothing sensitive to hide column-wise) ----------
  create policy tracks_select_published on public.tracks
    for select to anon, authenticated
    using (status = 'published');

  create policy tracks_select_admin on public.tracks
    for select to authenticated
    using (public.is_admin());

  -- ---------- subjects ----------
  create policy subjects_select_published on public.subjects
    for select to anon, authenticated
    using (status = 'published');

  create policy subjects_select_admin on public.subjects
    for select to authenticated
    using (public.is_admin());

  -- ---------- track_subjects ----------
  create policy track_subjects_select_published on public.track_subjects
    for select to anon, authenticated
    using (
      exists (select 1 from public.tracks t where t.id = track_subjects.track_id and t.status = 'published')
      and exists (select 1 from public.subjects s where s.id = track_subjects.subject_id and s.status = 'published')
    );

  create policy track_subjects_select_admin on public.track_subjects
    for select to authenticated
    using (public.is_admin());

  -- ---------- units (base table): admin only. Everyone else goes through the two functions below. ----------
  create policy units_select_admin on public.units
    for select to authenticated
    using (public.is_admin());

  -- ---------- list_units_meta: catalog-safe projection, visible regardless of is_free ----------
  create or replace function public.list_units_meta(p_subject_slug text)
  returns table (
    unit_number int,
    slug        text,
    is_free     boolean,
    title       jsonb,
    tagline     jsonb,
    version     int,
    updated_at  timestamptz
  )
  language sql
  security definer
  set search_path = public
  stable
  as $$
    select
      u.unit_number,
      u.slug,
      u.is_free,
      u.content -> 'title'   as title,
      u.content -> 'tagline' as tagline,
      u.version,
      u.updated_at
    from public.units u
    join public.subjects s on s.id = u.subject_id
    where s.slug = p_subject_slug
      and u.status = 'published'
      and s.status = 'published'
    order by u.unit_number;
  $$;

  revoke all on function public.list_units_meta(text) from public;
  grant execute on function public.list_units_meta(text) to anon, authenticated;

  -- ---------- get_unit_content: the ONLY path to the full unit JSON for non-admin callers ----------
  create or replace function public.get_unit_content(p_subject_slug text, p_unit_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_content jsonb;
    v_is_free boolean;
  begin
    select u.content, u.is_free
      into v_content, v_is_free
    from public.units u
    join public.subjects s on s.id = u.subject_id
    where s.slug = p_subject_slug
      and u.slug = p_unit_slug
      and u.status = 'published'
      and s.status = 'published';

    if v_content is null then
      return null; -- not found, or not published
    end if;

    -- Phase 4 replaces the next line with:
    --   if v_is_free or public.is_admin() or public.has_subject_access(<subject_id>) then
    if v_is_free or public.is_admin() then
      return v_content;
    end if;

    return null; -- exists, but locked for this caller — never raise (that leaks existence via error timing)
  end;
  $$;

  revoke all on function public.get_unit_content(text, text) from public;
  grant execute on function public.get_unit_content(text, text) to anon, authenticated;
  ```
- [ ] Apply it: `supabase db push` (or the MCP `apply_migration` tool if you're using it — pass
      this file's contents verbatim as the migration body, name
      `content_read_policies`).
- [ ] Confirm it applied cleanly on a fresh database too:
  `supabase db reset` (local) → expect it to succeed with no errors, all migrations
  (Phase 1's + this one) replaying in order.

**Manual verification:**
1. `supabase db diff` (or check the dashboard's Database → Policies page) — expect to see 7
   new policies (`tracks_select_published`, `tracks_select_admin`, `subjects_select_published`,
   `subjects_select_admin`, `track_subjects_select_published`, `track_subjects_select_admin`,
   `units_select_admin`) and 2 new functions (`list_units_meta`, `get_unit_content`).
2. In the Supabase SQL editor, run `select public.get_unit_content('hidroloji', 'unit-1');` as
   the default (service-role/postgres) connection — expect the full unit JSON back (since
   `is_free = true` for every seeded unit today, this works even without the `is_admin()`
   branch).
3. Run Task 14's SQL probe script (`supabase/tests/probe-content-access.sql`) now, even though
   it's introduced later in this doc — it's the real verification for this task's negative
   paths (anon cannot read a *locked* unit's content, but can read its metadata and any *free*
   unit's content).

**Failure modes:**
- **Preflight failure (`is_admin()` missing):** means Phase 1's schema migration hasn't been
  applied to this database yet, or was applied incompletely. Do not define `is_admin()` here —
  it is Phase 1's function; coordinate instead of forking it.
- **`security definer` + `search_path`:** always pin `set search_path = public` on
  `SECURITY DEFINER` functions (done above) — omitting it is a real, exploitable privilege-
  escalation vector if an attacker can get a malicious `public` schema object created ahead of
  this function in another connection's search path. Do not remove this line.
- **RLS "0 rows for everyone" surprise:** if you query `select * from units;` directly (not
  through the RPCs) as `anon`/`authenticated`, you'll get **0 rows**, by design — this is
  correct, not a bug. Only `list_units_meta`/`get_unit_content`/the service-role client can see
  unit data as those roles.

---

## Task 5 — Migration: `podcasts` storage bucket

- [ ] Create the migration file via the CLI (master §14 convention, same as Task 4 — never a
      hand-numbered prefix):
  ```bash
  npx supabase migration new podcasts_storage
  ```
- [ ] Paste the following into the new `*_podcasts_storage.sql` file:
  ```sql
  -- New project's `podcasts` bucket: public read (so <audio src> streams directly from
  -- Supabase's CDN URL, same as sprout today), writes restricted to the service role only —
  -- this closes the "anon-role writes" hole sprout has (00-MASTER-PLAN.md §10 risk table).
  -- storage.objects has RLS enabled by default in every Supabase project.

  insert into storage.buckets (id, name, public)
  values ('podcasts', 'podcasts', true)
  on conflict (id) do nothing;

  create policy podcasts_public_read on storage.objects
    for select to public
    using (bucket_id = 'podcasts');

  -- Deliberately NO insert/update/delete policy for anon or authenticated: with RLS enabled
  -- and no matching policy, those operations are denied by default. Only the service_role key
  -- (used exclusively by app/api/podcast/route.ts, server-side) can write — service_role
  -- bypasses RLS.
  ```
- [ ] Apply it the same way as Task 4 (`supabase db push` / MCP `apply_migration`).

**Manual verification:** In the Supabase dashboard → Storage, confirm a `podcasts` bucket
exists, is marked Public, and its Policies tab shows exactly one policy (`podcasts_public_read`,
SELECT, `public`). Try (from a scratch script or `curl`) an anonymous
`POST .../storage/v1/object/podcasts/test.txt` with the **anon** key — expect `403`.

**Failure modes:** If the bucket already exists (e.g. someone created it by hand in the
dashboard), the `on conflict (id) do nothing` makes this migration idempotent — don't remove
that clause.

**Commit (Tasks 4 + 5 together):**
`git add supabase/migrations/*_content_read_policies.sql supabase/migrations/*_podcasts_storage.sql && git commit -m "phase-3: add catalog read policies, content-gating RPCs, podcasts bucket"`

---

## Task 6 — `/api/podcast`: retarget to the new project, service-role writes

Same write path (`<subject>/<unit>/<lang>.wav|.json`), same request/response contract
(`PodcastCard.tsx` is untouched by this task), only the storage client and env vars change —
and per master D15 ("no more raw REST fetches sprinkled in routes"), storage access now goes
through the shared `@supabase/supabase-js` client instead of hand-rolled `fetch` calls.

- [ ] Replace the entire contents of `app/api/podcast/route.ts` with:
  ```ts
  import { getUnit } from "@/lib/content-db";
  import { createServiceRoleClient } from "@/lib/supabase/server";
  import type { NoteSection } from "@/lib/types";

  export const maxDuration = 300;

  interface PodcastLine {
    s: "Deniz" | "Mert";
    t: string;
  }

  interface PodcastBody {
    subject: string;
    unitSlug: string;
    lang: "tr" | "en";
    userKey?: string;
    force?: boolean;
  }

  /* ---------- cloud storage: Supabase Storage, new project, "podcasts" bucket ---------- */

  const BUCKET = "podcasts";
  const hasStorage = () =>
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  const audioPath = (subject: string, unitSlug: string, lang: string) =>
    `${subject}/${unitSlug}/${lang}.wav`;
  const scriptPath = (subject: string, unitSlug: string, lang: string) =>
    `${subject}/${unitSlug}/${lang}.json`;

  /** Returns the public URL if the object exists in the bucket, else null. */
  async function storedUrl(path: string): Promise<string | null> {
    if (!hasStorage()) return null;
    const supabase = createServiceRoleClient();
    const dir = path.split("/").slice(0, -1).join("/");
    const filename = path.split("/").pop()!;
    const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: filename });
    if (error || !data?.some((f) => f.name === filename)) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function storeObject(
    path: string,
    body: Buffer | string,
    contentType: string
  ): Promise<string | null> {
    if (!hasStorage()) return null;
    const supabase = createServiceRoleClient();
    const payload = typeof body === "string" ? body : new Uint8Array(body);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, payload, { contentType, upsert: true });
    if (error) {
      console.error("supabase upload failed", error.message);
      return null;
    }
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /**
   * GET without params: capability report.
   * GET ?subject=...&unit=...: capability + per-language stored podcast URLs, so every
   * device sees the same library.
   */
  export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject");
    const unitSlug = searchParams.get("unit");
    const base = { gemini: Boolean(process.env.GEMINI_API_KEY), storage: hasStorage() };

    if (!subject || !unitSlug || !hasStorage()) {
      return Response.json({ ...base, tr: null, en: null });
    }

    const [trAudio, enAudio, trScript, enScript] = await Promise.all([
      storedUrl(audioPath(subject, unitSlug, "tr")),
      storedUrl(audioPath(subject, unitSlug, "en")),
      storedUrl(scriptPath(subject, unitSlug, "tr")),
      storedUrl(scriptPath(subject, unitSlug, "en")),
    ]);

    return Response.json({
      ...base,
      tr: trAudio ? { audio: trAudio, script: trScript } : null,
      en: enAudio ? { audio: enAudio, script: enScript } : null,
    });
  }

  /** Strip the most common markdown syntax down to plain readable text. */
  function stripMarkdown(md: string): string {
    return md
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\$\$?([^$]*)\$\$?/g, "$1")
      .replace(/\|/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function buildNotesDigest(notes: NoteSection[], lang: "tr" | "en"): string {
    const parts: string[] = [];
    let wordCount = 0;
    const CAP = 6000;
    for (const n of notes) {
      const title = n.title[lang] || n.title.en || n.title.tr;
      const body = stripMarkdown(n.body[lang] || n.body.en || n.body.tr);
      const section = `## ${title}\n${body}`;
      const words = section.split(/\s+/).filter(Boolean);
      if (wordCount + words.length > CAP) {
        const remaining = CAP - wordCount;
        if (remaining > 0) parts.push(words.slice(0, remaining).join(" "));
        break;
      }
      parts.push(section);
      wordCount += words.length;
    }
    return parts.join("\n\n");
  }

  function scriptSystemPrompt(lang: "tr" | "en", digest: string): string {
    const langName = lang === "tr" ? "Turkish" : "English";
    return `You are writing a script for a 4-6 minute exam-prep podcast in ${langName}, in the "cubad" exam-prep app.
  Two friendly hosts, "Deniz" and "Mert", talk through the lesson notes below like a study podcast.

  Rules:
  - Simple, warm, conversational words. Short sentences. Explain jargon the moment it appears.
  - Cover EVERY note section below, in order, so nothing is skipped.
  - Partway through, have the hosts quiz each other on the 3 trickiest points from the notes.
  - End with a rapid-fire 5-item recap ("hızlı tekrar" / "rapid recap").
  - Output STRICT JSON ONLY, matching exactly this shape, no markdown fences, no extra keys:
  {"lines":[{"s":"Deniz","t":"..."},{"s":"Mert","t":"..."}]}
  - "s" must be exactly "Deniz" or "Mert". "t" is what that host says (one turn).

  LESSON NOTES:
  ${digest}`;
  }

  async function generateScript(
    key: string,
    lang: "tr" | "en",
    digest: string
  ): Promise<PodcastLine[] | null> {
    const payload = {
      contents: [{ role: "user", parts: [{ text: scriptSystemPrompt(lang, digest) }] }],
      generationConfig: {
        temperature: 0.6,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const tryOnce = async (): Promise<PodcastLine[] | null> => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      try {
        const parsed = JSON.parse(text) as { lines?: PodcastLine[] };
        if (
          Array.isArray(parsed.lines) &&
          parsed.lines.every(
            (l) => (l.s === "Deniz" || l.s === "Mert") && typeof l.t === "string" && l.t.trim()
          )
        ) {
          return parsed.lines;
        }
      } catch {
        /* fall through to retry */
      }
      return null;
    };

    const first = await tryOnce();
    if (first) return first;
    return await tryOnce();
  }

  function wrapWav(pcm: Buffer, sampleRate = 24000, bitsPerSample = 16, numChannels = 1): Buffer {
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
  }

  async function generateAudio(key: string, lines: PodcastLine[]): Promise<Buffer | null> {
    const conversation = lines.map((l) => `${l.s}: ${l.t}`).join("\n");
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: `TTS the following conversation between Deniz and Mert:\n${conversation}` }],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: "Deniz", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
              { speaker: "Mert", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
            ],
          },
        },
      },
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) return null;
    const pcm = Buffer.from(b64, "base64");
    return wrapWav(pcm);
  }

  export async function POST(request: Request) {
    let body: PodcastBody;
    try {
      body = (await request.json()) as PodcastBody;
    } catch {
      return Response.json({ error: "invalid request" }, { status: 400 });
    }

    const { subject, unitSlug, lang, userKey, force } = body;
    if (!subject || !unitSlug || (lang !== "tr" && lang !== "en")) {
      return Response.json({ error: "invalid request" }, { status: 400 });
    }

    // Already stored in the cloud? Every device gets the same file.
    if (hasStorage() && !force) {
      const existing = await storedUrl(audioPath(subject, unitSlug, lang));
      if (existing) {
        const script = await storedUrl(scriptPath(subject, unitSlug, lang));
        return Response.json({ url: existing, scriptUrl: script });
      }
    }

    const key = process.env.GEMINI_API_KEY || userKey;
    if (!key) return Response.json({ error: "no-key" }, { status: 401 });

    const unit = await getUnit(subject, unitSlug);
    if (!unit || !unit.notes?.length) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }

    const digest = buildNotesDigest(unit.notes, lang);

    try {
      const lines = await generateScript(key, lang, digest);
      if (!lines) return Response.json({ error: "script-failed" }, { status: 502 });

      const wav = await generateAudio(key, lines);
      if (!wav) {
        return Response.json({ scriptOnly: true, lines });
      }

      // Persist to the cloud so phones/other browsers stream the same file.
      if (hasStorage()) {
        const [audioUrl, scriptUrl] = await Promise.all([
          storeObject(audioPath(subject, unitSlug, lang), wav, "audio/wav"),
          storeObject(scriptPath(subject, unitSlug, lang), JSON.stringify(lines), "application/json"),
        ]);
        if (audioUrl) {
          return Response.json({ url: audioUrl, scriptUrl, lines });
        }
        // upload failed — fall through to inline audio so the user still gets their podcast
      }

      const scriptB64 = Buffer.from(JSON.stringify(lines)).toString("base64");
      return new Response(new Uint8Array(wav), {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "X-Podcast-Lines": scriptB64,
        },
      });
    } catch (e) {
      console.error("podcast route error", e);
      return Response.json({ error: "network" }, { status: 502 });
    }
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:** With `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/
`GEMINI_API_KEY` set in `.env.local`, run `npm run dev`, open an insaat-yonetimi unit (any unit
has notes), generate a podcast in one language, confirm it plays, refresh the page, confirm it
loads from storage instantly (no regeneration), then check the Supabase dashboard Storage
browser: `podcasts/insaat-yonetimi/<unit-slug>/tr.wav` (or `en.wav`) exists.

**Failure modes:**
- **`storage: false` in the GET capability report:** means one of `NEXT_PUBLIC_SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` is missing from the running process's env — check `.env.local`
  (dev) or Vercel env vars (prod), not the code.
- **`.list()` returning stale results:** Supabase Storage's `list()` can lag directory-listing
  caches by a second or two right after an `upload()` in rare cases — if a `force=true`
  regeneration immediately followed by a page reload shows the OLD audio, that's this; it's
  cosmetic (the actual object was overwritten via `upsert: true`) and resolves on the next
  request. Do not "fix" by polling.
- **Response field rename (`blob` → `storage`):** the GET capability report's field was
  renamed from `blob` to `storage` for clarity. `PodcastCard.tsx` never reads this field (it
  only destructures `tr`/`en`), so this is a safe, non-breaking rename — verified by reading
  the whole component in Task 0's required reading.

**Commit:** `git add app/api/podcast/route.ts && git commit -m "phase-3: retarget /api/podcast to the new project's service-role client"`

---

## Task 7 — `/api/sync`: retarget to `legacy_sync` on the new project

Same request/response contract (`lib/sync.ts` is untouched — anonymous passcode users see no
difference), only the backing table and client change: `cubad_sync` (sprout, anon key) becomes
`legacy_sync` (new project, service-role key — per master §4 RLS invariants, `legacy_sync` has
"no client access, server routes only," so the anon key wouldn't even work against it).

- [ ] Replace the entire contents of `app/api/sync/route.ts` with:
  ```ts
  import { createHash } from "node:crypto";
  import { createServiceRoleClient } from "@/lib/supabase/server";

  const TABLE = "legacy_sync";

  interface SyncBody {
    code: string;
    /** when present: upsert this state; when absent: just read */
    state?: unknown;
  }

  function rowId(code: string): string {
    return createHash("sha256").update(`cubad:${code.trim()}`).digest("hex");
  }

  export async function GET() {
    return Response.json({
      enabled: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
  }

  export async function POST(request: Request) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: "sync-unavailable" }, { status: 503 });
    }

    let body: SyncBody;
    try {
      body = (await request.json()) as SyncBody;
    } catch {
      return Response.json({ error: "invalid request" }, { status: 400 });
    }

    const code = (body.code ?? "").trim();
    if (code.length < 4 || code.length > 128) {
      return Response.json({ error: "bad-code" }, { status: 400 });
    }
    const id = rowId(code);
    const supabase = createServiceRoleClient();

    try {
      if (body.state !== undefined) {
        // size guard: progress + decks + capped chat histories
        const payload = JSON.stringify(body.state);
        if (payload.length > 3_000_000) {
          return Response.json({ error: "too-large" }, { status: 413 });
        }

        const { data, error } = await supabase
          .from(TABLE)
          .upsert(
            { id, state: body.state, updated_at: new Date().toISOString() },
            { onConflict: "id" }
          )
          .select("updated_at")
          .single();
        if (error) {
          console.error("sync upsert failed", error.message);
          return Response.json({ error: "upstream" }, { status: 502 });
        }
        return Response.json({ ok: true, updated_at: data?.updated_at ?? null });
      }

      const { data, error } = await supabase
        .from(TABLE)
        .select("state, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        console.error("sync read failed", error.message);
        return Response.json({ error: "upstream" }, { status: 502 });
      }
      return Response.json(
        data ? { state: data.state, updated_at: data.updated_at } : { state: null, updated_at: null }
      );
    } catch (e) {
      console.error("sync route error", e);
      return Response.json({ error: "network" }, { status: 502 });
    }
  }
  ```
- [ ] `npm run build` — expect success.

**Manual verification:** In dev, open the app, use `SyncCard` to set a passcode, mark a
question done, wait for the debounced sync (or trigger it), then check the new project's
`legacy_sync` table (dashboard → Table Editor) for a row with `id = sha256("cubad:" + code)`
and a `state` jsonb matching `lib/sync.ts`'s `SyncState` shape. Open the same passcode on a
second browser/incognito window — confirm the progress appears there too (this is the actual
sync round-trip, repeated as a smoke test in Task 12).

**Failure modes:**
- **`sync-unavailable` (503) in prod right after cutover:** means the new env vars didn't
  actually get set on the deployment that's serving traffic — check Vercel's env var scope
  (Production vs Preview vs Development can differ) before assuming the code is broken.
- **RLS blocking the service client:** should never happen (service role bypasses RLS by
  definition) — if you see a permission-denied error from Postgres here, you are almost
  certainly using the wrong key (anon instead of service-role) in
  `lib/supabase/server.ts`'s `createServiceRoleClient()` — check that file, not this route.

**Commit:** `git add app/api/sync/route.ts && git commit -m "phase-3: retarget /api/sync to legacy_sync on the new project"`

---

## Task 8 — Unified components: `SubjectHome` and `UnitPage`

This is the core of D5. Two new components replace four
(`HomeView`+`StudyHomeView` → `SubjectHome`; `UnitView`+`StudyUnitView` → `UnitPage`). Every
leaf component they call (`PodcastCard`, `Md`, `Tex`, `TutorPanel`, `GraphStory`, and the
primitives in `ui.tsx`) is unchanged — only the two "shell" components that decide *which
sections to show, in what order, with which section-specific formatting* are new.

Read the design rationale below before touching code — it explains exactly which existing
visual differences between the two old components are **preserved on purpose** (tied to
`section_order`, because that's literally what today's live users see) versus which are
**unified as content-presence checks** (because they were already effectively content-driven
and unifying them changes nothing for the two live subjects).

**Section order, locked in from the two old components' actual behavior (verified by reading
every unit's actual field population — see the diagnostic commands in this doc's research
notes):**

| Section | `section_order = 'walkthrough'` (hidroloji) | `section_order = 'study'` (insaat-yonetimi) |
|---|---|---|
| 1 | Header | Header |
| 2 | Concept primer *(if `unit.concept`)* | Podcast card *(self-guards on `notes.length`)* |
| 3 | Questions *(if `unit.questions.length`, "Questions" header, code-based badge, quiz link if `unit.quiz.length`)* | Notes *(if `unit.notes.length`, with sticky mini-TOC)* |
| 4 | Podcast card *(self-guards)* | Action cards: flashcards/practice links *(each only if that array is non-empty)* |
| 5 | Notes *(if present)* | Concept primer *(if present — future-proofing; never true for study units today)* |
| 6 | Action cards | Questions *(if present, "Step-by-step solutions" header, raw-id badge, quiz link if `unit.quiz.length`)* |
| 7 | Sources footer *(if present)* | Sources footer *(if present)* |
| 8 | TutorPanel *(context: concept-based if `unit.concept`, else notes-based)* | TutorPanel *(same rule)* |

Content-presence gating (not `section_order`) decides *whether* a section renders at all
(concept/questions/podcast/notes/flashcards/practice/sources); `section_order` only decides
(a) the *position* of the questions section relative to podcast/notes, and (b) two purely
cosmetic details inside the questions section that today's live hidroloji/insaat-yonetimi users
already see differently — the header wording ("Questions" vs "Step-by-step solutions") and the
per-question badge content (formatted question code vs raw id). Both of those cosmetic
differences existed in the original `UnitView`/`StudyUnitView` split; keeping them keyed on
`section_order` here is what makes the merge byte-equivalent instead of silently changing
either subject's copy.

- [ ] Create `components/SubjectHome.tsx`:
  ```tsx
  "use client";

  import Link from "next/link";
  import { useLang } from "@/lib/i18n";
  import { useProgress } from "@/lib/progress";
  import type { SubjectMeta, Unit } from "@/lib/types";
  import { WaterProgress } from "./ui";

  // Hardcoded hydrology-specific hero + study-plan copy, preserved VERBATIM from the old
  // HomeView.tsx. It is not data-driven — it names hidroloji's exact 9-unit structure by
  // number. It is intentionally gated on `subject.slug === "hidroloji"` rather than
  // generalized into a schema field: Phase 3's mandate is byte-equivalent rendering of
  // EXISTING content, not a new landing-copy mechanism. Revisit if/when a future subject wants
  // its own custom hero (tracked as debt, not a Phase 3 concern).
  const HIDROLOJI_PLAN = {
    en: [
      {
        day: "Today",
        focus: "Foundations",
        items: [
          "Unit 1 (Water balance) + Unit 2 (Precipitation) — walk through every question.",
          "Unit 3 (Evaporation) + Unit 4 (Infiltration). Horton is an exam favourite: do 4.2 and 4.3 twice.",
          "Finish with each unit's quick quiz. Wrong answer? Reopen that walkthrough.",
        ],
      },
      {
        day: "Tomorrow",
        focus: "The heavy hitters",
        items: [
          "Unit 5 (Streamflow) and Unit 6 (Hydrographs) — 6.1 and 6.5 are the classic exam questions.",
          "Unit 7 (Floods): Gumbel + Rational method. Unit 8 (Groundwater): both well equations.",
          "Evening: read every ⚠ exam-trap card and the What-if scenarios. That's where points are lost.",
        ],
      },
      {
        day: "Exam morning",
        focus: "Sharpen",
        items: [
          "Skim the Formula sheet once — say out loud when each formula applies.",
          "Redo (on paper!) the 'high likelihood' questions marked red.",
          "Check units before every answer: mm↔cm, minutes↔hours, m³/s↔volume.",
        ],
      },
    ],
    tr: [
      {
        day: "Bugün",
        focus: "Temeller",
        items: [
          "Konu 1 (Su dengesi) + Konu 2 (Yağış) — her soruyu adım adım çöz.",
          "Konu 3 (Buharlaşma) + Konu 4 (Sızma). Horton sınavların gözdesi: 4.2 ve 4.3'ü iki kez yap.",
          "Her konuyu mini sınavla bitir. Yanlış mı yaptın? İlgili çözümü tekrar aç.",
        ],
      },
      {
        day: "Yarın",
        focus: "Ağır toplar",
        items: [
          "Konu 5 (Akım) ve Konu 6 (Hidrograflar) — 6.1 ve 6.5 klasik sınav sorularıdır.",
          "Konu 7 (Taşkınlar): Gumbel + Rasyonel yöntem. Konu 8 (Yeraltı suyu): iki kuyu denklemi.",
          "Akşam: tüm ⚠ tuzak kartlarını ve 'Ya olsaydı?' senaryolarını oku. Puanlar orada kaybedilir.",
        ],
      },
      {
        day: "Sınav sabahı",
        focus: "Bilenme",
        items: [
          "Formül kartını bir kez tara — her formülün ne zaman kullanıldığını sesli söyle.",
          "Kırmızı işaretli 'yüksek olasılık' sorularını (kâğıt üzerinde!) yeniden çöz.",
          "Her cevaptan önce birimleri kontrol et: mm↔cm, dakika↔saat, m³/sn↔hacim.",
        ],
      },
    ],
  };

  export function SubjectHome({ subject, units }: { subject: SubjectMeta; units: Unit[] }) {
    const { lang, t, bi } = useLang();
    const { state } = useProgress();

    const isWalkthrough = subject.section_order === "walkthrough";
    const isHidroloji = subject.slug === "hidroloji";

    const totalQ = isWalkthrough
      ? units.reduce((n, u) => n + (u.questions?.length ?? 0), 0)
      : units.reduce((n, u) => n + (u.practice?.length ?? 0), 0);
    const doneQ = isWalkthrough
      ? units.reduce(
          (n, u) => n + (u.questions ?? []).filter((q) => state.q[`${subject.slug}/${q.id}`]?.done).length,
          0
        )
      : units.reduce(
          (n, u) =>
            n +
            (u.practice ?? []).filter((p) => state.practice[`${subject.slug}/${u.slug}/${p.id}`]?.answered)
              .length,
          0
        );

    return (
      <div className="space-y-10">
        <section className="rise-in pt-4 sm:pt-8">
          <h1 className="font-display text-4xl font-semibold leading-tight text-deniz-deep sm:text-5xl">
            {isHidroloji ? (
              lang === "tr" ? (
                <>
                  Hidrolojiyi <em className="text-deniz">anlayarak</em> geç.
                </>
              ) : (
                <>
                  Pass hydrology by <em className="text-deniz">understanding</em> it.
                </>
              )
            ) : (
              bi(subject.title)
            )}
          </h1>
          <p className="mt-3 max-w-2xl text-ink-soft">
            {isHidroloji
              ? lang === "tr"
                ? "Her soru, elinden tutan bir öğretmen gibi adım adım çözülür: önce sen düşün, sonra ipucu al, sonra adımı ve nedenini gör."
                : "Every question unfolds like a tutor holding your hand: think first, take a hint, then see the step — and why we take it."
              : bi(subject.tagline)}
          </p>
          {totalQ > 0 && (
            <div className="mt-5 max-w-md">
              <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft">
                <span>{t("totalProgress")}</span>
                <span>
                  {doneQ}/{totalQ} {t("questions")}
                </span>
              </div>
              <WaterProgress value={totalQ ? doneQ / totalQ : 0} className="h-2.5" />
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 font-display text-2xl font-semibold text-ink">{t("allUnits")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {units.map((u) => {
              const notesN = u.notes?.length ?? 0;
              const cardsN = u.flashcards?.length ?? 0;
              const practiceN = u.practice?.length ?? 0;
              const questionsN = u.questions?.length ?? 0;
              const done = isWalkthrough
                ? (u.questions ?? []).filter((q) => state.q[`${subject.slug}/${q.id}`]?.done).length
                : (u.practice ?? []).filter(
                    (p) => state.practice[`${subject.slug}/${u.slug}/${p.id}`]?.answered
                  ).length;
              const total = isWalkthrough ? questionsN : practiceN;
              return (
                <Link
                  key={u.slug}
                  href={`/s/${subject.slug}/unit/${u.slug}`}
                  className="group rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,43,51,0.04)] transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-deniz">
                      {String(u.unit).padStart(2, "0")}
                    </span>
                    {isWalkthrough && (
                      <span className="text-xs text-ink-faint">
                        {questionsN} {t("questions")}
                      </span>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
                    {bi(u.title)}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{bi(u.tagline)}</p>
                  {isWalkthrough ? (
                    <div className="mt-4">
                      <WaterProgress value={total ? done / total : 0} />
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
                      <span>
                        {notesN} {t("konuAnlatimi").toLowerCase()}
                      </span>
                      <span>
                        {cardsN} {t("cardsCount")}
                      </span>
                      <span>
                        {practiceN} {t("questions")}
                      </span>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>

        {isHidroloji && (
          <section>
            <h2 className="mb-4 font-display text-2xl font-semibold text-ink">{t("studyPlan")}</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {HIDROLOJI_PLAN[lang].map((d, i) => (
                <div key={i} className="rounded-2xl border border-line bg-card p-5">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-deniz">
                    {d.day}
                  </p>
                  <h3 className="mb-2 font-display text-lg font-semibold">{d.focus}</h3>
                  <ul className="space-y-2 text-sm text-ink-soft">
                    {d.items.map((it, j) => (
                      <li key={j} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-deniz/50" />
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }
  ```
- [ ] Create `components/UnitPage.tsx`:
  ```tsx
  "use client";

  import Link from "next/link";
  import { useLang } from "@/lib/i18n";
  import { useProgress } from "@/lib/progress";
  import type { SubjectMeta, Unit } from "@/lib/types";
  import { Md, Tex } from "./Md";
  import { GraphStory } from "./GraphStory";
  import { PodcastCard } from "./PodcastCard";
  import { TutorPanel } from "./TutorPanel";
  import { Callout, DifficultyDots, LikelihoodBadge, WaterProgress } from "./ui";

  export function UnitPage({ subject, unit }: { subject: SubjectMeta; unit: Unit }) {
    const { t, bi } = useLang();
    const { state } = useProgress();

    const isWalkthrough = subject.section_order === "walkthrough";
    const questions = unit.questions ?? [];
    const notes = unit.notes ?? [];
    const flashcards = unit.flashcards ?? [];
    const practice = unit.practice ?? [];
    const sources = unit.sources;
    const concept = unit.concept;

    const doneQuestions = questions.filter((q) => state.q[`${subject.slug}/${q.id}`]?.done).length;
    const quizScore = state.quiz[`${subject.slug}/${unit.slug}`];
    const answeredPractice = practice.filter(
      (p) => state.practice[`${subject.slug}/${unit.slug}/${p.id}`]?.answered
    ).length;

    // due-card count (mirrors FlashcardDeck's Leitner rule), used only by the flashcards action card
    let dueCount = flashcards.length;
    if (typeof window !== "undefined" && flashcards.length) {
      try {
        const raw = window.localStorage.getItem(`cubad:cards:${subject.slug}:${unit.slug}`);
        if (raw) {
          const box: Record<string, { box: 1 | 2 | 3; last: number }> = JSON.parse(raw);
          const today = Math.floor(Date.now() / 86400000);
          dueCount = flashcards.filter((c) => {
            const rec = box[c.id];
            if (!rec) return true;
            if (rec.box === 1) return true;
            if (rec.box === 2) return today - rec.last >= 2;
            return today - rec.last >= 5;
          }).length;
        }
      } catch {
        /* ignore */
      }
    }

    const tutorContext = concept
      ? JSON.stringify({
          type: "unit-primer",
          unit: unit.title,
          overview: concept.overview,
          keyFormulas: concept.keyFormulas.map((f) => ({
            name: f.name,
            latex: f.latex,
            meaning: f.meaning,
            whenToUse: f.whenToUse,
          })),
          traps: concept.traps,
          questions: questions.map((q) => ({ id: q.id, code: q.code, title: q.title })),
        }).slice(0, 60000)
      : JSON.stringify({
          type: "lesson-notes",
          unit: unit.title,
          notes: notes.map((n) => ({
            title: n.title,
            body: { tr: n.body.tr.slice(0, 1500), en: n.body.en.slice(0, 1500) },
          })),
        }).slice(0, 60000);

    const header = (
      <div className="rise-in">
        {!isWalkthrough && (
          <Link href={`/s/${subject.slug}`} className="text-sm font-medium text-deniz hover:text-deniz-deep">
            ← {t("backToSubjects")}
          </Link>
        )}
        <p
          className={`${!isWalkthrough ? "mt-2 " : ""}font-mono text-xs font-semibold uppercase tracking-wider text-deniz`}
        >
          {isWalkthrough ? t("units") : t("unit")} · {String(unit.unit).padStart(2, "0")}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-deniz-deep sm:text-4xl">{bi(unit.title)}</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">{bi(unit.tagline)}</p>
        {isWalkthrough ? (
          <div className="mt-4 max-w-md">
            <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft">
              <span>{t("progress")}</span>
              <span>
                {doneQuestions}/{questions.length}
              </span>
            </div>
            <WaterProgress value={questions.length ? doneQuestions / questions.length : 0} />
          </div>
        ) : (
          practice.length > 0 && (
            <div className="mt-4 max-w-md">
              <div className="mb-1 flex justify-between text-xs font-medium text-ink-soft">
                <span>{t("progress")}</span>
                <span>
                  {answeredPractice}/{practice.length}
                </span>
              </div>
              <WaterProgress value={practice.length ? answeredPractice / practice.length : 0} />
            </div>
          )
        )}
      </div>
    );

    const conceptSection = concept && (
      <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
        <h2 className="mb-3 font-display text-xl font-semibold text-ink">{t("conceptPrimer")}</h2>
        <Md>{bi(concept.overview)}</Md>
        {concept.keyFormulas.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              {t("keyFormulas")}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {concept.keyFormulas.map((f, i) => (
                <div key={i} className="min-w-0 rounded-xl border border-line-soft bg-paper p-4">
                  <p className="mb-1 text-sm font-semibold text-deniz-deep">{bi(f.name)}</p>
                  <div className="overflow-x-auto py-1">
                    <Tex tex={f.latex} />
                  </div>
                  <Md className="mt-1 !text-[13px] text-ink-soft [&_p]:leading-relaxed">{bi(f.meaning)}</Md>
                  <div className="mt-2 text-[13px]">
                    <span className="font-semibold text-deniz">{t("whenToUse")}: </span>
                    <Md className="!text-[13px] inline text-ink-soft [&_p]:inline">{bi(f.whenToUse)}</Md>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {concept.traps.length > 0 && (
          <div className="mt-6">
            <Callout kind="trap" title={t("traps")}>
              <ul className="list-disc space-y-1 pl-4">
                {concept.traps.map((tr, i) => (
                  <li key={i}>
                    <Md className="[&_p]:inline">{bi(tr)}</Md>
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
      </section>
    );

    const questionsSection = questions.length > 0 && (
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">
            {isWalkthrough
              ? t("questions").charAt(0).toUpperCase() + t("questions").slice(1)
              : t("stepByStepSolutions")}
          </h2>
          {(unit.quiz?.length ?? 0) > 0 && (
            <Link
              href={`/s/${subject.slug}/unit/${unit.slug}/quiz`}
              className="rounded-full bg-deniz px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-deniz-deep"
            >
              {t("quiz")}
              {quizScore ? ` · ${quizScore.score}/${quizScore.total}` : ""}
            </Link>
          )}
        </div>
        <div className="grid gap-2.5">
          {questions.map((q) => {
            const p = state.q[`${subject.slug}/${q.id}`];
            const started = (p?.step ?? 0) > 0;
            return (
              <Link
                key={q.id}
                href={`/s/${subject.slug}/q/${q.id}`}
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 transition-all hover:border-deniz/40 hover:shadow-[0_4px_16px_rgba(14,90,109,0.08)] sm:gap-4"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${
                    p?.done
                      ? "bg-moss text-white"
                      : started
                        ? "bg-deniz-soft text-deniz-deep"
                        : "bg-wash text-ink-soft"
                  }`}
                >
                  {p?.done
                    ? "✓"
                    : isWalkthrough
                      ? q.id.split("-").slice(-1)[0]
                        ? q.code.replace("Uygulama ", "")
                        : q.id
                      : q.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink group-hover:text-deniz-deep">
                    {bi(q.title)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                    <DifficultyDots level={q.difficulty} />
                    <span>
                      {q.steps.length} {t("step").toLowerCase()}
                    </span>
                    {q.examLikelihood === "high" && <LikelihoodBadge level="high" />}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-deniz">
                  <span className="hidden sm:inline">
                    {p?.done ? t("review") : started ? t("continueWalkthrough") : t("startWalkthrough")}
                  </span>
                  <span aria-hidden> →</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    );

    const podcastSection = <PodcastCard subject={subject.slug} unit={unit} />;

    const notesSection = notes.length > 0 && (
      <section className="lg:grid lg:grid-cols-[1fr_220px] lg:gap-8">
        <div className="space-y-4">
          <h2 className="font-display text-xl font-semibold text-ink">📖 {t("konuAnlatimi")}</h2>
          {notes.map((n) => (
            <div key={n.id} id={n.id} className="scroll-mt-24 rounded-2xl border border-line bg-card p-5 sm:p-6">
              <h3 className="mb-3 font-display text-lg font-semibold text-ink">{bi(n.title)}</h3>
              <Md>{bi(n.body)}</Md>
              {n.story && (
                <div className="mt-4">
                  <GraphStory story={n.story} />
                </div>
              )}
            </div>
          ))}
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-1 rounded-2xl border border-line bg-card p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t("konuAnlatimi")}
            </p>
            {notes.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                className="block truncate rounded-lg px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-wash hover:text-deniz-deep"
              >
                {bi(n.title)}
              </a>
            ))}
          </div>
        </aside>
      </section>
    );

    const actionCards = (flashcards.length > 0 || practice.length > 0) && (
      <section className="grid gap-4 sm:grid-cols-2">
        {flashcards.length > 0 && (
          <Link
            href={`/s/${subject.slug}/unit/${unit.slug}/cards`}
            className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
          >
            <p className="text-2xl">🃏</p>
            <h3 className="mt-2 font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
              {t("flashcardsTitle")}
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              {flashcards.length} {t("cardsCount")} · {dueCount} {t("dueCards")}
            </p>
          </Link>
        )}
        {practice.length > 0 && (
          <Link
            href={`/s/${subject.slug}/unit/${unit.slug}/practice`}
            className="group rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-deniz/40 hover:shadow-[0_8px_24px_rgba(14,90,109,0.10)]"
          >
            <p className="text-2xl">❓</p>
            <h3 className="mt-2 font-display text-lg font-semibold text-ink group-hover:text-deniz-deep">
              {t("practiceTitle")}
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              {practice.length} {t("questions")} · {answeredPractice} {t("answeredCount")}
            </p>
          </Link>
        )}
      </section>
    );

    const sourcesSection = sources && (sources.videos.length > 0 || sources.pdfs.length > 0) && (
      <footer className="border-t border-line pt-5 text-xs text-ink-faint">
        <p className="mb-2 font-semibold uppercase tracking-wide">{t("resources")}</p>
        <ul className="space-y-1">
          {sources.videos.map((v) => (
            <li key={v.id}>
              <a
                href={`https://www.youtube.com/watch?v=${v.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-deniz hover:text-deniz-deep hover:underline"
              >
                {v.title}
              </a>{" "}
              <span className="text-ink-faint">({v.length})</span>
            </li>
          ))}
          {sources.pdfs.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </footer>
    );

    const tutor = (
      <TutorPanel
        subject={subject.slug}
        topicId={`${subject.slug}/unit/${unit.slug}`}
        topicTitle={unit.title}
        context={tutorContext}
      />
    );

    return (
      <div className="space-y-8">
        {header}
        {isWalkthrough ? (
          <>
            {conceptSection}
            {questionsSection}
            {podcastSection}
            {notesSection}
            {actionCards}
          </>
        ) : (
          <>
            {podcastSection}
            {notesSection}
            {actionCards}
            {conceptSection}
            {questionsSection}
          </>
        )}
        {sourcesSection}
        {tutor}
      </div>
    );
  }
  ```
- [ ] Do **not** delete `components/HomeView.tsx`, `StudyHomeView.tsx`, `UnitView.tsx`,
      `StudyUnitView.tsx` in this task — Task 9 removes their last callers first, then deletes
      the files, so `git blame`/history stays clean and a mid-task revert doesn't leave dead
      imports.
- [ ] `npx tsc --noEmit` — expect 0 new errors from these two files (they aren't imported by
      any route yet, so `next build` won't touch them until Task 9).

**Manual verification:** none yet — these components have no callers until Task 9. Proceed
directly; Task 9's checklist is where you actually look at rendered pages.

**Failure modes:**
- **Forgetting a content-presence guard:** every section above is wrapped in a truthy check
  (`concept &&`, `notes.length > 0 &&`, etc.) that evaluates to `false`/`undefined` when
  absent — React renders `false`/`undefined` as nothing, which is correct. If you see an empty
  `<section>` with just whitespace on either subject's unit page, you dropped a guard
  somewhere; the two components above should render *nothing at all* for any section whose
  underlying array/object is empty, exactly like the originals.
- **`PodcastCard` prop mismatch:** `PodcastCard` takes `subject: string`, not
  `subject: SubjectMeta` — always pass `subject.slug`, not `subject`. Same for `TutorPanel`.

**Commit:** `git add components/SubjectHome.tsx components/UnitPage.tsx && git commit -m "phase-3: add unified SubjectHome and UnitPage components"`

---

## Task 9 — Rewire the 8 route files + homepage to the DB and the unified components

**Decision: drop `generateStaticParams` from every dynamic route in `app/s/[subject]/**`.**
Subject/unit slugs now live in the database and can change without a redeploy (product
requirement #5 in the master doc: "content uploads appear without redeploys"). Enumerating
them via `generateStaticParams` at build time would require a live DB connection during
`next build` and would force a full rebuild + redeploy every time an admin adds or edits a
unit — defeating the entire point of DB-backed content (see
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-static-params.md`:
without it, `dynamicParams` defaults to `true` and Next renders each param combination
on-demand the first time it's requested). Because `lib/content-db.ts`'s fetchers are already
wrapped in `unstable_cache` (not raw per-request DB calls) and this phase introduces **no**
per-visitor/per-cookie logic in these pages (every unit is `is_free = true` today; Phase 4 is
what adds the entitlement check, which *will* force genuine per-request dynamic rendering on
these routes — that check needs the authenticated user's id, a real per-request input), leaving
`generateStaticParams` out simply shifts from "enumerate everything at build time" to
"render on first request, then serve from Next's own route cache/ISR" — the practical
performance profile is unchanged today, and the routes stay revalidate-by-tag friendly for
tomorrow. We do **not** add `export const dynamic = 'force-dynamic'` either — that would
needlessly disable Next's own route-level caching for pages that have no per-request data yet;
leave the route segment config at its default (`dynamic = 'auto'`) and revisit forcing dynamic
rendering explicitly in Phase 4.

- [ ] Replace `app/s/[subject]/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { getSubject, getUnits } from "@/lib/content-db";
  import { SubjectHome } from "@/components/SubjectHome";

  export default async function SubjectHomePage({
    params,
  }: {
    params: Promise<{ subject: string }>;
  }) {
    const { subject: subjectSlug } = await params;
    const subject = await getSubject(subjectSlug);
    if (!subject) notFound();
    const units = await getUnits(subjectSlug);
    return <SubjectHome subject={subject} units={units} />;
  }
  ```
- [ ] Replace `app/s/[subject]/unit/[slug]/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { getSubject, getUnit } from "@/lib/content-db";
  import { UnitPage } from "@/components/UnitPage";

  export default async function UnitRoutePage({
    params,
  }: {
    params: Promise<{ subject: string; slug: string }>;
  }) {
    const { subject: subjectSlug, slug } = await params;
    const subject = await getSubject(subjectSlug);
    const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
    if (!subject || !unit) notFound();
    return <UnitPage subject={subject} unit={unit} />;
  }
  ```
- [ ] Replace `app/s/[subject]/unit/[slug]/quiz/page.tsx` (guard is now content-driven —
      renders for **any** unit with quiz items, not just `section_order === 'walkthrough'`
      units, which is strictly more correct per D4's superset model and identical in output
      for both live subjects today):
  ```tsx
  import { notFound } from "next/navigation";
  import { getSubject, getUnit } from "@/lib/content-db";
  import { QuizRunner } from "@/components/QuizRunner";

  export default async function QuizPage({
    params,
  }: {
    params: Promise<{ subject: string; slug: string }>;
  }) {
    const { subject: subjectSlug, slug } = await params;
    const subject = await getSubject(subjectSlug);
    const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
    if (!subject || !unit || (unit.quiz?.length ?? 0) === 0) notFound();
    return <QuizRunner subject={subjectSlug} unit={unit} />;
  }
  ```
- [ ] Replace `app/s/[subject]/unit/[slug]/cards/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { getSubject, getUnit } from "@/lib/content-db";
  import { FlashcardDeck } from "@/components/FlashcardDeck";

  export default async function CardsPage({
    params,
  }: {
    params: Promise<{ subject: string; slug: string }>;
  }) {
    const { subject: subjectSlug, slug } = await params;
    const subject = await getSubject(subjectSlug);
    const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
    if (!subject || !unit || (unit.flashcards?.length ?? 0) === 0) notFound();
    return <FlashcardDeck subject={subjectSlug} unit={unit} />;
  }
  ```
- [ ] Replace `app/s/[subject]/unit/[slug]/practice/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { getSubject, getUnit } from "@/lib/content-db";
  import { PracticeRunner } from "@/components/PracticeRunner";

  export default async function PracticePage({
    params,
  }: {
    params: Promise<{ subject: string; slug: string }>;
  }) {
    const { subject: subjectSlug, slug } = await params;
    const subject = await getSubject(subjectSlug);
    const unit = subject ? await getUnit(subjectSlug, slug) : undefined;
    if (!subject || !unit || (unit.practice?.length ?? 0) === 0) notFound();
    return <PracticeRunner subject={subjectSlug} unit={unit} />;
  }
  ```
- [ ] Replace `app/s/[subject]/q/[id]/page.tsx` (`hasQuiz` is now content-driven, replacing
      `subject.kind === "walkthrough"`):
  ```tsx
  import { notFound } from "next/navigation";
  import { getQuestion, getQuestionOrder, getSubject } from "@/lib/content-db";
  import { Walkthrough } from "@/components/Walkthrough";

  export default async function QuestionPage({
    params,
  }: {
    params: Promise<{ subject: string; id: string }>;
  }) {
    const { subject: subjectSlug, id } = await params;
    const subject = await getSubject(subjectSlug);
    const found = subject ? await getQuestion(subjectSlug, id) : undefined;
    if (!subject || !found) notFound();

    const order = await getQuestionOrder(subjectSlug);
    const idx = order.findIndex((q) => q.id === id);
    const prev = idx > 0 ? order[idx - 1].id : null;
    const next = idx < order.length - 1 ? order[idx + 1].id : null;

    return (
      <Walkthrough
        subject={subjectSlug}
        unitTitle={found.unit.title}
        unitSlug={found.unit.slug}
        question={found.question}
        prevId={prev}
        nextId={next}
        hasQuiz={(found.unit.quiz?.length ?? 0) > 0}
      />
    );
  }
  ```
- [ ] Replace `app/s/[subject]/formulas/page.tsx`:
  ```tsx
  import { notFound } from "next/navigation";
  import { getSubject, getUnits } from "@/lib/content-db";
  import { FormulasView } from "@/components/FormulasView";

  export default async function FormulasPage({
    params,
  }: {
    params: Promise<{ subject: string }>;
  }) {
    const { subject: subjectSlug } = await params;
    const subject = await getSubject(subjectSlug);
    if (!subject) notFound();
    const units = await getUnits(subjectSlug);
    const hasFormulas = units.some((u) => (u.concept?.keyFormulas?.length ?? 0) > 0);
    if (!hasFormulas) notFound();
    return <FormulasView units={units} />;
  }
  ```
- [ ] Replace `app/page.tsx`:
  ```tsx
  import { getSubjects, getUnits } from "@/lib/content-db";
  import { SubjectPicker } from "@/components/SubjectPicker";
  import type { Unit } from "@/lib/types";

  export default async function HomePage() {
    const subjects = await getSubjects();
    const entries = await Promise.all(
      subjects.map(async (s): Promise<[string, Unit[]]> => [s.slug, await getUnits(s.slug)])
    );
    const unitsBySubject = Object.fromEntries(entries);
    return <SubjectPicker subjects={subjects} unitsBySubject={unitsBySubject} />;
  }
  ```
- [ ] Edit `components/SubjectPicker.tsx` — the only change is the discriminant field, twice:
  find `if (s.kind === "walkthrough") {` and change to
  `if (s.section_order === "walkthrough") {`. (The rest of the file — imports, JSX, `SyncCard`,
  `ResetCard` — is unchanged.)
- [ ] Now that no route imports them, delete the four superseded components:
  `git rm components/HomeView.tsx components/StudyHomeView.tsx components/UnitView.tsx components/StudyUnitView.tsx`.
- [ ] `grep -rn "lib/content\"" app/ components/` (excluding `lib/content.ts`/`lib/content-db.ts`
      themselves and any `*.test.ts`) — expect **zero** matches. Every runtime consumer must
      now import from `lib/content-db`.
- [ ] `npm run lint && npm run build` — expect both to pass with **zero** references to
      `subject.kind` remaining anywhere under `app/`/`components/` except the deprecated field
      definition itself in `lib/types.ts` and its mirroring in `lib/content.ts`/
      `lib/content-db.ts`.

### Visual regression checklist (do this with the dev server pointed at seeded, real DB data)

Run `npm run dev`, and for **each** row below, compare the rendered page against your memory
of the app *before* this phase (or against a `git stash`'d build of the old components running
side-by-side on a different port, if you want a literal pixel diff rather than a memory
check). Tick every box.

**hidroloji (`section_order = 'walkthrough'`):**
- [ ] `/s/hidroloji` — hero headline is the hardcoded "Pass hydrology by understanding it." /
      "Hidrolojiyi anlayarak geç." copy (both languages), not the generic `bi(subject.title)`.
- [ ] `/s/hidroloji` — unit grid cards show a question-count badge top-right and a
      water-progress bar (not the notes/cards/practice count row).
- [ ] `/s/hidroloji` — the 3-day study plan section renders below the unit grid, in both
      languages, with the exact copy from `HIDROLOJI_PLAN`.
- [ ] `/s/hidroloji/unit/unit-1` — no "← All subjects" back-link, label reads "Konular · 01" /
      "Units · 01" (plural), progress bar always visible (even hypothetically at 0 questions).
- [ ] `/s/hidroloji/unit/unit-1` — Concept primer renders (overview, key formulas w/ KaTeX,
      traps callout).
- [ ] `/s/hidroloji/unit/unit-1` — Questions section header says "Questions"/"Sorular" (capitalized), a
      "Quiz" link/button sits beside the header, and each question badge shows its formatted
      code (e.g. "1.1"), not a raw id.
- [ ] `/s/hidroloji/unit/unit-1` — no podcast card, no notes section, no flashcards/practice
      action cards, no sources footer (all absent, matching today — this unit has none of that
      content).
- [ ] `/s/hidroloji/unit/unit-1` — TutorPanel present, opens with unit-primer context (verify
      via devtools/network that the `context` prop mentions `"type":"unit-primer"`).
- [ ] `/s/hidroloji/unit/unit-1/quiz` renders (unit-1 has 8 quiz items); every unit's `/quiz`
      route works.
- [ ] `/s/hidroloji/q/1-1` (or any real question id) — walkthrough renders, `hasQuiz` shows the
      quiz CTA at the end (since hidroloji units always have quiz items).
- [ ] `/s/hidroloji/formulas` — renders, lists every unit's key formulas.
- [ ] `/s/hidroloji/unit/unit-1/cards` and `/practice` — return 404 (hidroloji units have no
      flashcards/practice).

**insaat-yonetimi (`section_order = 'study'`):**
- [ ] `/s/insaat-yonetimi` — hero headline/tagline come from `bi(subject.title)`/
      `bi(subject.tagline)` (DB-driven), no hardcoded hero, no study-plan section below the
      grid.
- [ ] `/s/insaat-yonetimi` — unit grid cards show NO question-count badge and NO water-progress
      bar; instead show the "N lesson notes · N cards · N questions" count row.
- [ ] `/s/insaat-yonetimi/unit/unit-1` — "← All subjects" back-link present, label reads
      "Konu · 01" / "Unit · 01" (singular).
- [ ] `/s/insaat-yonetimi/unit/unit-1` — progress bar under the header ONLY if
      `practice.length > 0` (true for every current unit, so it should show).
- [ ] `/s/insaat-yonetimi/unit/unit-1` — podcast card renders (unit has notes), can generate +
      play audio.
- [ ] `/s/insaat-yonetimi/unit/unit-1` — Notes section with sticky right-hand mini-TOC on
      desktop widths.
- [ ] `/s/insaat-yonetimi/unit/unit-1` — action cards grid shows BOTH flashcards and practice
      links (both counts + due/answered subtitles).
- [ ] `/s/insaat-yonetimi/unit/unit-1` — no Concept primer section (unit-1 has `concept`
      absent).
- [ ] `/s/insaat-yonetimi/unit/unit-2` (has 2 optional walkthrough `questions`) — a
      "Step-by-step solutions" / "Adım adım çözümler" section renders below the action cards,
      NOT above the podcast/notes, with plain-id badges (e.g. the literal `q.id`, not a
      formatted code) and NO quiz link (unit has 0 quiz items).
- [ ] `/s/insaat-yonetimi/unit/unit-1` — Sources footer renders (videos + pdfs list) since
      `unit-1.json` has `sources`.
- [ ] `/s/insaat-yonetimi/unit/unit-1` — TutorPanel context is notes-based (verify
      `"type":"lesson-notes"` in the `context` prop via devtools).
- [ ] `/s/insaat-yonetimi/unit/unit-1/cards` and `/practice` render correctly; `/quiz` 404s
      (no quiz items in this subject today).
- [ ] `/s/insaat-yonetimi/formulas` — 404s (no unit has `concept.keyFormulas`).

**Cross-cutting:**
- [ ] Homepage (`/`) subject picker shows both subjects with correct progress fractions
      (hidroloji via questions, insaat-yonetimi via practice) — unchanged from before.
- [ ] Switch language (TR ⇄ EN) on every page above — every string still resolves (no missing
      `t()`/`bi()` key shows raw English/Turkish where the other should be).
- [ ] `npm run build` output shows no route unexpectedly marked static-only-at-build-time in a
      way that would break on first deploy (a fresh `next build` + `next start`, visit every
      URL above once, confirm no 500s).

**Failure modes:**
- **A whole section silently vanished on one subject only:** almost always a swapped
  `isWalkthrough`/`!isWalkthrough` conditional, or a content-presence check that got attached
  to the wrong array (e.g. gating notes on `flashcards.length` by copy-paste mistake). Compare
  against the design table at the top of Task 8.
- **RSC/client boundary error on `next build` only (not `next dev`):** if `SubjectHome`/
    `UnitPage` ever end up NOT marked `"use client"` (e.g. you split them into new files and
  forgot the directive), `useLang`/`useProgress` (which use React hooks + browser storage)
  will fail to compile for the server bundle. Keep the `"use client"` directive at the top of
  both files.
- **`notFound()` on a URL that used to work:** check that the corresponding `is_free`/
  `status = 'published'` values actually got seeded correctly by Phase 1 — `getUnits`
  filters on `status = 'published'` and the parent subject's `status = 'published'` too; a
  unit under a `draft` subject silently returns `[]`.

**Commit:**
```
git add app/page.tsx app/s components/SubjectPicker.tsx
git rm components/HomeView.tsx components/StudyHomeView.tsx components/UnitView.tsx components/StudyUnitView.tsx
git commit -m "phase-3: rewire routes to lib/content-db + unified SubjectHome/UnitPage, drop kind branching"
```

---

## Task 10 — `scripts/migrate-from-sprout.mjs`: one-time cutover data migration

Runs **locally only** (needs service-role keys of BOTH projects — sprout's must never reach
Vercel). Copies `cubad_sync` rows into `legacy_sync` and every object of sprout's `podcasts`
bucket into the new project's `podcasts` bucket. Safe to re-run (skip-existing on both sides).

- [ ] Create `scripts/migrate-from-sprout.mjs`:
  ```js
  #!/usr/bin/env node
  // scripts/migrate-from-sprout.mjs
  //
  // One-time cutover migration (00-MASTER-PLAN.md §13 step 2). Run LOCALLY (needs service-role
  // keys for BOTH projects — never put SPROUT_SERVICE_KEY in Vercel). Copies:
  //   1. every row of sprout's `cubad_sync` table -> the new project's `legacy_sync` table
  //      (id/state/updated_at preserved exactly; `claimed_by` stays null).
  //   2. every object in sprout's public `podcasts` bucket -> the new project's `podcasts`
  //      bucket (same path; skips objects that already exist at the destination, so the
  //      script is safe to re-run after a partial failure).
  //
  // Usage:
  //   SPROUT_URL=https://rywcdqpnwwumbpubkofc.supabase.co \
  //   SPROUT_SERVICE_KEY=... \
  //   NEXT_PUBLIC_SUPABASE_URL=https://<new-project>.supabase.co \
  //   SUPABASE_SERVICE_ROLE_KEY=... \
  //   node scripts/migrate-from-sprout.mjs
  //
  // Expected output ends with a summary block, e.g.:
  //   === migration summary ===
  //   sync rows copied: 42
  //   storage objects found: 118
  //   storage objects copied: 110
  //   storage objects skipped (already existed): 8
  //   storage objects FAILED: 0

  import { createClient } from "@supabase/supabase-js";

  function requireEnv(name) {
    const v = process.env[name];
    if (!v) {
      console.error(`missing required env var ${name}`);
      process.exit(1);
    }
    return v;
  }

  const SPROUT_URL = requireEnv("SPROUT_URL");
  const SPROUT_KEY = requireEnv("SPROUT_SERVICE_KEY");
  const NEW_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const NEW_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const BUCKET = "podcasts";
  const PAGE_SIZE = 1000; // PostgREST's hard row cap — always paginate, never trust one page

  const sprout = createClient(SPROUT_URL, SPROUT_KEY, { auth: { persistSession: false } });
  const target = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

  async function migrateSyncRows() {
    console.log("\n--- copying cubad_sync -> legacy_sync ---");
    let from = 0;
    let copied = 0;
    for (;;) {
      const { data, error } = await sprout
        .from("cubad_sync")
        .select("id, state, updated_at")
        .range(from, from + PAGE_SIZE - 1)
        .order("id", { ascending: true });
      if (error) throw new Error(`reading cubad_sync: ${error.message}`);
      if (!data || data.length === 0) break;

      const { error: upsertError } = await target
        .from("legacy_sync")
        .upsert(
          data.map((r) => ({ id: r.id, state: r.state, updated_at: r.updated_at })),
          { onConflict: "id" }
        );
      if (upsertError) throw new Error(`writing legacy_sync: ${upsertError.message}`);

      copied += data.length;
      console.log(`  copied ${copied} rows so far...`);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    console.log(`sync rows copied: ${copied}`);
    return copied;
  }

  /** Recursively list every FILE (not folder) under `prefix` in a bucket. */
  async function listAllFiles(client, bucket, prefix = "") {
    const files = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await client.storage.from(bucket).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const p = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Supabase Storage returns folders as entries with id: null and no metadata
        if (entry.id === null && !entry.metadata) {
          files.push(...(await listAllFiles(client, bucket, p)));
        } else {
          files.push(p);
        }
      }
      if (data.length < 100) break;
      offset += 100;
    }
    return files;
  }

  async function copyOneFile(p, stats) {
    // skip-existing: don't re-download/re-upload objects already present at the destination
    const dir = p.split("/").slice(0, -1).join("/");
    const filename = p.split("/").pop();
    const { data: already } = await target.storage.from(BUCKET).list(dir, { search: filename });
    if (already?.some((f) => f.name === filename)) {
      stats.skipped++;
      console.log(`  skip (exists): ${p}`);
      return;
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // one file in memory at a time — never the whole bucket — so this stays cheap even
        // for a library with hundreds of podcasts. True end-to-end byte streaming (piping the
        // download response straight into the upload request) was considered and rejected as
        // unnecessary complexity for audio files of this size (a few MB each); revisit if the
        // library grows to the point that per-file memory becomes a real constraint.
        const { data: blob, error: downloadError } = await sprout.storage.from(BUCKET).download(p);
        if (downloadError) throw new Error(downloadError.message);
        const buffer = Buffer.from(await blob.arrayBuffer());
        const contentType = p.endsWith(".json") ? "application/json" : "audio/wav";

        const { error: uploadError } = await target.storage
          .from(BUCKET)
          .upload(p, buffer, { contentType, upsert: false });
        if (uploadError) throw new Error(uploadError.message);

        stats.copied++;
        console.log(`  copied (${attempt > 1 ? `retry ${attempt}` : "ok"}): ${p} (${buffer.length} bytes)`);
        return;
      } catch (e) {
        if (attempt === MAX_ATTEMPTS) {
          stats.failed.push({ path: p, error: String(e) });
          console.error(`  FAILED after ${MAX_ATTEMPTS} attempts: ${p} — ${e}`);
          return;
        }
        console.warn(`  attempt ${attempt} failed for ${p} (${e}), retrying...`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  async function migrateStorage() {
    console.log("\n--- copying storage bucket 'podcasts' ---");
    const files = await listAllFiles(sprout, BUCKET);
    console.log(`storage objects found: ${files.length}`);

    const stats = { copied: 0, skipped: 0, failed: [] };
    // sequential on purpose: keeps memory flat and is gentle on both projects' storage APIs —
    // this is a one-time script, not a hot path.
    for (const p of files) {
      await copyOneFile(p, stats);
    }

    console.log(`storage objects copied: ${stats.copied}`);
    console.log(`storage objects skipped (already existed): ${stats.skipped}`);
    console.log(`storage objects FAILED: ${stats.failed.length}`);
    if (stats.failed.length) {
      console.log("failed paths:");
      stats.failed.forEach((f) => console.log(`  - ${f.path}: ${f.error}`));
    }
    return { found: files.length, ...stats };
  }

  async function main() {
    const syncCopied = await migrateSyncRows();
    const storage = await migrateStorage();

    console.log("\n=== migration summary ===");
    console.log(`sync rows copied: ${syncCopied}`);
    console.log(`storage objects found: ${storage.found}`);
    console.log(`storage objects copied: ${storage.copied}`);
    console.log(`storage objects skipped (already existed): ${storage.skipped}`);
    console.log(`storage objects FAILED: ${storage.failed.length}`);
    if (storage.failed.length > 0) {
      console.error(
        "\nSome storage objects failed — re-run this script (safe: already-copied objects are skipped) or investigate the errors above."
      );
      process.exit(1);
    }
  }

  main().catch((e) => {
    console.error("migration aborted:", e);
    process.exit(1);
  });
  ```
- [ ] Run it once (with real sprout + new-project service keys, locally, never committed):
  ```bash
  SPROUT_URL=https://rywcdqpnwwumbpubkofc.supabase.co \
  SPROUT_SERVICE_KEY=<sprout service role key> \
  NEXT_PUBLIC_SUPABASE_URL=<new project url> \
  SUPABASE_SERVICE_ROLE_KEY=<new project service role key> \
  node scripts/migrate-from-sprout.mjs
  ```
  Expected: the summary block, `storage objects FAILED: 0`, exit code 0.
- [ ] Run it a **second** time immediately after — expected: `storage objects copied: 0`,
      `storage objects skipped (already existed): <same count as before>` — proves
      idempotency.

**Manual verification:** Spot-check 2–3 rows in the new project's `legacy_sync` table against
the same ids in sprout's `cubad_sync` (state jsonb byte-identical); spot-check 2–3 podcast
files by downloading both copies and diffing bytes (`diff <(curl -s sprout-url) <(curl -s new-url)`).

**Failure modes:**
- **Storage copy timeouts:** the retry loop (3 attempts, 500ms/1s/1.5s backoff) covers
  transient network blips; a file that fails all 3 attempts is recorded in `stats.failed` and
  the script exits non-zero *after* printing the full summary (so you always get the count,
  never a silent partial run) — re-running is always safe (skip-existing).
- **PostgREST 1000-row cap silently truncating `cubad_sync`:** this is exactly why
  `migrateSyncRows` paginates with `.range()` in a loop instead of one `.select()` — do not
  "simplify" this back to a single unranged query.
- **Storage `list()` pagination:** Supabase Storage's `list()` defaults to 100 items per call
  — `listAllFiles` loops with `offset` until a short page confirms the end; don't assume a
  bucket with >100 objects returns everything in one call.

**Commit:** `git add scripts/migrate-from-sprout.mjs && git commit -m "phase-3: add sprout cutover migration script"`

---

## Task 11 — Interim content publish flow (pre-admin-dashboard)

Until Phase 5 ships the admin dashboard's upload UI, content updates go through a CLI script
that validates, upserts, bumps `version`, and revalidates the cache — the exact same building
block Phase 5's dashboard calls under the hood.

- [ ] Edit `scripts/validate-content.mjs` with these four small, additive changes (nothing
      existing is removed or renamed — this keeps `node scripts/validate-content.mjs` working
      exactly as it does today):

  **(a)** Near the top, export the diagnostics arrays and add a reset helper. Find:
  ```js
  const CONTENT_DIR = path.join(process.cwd(), "content");
  const SUBJECTS_FILE = path.join(CONTENT_DIR, "subjects.json");
  const errors = [];
  const warn = [];
  ```
  Replace with:
  ```js
  const CONTENT_DIR = path.join(process.cwd(), "content");
  const SUBJECTS_FILE = path.join(CONTENT_DIR, "subjects.json");
  export const errors = [];
  export const warn = [];

  /** Clears accumulated diagnostics — call before validating a new unit when this module is
   *  imported (scripts/upsert-unit.mjs validates one unit at a time and must not see stale
   *  errors/warnings from a previous call). The CLI path below doesn't need this — it runs
   *  once per process. */
  export function resetDiagnostics() {
    errors.length = 0;
    warn.length = 0;
  }
  ```

  **(b)** Prepend `export ` to exactly these 10 existing function declarations (no other change
  to their bodies): `isBi`, `checkBi`, `checkMcq`, `checkControlChars`, `walkStrings`,
  `checkChart`, `checkStory`, `checkWalkthroughQuestions`, `checkWalkthroughUnit`,
  `checkStudyUnit`. E.g. `function isBi(v) {` becomes `export function isBi(v) {`, and so on
  for the other nine.

  **(c)** Immediately after `checkStudyUnit`'s closing `}` (and before the `const subjects = ...`
  CLI section), insert a new exported dispatcher that `scripts/upsert-unit.mjs` will call:
  ```js
  /** Validates one already-parsed unit object against its subject's schema. Used both by this
   *  file's own CLI loop below and by scripts/upsert-unit.mjs (one unit at a time). Caller
   *  should call resetDiagnostics() first for a clean errors/warn array, then read the
   *  module-level `errors`/`warn` exports afterward. */
  export function checkUnit(u, sectionOrder, where) {
    if (!Number.isInteger(u.unit)) errors.push(`${where}: unit must be int`);
    if (typeof u.slug !== "string" || !/^[a-z0-9-]+$/.test(u.slug)) errors.push(`${where}: bad slug`);
    checkBi(u.title, `${where}.title`);
    checkBi(u.tagline, `${where}.tagline`);
    if (sectionOrder === "walkthrough") {
      checkWalkthroughUnit(u, where, { n: 0 });
    } else if (sectionOrder === "study") {
      checkStudyUnit(u, where);
    } else {
      errors.push(`${where}: unknown section_order "${sectionOrder}"`);
    }
    walkStrings(u, where, checkControlChars);
  }
  ```

  **(d)** Guard the CLI-execution tail so `import`ing this module for its exports doesn't also
  scan `content/` and call `process.exit()`. Add
  `import { pathToFileURL } from "node:url";` next to the existing `node:fs`/`node:path`
  imports at the top of the file, then wrap the existing bottom block (from
  `const subjects = fs.existsSync(SUBJECTS_FILE) ...` down through the final
  `console.log("content OK")`) in an `if (isMain) { ... }`, and add the guard just above it
  (this `pathToFileURL` comparison is the same pattern Phase 1's seed script uses — do NOT
  hand-build a `file://` string from `process.argv[1]`, see the failure-mode note below):
  ```js
  const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;

  if (isMain) {
    const subjects = fs.existsSync(SUBJECTS_FILE)
      ? JSON.parse(fs.readFileSync(SUBJECTS_FILE, "utf-8"))
      : [];

    if (subjects.length === 0) {
      console.error("no subjects found in content/subjects.json");
      process.exit(1);
    }

    let totalFiles = 0;
    const totalQRef = { n: 0 };

    for (const subject of subjects) {
      const dir = path.join(CONTENT_DIR, subject.slug);
      if (!fs.existsSync(dir)) {
        errors.push(`content/${subject.slug}: directory missing`);
        continue;
      }
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^unit-\d+\.json$/.test(f))
        .sort();

      if (files.length === 0) {
        errors.push(`content/${subject.slug}: no unit files found`);
        continue;
      }

      for (const f of files) {
        totalFiles++;
        let u;
        try {
          u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        } catch (e) {
          errors.push(`${subject.slug}/${f}: JSON parse error: ${e.message}`);
          continue;
        }
        const W = `${subject.slug}/${f.replace(".json", "")}`;
        checkUnit(u, subject.kind, W);
        if (subject.kind === "walkthrough") totalQRef.n += (u.questions ?? []).length;
      }
    }

    console.log(`checked ${subjects.length} subjects, ${totalFiles} files, ${totalQRef.n} walkthrough questions`);
    if (warn.length) {
      console.log(`\n${warn.length} warnings:`);
      warn.slice(0, 40).forEach((w) => console.log("  ⚠ " + w));
    }
    if (errors.length) {
      console.error(`\n${errors.length} ERRORS:`);
      errors.slice(0, 60).forEach((e) => console.error("  ✗ " + e));
      process.exit(1);
    }
    console.log("content OK");
  }
  ```
  (This reuses the new `checkUnit` dispatcher instead of the old inline
  `if (subject.kind === "walkthrough") checkWalkthroughUnit(...) else if (...) checkStudyUnit(...)`
  — same behavior, less duplication, and it's now the same code path
  `scripts/upsert-unit.mjs` uses.)
- [ ] `node scripts/validate-content.mjs` — expect **identical output** to before this edit
      (same "checked 2 subjects, 19 files, 65 walkthrough questions" style summary, same
      warnings, exit 0). This is the regression check for the refactor.
- [ ] Create `scripts/upsert-unit.mjs`:
  ```js
  #!/usr/bin/env node
  // scripts/upsert-unit.mjs
  //
  // Interim content-publish path (until Phase 5 ships the admin dashboard's upload UI — see
  // 00-MASTER-PLAN.md phase map). This is the SAME building block Phase 5's dashboard will
  // call under the hood, just invoked from the command line for now.
  //
  // Usage:
  //   node scripts/upsert-unit.mjs <subject-slug> <path-to-unit.json>
  // Example:
  //   node scripts/upsert-unit.mjs hidroloji ./content/hidroloji/unit-3.json
  //
  // Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and (to trigger
  // revalidation) REVALIDATE_SECRET + NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000).
  //
  // Expected output on success:
  //   validating hidroloji/unit-3.json against section_order "walkthrough"...
  //   content OK (0 errors, 1 warning(s))
  //   upserting hidroloji/unit-3 (version 4 -> 5)...
  //   revalidated content:hidroloji
  //   done.

  import fs from "node:fs";
  import path from "node:path";
  import { createClient } from "@supabase/supabase-js";
  import { checkUnit, errors, warn, resetDiagnostics } from "./validate-content.mjs";

  const [, , subjectSlug, unitPath] = process.argv;
  if (!subjectSlug || !unitPath) {
    console.error("usage: node scripts/upsert-unit.mjs <subject-slug> <path-to-unit.json>");
    process.exit(1);
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  async function main() {
    const absPath = path.resolve(process.cwd(), unitPath);
    if (!fs.existsSync(absPath)) {
      console.error(`file not found: ${absPath}`);
      process.exit(1);
    }
    let unit;
    try {
      unit = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    } catch (e) {
      console.error(`invalid JSON in ${absPath}: ${e.message}`);
      process.exit(1);
    }

    const { data: subject, error: subjectError } = await supabase
      .from("subjects")
      .select("id, slug, section_order")
      .eq("slug", subjectSlug)
      .maybeSingle();
    if (subjectError) {
      console.error(`looking up subject "${subjectSlug}": ${subjectError.message}`);
      process.exit(1);
    }
    if (!subject) {
      console.error(
        `no subject with slug "${subjectSlug}" — create it first (this script only upserts units, not subjects)`
      );
      process.exit(1);
    }

    console.log(
      `validating ${subjectSlug}/${path.basename(unitPath)} against section_order "${subject.section_order}"...`
    );
    resetDiagnostics();
    checkUnit(unit, subject.section_order, `${subjectSlug}/${unit.slug ?? "?"}`);

    if (warn.length) {
      console.log(`${warn.length} warning(s):`);
      warn.forEach((w) => console.log(`  ⚠ ${w}`));
    }
    if (errors.length) {
      console.error(`${errors.length} ERROR(S) — refusing to upsert:`);
      errors.forEach((e) => console.error(`  ✗ ${e}`));
      process.exit(1);
    }
    console.log(`content OK (0 errors, ${warn.length} warning(s))`);

    const { data: existing } = await supabase
      .from("units")
      .select("id, version")
      .eq("subject_id", subject.id)
      .eq("slug", unit.slug)
      .maybeSingle();

    const nextVersion = (existing?.version ?? 0) + 1;
    console.log(
      `upserting ${subjectSlug}/${unit.slug} (version ${existing?.version ?? "new"} -> ${nextVersion})...`
    );

    // is_free is deliberately NOT set here: omitting it from the payload means an INSERT gets
    // the column DEFAULT (false — locked by default, matching D7's paid-by-default intent for
    // brand-new content) and an UPDATE leaves the existing value untouched. Access-tier
    // decisions belong to the admin dashboard (Phase 5), not this content-only script.
    const { error: upsertError } = await supabase.from("units").upsert(
      {
        subject_id: subject.id,
        unit_number: unit.unit,
        slug: unit.slug,
        status: "published",
        content: unit,
        version: nextVersion,
      },
      { onConflict: "subject_id,slug" }
    );
    if (upsertError) {
      console.error(`upsert failed: ${upsertError.message}`);
      process.exit(1);
    }

    if (REVALIDATE_SECRET) {
      const url = `${APP_URL}/api/revalidate?secret=${encodeURIComponent(REVALIDATE_SECRET)}&subject=${encodeURIComponent(subjectSlug)}`;
      const res = await fetch(url);
      if (res.ok) {
        console.log(`revalidated content:${subjectSlug}`);
      } else {
        console.warn(
          `revalidate call failed (${res.status}) — content is saved in the DB but the cache may be stale until manually revalidated; call GET ${APP_URL}/api/revalidate?secret=...&subject=${subjectSlug}`
        );
      }
    } else {
      console.warn(
        "REVALIDATE_SECRET not set — skipping cache invalidation; new content will only appear once the cache entry is explicitly revalidated (it never expires on its own — see lib/content-db.ts's `revalidate: false`). Set REVALIDATE_SECRET and re-run, or call the revalidate route manually."
      );
    }

    console.log("done.");
  }

  main().catch((e) => {
    console.error("upsert-unit failed:", e);
    process.exit(1);
  });
  ```
- [ ] Create `app/api/revalidate/route.ts`:
  ```ts
  import { revalidateContent } from "@/lib/content-db";

  export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
      return Response.json({ revalidated: false, error: "invalid secret" }, { status: 401 });
    }
    const subject = searchParams.get("subject") ?? undefined;
    revalidateContent(subject);
    return Response.json({ revalidated: true, subject: subject ?? "all", now: Date.now() });
  }
  ```
- [ ] `npm run build` — expect success.
- [ ] End-to-end dry run against a real (dev/staging) Supabase project: bump a trivial field in
      a copy of `content/hidroloji/unit-1.json` (e.g. append a space to `tagline.en`, then
      remove it after testing), run
      `node scripts/upsert-unit.mjs hidroloji /path/to/edited-unit-1.json`, confirm the
      expected console output, then load `/s/hidroloji/unit/unit-1` and confirm the change is
      live immediately (no redeploy).

**Manual verification:**
1. Run the script with a deliberately broken unit (e.g. delete a required field like
   `finalAnswer`) — expect it to print `N ERROR(S) — refusing to upsert:` and exit 1 **without**
   touching the database (verify the `units` row's `version`/`updated_at` are unchanged).
2. Run `curl "http://localhost:3000/api/revalidate?secret=wrong"` — expect `401`.
3. Run `curl "http://localhost:3000/api/revalidate?secret=$REVALIDATE_SECRET&subject=hidroloji"`
   — expect `{"revalidated":true,"subject":"hidroloji",...}`.

**Failure modes:**
- **Windows path comparison in the `isMain` guard:** never hand-build the `file://` URL from
  `process.argv[1]` (e.g. `` `file://${process.argv[1].replace(/\\/g, "/")}` ``) — on Windows
  that yields `file://C:/...` (two slashes) while Node's `import.meta.url` is `file:///C:/...`
  (three), so the guard is always false (empirically verified on this machine), the validator
  silently does nothing (prints nothing, exits 0), and CI would falsely report success. A
  simple `.replace` of backslashes is insufficient — only `pathToFileURL(process.argv[1]).href`
  produces the exact URL form Node uses (correct slash count, drive-letter casing, and
  percent-encoding of special characters). Verify with `node scripts/validate-content.mjs` and
  confirm you see the real "checked N subjects..." output, not silence.
- **`REVALIDATE_SECRET` unset in prod:** the script degrades gracefully (warns, doesn't fail),
  but content changes will look "stuck" until someone calls the revalidate route manually —
  always set this env var before relying on this script in production.
- **Forgetting `resetDiagnostics()`:** since `errors`/`warn` are shared module-level arrays,
  calling `checkUnit` twice without resetting accumulates stale diagnostics from the previous
  call — `upsert-unit.mjs` always calls it; if you write a new caller, do the same.

**Commit:** `git add scripts/validate-content.mjs scripts/upsert-unit.mjs app/api/revalidate/route.ts && git commit -m "phase-3: add interim content publish flow (upsert-unit script + revalidate route)"`

---

## Task 12 — Cutover: Vercel env flip + smoke tests

Executes master §13. Do this only after Tasks 1–11 are merged and Task 10's data migration has
run successfully.

- [ ] **Vercel env var checklist** (Project Settings → Environment Variables, Production
      scope):
  - [ ] Add `NEXT_PUBLIC_SUPABASE_URL` = new project URL
  - [ ] Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` = new project anon key (not used by this phase's
        server code, but Phase 2's browser client needs it — add it now so Phase 2 doesn't
        need a second env-var round)
  - [ ] Add `SUPABASE_SERVICE_ROLE_KEY` = new project service role key (mark **sensitive**)
  - [ ] Add `REVALIDATE_SECRET` = a fresh long random value (mark **sensitive**)
  - [ ] Add `NEXT_PUBLIC_APP_URL` = `https://cubad.vercel.app` (or the real prod domain)
  - [ ] Confirm `GEMINI_API_KEY` is present and unchanged
  - [ ] **Do NOT delete** `SUPABASE_URL` / `SUPABASE_ANON_KEY` (sprout, old names) — leave them
        set, unused, for at least 60 days (master §13.4) as the rollback safety net (see
        Rollback section below for why this matters).
  - [ ] Deploy (merge this phase's branch to `main`, or trigger a redeploy of the current
        `main` if already merged).
- [ ] **Smoke tests, run against the live production URL immediately after deploy:**
  - [ ] Passcode sync round-trip: on device/browser A, set a real passcode in `SyncCard`, mark
        a question/practice item done, wait for sync (or force it). On device/browser B (or an
        incognito window), enter the SAME passcode, confirm the progress appears.
  - [ ] Podcast playback: open any insaat-yonetimi unit, generate a podcast (or replay an
        already-migrated one from Task 10), confirm audio plays.
  - [ ] Tutor: open `TutorPanel` on any unit/question, ask a question, confirm a response
        streams back (this phase didn't touch `/api/tutor`, but it's on the same deploy — a
        cheap, high-value smoke test).
  - [ ] Both subjects fully render: `/s/hidroloji` and `/s/insaat-yonetimi` home + at least one
        unit page each, with no console errors.
  - [ ] Quiz/practice/flashcards work end to end: complete a quiz on a hidroloji unit, answer a
        practice question and a flashcard review on an insaat-yonetimi unit, confirm progress
        persists across a hard refresh.
- [ ] If every smoke test passes, the cutover is complete — production now runs entirely on
      the new Supabase project. Sprout is left untouched (do not delete, disable, or downgrade
      it) for 60 days per master §13.4.

**Manual verification:** the smoke test list above **is** the verification for this task —
there is no separate check.

**Failure modes:**
- **A smoke test fails right after deploy:** do not debug in production under time pressure —
  immediately follow the Rollback section below (redeploy the last pre-cutover production
  build), then debug against a preview deployment.
- **Env var scoped to "Preview" instead of "Production" in Vercel:** the single most common
  cause of "works in preview, 503s in prod" — double-check the environment checkboxes on each
  var, not just that it exists.

**Commit:** none (this task is operational, not a code change — if you *do* need a follow-up
code fix during cutover, commit it normally and redeploy).

---

## Task 13 — Tests

- [ ] Confirm a test script exists: `grep '"test"' package.json`. If missing (Phase 1 should
      have added `"test": "vitest run"` — if it didn't, add it now, do not skip testing):
  ```json
  "scripts": {
    "test": "vitest run"
  }
  ```
- [ ] Create `lib/content-db.test.ts`:
  ```ts
  // lib/content-db.test.ts
  import { describe, it, expect, vi, beforeEach } from "vitest";

  // next/cache's unstable_cache/revalidateTag must be neutralized for unit tests — we're
  // testing the DATA MAPPING logic, not Next's cache machinery. Make unstable_cache a
  // pass-through and revalidateTag a spy.
  vi.mock("next/cache", () => ({
    unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
    revalidateTag: vi.fn(),
  }));

  const mockFrom = vi.fn();
  vi.mock("@/lib/supabase/server", () => ({
    createServiceRoleClient: () => ({ from: mockFrom }),
  }));

  // "server-only" throws when imported outside a React Server Component — stub it for tests.
  vi.mock("server-only", () => ({}));

  import { getSubjects, getUnits, toSubjectMeta, toUnit, revalidateContent } from "./content-db";
  import { revalidateTag } from "next/cache";

  function chain(finalData: unknown, finalError: unknown = null) {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) {
      builder[m] = vi.fn(() => builder);
    }
    // order()/maybeSingle() are the terminal calls in content-db.ts — make them awaitable.
    builder.order = vi.fn(async () => ({ data: finalData, error: finalError }));
    builder.maybeSingle = vi.fn(async () => ({ data: finalData, error: finalError }));
    return builder;
  }

  describe("toSubjectMeta / toUnit (pure mapping)", () => {
    it("maps a subject row into SubjectMeta, mirroring section_order into the deprecated kind field", () => {
      const row = {
        slug: "hidroloji",
        title: { tr: "Hidroloji", en: "Hydrology" },
        tagline: { tr: "t", en: "t" },
        section_order: "walkthrough" as const,
      };
      expect(toSubjectMeta(row)).toEqual({
        slug: "hidroloji",
        title: row.title,
        tagline: row.tagline,
        section_order: "walkthrough",
        kind: "walkthrough",
      });
    });

    it("passes the content column through verbatim as the Unit shape", () => {
      const content = { unit: 1, slug: "unit-1", title: { tr: "a", en: "a" }, tagline: { tr: "b", en: "b" } };
      expect(toUnit({ content } as never)).toBe(content);
    });
  });

  describe("getSubjects", () => {
    beforeEach(() => {
      mockFrom.mockReset();
    });

    it("queries only published subjects, ordered by sort, and maps every row", async () => {
      mockFrom.mockReturnValue(
        chain([
          {
            slug: "hidroloji",
            title: { tr: "H", en: "H" },
            tagline: { tr: "t", en: "t" },
            section_order: "walkthrough",
          },
          {
            slug: "insaat-yonetimi",
            title: { tr: "I", en: "I" },
            tagline: { tr: "t", en: "t" },
            section_order: "study",
          },
        ])
      );

      const subjects = await getSubjects();

      expect(mockFrom).toHaveBeenCalledWith("subjects");
      expect(subjects).toHaveLength(2);
      expect(subjects[0].section_order).toBe("walkthrough");
      expect(subjects[1].kind).toBe("study"); // deprecated alias mirrors section_order
    });

    it("throws (does not swallow) a Supabase error, so a real outage is visible, not silently empty", async () => {
      mockFrom.mockReturnValue(chain(null, { message: "network blip" }));
      await expect(getSubjects()).rejects.toThrow(/getSubjects/);
    });
  });

  describe("getUnits", () => {
    beforeEach(() => {
      mockFrom.mockReset();
    });

    it("returns [] when the subject itself isn't found/published, without querying units", async () => {
      mockFrom.mockImplementation((table: string) => (table === "subjects" ? chain(null) : chain([])));
      const units = await getUnits("does-not-exist");
      expect(units).toEqual([]);
    });

    it("returns unit.content verbatim for each row, ordered by unit_number", async () => {
      const unitA = { unit: 1, slug: "unit-1" };
      const unitB = { unit: 2, slug: "unit-2" };
      mockFrom.mockImplementation((table: string) =>
        table === "subjects" ? chain({ id: "subj-1" }) : chain([{ content: unitA }, { content: unitB }])
      );
      const units = await getUnits("hidroloji");
      expect(units).toEqual([unitA, unitB]);
    });
  });

  describe("revalidateContent", () => {
    it("revalidates only the subject's tag when a slug is given", () => {
      revalidateContent("hidroloji");
      expect(revalidateTag).toHaveBeenCalledWith("content:hidroloji", "max");
    });

    it("revalidates the shared list tag (which every subject's cache also carries) when called with no argument", () => {
      revalidateContent();
      expect(revalidateTag).toHaveBeenCalledWith("content:list", "max");
    });
  });
  ```
- [ ] `npx vitest run` — expect all tests green.
- [ ] Create `supabase/tests/probe-content-access.sql` (manual RLS/RPC negative-path probe —
      non-destructive, wrapped in a transaction that always rolls back):
  ```sql
  -- supabase/tests/probe-content-access.sql
  --
  -- Manual RLS/RPC gating probe for Phase 3 (00-MASTER-PLAN.md §12 rule 6: every task that
  -- touches access needs a negative-path verification). Non-destructive: everything happens
  -- inside one transaction that ends in ROLLBACK. Run with:
  --   psql "$DATABASE_URL" -f supabase/tests/probe-content-access.sql
  -- or paste into the Supabase SQL editor and run as one script (it still rolls back).
  --
  -- Expected output: a series of NOTICEs ending in "ALL PROBES PASSED". Any RAISE EXCEPTION
  -- means a probe failed — read the message, it names which assertion broke.

  begin;

  -- ---- fixtures: borrow real units, temporarily flip is_free so both cases exist ----
  do $$
  declare
    v_subject_id uuid;
    v_unit1_id uuid;
  begin
    select id into v_subject_id from public.subjects where slug = 'hidroloji';
    if v_subject_id is null then
      raise exception 'probe fixture missing: no subject "hidroloji" — run scripts/seed-content.mjs first';
    end if;

    select id into v_unit1_id from public.units where subject_id = v_subject_id and slug = 'unit-1';
    if v_unit1_id is null then
      raise exception 'probe fixture missing: no unit "hidroloji/unit-1"';
    end if;

    update public.units set is_free = false where id = v_unit1_id;
    update public.units set is_free = true where subject_id = v_subject_id and slug = 'unit-2';
  end $$;

  -- ---- probe 1: anon cannot read the locked unit's content ----
  set local role anon;
  do $$
  declare v_content jsonb;
  begin
    v_content := public.get_unit_content('hidroloji', 'unit-1');
    if v_content is not null then
      raise exception 'PROBE 1 FAILED: anon read locked unit content';
    end if;
    raise notice 'PROBE 1 passed: anon cannot read locked unit content';
  end $$;
  reset role;

  -- ---- probe 2: anon CAN read a free unit's content ----
  set local role anon;
  do $$
  declare v_content jsonb;
  begin
    v_content := public.get_unit_content('hidroloji', 'unit-2');
    if v_content is null then
      raise exception 'PROBE 2 FAILED: anon could not read a free unit''s content';
    end if;
    raise notice 'PROBE 2 passed: anon can read free unit content';
  end $$;
  reset role;

  -- ---- probe 3: anon CAN see the locked unit's metadata (title/is_free) via list_units_meta ----
  set local role anon;
  do $$
  declare v_row record;
  begin
    select * into v_row from public.list_units_meta('hidroloji') where slug = 'unit-1';
    if v_row.slug is null then
      raise exception 'PROBE 3 FAILED: anon cannot see the locked unit''s metadata at all';
    end if;
    if v_row.is_free is distinct from false then
      raise exception 'PROBE 3 FAILED: expected is_free=false in metadata, got %', v_row.is_free;
    end if;
    raise notice 'PROBE 3 passed: anon sees locked-unit metadata (is_free=%)', v_row.is_free;
  end $$;
  reset role;

  -- ---- probe 4: anon querying the base `units` table directly gets ZERO rows ----
  set local role anon;
  do $$
  declare v_count int;
  begin
    select count(*) into v_count from public.units;
    if v_count <> 0 then
      raise exception 'PROBE 4 FAILED: anon selected % row(s) directly from public.units (expected 0)', v_count;
    end if;
    raise notice 'PROBE 4 passed: anon gets 0 rows from a direct select on public.units';
  end $$;
  reset role;

  -- ---- probe 5: a random authenticated (non-admin) user is treated like anon for the locked unit ----
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  do $$
  declare v_content jsonb;
  begin
    v_content := public.get_unit_content('hidroloji', 'unit-1');
    if v_content is not null then
      raise exception 'PROBE 5 FAILED: a non-admin authenticated user read locked unit content';
    end if;
    raise notice 'PROBE 5 passed: non-admin authenticated user cannot read locked unit content';
  end $$;
  reset role;

  -- ---- probe 6: admin CAN read the locked unit's content (skips gracefully if no admin exists yet) ----
  do $$
  declare
    v_admin_id uuid;
    v_content jsonb;
  begin
    select p.user_id into v_admin_id from public.profiles p where p.role = 'admin' limit 1;
    if v_admin_id is null then
      raise notice 'PROBE 6 skipped: no admin profile exists yet (run Phase 2''s admin bootstrap first)';
    else
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
      set local role authenticated;
      v_content := public.get_unit_content('hidroloji', 'unit-1');
      if v_content is null then
        raise exception 'PROBE 6 FAILED: admin could not read locked unit content';
      end if;
      raise notice 'PROBE 6 passed: admin can read locked unit content';
      reset role;
    end if;
  end $$;

  raise notice 'ALL PROBES PASSED';

  rollback;
  ```
- [ ] Run it: `psql "$DATABASE_URL" -f supabase/tests/probe-content-access.sql` (or paste into
      the Supabase SQL editor). Expect `NOTICE`s for probes 1–5 (and 6 if an admin exists) and
      a final `ALL PROBES PASSED`, then confirm via a fresh `select is_free from units where
      slug='unit-1'` that the flip was rolled back (should read `true` again, the seeded
      value).
- [ ] **Manual checklist index** (all already enumerated in their owning tasks — this is just
      the roll-up so nothing gets missed at phase-end):
  - [ ] Task 4's manual verification (policies + probe script)
  - [ ] Task 5's manual verification (storage bucket + policy)
  - [ ] Task 6's manual verification (podcast generation/playback)
  - [ ] Task 7's manual verification (sync round-trip)
  - [ ] Task 9's full visual regression checklist (both subjects, every section)
  - [ ] Task 10's idempotency re-run check
  - [ ] Task 11's validation-failure + revalidate-route checks
  - [ ] Task 12's cutover smoke tests

**Failure modes:**
- **Vitest can't resolve `@/lib/supabase/server`:** confirm `vitest.config.ts` has the same
  `@` path alias as `tsconfig.json`'s `paths` — if Phase 1's Vitest setup is missing this,
  add a `resolve.alias` entry mirroring `tsconfig.json`.
- **`server-only` import breaks tests even after mocking:** make sure the `vi.mock("server-only", ...)`
  call appears **before** the `import ... from "./content-db"` line — Vitest hoists `vi.mock`
  calls automatically, but keep the mock declarations grouped at the top of the file to avoid
  relying on that hoisting behavior being invisible to a future reader.

**Commit:** `git add lib/content-db.test.ts supabase/tests/probe-content-access.sql package.json && git commit -m "phase-3: add content-db unit tests and RLS/RPC gating probe script"`

---

## Phase acceptance checklist

Run every one of these, in order, from `cubad/`:

- [ ] `npm run lint` — 0 errors.
- [ ] `npm run build` — succeeds; visually scan the route summary for `/`, `/s/[subject]`,
      `/s/[subject]/unit/[slug]`, its `quiz`/`cards`/`practice` children, `/s/[subject]/q/[id]`,
      `/s/[subject]/formulas` — none should be marked as a build-time error.
- [ ] `npx vitest run` — all green, including the new `lib/content-db.test.ts`.
- [ ] `node scripts/validate-content.mjs` — output unchanged from before this phase (same
      counts, same warnings, exit 0) — proves the Task 11 refactor didn't change validation
      behavior.
- [ ] `supabase db reset` (local) — every migration (Phase 1's + this phase's two) replays
      cleanly from scratch.
- [ ] `psql "$DATABASE_URL" -f supabase/tests/probe-content-access.sql` — `ALL PROBES PASSED`.
- [ ] Full Task 9 visual regression checklist — every box ticked, both subjects.
- [ ] Task 12's cutover smoke tests — every box ticked, against the live production URL.
- [ ] `grep -rn "kind ===" app/ components/` — zero matches (confirms every `kind`-branch was
      actually replaced, not just supplemented).
- [ ] `grep -rn "from \"@/lib/content\"" app/` (the non-`-db` module) — zero matches; only
      `lib/content.test.ts`-style fixture consumers (if any exist) may still import it.

## Rollback

Sprout is left completely untouched for 60 days (master §13.4) — nothing about this phase is
destructive to it. Rollback is a **code + env** revert, not an env-only flip, because this
phase's routes read *new* env var names (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) that don't exist in the pre-phase-3 code at all — reverting only
the env vars would leave the new code with nothing to read.

1. In Vercel, find the last successful production deployment *before* this phase's merge
   (Deployments tab, sorted by date) and use "Promote to Production" (or `vercel rollback`
   from the CLI) to redeploy that exact build.
2. Because the OLD env vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY` pointing at sprout) were never
   deleted (per the Task 12 checklist — this is precisely why that instruction matters), the
   rolled-back code immediately works again: it reads those old names and talks to sprout,
   exactly as it did before this phase.
3. No database cleanup is needed on the new project — it simply becomes unused until the next
   cutover attempt; nothing there conflicts with sprout being the live source of truth again.
4. Re-attempt cutover only after fixing whatever smoke test failed, on a preview deployment,
   not directly in production.

## Changelog / deviations

<!-- Executing agents: record any deviation from this plan here, with date and reasoning, per
     00-MASTER-PLAN.md §11 ("Plan vs reality: reality wins; smallest compliant deviation;
     record it."). Entries below dated before phase execution are plan-authoring fixes, not
     execution deviations. -->

- **2026-07-16 — post-audit plan fixes (applied before execution, per coordinator audit):**
  1. `revalidateTag` corrected to the required two-argument form
     `revalidateTag(tag, "max")` throughout (Task 3 `revalidateContent` + code comments +
     Task 13 Vitest assertions). The original draft's claim that the two-arg form "is a
     no-op without cacheComponents" was FALSE — the installed
     `node_modules/next/dist/server/web/spec-extension/revalidate.d.ts` declares
     `revalidateTag(tag: string, profile: string | CacheLifeConfig): undefined` (2nd arg
     required; single-arg is deprecated and a TS2554 build error under strict tsconfig), and
     `revalidateTag.md` recommends `'max'` outside Cache Components too.
  2. Task 11's `isMain` guard rewritten to
     `import.meta.url === pathToFileURL(process.argv[1]).href` — the hand-built
     `` `file://${...replace(/\\/g,"/")}` `` form yields `file://C:/...` vs Node's
     `file:///C:/...` and was empirically verified always-false on Windows (silent validator
     no-op). Failure-mode note updated accordingly.
  3. Tasks 4/5 migrations now created via `npx supabase migration new content_read_policies`
     / `npx supabase migration new podcasts_storage` (timestamped filenames, referred to by
     name) per master §14 — the draft's hand-numbered `0003_`/`0004_` prefixes sorted before
     Phase 1's timestamped migrations and would have broken `supabase db reset` ordering.
     Task 4+5 commit step updated to glob filenames.
  4. Verified all service-role client usages are the canonical `createServiceRoleClient()`
     from `@/lib/supabase/server` (master §14); Prerequisites paragraph updated to cite §14
     as binding instead of treating the export name as an open Phase 1 assumption.

- **2026-07-18 — execution record / required deviations:**
  1. Applied the Task 4 and Task 5 migrations to the existing Cubad project
     `qjcaangaxpkihxxzexpq` with the authenticated Supabase CLI; no project was created or
     replaced. The deployment finished successfully despite a non-fatal CLI certificate-cache
     warning after the migration command completed.
  2. The RLS probe uses the real seeded slugs `giris` and `yagis`, not the illustrative
     `unit-1`/`unit-2` names in the plan. Its `RAISE NOTICE` statements are wrapped in a
     `DO` block, and the script ends with an explicit result row because the management-query
     response does not surface notices.
  3. Added the missing `@/*` Vitest alias needed to import the new server-only content layer.
     The content validator adds an explicit `process.argv[1]` guard so it remains safely
     importable under Node ESM evaluation.
  4. The local Supabase runtime lacked its normal `storage` schema baseline. For local reset
     testing only, the bundled storage baseline was applied to the local Docker database with
     role installation disabled; `supabase db reset` then completed and all six project
     migrations were recorded. No remote migration was changed or re-applied.
  5. The remaining `kind === \"bar\"` checks belong to the independent chart-series schema in
     `components/Chart.tsx`; the deprecated `SubjectMeta.kind` UI forks are removed. Renaming
     chart content is outside this phase and would alter unrelated content semantics.
  6. Task 13 automated gates were run before the Task 12 PR/merge closeout because the plan
     requires Tasks 1–11 to be merged before cutover but also requires those gates for the PR.
     Post-merge production verification remains a required closeout step.
  7. A one-time Vercel CLI link operation downloaded a development `.env.local`; it was not
     opened, printed, staged, or committed and was immediately removed. Future Vercel work uses
     the existing `cubad` project only.
  8. GitHub Actions required the Cubad build values as masked repository secrets for the existing
     CI workflow. A PowerShell stdin submission added a BOM, producing a `ByteString` CI failure;
     the values were replaced via the installed `gh` executable's direct secret-body path after
     removing that BOM. No secret was printed or committed.
  9. Preview variables are branch-scoped in the existing Vercel project. The initial Preview
     deployment raced its branch configuration, so the three Cubad build values were explicitly
     added to both Phase 3 Preview branches and each Preview was redeployed. The global sensitive
     `REVALIDATE_SECRET` was not read or modified.
  10. The first post-merge production smoke test found that a persisted quiz score was not visible
      after a fresh reload. The deployment was immediately rolled back, then the smallest compliant
      corrective change (`4f98a49`) exposed the saved result. It passed Preview refresh testing,
      merged as PR #5, and passed the production refresh test before final promotion.
  11. The rollback left `cubad.vercel.app` attached to the earlier deployment even after the fixed
      production build was Ready. The fixed, existing-project deployment was explicitly promoted;
      inspection then resolved the public domain to the `74c9a3e` deployment. No project or alias
      replacement was created.
  12. After the Sprout migration's row/object integrity and idempotency checks completed, the
      product decision changed from passcode-based sync to authenticated-account sync. The manual
      `SyncCard`, passcode import form, SHA-256 helper, and unauthenticated `/api/sync` route are
      retired; `legacy_sync` rows remain intact as historical migrated data. `SyncManager` now
      merges account state through authenticated `/api/state` on sign-in, route load, and local
      study-state changes. This supersedes the plan's Task 7 and Task 12 passcode round-trip
      checks; it does not alter the Phase 2 capability-scoped Sprout RLS repair or the 60-day
      credential rollback window.
  13. A post-cutover authenticated-sync audit found that the hosted project had inherited SQL
      table grants which a fresh local Supabase stack does not. Two additive migrations now make
      the intended RLS behavior explicit: catalogue tables grant `SELECT` to `anon` and
      `authenticated` (with RLS still filtering rows), and `user_state` grants only
      `SELECT`/`INSERT`/`UPDATE` to `authenticated` (with the existing own-row RLS policies still
      enforcing `user_id = auth.uid()`). Both were applied to the existing Cubad project and
      verified with a clean `supabase db reset`, seed, and transactional local/remote probes.
  14. The same audit hardened account sync without restoring the retired passcode path: a browser
      account marker clears the prior account's local projection on account switch and sign-out;
      sync/reset operations are serialized and bind to the captured authenticated identity; and
      normal `/api/state` writes use `updated_at` compare-and-swap with a bounded 409
      merge/retry loop. A reset is the sole explicit forced overwrite for its already-captured
      owner. No Sprout credential, Vercel value, revalidation secret, or user production state was
      accessed or changed for this audit.
  15. The fresh local storage negative-path check was denied by RLS. This Storage API version
      wraps the internal `403` authorization decision in HTTP `400`; the response's own status was
      `403` and no object was created. The policy outcome, rather than that transport wrapper, is
      the security gate. The accepted nine-warning React lint waiver remains unchanged.
  16. The audit shipped in PR #11 after GitHub CI passed its final run. An automated review caught
      one additional queued-reset account-capture edge; it was fixed and regression-tested before
      merge. The existing Vercel project deployed the merged `main` commit successfully, and the
      production public/API boundary/podcast smoke checks passed. The new Preview branch repeated
      the known missing-Preview-Supabase-value prerender failure; no environment value was read or
      changed, and the documented administrative merge override was used.
