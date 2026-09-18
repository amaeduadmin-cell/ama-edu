# AMA EDU

Multi-tenant school management platform. One codebase and one Supabase
project serve every school; each school gets its own subdomain, its own
branding, and data that no other school can reach.

```
amaedu.com.ng            platform — marketing, registration, AMA EDU console
pas.amaedu.com.ng        Pariya Academy for Modern Science & Qur'an
pcp.amaedu.com.ng        Pariya Central Primary
<slug>.amaedu.com.ng     every other school
```

---

## Running it locally

```bash
npm install
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

| URL | What loads |
|---|---|
| `http://localhost:5173` | the platform site |
| `http://pas.localhost:5173` | the PAS portal |
| `http://pcp.localhost:5173` | the PCP portal |
| `http://localhost:5173/?tenant=pas` | fallback if `*.localhost` does not resolve |

`*.localhost` resolves to 127.0.0.1 without any hosts-file editing in
Chrome, Edge and Firefox. Safari needs a `/etc/hosts` line per slug. No
production DNS is involved either way.

---

## How a request becomes a school

`src/lib/tenant.js` is the only place in the codebase that reads the
hostname. Everything else asks it.

```
pas.amaedu.com.ng  ->  getCurrentTenantSlug()  ->  "pas"
                   ->  fetchTenantConfig("pas")     (public RPC)
                   ->  applyTenantBranding(school)  (sets --brand-* tokens)
```

The slug decides **what to fetch and what to paint**. It is never sent
to the database as a filter the database trusts. Every query is
constrained by RLS using the `school_id` carried in the caller's JWT, so
editing the hostname, `localStorage`, or a request body cannot reach
another school's rows. Frontend filtering is a convenience; the database
is the boundary.

Schools style themselves by setting `primary_color`, `secondary_color`,
`logo_url`, `favicon_url` and `motto` in their own settings. Those values
overwrite the `--brand-*` custom properties at runtime — no per-school
CSS, no per-school build, no per-school deployment.

---

## Layout

```
src/
  main.js              boot: resolve tenant, register routes, start router
  lib/
    tenant.js          hostname -> slug, slug validation, reserved words, branding
    supabase.js        client; auth storage namespaced per hostname
    auth.js            tenant-aware sign-in, session state, roles
    router.js          real-path routing (/dashboard, not #dashboard)
    dom.js             safe node construction — no innerHTML anywhere
    ui.js              toasts, modals, confirmations, fields, empty states
    errors.js          user-facing sentences vs. console detail
  styles/              tokens -> base -> components (+ marketing, lazy)
  pages/               public: landing, register, login, 404, school-not-found
  app/                 portal: shell + one module per feature
supabase/
  migrations/          SQL, applied in order
  functions/           Edge Functions
```

Route modules are dynamic imports. A parent opening `/my-report` never
downloads the score-entry, settings or charting code. That matters on
metered mobile data.

---

## Roles

| Role | Scope |
|---|---|
| AMA EDU platform admin | every school; registration, activation, subscriptions |
| School admin | one school, everything inside it |
| Headmaster / Principal | one school, their section's classes |
| Bursar | one school, fees |
| Teacher | one school, their own class+subject assignments |
| Registrar (primary / secondary) | one school, admissions |
| Student | their own record only |
| Parent | their linked children only |

One person can hold several roles; the sidebar is the union of them.
This is MyPAS1's behaviour, preserved.

---

## What changed from MyPAS1, and why

**Tenant identity threaded through login.** MyPAS1 signed people in with
`verify_staff_password(p_staff_code, p_password)` — no school. Staff codes
and admission numbers are only unique within a school, so on a platform
that RPC would have two candidate rows the moment a second school reused
a code, and would hand the browser a real session for whichever it
returned. Login now carries the school, and the shadow auth email is
namespaced: `staff.T001@pas.tenant.amaedu.internal`.

**No `innerHTML`.** MyPAS1 wrote roughly 140 fragments by interpolating
database values into HTML strings. In a single-school deployment that is
a contained stored-XSS risk. On a platform where any school can
self-register it becomes a cross-tenant one — hostile markup saved by one
school's admin would eventually run in a platform super admin's session,
the one account that can read every school. All rendering here builds
nodes and sets `textContent`.

**Announcements now load.** `app-announcements.js` and `app-realtime.js`
were never included in MyPAS1's `index.html`, so the Announcements tab
threw `ReferenceError` for every role that had it. Wired up properly.

**A build step.** MyPAS1 shipped 400 lines of inline CSS and five CDN
libraries on every page load, including the login screen. Vite gives code
splitting and real environment variables.

**Deploy target.** GitHub Pages allows one custom domain per repo and
cannot serve `*.amaedu.com.ng`. Cloudflare Pages can, and you are already
on Cloudflare DNS.

---

## Deploying to Cloudflare Pages

**Build settings**

| Setting | Value |
|---|---|
| Framework preset | None / Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 20 |

**Environment variables** (Settings → Environment variables, Production
and Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_ROOT_DOMAIN=amaedu.com.ng`.

**Custom domains** (Pages project → Custom domains): add `amaedu.com.ng`,
`www.amaedu.com.ng`, and `*.amaedu.com.ng`. The wildcard is what makes a
newly registered school reachable with no DNS change of your own.

**DNS** (the `amaedu.com.ng` zone):

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | `<project>.pages.dev` | Proxied |
| CNAME | `www` | `<project>.pages.dev` | Proxied |
| CNAME | `*` | `<project>.pages.dev` | Proxied |

Cloudflare's universal certificate covers `amaedu.com.ng` and
`*.amaedu.com.ng` — one level only, which is all this design uses.

`public/_redirects` serves `index.html` for every path so a hard refresh
on `/dashboard` works. `public/_headers` sets the security headers.

---

## Status

Every route in the design is now real — 42 modules, all parsing, all imports
resolved, no placeholders left anywhere in the codebase.

**Public / marketing** — landing page, three-step school registration,
find-my-school, platform and portal sign-in, password reset, 404,
unauthorized, school-not-found and suspended-school screens.

**School portal** — dashboard; students (search, admit, edit, deactivate,
provision logins); staff (same, plus role assignment); curriculum (subjects,
class offerings, teacher assignments); classes & score entry (grades and
positions computed in Postgres, never the browser); results (class positions
and per-subject rankings); report cards, master list and student detail (one
shared renderer so the printed artefact is identical everywhere it appears);
my report card (fee-gated for students); fees (admin sets amounts, bursar
records payments, fail-closed on missing payment rows); timetable (real
double-booking prevention, not app-level checking); certificates; analytics;
bulk import; settings (branding re-applies live, academic term switching,
admission scheme, password change for everyone); announcements.

**Platform console** — overview, schools list with search and status
control, and per-school detail with administrators, subscription plan, and
the same status controls scoped to one school.

## Database

Live in Supabase project `ybjwdkoxihxahzsgypug` (`amaeduDB1`), 30 tables, 15
numbered migrations. Pull them into this repo with `supabase link` then
`supabase db pull`.

**30 tables**, every school-scoped one carrying `school_id`:

| Area | Tables |
|---|---|
| Tenancy | `schools`, `school_members`, `platform_admins`, `reserved_slugs` |
| Academic | `sessions`, `terms`, `classes`, `subjects`, `class_subjects`, `grading_bands`, `score_weights` |
| People | `staff`, `students`, `parents`, `parent_students`, `class_teacher_subjects` |
| Assessment | `student_scores`, `student_term_summary`, `term_period_windows`, `subject_score_locks`, `score_unlock_requests` |
| Operations | `fee_structure`, `fee_payments`, `timetables`, `timetable_slots`, `announcements`, `announcement_reads`, `awards`, `school_websites`, `audit_log` |

RLS is **enabled and forced** on all 30, with policies granted to
`authenticated` only — never `anon`. Nothing is readable without a session.

### How isolation actually works

Policies never compare against a value the client sent. They call
`app.owns(school_id)`, which resolves the tenant from `auth.uid()` through
`school_members`:

```
auth.uid()  ->  school_members  ->  app.current_school_id()  ->  app.owns(row.school_id)
```

The helpers are `SECURITY DEFINER`, take no arguments, and `app.owns()`
explicitly `coalesce`s to `false` rather than ever returning `NULL` — so
there is nothing a caller can pass, and no ambiguous tenant state, that
resolves to anything but denial. Membership is writable only by the service
role for platform-level roles; school admins may grant staff-type roles
within their own school only (migration 0011).

### Reachable before sign-in

Five `SECURITY DEFINER` RPCs, each returning a deliberately narrow column
list for active schools only: `public_school_by_slug`, `is_slug_available`,
`search_public_schools`, `public_school_classes`, `resolve_login_identity`.
No roster, no result, no count. Every table is unreachable to `anon`.

### Edge Functions

| Function | JWT | Job |
|---|---|---|
| `register-school` | off (public signup) | Validates input, re-checks slug availability, creates the admin account, the school, its defaults and the membership row — unwinding all of it if any step fails |
| `provision-user` | on | Gives a staff member or student a shadow login. Reads the school from the target row and compares it to the caller's own tenant |

### How this was tested

Every write in this project was tested against the live database with real
impersonated sessions (`set local role authenticated` + a genuine `sub`
claim) before being considered done — not just "does the RLS policy exist"
but "does the button actually do what its confirmation dialog says." Test
fixtures were created and deleted in each round; none remain in the database.

Representative checks, run across the whole build: a school admin cannot
read, update, or insert into another school's `students`, `classes`,
`fee_payments`, `announcements`, `awards`, or `timetable_slots` — including
by exact UUID; a student sees zero scores with unpaid fees and their own
scores (never a classmate's) once settled; `anon` cannot read any of the 30
tables directly and can only reach the five narrow public RPCs; a teacher is
rejected writing to `awards` or `fee_structure`; a real database constraint
(`slots_no_double_booking`) stops the same teacher being scheduled into two
classes at once, and doesn't falsely block two different teachers in the
same slot; suspending a school as a platform admin immediately zeroes out
that school's own admin session; a school admin cannot read or modify
another school's row from the platform console's detail page.

**Two real bugs were found this way, not by inspection:**

1. `student_scores.grade` was always null — a `BEFORE` trigger read `total`,
   a `GENERATED ALWAYS ... STORED` column that Postgres populates *after*
   before-row triggers run. The trigger now computes the sum itself.
   (migration 0009)
2. `recompute_class_term`'s permission check used `IF NOT (...) THEN RAISE`
   in PL/pgSQL, where `IF NULL` silently takes the non-raising branch. A
   caller with no resolvable tenant produced `NULL` instead of `false` and
   sailed through. Reproduced the exact bypass, fixed the function, and
   closed the root cause in `app.owns()` itself so no future check built on
   it could inherit the same silent gap. (migration 0015)

**One design gap was found while building the UI it blocked**:
`school_members` had a read policy but no write policy, so an admin could
see roles but never grant one. Fixed with a tightly-scoped policy (own
school, staff roles only, staff row must belong to that school) and
verified with the same attack pattern as everything else: legitimate grant
succeeds, cross-school grant rejected, role-type smuggling rejected.
(migrations 0011–0012)

**One PostgREST default was closed**: `anon` could execute
`current_app_user()` and `recompute_class_term()`, because Postgres grants
`EXECUTE` on every new function to `PUBLIC` by default and explicit `GRANT`s
alone don't undo that. `PUBLIC` is now revoked everywhere and each function
granted deliberately, with default privileges set so future functions
inherit the same. (migration 0010)

**Two things only you can do:**

1. Turn on leaked-password protection: Supabase Dashboard → Authentication
   → Policies. It's a dashboard toggle, not something SQL can set.
2. Create your platform admin account. Sign up any way you like, then run
   this — it's service-role only by design, so no client can grant it:

   ```sql
   insert into public.platform_admins (user_id, full_name)
   select id, 'Your Name' from auth.users where email = 'you@example.com';
   ```

---

Copyright © AMAEdu 2026 All Rights Reserved!
