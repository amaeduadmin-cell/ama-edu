/* ===============================================================
   Academic settings — the school administrator's control room for how
   results are worked out and shown.

     Sections          which parts of the school are switched on
     Assessment system CA / exam weights (must total 100)
     Grading           grade names and score ranges
     Remarks           the words that go with a score range
     Results & fees    who may publish, and whether unpaid fees hide results
     Report card       which template, and what it shows

   Every change goes through a database function that validates the
   WHOLE set at once (migration 0028). The checks on this page are a
   convenience so the administrator sees a problem before pressing Save;
   the database is what actually refuses a bad configuration.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { errorState, field, inlineAlert, toastOk, toastError } from "../lib/ui.js";
import { session } from "../lib/auth.js";
import { context } from "../main.js";
import { templatePicker } from "../lib/template-picker.js";

const TABS = [
  ["sections", "School sections"], ["assessment", "Assessment system"], ["grading", "Grading"],
  ["remarks", "Grade remarks"], ["results", "Results & fees"],
  ["admission", "IDs & passwords"], ["reportcard", "Report card"],
];

const SECTIONS = [
  ["nursery", "Nursery", "Nursery 1 to 3"],
  ["primary", "Primary", "Primary 1 to 6"],
  ["jss", "JSS", "JSS 1 to 3"],
  ["ss", "Senior Secondary", "SS 1 to 3"],
  ["islamiyya", "Islamiyya", "Islamiyya 1 to 3"],
  ["other", "Other", "Classes you add yourself"],
];

const ASSESSMENT_PRESETS = [
  { name: "20 / 20 / 20 / 40", v: [20, 20, 20, 40] },
  { name: "10 / 10 / 20 / 60", v: [10, 10, 20, 60] },
  { name: "CA 40 / Exam 60", v: [40, 0, 0, 60] },
  { name: "20 / 20 / Exam 60", v: [20, 20, 0, 60] },
];

const GRADE_PRESETS = {
  "A to F": [
    ["A", 70, 100, "Excellent", true], ["B", 60, 69.99, "Very good", true], ["C", 50, 59.99, "Good", true],
    ["D", 45, 49.99, "Fair", true], ["E", 40, 44.99, "Pass", true], ["F", 0, 39.99, "Fail", false],
  ],
  "A1 to F9": [
    ["A1", 75, 100, "Excellent", true], ["B2", 70, 74.99, "Very good", true], ["B3", 65, 69.99, "Good", true],
    ["C4", 60, 64.99, "Credit", true], ["C5", 55, 59.99, "Credit", true], ["C6", 50, 54.99, "Credit", true],
    ["D7", 45, 49.99, "Pass", true], ["E8", 40, 44.99, "Pass", true], ["F9", 0, 39.99, "Fail", false],
  ],
};

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin")) return;

  const state = { tab: "sections", data: null };
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Academic settings",
    subtitle: "How your school's results are calculated, graded, released and printed.",
    body,
  }));
  mount(body, skeleton(6));

  await load();

  async function load() {
    try {
      const [schoolRows, sections, components, bands, remarks, rcRows, counts, admissionPreview, staffCodePreview, signatories] = await Promise.all([
        unwrap(await supabase.from("schools").select("id, name, motto, address, phone, logo_url, report_card_template, result_fee_policy, teachers_may_publish, declared_student_count, admission_prefix, admission_pad_width, admission_next_no, staff_code_prefix, staff_code_pad_width, staff_code_next_number").eq("id", session.schoolId).limit(1), "school"),
        unwrap(await supabase.from("school_sections").select("section, is_enabled"), "sections"),
        unwrap(await supabase.from("assessment_components").select("code, label, max_score, is_active, sort_order").order("sort_order"), "components"),
        unwrap(await supabase.from("grading_bands").select("grade, min_score, max_score, remark, is_pass, sort_order").order("min_score"), "bands"),
        unwrap(await supabase.from("grade_remarks").select("min_score, max_score, remark, sort_order").order("min_score"), "remarks"),
        unwrap(await supabase.from("school_report_card_settings").select("*").eq("school_id", session.schoolId).limit(1), "rc settings"),
        unwrap(await supabase.rpc("school_billing_counts", { p_school_id: session.schoolId }), "counts"),
        unwrap(await supabase.rpc("admission_scheme_preview"), "admission preview"),
        unwrap(await supabase.rpc("staff_code_scheme_preview"), "staff ID preview"),
        unwrap(await supabase.rpc("report_card_signatories"), "signatories"),
      ]);
      state.data = {
        school: schoolRows?.[0] || {}, sections, components, bands, remarks,
        rc: rcRows?.[0] || { head_title: "TERM REPORT CARD", show_photo: true, show_attendance: true, show_positions: true },
        counts: Array.isArray(counts) ? counts[0] : counts,
        admission: Array.isArray(admissionPreview) ? admissionPreview[0] : admissionPreview,
        staffCode: Array.isArray(staffCodePreview) ? staffCodePreview[0] : staffCodePreview,
        signatories: signatories || [],
      };
      draw();
    } catch (err) {
      logError("academic settings load", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function draw() {
    const tabs = h("div.u-row", { style: { gap: "6px", flexWrap: "wrap", marginBottom: "12px" }, role: "tablist" },
      TABS.map(([k, label]) => h(`button.btn.${state.tab === k ? "btn-primary" : "btn-outline"}.btn-sm`, {
        type: "button", role: "tab", "aria-selected": String(state.tab === k), text: label,
        onclick: () => { state.tab = k; draw(); },
      })));
    const panel = { sections, assessment, grading, remarks, results, admission, reportcard }[state.tab]();
    mount(body, tabs, panel);
  }

  /* ---------------- shared bits ---------------- */
  function card(title, intro, ...children) {
    return h("div.card", {}, h("h2.card-title", { text: title }),
      intro ? h("p.u-small.u-muted", { text: intro }) : null, ...children);
  }

  async function run(btn, label, fn, after) {
    setBusy(btn, true, "Saving…");
    try {
      const result = await fn();
      toastOk(typeof after === "function" ? after(result) : label);
      await load();
    } catch (err) {
      toastError(humanError(err, "Those settings could not be saved."));
    } finally { setBusy(btn, false); }
  }

  /* ---------------- 1. sections ---------------- */
  function sections() {
    const on = new Set(state.data.sections.filter((s) => s.is_enabled).map((s) => s.section));
    const c = state.data.counts || {};

    return card("School sections",
      "Only the sections you switch on appear in your portal: classes, reports, teachers and registration. Switching one on adds its default classes.",
      h("div.u-stack", { style: { gap: "8px" } }, SECTIONS.map(([code, label, note]) => h("div.u-row", {
        style: { gap: "12px", padding: "12px", border: "1px solid var(--ama-line)", borderRadius: "10px", alignItems: "center", flexWrap: "wrap" },
      },
        h("div.u-grow", {}, h("div", { style: { fontWeight: "600" }, text: label }), h("div.u-xs.u-muted", { text: note })),
        on.has(code)
          ? h("span.badge.badge-ok", { text: "Switched on" })
          : h("button.btn.btn-outline.btn-sm", {
              type: "button", text: "Switch on",
              onclick: (e) => run(e.target, "Section switched on",
                async () => unwrap(await supabase.rpc("enable_school_section", { p_section: code }), "enable section"),
                (n) => code === "other" ? "Switched on. Add your own classes." : `Switched on — ${n} class${n === 1 ? "" : "es"} ready`),
            }),
      ))),
      h("p.u-xs.u-muted", { style: { marginTop: "10px" }, text: "Sections can be added but not removed here, so a class with students in it is never hidden by accident. To remove a section, contact AMA EDU support." }),
      h("div", { style: { marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--ama-line)" } },
        h("h3", { text: "Student numbers" }),
        h("div.u-row", { style: { gap: "24px", flexWrap: "wrap" } },
          stat("Declared at registration", c.declared_count ?? "—"),
          stat("Active students now", c.active_students ?? 0),
          stat("Counted for billing", c.billable_students ?? 0)),
        h("p.u-xs.u-muted", { text: "Billing uses your actual active students, worked out automatically, so it always matches your roll." })),
    );
  }
  function stat(label, value) {
    return h("div", {}, h("div.u-xs.u-muted", { text: label }), h("div", { style: { fontSize: "22px", fontWeight: "700", color: "var(--ama-green-deep)" }, text: String(value) }));
  }

  /* ---------------- 2. assessment system ---------------- */
  function assessment() {
    const byCode = Object.fromEntries(state.data.components.map((c) => [c.code, c]));
    const rows = ["ca1", "ca2", "ca3", "exam"].map((code, i) => ({
      code, label: byCode[code]?.label || code.toUpperCase(),
      max: Number(byCode[code]?.max_score ?? 0), active: byCode[code]?.is_active ?? code === "exam", order: i + 1,
    }));

    const totalNote = h("div", { style: { fontWeight: "700", margin: "10px 0" } });
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save assessment system" });
    const inputs = rows.map((r) => {
      const label = h("input.input", { value: r.label, "aria-label": `${r.code} name`, oninput: (e) => { r.label = e.target.value; } });
      const max = h("input.input.u-num", { type: "number", min: "0", max: "100", step: "1", value: r.max || "", "aria-label": `${r.label} maximum`, style: { maxWidth: "110px" },
        oninput: (e) => { r.max = Number(e.target.value) || 0; refresh(); } });
      const on = h("input", { type: "checkbox", checked: r.active, disabled: r.code === "exam", style: { width: "20px", height: "20px" }, "aria-label": `${r.label} switched on`,
        onchange: (e) => { r.active = e.target.checked; max.disabled = !r.active; refresh(); } });
      max.disabled = !r.active;
      r.controls = { label, max, on };
      return h("tr", {},
        h("td", {}, on), h("td", {}, label), h("td.num", {}, max));
    });

    function total() { return rows.filter((r) => r.active).reduce((sum, r) => sum + (Number(r.max) || 0), 0); }
    function refresh() {
      const t = total();
      totalNote.textContent = `Total: ${t} / 100${t === 100 ? "  ✓" : t < 100 ? `  (${100 - t} short)` : `  (${t - 100} over)`}`;
      totalNote.style.color = t === 100 ? "var(--ama-green-deep)" : "var(--ama-danger)";
      saveBtn.disabled = t !== 100;
    }
    refresh();

    function apply(values) {
      rows.forEach((r, i) => {
        r.max = values[i]; r.active = values[i] > 0 || r.code === "exam";
        r.controls.max.value = r.max || ""; r.controls.max.disabled = !r.active; r.controls.on.checked = r.active;
      });
      refresh();
    }

    saveBtn.addEventListener("click", () => run(saveBtn, "Assessment system saved", async () => unwrap(await supabase.rpc("save_assessment_components", {
      p_components: rows.map((r) => ({
        code: r.code, label: r.label.trim() || r.code.toUpperCase(),
        // a switched-off part keeps its old maximum so it can be switched back on
        max_score: r.active ? r.max : Math.max(byCode[r.code]?.max_score || 1, 1),
        is_active: r.active, sort_order: r.order,
      })),
    }), "save components")));

    return card("Assessment system",
      "Set the maximum mark for each part. Only switched-on parts count, and they must add up to exactly 100. Score-entry screens follow this automatically.",
      h("div.u-row", { style: { gap: "6px", flexWrap: "wrap", marginBottom: "10px" } },
        h("span.u-xs.u-muted", { text: "Quick start:" }),
        ASSESSMENT_PRESETS.map((p) => h("button.btn.btn-outline.btn-sm", { type: "button", text: p.name, onclick: () => apply(p.v) }))),
      h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "On" }), h("th", { text: "Name on report" }), h("th.num", { text: "Maximum mark" }))),
        h("tbody", {}, inputs))),
      totalNote,
      inlineAlert("A maximum cannot be lowered below a mark that is already entered, and a part that already has marks cannot be switched off. The examination must stay on.", "info"),
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "12px" } }, saveBtn));
  }

  /* ---------------- 3. grading ---------------- */
  function grading() {
    const rows = state.data.bands.length
      ? state.data.bands.map((b) => ({ grade: b.grade, min: Number(b.min_score), max: Number(b.max_score), remark: b.remark || "", pass: !!b.is_pass }))
      : GRADE_PRESETS["A to F"].map(([grade, min, max, remark, pass]) => ({ grade, min, max, remark, pass }));
    return rangeEditor({
      title: "Grading scale",
      intro: "Each grade covers a range of total marks. Together the ranges must cover 0 to 100 with no gaps and no overlaps. Grades are worked out by the database, never in the browser.",
      rows, withGrade: true, presets: GRADE_PRESETS,
      onSave: async (list) => unwrap(await supabase.rpc("save_grading_bands", {
        p_bands: list.map((r, i) => ({ grade: r.grade, min_score: r.min, max_score: r.max, remark: r.remark, is_pass: r.pass, sort_order: i })),
      }), "save grading"),
      after: (n) => `Grading saved — ${n} existing score${n === 1 ? "" : "s"} re-graded`,
      strictCoverage: true,
    });
  }

  /* ---------------- 4. remarks ---------------- */
  function remarks() {
    const defaults = [[90, 100, "Outstanding"], [80, 89.99, "Excellent"], [70, 79.99, "Very good"], [60, 69.99, "Good"], [50, 59.99, "Fair"], [40, 49.99, "Pass"], [0, 39.99, "Needs improvement"]];
    const rows = state.data.remarks.length
      ? state.data.remarks.map((r) => ({ min: Number(r.min_score), max: Number(r.max_score), remark: r.remark }))
      : defaults.map(([min, max, remark]) => ({ min, max, remark }));
    return rangeEditor({
      title: "Grade remarks",
      intro: "The short phrase printed beside each subject score. These are independent of the grade letters, so you can grade in six bands and remark in ten.",
      rows, withGrade: false, presets: { "Standard": defaults.map(([min, max, remark]) => [remark, min, max, remark, true]) },
      onSave: async (list) => unwrap(await supabase.rpc("save_grade_remarks", {
        p_remarks: list.map((r, i) => ({ min_score: r.min, max_score: r.max, remark: r.remark, sort_order: i })),
      }), "save remarks"),
      after: () => "Remarks saved", strictCoverage: false,
    });
  }

  /** One editor for both scales: rows of range + text, with live checks. */
  function rangeEditor({ title, intro, rows, withGrade, presets, onSave, after, strictCoverage }) {
    const host = h("div");
    const problem = h("div");
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save" });

    function check() {
      const list = rows.slice().sort((a, b) => a.min - b.min);
      const issues = [];
      list.forEach((r, i) => {
        if (withGrade && !String(r.grade).trim()) issues.push("Every grade needs a name.");
        if (!withGrade && !String(r.remark).trim()) issues.push("Every range needs a remark.");
        if (!(r.min >= 0) || !(r.max <= 100) || r.min > r.max) issues.push(`${r.grade || r.remark || "A range"}: use 0 to 100, minimum not above maximum.`);
        if (i > 0) {
          const prev = list[i - 1];
          if (r.min <= prev.max) issues.push(`Ranges overlap around ${r.min}.`);
          else if (r.min - prev.max > 0.011 && strictCoverage) issues.push(`Gap between ${prev.max} and ${r.min}.`);
        }
      });
      if (list.length && strictCoverage) {
        if (list[0].min !== 0) issues.push("The lowest grade must start at 0.");
        if (list[list.length - 1].max < 100) issues.push("The highest grade must reach 100.");
      }
      if (!list.length) issues.push("Add at least one row.");
      return [...new Set(issues)];
    }

    function paint() {
      const issues = check();
      mount(problem, issues.length ? inlineAlert(issues.slice(0, 4).join("  "), strictCoverage ? "error" : "warn") : null);
      saveBtn.disabled = issues.length > 0 && strictCoverage || rows.length === 0;
    }

    function drawRows() {
      mount(host, h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {},
          withGrade ? h("th", { text: "Grade" }) : null, h("th.num", { text: "From" }), h("th.num", { text: "To" }),
          h("th", { text: withGrade ? "Remark" : "Remark" }), withGrade ? h("th", { text: "Pass" }) : null, h("th", { text: "" }))),
        h("tbody", {}, rows.map((r, i) => h("tr", {},
          withGrade ? h("td", {}, h("input.input", { value: r.grade, style: { maxWidth: "90px" }, "aria-label": "Grade", oninput: (e) => { r.grade = e.target.value; paint(); } })) : null,
          h("td.num", {}, h("input.input.u-num", { type: "number", step: "0.01", min: "0", max: "100", value: r.min, style: { maxWidth: "90px" }, "aria-label": "From", oninput: (e) => { r.min = Number(e.target.value); paint(); } })),
          h("td.num", {}, h("input.input.u-num", { type: "number", step: "0.01", min: "0", max: "100", value: r.max, style: { maxWidth: "90px" }, "aria-label": "To", oninput: (e) => { r.max = Number(e.target.value); paint(); } })),
          h("td", {}, h("input.input", { value: r.remark, "aria-label": "Remark", oninput: (e) => { r.remark = e.target.value; paint(); } })),
          withGrade ? h("td", {}, h("input", { type: "checkbox", checked: r.pass, style: { width: "20px", height: "20px" }, "aria-label": "Counts as a pass", onchange: (e) => { r.pass = e.target.checked; } })) : null,
          h("td", {}, h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Remove", onclick: () => { rows.splice(i, 1); drawRows(); paint(); } })),
        ))))));
    }
    drawRows(); paint();

    saveBtn.addEventListener("click", () => run(saveBtn, "Saved", () => onSave(rows.slice().sort((a, b) => b.max - a.max)), after));

    return card(title, intro,
      h("div.u-row", { style: { gap: "6px", flexWrap: "wrap", marginBottom: "10px" } },
        h("span.u-xs.u-muted", { text: "Quick start:" }),
        Object.entries(presets).map(([name, list]) => h("button.btn.btn-outline.btn-sm", {
          type: "button", text: name,
          onclick: () => { rows.length = 0; list.forEach(([g, min, max, remark, pass]) => rows.push({ grade: g, min, max, remark, pass })); drawRows(); paint(); },
        }))),
      host, problem,
      h("div.u-row", { style: { gap: "8px", justifyContent: "space-between", marginTop: "12px", flexWrap: "wrap" } },
        h("button.btn.btn-outline.btn-sm", { type: "button", text: "Add a row", onclick: () => { rows.push({ grade: "", min: 0, max: 0, remark: "", pass: true }); drawRows(); paint(); } }),
        saveBtn));
  }

  /* ---------------- 5. results & fees ---------------- */
  function results() {
    const s = state.data.school;
    let policy = s.result_fee_policy || "block_unpaid";
    let teachers = !!s.teachers_may_publish;
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save" });

    const radio = (value, title, note) => h("label.u-row", { style: { gap: "10px", padding: "12px", border: "1px solid var(--ama-line)", borderRadius: "10px", cursor: "pointer", alignItems: "flex-start" } },
      h("input", { type: "radio", name: "feePolicy", value, checked: policy === value, style: { width: "20px", height: "20px", marginTop: "2px" }, onchange: () => { policy = value; } }),
      h("span", {}, h("span", { style: { fontWeight: "600", display: "block" }, text: title }), h("span.u-xs.u-muted", { text: note })));

    saveBtn.addEventListener("click", () => run(saveBtn, "Saved", async () => unwrap(
      await supabase.from("schools").update({ result_fee_policy: policy, teachers_may_publish: teachers }).eq("id", session.schoolId), "save results policy")));

    return card("Results & fees",
      "Results are never visible to students or parents until an administrator publishes them. This page decides who may publish, and whether unpaid fees hide a published result.",
      h("div.u-stack", { style: { gap: "8px" } },
        radio("always_visible", "Do not block results for unpaid students", "Every student sees their result once it is published, whatever their fee status."),
        radio("block_unpaid", "Block results for unpaid students", "A student with unpaid fees sees a message asking them to see the bursary instead of their result. Paid, part-waived and fully waived students are not blocked.")),
      h("p.u-xs.u-muted", { style: { margin: "10px 0" }, text: `A blocked student sees: "Your result is currently unavailable because the school's fee policy requires fees to be settled. Please contact the school bursary."` }),
      h("label.u-row", { style: { gap: "10px", alignItems: "flex-start", marginTop: "10px", cursor: "pointer" } },
        h("input", { type: "checkbox", checked: teachers, style: { width: "20px", height: "20px", marginTop: "2px" }, onchange: (e) => { teachers = e.target.checked; } }),
        h("span", {}, h("span", { style: { fontWeight: "600", display: "block" }, text: "Let a form teacher publish their own class" }),
          h("span.u-xs.u-muted", { text: "Off by default. Even when on, a teacher can publish only the class they are form teacher of, and only an administrator, headmaster or principal can unpublish." }))),
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "12px" } }, saveBtn));
  }

  /* ---------------- 6. admission numbers ---------------- */
  function admission() {
    return h("div.u-stack", { style: { gap: "20px" } },
      admissionNumbersCard(), staffIdsCard(), defaultPasswordsCard());
  }

  function admissionNumbersCard() {
    const s = state.data.school;
    const a = state.data.admission || {};
    const prefixInput = h("input.input", { value: s.admission_prefix || "", maxlength: "20", style: { maxWidth: "160px" }, placeholder: "e.g. ADM" });
    const widthInput = h("input.input.u-num", { type: "number", min: "1", max: "8", step: "1", value: s.admission_pad_width ?? 4, style: { maxWidth: "100px" } });
    const previewBox = h("div.u-row", { style: { gap: "24px", flexWrap: "wrap" } });
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save & sync from records" });
    const errorSlot = h("div");

    function paintPreview(p) {
      mount(previewBox,
        stat("Next admission number", p?.next_admission_no || "—"),
        stat("Last issued", p?.last_issued || "—"),
        stat("Active students", p?.total_active_students ?? 0),
      );
    }
    paintPreview(a);

    saveBtn.addEventListener("click", async () => {
      mount(errorSlot);
      const prefix = prefixInput.value.trim();
      const width = Number(widthInput.value);
      if (!/^[A-Za-z0-9/_-]{1,20}$/.test(prefix)) {
        return mount(errorSlot, inlineAlert("Prefix may only contain letters, digits, / - _ (1 to 20 characters)."));
      }
      if (!(width >= 1 && width <= 8)) {
        return mount(errorSlot, inlineAlert("Digits (padding) must be between 1 and 8."));
      }
      setBusy(saveBtn, true, "Syncing…");
      try {
        if (width !== s.admission_pad_width) {
          unwrap(await supabase.from("schools").update({ admission_pad_width: width }).eq("id", session.schoolId), "save pad width");
        }
        const rows = unwrap(await supabase.rpc("sync_admission_scheme", { p_prefix: prefix }), "sync admission scheme");
        const result = Array.isArray(rows) ? rows[0] : rows;
        toastOk(`Synced — ${result?.matched_count ?? 0} existing record${result?.matched_count === 1 ? "" : "s"} found, next number ${result?.next_admission_no || ""}`);
        await load();
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err, "Those admission number settings could not be saved.")));
      } finally {
        setBusy(saveBtn, false);
      }
    });

    return card("Admission numbers",
      "Every new student is admitted with an admission number the database assigns automatically, so two registrars working at once never get handed the same number. Set the prefix and how many digits follow it here.",
      h("div.form-grid.cols-2", {},
        field({ label: "Prefix", id: "admPrefix", control: prefixInput, hint: "Letters, digits, / - _ only, e.g. \"PCP2026\" or \"PAS/2026/\"." }),
        field({ label: "Digits (padding)", id: "admWidth", control: widthInput, hint: "Numbers longer than this are never truncated — the padding just decides the minimum width." })),
      errorSlot,
      h("div", { style: { margin: "12px 0" } }, previewBox),
      inlineAlert("\"Save & sync from records\" re-aligns the next number with the highest one already in use — useful after typing numbers by hand or importing students.", "info"),
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "12px" } }, saveBtn));
  }

  function staffIdsCard() {
    const s = state.data.school;
    const p = state.data.staffCode || {};
    const prefixInput = h("input.input", { value: s.staff_code_prefix || "", maxlength: "20", style: { maxWidth: "160px" }, placeholder: "e.g. ST" });
    const widthInput = h("input.input.u-num", { type: "number", min: "1", max: "8", step: "1", value: s.staff_code_pad_width ?? 4, style: { maxWidth: "100px" } });
    const previewBox = h("div.u-row", { style: { gap: "24px", flexWrap: "wrap" } });
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save & sync from records" });
    const errorSlot = h("div");

    function paintPreview(preview) {
      mount(previewBox,
        stat("Next Staff ID", preview?.next_staff_code || "—"),
        stat("Last issued", preview?.last_issued || "—"),
        stat("Active staff", preview?.total_active_staff ?? 0),
      );
    }
    paintPreview(p);

    saveBtn.addEventListener("click", async () => {
      mount(errorSlot);
      const prefix = prefixInput.value.trim();
      const width = Number(widthInput.value);
      if (!/^[A-Za-z0-9/_-]{1,20}$/.test(prefix)) {
        return mount(errorSlot, inlineAlert("Prefix may only contain letters, digits, / - _ (1 to 20 characters)."));
      }
      if (!(width >= 1 && width <= 8)) {
        return mount(errorSlot, inlineAlert("Digits (padding) must be between 1 and 8."));
      }
      setBusy(saveBtn, true, "Syncing…");
      try {
        if (width !== s.staff_code_pad_width) {
          unwrap(await supabase.from("schools").update({ staff_code_pad_width: width }).eq("id", session.schoolId), "save pad width");
        }
        const rows = unwrap(await supabase.rpc("sync_staff_code_scheme", { p_prefix: prefix }), "sync staff ID scheme");
        const result = Array.isArray(rows) ? rows[0] : rows;
        toastOk(`Synced — ${result?.matched_count ?? 0} existing record${result?.matched_count === 1 ? "" : "s"} found, next ID ${result?.next_staff_code || ""}`);
        await load();
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err, "Those Staff ID settings could not be saved.")));
      } finally {
        setBusy(saveBtn, false);
      }
    });

    return card("Staff IDs",
      "Adding a staff member suggests the next Staff ID automatically, the same way admission numbers work — the suggestion can still be typed over by hand.",
      h("div.form-grid.cols-2", {},
        field({ label: "Prefix", id: "stcPrefix", control: prefixInput, hint: "Letters, digits, / - _ only, e.g. \"ST\" or \"TCH\"." }),
        field({ label: "Digits (padding)", id: "stcWidth", control: widthInput })),
      errorSlot,
      h("div", { style: { margin: "12px 0" } }, previewBox),
      inlineAlert("A cancelled \"Add staff\" dialog can leave a small gap in the sequence — press \"Save & sync from records\" any time to close it.", "info"),
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "12px" } }, saveBtn));
  }

  function defaultPasswordsCard() {
    // Deliberately never pre-filled from a fetched value — see the note at
    // the top of migration 0042: a default password is set here and never
    // read back into any screen afterward.
    const studentPw = h("input.input", { type: "password", minlength: "6", placeholder: "Not shown once saved", autocomplete: "new-password" });
    const staffPw = h("input.input", { type: "password", minlength: "6", placeholder: "Not shown once saved", autocomplete: "new-password" });
    const errorSlot = h("div");
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save defaults" });

    saveBtn.addEventListener("click", async () => {
      mount(errorSlot);
      const payload = {};
      if (studentPw.value) {
        if (studentPw.value.length < 6) return mount(errorSlot, inlineAlert("The student default password must be at least 6 characters."));
        payload.student_default_password = studentPw.value;
      }
      if (staffPw.value) {
        if (staffPw.value.length < 6) return mount(errorSlot, inlineAlert("The staff default password must be at least 6 characters."));
        payload.staff_default_password = staffPw.value;
      }
      if (!Object.keys(payload).length) return mount(errorSlot, inlineAlert("Type at least one password to save."));

      setBusy(saveBtn, true, "Saving…");
      try {
        unwrap(await supabase.from("schools").update(payload).eq("id", session.schoolId), "save default passwords");
        toastOk("Default password saved");
        studentPw.value = ""; staffPw.value = "";
      } catch (err) {
        mount(errorSlot, inlineAlert(humanError(err, "Those default passwords could not be saved.")));
      } finally {
        setBusy(saveBtn, false);
      }
    });

    return card("Default passwords",
      "Used automatically whenever \"Create login\" or a password reset is submitted with the password field left blank — for one person at a time on the Staff and Students pages, and for the bulk reset panels there. Leave a box blank to leave that default unchanged.",
      h("div.form-grid.cols-2", {},
        field({ label: "Student default password", id: "defStudentPw", control: studentPw }),
        field({ label: "Staff default password", id: "defStaffPw", control: staffPw })),
      errorSlot,
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "12px" } }, saveBtn));
  }

  /* ---------------- 7. report card ---------------- */
  const SIGNATORY_ROLES = [
    ["headmaster", "Headmaster", "headmaster_fallback_name", "headmaster_fallback_sig_url"],
    ["principal", "Principal", "principal_fallback_name", "principal_fallback_sig_url"],
    ["admin_officer", "Admin Officer", "admin_officer_fallback_name", "admin_officer_fallback_sig_url"],
  ];

  function signatoriesEditor(opts) {
    const bySource = { staff: "an active staff member's own record", fallback: "the fallback typed here", school: "the school's saved name", none: "nothing set yet" };
    const current = Object.fromEntries((state.data.signatories || []).map((r) => [r.role_key, r]));
    const errorSlot = h("div");
    const inputs = SIGNATORY_ROLES.map(([key, label, nameKey, urlKey]) => {
      const nameInput = h("input.input", { value: opts[nameKey] || "", maxlength: "120", placeholder: `Fallback ${label.toLowerCase()} name` });
      const urlInput = h("input.input", { type: "url", value: opts[urlKey] || "", placeholder: "https://…" });
      const c = current[key];
      const liveNote = c
        ? h("p.u-xs.u-muted", { text: `Currently prints: ${c.full_name || "(no name set)"} — from ${bySource[c.source] || c.source}.` })
        : null;
      return { key, label, nameKey, urlKey, nameInput, urlInput,
        node: h("div", { style: { padding: "10px 0", borderTop: "1px solid var(--ama-line)" } },
          h("h4", { text: label, style: { margin: "0 0 6px" } }),
          liveNote,
          h("div.form-grid.cols-2", {},
            field({ label: "Fallback name", id: `sig-${key}-name`, control: nameInput }),
            field({ label: "Fallback signature address", id: `sig-${key}-url`, control: urlInput, hint: "https link to a scanned signature." })),
        ) };
    });

    function validate() {
      for (const i of inputs) {
        const url = i.urlInput.value.trim();
        if (url && !/^https:\/\//i.test(url)) return `The ${i.label} signature address must start with https://`;
      }
      return null;
    }
    function collect() {
      const payload = {};
      for (const i of inputs) {
        payload[i.nameKey] = i.nameInput.value.trim() || null;
        payload[i.urlKey] = i.urlInput.value.trim() || null;
      }
      return payload;
    }

    return { validate, payload: collect, node: h("div", { style: { marginTop: "18px", paddingTop: "14px", borderTop: "1px solid var(--ama-line)" } },
      h("h3", { text: "Signatories" }),
      h("p.u-xs.u-muted", { text: "Whoever actively holds Headmaster, Principal, or is marked \"Admin Officer\" in Staff signs automatically with their own name and signature. These fallbacks print only when nobody currently holds the position." }),
      inputs.map((i) => i.node),
    ) };
  }

  function reportcard() {
    const d = state.data;
    const opts = { ...d.rc };
    const picker = templatePicker({ value: d.school.report_card_template, school: d.school, components: d.components, onChange: () => {} });
    const title = h("input.input", { value: opts.head_title || "TERM REPORT CARD", maxlength: "60" });
    const footer = h("input.input", { value: opts.footer_note || "", maxlength: "160" });
    const check = (key, label) => h("label.u-row", { style: { gap: "10px", cursor: "pointer" } },
      h("input", { type: "checkbox", checked: opts[key] !== false, style: { width: "20px", height: "20px" }, onchange: (e) => { opts[key] = e.target.checked; } }), label);
    const signatories = signatoriesEditor(opts);
    const saveBtn = h("button.btn.btn-primary", { type: "button", text: "Save report card settings" });
    const errorSlot = h("div");

    saveBtn.addEventListener("click", () => {
      mount(errorSlot);
      const problem = signatories.validate();
      if (problem) return mount(errorSlot, inlineAlert(problem));
      run(saveBtn, "Report card saved", async () => {
        const signatoryPayload = signatories.payload();
        unwrap(await supabase.from("schools").update({ report_card_template: picker.value }).eq("id", session.schoolId), "save template");
        unwrap(await supabase.from("school_report_card_settings").update({
          head_title: title.value.trim() || "TERM REPORT CARD", footer_note: footer.value.trim() || null,
          show_photo: opts.show_photo !== false, show_attendance: opts.show_attendance !== false, show_positions: opts.show_positions !== false,
          ...signatoryPayload,
        }).eq("school_id", session.schoolId), "save report card options");
        // keep this session's copy current so the next preview uses it
        if (context.school) context.school.report_card_template = picker.value;
        if (session.school) session.school.report_card_template = picker.value;
      });
    });

    return card("Report card",
      "Pick the design your school prints. Changing it never touches a stored result: existing results simply draw in the new design.",
      picker.node,
      h("div", { style: { marginTop: "16px" } },
        h("div.form-grid.cols-2", {},
          field({ label: "Heading", id: "rcTitle", control: title }),
          field({ label: "Footer note", id: "rcFooter", control: footer, hint: "Optional line at the bottom of every report." })),
        h("div.u-stack", { style: { gap: "8px", margin: "8px 0" } },
          check("show_photo", "Show the student's photo"),
          check("show_attendance", "Show days present and absent"),
          check("show_positions", "Show subject and class positions"))),
      signatories.node,
      errorSlot,
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "12px" } }, saveBtn));
  }
}
