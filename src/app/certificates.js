/* ===============================================================
   Certificates — best-student and other awards, for students or
   staff, with a printable certificate.

   Ports: renderCertificates / buildTestimonialCertHTML /
   generateSealSVG (MyPAS1 app-phase2c.js), rebuilt as safe DOM
   nodes rather than an HTML-string template.
   =============================================================== */

import "../styles/marketing.css";
import { h, mount, skeleton, setBusy, safeUrl } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, inlineAlert, confirmAction, toastOk, toastError, openModal } from "../lib/ui.js";
import { fetchActiveTerm, fmtDate } from "../lib/data.js";
import { session } from "../lib/auth.js";
import { context } from "../main.js";

const KINDS = [
  ["best_student", "Best Student"], ["most_improved", "Most Improved"],
  ["perfect_attendance", "Perfect Attendance"], ["staff_recognition", "Staff Recognition"],
  ["custom", "Custom"],
];
const KIND_LABEL = Object.fromEntries(KINDS);

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal")) return;

  const state = { awards: [], term: null };
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Certificates",
    subtitle: "Best student awards and other recognitions.",
    actions: [h("button.btn.btn-primary", { type: "button", text: "New award", onclick: () => openForm() })],
    body,
  }));

  state.term = await fetchActiveTerm().catch(() => null);
  await load();

  async function load() {
    mount(body, h("div.card", {}, skeleton(4)));
    try {
      state.awards = unwrap(
        await supabase.from("awards").select("id, kind, title, note, awarded_on, students(full_name, classes(name)), staff(full_name)").order("awarded_on", { ascending: false }),
        "fetch awards"
      );
      draw();
    } catch (err) {
      logError("certificates load", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function draw() {
    if (!state.awards.length) {
      return mount(body, emptyState({
        title: "No awards yet", body: "Create one to generate a printable certificate.",
        action: h("button.btn.btn-primary.btn-sm", { type: "button", text: "New award", onclick: () => openForm() }),
      }));
    }
    mount(body, h("div.u-stack", {}, state.awards.map((a) => row(a))));
  }

  function row(a) {
    const recipient = a.students?.full_name || a.staff?.full_name || "—";
    const sub = a.students ? a.students.classes?.name : "Staff";
    return h("div.card", {},
      h("div.card-head", {},
        h("div", {},
          h("h3.card-title", { text: a.title }),
          h("div.card-sub", { text: `${recipient}${sub ? ` · ${sub}` : ""} · ${fmtDate(a.awarded_on)}` }),
        ),
        h("div.u-row", { style: { gap: "6px" } },
          h("button.btn.btn-outline.btn-sm", { type: "button", text: "View certificate", onclick: () => viewCertificate(a) }),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Delete", onclick: () => remove(a) }),
        ),
      ),
    );
  }

  async function remove(a) {
    const ok = await confirmAction({ title: "Delete this award?", message: `"${a.title}" will be removed.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try { unwrap(await supabase.from("awards").delete().eq("id", a.id), "delete award"); toastOk("Deleted"); await load(); }
    catch (err) { toastError(humanError(err)); }
  }

  function viewCertificate(a) {
    const recipient = a.students?.full_name || a.staff?.full_name || "—";
    const close = openModal({
      title: "", wide: true,
      body: h("div", {},
        certificate(context.school, recipient, a.title, a.note, a.awarded_on),
        h("div.u-row.no-print.u-mt-6", { style: { justifyContent: "flex-end" } },
          h("button.btn.btn-outline", { type: "button", text: "Close", onclick: () => close() }),
          h("button.btn.btn-primary", { type: "button", text: "Print", onclick: () => window.print() }),
        ),
      ),
    });
  }

  function openForm() {
    const typeSeg = h("div.seg", { style: { maxWidth: "260px" } },
      h("button.active", { type: "button", text: "Student", "data-type": "student" }),
      h("button", { type: "button", text: "Staff", "data-type": "staff" }));
    let recipientType = "student";
    const searchInput = h("input.input", { placeholder: "Type a name to search…" });
    const results = h("div.u-stack", { style: { gap: "2px", maxHeight: "160px", overflowY: "auto" } });
    let selected = null;

    const kindSel = h("select.select", {}, KINDS.map(([v, l]) => h("option", { value: v, text: l })));
    const titleInput = h("input.input", { value: KIND_LABEL.best_student });
    const noteInput = h("textarea.textarea", {});
    const dateInput = h("input.input", { type: "date", value: new Date().toISOString().slice(0, 10) });
    const errorSlot = h("div");
    const submit = h("button.btn.btn-primary", { type: "submit", form: "awardForm", text: "Create award" });

    kindSel.addEventListener("change", () => { titleInput.value = KIND_LABEL[kindSel.value] || ""; });

    typeSeg.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
      typeSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      recipientType = btn.dataset.type;
      selected = null; searchInput.value = ""; mount(results);
    }));

    let searchTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      selected = null;
      searchTimer = setTimeout(async () => {
        const term = searchInput.value.trim();
        if (term.length < 2) return mount(results);
        const table = recipientType === "student" ? "students" : "staff";
        const { data } = await supabase.from(table).select("id, full_name").ilike("full_name", `%${term}%`).limit(6);
        mount(results, (data || []).map((r) => h("button.btn.btn-ghost.btn-sm", {
          type: "button", style: { justifyContent: "flex-start" }, text: r.full_name,
          onclick: () => { selected = r; searchInput.value = r.full_name; mount(results); },
        })));
      }, 250);
    });

    const close = openModal({
      title: "New award",
      wide: true,
      body: h("form", { id: "awardForm", novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        mount(errorSlot);
        if (!selected) return mount(errorSlot, inlineAlert("Search for and select a recipient."));
        setBusy(submit, true, "Saving…");
        try {
          unwrap(await supabase.from("awards").insert({
            school_id: session.schoolId,
            [recipientType === "student" ? "student_id" : "staff_id"]: selected.id,
            term_id: state.term?.id || null,
            kind: kindSel.value, title: titleInput.value.trim() || KIND_LABEL[kindSel.value],
            note: noteInput.value.trim() || null,
            awarded_on: dateInput.value,
          }), "create award");
          toastOk("Award created");
          close();
          await load();
        } catch (err) {
          mount(errorSlot, inlineAlert(humanError(err)));
        } finally { setBusy(submit, false); }
      } },
        errorSlot,
        h("div.field", {}, h("label", { text: "Recipient type" }), typeSeg),
        field({ label: "Search recipient", id: "awardSearch", control: searchInput }),
        results,
        h("div.form-grid.cols-2", {}, field({ label: "Kind", id: "awardKind", control: kindSel }), field({ label: "Date", id: "awardDate", control: dateInput })),
        field({ label: "Title", id: "awardTitle", control: titleInput }),
        field({ label: "Note (optional)", id: "awardNote", control: noteInput }),
      ),
      actions: [
        h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }),
        h("button.btn.btn-primary", { type: "submit", form: "awardForm", text: "Create award" }),
      ],
    });
  }
}

function certificate(school, recipient, title, note, date) {
  const logo = safeUrl(school?.logo_url);
  return h("div", {
    style: {
      border: "6px double var(--ama-brass)", borderRadius: "8px", padding: "40px 32px",
      textAlign: "center", background: "#fffefb",
    },
  },
    logo ? h("img", { src: logo, alt: "", style: { width: "56px", height: "56px", objectFit: "contain", margin: "0 auto 12px" } })
         : h("div.slip-crest", { style: { width: "56px", height: "56px", fontSize: "24px", margin: "0 auto 12px" }, text: (school?.name || "AE").slice(0, 1) }),
    h("div.display", { style: { fontSize: "13px", letterSpacing: "0.14em", color: "var(--ama-slate)" }, text: (school?.name || "").toUpperCase() }),
    h("h1.display", { style: { fontSize: "28px", margin: "18px 0 6px" }, text: "Certificate of Achievement" }),
    h("p.u-small.u-muted", { text: "This is to certify that" }),
    h("h2.display", { style: { fontSize: "22px", margin: "10px 0", color: "var(--ama-green-deep)" }, text: recipient }),
    h("p", { text: "has been awarded" }),
    h("h3.display", { style: { fontSize: "18px", margin: "8px 0" }, text: title }),
    note ? h("p.u-small", { text: note }) : null,
    h("div.u-row", { style: { justifyContent: "space-between", marginTop: "36px", fontSize: "12px" } },
      h("div", {}, "____________________", h("div.u-xs.u-muted", { text: "Principal's signature" })),
      h("div", {}, fmtDate(date), h("div.u-xs.u-muted", { text: "Date" })),
    ),
  );
}
