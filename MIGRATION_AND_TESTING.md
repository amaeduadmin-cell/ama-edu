# Unlock Notifications, Analytics, and Live Verification

## Implemented

Migration `0044_unlock_notifications_and_analytics.sql` adds tenant-scoped in-app notifications, a `mark_notification_read` RPC, teacher- and subject-level unlock-request analytics, and a replacement resolution RPC that creates an in-app notification whenever an administrator approves or declines a request.

The teacher notification inbox is available at `/notifications`. The administrator score-control screen now includes request filters, search, affected-student review, approval and decline actions, and analytics tables for the active term.

## Live migration status

The linked Supabase project is `amaeduDB1` (`ybjwdkoxihxahzsgypug`, `eu-west-1`, healthy). The following migrations were applied successfully through the Supabase project connector:

```text
0043_feature_gap_foundations.sql
0044_unlock_notifications_and_analytics.sql
```

PostgREST probes confirmed that these objects are now present:

```text
public.notifications                 available
public.score_unlock_request_students available
public.mark_notification_read        available
public.unlock_request_analytics      available and admin-protected
public.submit_score_period            available and assignment-protected
public.request_score_unlock           available and assignment-protected
```

The probes also confirmed expected authorization behavior: unauthenticated calls to the analytics RPC are rejected with `Administrator access required`, and calls to the score submission/unlock RPCs without a valid assignment are rejected rather than changing data.

## End-to-end test scenario

Use two existing test accounts in the same school: one teacher assigned to a class/subject and one administrator. Do not create or copy real student data into a test environment.

1. The administrator opens the active term's CA1 window and confirms it is open.
2. The teacher enters a score for an existing student and saves it.
3. The teacher submits CA1. Confirm the corresponding `subject_score_locks` row is locked.
4. Confirm that a direct teacher score update is rejected by `app.guard_score_period_write()` while CA1 is locked.
5. The teacher opens the unlock-request modal, selects one or more existing affected students, supplies a reason, and submits.
6. The administrator opens Score control and confirms the request appears under Pending.
7. Confirm the request detail shows the class, subject, teacher, period, reason, and affected students.
8. Approve the request. Confirm:
   - `score_unlock_requests.status = 'approved'`;
   - `subject_score_locks.locked = false`;
   - one notification exists for the requesting teacher's authenticated user;
   - an `audit_log` row records `score_unlock_request.approved`.
9. Confirm the teacher sees the approval in `/notifications`, and can mark it read.
10. Repeat with a new request and decline it. Confirm the teacher receives a decline notification and the subject-period lock remains active.
11. Open the administrator analytics section and confirm teacher and subject aggregates reflect both outcomes.
12. Repeat the scenario with a second school account and confirm neither school can read the other school's requests, affected students, notifications, analytics, or audit rows.

## Authenticated fixture limitation

The live project currently has 5 schools, 5 active terms, 69 active classes, 9 active staff, and 42 active students. It has 2 active teacher memberships and 5 active administrator memberships, but no rows in `class_teacher_subjects`; therefore no teacher has a valid class/subject assignment available for a non-destructive end-to-end unlock test. The repository includes `scripts/check_supabase.py` for the object and authorization probes. A full teacher/admin workflow test should be run after an administrator assigns a teacher to a class and subject in the normal application UI.

## Test assignment seed

The repository now includes `supabase/seed/001_unlock_workflow_teacher_assignment.sql`. It selects an existing active teacher, an existing active class with at least one active student, and an existing active subject from the same school, then inserts only the missing `class_teacher_subjects` assignment. It does not create accounts or student records. Review the returned row before keeping the transaction committed; change the final `commit;` to `rollback;` if the selected fixture is not appropriate.

After committing the seed, sign in as the selected teacher and administrator and run the workflow steps above. The current live data has aligned teacher/class/subject/student candidates in two schools, so this seed provides a valid starting point without inventing identity data.

## Section-specific fees

Administrators can configure independent default amounts for **Nursery, Primary, Junior Secondary (JSS), Senior Secondary (SS), and Islamiyya** under **Settings → Section fee schedule** for the active term. A class-specific amount entered from **Fees** overrides its section default. The database helper uses the same precedence for fee status and report-card fee checks.

## School application to live portal

Public registration now submits an application and does not create a tenant or store a password. Platform administrators open **Admin → Applications**, review the applicant list, approve or reject each application, and record a decision note when needed. To make an approved application live, create a Supabase Auth user using the applicant administrator email, then enter that Auth user UUID in the application card and select **Provision live portal**. The server-side provisioning function atomically creates the school, its selected academic sections and defaults, the administrator staff record, and the tenant membership.

The application migration `0042_school_applications.sql` and section-fee migration `0045_section_fees_and_portal_approval.sql` have been applied to the connected AMA EDU Supabase project. The live application queue is currently empty, and both feature tables plus the section fee helper have been verified.

## Academic settings deployment check

Academic settings loads several administrator-only RPCs in one request. The live project was missing `report_card_signatories`, `admission_scheme_preview`, and `staff_code_scheme_preview`, so the page correctly fell into its error state even though the frontend build passed. Migrations `0040_report_card_signatories.sql`, `0041_auto_admission_numbers.sql`, and `0042_staff_codes_and_default_passwords.sql` have now been applied to the live project. All RPC names called by the frontend and all referenced public tables were then checked against the live schema; the dependency audit found no remaining missing object.
