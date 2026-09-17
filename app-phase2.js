// ============================================================
// CURRICULUM & ASSIGNMENTS
// Replaces: inferring subjects from spreadsheet column headers,
// and the "one column per class holding comma-separated subjects"
// pattern from the Teacher Directory sheet.
// ============================================================
async function renderAssignments() {
  const el = document.getElementById("panel-assignments");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Curriculum</h1>
        <p>This is where you assign teachers/staff to a class + subject, assign subjects to classes, and manage the subject list.</p>
      </div>
    </div>
    <div class="settings-card" style="border:2px solid var(--dash-green);">
      <div class="settings-card-title">👤 Assign a Teacher to Class + Subject</div>
      <p style="font-size:12px;color:var(--dash-muted);">This is what puts a teacher in charge of a specific class's specific subject — required before that teacher can enter scores, create tests, or set homework for it.</p>
      <div class="field"><label>Staff</label><select id="taStaffSelect"></select></div>
      <div class="field"><label>Class</label><select id="taClassSelect" onchange="loadTeacherAssignSubjects()">
        <option value="">— choose —</option>
        ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}
      </select></div>
      <div class="field"><label>Subject</label><select id="taSubjectSelect"><option value="">Select a class first</option></select></div>
      <button class="btn btn-green" onclick="addTeacherAssignment()">Assign</button>
      <div id="taCurrentList" style="margin-top:14px;"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Assign Subjects to a Class</div>
      <p style="font-size:12px;color:var(--dash-muted);">Which subjects a class takes at all — do this first if a subject isn't showing up in the dropdown above.</p>
      <div class="field"><label>Class</label>
        <select id="csClassSelect" onchange="loadClassSubjectAssign()">
          <option value="">— choose —</option>
          ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}
        </select></div>
      <div id="csAssignBody"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Subjects (school-wide list)</div>
      <p style="font-size:12px;color:var(--dash-muted);">This order is exactly the order subjects appear on the report card — use the ↑↓ arrows to arrange them (1st, 2nd, 3rd…), not alphabetically.</p>
      <div id="subjectsList" class="pill-list"></div>
      <div class="field" style="margin-top:12px;display:flex;gap:8px;">
        <input id="newSubjectName" placeholder="e.g. Mathematics" style="flex:1;"/>
        <button class="btn btn-green" onclick="addSubject()">Add</button>
      </div>
    </div>`;
  await loadSubjectsList();
  await loadStaffOptionsForAssign();
}

async function loadSubjectsList() {
  const { data: subjects } = await sb.from("subjects").select("*").order("sort_order");
  state.subjects = subjects || [];
  document.getElementById("subjectsList").innerHTML = (subjects||[]).length ? `<div style="border:1px solid var(--dash-border);border-radius:8px;overflow:hidden;">
    ${subjects.map((s,i) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;${i>0?"border-top:1px solid var(--dash-border);":""}">
      <span class="badge badge-info" style="min-width:26px;justify-content:center;">${i+1}</span>
      <span style="flex:1;font-weight:700;">${s.name}</span>
      <button class="btn" style="padding:4px 8px;font-size:11px;" ${i===0?"disabled":""} onclick="moveSubject('${s.id}',-1)" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
      <button class="btn" style="padding:4px 8px;font-size:11px;" ${i===subjects.length-1?"disabled":""} onclick="moveSubject('${s.id}',1)" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
      <button class="btn" style="padding:4px 8px;font-size:11px;" onclick="renameSubject('${s.id}','${s.name.replace(/'/g,"&apos;")}')" title="Rename"><i class="fa-solid fa-pen"></i></button>
      <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="removeSubject('${s.id}')" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join("")}
  </div>` : `<span style="color:var(--dash-muted);font-size:12px;">No subjects yet — add one below.</span>`;
}
async function moveSubject(subjectId, direction) {
  const { data: subjects } = await sb.from("subjects").select("id, sort_order").order("sort_order");
  const idx = subjects.findIndex(s => s.id === subjectId);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= subjects.length) return;
  await sb.from("subjects").update({ sort_order: subjects[swapIdx].sort_order }).eq("id", subjects[idx].id);
  await sb.from("subjects").update({ sort_order: subjects[idx].sort_order }).eq("id", subjects[swapIdx].id);
  loadSubjectsList();
}
async function renameSubject(id, currentName) {
  const newName = prompt("Rename subject:", currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;
  const { error } = await sb.from("subjects").update({ name: newName.trim() }).eq("id", id);
  if (error) { alert(error.message); return; }
  await loadSubjectsList();
}
async function addSubject() {
  const name = document.getElementById("newSubjectName").value.trim();
  if (!name) return;
  const { error } = await sb.from("subjects").insert({ name });
  if (error) { alert(error.message); return; }
  document.getElementById("newSubjectName").value = "";
  await loadSubjectsList();
}
async function removeSubject(id) {
  if (!confirm("Remove this subject? This also removes it from any classes/teachers it's assigned to.")) return;
  const { error } = await sb.from("subjects").delete().eq("id", id);
  if (error) alert(error.message);
  await loadSubjectsList();
}

async function loadClassSubjectAssign() {
  const classId = document.getElementById("csClassSelect").value;
  const body = document.getElementById("csAssignBody");
  if (!classId) { body.innerHTML = ""; return; }
  const [{ data: assigned }] = await Promise.all([
    sb.from("class_subjects").select("id, subject_id, subjects(name)").eq("class_id", classId),
  ]);
  const assignedIds = new Set((assigned||[]).map(a => a.subject_id));
  const available = state.subjects.filter(s => !assignedIds.has(s.id));
  body.innerHTML = `
    <div class="pill-list" style="margin:10px 0;">
      ${(assigned||[]).map(a => `<span class="tag">${a.subjects.name}
        <button onclick="unassignClassSubject('${a.id}')"><i class="fa-solid fa-xmark"></i></button></span>`).join("") || "<span style='color:var(--dash-muted);font-size:12px;'>No subjects assigned yet.</span>"}
    </div>
    <div style="display:flex;gap:8px;">
      <select id="csAddSubjectSelect" style="flex:1;">
        <option value="">— pick a subject to add —</option>
        ${available.map(s => `<option value="${s.id}">${s.name}</option>`).join("")}
      </select>
      <button class="btn btn-green" onclick="assignClassSubject('${classId}')">Add</button>
    </div>`;
}
async function assignClassSubject(classId) {
  const subjectId = document.getElementById("csAddSubjectSelect").value;
  if (!subjectId) return;
  const { error } = await sb.from("class_subjects").insert({ class_id: classId, subject_id: subjectId });
  if (error) alert(error.message);
  await loadClassSubjectAssign();
}
async function unassignClassSubject(rowId) {
  await sb.from("class_subjects").delete().eq("id", rowId);
  await loadClassSubjectAssign();
}

async function loadStaffOptionsForAssign() {
  const { data: staff } = await sb.from("staff").select("id, full_name, staff_code").eq("is_active", true).order("full_name");
  document.getElementById("taStaffSelect").innerHTML = (staff||[]).map(s => `<option value="${s.id}">${s.full_name} (${s.staff_code})</option>`).join("");
}
async function loadTeacherAssignSubjects() {
  const classId = document.getElementById("taClassSelect").value;
  const sel = document.getElementById("taSubjectSelect");
  if (!classId) { sel.innerHTML = `<option value="">Select a class first</option>`; return; }
  const { data: classSubjects } = await sb.from("class_subjects").select("subject_id, subjects(name)").eq("class_id", classId);
  sel.innerHTML = (classSubjects||[]).map(cs => `<option value="${cs.subject_id}">${cs.subjects.name}</option>`).join("") ||
    `<option value="">No subjects assigned to this class yet</option>`;
  await loadCurrentTeacherAssignments();
}
async function addTeacherAssignment() {
  const staff_id = document.getElementById("taStaffSelect").value;
  const class_id = document.getElementById("taClassSelect").value;
  const subject_id = document.getElementById("taSubjectSelect").value;
  if (!staff_id || !class_id || !subject_id) { alert("Please select staff, class, and subject."); return; }
  const { error } = await sb.from("class_teacher_subjects").insert({ staff_id, class_id, subject_id });
  if (error) { alert(error.code === "23505" ? "This teacher is already assigned to that class+subject." : error.message); return; }
  await loadCurrentTeacherAssignments();
}
async function loadCurrentTeacherAssignments() {
  const classId = document.getElementById("taClassSelect").value;
  const host = document.getElementById("taCurrentList");
  if (!classId) { host.innerHTML = ""; return; }
  const { data: assigns } = await sb.from("class_teacher_subjects").select("id, staff(full_name), subjects(name)").eq("class_id", classId);
  host.innerHTML = `<div class="settings-card-title" style="font-size:12px;">Current assignments for this class</div>
    <div class="pill-list">${(assigns||[]).map(a => `<span class="tag">${a.staff.full_name} — ${a.subjects.name}
      <button onclick="removeTeacherAssignment('${a.id}')"><i class="fa-solid fa-xmark"></i></button></span>`).join("") || "<span style='color:var(--dash-muted);font-size:12px;'>None yet.</span>"}</div>`;
}
async function removeTeacherAssignment(id) {
  await sb.from("class_teacher_subjects").delete().eq("id", id);
  await loadCurrentTeacherAssignments();
}
