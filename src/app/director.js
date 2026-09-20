/* ===============================================================
   Director / school owner dashboard.

   Read-mostly by design: the director sees everything happening in
   their school but does not edit academic records. The one
   administrative action given here is deactivating or reinstating a
   member of staff, which goes through set_staff_active() — that
   function enforces the rules (not yourself, not another admin, never
   the last admin) and writes the audit entry.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { onDataChanged } from "../lib/realtime.js";

const naira = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

export default async function render({ outlet }) {
  if (!requireRole(outlet, "director", "admin")) return;

  const body = h("div.u-stack");
  mount(outlet, page({
    title: "School overview",
    subtitle: "Everything happening across the school, at a glance.",
    body,
  }));
  mount(body, skeleton(6));
  onDataChanged(() => load());

  await load();

  async function load() {
    try {
      const [overviewRows, activity, staff, performance] = await Promise.all([
        unwrap(await supabase.rpc("director_overview"), "overview"),
        unwrap(await supabase.rpc("recent_school_activity", { p_limit: 12 }), "activity"),
        unwrap(await supabase.from("staff")
          .select("id, full_name, staff_code, position, is_active, roles")
          .order("full_name"), "staff"),
        unwrap(await supabase.rpc("director_class_performance"), "class performance"),
      ]);
      draw(Array.isArray(overviewRows) ? overviewRows[0] : overviewRows, activity, staff, performance);
    } catch (err) {
      logError("director load", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function draw(o, activity, staff, performance) {
    if (!o) return mount(body, emptyState({ title: "Nothing to show yet", body: "This school has no data recorded." }));

    const published = Number(o.classes_published || 0);
    const totalClasses = Number(o.classes_total_for_term || 0);

    mount(body,
      section("People", [
        kpi("Active students", o.students_active, `${o.students_total} on record`),
        kpi("Active staff", o.staff_active, `${o.staff_total} on record`),
        kpi("Classes", o.classes_total),
        kpi("Subjects", o.subjects_total),
      ]),
      section("Today's attendance", [
        kpi("Present", o.attendance_today_present),
        kpi("Absent", o.attendance_today_absent),
        kpi("Term attendance", o.attendance_rate_term != null ? `${o.attendance_rate_term}%` : "—"),
      ]),
      section("Fees this term", [
        kpi("Expected", naira(o.fees_expected)),
        kpi("Collected", naira(o.fees_collected)),
        kpi("Outstanding", naira(o.fees_outstanding)),
      ]),
      section("Academic activity", [
        kpi("Results published", `${published} / ${totalClasses}`, published < totalClasses ? "Some classes still in draft" : "All classes released"),
        kpi("Exams & tests", o.assessments_total),
        kpi("Homework set", o.assignments_total),
        kpi("Announcements (30 days)", o.announcements_recent),
      ]),
      performancePanel(performance),
      staffPanel(staff),
      activityPanel(activity),
    );
  }

  function section(title, cards) {
    return h("div", {},
      h("h2.card-title", { style: { margin: "18px 0 8px" }, text: title }),
      h("div.stat-grid", { style: { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" } }, cards),
    );
  }

  function kpi(label, value, note) {
    return h("div.card", { style: { padding: "14px" } },
      h("div.u-xs.u-muted", { text: label }),
      h("div", { style: { fontSize: "24px", fontWeight: "700", color: "var(--ama-green-deep)" }, text: String(value ?? "—") }),
      note ? h("div.u-xs.u-muted", { text: note }) : null,
    );
  }

  function performancePanel(rows) {
    const STATUS = { draft: ["badge", "Draft"], ready: ["badge-warn", "Ready"], published: ["badge-ok", "Published"] };
    return h("div", {},
      h("h2.card-title", { style: { margin: "18px 0 8px" }, text: "Performance by class" }),
      rows?.length
        ? h("div.card.card-flush", {}, h("div.table-wrap", {}, h("table.table", {},
            h("thead", {}, h("tr", {},
              h("th", { text: "Class" }), h("th.u-num", { text: "Students" }),
              h("th.u-num", { text: "Average score" }), h("th", { text: "Results" }))),
            h("tbody", {}, rows.map((r) => {
              const [cls, label] = STATUS[r.out_status] || STATUS.draft;
              return h("tr", {},
                h("td", { text: r.out_class }),
                h("td.u-num", { text: String(r.out_students) }),
                h("td.u-num", { text: r.out_average == null ? "—" : `${r.out_average}%` }),
                h("td", {}, h(`span.badge.${cls}`, { text: label })));
            })),
          )))
        : emptyState({ title: "No classes yet", body: "Class results appear here once scores are entered." }),
    );
  }

  function staffPanel(staff) {
    return h("div", {},
      h("h2.card-title", { style: { margin: "18px 0 8px" }, text: "Staff" }),
      h("div.card.card-flush", {}, h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Name" }), h("th", { text: "ID" }),
          h("th", { text: "Roles" }), h("th", { text: "Status" }), h("th", { text: "" }))),
        h("tbody", {}, staff.map((s) => h("tr", {},
          h("td", {}, h("div", { style: { fontWeight: "600" }, text: s.full_name }),
            h("div.u-xs.u-muted", { text: s.position || "" })),
          h("td.u-num", { text: s.staff_code }),
          h("td", {}, (s.roles || []).length
            ? h("div.u-row.u-wrap", { style: { gap: "4px" } }, s.roles.map((r) => h("span.badge.badge-info", { text: r })))
            : h("span.u-xs.u-muted", { text: "None" })),
          h("td", {}, h(`span.badge.${s.is_active ? "badge-ok" : "badge-warn"}`, { text: s.is_active ? "Active" : "Inactive" })),
          h("td", {}, h("div.u-row", { style: { justifyContent: "flex-end" } },
            h("button.btn.btn-ghost.btn-sm", {
              type: "button", text: s.is_active ? "Deactivate" : "Reinstate",
              onclick: (e) => toggleStaff(e.target, s),
            }))),
        ))),
      ))),
    );
  }

  async function toggleStaff(btn, s) {
    const ok = await confirmAction({
      title: s.is_active ? `Deactivate ${s.full_name}?` : `Reinstate ${s.full_name}?`,
      message: s.is_active
        ? "They will lose access to the portal immediately. Their records are kept."
        : "They will be able to sign in again.",
      confirmLabel: s.is_active ? "Deactivate" : "Reinstate",
      danger: s.is_active,
    });
    if (!ok) return;
    setBusy(btn, true, "…");
    try {
      unwrap(await supabase.rpc("set_staff_active", { p_staff_id: s.id, p_active: !s.is_active }), "set staff active");
      toastOk(s.is_active ? "Staff deactivated" : "Staff reinstated");
      await load();
    } catch (err) {
      toastError(humanError(err, "That staff member's status could not be changed."));
    } finally { setBusy(btn, false); }
  }

  function activityPanel(activity) {
    return h("div", {},
      h("h2.card-title", { style: { margin: "18px 0 8px" }, text: "Recent activity" }),
      activity?.length
        ? h("div.card.card-flush", {}, h("ul", { style: { listStyle: "none", margin: 0, padding: 0 } },
            activity.map((a) => h("li", { style: { padding: "12px 16px", borderBottom: "1px solid var(--ama-line)" } },
              h("div", { style: { fontWeight: "600" }, text: readable(a.action) }),
              h("div.u-xs.u-muted", { text: `${a.actor} · ${new Date(a.created_at).toLocaleString()}` }),
            ))))
        : emptyState({ title: "No activity yet", body: "Administrative actions will be listed here." }),
    );
  }

  function readable(action) {
    const map = {
      "results.published": "Results published",
      "results.unpublished": "Results unpublished",
      "results.ready": "Results marked ready for review",
      "attendance.taken": "Attendance taken",
      "attendance.corrected": "Attendance corrected",
      "attendance.record_changed": "An attendance record was changed",
      "staff.deactivated": "A staff member was deactivated",
      "staff.reactivated": "A staff member was reinstated",
      "staff.roles_changed": "Staff roles changed",
      "assignment.graded": "Homework graded",
      "login.provisioned": "A login was created",
      "parent.invited": "A parent was invited",
      "school.section_enabled": "A school section was switched on",
      "school.section_disabled": "A school section was switched off",
      "school.registered": "School registered",
    };
    return map[action] || action;
  }
}
