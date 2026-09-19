/* ===============================================================
   Students — list, admit, edit, deactivate, provision a login.

   Ports: renderStudents / saveStudent / bulkRenumberStudents
   (MyPAS1 app-admin.js). RLS restricts writes to admins and
   registrars; a plain teacher reaching this route sees the read-only
   staff view because students_staff_read covers them too.
   =============================================================== */

import { h, mount, skeleton, setBusy, safeUrl } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, inlineAlert, openModal, closeModal, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { fetchClasses, initials, fmtDate } from "../lib/data.js";
import { hasRole, session } from "../lib/auth.js";

const PAGE_SIZE = 25;

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "registrar_primary", "registrar_secondary", "teacher", "headmaster", "principal")) return;

  const state = { search: "", classId: "", students: [], classes: [], loading: true, page: 0, total: 0 };
  const canWrite = hasRole("admin", "registrar_primary", "registrar_secondary");

  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Students",
    subtitle: canWrite ? "Admit, edit and manage student records for your school." : "Your school's student roster.",
    actions: canWrite ? [h("button.btn.btn-primary", { type: "button", text: "Admit student", onclick: () => openStudentForm() })] : [],
    body,
  }));

  try {
    state.classes = await fetchClasses();
  } catch (err) {
    logError("load classes", err);
  }
  await load();

  /** Search and class filter run server-side, not against an in-memory
   *  array — a school with a thousand students should not download all
   *  of them to filter three keystrokes' worth on the client. */
  async function load() {
    state.loading = true;
    draw();
    try {
      let q = supabase.from("students")
        .select("id, admission_no, full_name, gender, photo_url, is_active, class_id, classes(name), user_id, guardian_phone", { count: "exact" })
        .order("full_name");

      if (state.classId) q = q.eq("class_id", state.classId);
      const term = state.search.trim();
      if (term) q = q.or(`full_name.ilike.%${term}%,admission_no.ilike.%${term}%`);

      const from = state.page * PAGE_SIZE;
      q = q.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      state.students = data;
      state.total = count ?? data.length;
    } catch (err) {
      logError("load students", err);
      state.error = humanError(err);
    } finally {
      state.loading = false;
      draw();
    }
  }

  function goToPage(delta) {
    const next = state.page + delta;
    if (next < 0 || next * PAGE_SIZE >= state.total) return;
    state.page = next;
    load();
  }

  let searchTimer;
  function onSearchInput(value) {
    state.search = value;
    state.page = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  }

  let searchFocused = false;
  let searchCaret = null;

  function draw() {
    if (state.loading) {
      mount(body, h("div.card", {}, skeleton(6)));
      // No input exists during the loading flash to refocus — that's
      // fine, the real draw() right after data arrives restores it.
      return;
    }
    if (state.error) return mount(body, errorState(state.error, load));

    const rows = state.students;
    const from = state.total === 0 ? 0 : state.page * PAGE_SIZE + 1;
    const to = Math.min(state.total, state.page * PAGE_SIZE + rows.length);

    mount(body,
      h("div.card.card-flush", {},
        h("div.u-row.u-wrap", { style: { padding: "16px", borderBottom: "1px solid var(--ama-line)" } },
          h("input.input.u-grow#studentSearch", {
            type: "search", placeholder: "Search by name or admission number", value: state.search,
            oninput: (e) => { searchCaret = e.target.selectionStart; onSearchInput(e.target.value); },
            onfocus: () => { searchFocused = true; },
            onblur: () => { searchFocused = false; },
            style: { minWidth: "200px" },
          }),
          h("select.select", {
            value: state.classId, onchange: (e) => { state.classId = e.target.value; state.page = 0; load(); },
            style: { maxWidth: "220px" },
          },
            h("option", { value: "", text: "All classes" }),
            state.classes.map((c) => h("option", { value: c.id, text: c.name })),
          ),
        ),
        rows.length ? table(rows) : h("div", { style: { padding: "16px" } }, emptyState({
          title: state.total ? "No students match" : "No students yet",
          body: state.total ? "Try a different name, admission number or class." : "Admit your first student to get started.",
          action: (!state.total && canWrite) ? h("button.btn.btn-primary.btn-sm", { type: "button", text: "Admit student", onclick: () => openStudentForm() }) : null,
        })),
      ),
      h("div.u-row", { style: { justifyContent: "space-between" } },
        h("p.u-xs.u-muted", { text: state.total ? `${from}–${to} of ${state.total} students` : "0 students" }),
        state.total > PAGE_SIZE ? h("div.u-row", { style: { gap: "6px" } },
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "Previous", disabled: state.page === 0, onclick: () => goToPage(-1) }),
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "Next", disabled: to >= state.total, onclick: () => goToPage(1) }),
        ) : null,
      ),
    );

    if (searchFocused) {
      const input = document.getElementById("studentSearch");
      if (input) { input.focus(); if (searchCaret != null) input.setSelectionRange(searchCaret, searchCaret); }
    }
  }

  function table(rows) {
    return h("div.table-wrap", {}, h("table.table", {},
      h("thead", {}, h("tr", {},
        h("th", { text: "Student" }),
        h("th", { text: "Admission no." }),
        h("th", { text: "Class" }),
        h("th", { text: "Guardian phone" }),
        h("th", { text: "Login" }),
        h("th", { text: "Status" }),
        canWrite ? h("th", { text: "" }) : null,
      )),
      h("tbody", {}, rows.map((s) => h("tr", {},
        h("td", {}, h("a", { href: `/students/${s.id}`, style: { textDecoration: "none", color: "inherit", fontWeight: "600" } }, s.full_name)),
        h("td.u-num", { text: s.admission_no }),
        h("td", { text: s.classes?.name || "—" }),
        h("td", { text: s.guardian_phone || "—" }),
        h("td", {}, s.user_id
          ? h("span.badge.badge-ok", { text: "Active" })
          : h("span.badge", { text: "Not set up" })),
        h("td", {}, s.is_active
          ? h("span.badge.badge-ok", { text: "Active" })
          : h("span.badge.badge-warn", { text: "Inactive" })),
        canWrite ? h("td", {},
          h("div.u-row", { style: { gap: "6px", justifyContent: "flex-end" } },
            h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Edit", onclick: () => openStudentForm(s) }),
            h("button.btn.btn-ghost.btn-sm", { type: "button", text: s.is_active ? "Deactivate" : "Reactivate", onclick: () => toggleActive(s) }),
          )) : null,
      ))),
    ));
  }

  async function toggleActive(student) {
    const ok = await confirmAction({
      title: student.is_active ? "Deactivate this student?" : "Reactivate this student?",
      message: student.is_active
        ? `${student.full_name} will no longer appear in class lists, score entry or new report cards. Past records are kept.`
        : `${student.full_name} will reappear in class lists and score entry.`,
      confirmLabel: student.is_active ? "Deactivate" : "Reactivate",
      danger: student.is_active,
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("students").update({ is_active: !student.is_active }).eq("id", student.id), "toggle student");
      toastOk(student.is_active ? "Student deactivated" : "Student reactivated");
      await load();
    } catch (err) {
      toastError(humanError(err));
    }
  }

  /* ---------------- Admit / edit modal ---------------- */
  function openStudentForm(existing = null) {
    const isEdit = Boolean(existing);
    const form = {
      full_name: existing?.full_name || "",
      admission_no: existing?.admission_no || "",
      class_id: existing?.class_id || state.classes[0]?.id || "",
      gender: existing?.gender || "",
      guardian_name: existing?.guardian_name || "",
      guardian_phone: existing?.guardian_phone || "",
      guardian_email: existing?.guardian_email || "",
    };

    const nameInput  = h("input.input", { value: form.full_name, required: true });
    const admInput   = h("input.input", { value: form.admission_no, required: true, placeholder: "Auto-suggested if left blank" });
    const classSel   = h("select.select", {}, state.classes.map((c) => h("option", { value: c.id, selected: c.id === form.class_id, text: c.name })));
    const genderSel  = h("select.select", {},
      h("option", { value: "", selected: !form.gender, text: "Not specified" }),
      h("option", { value: "male", selected: form.gender === "male", text: "Male" }),
      h("option", { value: "female", selected: form.gender === "female", text: "Female" }));
    const gName  = h("input.input", { value: form.guardian_name });
    const gPhone = h("input.input", { type: "tel", value: form.guardian_phone });
    const gEmail = h("input.input", { type: "email", value: form.guardian_email });
    const errorSlot = h("div");

    if (!isEdit && !admInput.value) suggestAdmissionNumber(admInput);

    const submit = h("button.btn.btn-primary", { type: "submit", text: isEdit ? "Save changes" : "Admit student" });

    const close = openModal({
      title: isEdit ? "Edit student" : "Admit student",
      wide: true,
      body: h("form", {
        id: "studentForm", novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          mount(errorSlot);
          const payload = {
            full_name: nameInput.value.trim(),
            admission_no: admInput.value.trim(),
            class_id: classSel.value,
            gender: genderSel.value || null,
            guardian_name: gName.value.trim() || null,
            guardian_phone: gPhone.value.trim() || null,
            guardian_email: gEmail.value.trim() || null,
          };
          if (!payload.full_name) return mount(errorSlot, inlineAlert("Enter the student's full name."));
          if (!payload.admission_no) return mount(errorSlot, inlineAlert("Enter an admission number."));
          if (!payload.class_id) return mount(errorSlot, inlineAlert("Choose a class."));

          setBusy(submit, true, isEdit ? "Saving…" : "Admitting…");
          try {
            if (isEdit) {
              unwrap(await supabase.from("students").update(payload).eq("id", existing.id), "update student");
              toastOk("Student updated");
            } else {
              unwrap(await supabase.from("students").insert(payload), "insert student");
              toastOk("Student admitted");
            }
            close();
            await load();
          } catch (err) {
            mount(errorSlot, inlineAlert(humanError(err, "That admission number may already be in use.")));
          } finally {
            setBusy(submit, false);
          }
        },
      },
        errorSlot,
        h("div.form-grid.cols-2", {},
          field({ label: "Full name", id: "sfName", control: nameInput }),
          field({ label: "Admission number", id: "sfAdm", control: admInput }),
        ),
        h("div.form-grid.cols-2", {},
          field({ label: "Class", id: "sfClass", control: classSel }),
          field({ label: "Gender", id: "sfGender", control: genderSel }),
        ),
        h("h3", { text: "Guardian", style: { margin: "8px 0" } }),
        h("div.form-grid.cols-2", {},
          field({ label: "Guardian name", id: "sfGName", control: gName }),
          field({ label: "Guardian phone", id: "sfGPhone", control: gPhone }),
        ),
        field({ label: "Guardian email", id: "sfGEmail", control: gEmail }),

        isEdit ? loginSection(existing) : null,
      ),
      actions: [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }),
        h("button.btn.btn-primary", { type: "submit", form: "studentForm", text: isEdit ? "Save changes" : "Admit student" }),
      ],
    });
  }

  function loginSection(student) {
    const pw = h("input.input", { type: "password", minlength: "6", placeholder: "New password", autocomplete: "new-password" });
    const btn = h("button.btn.btn-outline.btn-sm", { type: "button", text: student.user_id ? "Reset password" : "Create login" });
    const note = h("div.u-xs.u-muted");

    btn.addEventListener("click", async () => {
      if (pw.value.length < 6) return mount(note, inlineAlert("Enter a password of at least 6 characters."));
      setBusy(btn, true, "Working…");
      try {
        const { data, error } = await supabase.functions.invoke("provision-user", {
          body: { kind: "student", table_id: student.id, password: pw.value },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toastOk("Login is ready");
        pw.value = "";
        await load();
      } catch (err) {
        mount(note, inlineAlert(humanError(err, "Could not set up the login.")));
      } finally {
        setBusy(btn, false);
      }
    });

    return h("div.u-mt-4", { style: { paddingTop: "16px", borderTop: "1px solid var(--ama-line)" } },
      h("h3", { text: "Sign-in", style: { marginBottom: "8px" } }),
      h("p.u-xs.u-muted", { text: `Admission number ${student.admission_no} is the sign-in ID. Set or reset the password below.` }),
      h("div.u-row", {}, pw, btn),
      note,
    );
  }

  async function suggestAdmissionNumber(input) {
    try {
      const { data } = await supabase.from("schools").select("admission_prefix, admission_next_no").eq("id", session.schoolId).single();
      if (data) input.placeholder = `${data.admission_prefix}${String(data.admission_next_no).padStart(4, "0")}`;
    } catch { /* best effort */ }
  }
}
