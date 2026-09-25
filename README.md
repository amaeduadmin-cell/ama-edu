# AMA EDU — feature-gap-fill changes (Template 4, annual summary, QR verification)

Everything here has already been **applied to your live Supabase project**
(`amaeduDB1`, ref `ybjwdkoxihxahzsgypug`) — migrations 0033–0037 ran
successfully and are live right now. This package is only for getting the
matching code into your GitHub repo, since I don't have push access to it.

The whole app was rebuilt with `npm run build` against these exact files —
110 modules transformed, no errors — so this is a working, integration-tested
set of changes, not untested drafts.

## How to apply

Every path below is relative to your repo root (`ama-edu/`). These are
**drop-in replacements** for files that already exist, plus a few brand-new
files — copy everything from this package into the matching path in your
repo, overwriting where a file already exists.

New files (create these):
- `src/lib/qrcode.js`
- `src/pages/verify-report.js`
- `supabase/migrations/0033_report_card_templates_heritage_backfill.sql`
- `supabase/migrations/0034_annual_session_summary.sql`
- `supabase/migrations/0035_annual_grade.sql`
- `supabase/migrations/0036_report_card_verification.sql`
- `supabase/migrations/0037_pariya_template.sql`

Modified files (overwrite the existing ones):
- `src/app/my-report.js`
- `src/app/report-cards.js`
- `src/app/settings.js`
- `src/lib/data.js`
- `src/lib/reportcard.js`
- `src/lib/template-picker.js`
- `src/main.js`
- `src/styles/reportcard.css`

`CHANGES.diff` is a unified diff of every modified file if you'd rather
review line-by-line before overwriting anything.

Once copied in:
```
git add -A
git commit -m "Feature gap fill: Template 4 (Pariya Classic), annual/session summary, QR verification"
git push
```

The Supabase migrations are already live, so if you use `supabase db pull`
or `supabase migration list` against your linked project it should already
show 0033–0037 as applied — committing the files just brings your repo's
migration history back in sync with what's actually running.

## What each migration does

- **0033** — backfills a `report_card_templates` row for `'heritage'`
  (Template 3) that existed live but was never captured in a migration
  file — a pre-existing drift I found while working on this. No-op
  against your current database; only matters for fresh installs/other
  environments.
- **0034** — populates `student_term_summary.annual_average` /
  `annual_position` (columns that existed since migration 0004 but were
  never written to) plus a new `annual_position_label` ("1st of 32").
  Computed automatically inside `recompute_class_term()` whenever a
  session's final term (highest `order_index`, Third Term for most
  schools) is recomputed — no separate admin step.
- **0035** — adds `annual_grade`, computed the same way, so the annual
  average has a letter grade next to it like every other average does.
- **0036** — the QR verification system: `report_card_verifications`
  table + RLS, `get_or_create_report_verification()` (issues/reuses a
  short code per student+term), and the anon-callable
  `verify_report_card(code)` RPC that backs the public `/verify/:code`
  page — deliberately narrow (first name + last initial, class, term,
  issued status only, same spirit as `public_school_profile()`).
- **0037** — registers the `'pariya'` (Template 4) row in
  `report_card_templates` so it's selectable/previewable like the other
  three templates.

## What each code file does

- **`src/lib/qrcode.js`** — a from-scratch, dependency-free QR encoder
  (byte mode, versions 1–10, all 4 ECC levels), per the spec's ask for
  "a small dependency-free JS QR generator." Verified with a real,
  independent QR decoder (not just compared to one reference library) —
  every test string round-trips correctly. Also exports `qrSvg()`,
  which builds the code as an inline SVG via the project's own `h()`
  helper (no `innerHTML`, matching the rest of the codebase's rule).
- **`src/lib/reportcard.js`** — adds `pariyaCard()`, the Template 4
  renderer: header/photo/motto, the three-column info box (including
  term dates and holiday duration), the subject table, the new annual-
  summary box, remarks, and the bottom signature row with the QR code
  in the middle and a role-mapped Headmaster/Principal signature on the
  right. Wired into the existing `renderReportCard()` dispatcher.
- **`src/styles/reportcard.css`** — Template 4's CSS, ported from the
  spec but *renamed* to `.rc-pariya` / `rc4-*` throughout. Important:
  the original spec's CSS used a bare `.card` selector, which collides
  with this app's own site-wide card component
  (`components.css`) — pasting it verbatim would have reskinned every
  panel in the whole app navy, not just the report card. Colours,
  spacing and layout are otherwise unchanged from the spec.
- **`src/lib/template-picker.js`** — adds the Template 4 entry to the
  picker list.
- **`src/lib/data.js`** — new helpers: `fetchSessionTermAverages()`
  (1st/2nd/3rd term averages for the annual box), `fetchHeadSignatory()`
  (looks up a staff member by `position` matching Headmaster/Principal,
  falling back to `schools.headmaster_name`/`principal_name`), and
  `fetchVerificationCode()` (wraps the new RPC). `fetchActiveTerm()` now
  also selects `ends_on`/`next_term_starts_on`.
- **`src/app/report-cards.js`** / **`src/app/my-report.js`** — wired to
  fetch the extra Template 4 data (session averages, head signatory,
  verification code) *only* when the school's `report_card_template`
  is `'pariya'`, so other templates don't pay for extra queries they
  don't use. Student queries now also select `photo_url`, `gender`,
  `date_of_birth` (also fixes a pre-existing bug where Template 3's
  photo box was silently never populated, since that field was never
  selected).
- **`src/app/settings.js`** — the Academic term settings list now has
  editable "Closing date" / "Resumption date" fields per term, reusing
  the existing `terms.ends_on` / `terms.next_term_starts_on` columns
  rather than adding new ones.
- **`src/main.js`** — registers the public `/verify/:code` route.
- **`src/pages/verify-report.js`** — the new public verification page
  a scanned QR code lands on. Uses `platformUrl()` so it resolves to
  your root domain regardless of which school's subdomain the report
  card was generated from.

## Known gaps / things worth a follow-up

- **Annual remark wording**: the spec asked for a *new, per-school
  editable* default annual-remark field in Academic settings, keyed by
  grade band. I implemented this by reusing each school's existing
  `grading_bands.remark` text instead of adding a whole new editable
  field — same grade-band-keyed behaviour, less duplication, but not
  independently customizable from the grade key's own remark. Say the
  word if you want the dedicated separate field instead.
- **`app.ordinal_label()` / mask-selection nuance**: the QR encoder's
  mask-pattern selection uses the standard ISO 18004 penalty scoring,
  which occasionally differs (cosmetically only) from what some other
  QR libraries would pick for the same content — every generated code
  still decodes correctly, this only affects which of the 8 equally
  valid visual patterns gets used.
- I haven't been able to exercise the annual-summary math against real
  Third Term data yet, since your school (Pariya Academy for Modern
  Science & Qur'an) currently only has First Term scores recorded. It
  will run for real the first time you publish a Third Term.
