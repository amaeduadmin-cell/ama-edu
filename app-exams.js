// ============================================================
// EXAMS / TESTS — STUDENT-FACING FLOW
// TEST -> subject list (CA1/CA2/CA3 resolved server-side, only the
// currently-available one shows) -> confirm -> one question at a
// time -> timer -> submit -> score. EXAM works identically, filtered
// to assessment_type='exam' only. All scoring happens server-side
// via submit_assessment_attempt() — this file never sees correct
// answers before submission.
// ============================================================

async function renderExamsTestsStudent() {
  const el = document.getElementById("panel-examsTests");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Exams / Tests</h1>
        <p>Choose Test or Exam to see what's currently available for your subjects.</p>
      </div>
    </div>
    <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">
      <div class="class-card" onclick="openExamsTestsKind('test')">
        <div class="cc-icon"><i class="fa-solid fa-file-pen"></i></div>
        <div class="cc-name">TEST</div>
        <div class="cc-sub">CA1 / CA2 / CA3 — only what's currently open shows</div>
      </div>
      <div class="class-card" onclick="openExamsTestsKind('exam')">
        <div class="cc-icon"><i class="fa-solid fa-file-shield"></i></div>
        <div class="cc-name">EXAM</div>
        <div class="cc-sub">End-of-term examination</div>
      </div>
    </div>
    <div id="etsBody" style="margin-top:18px;"></div>`;
}

async function openExamsTestsKind(kind) {
  const body = document.getElementById("etsBody");
  body.innerHTML = "Loading…";
  const { data: rows, error } = await sb.rpc("get_my_available_assessments", { p_kind: kind, p_term_id: state.currentTermId });
  if (error) { body.innerHTML = `<p style="color:var(--dash-danger);">Unable to load ${kind}s. ${error.message}</p>`; return; }
  if (!rows || !rows.length) { body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No subjects found for your class this term.</p></div>`; return; }

  body.innerHTML = `
    <div class="settings-card-title" style="margin-bottom:10px;">${kind === "exam" ? "Exams" : "Tests"} — by subject</div>
    <div class="card-grid">${rows.map(r => examSubjectCardHtml(r)).join("")}</div>`;
}

function examSubjectCardHtml(r) {
  const completed = r.my_attempt_status === "submitted";
  let statusHtml, clickable = false;
  if (completed) {
    statusHtml = `<span class="badge badge-success">✔ Completed — ${r.my_score}/${r.total_marks}</span>`;
  } else if (r.effective_status === "active") {
    statusHtml = `<span class="badge badge-success" style="animation:examPulse 1.6s ease-in-out infinite;">● TEST READY</span>`;
    clickable = true;
  } else if (r.effective_status === "scheduled") {
    const when = r.start_at ? new Date(r.start_at).toLocaleString() : "";
    statusHtml = `<span class="badge badge-warning">🕒 Scheduled — ${when}</span>`;
  } else {
    statusHtml = `<span class="badge badge-neutral">Test Not Available</span>`;
  }
  return `<div class="class-card" style="cursor:${clickable?"pointer":"default"};${clickable?"":"opacity:.75;"}" ${clickable?`onclick="openExamConfirm('${r.assessment_id}', ${r.question_count}, ${r.total_marks})"`:""}>
    <div class="cc-icon"><i class="fa-solid fa-book"></i></div>
    <div class="cc-name">${r.subject_name}</div>
    <div style="margin:6px 0;">${statusHtml}</div>
    <div class="cc-sub">${r.question_count} questions · ${r.total_marks} marks${r.duration_minutes ? ` · ${r.duration_minutes} min` : ""}</div>
  </div>`;
}

async function openExamConfirm(assessmentId, questionCount, totalMarks) {
  const { data: a } = await sb.from("assessments").select("title, subject_id, assessment_type, duration_minutes, start_at, end_at, questions_per_student, marking_mode, subjects(name)").eq("id", assessmentId).maybeSingle();
  const { count: bankCount } = await sb.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", assessmentId);
  const isDistributed = a.questions_per_student > 0 && a.questions_per_student < bankCount;
  const marksIsEstimate = isDistributed && a.marking_mode !== "uniform";

  openModal(`
    <h3 style="margin-top:0;">Are you ready to start this ${a.assessment_type === "exam" ? "Exam" : "Test"}?</h3>
    <div class="settings-row"><span>Subject</span><span>${a.subjects.name}</span></div>
    <div class="settings-row"><span>Title</span><span>${a.title}</span></div>
    <div class="settings-row"><span>Questions</span><span>${questionCount}${isDistributed ? ` (selected from a pool of ${bankCount})` : ""}</span></div>
    <div class="settings-row"><span>Total Marks</span><span>${totalMarks}${marksIsEstimate ? " (approx.)" : ""}</span></div>
    <div class="settings-row"><span>Duration</span><span>${a.duration_minutes ? a.duration_minutes + " minutes" : "Untimed"}</span></div>
    ${a.end_at ? `<div class="settings-row"><span>Closes</span><span>${new Date(a.end_at).toLocaleString()}</span></div>` : ""}
    <p style="font-size:12px;color:var(--dash-muted);margin-top:12px;">Once started, you get one attempt. Answers are saved as you move between questions — you can always go back and change them before submitting.</p>
    <div style="display:flex;gap:10px;margin-top:16px;">
      <button class="btn" style="flex:1;" onclick="closeModal()">CANCEL</button>
      <button class="btn btn-green" style="flex:1;" onclick="beginExamAttempt('${assessmentId}')">START ${a.assessment_type === "exam" ? "EXAM" : "TEST"}</button>
    </div>`);
}

// ---- Live attempt state (client-side cache only — server remains
// source of truth; refreshing re-fetches via resumeExamState()) ----
const examState = { attemptId: null, questions: [], answers: {}, current: 0, timerInterval: null, deadline: null, totalMarks: 0 };

async function beginExamAttempt(assessmentId) {
  closeModal();
  const { data, error } = await sb.rpc("start_assessment_attempt", { p_assessment_id: assessmentId });
  if (error) { alert(error.message); return; }
  const attempt = data[0];
  const { data: questions, error: qErr } = await sb.rpc("get_attempt_questions", { p_attempt_id: attempt.attempt_id });
  if (qErr) { alert(qErr.message); return; }

  examState.attemptId = attempt.attempt_id;
  examState.questions = questions;
  examState.answers = {};
  examState.current = 0;
  examState.totalMarks = attempt.total_marks;
  examState.deadline = attempt.duration_minutes
    ? new Date(new Date(attempt.started_at).getTime() + attempt.duration_minutes * 60000)
    : null;
  examState.title = attempt.title;

  renderExamQuestion();
  if (examState.deadline) startExamTimer();
}

function renderExamQuestion() {
  const el = document.getElementById("panel-examsTests");
  const q = examState.questions[examState.current];
  const total = examState.questions.length;
  const answeredCount = Object.keys(examState.answers).length;
  el.innerHTML = `
    <div class="settings-card" style="max-width:640px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:800;color:var(--dash-accent);">${examState.title}</div>
        ${examState.deadline ? `<div id="examTimerDisplay" class="badge badge-warning">Time Remaining: --:--</div>` : ""}
      </div>
      <div class="progress-row" style="margin-bottom:14px;">
        <div class="progress-track"><div class="progress-fill" style="width:${(answeredCount/total)*100}%;"></div></div>
        <span class="progress-pct">${answeredCount}/${total}</span>
      </div>
      <div style="font-size:12px;color:var(--dash-muted);font-weight:800;margin-bottom:6px;">Question ${examState.current + 1} of ${total}</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:18px;line-height:1.5;">${q.question_text}</div>
      <div id="examOptions">${["A","B","C","D"].map(opt => examOptionHtml(q, opt)).join("")}</div>
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn" style="flex:1;" ${examState.current === 0 ? "disabled" : ""} onclick="examGoto(${examState.current - 1})"><i class="fa-solid fa-arrow-left"></i> PREVIOUS</button>
        ${examState.current === total - 1
          ? `<button class="btn btn-green" style="flex:1;" onclick="confirmSubmitExam()">SUBMIT TEST</button>`
          : `<button class="btn btn-green" style="flex:1;" onclick="examGoto(${examState.current + 1})">NEXT <i class="fa-solid fa-arrow-right"></i></button>`}
      </div>
    </div>`;
  updateExamTimerDisplay();
}
function examOptionHtml(q, opt) {
  const key = "option_" + opt.toLowerCase();
  const selected = examState.answers[q.question_id] === opt;
  return `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:2px solid ${selected ? "var(--dash-green)" : "var(--dash-border)"};
    background:${selected ? "var(--dash-green-soft)" : "transparent"};border-radius:10px;margin-bottom:8px;cursor:pointer;font-size:14px;font-weight:700;">
    <input type="radio" name="examOpt" style="width:18px;height:18px;" ${selected ? "checked" : ""} onchange="selectExamAnswer('${q.question_id}','${opt}')"/>
    <span>${opt}. ${q[key]}</span>
  </label>`;
}
function selectExamAnswer(questionId, opt) {
  examState.answers[questionId] = opt;
  renderExamQuestion();
}
function examGoto(index) {
  if (index < 0 || index >= examState.questions.length) return;
  examState.current = index;
  renderExamQuestion();
}

function startExamTimer() {
  clearInterval(examState.timerInterval);
  examState.timerInterval = setInterval(() => {
    if (!updateExamTimerDisplay()) {
      clearInterval(examState.timerInterval);
      alert("Time's up — submitting your test automatically.");
      doSubmitExam();
    }
  }, 1000);
}
// Returns false once time has expired (server also doesn't care how
// late a submission of an in-progress attempt arrives — this is the
// student-facing convenience timer, not the security boundary).
function updateExamTimerDisplay() {
  const elDisplay = document.getElementById("examTimerDisplay");
  if (!examState.deadline || !elDisplay) return true;
  const msLeft = examState.deadline - new Date();
  if (msLeft <= 0) { elDisplay.textContent = "Time Remaining: 00:00"; return false; }
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  elDisplay.textContent = `Time Remaining: ${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  return true;
}

function confirmSubmitExam() {
  const total = examState.questions.length;
  const answered = Object.keys(examState.answers).length;
  openModal(`
    <h3 style="margin-top:0;">Are you sure you want to submit your test?</h3>
    <p>You have answered <strong>${answered} of ${total}</strong> questions.</p>
    ${answered < total ? `<p style="color:var(--dash-danger);font-size:13px;">${total - answered} question${total-answered===1?"":"s"} left unanswered will be marked wrong.</p>` : ""}
    <div style="display:flex;gap:10px;margin-top:16px;">
      <button class="btn" style="flex:1;" onclick="closeModal()">GO BACK</button>
      <button class="btn btn-green" style="flex:1;" onclick="closeModal();doSubmitExam();">SUBMIT</button>
    </div>`);
}

async function doSubmitExam() {
  clearInterval(examState.timerInterval);
  const answersPayload = Object.entries(examState.answers).map(([question_id, selected_option]) => ({ question_id, selected_option }));
  const { data, error } = await sb.rpc("submit_assessment_attempt", { p_attempt_id: examState.attemptId, p_answers: answersPayload });
  const el = document.getElementById("panel-examsTests");
  if (error) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>${error.message}</p></div>
      <div style="text-align:center;"><button class="btn" onclick="renderExamsTestsStudent()">Back to Exams / Tests</button></div>`;
    return;
  }
  const result = data[0];
  el.innerHTML = `
    <div class="settings-card" style="max-width:480px;margin:40px auto;text-align:center;">
      <div style="font-size:40px;color:var(--dash-green);margin-bottom:10px;"><i class="fa-solid fa-circle-check"></i></div>
      <h2 style="font-family:var(--font-display);margin:0 0 6px;">Test Submitted Successfully</h2>
      <div style="font-size:12px;color:var(--dash-muted);margin-bottom:18px;">Score</div>
      <div style="font-family:var(--font-display);font-size:40px;font-weight:900;color:var(--dash-accent);">${result.score} / ${result.total_marks}</div>
      <button class="btn btn-green" style="margin-top:20px;" onclick="renderExamsTestsStudent()">Back to Exams / Tests</button>
    </div>`;
}
