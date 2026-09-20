# AMA EDU — how to redeploy this upgrade

Read this top to bottom once. The short version is at the end.

## 0. The situation

- **Your Supabase project is already upgraded.** Migrations 0017–0032 were applied
  directly to `amaeduDB1`, and the Edge Functions `register-school` (v3) and
  `provision-user` (v3) are already deployed. Your live website is therefore already
  talking to the new database while still running the OLD front-end code.
- What is left is the **front-end**: get the new files into GitHub, let Cloudflare
  build them, check, then release.
- **Do not overwrite your repository with the zip.** Your live project had things the
  zip you sent me did not (migration 0016 and the `invite-parent` function), so your
  GitHub repo is ahead of that zip. Apply this upgrade as a *patch on a branch* instead.

## 1. Supabase — what you have to do

**Nothing is required.** Please do NOT run `supabase db push` on this project:
the migration files are in the zip only as a record and for building a fresh copy.

Check only these (Dashboard → Edge Functions): `register-school` and `provision-user`
show version 3 and status Active. `invite-parent` is unchanged.

Secrets you already have and must keep: `RESEND_API_KEY`, `MAIL_FROM`, `ROOT_DOMAIN`.

Optional: Database → Extensions → enable `pg_cron`, then run once in the SQL editor to
close abandoned exam attempts every 10 minutes (the app also closes them itself when a
teacher opens results or a student returns, so this is a tidy-up, not a requirement):

    select cron.schedule('close-stale-attempts', '*/10 * * * *', $$select public.expire_stale_attempts()$$);

## 2. GitHub — apply the patch on a branch

Files: `ama-changes.patch` (all changes) and the zip (a full copy, for reference).

From the folder that holds your repository:

    git checkout -b upgrade/ama-edu-v2
    git apply --3way --whitespace=nowarn /path/to/ama-changes.patch

If git prints `error: ... does not match` or `lacks the necessary blob`, your files
differ from the ones I started from. Use this instead:

    git apply --reject --whitespace=nowarn /path/to/ama-changes.patch

That applies everything it can and writes the parts it could not place into `*.rej`
files. Open each `.rej`, and copy those lines into the matching file by hand, keeping
BOTH your newer code and the new lines. The files most likely to need this are the
ones you may have changed yourself: `src/main.js`, `src/app/shell.js`,
`src/app/staff.js`, `src/app/students.js`. Then:

    git status                      # look for leftover *.rej files and delete them
    git add -A
    git commit -m "AMA EDU upgrade: publication, attendance, exams, settings, director, CMS"
    git push -u origin upgrade/ama-edu-v2

**Files that are new** (safe to just copy in if you would rather not use a patch):
`functions/sitemap.xml.js`, `public/{logo,og-image,apple-touch-icon}.png`,
`public/robots.txt`, `src/app/{academic-settings,assessments,assignments,attendance,
director,my-exams,parent,publication}.js`, `src/app/platform/content.js`,
`src/lib/{functions,realtime,seo,template-picker}.js`, `src/pages/{blog,school-profile}.js`,
`src/styles/reportcard.css`, `supabase/functions/invite-parent/*`, and the migrations.

**Files that are changed** (compare before overwriting): `index.html`, `src/main.js`,
`src/app/{fees,my-report,report-cards,shell,staff,students}.js`,
`src/lib/{errors,reportcard}.js`, `src/pages/register.js`,
`src/styles/{components,marketing,tokens}.css`, and the two Edge Function
`index.ts` files under `supabase/functions/`.

## 3. Cloudflare Pages

1. Pushing the branch makes Cloudflare build a **Preview** deployment. Open
   Workers & Pages → your project → Deployments → the preview. **Read the build log.**
   This is the first time this code goes through a real `npm run build`; if it fails,
   the log names the file and line. Production is not touched until you merge.
2. Build settings do not change (build command `npm run build`, output `dist`).
3. Environment variables (Settings → Environment variables) — you should already have
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ROOT_DOMAIN=amaedu.com.ng`.
   They must exist for **Preview** as well as Production. The new `functions/` folder
   (dynamic sitemap) is picked up automatically and reuses these same variables.
4. On the preview URL, check: `/sitemap.xml` shows XML (not your home page);
   `/robots.txt`; and log in as an admin.
   If `/sitemap.xml` shows the home page, the Pages Function was not picked up: check
   Deployments → the deployment → Functions. As a stop-gap you can put a plain
   `public/sitemap.xml` back.
5. When the preview behaves, merge the branch into `main` (pull request). Cloudflare
   deploys production. If something is wrong: Deployments → the previous good
   deployment → **Rollback**. (Rolling back the front-end does not undo the database
   changes; see section 5.)

## 4. After it is live — do these in order

1. **Publish results.** Every class was set to Draft, so students and parents see no
   results yet. As administrator: Publish results → publish each class that is ready.
2. **Academic settings** (new page): confirm the assessment system (20/20/20/40 unless
   you change it), grading scale, remarks, and which report-card template you want.
3. **Add your Director**: Staff → Add staff → tick "Director / School owner" → Save →
   Edit → set a password → Create login.
4. Test with real accounts: one teacher (mark attendance for their form class), one
   student (open a test), one parent, and the Director.
5. Register a throw-away test school on the public site to confirm registration works,
   then ask me to remove it (or delete it from the platform admin).

## 5. What the OLD front-end does against the NEW database

If you roll the front-end back, the site still runs, but: results stay hidden until
published; editing a staff member's roles fails (roles moved from `school_members` to
`staff.roles`); and a score above its configured maximum is refused. These are the
intended new rules, so the fix is to deploy the new front-end, not to undo the database.

## 6. Not built / not verified — no surprises

- **Never run through `npm run build` by me** (no network in my environment). Every
  page was run in a simulated browser against a fake database and passes, but that is
  not a real build or a real browser.
- **A real staff/student login end to end** was not run (it needs a live sign-in). The
  database side and the Edge Function code are tested separately.
- **Realtime updates**: the signals are sent by the database, but I could not confirm
  a browser receives them. If they do not arrive, pages just need a refresh.
- Student **photo upload** is a link field (no storage bucket exists yet).
- Fee **receipts** and **fee categories** are not built.
- The payment gateway is configuration only; no charge is taken.
- **Directors** get one read-only overview page, not separate read-only copies of every page.
- Option shuffling (`shuffle_options`) is stored but not applied.

## Short version

1. Supabase: nothing to do.
2. GitHub: new branch → `git apply --3way ama-changes.patch` → fix any `.rej` → push.
3. Cloudflare: read the Preview build log → check `/sitemap.xml` → merge.
4. Then publish results class by class and test one login of each kind.
