/* ===============================================================
   Bulk import — paste a CSV, preview it, bring students or staff
   across in one go.

   Ports: renderImportTool / parseCsv / runImport (MyPAS1
   app-phase2d.js). Every imported row is stamped with the signed-in
   admin's own school_id — the CSV has no column that could name a
   different school, so this cannot be used to write into another
   tenant no matter what a pasted file contains.
   =============================================================== */

import { h, mount, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError } from "../lib/errors.js";
import { emptyState, inlineAlert, toastOk } from "../lib/ui.js";
import { fetchClasses } from "../lib/data.js";
import { session } from "../lib/auth.js";

const TEMPLATES = {
  students: {
    columns: ["admission_no", "full_name", "class_name", "gender", "guardian_name", "guardian_phone"],
    required: ["admission_no", "full_name", "class_name"],
    sample: "admission_no,full_name,class_name,gender,guardian_name,guardian_phone\nPAS-0142,Amina Suleiman,JSS 1,female,Mrs Suleiman,08030000000",
  },
  staff: {
    columns: ["staff_code", "full_name", "email", "phone", "position"],
    required: ["staff_code", "full_name"],
    sample: "staff_code,full_name,email,phone,position\nT010,Musa Bello,musa.bello@example.com,08030000001,Mathematics Teacher",
  },
};

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "registrar_primary", "registrar_secondary")) return;

  const state = { target: "students", rows: [], classesByName: new Map() };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Bulk import", subtitle: "Paste a CSV to bring across student or staff rosters.", body }));

  const classes = await fetchClasses().catch(() => []);
  classes.forEach((c) => state.classesByName.set(c.name.toLowerCase(), c.id));

  draw();

  function draw() {
    const targetSeg = h("div.seg", { style: { maxWidth: "260px" } },
      h(`button${state.target === "students" ? ".active" : ""}`, { type: "button", text: "Students", onclick: () => { state.target = "students"; state.rows = []; draw(); } }),
      h(`button${state.target === "staff" ? ".active" : ""}`, { type: "button", text: "Staff", onclick: () => { state.target = "staff"; state.rows = []; draw(); } }),
    );
    const tpl = TEMPLATES[state.target];

    const textarea = h("textarea.textarea", { style: { minHeight: "160px", fontFamily: "monospace", fontSize: "13px" }, placeholder: tpl.sample });
    const parseBtn = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Preview" });
    const errorSlot = h("div.u-mt-4");
    const previewHost = h("div.u-mt-4");

    parseBtn.addEventListener("click", () => {
      mount(errorSlot);
      try {
        state.rows = parseCsv(textarea.value, tpl);
        renderPreview(previewHost, tpl);
      } catch (err) {
        mount(errorSlot, inlineAlert(err.message, "error"));
      }
    });

    mount(body,
      targetSeg,
      h("section.card", {},
        h("h2.card-title", { text: `Paste ${state.target} CSV` }),
        h("p.u-xs.u-muted.u-mt-4", { text: `First row must be a header with these columns: ${tpl.columns.join(", ")}. Required: ${tpl.required.join(", ")}.` }),
        textarea,
        h("div.u-mt-4", {}, parseBtn),
        errorSlot,
      ),
      previewHost,
    );
  }

  function renderPreview(host, tpl) {
    if (!state.rows.length) return mount(host, emptyState({ title: "Nothing to import", body: "Paste some rows above and click Preview." }));

    const importBtn = h("button.btn.btn-primary", { type: "button", text: `Import ${state.rows.length} rows` });
    const resultSlot = h("div.u-mt-4");
    importBtn.addEventListener("click", () => runImport(state.rows, tpl, importBtn, resultSlot));

    mount(host, h("section.card.card-flush", {},
      h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {}, tpl.columns.map((c) => h("th", { text: c })))),
        h("tbody", {}, state.rows.slice(0, 50).map((r) => h("tr", {}, tpl.columns.map((c) => h("td", { text: r[c] || "—" }))))),
      )),
      h("div", { style: { padding: "16px" } },
        state.rows.length > 50 ? h("p.u-xs.u-muted", { text: `Showing first 50 of ${state.rows.length} rows.` }) : null,
        importBtn, resultSlot),
    ));
  }

  async function runImport(rows, tpl, btn, resultSlot) {
    setBusy(btn, true, "Importing…");
    mount(resultSlot);
    let added = 0, skipped = 0;
    const failures = [];

    for (const row of rows) {
      try {
        if (state.target === "students") {
          const classId = state.classesByName.get((row.class_name || "").toLowerCase());
          if (!classId) { failures.push(`${row.admission_no || "(no admission no.)"}: class "${row.class_name}" not found`); continue; }
          unwrap(await supabase.from("students").insert({
            school_id: session.schoolId,
            admission_no: row.admission_no, full_name: row.full_name, class_id: classId,
            gender: (row.gender || "").toLowerCase() || null,
            guardian_name: row.guardian_name || null, guardian_phone: row.guardian_phone || null,
          }), "import student");
        } else {
          unwrap(await supabase.from("staff").insert({
            school_id: session.schoolId,
            staff_code: row.staff_code, full_name: row.full_name,
            email: row.email || null, phone: row.phone || null, position: row.position || null,
          }), "import staff");
        }
        added++;
      } catch (err) {
        if (String(err.message || "").includes("already exists")) { skipped++; }
        else failures.push(`${row.admission_no || row.staff_code || row.full_name}: ${humanError(err)}`);
      }
    }

    setBusy(btn, false);
    toastOk(`Imported ${added} of ${rows.length}`);
    mount(resultSlot,
      h("div.alert.alert-success", {}, h("div", { text: `${added} added${skipped ? `, ${skipped} already existed and were skipped` : ""}.` })),
      failures.length ? h("div.alert.alert-error.u-mt-4", {}, h("div", {}, h("b", { text: `${failures.length} row(s) could not be imported:` }),
        h("ul", { style: { margin: "6px 0 0", paddingLeft: "18px" } }, failures.slice(0, 20).map((f) => h("li", { text: f }))))) : null,
    );
  }
}

/** Minimal CSV parser: comma-separated, optional quoted fields, header row required. */
function parseCsv(text, tpl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("Paste a header row and at least one data row.");

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  for (const col of tpl.required) {
    if (!header.includes(col)) throw new Error(`Missing required column "${col}" in the header row.`);
  }

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((col, i) => { row[col] = (cells[i] || "").trim(); });
    return row;
  }).filter((row) => tpl.required.every((col) => row[col]));
}

function splitCsvLine(line) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
