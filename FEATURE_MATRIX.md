# AMA EDU / Pariya Central Feature Audit

| Feature | Pariya reference | AMA EDU status | Database/server support | UI support | Verified gap / decision |
|---|---|---|---|---|---|
| Staff salary tracker | `staff.salary_status`-style status flow | Only `staff.salary_amount` exists | No normalized payment table/RPC | No salary screen | **Missing**; add normalized tenant-scoped payments and admin UI |
| AI bulk score import | Paste class/subject score text, preview, commit | Student/staff CSV import only; score entry is per grid | Direct score upsert exists; no secure bulk RPC | No score-import UI | **Missing**; add dry-run/commit RPC and native UI |
| Score control | Lock/submit/unlock concepts | Existing `term_period_windows`, `subject_score_locks`, `score_unlock_requests`; score UI only reads locks and writes directly | Existing tables; no complete management RPC workflow verified | Partial teacher lock behavior; no admin console | **Partial**; complete server RPCs and UI without duplicate tables |
| Student transfer | Multi-student class transfer | Student edit can change `class_id`; no audit workflow | No transfer audit table/RPC verified | No transfer UI | **Missing**; add audited batch transfer |
| Class management | Create/edit/deactivate classes | Classes page is read-only; curriculum manages subjects | Existing `classes` table and FKs | No CRUD UI | **Missing**; add safe CRUD/deactivation |
| Unassigned students | Students without class | Student list filters assigned classes; no dedicated queue | `students.class_id` nullable | No queue/assignment UI | **Missing**; add operational screen |
| Timetable auto-generation | Generate slots from assignments | Manual grid editor; DB double-booking constraint exists | Existing timetable tables/constraint | No auto-generate/clear/export | **Partial**; add server-safe generator RPC/UI and exports |
| Timetable export | Print/export timetable | No export helper verified | Existing timetable data | No export controls | **Missing**; add printable/CSV and browser PDF/PNG path |
| Advanced certificates | Best student, recognition, testimonial | Awards CRUD and single certificate view already exist | `awards` table exists | Partial certificates UI | **Partial**; add specialized selection/generation while reusing awards |
| Smart exam distribution | Random question distribution | Existing random server-side distribution preview/start | Assessment RPCs exist; no anti-leak mode | No distribution mode/overlap preview | **Partial**; add mode and preview metadata server-side |
| AI question prompt | Prompt copy action | Question parser and bulk paste exist | No prompt storage needed | No prompt generator | **Missing**; add dynamic copy action |
| Question builder improvements | Edit/reorder/duplicate/collapse/marks/preview | Add, paste-many, delete only | Question table/RPCs exist | Partial question bank | **Partial**; extend UI and safe writes |
| CA → Exam question import | Reuse CA questions | No import action | Shared `assessment_questions` schema supports it | No UI/RPC | **Missing**; add server-side import RPC/UI |
| Bulk credential operations | Bulk resets/renumbering | Already implemented via Edge Function and migrations 0041/0042 | Secure Edge Function + RPCs exist | Student page exposes reset; staff flow to verify | **Do not duplicate**; audit and extend only if needed |
| Bulk import login provisioning | Provision imported logins | Import inserts records only; provision-user handles one record | Existing provisioning Edge Function | No optional bulk provisioning | **Partial**; add optional post-import provisioning workflow |
| School-wide fee overview | Aggregated fee view | Class-level fee management exists | Existing fee tables and fee status RPC | No school-wide overview | **Missing**; add aggregate view using existing tables |
| Position list | Printable ranking | Results page shows class/subject ranking | `student_term_summary` authoritative | No printable/export action | **Partial**; add print/export view |
| Annual report summary | Annual averages/grade/position | Implemented in migrations 0034/0035 and report-card template 4 | Server recomputation + summary fields | Template 4 displays it | **Do not duplicate**; verify and reuse |
| Holiday duration | Date difference on report card | `terms.ends_on` and `next_term_starts_on` already implemented | Existing columns | Template 4 displays it; settings edits dates | **Do not duplicate**; verify and reuse |
| QR report verification | QR/verification concept | Secure token/RPC/public `/verify/:code` implemented in 0036 | Narrow anon RPC and verification table | Template 4 QR and public page exist | **Do not duplicate**; verify and reuse |
| Website credential vault | Plain credential fields in reference | `school_websites` has URL/username/note only | No encrypted credential mechanism | No vault UI | **Missing**; add server-held encryption via Edge Function, never frontend-readable plaintext |

## Existing capabilities deliberately reused

AMA EDU already has tenant resolution, `app.owns(school_id)`, role-based RLS, score recomputation, score-period tables, timetable double-booking constraints, fee tables, awards, assessment/question-bank tables, secure credential provisioning, annual report summaries, holiday date fields, QR verification, and public report verification. The implementation must extend these capabilities rather than create parallel systems.

## Migration decision

The repository contains migration prefixes through `0042`, including two files sharing `0040` and two sharing `0042`. No existing migration will be edited or overwritten. New forward-only work should use a clearly unused next prefix after confirming the linked database migration history; provisionally this is `0043` for the local repository, subject to deployment-time reconciliation.

## Implementation order

1. Security and schema foundations: salary payments, transfers, score-control RPCs, bulk score import, timetable generation, assessment extensions, and encrypted website credentials.
2. Native operational UIs: salary, classes/unassigned/transfer, score control/import, timetable, fees, position list, certificates, assessment builder/distribution, and import provisioning.
3. Exports, accessibility, loading/error/confirmation states, and documentation.
4. Build validation plus live Supabase/RLS workflow tests where credentials and a linked project are available.
