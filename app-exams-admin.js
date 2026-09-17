// ============================================================
// EXAMS & TESTS — TEACHER / ADMIN MANAGEMENT
// Tab-bar: Create & Manage | Question Bank | Results.
// RLS already scopes everything to "broad staff sees all, teacher
// sees only their own assigned class+subject" — this file just
// renders whatever the query legitimately returns.
// ============================================================

async function renderAssessmentsAdmin() {
  const el = document.getElementById("panel-assessments");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Exams &amp; Tests</h1>
        <p>Create and schedule tests/exams, manage questions, and review results.</p>
      </div>
    </div>
    <div class="tab-bar">
      <button class="tab-bar-item" id="eatab-manage" onclick="switchExAdminTab('manage')">📝 Create &amp; Manage</button>
      <button class="tab-bar-item" id="eatab-questions" onclick="switchExAdminTab('questions')">❓ Question Bank</button>
      <button class="tab-bar-item" id="eatab-results" onclick="switchExAdminTab('results')">📊 Results</button>
    </div>
    <div id="eapanel-manage" class="ea-panel"></div>
    <div id="eapanel-questions" class="ea-panel" style="display:none;"></div>
    <div id="eapanel-results" class="ea-panel" style="display:none;"></div>`;
  switchExAdminTab("manage");

  // Subscribed ONCE per visit to this whole panel (not per sub-tab
  // click, which would stack duplicate subscriptions every time
  // someone flips between Manage/Question Bank/Results) — the guard
  // inside only actually reloads when Results is the visible sub-tab
  // with an assessment already selected, so a submission landing
  // while you're on a different sub-tab doesn't do anything until
  // you're actually looking at Results.
  subscribeLive("assessment_attempts_changes", () => {
    const resultsPanel = document.getElementById("eapanel-results");
    const assessmentSelect = document.getElementById("resAssessmentSelect");
    if (resultsPanel && resultsPanel.style.display !== "none" && assessmentSelect && assessmentSelect.value) {
      loadResultsTable();
    }
  });
}
function switchExAdminTab(tab) {
  ["manage","questions","results"].forEach(t => {
    document.getElementById(`eapanel-${t}`).style.display = t === tab ? "block" : "none";
    document.getElementById(`eatab-${t}`).classList.toggle("active", t === tab);
  });
  if (tab === "manage") loadAssessmentsManageTab();
  if (tab === "questions") loadQuestionBankTab();
  if (tab === "results") loadResultsTab();
}

async function getMyAssessableClassSubjects() {
  if ((state.allRoles||[state.role]).some(r => ["admin","headmaster","principal"].includes(r))) {
    const pairs = [];
    for (const cls of state.classes) {
      const { data: cs } = await sb.from("class_subjects").select("subject_id, subjects(name)").eq("class_id", cls.id);
      (cs||[]).forEach(row => pairs.push({ class_id: cls.id, class_name: cls.name, subject_id: row.subject_id, subject_name: row.subjects.name }));
    }
    return pairs;
  }
  const { data } = await sb.from("class_teacher_subjects").select("class_id, subject_id, classes(name), subjects(name)").eq("staff_id", state.staff.id);
  return (data||[]).map(r => ({ class_id: r.class_id, class_name: r.classes.name, subject_id: r.subject_id, subject_name: r.subjects.name }));
}

// ============================================================
// TAB 1 — CREATE & MANAGE
// ============================================================
async function loadAssessmentsManageTab() {
  const panel = document.getElementById("eapanel-manage");
  panel.innerHTML = "Loading…";
  const pairs = await getMyAssessableClassSubjects();
  if (!pairs.length) {
    panel.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>You have no class/subject assignments yet — ask an admin to assign you in Curriculum first.</p></div>`;
    return;
  }
  panel.innerHTML = `
    <div class="settings-card">
      <div class="settings-card-title">Create Test / Exam</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="field" style="flex:1;min-width:180px;"><label>Class + Subject</label>
          <select id="caClassSubject">${pairs.map(p => `<option value="${p.class_id}|${p.subject_id}">${p.class_name} — ${p.subject_name}</option>`).join("")}</select></div>
        <div class="field" style="flex:1;min-width:150px;"><label>Assessment Type</label>
          <select id="caType" onchange="checkTitleTypeMismatch()"><option value="ca1">CA1</option><option value="ca2">CA2</option><option value="ca3">CA3</option><option value="exam">Exam</option></select></div>
      </div>
      <div class="field"><label>Title</label><input id="caTitle" oninput="checkTitleTypeMismatch()" placeholder="e.g. First Term CA1 — Mathematics"/></div>
      <div id="caTypeMismatchWarning" style="display:none;margin:-8px 0 14px;"></div>
      <div class="field"><label>Instructions (shown to students before they start)</label><textarea id="caInstructions" rows="2" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;"></textarea></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="field" style="flex:1;min-width:140px;"><label>Duration (minutes, blank = untimed)</label><input id="caDuration" type="number" min="1"/></div>
        <div class="field" style="flex:1;min-width:140px;"><label>Shuffle Questions</label>
          <select id="caShuffle"><option value="true">Yes</option><option value="false">No</option></select></div>
        <div class="field" style="flex:1;min-width:140px;"><label>Shuffle Answer Options</label>
          <select id="caShuffleOptions"><option value="true">Yes</option><option value="false">No</option></select></div>
      </div>
      <div class="field"><label>Availability</label>
        <select id="caAvailability" onchange="toggleScheduleFields()"><option value="ready">Ready Now</option><option value="scheduled">Schedule For Later</option></select></div>
      <div id="caScheduleFields" style="display:none;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div class="field" style="flex:1;min-width:160px;"><label>Start</label><input id="caStartAt" type="datetime-local"/></div>
          <div class="field" style="flex:1;min-width:160px;"><label>End (optional)</label><input id="caEndAt" type="datetime-local"/></div>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dash-muted);margin-bottom:14px;">
        <input type="checkbox" id="caAutoSync" checked style="width:auto;"/> Automatically fill the matching CA/Exam column on the report card once submitted (only if that field is still empty — never overwrites a manually entered score)
      </label>
      <button class="btn btn-green" onclick="createAssessment()"><i class="fa-solid fa-plus"></i> Create</button>
    </div>
    <div class="settings-card-title" style="margin:18px 0 10px;">Existing Tests &amp; Exams</div>
    <div id="assessmentsListHost"></div>`;
  await loadAssessmentsList();
}
function toggleScheduleFields() {
  document.getElementById("caScheduleFields").style.display = document.getElementById("caAvailability").value === "scheduled" ? "block" : "none";
}
// Catches exactly the mistake that once caused a real score to sync
// to the wrong CA column: a title that says "CA2" while the
// Assessment Type dropdown is still set to CA1 (or vice versa).
function checkTitleTypeMismatch() {
  const title = document.getElementById("caTitle").value.toUpperCase();
  const type = document.getElementById("caType").value;
  const typeLabels = { ca1: "CA1", ca2: "CA2", ca3: "CA3", exam: "EXAM" };
  const mentioned = Object.entries(typeLabels).filter(([key, label]) => title.includes(label)).map(([key]) => key);
  const warningEl = document.getElementById("caTypeMismatchWarning");
  if (mentioned.length && !mentioned.includes(type)) {
    warningEl.style.display = "block";
    warningEl.innerHTML = `<span class="badge badge-danger">⚠ Your title mentions ${mentioned.map(k=>typeLabels[k]).join("/")} but Assessment Type is set to ${typeLabels[type]} — the score will sync to the wrong column. Double-check before creating.</span>`;
  } else {
    warningEl.style.display = "none";
  }
}
async function createAssessment() {
  const [class_id, subject_id] = document.getElementById("caClassSubject").value.split("|");
  const assessment_type = document.getElementById("caType").value;
  const title = document.getElementById("caTitle").value.trim();
  if (!title) { alert("Title is required."); return; }
  const instructions = document.getElementById("caInstructions").value.trim() || null;
  const duration_minutes = document.getElementById("caDuration").value ? Number(document.getElementById("caDuration").value) : null;
  const shuffle_questions = document.getElementById("caShuffle").value === "true";
  const shuffle_options = document.getElementById("caShuffleOptions").value === "true";
  const availability = document.getElementById("caAvailability").value;
  const status = availability === "scheduled" ? "scheduled" : "ready";
  const start_at = document.getElementById("caStartAt").value ? new Date(document.getElementById("caStartAt").value).toISOString() : null;
  const end_at = document.getElementById("caEndAt").value ? new Date(document.getElementById("caEndAt").value).toISOString() : null;
  if (availability === "scheduled" && !start_at) { alert("A start date/time is required when scheduling for later."); return; }
  const auto_sync_to_report_card = document.getElementById("caAutoSync").checked;

  const { error } = await sb.from("assessments").insert({
    class_id, subject_id, term_id: state.currentTermId, assessment_type, title, instructions,
    duration_minutes, shuffle_questions, shuffle_options, status, start_at, end_at, auto_sync_to_report_card,
  });
  if (error) { alert(error.message); return; }
  alert("Created. Add questions from the Question Bank tab before publishing to students.");
  document.getElementById("caTitle").value = "";
  await loadAssessmentsList();
}
async function loadAssessmentsList() {
  const host = document.getElementById("assessmentsListHost");
  const { data: rows } = await sb.from("assessments").select("*, classes(name), subjects(name)").eq("term_id", state.currentTermId).order("created_at", { ascending: false });
  if (!rows || !rows.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-file-circle-question"></i><p>No tests or exams created yet this term.</p></div>`; return; }
  host.innerHTML = `<div style="overflow-x:auto;"><table class="data-table">
    <thead><tr><th>Class</th><th>Subject</th><th>Type</th><th>Title</th><th>Status</th><th>Questions</th><th></th></tr></thead>
    <tbody>${rows.map(r => {
      const eff = assessmentEffLabel(r.status, r.start_at, r.end_at);
      return `<tr>
        <td>${r.classes.name}</td><td>${r.subjects.name}</td><td>${r.assessment_type.toUpperCase()}</td>
        <td class="name-cell">${r.title}</td>
        <td><span class="badge ${eff.cls}">${eff.label}</span></td>
        <td><span id="qcount-${r.id}">…</span></td>
        <td style="display:flex;gap:5px;flex-wrap:wrap;">
          <button class="btn" style="font-size:11px;padding:5px 9px;" onclick="openQuestionBankFor('${r.id}')">Questions</button>
          ${r.status !== "closed" ? `<button class="btn btn-danger" style="font-size:11px;padding:5px 9px;" onclick="closeAssessment('${r.id}')">Close</button>` : ""}
          <button class="btn btn-danger" style="font-size:11px;padding:5px 9px;" onclick="deleteAssessment('${r.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
  rows.forEach(async r => {
    const { count } = await sb.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", r.id);
    const cell = document.getElementById(`qcount-${r.id}`);
    if (cell) cell.textContent = count || 0;
  });
}
function assessmentEffLabel(status, start_at, end_at) {
  const now = new Date();
  if (status === "draft") return { label: "Draft", cls: "badge-neutral" };
  if (status === "closed") return { label: "Closed", cls: "badge-neutral" };
  if (end_at && now > new Date(end_at)) return { label: "Closed (expired)", cls: "badge-neutral" };
  if (start_at && now < new Date(start_at)) return { label: "Scheduled", cls: "badge-warning" };
  return { label: "● Ready", cls: "badge-success" };
}
async function closeAssessment(id) {
  if (!confirm("Close this assessment? Students will no longer be able to start or continue it.")) return;
  const { error } = await sb.from("assessments").update({ status: "closed" }).eq("id", id);
  if (error) alert(error.message); else loadAssessmentsList();
}
async function deleteAssessment(id) {
  if (!confirm("Delete this assessment and all its questions/attempts? This cannot be undone.")) return;
  const { error } = await sb.from("assessments").delete().eq("id", id);
  if (error) alert(error.message); else loadAssessmentsList();
}

// ============================================================
// TAB 2 — QUESTION BANK
// ============================================================
async function loadQuestionBankTab() {
  const panel = document.getElementById("eapanel-questions");
  const { data: rows } = await sb.from("assessments").select("id, title, classes(name), subjects(name), assessment_type, marking_mode, uniform_mark_per_question, shuffle_questions").eq("term_id", state.currentTermId).order("created_at", { ascending: false });
  panel.innerHTML = `
    <div class="field" style="max-width:400px;"><label>Select Assessment</label>
      <select id="qbAssessmentSelect" onchange="loadQuestionBankFor(this.value)">
        <option value="">— choose —</option>
        ${(rows||[]).map(r => `<option value="${r.id}">${r.classes.name} — ${r.subjects.name} — ${r.assessment_type.toUpperCase()} (${r.title})</option>`).join("")}
      </select></div>
    <div id="qbBody"></div>`;
}
function openQuestionBankFor(assessmentId) {
  switchExAdminTab("questions");
  setTimeout(() => {
    document.getElementById("qbAssessmentSelect").value = assessmentId;
    loadQuestionBankFor(assessmentId);
  }, 0);
}
async function loadQuestionBankFor(assessmentId) {
  const body = document.getElementById("qbBody");
  if (!assessmentId) { body.innerHTML = ""; return; }
  body.innerHTML = "Loading…";
  const { data: a } = await sb.from("assessments").select("*, subjects(name), classes(name)").eq("id", assessmentId).single();
  let { data: questions } = await sb.from("assessment_questions").select("*").eq("assessment_id", assessmentId).order("order_index");
  let autoImportNotice = "";

  // Exams start with zero questions of their own — the first time you
  // open an exam's bank, automatically pull in every question already
  // written for CA1/CA2/CA3 of the SAME class+subject+term, as a
  // starting point. Copies (not shared rows), so editing marks/text
  // here afterward never disturbs the original CA test, and vice
  // versa. Only runs once — if the bank already has questions
  // (whether from this or an earlier import), it won't run again
  // automatically; use "Import More from CA Tests" for anything
  // added to the CAs later.
  if (a.assessment_type === "exam" && (questions||[]).length === 0) {
    const imported = await importCaQuestionsIntoExam(assessmentId, a.class_id, a.subject_id, a.term_id, 0);
    if (imported > 0) {
      autoImportNotice = `<div class="badge badge-success" style="margin-bottom:14px;">✅ Automatically imported ${imported} question${imported===1?"":"s"} from this subject's CA tests — review, edit, and adjust marks below.</div>`;
      ({ data: questions } = await sb.from("assessment_questions").select("*").eq("assessment_id", assessmentId).order("order_index"));
    }
  }

  const totalMarks = (questions||[]).reduce((s,q) => s + Number(q.marks), 0);
  const isUniform = a.marking_mode === "uniform";
  const defaultMark = isUniform ? (a.uniform_mark_per_question || 1) : 1;

  body.innerHTML = `
    ${autoImportNotice}
    ${a.assessment_type === "exam" ? `<div id="caImportCard"></div>` : ""}
    <div class="settings-card">
      <div class="settings-card-title">Marking</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
        <div class="field" style="flex:1;min-width:160px;"><label>Marking Mode</label>
          <select id="qbMarkingMode" onchange="setMarkingMode('${assessmentId}', this.value)">
            <option value="uniform" ${a.marking_mode==="uniform"?"selected":""}>Same mark for all questions</option>
            <option value="individual" ${a.marking_mode==="individual"?"selected":""}>Individual marks per question</option>
          </select></div>
        ${a.marking_mode === "uniform" ? `
        <div class="field" style="flex:1;min-width:140px;"><label>Mark per Question</label><input id="qbUniformMark" type="number" min="0" value="${a.uniform_mark_per_question||1}"/></div>
        <button class="btn btn-green" onclick="applyUniformMarks('${assessmentId}')">Apply to All</button>` : ""}
      </div>
      <div style="font-size:12px;color:var(--dash-muted);">${(questions||[]).length} question${(questions||[]).length===1?"":"s"} · ${totalMarks} total marks</div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Question Distribution</div>
      <p style="font-size:12px;color:var(--dash-muted);">Give each student only a subset of the question bank — e.g. 50 questions in the bank, 10 per student — to make it harder for students to compare identical papers.</p>
      <div class="badge badge-info" style="margin-bottom:12px;">Questions Available: ${(questions||[]).length}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
        <div class="field" style="flex:1;min-width:200px;">
          <label>Questions Each Student Will Take</label>
          <input id="qbQuestionsPerStudent" type="number" min="1" max="${(questions||[]).length}" value="${a.questions_per_student || ""}" placeholder="Leave blank = give everyone every question"/>
        </div>
        <div class="field" style="flex:1;min-width:220px;">
          <label>Distribution Mode</label>
          <select id="qbDistributionMode">
            <option value="smart_anti_leak" ${a.distribution_mode!=="standard"?"selected":""}>Smart Anti-Leak Distribution</option>
            <option value="standard" ${a.distribution_mode==="standard"?"selected":""}>Standard Random</option>
          </select>
        </div>
        <button class="btn btn-green" onclick="saveDistributionSettings('${assessmentId}', ${(questions||[]).length})">Save</button>
      </div>
      <p style="font-size:11px;color:var(--dash-muted);margin-top:8px;">Smart Anti-Leak tries to give students in the same class substantially different question combinations with low overlap — not just independent random picks. This reduces leakage risk; it doesn't guarantee it's impossible to share answers.</p>
      <button class="btn" style="margin-top:10px;" onclick="loadDistributionPreview('${assessmentId}')"><i class="fa-solid fa-eye"></i> Preview Distribution</button>
      <div id="distPreviewHost" style="margin-top:12px;"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">📋 Paste / Import Questions</div>
      <p style="font-size:12px;color:var(--dash-muted);">Get an AI (ChatGPT, Claude, etc.) to write questions in the right format, then paste its answer below — it fills the builder automatically for you to review before saving.</p>
      <button class="btn" onclick="copyAiQuestionPrompt('${(a.subjects?.name||"").replace(/'/g,"&apos;")}', '${(a.classes?.name||"").replace(/'/g,"&apos;")}')"><i class="fa-solid fa-robot"></i> Copy AI Prompt</button>
      <div class="field" style="margin-top:12px;"><label>Paste Questions Here</label>
        <textarea id="pasteQuestionsBox" rows="8" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;font-family:monospace;font-size:12px;" placeholder="Q: What is 2 + 2?
A: 3
B: 4
C: 5
D: 6
ANSWER: B
MARKS: 1

Q: What is the capital of Nigeria?
A: Lagos
B: Kano
C: Abuja
D: Ibadan
ANSWER: C
MARKS: 1"></textarea>
      </div>
      <button class="btn btn-green" onclick="parsePastedQuestions('${assessmentId}', ${defaultMark})"><i class="fa-solid fa-arrow-down"></i> Add These to the Builder Below</button>
      <div id="pasteParseResult" style="margin-top:8px;font-size:12px;"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Add Questions (Bulk)</div>
      <p style="font-size:12px;color:var(--dash-muted);">Add as many questions as you like before saving — nothing is written to the database until you click "Save All Questions", and every question is validated first.</p>
      <div id="bulkQuestionsContainer"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn" onclick="addAnotherBulkQuestion('${assessmentId}', ${defaultMark})"><i class="fa-solid fa-plus"></i> Add Another Question</button>
        <button class="btn" onclick="saveBulkDraft('${assessmentId}')"><i class="fa-solid fa-floppy-disk"></i> Save as Draft</button>
        <button class="btn btn-green" style="margin-left:auto;" onclick="saveAllBulkQuestions('${assessmentId}', ${isUniform}, ${a.uniform_mark_per_question||1})"><i class="fa-solid fa-check-double"></i> Save All Questions</button>
      </div>
    </div>
    <div id="qListHost"></div>`;
  loadBulkDraftIfAny(assessmentId, defaultMark);
  renderQuestionList(questions || [], assessmentId);
  if (a.assessment_type === "exam") loadCaImportCard(assessmentId, a.class_id, a.subject_id, a.term_id);
}

// ============================================================
// CA -> EXAM QUESTION IMPORT — copies (not shares) questions from
// this subject's CA1/CA2/CA3 tests into an exam's own question bank,
// so a teacher never has to retype the same questions. Once copied
// they're completely independent rows: editing marks/text on either
// side never touches the other.
// ============================================================
async function importCaQuestionsIntoExam(examAssessmentId, classId, subjectId, termId, existingCount) {
  const { data: caAssessments } = await sb.from("assessments").select("id")
    .eq("class_id", classId).eq("subject_id", subjectId).eq("term_id", termId).in("assessment_type", ["ca1","ca2","ca3"]);
  if (!caAssessments || !caAssessments.length) return 0;

  const { data: existingExamQuestions } = await sb.from("assessment_questions").select("question_text").eq("assessment_id", examAssessmentId);
  const existingTexts = new Set((existingExamQuestions||[]).map(q => q.question_text.trim().toLowerCase()));

  const { data: caQuestions } = await sb.from("assessment_questions").select("*")
    .in("assessment_id", caAssessments.map(a => a.id)).order("order_index");
  if (!caQuestions || !caQuestions.length) return 0;

  // Skip anything whose exact question text is already in the exam's
  // bank, so running this more than once never creates duplicates.
  const toInsert = caQuestions
    .filter(q => !existingTexts.has(q.question_text.trim().toLowerCase()))
    .map((q, i) => ({
      assessment_id: examAssessmentId, question_text: q.question_text,
      option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d,
      correct_option: q.correct_option, marks: q.marks, order_index: existingCount + i,
    }));
  // De-dupe within the source set too (same question might exist in
  // both CA1 and CA2, for example).
  const seen = new Set();
  const finalRows = toInsert.filter(q => {
    const key = q.question_text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!finalRows.length) return 0;

  const { error } = await sb.from("assessment_questions").insert(finalRows);
  if (error) { console.error("CA import failed:", error.message); return 0; }
  return finalRows.length;
}
async function loadCaImportCard(assessmentId, classId, subjectId, termId) {
  const host = document.getElementById("caImportCard");
  if (!host) return;
  const { data: caAssessments } = await sb.from("assessments").select("id, assessment_type, title").eq("class_id", classId).eq("subject_id", subjectId).eq("term_id", termId).in("assessment_type", ["ca1","ca2","ca3"]);
  if (!caAssessments || !caAssessments.length) { host.innerHTML = ""; return; }

  const counts = await Promise.all(caAssessments.map(a => sb.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", a.id)));
  const rows = caAssessments.map((a, i) => ({ ...a, count: counts[i].count || 0 })).filter(a => a.count > 0);
  if (!rows.length) { host.innerHTML = ""; return; }

  host.innerHTML = `<div class="settings-card">
    <div class="settings-card-title">Import More from CA Tests</div>
    <p style="font-size:12px;color:var(--dash-muted);">${rows.map(r => `${r.assessment_type.toUpperCase()} (${r.title}) — ${r.count} question${r.count===1?"":"s"}`).join(" · ")}. Already-imported questions (matched by exact text) are skipped automatically.</p>
    <button class="btn btn-green" onclick="manualImportCaQuestions('${assessmentId}','${classId}','${subjectId}','${termId}')"><i class="fa-solid fa-file-import"></i> Import All Available Now</button>
  </div>`;
}
async function manualImportCaQuestions(assessmentId, classId, subjectId, termId) {
  const { count: existingCount } = await sb.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  const imported = await importCaQuestionsIntoExam(assessmentId, classId, subjectId, termId, existingCount || 0);
  alert(imported > 0 ? `Imported ${imported} new question${imported===1?"":"s"}.` : "Nothing new to import — every CA question is already in this exam's bank.");
  loadQuestionBankFor(assessmentId);
}

// ============================================================
// PASTE / IMPORT — a ready-made AI prompt (personalized with this
// assessment's real subject/class) plus a parser for the plain-text
// format it asks the AI to produce. Feeds straight into the same
// bulk builder above, so every pasted question still gets reviewed
// and validated before anything is saved.
// ============================================================
function copyAiQuestionPrompt(subjectName, className) {
  const prompt = `Write 10 multiple-choice questions for ${subjectName || "[SUBJECT]"}, suitable for ${className || "[CLASS]"} students, on the topic of [TOPIC — fill this in].

Use EXACTLY this format for every question, with a blank line between questions, and nothing else before, after, or in between:

Q: <question text>
A: <option A>
B: <option B>
C: <option C>
D: <option D>
ANSWER: <the correct letter, A, B, C, or D>
MARKS: <a number, e.g. 1>

Do not number the questions yourself. Do not add any headings, explanations, or extra text outside this format.`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(prompt).then(
      () => alert("Prompt copied! Paste it into ChatGPT, Claude, or any AI — fill in the topic and how many questions you want, then paste its answer into the box below."),
      () => promptFallbackCopy(prompt)
    );
  } else {
    promptFallbackCopy(prompt);
  }
}
function promptFallbackCopy(text) {
  openModal(`<h3>Copy this prompt</h3><textarea readonly style="width:100%;height:220px;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;font-family:monospace;font-size:12px;">${text}</textarea>`);
}

function parseQuestionPasteText(raw) {
  const blocks = raw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const results = [];
  const errors = [];
  blocks.forEach((block, i) => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    const get = (prefix) => {
      const line = lines.find(l => l.toUpperCase().startsWith(prefix));
      return line ? line.slice(line.indexOf(":") + 1).trim() : "";
    };
    const text = get("Q:");
    const a = get("A:");
    const b = get("B:");
    const c = get("C:");
    const d = get("D:");
    let correct = get("ANSWER:").toUpperCase().replace(/[^ABCD]/g, "");
    correct = ["A","B","C","D"].includes(correct) ? correct : "";
    const marksRaw = get("MARKS:");
    const marks = marksRaw && Number(marksRaw) > 0 ? Number(marksRaw) : null;

    const missing = [];
    if (!text) missing.push("question (Q:)");
    if (!a) missing.push("Option A");
    if (!b) missing.push("Option B");
    if (!c) missing.push("Option C");
    if (!d) missing.push("Option D");
    if (!correct) missing.push("a valid ANSWER (A/B/C/D)");
    if (missing.length) {
      errors.push(`Block ${i+1} is missing ${missing.join(", ")} — skipped.`);
      return;
    }
    results.push({ text, a, b, c, d, correct, marks });
  });
  return { results, errors };
}
function parsePastedQuestions(assessmentId, defaultMark) {
  const raw = document.getElementById("pasteQuestionsBox").value;
  if (!raw.trim()) { alert("Paste some questions first."); return; }
  const { results, errors } = parseQuestionPasteText(raw);
  const resultEl = document.getElementById("pasteParseResult");
  resultEl.innerHTML = "";
  if (results.length) {
    results.forEach(q => addBulkQuestionCard(assessmentId, {
      text: q.text, a: q.a, b: q.b, c: q.c, d: q.d, correct: q.correct, marks: q.marks != null ? q.marks : defaultMark,
    }, defaultMark));
    const cards = document.querySelectorAll("#bulkQuestionsContainer .bulk-q-card");
    cards[cards.length - results.length].scrollIntoView({ behavior: "smooth", block: "center" });
  }
  resultEl.innerHTML = `<span class="badge ${results.length?"badge-success":"badge-neutral"}">${results.length} question${results.length===1?"":"s"} added to the builder below</span>` +
    (errors.length ? `<div style="color:var(--dash-danger);margin-top:6px;">${errors.join("<br>")}</div>` : "");
  if (results.length) document.getElementById("pasteQuestionsBox").value = "";
}

// ============================================================
// BULK QUESTION BUILDER — uncontrolled inputs (values only read at
// action time, e.g. Save/Duplicate) so typing in one card never
// re-renders or loses focus/cursor position in any other card.
// ============================================================
let bulkQCounter = 0;
function addBulkQuestionCard(assessmentId, prefill, defaultMark) {
  bulkQCounter++;
  const localId = "bq" + bulkQCounter + "_" + Date.now();
  const p = prefill || {};
  const mark = p.marks != null ? p.marks : (defaultMark || 1);
  const html = `
  <div class="settings-card bulk-q-card" data-local-id="${localId}" style="border-left:3px solid var(--dash-green);background:var(--dash-surface);">
    <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="toggleBulkCard('${localId}')">
      <div style="font-weight:800;">Question <span class="bq-index"></span></div>
      <div style="display:flex;gap:4px;" onclick="event.stopPropagation()">
        <button class="btn" style="padding:4px 8px;font-size:11px;" onclick="moveBulkCard('${localId}',-1)" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
        <button class="btn" style="padding:4px 8px;font-size:11px;" onclick="moveBulkCard('${localId}',1)" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
        <button class="btn" style="padding:4px 8px;font-size:11px;" onclick="duplicateBulkCard('${localId}')" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
        <button class="btn" style="padding:4px 8px;font-size:11px;" onclick="toggleBulkCard('${localId}')" title="Collapse/Expand"><i class="fa-solid fa-chevron-down" id="bqChevron_${localId}"></i></button>
        <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="deleteBulkCard('${localId}')" title="Remove"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
    <div class="bq-body" id="bqBody_${localId}" style="margin-top:10px;">
      <div class="field"><label>Question</label><textarea class="bq-text" rows="2" style="width:100%;background:var(--dash-card);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;">${p.text||""}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="field"><label>Option A</label><input class="bq-a" value="${p.a||""}"/></div>
        <div class="field"><label>Option B</label><input class="bq-b" value="${p.b||""}"/></div>
        <div class="field"><label>Option C</label><input class="bq-c" value="${p.c||""}"/></div>
        <div class="field"><label>Option D</label><input class="bq-d" value="${p.d||""}"/></div>
      </div>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
        <div style="display:flex;gap:10px;">
          <span style="font-size:11px;color:var(--dash-muted);font-weight:800;">Correct:</span>
          ${["A","B","C","D"].map(o=>`<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;"><input type="radio" class="bq-correct" name="bqcorrect_${localId}" value="${o}" ${p.correct===o?"checked":""}/> ${o}</label>`).join("")}
        </div>
        <div class="field" style="margin-bottom:0;"><label style="font-size:11px;">Mark</label><input class="bq-marks" type="number" min="0" value="${mark}" style="width:80px;"/></div>
      </div>
      <div class="bq-error" style="display:none;color:var(--dash-danger);font-size:12px;font-weight:800;margin-top:6px;"></div>
    </div>
  </div>`;
  document.getElementById("bulkQuestionsContainer").insertAdjacentHTML("beforeend", html);
  renumberBulkCards();
}
function renumberBulkCards() {
  document.querySelectorAll("#bulkQuestionsContainer .bulk-q-card").forEach((card, i) => {
    card.querySelector(".bq-index").textContent = i + 1;
  });
}
function toggleBulkCard(localId) {
  const body = document.getElementById(`bqBody_${localId}`);
  const chevron = document.getElementById(`bqChevron_${localId}`);
  const collapsed = body.style.display === "none";
  body.style.display = collapsed ? "block" : "none";
  chevron.className = collapsed ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
}
function moveBulkCard(localId, direction) {
  const container = document.getElementById("bulkQuestionsContainer");
  const card = container.querySelector(`[data-local-id="${localId}"]`);
  if (direction === -1 && card.previousElementSibling) container.insertBefore(card, card.previousElementSibling);
  else if (direction === 1 && card.nextElementSibling) container.insertBefore(card.nextElementSibling, card);
  renumberBulkCards();
}
function readBulkCard(cardEl) {
  const correctInput = cardEl.querySelector(".bq-correct:checked");
  return {
    text: cardEl.querySelector(".bq-text").value.trim(),
    a: cardEl.querySelector(".bq-a").value.trim(),
    b: cardEl.querySelector(".bq-b").value.trim(),
    c: cardEl.querySelector(".bq-c").value.trim(),
    d: cardEl.querySelector(".bq-d").value.trim(),
    correct: correctInput ? correctInput.value : null,
    marks: Number(cardEl.querySelector(".bq-marks").value) || 0,
  };
}
function duplicateBulkCard(localId) {
  const card = document.querySelector(`[data-local-id="${localId}"]`);
  addBulkQuestionCard(null, readBulkCard(card));
}
function deleteBulkCard(localId) {
  if (!confirm("Remove this question from the batch? (It hasn't been saved yet.)")) return;
  document.querySelector(`[data-local-id="${localId}"]`).remove();
  renumberBulkCards();
}
function addAnotherBulkQuestion(assessmentId, defaultMark) {
  addBulkQuestionCard(assessmentId, null, defaultMark);
  const cards = document.querySelectorAll("#bulkQuestionsContainer .bulk-q-card");
  cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
}
function loadBulkDraftIfAny(assessmentId, defaultMark) {
  document.getElementById("bulkQuestionsContainer").innerHTML = "";
  const raw = localStorage.getItem(`pariya-bulk-draft-${assessmentId}`);
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
  if (data && data.length) data.forEach(d => addBulkQuestionCard(assessmentId, d, defaultMark));
  else addBulkQuestionCard(assessmentId, null, defaultMark);
}
function saveBulkDraft(assessmentId) {
  const cards = [...document.querySelectorAll("#bulkQuestionsContainer .bulk-q-card")];
  localStorage.setItem(`pariya-bulk-draft-${assessmentId}`, JSON.stringify(cards.map(readBulkCard)));
  alert("Draft saved on this device — reopen this assessment's Question Bank to continue, even after closing the browser.");
}
async function saveAllBulkQuestions(assessmentId, isUniform, uniformMark) {
  const cards = [...document.querySelectorAll("#bulkQuestionsContainer .bulk-q-card")];
  if (!cards.length) { alert("Add at least one question first."); return; }

  // Validate every question before saving any of them (spec: don't
  // silently save incomplete questions, show every error at once).
  let badIndexes = [];
  const parsed = cards.map((card, i) => {
    const data = readBulkCard(card);
    const missing = [];
    if (!data.text) missing.push("question text");
    if (!data.a) missing.push("Option A");
    if (!data.b) missing.push("Option B");
    if (!data.c) missing.push("Option C");
    if (!data.d) missing.push("Option D");
    if (!data.correct) missing.push("a correct answer");
    if (!(data.marks > 0)) missing.push("a valid mark");
    const errEl = card.querySelector(".bq-error");
    if (missing.length) {
      errEl.style.display = "block";
      errEl.textContent = `Question ${i + 1} is incomplete — missing: ${missing.join(", ")}.`;
      badIndexes.push(i + 1);
    } else {
      errEl.style.display = "none";
    }
    return isUniform ? { ...data, marks: uniformMark } : data;
  });
  if (badIndexes.length) {
    alert(`Question${badIndexes.length===1?"":"s"} ${badIndexes.join(", ")} ${badIndexes.length===1?"is":"are"} incomplete. Fix the highlighted question${badIndexes.length===1?"":"s"} before saving — nothing has been saved yet.`);
    document.querySelectorAll("#bulkQuestionsContainer .bulk-q-card")[badIndexes[0]-1].scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const { count: existingCount } = await sb.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  const rows = parsed.map((q, i) => ({
    assessment_id: assessmentId, question_text: q.text, option_a: q.a, option_b: q.b, option_c: q.c, option_d: q.d,
    correct_option: q.correct, marks: q.marks, order_index: (existingCount || 0) + i,
  }));
  const { error } = await sb.from("assessment_questions").insert(rows);
  if (error) { alert(error.message); return; }
  localStorage.removeItem(`pariya-bulk-draft-${assessmentId}`);
  alert(`${rows.length} question${rows.length===1?"":"s"} saved.`);
  loadQuestionBankFor(assessmentId);
}
function renderQuestionList(questions, assessmentId) {
  document.getElementById("qListHost").innerHTML = questions.length ? questions.map((q, i) => `
    <div class="settings-card">
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <div style="font-weight:800;">Q${i+1}. ${q.question_text}</div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn" style="padding:4px 8px;font-size:11px;" ${i===0?"disabled":""} onclick="moveQuestion('${assessmentId}','${q.id}',-1)"><i class="fa-solid fa-arrow-up"></i></button>
          <button class="btn" style="padding:4px 8px;font-size:11px;" ${i===questions.length-1?"disabled":""} onclick="moveQuestion('${assessmentId}','${q.id}',1)"><i class="fa-solid fa-arrow-down"></i></button>
          <button class="btn" style="padding:4px 8px;font-size:11px;" onclick='openEditQuestion(${JSON.stringify(q).replace(/'/g,"&apos;")},"${assessmentId}")'><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="deleteQuestion('${q.id}','${assessmentId}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--dash-muted);margin-top:6px;">
        A. ${q.option_a} &nbsp; B. ${q.option_b} &nbsp; C. ${q.option_c} &nbsp; D. ${q.option_d}
      </div>
      <div style="font-size:12px;margin-top:4px;"><span class="badge badge-success">Correct: ${q.correct_option}</span> <span class="badge badge-info">${q.marks} mark${q.marks==1?"":"s"}</span></div>
    </div>`).join("") : `<div class="empty-state"><i class="fa-solid fa-list-ol"></i><p>No questions yet — add the first one above.</p></div>`;
}
async function loadDistributionPreview(assessmentId) {
  const host = document.getElementById("distPreviewHost");
  host.innerHTML = "Loading…";
  const { data: rows, error } = await sb.rpc("preview_assessment_distribution", { p_assessment_id: assessmentId, p_sample_size: 5 });
  if (error) { host.innerHTML = `<p style="color:var(--dash-danger);">${error.message}</p>`; return; }
  if (!rows || !rows.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-info"></i><p>No data yet.</p></div>`; return; }
  const meta = rows[0];
  if (meta.bank_count === 0) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Add questions to the bank first — there's nothing to distribute yet.</p></div>`; return; }

  host.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
      ${kpiCard("fa-database", meta.bank_count, "Questions in Bank")}
      ${kpiCard("fa-users", meta.eligible_students, "Students Eligible")}
      ${kpiCard("fa-list-check", meta.effective_questions_per_student, meta.questions_per_student ? "Per Student" : "Per Student (all)")}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
      <span class="badge badge-info">${meta.distribution_mode === "standard" ? "Standard Random" : "Smart Anti-Leak"}</span>
      <span class="badge ${meta.shuffle_questions?"badge-success":"badge-neutral"}">Shuffle Questions: ${meta.shuffle_questions?"ON":"OFF"}</span>
      <span class="badge ${meta.shuffle_options?"badge-success":"badge-neutral"}">Shuffle Answer Options: ${meta.shuffle_options?"ON":"OFF"}</span>
    </div>
    <p style="font-size:12px;color:var(--dash-muted);margin-bottom:8px;">Illustrative sample combinations (question numbers refer to the order shown in the list below) — these are throwaway examples to show the kind of variation to expect, not real students' actual assignments. Each real student's exact set is only generated the moment they click Start.</p>
    <div style="overflow-x:auto;"><table class="data-table">
      <thead><tr><th>Sample Student</th><th>Would Receive Question #s</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>Sample ${r.sample_index}</td><td>${(r.sample_question_numbers||[]).join(", ")}</td></tr>`).join("")}</tbody>
    </table></div>`;
}
async function saveDistributionSettings(assessmentId, bankCount) {
  const raw = document.getElementById("qbQuestionsPerStudent").value;
  const questions_per_student = raw === "" ? null : Number(raw);
  if (questions_per_student != null) {
    if (questions_per_student < 1) { alert("Questions per student must be at least 1."); return; }
    if (questions_per_student > bankCount) { alert(`Questions per student (${questions_per_student}) can't exceed the ${bankCount} question${bankCount===1?"":"s"} currently in the bank.`); return; }
  }
  const distribution_mode = document.getElementById("qbDistributionMode").value;
  const { error } = await sb.from("assessments").update({ questions_per_student, distribution_mode }).eq("id", assessmentId);
  if (error) { alert(error.message); return; }
  alert(questions_per_student ? `Saved — each student will now receive ${questions_per_student} of the ${bankCount} questions.` : "Saved — every student will receive the full question bank.");
}
async function setMarkingMode(assessmentId, mode) {
  await sb.from("assessments").update({ marking_mode: mode }).eq("id", assessmentId);
  loadQuestionBankFor(assessmentId);
}
async function applyUniformMarks(assessmentId) {
  const mark = Number(document.getElementById("qbUniformMark").value) || 1;
  await sb.from("assessments").update({ uniform_mark_per_question: mark }).eq("id", assessmentId);
  await sb.from("assessment_questions").update({ marks: mark }).eq("assessment_id", assessmentId);
  loadQuestionBankFor(assessmentId);
}
function openEditQuestion(q, assessmentId) {
  openModal(`<h3>Edit Question</h3>
    <div class="field"><label>Question</label><textarea id="eqText" rows="2" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;">${q.question_text}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="field"><label>Option A</label><input id="eqA" value="${q.option_a}"/></div>
      <div class="field"><label>Option B</label><input id="eqB" value="${q.option_b}"/></div>
      <div class="field"><label>Option C</label><input id="eqC" value="${q.option_c}"/></div>
      <div class="field"><label>Option D</label><input id="eqD" value="${q.option_d}"/></div>
    </div>
    <div style="display:flex;gap:12px;">
      <div class="field" style="flex:1;"><label>Correct</label><select id="eqCorrect">${["A","B","C","D"].map(o=>`<option value="${o}" ${q.correct_option===o?"selected":""}>${o}</option>`).join("")}</select></div>
      <div class="field" style="flex:1;"><label>Marks</label><input id="eqMarks" type="number" value="${q.marks}"/></div>
    </div>
    <button class="btn btn-green" style="width:100%;" onclick="saveEditedQuestion('${q.id}','${assessmentId}')">Save</button>`);
}
async function saveEditedQuestion(questionId, assessmentId) {
  const { error } = await sb.from("assessment_questions").update({
    question_text: document.getElementById("eqText").value.trim(),
    option_a: document.getElementById("eqA").value.trim(), option_b: document.getElementById("eqB").value.trim(),
    option_c: document.getElementById("eqC").value.trim(), option_d: document.getElementById("eqD").value.trim(),
    correct_option: document.getElementById("eqCorrect").value, marks: Number(document.getElementById("eqMarks").value) || 1,
  }).eq("id", questionId);
  if (error) { alert(error.message); return; }
  closeModal();
  loadQuestionBankFor(assessmentId);
}
async function deleteQuestion(questionId, assessmentId) {
  if (!confirm("Delete this question?")) return;
  await sb.from("assessment_questions").delete().eq("id", questionId);
  loadQuestionBankFor(assessmentId);
}
async function moveQuestion(assessmentId, questionId, direction) {
  const { data: questions } = await sb.from("assessment_questions").select("id, order_index").eq("assessment_id", assessmentId).order("order_index");
  const idx = questions.findIndex(q => q.id === questionId);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= questions.length) return;
  await sb.from("assessment_questions").update({ order_index: questions[swapIdx].order_index }).eq("id", questions[idx].id);
  await sb.from("assessment_questions").update({ order_index: questions[idx].order_index }).eq("id", questions[swapIdx].id);
  loadQuestionBankFor(assessmentId);
}

// ============================================================
// TAB 3 — RESULTS
// ============================================================
async function loadResultsTab() {
  const panel = document.getElementById("eapanel-results");
  const pairs = await getMyAssessableClassSubjects();
  const classIds = [...new Set(pairs.map(p => p.class_id))];
  const classes = state.classes.filter(c => classIds.includes(c.id));
  panel.innerHTML = `
    <div class="field" style="max-width:400px;"><label>Class</label>
      <select id="resClassSelect" onchange="loadResultsAssessmentOptions()"><option value="">— choose —</option>
      ${classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select></div>
    <div class="field" style="max-width:400px;"><label>Test / Exam</label><select id="resAssessmentSelect" onchange="loadResultsTable()"><option value="">— choose a class first —</option></select></div>
    <div id="resBody"></div>`;
}
async function loadResultsAssessmentOptions() {
  const classId = document.getElementById("resClassSelect").value;
  const sel = document.getElementById("resAssessmentSelect");
  if (!classId) { sel.innerHTML = `<option value="">— choose a class first —</option>`; return; }
  const { data: rows } = await sb.from("assessments").select("id, title, assessment_type, subjects(name)").eq("class_id", classId).eq("term_id", state.currentTermId);
  sel.innerHTML = `<option value="">— choose —</option>` + (rows||[]).map(r => `<option value="${r.id}">${r.subjects.name} — ${r.assessment_type.toUpperCase()} — ${r.title}</option>`).join("");
  document.getElementById("resBody").innerHTML = "";
}
async function loadResultsTable() {
  const assessmentId = document.getElementById("resAssessmentSelect").value;
  const body = document.getElementById("resBody");
  if (!assessmentId) { body.innerHTML = ""; return; }
  body.innerHTML = "Loading…";
  const [{ data: attempts }, { data: assessment }] = await Promise.all([
    sb.from("assessment_attempts").select("*, students(full_name, admission_no)").eq("assessment_id", assessmentId).order("score", { ascending: false }),
    sb.from("assessments").select("subject_id, class_id, term_id, assessment_type, auto_sync_to_report_card").eq("id", assessmentId).single(),
  ]);
  if (!attempts || !attempts.length) { body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No submissions yet.</p></div>`; return; }

  // Cross-check each attempt's score against the actual report-card
  // column it should have synced to — catches exactly the mismatch
  // that once left a real score stuck with no visible sign anything
  // was wrong (see: Amina Umar / CA2 Social Studies, Aug 2026).
  const scoreCol = { ca1: "ca1", ca2: "ca2", ca3: "ca3", exam: "exam_score" }[assessment.assessment_type];
  const studentIds = attempts.map(a => a.student_id);
  const { data: reportScores } = await sb.from("student_scores").select(`student_id, ${scoreCol}`)
    .eq("subject_id", assessment.subject_id).eq("class_id", assessment.class_id).eq("term_id", assessment.term_id).in("student_id", studentIds);
  const reportMap = {}; (reportScores||[]).forEach(r => { reportMap[r.student_id] = r[scoreCol]; });

  body.innerHTML = `<div style="overflow-x:auto;"><table class="data-table">
    <thead><tr><th>Student</th><th>Adm No</th><th>Score</th><th>Total</th><th>Status</th><th>Report Card (${scoreCol.toUpperCase()})</th><th>Submitted</th></tr></thead>
    <tbody>${attempts.map(a => {
      const rcVal = reportMap[a.student_id];
      const synced = a.status !== "submitted" ? null : (Number(rcVal) === Number(a.score));
      const rcCell = a.status !== "submitted" ? "—"
        : !assessment.auto_sync_to_report_card ? `<span class="badge badge-neutral">Auto-sync off</span>`
        : synced ? `<span class="badge badge-success">✔ ${rcVal}</span>`
        : `<span class="badge badge-danger" title="Report card shows ${rcVal ?? "—"}, not this attempt's score — likely a different score already occupied ${scoreCol.toUpperCase()} for this student/subject/term. Check Classes & Scores.">⚠ Not synced (shows ${rcVal ?? "—"})</span>`;
      return `<tr>
      <td class="name-cell">${a.students.full_name}</td><td>${a.students.admission_no}</td>
      <td>${a.score ?? "—"}</td><td>${a.total_marks ?? "—"}</td>
      <td><span class="badge ${a.status==='submitted'?'badge-success':'badge-warning'}">${a.status === "submitted" ? "Submitted" : "In Progress"}</span></td>
      <td>${rcCell}</td>
      <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : "—"}</td>
    </tr>`;}).join("")}</tbody></table></div>`;
}
