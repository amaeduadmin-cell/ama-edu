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
import { invokeFunction } from "../lib/functions.js";
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
  // Declared BEFORE the first await load(). They used to sit further down, so
  // when the first load finished and called draw(), draw() touched them while
  // they were still uninitialised ("Cannot access 'searchFocused' before
  // initialization"). The table still appeared, but the error was thrown out of a
  // finally block and search focus was never restored.
  let searchTimer;
  let searchFocused = false;
  let searchCaret = null;

  await load();

  /** Search and class filter run server-side, not against an in-memory
   *  array — a school with a thousand students should not download all
   *  of them to filter three keystrokes' worth on the client. */
  async function load() {
    state.loading = true;
    draw();
    try {
      let q = supabase.from("students")
        .select("id, admission_no, full_name, gender, photo_url, is_active, class_id, classes(name), user_id, guardian_name, guardian_phone, guardian_email, date_of_birth, address, date_admitted", { count: "exact" })
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

  function onSearchInput(value) {
    state.search = value;
    state.page = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  }


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
      date_of_birth: existing?.date_of_birth || "",
      date_admitted: existing?.date_admitted || new Date().toISOString().slice(0, 10),
      address: existing?.address || "",
      photo_url: existing?.photo_url || "",
      is_active: existing ? existing.is_active !== false : true,
    };

    const nameInput  = h("input.input", { value: form.full_name, required: true });
    // New admissions: the database assigns the number (register_student), so this
    // field starts hidden behind a "use a custom number instead" toggle and a
    // live preview. Editing an existing student still edits admission_no directly.
    const admInput   = h("input.input", { value: form.admission_no, required: isEdit, placeholder: "e.g. ADM0001" });
    const admStatus  = h("div.u-xs.u-muted");
    const admPreview = h("div.u-xs.u-muted");
    const customToggle = h("input", { type: "checkbox", checked: isEdit, style: { width: "18px", height: "18px" } });
    const admFieldWrap = field({ label: "Admission number", id: "sfAdm", control: admInput });
    const classSel   = h("select.select", {}, state.classes.map((c) => h("option", { value: c.id, selected: c.id === form.class_id, text: c.name })));
    const genderSel  = h("select.select", {},
      h("option", { value: "", selected: !form.gender, text: "Not specified" }),
      h("option", { value: "male", selected: form.gender === "male", text: "Male" }),
      h("option", { value: "female", selected: form.gender === "female", text: "Female" }));
    const gName  = h("input.input", { value: form.guardian_name });
    const gPhone = h("input.input", { type: "tel", value: form.guardian_phone });
    const gEmail = h("input.input", { type: "email", value: form.guardian_email });
    const dobInput   = h("input.input", { type: "date", value: form.date_of_birth, max: new Date().toISOString().slice(0, 10) });
    const admittedInput = h("input.input", { type: "date", value: form.date_admitted });
    const addressInput  = h("textarea.textarea", { rows: "2" }, form.address);
    const photoInput    = h("input.input", { type: "url", value: form.photo_url, placeholder: "https://…" });
    const activeBox     = h("input", { type: "checkbox", checked: form.is_active, style: { width: "20px", height: "20px" } });
    const errorSlot = h("div");

    let admCheckTimer;
    let admissionPreview = null; // filled from admission_scheme_preview() for a fresh admission

    function admissionField() {
      const useCustom = isEdit || customToggle.checked;
      admInput.disabled = !useCustom;
      admInput.required = useCustom;
      if (!useCustom) { admInput.value = ""; mount(admStatus); }
      admFieldWrap.style.display = useCustom ? "" : "none";
      mount(admPreview, useCustom ? null : (
        admissionPreview
          ? h("span", { text: `Next number: ${admissionPreview.next_admission_no}` })
          : h("span", { text: "Loading the next number…" })
      ));
    }

    function checkAdmissionLive() {
      clearTimeout(admCheckTimer);
      const value = admInput.value.trim();
      mount(admStatus);
      // Unchanged on an edit: nothing to check, it's already this student's own number.
      if (isEdit && value === existing.admission_no) return;
      if (!value) return;
      admCheckTimer = setTimeout(async () => {
        try {
          const rows = unwrap(await supabase.rpc("check_admission_number", { p_value: value }), "check admission number");
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (row?.taken) {
            mount(admStatus, h("span", { style: { color: "var(--ama-danger)" }, text: `Already belongs to ${row.full_name}${row.class_name ? ` (${row.class_name})` : ""}.` }));
          } else {
            mount(admStatus, h("span", { style: { color: "var(--ama-green-deep)" }, text: "Available." }));
          }
        } catch { /* best effort — the ordinary save still enforces uniqueness */ }
      }, 350);
    }

    admInput.addEventListener("input", checkAdmissionLive);
    customToggle.addEventListener("change", admissionField);

    if (!isEdit) {
      admissionField();
      (async () => {
        try {
          const rows = unwrap(await supabase.rpc("admission_scheme_preview"), "admission preview");
          admissionPreview = Array.isArray(rows) ? rows[0] : rows;
        } catch { admissionPreview = { next_admission_no: "—" }; }
        admissionField();
      })();
    }

    const submit = h("button.btn.btn-primary", { type: "submit", text: isEdit ? "Save changes" : "Admit student" });

    const close = openModal({
      title: isEdit ? "Edit student" : "Admit student",
      wide: true,
      body: h("form", {
        id: "studentForm", novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          mount(errorSlot);
          const useCustomAdm = isEdit || customToggle.checked;
          const payload = {
            full_name: nameInput.value.trim(),
            class_id: classSel.value,
            gender: genderSel.value || null,
            guardian_name: gName.value.trim() || null,
            guardian_phone: gPhone.value.trim() || null,
            guardian_email: gEmail.value.trim() || null,
            date_of_birth: dobInput.value || null,
            date_admitted: admittedInput.value || null,
            address: addressInput.value.trim() || null,
            photo_url: photoInput.value.trim() || null,
            is_active: activeBox.checked,
          };
          if (useCustomAdm) payload.admission_no = admInput.value.trim();

          if (payload.photo_url && !/^https:\/\//i.test(payload.photo_url)) {
            return mount(errorSlot, inlineAlert("The photo address must start with https://"));
          }
          if (payload.date_of_birth && payload.date_of_birth > new Date().toISOString().slice(0, 10)) {
            return mount(errorSlot, inlineAlert("The date of birth cannot be in the future."));
          }
          if (!payload.full_name) return mount(errorSlot, inlineAlert("Enter the student's full name."));
          if (useCustomAdm && !payload.admission_no) return mount(errorSlot, inlineAlert("Enter an admission number, or switch off the custom number to let the school assign the next one."));
          if (!payload.class_id) return mount(errorSlot, inlineAlert("Choose a class."));

          setBusy(submit, true, isEdit ? "Saving…" : "Admitting…");
          try {
            if (isEdit) {
              unwrap(await supabase.from("students").update(payload).eq("id", existing.id), "update student");
              toastOk("Student updated");
            } else if (useCustomAdm) {
              // A number typed by hand: the ordinary insert is the final backstop —
              // the (school_id, admission_no) unique constraint still enforces this.
              // school_id is also defaulted by the database (migration 0018); sending it
              // means a change to that default cannot silently bring the old bug back.
              unwrap(await supabase.from("students").insert({ ...payload, school_id: session.schoolId }), "insert student");
              toastOk("Student admitted");
            } else {
              // Auto-assigned: the database locks the school row and hands back the
              // number it picked, so two registrars submitting at once never collide.
              const rows = unwrap(await supabase.rpc("register_student", {
                p_full_name: payload.full_name, p_class_id: payload.class_id,
                p_gender: payload.gender, p_dob: payload.date_of_birth,
              }), "register student");
              const row = Array.isArray(rows) ? rows[0] : rows;
              // register_student only sets name/class/gender/dob; save the rest now.
              const { full_name, class_id, gender, date_of_birth, ...rest } = payload;
              unwrap(await supabase.from("students").update(rest).eq("id", row.id), "save student details");
              toastOk(`Student admitted — admission number ${row.admission_no}`);
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
          h("div", {}, admFieldWrap, admStatus),
        ),
        !isEdit ? h("div.u-stack", { style: { gap: "4px", margin: "-8px 0 10px" } },
          h("label.u-row", { style: { gap: "8px", cursor: "pointer" } }, customToggle,
            h("span.u-xs", { text: "Use a custom admission number instead of the next available one" })),
          admPreview,
        ) : null,
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
        h("h3", { text: "More details", style: { margin: "8px 0" } }),
        h("div.form-grid.cols-2", {},
          field({ label: "Date of birth", id: "sfDob", control: dobInput }),
          field({ label: "Date admitted", id: "sfAdmitted", control: admittedInput }),
        ),
        field({ label: "Home address", id: "sfAddress", control: addressInput }),
        field({ label: "Photo address", id: "sfPhoto", control: photoInput, hint: "A link to the photo (https). Uploading photos directly is not built yet." }),
        h("label.u-row", { style: { gap: "10px", margin: "8px 0", cursor: "pointer" } }, activeBox, "Active student"),

        isEdit ? loginSection(existing) : h("p.u-xs.u-muted.u-mt-4", {
          text: "The student is saved first. Reopen the record with Edit to create the login; the admission is never lost if the login cannot be set up.",
        }),
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
        await invokeFunction("provision-user", { kind: "student", table_id: student.id, password: pw.value });
        toastOk(student.user_id ? "Password reset" : "Login is ready");
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

}
