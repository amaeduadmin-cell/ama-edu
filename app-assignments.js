// ============================================================
// ASSIGNMENTS (homework) — teacher creates, students view/submit
// on-portal (or just read the instructions if portal submission
// isn't required), teacher reviews/grades.
// ============================================================

async function renderHomework() {
  if (state.student) return renderHomeworkStudent();
  return renderHomeworkStaff();
}

// ---------------- STAFF ----------------
async function renderHomeworkStaff() {
  const el = document.getElementById("panel-homework");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Homework</h1>
        <p>Create assignments for your classes, and review what's been submitted.</p>
      </div>
    </div>
    <div id="hwStaffBody">Loading…</div>`;
  const pairs = await getMyAssessableClassSubjects();
  const body = document.getElementById("hwStaffBody");
  if (!pairs.length) {
    body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>You have no class/subject assignments yet — ask an admin to assign you in Curriculum first.</p></div>`;
    return;
  }
  body.innerHTML = `
    <div class="settings-card">
      <div class="settings-card-title">Create Assignment</div>
      <div class="field"><label>Class + Subject</label>
        <select id="hwClassSubject">${pairs.map(p => `<option value="${p.class_id}|${p.subject_id}">${p.class_name} — ${p.subject_name}</option>`).join("")}</select></div>
      <div class="field"><label>Title</label><input id="hwTitle" placeholder="e.g. Chapter 4 Exercises"/></div>
      <div class="field"><label>Instructions</label><textarea id="hwInstructions" rows="3" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;"></textarea></div>
      <div class="field"><label>Due Date &amp; Time (optional)</label><input id="hwDueAt" type="datetime-local"/></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dash-muted);margin-bottom:14px;">
        <input type="checkbox" id="hwPortal" style="width:auto;"/> Students must submit their answer on the portal (leave unticked if this is just an instructions-only assignment, e.g. "bring your textbook tomorrow")
      </label>
      <button class="btn btn-green" onclick="createHomework()"><i class="fa-solid fa-plus"></i> Create</button>
    </div>
    <div class="settings-card-title" style="margin:18px 0 10px;">Your Assignments</div>
    <div id="hwListHost"></div>`;
  await loadHomeworkStaffList();
}
async function createHomework() {
  const [class_id, subject_id] = document.getElementById("hwClassSubject").value.split("|");
  const title = document.getElementById("hwTitle").value.trim();
  if (!title) { alert("Title is required."); return; }
  const instructions = document.getElementById("hwInstructions").value.trim() || null;
  const due_at = document.getElementById("hwDueAt").value ? new Date(document.getElementById("hwDueAt").value).toISOString() : null;
  const requires_portal_submission = document.getElementById("hwPortal").checked;
  const { error } = await sb.from("assignments").insert({ class_id, subject_id, term_id: state.currentTermId, title, instructions, due_at, requires_portal_submission });
  if (error) { alert(error.message); return; }
  document.getElementById("hwTitle").value = "";
  document.getElementById("hwInstructions").value = "";
  await loadHomeworkStaffList();
}
async function loadHomeworkStaffList() {
  const host = document.getElementById("hwListHost");
  const { data: rows } = await sb.from("assignments").select("*, classes(name), subjects(name)").eq("term_id", state.currentTermId).order("created_at", { ascending: false });
  if (!rows || !rows.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-book-open"></i><p>No assignments created yet this term.</p></div>`; return; }
  host.innerHTML = rows.map(r => `
    <div class="settings-card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;">${r.title}</div>
          <div style="font-size:12px;color:var(--dash-muted);">${r.classes.name} — ${r.subjects.name}${r.due_at ? " · Due " + new Date(r.due_at).toLocaleString() : ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:start;">
          <span class="badge ${r.requires_portal_submission ? "badge-info" : "badge-neutral"}">${r.requires_portal_submission ? "Portal Submission" : "Instructions Only"}</span>
          <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="deleteHomework('${r.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div id="hwSubmissions-${r.id}" style="margin-top:10px;"></div>
    </div>`).join("");
  rows.forEach(r => loadHomeworkSubmissionsSummary(r));
}
async function loadHomeworkSubmissionsSummary(assignment) {
  const host = document.getElementById(`hwSubmissions-${assignment.id}`);
  const [{ count: classSize }, { data: submissions }] = await Promise.all([
    sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", assignment.class_id).eq("is_active", true),
    sb.from("assignment_submissions").select("*, students(full_name, admission_no)").eq("assignment_id", assignment.id).order("submitted_at", { ascending: false }),
  ]);
  const submittedCount = (submissions||[]).length;
  host.innerHTML = `
    <div class="badge badge-info" style="margin-bottom:8px;">${submittedCount}/${classSize||0} submitted</div>
    ${assignment.requires_portal_submission && submittedCount ? `<div style="overflow-x:auto;"><table class="data-table">
      <thead><tr><th>Student</th><th>Answer</th><th>Submitted</th><th>Status</th><th>Grade</th></tr></thead>
      <tbody>${(submissions||[]).map(s => `<tr>
        <td class="name-cell">${s.students.full_name}</td>
        <td style="max-width:260px;white-space:normal;">${(s.answer_text||"").slice(0,140)}${(s.answer_text||"").length>140?"…":""}</td>
        <td>${new Date(s.submitted_at).toLocaleString()}</td>
        <td><span class="badge ${s.status==='late'?'badge-danger':'badge-success'}">${s.status}</span></td>
        <td>
          <input type="number" value="${s.grade ?? ""}" placeholder="—" style="width:70px;" id="hwGrade-${s.id}"/>
          <button class="btn" style="padding:3px 7px;font-size:10px;" onclick="gradeHomeworkSubmission('${s.id}','${assignment.id}')">Save</button>
        </td>
      </tr>`).join("")}</tbody></table></div>` : ""}`;
}
async function gradeHomeworkSubmission(submissionId, assignmentId) {
  const grade = document.getElementById(`hwGrade-${submissionId}`).value;
  const { error } = await sb.from("assignment_submissions").update({ grade: grade === "" ? null : Number(grade) }).eq("id", submissionId);
  if (error) alert(error.message);
}
async function deleteHomework(id) {
  if (!confirm("Delete this assignment and all its submissions?")) return;
  await sb.from("assignments").delete().eq("id", id);
  loadHomeworkStaffList();
}

// ---------------- STUDENT ----------------
async function renderHomeworkStudent() {
  const el = document.getElementById("panel-homework");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Homework</h1>
        <p>Everything assigned to your class this term.</p>
      </div>
    </div>
    <div id="hwStudentBody">Loading…</div>`;
  const { data: rows } = await sb.from("assignments").select("*, subjects(name)").eq("class_id", state.student.class_id).eq("term_id", state.currentTermId).order("due_at", { ascending: true, nullsFirst: false });
  const { data: mySubs } = await sb.from("assignment_submissions").select("*").eq("student_id", state.student.id);
  const subMap = {}; (mySubs||[]).forEach(s => subMap[s.assignment_id] = s);
  const body = document.getElementById("hwStudentBody");
  if (!rows || !rows.length) { body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-book-open"></i><p>No assignments yet this term.</p></div>`; return; }
  body.innerHTML = rows.map(r => {
    const sub = subMap[r.id];
    const overdue = r.due_at && new Date(r.due_at) < new Date();
    let statusBadge;
    if (sub) statusBadge = `<span class="badge ${sub.status==='late'?'badge-danger':'badge-success'}">${sub.status === "late" ? "Submitted Late" : "Submitted"}</span>`;
    else if (overdue) statusBadge = `<span class="badge badge-danger">Late</span>`;
    else statusBadge = `<span class="badge badge-info">New</span>`;
    return `<div class="settings-card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;">${r.title}</div>
          <div style="font-size:12px;color:var(--dash-muted);">${r.subjects.name}${r.due_at ? " · Due " + new Date(r.due_at).toLocaleString() : ""}</div>
        </div>
        ${statusBadge}
      </div>
      <p style="font-size:13px;margin:10px 0;">${r.instructions || ""}</p>
      ${r.requires_portal_submission ? homeworkSubmitAreaHtml(r, sub) : ""}
    </div>`;
  }).join("");
}
function homeworkSubmitAreaHtml(assignment, sub) {
  if (sub) {
    return `<div class="settings-card" style="background:var(--dash-surface);">
      <div class="settings-card-title">Your Submission</div>
      <p style="font-size:13px;white-space:pre-wrap;">${sub.answer_text || "—"}</p>
      <div style="font-size:12px;color:var(--dash-muted);">Submitted ${new Date(sub.submitted_at).toLocaleString()}</div>
      ${sub.grade != null ? `<div class="badge badge-success" style="margin-top:6px;">Grade: ${sub.grade}</div>` : ""}
      ${sub.feedback ? `<p style="font-size:12px;margin-top:6px;"><strong>Feedback:</strong> ${sub.feedback}</p>` : ""}
    </div>`;
  }
  return `<div class="field"><label>Your Answer</label>
    <textarea id="hwAnswer-${assignment.id}" rows="4" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;"></textarea></div>
    <button class="btn btn-green" onclick="submitHomework('${assignment.id}')"><i class="fa-solid fa-paper-plane"></i> Submit Assignment</button>`;
}
async function submitHomework(assignmentId) {
  const answer_text = document.getElementById(`hwAnswer-${assignmentId}`).value.trim();
  if (!answer_text) { alert("Please enter your answer before submitting."); return; }
  const { data: a } = await sb.from("assignments").select("due_at").eq("id", assignmentId).single();
  const status = a.due_at && new Date(a.due_at) < new Date() ? "late" : "submitted";
  const { error } = await sb.from("assignment_submissions").insert({ assignment_id: assignmentId, student_id: state.student.id, answer_text, status });
  if (error) { alert(error.message); return; }
  renderHomeworkStudent();
}
