/* ===============================================================
   Staff directory — add/edit staff, assign roles, provision a login.

   Ports: renderStaffDirectory / saveStaff / provisionAuthAccount
   (MyPAS1 app-admin.js). Roles are stored on staff.roles; migration
   0018 materialises them into school_members once a login exists, so
   a role can be assigned at the moment the staff member is created
   rather than only after an account is provisioned.
   =============================================================== */

import { h, mount, skeleton, setBusy, safeUrl } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { invokeFunction } from "../lib/functions.js";
import { emptyState, errorState, field, inlineAlert, openModal, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { session } from "../lib/auth.js";

const ROLES = [
  ["admin", "Administrator"], ["director", "Director / School owner"],
  ["headmaster", "Headmaster"], ["principal", "Principal"],
  ["bursar", "Bursar"], ["teacher", "Teacher"],
  ["registrar_primary", "Registrar (Nursery & Primary)"], ["registrar_secondary", "Registrar (JSS & SS)"],
];
const ROLE_LABEL = Object.fromEntries(ROLES);
const PAGE_SIZE = 25;

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;

  const state = { search: "", staff: [], loading: true, page: 0, total: 0, selected: new Set() };
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Staff",
    subtitle: "Teachers, headmaster, principal, bursar and registrars.",
    actions: [
      h("button.btn.btn-outline", { type: "button", text: "Bulk credential reset", onclick: () => openBulkResetModal() }),
      h("button.btn.btn-primary", { type: "button", text: "Add staff", onclick: () => openStaffForm() }),
    ],
    body,
  }));

  // Declared BEFORE the first await load(). They used to sit further down, so
  // when the first load finished and called draw(), draw() touched them while
  // they were still uninitialised ("Cannot access 'searchFocused' before
  // initialization"). The table still appeared, but the error was thrown out of a
  // finally block and search focus was never restored.
  let searchTimer;
  let searchFocused = false;
  let searchCaret = null;

  await load();

  async function load() {
    state.loading = true; draw();
    try {
      let q = supabase.from("staff")
        .select("id, staff_code, full_name, email, phone, position, signature_url, is_active, user_id, roles", { count: "exact" })
        .order("full_name");
      const term = state.search.trim();
      if (term) q = q.or(`full_name.ilike.%${term}%,staff_code.ilike.%${term}%`);
      const from = state.page * PAGE_SIZE;
      q = q.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      state.staff = data;
      state.total = count ?? data.length;
    } catch (err) {
      logError("load staff", err);
      state.error = humanError(err);
    } finally {
      state.loading = false; draw();
    }
  }

  function goToPage(delta) {
    const next = state.page + delta;
    if (next < 0 || next * PAGE_SIZE >= state.total) return;
    state.page = next;
    load();
  }

  function onSearchInput(value) {
    state.search = value;
    state.page = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  }


  function draw() {
    if (state.loading) { mount(body, h("div.card", {}, skeleton(6))); return; }
    if (state.error) return mount(body, errorState(state.error, load));

    const rows = state.staff;
    const from = state.total === 0 ? 0 : state.page * PAGE_SIZE + 1;
    const to = Math.min(state.total, state.page * PAGE_SIZE + rows.length);

    mount(body,
      h("div.card.card-flush", {},
        h("div.u-row", { style: { padding: "16px", borderBottom: "1px solid var(--ama-line)" } },
        h("input.input.u-grow#staffSearch", { type: "search", placeholder: "Search by name or staff ID", value: state.search,
            oninput: (e) => { searchCaret = e.target.selectionStart; onSearchInput(e.target.value); },
            onfocus: () => { searchFocused = true; }, onblur: () => { searchFocused = false; } })),
        state.selected.size ? h("button.btn.btn-danger.btn-sm", { type: "button", text: `Delete selected (${state.selected.size})`, onclick: () => deleteStaff([...state.selected]) }) : null,
        rows.length ? table(rows) : h("div", { style: { padding: "16px" } }, emptyState({
          title: state.total ? "No staff match" : "No staff yet",
          body: state.total ? "Try a different name or ID." : "Add your first staff member to get started.",
        })),
      ),
      h("div.u-row", { style: { justifyContent: "space-between" } },
        h("p.u-xs.u-muted", { text: state.total ? `${from}–${to} of ${state.total} staff` : "0 staff" }),
        state.total > PAGE_SIZE ? h("div.u-row", { style: { gap: "6px" } },
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "Previous", disabled: state.page === 0, onclick: () => goToPage(-1) }),
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "Next", disabled: to >= state.total, onclick: () => goToPage(1) }),
        ) : null,
      ),
    );

    if (searchFocused) {
      const input = document.getElementById("staffSearch");
      if (input) { input.focus(); if (searchCaret != null) input.setSelectionRange(searchCaret, searchCaret); }
    }
  }

  function table(rows) {
    const allSelected = rows.length > 0 && rows.every((staff) => state.selected.has(staff.id));
    const selectAll = h("input", { type: "checkbox", checked: allSelected, "aria-label": "Select all staff on this page" });
    selectAll.onchange = () => {
      rows.forEach((staff) => selectAll.checked ? state.selected.add(staff.id) : state.selected.delete(staff.id));
      draw();
    };
    return h("div.table-wrap", {}, h("table.table", {},
      h("thead", {}, h("tr", {},
        h("th", {}, selectAll),
        h("th", { text: "Staff" }), h("th", { text: "ID" }), h("th", { text: "Roles" }),
        h("th", { text: "Login" }), h("th", { text: "Status" }), h("th", { text: "" }),
      )),
      h("tbody", {}, rows.map((s) => h("tr", {},
        h("td", {}, h("input", { type: "checkbox", checked: state.selected.has(s.id), "aria-label": `Select ${s.full_name}`, onchange: (e) => { e.target.checked ? state.selected.add(s.id) : state.selected.delete(s.id); draw(); } })),
        h("td", {}, h("div", { style: { fontWeight: "600" }, text: s.full_name }), h("div.u-xs.u-muted", { text: s.position || "" })),
        h("td.u-num", { text: s.staff_code }),
        h("td", {}, s.roles?.length
          ? h("div.u-row.u-wrap", { style: { gap: "4px" } }, s.roles.map((role) => h("span.badge.badge-info", { text: ROLE_LABEL[role] || role })))
          : h("span.u-xs.u-muted", { text: "No role yet" })),
        h("td", {}, s.user_id ? h("span.badge.badge-ok", { text: "Active" }) : h("span.badge", { text: "Not set up" })),
        h("td", {}, s.is_active ? h("span.badge.badge-ok", { text: "Active" }) : h("span.badge.badge-warn", { text: "Inactive" })),
        h("td", {}, h("div.u-row", { style: { gap: "6px", justifyContent: "flex-end" } },
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Edit", onclick: () => openStaffForm(s) }),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: s.is_active ? "Deactivate" : "Reactivate", onclick: () => toggleActive(s) }),
          h("button.btn.btn-danger.btn-sm", { type: "button", text: "Delete", disabled: s.user_id === session.userId, onclick: () => deleteStaff([s.id]) }),
        )),
      ))),
    ));
  }

  async function deleteStaff(ids) {
    const selected = state.staff.filter((staff) => ids.includes(staff.id));
    const names = selected.map((staff) => staff.full_name).join(", ");
    const ok = await confirmAction({
      title: ids.length > 1 ? `Delete ${ids.length} staff members?` : "Delete this staff member?",
      message: `${names || `${ids.length} selected staff member${ids.length === 1 ? "" : "s"}`} and linked staff records will be permanently deleted. Export a backup first if you may need them later.`,
      confirmLabel: "Delete permanently",
      danger: true,
    });
    if (!ok) return;
    try {
      const count = unwrap(await supabase.rpc("delete_staff", { p_staff_ids: ids }), "delete staff");
      state.selected.clear();
      toastOk(`${count || ids.length} staff member${(count || ids.length) === 1 ? "" : "s"} deleted`);
      await load();
    } catch (err) { toastError(humanError(err)); }
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
      unwrap(await supabase.rpc("set_staff_active", { p_staff_id: staff.id, p_active: !staff.is_active }), "toggle staff");
      toastOk(staff.is_active ? "Staff deactivated" : "Staff reactivated");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }

  /* ---------------- Add / edit ---------------- */
  function openStaffForm(existing = null) {
    const isEdit = Boolean(existing);
    const nameInput = h("input.input", { value: existing?.full_name || "", required: true });
    const codeInput = h("input.input", { value: existing?.staff_code || "", required: true, autocapitalize: "characters", placeholder: isEdit ? "" : "Reserving the next ID…" });
    const codeHint = h("p.u-xs.u-muted");
    const emailInput = h("input.input", { type: "email", value: existing?.email || "" });
    const phoneInput = h("input.input", { type: "tel", value: existing?.phone || "" });
    const posInput   = h("input.input", { value: existing?.position || "" });
    const sigInput   = h("input.input", { type: "url", value: existing?.signature_url || "", placeholder: "https://…" });
    const sigPreview = h("div.u-row", { style: { gap: "8px", alignItems: "center", marginTop: "6px" } });
    const errorSlot = h("div");
    const submit = h("button.btn.btn-primary", { type: "submit", form: "staffForm", text: isEdit ? "Save changes" : "Add staff" });

    function paintSig() {
      const url = safeUrl(sigInput.value.trim());
      mount(sigPreview, url && /^https:/i.test(url)
        ? h("img", { src: url, alt: "Signature preview", style: { height: "34px", maxWidth: "160px", objectFit: "contain", border: "1px solid var(--ama-line)", borderRadius: "4px", background: "#fff" } })
        : sigInput.value.trim() ? h("span.u-xs", { style: { color: "var(--ama-danger)" }, text: "Must be an https:// link." }) : null);
    }
    sigInput.addEventListener("input", paintSig);
    paintSig();

    if (!isEdit) {
      // Reserves the number now so two admins adding staff at once can never
      // collide. A cancelled "Add staff" dialog leaves a small gap in the
      // sequence — harmless, and "Sync from existing records" in Academic
      // settings > Admission numbers fixes it in one click.
      (async () => {
        try {
          const rows = unwrap(await supabase.rpc("register_staff_code"), "register staff code");
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (row?.staff_code && !codeInput.value) {
            codeInput.value = row.staff_code;
            codeInput.placeholder = "";
            mount(codeHint, h("span", { text: "Suggested — you can type a different Staff ID instead." }));
          }
        } catch {
          codeInput.placeholder = "";
        }
      })();
    }

    const currentRoles = new Set(existing?.roles || []);
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
          // Roles travel WITH the record in one write, so a staff member is never
          // left half-created (saved, but without the roles the admin ticked).
          const payload = {
            full_name: nameInput.value.trim(), staff_code: codeInput.value.trim(),
            email: emailInput.value.trim() || null, phone: phoneInput.value.trim() || null,
            position: posInput.value.trim() || null,
            signature_url: sigInput.value.trim() || null,
            roles: roleChecks.filter((r) => r.cb.checked).map((r) => r.value),
          };
          if (!payload.full_name) return mount(errorSlot, inlineAlert("Enter the staff member's full name."));
          if (!payload.staff_code) return mount(errorSlot, inlineAlert("Enter a Staff ID."));
          if (payload.signature_url && !/^https:\/\//i.test(payload.signature_url)) {
            return mount(errorSlot, inlineAlert("The signature address must start with https://"));
          }

          setBusy(submit, true, "Saving…");
          try {
            let staffId = existing?.id;
            if (isEdit) {
              unwrap(await supabase.from("staff").update(payload).eq("id", staffId), "update staff");
            } else {
              // school_id is also defaulted by the database from the signed-in
              // user (migration 0018); sending it here as well means a future
              // change to that default cannot silently reopen the old bug.
              const row = unwrap(await supabase.from("staff").insert({ ...payload, school_id: session.schoolId }).select("id").single(), "insert staff");
              staffId = row.id;
            }
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
        h("div.form-grid.cols-2", {}, field({ label: "Full name", id: "stName", control: nameInput }), h("div", {}, field({ label: "Staff ID", id: "stCode", control: codeInput }), codeHint)),
        h("div.form-grid.cols-2", {}, field({ label: "Email", id: "stEmail", control: emailInput }), field({ label: "Phone", id: "stPhone", control: phoneInput })),
        field({ label: "Position", id: "stPos", control: posInput, hint: "Shown on certificates and letters, e.g. \"Mathematics Teacher\". Only an administrator can set this to \"Admin Officer\", since that title decides whose signature prints on report cards." }),
        field({ label: "Signature image address", id: "stSig", control: sigInput, hint: "A link to a scanned or photographed signature (https). Printed on report cards when this person is Headmaster, Principal, or Admin Officer." }),
        sigPreview,
        h("div.field", {}, h("label", { text: "Roles" }), h("div.u-stack", { style: { gap: "6px" } }, roleChecks.map((r) => r.node))),
        isEdit ? loginSection(existing) : loginHint(),
      ),
      actions: [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }),
        submit,
      ],
    });
  }

  /* Roles live on staff.roles (migration 0018). A trigger turns them into
     school_members rows once a login exists, so a role can be chosen when the
     person is created, before any account does. */

  function loginHint() {
    return h("div.u-mt-4", { style: { paddingTop: "16px", borderTop: "1px solid var(--ama-line)" } },
      h("h3", { text: "Sign-in", style: { marginBottom: "8px" } }),
      h("p.u-xs.u-muted", { text: "The staff record is saved first. Once it is saved, reopen it with Edit to create the login — the record is never lost if the login cannot be set up." }));
  }

  function loginSection(staff) {
    const isReset = Boolean(staff.user_id);
    const pw = h("input.input", { type: "password", minlength: "6", placeholder: "Leave blank to use the school default", autocomplete: "new-password" });
    const btn = h("button.btn.btn-outline.btn-sm", { type: "button", text: isReset ? "Reset password" : "Create login" });
    const note = h("div.u-xs.u-muted");
    const hint = h("p.u-xs", { style: { color: "var(--ama-amber-deep, #92610a)" } });

    function paintHint() {
      mount(hint, pw.value
        ? null
        : h("span", { text: isReset
            ? "Left blank, this resets their password to the current school default."
            : "Left blank, the login is created with the current school default password." }));
    }
    pw.addEventListener("input", paintHint);
    paintHint();

    btn.addEventListener("click", async () => {
      mount(note);
      if (pw.value && pw.value.length < 6) {
        return mount(note, inlineAlert("Enter a password of at least 6 characters, or leave it blank to use the school default."));
      }
      if (!staff.user_id && !(staff.roles || []).length) {
        return mount(note, inlineAlert("Give this person at least one role above and press Save changes first. A login is created with the roles saved on the record."));
      }
      setBusy(btn, true, "Working…");
      try {
        // The roles come from the saved staff record (staff.roles), not from
        // this call, so nobody can be granted a role that an administrator
        // did not assign.
        const res = await invokeFunction("provision-user", { kind: "staff", table_id: staff.id, password: pw.value });
        toastOk(res?.used_default
          ? (isReset ? "Password reset to the school default" : "Login created with the school default password")
          : (isReset ? "Password reset" : "Login is ready"));
        pw.value = "";
        paintHint();
        await load();
      } catch (err) {
        mount(note, inlineAlert(humanError(err, "Could not set up the login.")));
      } finally { setBusy(btn, false); }
    });

    return h("div.u-mt-4", { style: { paddingTop: "16px", borderTop: "1px solid var(--ama-line)" } },
      h("h3", { text: "Sign-in", style: { marginBottom: "8px" } }),
      h("p.u-xs.u-muted", { text: `Staff ID ${staff.staff_code} is the sign-in ID.` }),
      !staff.user_id ? h("p.u-xs.u-muted", { text: "The login is created with the roles saved on this record. If a login attempt fails, the staff record and roles are kept — just press Create login again." }) : null,
      h("div.u-row", {}, pw, btn),
      hint,
      note,
    );
  }

  /* ---------------- Bulk credential reset (page is already admin-only) ---------------- */

  function showMappingModal(title, mapping, oldKey, newKey) {
    const rows = mapping || [];
    const copyBtn = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Copy as text" });
    copyBtn.addEventListener("click", async () => {
      const text = ["Name\tOld\tNew", ...rows.map((r) => `${r.full_name}\t${r[oldKey]}\t${r[newKey]}`)].join("\n");
      try {
        await navigator.clipboard.writeText(text);
        toastOk("Copied — paste into a spreadsheet or document to print and distribute.");
      } catch {
        toastError("Could not copy automatically. Select the list below and copy it by hand.");
      }
    });
    const close2 = openModal({
      title, wide: true,
      body: h("div.u-stack", { style: { gap: "10px" } },
        h("p.u-xs.u-muted", { text: "Give each person their new ID. This list is not shown again, so copy or print it now." }),
        copyBtn,
        h("div.table-wrap", { style: { maxHeight: "360px", overflow: "auto" } },
          h("table.table", {},
            h("thead", {}, h("tr", {}, h("th", { text: "Name" }), h("th", { text: "Old" }), h("th", { text: "New" }))),
            h("tbody", {}, rows.map((r) => h("tr", {},
              h("td", { text: r.full_name }), h("td", { text: r[oldKey] }), h("td", { text: r[newKey] })))),
          )),
      ),
      actions: [h("button.btn.btn-primary", { type: "button", text: "Done", onclick: () => close2() })],
    });
  }

  function openBulkResetModal() {
    const pwReset = h("input.input", { type: "password", minlength: "6", placeholder: "New password", autocomplete: "new-password" });
    const resetNote = h("div");
    const resetBtn = h("button.btn.btn-danger.btn-sm", { type: "button", text: "Reset all teacher passwords" });

    const prefixInput = h("input.input", { placeholder: "e.g. TCH", style: { maxWidth: "180px" } });
    const pwRenumber = h("input.input", { type: "password", minlength: "6", placeholder: "New password", autocomplete: "new-password" });
    const renumberNote = h("div");
    const renumberBtn = h("button.btn.btn-danger.btn-sm", { type: "button", text: "Renumber & reset passwords" });

    resetBtn.addEventListener("click", async () => {
      mount(resetNote);
      if (pwReset.value.length < 6) return mount(resetNote, inlineAlert("Enter a new password of at least 6 characters."));
      const ok = await confirmAction({
        title: "Reset every teacher's password?",
        message: "This immediately changes the sign-in password for every active staff member whose ONLY role is Teacher, and becomes the new default for teachers hired from now on. Admins, headmasters, principals, bursars and directors are never affected, even if they also hold the Teacher role. This cannot be undone.",
        confirmLabel: "Reset all teacher passwords", danger: true,
      });
      if (!ok) return;
      setBusy(resetBtn, true, "Resetting…");
      try {
        const res = await invokeFunction("bulk-credential-reset", { action: "reset_teacher_passwords", new_password: pwReset.value });
        toastOk(`Reset ${res.reset} of ${res.total} teacher login${res.total === 1 ? "" : "s"}${res.skippedNoLogin ? ` (${res.skippedNoLogin} have no login yet)` : ""}.`);
        pwReset.value = "";
        close();
      } catch (err) {
        mount(resetNote, inlineAlert(humanError(err, "Could not reset teacher passwords.")));
      } finally {
        setBusy(resetBtn, false);
      }
    });

    renumberBtn.addEventListener("click", async () => {
      mount(renumberNote);
      const prefix = prefixInput.value.trim();
      if (!prefix) return mount(renumberNote, inlineAlert("Enter a prefix for the new Staff IDs."));
      if (pwRenumber.value.length < 6) return mount(renumberNote, inlineAlert("Enter a new password of at least 6 characters."));
      const ok = await confirmAction({
        title: "Renumber every teacher?",
        message: `Every active staff member whose ONLY role is Teacher gets a brand-new Staff ID starting from ${prefix}0001, and their password is reset. Admins, headmasters, principals, bursars and directors are never touched. This cannot be undone — you'll get a list to print or distribute afterward.`,
        confirmLabel: "Renumber & reset", danger: true,
      });
      if (!ok) return;
      setBusy(renumberBtn, true, "Renumbering…");
      try {
        const res = await invokeFunction("bulk-credential-reset", { action: "renumber_teachers", prefix, new_password: pwRenumber.value });
        toastOk(`Renumbered ${res.count} teacher${res.count === 1 ? "" : "s"}.`);
        close();
        showMappingModal("Teachers renumbered", res.mapping, "old_staff_code", "new_staff_code");
        await load();
      } catch (err) {
        mount(renumberNote, inlineAlert(humanError(err, "Could not renumber teachers.")));
      } finally {
        setBusy(renumberBtn, false);
      }
    });

    const close = openModal({
      title: "Bulk credential reset",
      wide: true,
      body: h("div.u-stack", { style: { gap: "20px" } },
        h("div", {},
          h("h3", { text: "Reset all teacher passwords" }),
          h("p.u-xs.u-muted", { text: "Sets the login password for every active staff member whose only role is Teacher, and saves it as the new default for teachers hired from now on." }),
          h("div.u-row", {}, pwReset, resetBtn),
          resetNote,
        ),
        h("div", { style: { paddingTop: "16px", borderTop: "1px solid var(--ama-line)" } },
          h("h3", { text: "Renumber & reset (new Staff ID scheme)" }),
          h("p.u-xs.u-muted", { text: "Replaces every active teacher's Staff ID with a fresh sequential number under a new prefix, and resets their password. Only staff whose sole role is Teacher are touched." }),
          h("div.u-row", {}, prefixInput, pwRenumber, renumberBtn),
          renumberNote,
        ),
      ),
      actions: [h("button.btn.btn-outline", { type: "button", text: "Close", onclick: () => close() })],
    });
  }
}
