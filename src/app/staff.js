/* ===============================================================
   Staff directory — add/edit staff, assign roles, provision a login.

   Ports: renderStaffDirectory / saveStaff / provisionAuthAccount
   (MyPAS1 app-admin.js). Role assignment writes to school_members,
   which needed a new RLS policy (migration 0011) — the original
   only let admins READ that table. It's scoped so an admin can only
   grant staff-type roles, only to staff at their own school.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, inlineAlert, openModal, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { session } from "../lib/auth.js";

const ROLES = [
  ["admin", "Administrator"], ["headmaster", "Headmaster"], ["principal", "Principal"],
  ["bursar", "Bursar"], ["teacher", "Teacher"],
  ["registrar_primary", "Registrar (Nursery & Primary)"], ["registrar_secondary", "Registrar (JSS & SS)"],
];
const ROLE_LABEL = Object.fromEntries(ROLES);

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;

  const state = { search: "", staff: [], loading: true };
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Staff",
    subtitle: "Teachers, headmaster, principal, bursar and registrars.",
    actions: [h("button.btn.btn-primary", { type: "button", text: "Add staff", onclick: () => openStaffForm() })],
    body,
  }));

  await load();

  async function load() {
    state.loading = true; draw();
    try {
      state.staff = unwrap(
        await supabase.from("staff")
          .select("id, staff_code, full_name, email, phone, position, is_active, user_id, school_members(role)")
          .order("full_name"),
        "fetch staff"
      );
    } catch (err) {
      logError("load staff", err);
      state.error = humanError(err);
    } finally {
      state.loading = false; draw();
    }
  }

  function filtered() {
    const term = state.search.trim().toLowerCase();
    if (!term) return state.staff;
    return state.staff.filter((s) => s.full_name.toLowerCase().includes(term) || s.staff_code.toLowerCase().includes(term));
  }

  function draw() {
    if (state.loading) return mount(body, h("div.card", {}, skeleton(6)));
    if (state.error) return mount(body, errorState(state.error, load));

    const rows = filtered();
    mount(body,
      h("div.card.card-flush", {},
        h("div.u-row", { style: { padding: "16px", borderBottom: "1px solid var(--ama-line)" } },
          h("input.input.u-grow", { type: "search", placeholder: "Search by name or staff ID", value: state.search,
            oninput: (e) => { state.search = e.target.value; draw(); } })),
        rows.length ? table(rows) : h("div", { style: { padding: "16px" } }, emptyState({
          title: state.staff.length ? "No staff match" : "No staff yet",
          body: state.staff.length ? "Try a different name or ID." : "Add your first staff member to get started.",
        })),
      ));
  }

  function table(rows) {
    return h("div.table-wrap", {}, h("table.table", {},
      h("thead", {}, h("tr", {},
        h("th", { text: "Staff" }), h("th", { text: "ID" }), h("th", { text: "Roles" }),
        h("th", { text: "Login" }), h("th", { text: "Status" }), h("th", { text: "" }),
      )),
      h("tbody", {}, rows.map((s) => h("tr", {},
        h("td", {}, h("div", { style: { fontWeight: "600" }, text: s.full_name }), h("div.u-xs.u-muted", { text: s.position || "" })),
        h("td.u-num", { text: s.staff_code }),
        h("td", {}, s.school_members?.length
          ? h("div.u-row.u-wrap", { style: { gap: "4px" } }, s.school_members.map((m) => h("span.badge.badge-info", { text: ROLE_LABEL[m.role] || m.role })))
          : h("span.u-xs.u-muted", { text: "No role yet" })),
        h("td", {}, s.user_id ? h("span.badge.badge-ok", { text: "Active" }) : h("span.badge", { text: "Not set up" })),
        h("td", {}, s.is_active ? h("span.badge.badge-ok", { text: "Active" }) : h("span.badge.badge-warn", { text: "Inactive" })),
        h("td", {}, h("div.u-row", { style: { gap: "6px", justifyContent: "flex-end" } },
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Edit", onclick: () => openStaffForm(s) }),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: s.is_active ? "Deactivate" : "Reactivate", onclick: () => toggleActive(s) }),
        )),
      ))),
    ));
  }

  async function toggleActive(staff) {
    if (staff.user_id === session.userId) return toastError("You cannot deactivate your own account.");
    const ok = await confirmAction({
      title: staff.is_active ? "Deactivate this staff member?" : "Reactivate this staff member?",
      message: staff.is_active ? `${staff.full_name} will lose access and drop off class and subject assignments shown as active.` : `${staff.full_name} will regain access.`,
      confirmLabel: staff.is_active ? "Deactivate" : "Reactivate", danger: staff.is_active,
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("staff").update({ is_active: !staff.is_active }).eq("id", staff.id), "toggle staff");
      toastOk(staff.is_active ? "Staff deactivated" : "Staff reactivated");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }

  /* ---------------- Add / edit ---------------- */
  function openStaffForm(existing = null) {
    const isEdit = Boolean(existing);
    const nameInput = h("input.input", { value: existing?.full_name || "", required: true });
    const codeInput = h("input.input", { value: existing?.staff_code || "", required: true, autocapitalize: "characters" });
    const emailInput = h("input.input", { type: "email", value: existing?.email || "" });
    const phoneInput = h("input.input", { type: "tel", value: existing?.phone || "" });
    const posInput   = h("input.input", { value: existing?.position || "" });
    const errorSlot = h("div");
    const submit = h("button.btn.btn-primary", { type: "submit", form: "staffForm", text: isEdit ? "Save changes" : "Add staff" });

    const currentRoles = new Set((existing?.school_members || []).map((m) => m.role));
    const roleChecks = ROLES.map(([value, label]) => {
      const cb = h("input", { type: "checkbox", value, checked: currentRoles.has(value) });
      return { value, node: h("label.u-row", { style: { gap: "8px", fontWeight: "500" } }, cb, label), cb };
    });

    const close = openModal({
      title: isEdit ? "Edit staff" : "Add staff",
      wide: true,
      body: h("form", {
        id: "staffForm", novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          mount(errorSlot);
          const payload = {
            full_name: nameInput.value.trim(), staff_code: codeInput.value.trim(),
            email: emailInput.value.trim() || null, phone: phoneInput.value.trim() || null,
            position: posInput.value.trim() || null,
          };
          if (!payload.full_name) return mount(errorSlot, inlineAlert("Enter the staff member's full name."));
          if (!payload.staff_code) return mount(errorSlot, inlineAlert("Enter a Staff ID."));

          setBusy(submit, true, "Saving…");
          try {
            let staffId = existing?.id;
            if (isEdit) {
              unwrap(await supabase.from("staff").update(payload).eq("id", staffId), "update staff");
            } else {
              const row = unwrap(await supabase.from("staff").insert(payload).select("id").single(), "insert staff");
              staffId = row.id;
            }
            await syncRoles(staffId, isEdit ? existing.user_id : null, currentRoles, new Set(roleChecks.filter((r) => r.cb.checked).map((r) => r.value)));
            toastOk(isEdit ? "Staff updated" : "Staff added");
            close();
            await load();
          } catch (err) {
            mount(errorSlot, inlineAlert(humanError(err, "That Staff ID may already be in use.")));
          } finally {
            setBusy(submit, false);
          }
        },
      },
        errorSlot,
        h("div.form-grid.cols-2", {}, field({ label: "Full name", id: "stName", control: nameInput }), field({ label: "Staff ID", id: "stCode", control: codeInput })),
        h("div.form-grid.cols-2", {}, field({ label: "Email", id: "stEmail", control: emailInput }), field({ label: "Phone", id: "stPhone", control: phoneInput })),
        field({ label: "Position", id: "stPos", control: posInput, hint: "Shown on certificates and letters, e.g. \"Mathematics Teacher\"." }),
        h("div.field", {}, h("label", { text: "Roles" }), h("div.u-stack", { style: { gap: "6px" } }, roleChecks.map((r) => r.node))),
        isEdit ? loginSection(existing) : null,
      ),
      actions: [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }),
        submit,
      ],
    });
  }

  /** Diff the checked roles against what's stored and write only the change. */
  async function syncRoles(staffId, userId, before, after) {
    const toAdd = [...after].filter((r) => !before.has(r));
    const toRemove = [...before].filter((r) => !after.has(r));
    if (toAdd.length && !userId) {
      // No account yet to attach a role to — role rows need a user_id.
      // They'll be added once a login is created; nothing to do yet.
      return;
    }
    if (toAdd.length) {
      unwrap(await supabase.from("school_members").insert(
        toAdd.map((role) => ({ school_id: session.schoolId, user_id: userId, role, staff_id: staffId }))
      ), "grant roles");
    }
    if (toRemove.length) {
      unwrap(await supabase.from("school_members").delete().eq("staff_id", staffId).in("role", toRemove), "revoke roles");
    }
  }

  function loginSection(staff) {
    const pw = h("input.input", { type: "password", minlength: "6", placeholder: "New password", autocomplete: "new-password" });
    const roleSel = h("select.select", { style: { maxWidth: "200px" } }, ROLES.map(([v, l]) => h("option", { value: v, text: l })));
    const btn = h("button.btn.btn-outline.btn-sm", { type: "button", text: staff.user_id ? "Reset password" : "Create login" });
    const note = h("div.u-xs.u-muted");

    btn.addEventListener("click", async () => {
      if (pw.value.length < 6) return mount(note, inlineAlert("Enter a password of at least 6 characters."));
      setBusy(btn, true, "Working…");
      try {
        const { data, error } = await supabase.functions.invoke("provision-user", {
          body: { kind: "staff", table_id: staff.id, password: pw.value, role: roleSel.value },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toastOk("Login is ready");
        pw.value = "";
        await load();
      } catch (err) {
        mount(note, inlineAlert(humanError(err, "Could not set up the login.")));
      } finally { setBusy(btn, false); }
    });

    return h("div.u-mt-4", { style: { paddingTop: "16px", borderTop: "1px solid var(--ama-line)" } },
      h("h3", { text: "Sign-in", style: { marginBottom: "8px" } }),
      h("p.u-xs.u-muted", { text: `Staff ID ${staff.staff_code} is the sign-in ID.` }),
      !staff.user_id ? h("p.u-xs.u-muted", { text: "Creating a login also grants the role selected here — check the roles above first, or pick one now." }) : null,
      h("div.u-row", {}, !staff.user_id ? roleSel : null, pw, btn),
      note,
    );
  }
}
