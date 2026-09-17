// ============================================================
// BULK IMPORT STUDENT SCORES
// Teacher photographs a score sheet -> AI converts it to a simple
// pipe-delimited table -> paste here -> preview -> import.
//
// ALL safety logic (student matching, never-overwrite, zero-is-real,
// blank-never-erases, validation, score locks, teacher permissions)
// lives in the bulk_import_scores() Postgres function — this file
// only collects input and renders what that function reports back.
// Preview and commit call the SAME function (p_dry_run true/false),
// so what the teacher previews is exactly what gets written.
// ============================================================

function openBulkScoreImport() {
  const cls = state.currentClass;
  const term = state.terms.find(t => t.id === state.currentTermId);
  const isNurseryPrimary = cls.category === "nursery" || cls.category === "primary";
  const periods = isNurseryPrimary ? ["ca1","ca2","exam"] : ["ca1","ca2","ca3","exam"];
  const labelOf = { ca1:"CA1 (max 15)", ca2:"CA2 (max 15)", ca3:"CA3 (max 15)", exam:"Exam (max 70)" };

  openModal(`
    <h3 style="margin-top:0;">Bulk Import Scores</h3>
    <div class="settings-row"><span>Class</span><span><strong>${cls.name}</strong></span></div>
    <div class="settings-row"><span>Term</span><span><strong>${term?.name || ""}</strong></span></div>

    <div class="field" style="margin-top:12px;"><label>Subject</label>
      <select id="bsiSubject">${(state.bsiSubjectList||[]).map(s => `<option value="${s.id}">${s.name}</option>`).join("")}</select></div>

    <div class="field"><label>Score Types to Import</label>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        ${periods.map(p => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
          <input type="checkbox" class="bsiPeriod" value="${p}" ${p==="ca1"?"checked":""} style="width:auto;"/> ${labelOf[p]}
        </label>`).join("")}
      </div>
      ${isNurseryPrimary ? `<p style="font-size:11px;color:var(--dash-muted);margin-top:6px;">CA3 isn't used for ${cls.category} classes, so it's not offered here.</p>` : ""}
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">
      <button class="btn" onclick="copyBulkScorePrompt()"><i class="fa-solid fa-robot"></i> Copy AI Prompt</button>
      <button class="btn" onclick="copyClassStudentList()"><i class="fa-solid fa-list"></i> Copy Class Student List</button>
    </div>

    <div class="field"><label>Paste AI Output</label>
      <textarea id="bsiPasteBox" rows="7" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;font-family:monospace;font-size:12px;" placeholder="ADMISSION_NO | STUDENT_NAME | CA1 | CA2 | CA3 | EXAM
PCP260001 | Musa Umar | 12 | | |
PCP260002 | Aisha Ali | 10 | 13 | |"></textarea></div>

    <button class="btn btn-green" style="width:100%;" onclick="previewBulkScoreImport()"><i class="fa-solid fa-eye"></i> Preview Import</button>
    <div id="bsiPreviewHost" style="margin-top:14px;"></div>
  `);
  loadBsiSubjects();
}

// Only subjects this person may actually edit for this class —
// admin/head/principal get all class subjects, a teacher gets only
// their own assignments (same rule the score grid itself uses).
async function loadBsiSubjects() {
  const cls = state.currentClass;
  const isPrivileged = (state.allRoles||[state.role]).some(r => ["admin","headmaster","principal"].includes(r));
  let subjects = [];
  const { data: classSubjects } = await sb.from("class_subjects").select("subject_id, subjects(id,name,sort_order)").eq("class_id", cls.id);
  subjects = (classSubjects||[]).map(cs => cs.subjects);
  if (!isPrivileged) {
    const { data: mine } = await sb.from("class_teacher_subjects").select("subject_id").eq("class_id", cls.id).eq("staff_id", state.staff.id);
    const allowed = new Set((mine||[]).map(m => m.subject_id));
    subjects = subjects.filter(s => allowed.has(s.id));
  }
  subjects.sort((a,b) => (a.sort_order??99) - (b.sort_order??99));
  state.bsiSubjectList = subjects;
  const sel = document.getElementById("bsiSubject");
  if (sel) sel.innerHTML = subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("")
    || `<option value="">No subjects available to you for this class</option>`;
}

function bsiSelectedPeriods() {
  return [...document.querySelectorAll(".bsiPeriod:checked")].map(c => c.value);
}

function copyBulkScorePrompt() {
  const cls = state.currentClass;
  const term = state.terms.find(t => t.id === state.currentTermId);
  const subjSel = document.getElementById("bsiSubject");
  const subjectName = subjSel?.selectedOptions[0]?.textContent || "[SUBJECT]";
  const periods = bsiSelectedPeriods();
  if (!periods.length) { alert("Tick at least one score type first, so the prompt tells the AI what to extract."); return; }
  const periodLabels = periods.map(p => p.toUpperCase()).join(", ");

  const prompt = `I am uploading a photograph of a score sheet. Read it carefully and extract the students' scores.

Context (do NOT try to infer these yourself — they are already known):
Class: ${cls.name}
Subject: ${subjectName}
Term: ${term?.name || ""}
Importing: ${periodLabels}

Rules you MUST follow exactly:
- Extract each student's admission number exactly as written. Never invent, guess, correct, or reformat an admission number.
- Extract each student's full name as written.
- I only need these columns: ${periodLabels}. Leave every other column blank, even if you can see it in the photo.
- If a score is missing, unreadable, or blank, leave that field EMPTY. Never guess a value.
- A score of 0 is a real score — write 0. Do not treat it as blank, and never turn a blank into 0.
- Never invent a student who is not on the sheet.
- Do not calculate, total, average, round, or modify any score.

Return ONLY a table in exactly this pipe-delimited format, with this exact header row, and nothing else — no explanation, no notes, no markdown code fences:

ADMISSION_NO | STUDENT_NAME | CA1 | CA2 | CA3 | EXAM

Example of the expected shape:
PCP260001 | Musa Umar | 12 | | |
PCP260002 | Aisha Ali | 10 | 13 | |
PCP260003 | Ibrahim Bello | | 14 | | 62`;

  bsiCopy(prompt, "Prompt copied! Upload your score-sheet photo to ChatGPT/Claude/Gemini, paste this prompt with it, then paste the AI's answer back here.");
}

async function copyClassStudentList() {
  const { data: students } = await sb.from("students").select("admission_no, full_name")
    .eq("class_id", state.currentClass.id).eq("is_active", true).order("full_name");
  if (!students || !students.length) { alert("No active students in this class."); return; }
  const text = "ADMISSION_NO | STUDENT_NAME\n" + students.map(s => `${s.admission_no} | ${s.full_name}`).join("\n");
  bsiCopy(text, `Copied ${students.length} students. Paste this into the AI alongside the photo so it matches names to the correct admission numbers instead of guessing.`);
}

function bsiCopy(text, successMsg) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => alert(successMsg), () => bsiCopyFallback(text));
  } else bsiCopyFallback(text);
}
function bsiCopyFallback(text) {
  const box = document.getElementById("bsiPasteBox");
  const holder = document.createElement("textarea");
  holder.value = text;
  holder.style.cssText = "width:100%;height:200px;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;font-family:monospace;font-size:12px;margin-top:8px;";
  holder.readOnly = true;
  box.parentElement.insertBefore(holder, box);
  holder.select();
  alert("Couldn't copy automatically — the text is in the box above the paste area, select and copy it manually.");
}

// Parses the pipe-delimited AI output. Tolerant of the header row,
// markdown fences, and extra spacing, since AIs add those despite
// instructions. Anything it can't make sense of is reported rather
// than silently dropped.
function parseBulkScoreText(raw) {
  const rows = [];
  const errors = [];
  const lines = raw.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("```"));
  lines.forEach((line, i) => {
    if (!line.includes("|")) { errors.push(`Line ${i+1} has no "|" separators — skipped.`); return; }
    const cells = line.split("|").map(c => c.trim());
    const first = (cells[0]||"").toUpperCase();
    if (first === "ADMISSION_NO" || first.startsWith("---")) return; // header / markdown divider
    rows.push({
      admission_no: cells[0] || "",
      full_name: cells[1] || "",
      ca1: cells[2] || "",
      ca2: cells[3] || "",
      ca3: cells[4] || "",
      exam: cells[5] || "",
    });
  });
  return { rows, errors };
}

const BSI_ACTION_LABELS = {
  imported:      { icon: "🟢", text: "Will import",            cls: "badge-success" },
  preserved:     { icon: "🟡", text: "Existing score kept",    cls: "badge-warning" },
  blank:         { icon: "⚪", text: "Blank",                  cls: "badge-neutral" },
  not_found:     { icon: "🔴", text: "Student not found",      cls: "badge-danger"  },
  ambiguous:     { icon: "🟠", text: "Ambiguous match",        cls: "badge-warning" },
  invalid_score: { icon: "🔴", text: "Invalid score",          cls: "badge-danger"  },
  locked_period: { icon: "🔒", text: "Period closed",          cls: "badge-neutral" },
  locked_field:  { icon: "🔒", text: "Locked (submitted)",     cls: "badge-neutral" },
};

async function previewBulkScoreImport() {
  const host = document.getElementById("bsiPreviewHost");
  const subjectId = document.getElementById("bsiSubject").value;
  const periods = bsiSelectedPeriods();
  const raw = document.getElementById("bsiPasteBox").value;

  if (!subjectId) { alert("Choose a subject."); return; }
  if (!periods.length) { alert("Tick at least one score type to import."); return; }
  if (!raw.trim()) { alert("Paste the AI output first."); return; }

  const { rows, errors } = parseBulkScoreText(raw);
  if (!rows.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn't read any data rows. Check the format matches the example.</p></div>`; return; }

  host.innerHTML = "Checking against existing scores…";
  const { data, error } = await sb.rpc("bulk_import_scores", {
    p_class_id: state.currentClass.id, p_subject_id: subjectId, p_term_id: state.currentTermId,
    p_periods: periods, p_rows: rows, p_dry_run: true,
  });
  if (error) { host.innerHTML = `<p style="color:var(--dash-danger);">${error.message}</p>`; return; }

  state.bsiPendingRows = rows;
  state.bsiPendingSubject = subjectId;
  state.bsiPendingPeriods = periods;
  host.innerHTML = renderBsiPreview(data, periods, errors, false);
}

function renderBsiPreview(data, periods, parseErrors, isFinal) {
  const tally = { imported:0, preserved:0, blank:0, not_found:0, ambiguous:0, invalid_score:0, locked_period:0, locked_field:0 };
  data.forEach(r => periods.forEach(p => {
    const a = r.field_results?.[p]?.action;
    if (a && tally[a] !== undefined) tally[a]++;
  }));
  const anyImportable = tally.imported > 0;

  const cellFor = (r, p) => {
    const f = r.field_results?.[p];
    if (!f) return "—";
    const meta = BSI_ACTION_LABELS[f.action] || { icon: "", text: f.action, cls: "badge-neutral" };
    const shown = f.incoming ?? "—";
    const existingNote = (f.action === "preserved") ? ` <span style="color:var(--dash-muted);">(keeping ${f.existing})</span>` : "";
    return `${shown}${existingNote}<br><span class="badge ${meta.cls}" style="font-size:9px;">${meta.icon} ${meta.text}</span>`;
  };

  return `
    ${parseErrors.length ? `<div class="badge badge-warning" style="margin-bottom:8px;">${parseErrors.length} line(s) couldn't be read</div>
      <div style="font-size:11px;color:var(--dash-danger);margin-bottom:8px;">${parseErrors.join("<br>")}</div>` : ""}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
      <span class="badge badge-success">🟢 ${tally.imported} ${isFinal ? "imported" : "to import"}</span>
      <span class="badge badge-warning">🟡 ${tally.preserved} existing kept</span>
      <span class="badge badge-neutral">⚪ ${tally.blank} blank</span>
      ${tally.not_found ? `<span class="badge badge-danger">🔴 ${tally.not_found} not found</span>` : ""}
      ${tally.ambiguous ? `<span class="badge badge-warning">🟠 ${tally.ambiguous} ambiguous</span>` : ""}
      ${tally.invalid_score ? `<span class="badge badge-danger">🔴 ${tally.invalid_score} invalid</span>` : ""}
      ${(tally.locked_period + tally.locked_field) ? `<span class="badge badge-neutral">🔒 ${tally.locked_period + tally.locked_field} locked</span>` : ""}
    </div>
    <div style="overflow-x:auto;max-height:340px;overflow-y:auto;"><table class="data-table sticky-head">
      <thead><tr><th>Student</th><th>Adm No</th>${periods.map(p=>`<th>${p.toUpperCase()}</th>`).join("")}</tr></thead>
      <tbody>${data.map(r => `<tr>
        <td class="name-cell">${r.resolved_full_name || r.input_full_name || "—"}
          ${r.match_status === "not_found" ? `<br><span class="badge badge-danger" style="font-size:9px;">🔴 Not found</span>` : ""}
          ${r.match_status === "ambiguous" ? `<br><span class="badge badge-warning" style="font-size:9px;">🟠 Ambiguous — fix the admission no</span>` : ""}
        </td>
        <td>${r.input_admission_no || "—"}</td>
        ${periods.map(p => `<td>${cellFor(r, p)}</td>`).join("")}
      </tr>`).join("")}</tbody>
    </table></div>
    ${isFinal
      ? `<div class="badge badge-success" style="margin-top:12px;">✅ Import complete — ${tally.imported} new score(s) saved, ${tally.preserved} existing score(s) left untouched.</div>
         <button class="btn" style="width:100%;margin-top:10px;" onclick="closeModal();loadClassScoreGrid();">Close &amp; Refresh Grid</button>`
      : anyImportable
        ? `<button class="btn btn-green" style="width:100%;margin-top:12px;" onclick="commitBulkScoreImport()"><i class="fa-solid fa-check"></i> Import ${tally.imported} Valid Score(s)</button>
           <p style="font-size:11px;color:var(--dash-muted);margin-top:6px;">Only the 🟢 rows will be written. Existing scores are never overwritten, and blanks never erase anything.</p>`
        : `<div class="badge badge-neutral" style="margin-top:12px;">Nothing new to import — every value is either blank, already present, locked, or invalid.</div>`}`;
}

async function commitBulkScoreImport() {
  const host = document.getElementById("bsiPreviewHost");
  host.innerHTML = "Importing…";
  const { data, error } = await sb.rpc("bulk_import_scores", {
    p_class_id: state.currentClass.id, p_subject_id: state.bsiPendingSubject, p_term_id: state.currentTermId,
    p_periods: state.bsiPendingPeriods, p_rows: state.bsiPendingRows, p_dry_run: false,
  });
  if (error) { host.innerHTML = `<p style="color:var(--dash-danger);">${error.message}</p>`; return; }
  host.innerHTML = renderBsiPreview(data, state.bsiPendingPeriods, [], true);
}
