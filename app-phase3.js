// ============================================================
// FEATURE 1: MANAGE CLASSES — admin can add classes (e.g. SS3)
// ============================================================
async function renderClassManagement() {
  const el = document.getElementById("panel-classManagement");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Manage Classes</h1>
        <p>Add, edit, or delete classes — name, category, sort order, and graduating-class flag.</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Add a Class</div>
      <div class="field"><label>Class Name</label><input id="clsName" placeholder="e.g. SS 3"/></div>
      <div class="field"><label>Category</label><select id="clsCategory">
        <option value="primary">Primary</option>
      </select></div>
      <div class="field"><label>Sort Order (controls display order, lower = earlier)</label><input id="clsSortOrder" type="number" value="99"/></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dash-muted);margin-bottom:14px;">
        <input type="checkbox" id="clsGraduating" style="width:auto;"/> This is a graduating class (e.g. Primary 5, JSS 3, SS 3)
      </label>
      <button class="btn btn-green" onclick="addClass()">Add Class</button>
    </div>
    <div id="classesListMgmt"></div>`;
  await loadClassesListMgmt();
}
async function loadClassesListMgmt() {
  const { data: classes } = await sb.from("classes").select("*").order("sort_order");
  document.getElementById("classesListMgmt").innerHTML = `<div class="card-grid">${(classes||[]).map(c => `
    <div class="class-card" style="cursor:default;">
      <div class="cc-icon">${c.icon||"📚"}</div>
      <div class="cc-name">${c.name}</div>
      <div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin:6px 0;">
        <span class="badge badge-info">${c.category.toUpperCase()}</span>
        ${c.is_graduating_class ? `<span class="badge badge-warning">🎓 Graduating</span>` : ""}
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn" style="flex:1;" onclick='editClass(${JSON.stringify(c).replace(/'/g,"&apos;")})'>Edit</button>
        <button class="btn btn-danger" onclick="deleteClass('${c.id}','${c.name.replace(/'/g,"&apos;")}')">Delete</button>
      </div>
    </div>`).join("")}</div>`;
}
async function addClass() {
  const name = document.getElementById("clsName").value.trim();
  const category = document.getElementById("clsCategory").value;
  const sort_order = Number(document.getElementById("clsSortOrder").value) || 99;
  const is_graduating_class = document.getElementById("clsGraduating").checked;
  if (!name) { alert("Class name is required."); return; }
  const { error } = await sb.from("classes").insert({ name, category, sort_order, is_graduating_class });
  if (error) { alert(error.message); return; }
  document.getElementById("clsName").value = "";
  await loadClassesListMgmt();
  await loadReferenceData();
  alert(`${name} added. It will now appear throughout the app (Classes & Scores, Students, etc.).`);
}
function editClass(cls) {
  openModal(`<h3>Edit Class</h3>
    <div class="field"><label>Class Name</label><input id="eclsName" value="${cls.name}"/></div>
    <div class="field"><label>Category</label><select id="eclsCategory">
      ${["primary"].map(c => `<option value="${c}" ${cls.category===c?"selected":""}>${c.toUpperCase()}</option>`).join("")}
    </select></div>
    <div class="field"><label>Sort Order</label><input id="eclsSortOrder" type="number" value="${cls.sort_order}"/></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dash-muted);margin-bottom:14px;">
      <input type="checkbox" id="eclsGraduating" ${cls.is_graduating_class?"checked":""} style="width:auto;"/> Graduating class
    </label>
    <button class="btn btn-green" style="width:100%;" onclick="saveClassEdit('${cls.id}')">Save</button>`);
}
async function saveClassEdit(id) {
  const name = document.getElementById("eclsName").value.trim();
  const category = document.getElementById("eclsCategory").value;
  const sort_order = Number(document.getElementById("eclsSortOrder").value) || 99;
  const is_graduating_class = document.getElementById("eclsGraduating").checked;
  const { error } = await sb.from("classes").update({ name, category, sort_order, is_graduating_class }).eq("id", id);
  if (error) { alert(error.message); return; }
  closeModal();
  await loadClassesListMgmt();
  await loadReferenceData();
}
async function deleteClass(id, name) {
  if (!confirm(`Delete "${name}"? This only works if no students are currently assigned to it.`)) return;
  const { error } = await sb.from("classes").delete().eq("id", id);
  if (error) { alert("Couldn't delete: " + error.message + "\n\nMove or remove students from this class first."); return; }
  await loadClassesListMgmt();
  await loadReferenceData();
}

// ============================================================
// FEATURE 2: TRANSFER STUDENTS BETWEEN CLASSES (bulk promotion)
// ============================================================
async function renderTransferStudents() {
  const el = document.getElementById("panel-transferStudents");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Transfer Students</h1>
        <p>Select students → choose the destination class → review → transfer. Past score history stays linked to their old class.</p>
      </div>
    </div>
    <div class="settings-card">
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <div class="field" style="flex:1;min-width:200px;"><label>1. From Class</label><select id="trFromClass" onchange="loadTransferStudentList()">
          <option value="">— choose —</option>
          ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select></div>
        <div class="field" style="flex:1;min-width:200px;"><label>2. To Class</label><select id="trToClass">
          <option value="">— choose —</option>
          ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select></div>
      </div>
      <div id="trStudentList"></div>
    </div>`;
}
async function loadTransferStudentList() {
  const classId = document.getElementById("trFromClass").value;
  const host = document.getElementById("trStudentList");
  if (!classId) { host.innerHTML = ""; return; }
  const { data: students } = await sb.from("students").select("id, full_name, admission_no").eq("class_id", classId).eq("is_active", true).order("full_name");
  if (!students || !students.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-people-group"></i><p>No active students in this class.</p></div>`; return; }
  host.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;margin:12px 0;">
      <input type="checkbox" id="trSelectAll" onchange="document.querySelectorAll('.trStuCheck').forEach(c=>c.checked=this.checked)"/> Select All (${students.length})
    </label>
    <div style="max-height:280px;overflow-y:auto;border:1px solid var(--dash-border);border-radius:8px;padding:8px;">
      ${students.map(s => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:5px 0;">
        <input type="checkbox" value="${s.id}" class="trStuCheck"/> ${s.full_name} <span style="color:var(--dash-muted);">(${s.admission_no})</span></label>`).join("")}
    </div>
    <button class="btn btn-green" style="margin-top:12px;" onclick="doTransfer()"><i class="fa-solid fa-people-arrows"></i> Transfer Selected Students</button>`;
}
async function doTransfer() {
  const toClassId = document.getElementById("trToClass").value;
  const fromClassId = document.getElementById("trFromClass").value;
  const studentIds = [...document.querySelectorAll(".trStuCheck:checked")].map(c => c.value);
  if (!toClassId) { alert("Choose a destination class."); return; }
  if (toClassId === fromClassId) { alert("Destination class is the same as the source class."); return; }
  if (!studentIds.length) { alert("Select at least one student."); return; }
  const toClassName = state.classes.find(c => c.id === toClassId)?.name;
  if (!confirm(`Move ${studentIds.length} student(s) to ${toClassName}? Their score history stays linked to their old class for past terms — only their current class changes.`)) return;
  const { error } = await sb.from("students").update({ class_id: toClassId, updated_at: new Date().toISOString() }).in("id", studentIds);
  if (error) { alert(error.message); return; }
  alert(`${studentIds.length} student(s) moved to ${toClassName}.`);
  loadTransferStudentList();
}

// ============================================================
// FEATURE 3: SCORE CONTROL — period windows + unlock approvals
// ============================================================
async function renderScoreControl() {
  const el = document.getElementById("panel-scoreControl");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Score Control</h1>
        <p>Open or close each assessment window per term, and approve/deny teachers' unlock requests.</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Assessment Period Windows</div>
      <p style="font-size:12px;color:var(--dash-muted);">Open a period so teachers can enter/submit scores for it. Once a teacher submits a subject for an open period, it locks automatically until you approve an unlock.</p>
      <div class="field" style="max-width:280px;"><label>Term</label><select id="scTermSelect" onchange="loadScoreControlPanel()">
        ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
      <div id="scWindowsBody"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Pending Unlock Requests</div>
      <div id="scRequestsBody"></div>
    </div>`;
  await loadScoreControlPanel();
  await loadUnlockRequests();
}
async function loadScoreControlPanel() {
  const termId = document.getElementById("scTermSelect").value;
  const { data: windows } = await sb.from("term_period_windows").select("*").eq("term_id", termId);
  const windowMap = {}; (windows||[]).forEach(w => windowMap[w.period] = w);
  const periods = [["ca1","CA1"],["ca2","CA2"],["ca3","CA3"],["exam","Exam"]];
  document.getElementById("scWindowsBody").innerHTML = `<div class="card-grid">${periods.map(([p,label]) => {
    const w = windowMap[p];
    const open = w?.is_open;
    return `<div class="class-card" style="cursor:default;">
      <div class="cc-name" style="text-align:left;">${label}</div>
      <div style="margin:8px 0;"><span class="badge ${open ? "badge-success" : "badge-neutral"}">${open ? "🟢 Open" : "⚪ Closed"}</span></div>
      <button class="btn ${open ? "btn-danger" : "btn-green"}" style="width:100%;" onclick="togglePeriodWindow('${termId}','${p}',${!open})">
        ${open ? "Close" : "Open"} ${label}
      </button></div>`;
  }).join("")}</div>`;
}
async function togglePeriodWindow(termId, period, openIt) {
  const payload = { term_id: termId, period, is_open: openIt };
  if (openIt) { payload.opened_by = state.staff.id; payload.opened_at = new Date().toISOString(); }
  else { payload.closed_at = new Date().toISOString(); }
  const { error } = await sb.from("term_period_windows").upsert(payload, { onConflict: "term_id,period" });
  if (error) { alert(error.message); return; }
  loadScoreControlPanel();
}
async function loadUnlockRequests() {
  const { data: requests } = await sb.from("score_unlock_requests")
    .select("*, classes(name), subjects(name), staff(full_name)").eq("status", "pending").order("requested_at", { ascending: false });
  const host = document.getElementById("scRequestsBody");
  if (!requests || !requests.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>No pending requests — you're all caught up.</p></div>`; return; }
  const { data: studentsAll } = await sb.from("students").select("id, full_name");
  const nameOf = {}; (studentsAll||[]).forEach(s => nameOf[s.id] = s.full_name);
  host.innerHTML = requests.map(r => `
    <div class="settings-card" style="background:var(--dash-surface);border-left:3px solid var(--dash-green);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
        <div style="font-weight:800;">${r.staff.full_name} — ${r.subjects.name} <span class="badge badge-info">${r.classes.name} · ${(r.period || "—").toUpperCase()}</span></div>
      </div>
      <div style="font-size:12px;color:var(--dash-muted);margin:6px 0;">Students: ${r.student_ids.map(id => nameOf[id]||id).join(", ")}</div>
      <div style="font-size:12px;margin-bottom:10px;">Reason: ${r.reason || "—"}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-green" onclick="resolveRequest('${r.id}', true)"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn btn-danger" onclick="resolveRequest('${r.id}', false)"><i class="fa-solid fa-xmark"></i> Deny</button>
      </div>
    </div>`).join("");
}
async function resolveRequest(id, approve) {
  const { data, error } = await sb.rpc("resolve_unlock_request", { p_request_id: id, p_approve: approve });
  if (error) { alert(error.message); return; }
  if (approve) {
    const r = data && data[0];
    if (r && r.skipped_count > 0) {
      alert(`Approved for ${r.approved_count} student(s). ${r.skipped_count} student(s) already had a score for this period and were skipped — only you can edit an already-scored student directly.`);
    } else if (r) {
      alert(`Approved for ${r.approved_count} student(s).`);
    }
  }
  loadUnlockRequests();
}
