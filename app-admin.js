// ============================================================
// MASTER LIST
// ============================================================
async function renderMasterList() {
  const el = document.getElementById("panel-masterlist");
  const roles = state.allRoles || [state.role];
  let myClasses = state.classes;
  // Admin/headmaster/principal always see everything relevant to
  // their office already, so only narrow the list down for people
  // whose ENTIRE role set is teacher/registrar-only (no elevated
  // position) — union their teacher assignments with their
  // registrar section(s) rather than picking just one.
  const hasBroadAccess = roles.some(r => ["admin","headmaster","principal"].includes(r));
  if (!hasBroadAccess) {
    const idSet = new Set();
    if (roles.includes("teacher")) {
      const { data: assigns } = await sb.from("class_teacher_subjects").select("class_id").eq("staff_id", state.staff.id);
      (assigns || []).forEach(a => idSet.add(a.class_id));
    }
    if (roles.includes("registrar")) {
      state.classes.forEach(c => idSet.add(c.id));
    }
    if (idSet.size) myClasses = state.classes.filter(c => idSet.has(c.id));
  }
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Master List</h1>
        <p>Full student roster per class, with Position List and PDF/Word export.</p>
      </div>
    </div>
    <div class="field" style="max-width:280px;"><label>Select Class</label>
    <select id="mlClassSelect" onchange="loadMasterList(this.value)">
      <option value="">— choose —</option>
      ${myClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}
    </select></div>
    <div id="mlBody"></div>`;
}
async function loadMasterList(classId) {
  const body = document.getElementById("mlBody");
  if (!classId) { body.innerHTML = ""; return; }
  body.innerHTML = "Loading…";
  const isRegistrar = (state.allRoles || []).includes("registrar");
  const className = state.classes.find(c => c.id === classId)?.name || "";
  const { data: students } = await sb.from("students")
    .select("id, admission_no, full_name, gender, date_of_birth, guardian_name, guardian_phone, staff:registered_by(full_name)")
    .eq("class_id", classId).eq("is_active", true).order("full_name");

  body.innerHTML = `
    <div class="field" style="max-width:280px;"><input id="mlSearch" placeholder="Search by name or admission no…" oninput="filterMasterListTable()"/></div>
    <div style="overflow-x:auto;"><table class="data-table sticky-head" id="masterListTable">
    <thead><tr><th>#</th><th>Adm No</th><th>Name</th><th>Gender</th><th>DOB</th><th>Guardian</th><th>Phone</th>${isRegistrar?"<th>Registered By</th>":""}</tr></thead>
    <tbody>${(students||[]).map((s,i) => `<tr>
      <td>${i+1}</td><td>${s.admission_no}</td><td class="name-cell">${s.full_name}</td>
      <td>${s.gender||"-"}</td><td>${s.date_of_birth||"-"}</td><td>${s.guardian_name||"-"}</td><td>${s.guardian_phone||"-"}</td>
      ${isRegistrar?`<td>${s.staff?.full_name||"—"}</td>`:""}
    </tr>`).join("") || `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-user-slash"></i><p>No active students in this class yet.</p></div></td></tr>`}</tbody></table></div>
    <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
      <button class="btn" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>
      <button class="btn" onclick="downloadBrandedPdf('Master List','${className.replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('masterListTable').outerHTML,'MasterList_${className.replace(/\s/g,"_")}.pdf')"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
      <button class="btn" onclick="downloadBrandedWord('Master List','${className.replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('masterListTable').outerHTML,'MasterList_${className.replace(/\s/g,"_")}.doc')"><i class="fa-solid fa-file-word"></i> Download Word</button>
      <button class="btn" style="margin-left:auto;" onclick="loadPositionList('${classId}','${className.replace(/'/g,"&apos;")}')"><i class="fa-solid fa-ranking-star"></i> Position List</button>
    </div>
    <div id="positionListHost" style="margin-top:20px;"></div>`;
}
function filterMasterListTable() {
  const q = document.getElementById("mlSearch").value.trim().toLowerCase();
  document.querySelectorAll("#masterListTable tbody tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ============================================================
// POSITION LIST — students in one class+term, ranked by average.
// A dedicated exportable sheet, separate from the roster above.
// ============================================================
async function loadPositionList(classId, className) {
  const host = document.getElementById("positionListHost");
  host.innerHTML = "Loading…";
  const termId = state.currentTermId;
  const term = state.terms.find(t => t.id === termId);
  const { data: rows } = await sb.from("student_term_summary")
    .select("average, total_marks, class_position, class_position_label, students(full_name, admission_no)")
    .eq("class_id", classId).eq("term_id", termId)
    .not("class_position", "is", null)
    .order("class_position", { ascending: true });

  host.innerHTML = `
    <div class="settings-card-title">Position List — ${term?.name || ""}</div>
    <div style="overflow-x:auto;"><table class="data-table" id="positionListTable">
      <thead><tr><th>Position</th><th>Adm No</th><th>Name</th><th>Total</th><th>Average</th></tr></thead>
      <tbody>${(rows||[]).map(r => `<tr>
        <td><strong>${r.class_position_label}</strong></td>
        <td>${r.students.admission_no}</td>
        <td class="name-cell">${r.students.full_name}</td>
        <td>${r.total_marks ?? "—"}</td>
        <td>${r.average != null ? Number(r.average).toFixed(1) : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="5" style="color:var(--dash-muted);">No scores entered yet for this term.</td></tr>`}</tbody>
    </table></div>
    <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <button class="btn" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>
      <button class="btn" onclick="downloadBrandedPdf('Position List','${className} — ${(term?.name||"").replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('positionListTable').outerHTML,'PositionList_${className.replace(/\s/g,"_")}.pdf')"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
      <button class="btn" onclick="downloadBrandedWord('Position List','${className} — ${(term?.name||"").replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('positionListTable').outerHTML,'PositionList_${className.replace(/\s/g,"_")}.doc')"><i class="fa-solid fa-file-word"></i> Download Word</button>
    </div>`;
}

// ============================================================
// STAFF DIRECTORY (full CRUD — replaces the Teacher Directory sheet)
// ============================================================
async function renderStaffDirectory() {
  if (state.role !== "admin") { document.getElementById("panel-staffDirectory").innerHTML = "Admins only."; return; }
  const el = document.getElementById("panel-staffDirectory");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Staff Directory</h1>
        <p>Add, edit, deactivate staff, assign positions, and set login passwords.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-green" onclick="openStaffForm()"><i class="fa-solid fa-plus"></i> Add Staff</button>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Bulk Reset — Teachers Only</div>
      <p style="font-size:12px;color:var(--dash-muted);">Applies only to staff whose sole role is Teacher — never to Admin, Headmaster, Principal, or Bursar accounts, which are always managed individually below.</p>
      <div class="field"><label>New Teacher ID Prefix (e.g. TP000 → generates TP0001, TP0002…)</label><input id="bulkTeacherPrefix" placeholder="TP000"/></div>
      <div class="field"><label>New Shared Password for All Teachers</label><input id="bulkTeacherIdPassword" type="password" placeholder="Required — IDs are changing, so passwords must reset too"/></div>
      <button class="btn btn-green" onclick="bulkRenumberTeachers()">Assign New IDs + Reset Passwords</button>
      <hr style="border-color:var(--dash-border);margin:16px 0;">
      <div class="field"><label>Reset All Teacher Passwords (keep existing IDs)</label><input id="bulkTeacherPasswordOnly" type="password" placeholder="New shared password"/></div>
      <button class="btn" onclick="bulkResetTeacherPasswords()">Reset Passwords Only</button>
      <div id="bulkTeacherResult" style="margin-top:12px;font-size:12px;"></div>
    </div>
    <div class="field" style="max-width:280px;"><input id="staffSearch" placeholder="Search staff by name, ID, or position…" oninput="filterStaffList()"/></div>
    <div id="staffList" style="margin-top:14px;"></div>`;
  await loadStaffList();
}
async function bulkRenumberTeachers() {
  const prefix = document.getElementById("bulkTeacherPrefix").value.trim();
  const new_password = document.getElementById("bulkTeacherIdPassword").value;
  if (!prefix || !new_password) { alert("Both the ID prefix and a new shared password are required."); return; }
  if (!confirm(`This will change the login ID and password for EVERY teacher (not other staff roles). Continue?`)) return;
  const result = await callBulkCredentialReset({ action: "renumber_teachers", prefix, new_password });
  if (!result) return;
  document.getElementById("bulkTeacherResult").innerHTML = `<strong>${result.count} teacher(s) updated.</strong><br/>` +
    result.mapping.map(m => `${m.full_name}: ${m.old_code || "(new)"} → ${m.new_code}`).join("<br/>");
  alert(`Done. ${result.count} teacher(s) now have new IDs and the shared password you set. Share the new IDs with them individually.`);
  loadStaffList();
}
async function bulkResetTeacherPasswords() {
  const new_password = document.getElementById("bulkTeacherPasswordOnly").value;
  if (!new_password) { alert("Enter a new password."); return; }
  if (!confirm("Reset the password for EVERY teacher to this same value?")) return;
  const result = await callBulkCredentialReset({ action: "reset_teacher_passwords", new_password });
  if (!result) return;
  alert(`Password reset for ${result.count} teacher(s).`);
}
async function callBulkCredentialReset(payload) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/bulk-credential-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) { alert("Failed: " + (json.error || res.statusText)); return null; }
  return json;
}
async function loadStaffList() {
  const { data: staff, error } = await sb.from("staff")
    .select("id, staff_code, full_name, phone, email, positions, is_admin, signature_url, salary_status, is_active, created_at, updated_at")
    .order("full_name");
  if (error) { document.getElementById("staffList").innerHTML = `<p style="color:var(--dash-danger);">Failed to load staff: ${error.message}</p>`; return; }
  document.getElementById("staffList").innerHTML = `<div class="card-grid">${(staff||[]).map(s => `
    <div class="class-card" style="cursor:default;text-align:left;" data-search="${(s.full_name+" "+s.staff_code+" "+(s.positions||[]).join(" ")).toLowerCase()}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--dash-green-soft);color:var(--dash-accent);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;flex-shrink:0;">${initials(s.full_name)}</div>
        <div style="min-width:0;">
          <div class="cc-name" style="text-align:left;">${s.full_name}</div>
          <div class="cc-sub" style="text-align:left;">${s.staff_code}</div>
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
        ${(s.positions||["Teacher"]).map(p => `<span class="badge badge-info">${p}</span>`).join("")}
        <span class="badge ${s.is_active ? "badge-success" : "badge-neutral"}">${s.is_active ? "Active" : "Inactive"}</span>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn" style="flex:1;" onclick='openStaffForm(${JSON.stringify(s).replace(/'/g,"&apos;")})'>Edit</button>
        <button class="btn btn-danger" onclick="deactivateStaff('${s.id}')">${s.is_active?"Deactivate":"Activate"}</button>
      </div>
    </div>`).join("") || `<div class="empty-state"><i class="fa-solid fa-user-tie"></i><p>No staff yet — add your first one above.</p></div>`}</div>`;
}
function initials(name) {
  return (name||"").trim().split(/\s+/).slice(0,2).map(n => n[0]?.toUpperCase()||"").join("") || "?";
}
function filterStaffList() {
  const q = document.getElementById("staffSearch").value.trim().toLowerCase();
  document.querySelectorAll("#staffList .class-card").forEach(card => {
    card.style.display = (card.dataset.search||"").includes(q) ? "" : "none";
  });
}
function openStaffForm(staff) {
  const positions = ["Admin","Headmaster","Principal","Bursar","Admin Officer","Teacher","Registrar"];
  openModal(`<h3>${staff ? "Edit" : "Add"} Staff</h3>
    <div class="field"><label>Full Name</label><input id="sfName" value="${staff?.full_name||""}"/></div>
    <div class="field"><label>Staff ID (login)</label><input id="sfCode" value="${staff?.staff_code||""}" data-original="${staff?.staff_code||""}"/></div>
    ${staff ? `<p style="font-size:11px;color:var(--dash-muted);margin-top:-8px;">Changing the Staff ID requires setting a new password below too — otherwise their account gets locked out.</p>` : ""}
    <div class="field"><label>Phone</label><input id="sfPhone" value="${staff?.phone||""}"/></div>
    <div class="field"><label>Email</label><input id="sfEmail" value="${staff?.email||""}"/></div>
    <div class="field"><label>Positions</label>
      <div class="pill-list">${positions.map(p => `<label style="display:flex;align-items:center;gap:4px;font-size:11px;">
        <input type="checkbox" value="${p}" ${staff?.positions?.includes(p)?"checked":""} class="sfPosCheck"/> ${p}</label>`).join("")}</div>
    </div>
    <div class="field"><label>${staff ? "Reset Password (leave blank to keep current)" : "Set Password"}</label><input id="sfPassword" type="password" placeholder="${staff?'••••••••':''}"/></div>
    <button class="btn btn-green" style="width:100%;" onclick="saveStaff(${staff?`'${staff.id}'`:'null'})">Save</button>`);
}
async function saveStaff(staffId) {
  const full_name = document.getElementById("sfName").value.trim();
  const staff_code = document.getElementById("sfCode").value.trim();
  const originalCode = document.getElementById("sfCode").dataset.original || "";
  const phone = document.getElementById("sfPhone").value.trim();
  const email = document.getElementById("sfEmail").value.trim();
  const password = document.getElementById("sfPassword").value;
  const positions = [...document.querySelectorAll(".sfPosCheck:checked")].map(c => c.value);
  const is_admin = positions.includes("Admin");
  if (!full_name || !staff_code) { alert("Name and Staff ID are required."); return; }
  if (!staffId && !password) { alert("Please set an initial password for this staff member."); return; }
  const codeChanged = staffId && staff_code !== originalCode;
  if (codeChanged && !password) { alert("You changed the Staff ID — please also set a new password so their login doesn't break."); return; }

  let row;
  if (staffId) {
    const { data, error } = await sb.from("staff").update({ full_name, staff_code, phone, email, positions, is_admin, updated_at: new Date().toISOString() }).eq("id", staffId).select("id, staff_code").single();
    if (error) { alert(error.message); return; }
    row = data;
  } else {
    const password_hash_res = await sb.rpc("hash_secret", { p_plain: password });
    const { data, error } = await sb.from("staff").insert({ full_name, staff_code, phone, email, positions, is_admin, password_hash: password_hash_res.data }).select("id, staff_code").single();
    if (error) { alert(error.message); return; }
    row = data;
  }
  if (password) {
    if (staffId) {
      const password_hash_res = await sb.rpc("hash_secret", { p_plain: password });
      await sb.from("staff").update({ password_hash: password_hash_res.data }).eq("id", staffId);
    }
    await provisionAuthAccount("staff", row.id, row.staff_code, password);
  }
  closeModal();
  loadStaffList();
}
async function deactivateStaff(id) {
  const { data: cur } = await sb.from("staff").select("is_active").eq("id", id).single();
  await sb.from("staff").update({ is_active: !cur.is_active }).eq("id", id);
  loadStaffList();
}

// Calls the provision-user Edge Function so a real Supabase Auth
// account exists for this staff/student login.
async function provisionAuthAccount(kind, table_id, login_id, password) {
  const json = await provisionAuthAccountSilent(kind, table_id, login_id, password);
  if (json.error) { alert("Account login setup failed: " + json.error); }
  return json;
}
// Same call, but never alert()s — used inside loops (bulk import,
// bulk credential reset) where a per-row popup would block the loop
// and hide the overall summary. Callers must check `.error` themselves.
async function provisionAuthAccountSilent(kind, table_id, login_id, password) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/provision-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
      body: JSON.stringify({ kind, table_id, login_id, password }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || res.statusText };
    return json;
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

// ============================================================
// STUDENTS (full CRUD — replaces manual roster entry in Sheets)
// ============================================================
async function renderStudents() {
  const el = document.getElementById("panel-students");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Students</h1>
        <p>Add, edit, deactivate students, assign class, and set login passwords.</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Bulk Reset — All Students</div>
      <p style="font-size:12px;color:var(--dash-muted);">Applies to every active student across all classes. Admission numbers are reassigned globally in serial order (sorted by class name, then student name) — never per-class, so two students in different classes never end up with the same number.</p>
      <div class="field"><label>New Admission Number Prefix (e.g. SU2026000 → generates SU20260001, SU20260002…)</label><input id="bulkStudentPrefix" placeholder="SU2026000"/></div>
      <div class="field"><label>New Shared Default Password for All Students</label><input id="bulkStudentIdPassword" type="password" placeholder="Required — IDs are changing, so passwords must reset too"/></div>
      <button class="btn btn-green" onclick="bulkRenumberStudents()">Assign New Admission Numbers + Reset Passwords</button>
      <hr style="border-color:var(--dash-border);margin:16px 0;">
      <div class="field"><label>Reset All Student Passwords (keep existing admission numbers)</label><input id="bulkStudentPasswordOnly" type="password" placeholder="New shared default password"/></div>
      <button class="btn" onclick="bulkResetStudentPasswords()">Reset Passwords Only</button>
      <div id="bulkStudentResult" style="margin-top:12px;font-size:12px;max-height:200px;overflow-y:auto;"></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
      <div class="field" style="flex:1;min-width:180px;"><label>Filter by Class</label>
        <select id="stuFilterClass" onchange="loadStudentsList()"><option value="">All Classes</option>
        ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select></div>
      <div class="field" style="flex:1;min-width:180px;"><label>Search</label><input id="stuSearch" placeholder="Name or admission no…" oninput="filterStudentsList()"/></div>
      <button class="btn btn-green" onclick="openStudentForm()"><i class="fa-solid fa-plus"></i> Add Student</button>
    </div>
    <div id="studentsList" style="margin-top:14px;"></div>`;
  await loadStudentsList();
}
function filterStudentsList() {
  const q = document.getElementById("stuSearch").value.trim().toLowerCase();
  document.querySelectorAll("#studentsList .class-card").forEach(card => {
    card.style.display = (card.dataset.search||"").includes(q) ? "" : "none";
  });
}
async function bulkRenumberStudents() {
  const prefix = document.getElementById("bulkStudentPrefix").value.trim();
  const new_default_password = document.getElementById("bulkStudentIdPassword").value;
  if (!prefix || !new_default_password) { alert("Both the admission number prefix and a new shared password are required."); return; }
  if (!confirm("This will change the admission number and password for EVERY active student. Continue?")) return;
  const result = await callBulkCredentialReset({ action: "renumber_students", prefix, new_default_password });
  if (!result) return;
  document.getElementById("bulkStudentResult").innerHTML = `<strong>${result.count} student(s) updated.</strong><br/>` +
    result.mapping.map(m => `${m.full_name} (${m.class||""}): ${m.old_admission_no||"(new)"} → ${m.new_admission_no}`).join("<br/>");
  alert(`Done. ${result.count} student(s) now have new admission numbers and share the new default password. Individual passwords set earlier were cleared.`);
  loadStudentsList();
}
async function bulkResetStudentPasswords() {
  const new_default_password = document.getElementById("bulkStudentPasswordOnly").value;
  if (!new_default_password) { alert("Enter a new password."); return; }
  if (!confirm("Reset EVERY student to this shared password (clearing any individual passwords)?")) return;
  const result = await callBulkCredentialReset({ action: "reset_student_passwords", new_default_password });
  if (!result) return;
  alert(`Password reset for ${result.count} student(s).`);
}
async function loadStudentsList() {
  const classId = document.getElementById("stuFilterClass")?.value;
  let q = sb.from("students")
    .select("id, admission_no, full_name, class_id, gender, date_of_birth, guardian_name, guardian_phone, is_active, registered_by, created_at, updated_at, classes(name)")
    .order("full_name");
  if (classId) q = q.eq("class_id", classId);
  const { data: students, error } = await q;
  if (error) { document.getElementById("studentsList").innerHTML = `<p style="color:var(--dash-danger);">Failed to load students: ${error.message}</p>`; return; }
  document.getElementById("studentsList").innerHTML = `<div class="card-grid">${(students||[]).map(s => `
    <div class="class-card" style="cursor:default;text-align:left;" data-search="${(s.full_name+" "+s.admission_no).toLowerCase()}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--dash-green-soft);color:var(--dash-accent);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;flex-shrink:0;">${initials(s.full_name)}</div>
        <div style="min-width:0;">
          <div class="cc-name" style="text-align:left;">${s.full_name}</div>
          <div class="cc-sub" style="text-align:left;">${s.admission_no}</div>
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
        <span class="badge ${s.classes?.name ? "badge-info" : "badge-warning"}">${s.classes?.name || "Unassigned"}</span>
        <span class="badge ${s.is_active ? "badge-success" : "badge-neutral"}">${s.is_active ? "Active" : "Inactive"}</span>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn" style="flex:1;" onclick='openStudentForm(${JSON.stringify(s).replace(/'/g,"&apos;")})'>Edit</button>
        <button class="btn btn-danger" onclick="deactivateStudent('${s.id}')">${s.is_active?"Deactivate":"Activate"}</button>
      </div>
    </div>`).join("") || `<div class="empty-state"><i class="fa-solid fa-user-graduate"></i><p>No students found — try a different filter, or add one above.</p></div>`}</div>`;
}
function openStudentForm(stu) {
  openModal(`<h3>${stu ? "Edit" : "Add"} Student</h3>
    <div class="field"><label>Full Name</label><input id="stfName" value="${stu?.full_name||""}"/></div>
    <div class="field"><label>Admission No.</label><input id="stfAdm" value="${stu?.admission_no||""}" data-original="${stu?.admission_no||""}"/></div>
    ${stu ? `<p style="font-size:11px;color:var(--dash-muted);margin-top:-8px;">Changing this resets their password to the current school default — tell them the default password if you change their admission number.</p>` : ""}
    <div class="field"><label>Class</label><select id="stfClass">${state.classes.map(c => `<option value="${c.id}" ${stu?.class_id===c.id?"selected":""}>${c.name}</option>`).join("")}</select></div>
    <div class="field"><label>Gender</label><select id="stfGender">
      <option ${stu?.gender==="Male"?"selected":""}>Male</option><option ${stu?.gender==="Female"?"selected":""}>Female</option></select></div>
    <div class="field"><label>Date of Birth</label><input id="stfDob" type="date" value="${stu?.date_of_birth||""}"/></div>
    <div class="field"><label>Guardian Name</label><input id="stfGuardian" value="${stu?.guardian_name||""}"/></div>
    <div class="field"><label>Guardian Phone</label><input id="stfGuardianPhone" value="${stu?.guardian_phone||""}"/></div>
    <div class="field"><label>${stu?"Reset Password (blank = keep current / school default)":"Password (blank = use school default password)"}</label><input id="stfPassword" type="password"/></div>
    <button class="btn btn-green" style="width:100%;" onclick="saveStudent(${stu?`'${stu.id}'`:'null'})">Save</button>`);
}
async function saveStudent(studentId) {
  const full_name = document.getElementById("stfName").value.trim();
  const admission_no = document.getElementById("stfAdm").value.trim();
  const originalAdm = document.getElementById("stfAdm").dataset.original || "";
  const class_id = document.getElementById("stfClass").value;
  const gender = document.getElementById("stfGender").value;
  const date_of_birth = document.getElementById("stfDob").value || null;
  const guardian_name = document.getElementById("stfGuardian").value.trim();
  const guardian_phone = document.getElementById("stfGuardianPhone").value.trim();
  const password = document.getElementById("stfPassword").value;
  if (!full_name || !admission_no) { alert("Name and Admission Number are required."); return; }
  const admChanged = studentId && admission_no !== originalAdm;

  // Friendly duplicate check before hitting the DB's unique
  // constraint, so admin sees exactly who already has this number
  // instead of a raw constraint-violation error.
  if (!studentId || admChanged) {
    const { data: existing } = await sb.from("students").select("full_name").eq("admission_no", admission_no).maybeSingle();
    if (existing) { alert(`Admission number "${admission_no}" already belongs to ${existing.full_name}. Please choose a different one.`); return; }
  }

  let row;
  const payload = { full_name, class_id, gender, date_of_birth, guardian_name, guardian_phone };
  if (studentId) {
    const updatePayload = { ...payload, admission_no, updated_at: new Date().toISOString() };
    // Changing the admission number breaks their old shadow login,
    // so unless a new password was also given, fall back to the
    // current school-wide default so they can still sign in.
    if (admChanged && !password) updatePayload.password_hash = null;
    const { data, error } = await sb.from("students").update(updatePayload).eq("id", studentId).select("id, admission_no").single();
    if (error) { alert(error.message); return; }
    row = data;
  } else {
    const { data, error } = await sb.from("students").insert({ ...payload, admission_no }).select("id, admission_no").single();
    if (error) { alert(error.message); return; }
    row = data;
  }
  // Always provision a real login account — previously this only
  // happened if a password was typed, silently leaving students
  // with no auth account (and no way to log in) if admin left the
  // password field blank to use the school default.
  const effectivePassword = password || state.schoolSettings.student_default_password || "student123";
  if (password) {
    const password_hash_res = await sb.rpc("hash_secret", { p_plain: password });
    await sb.from("students").update({ password_hash: password_hash_res.data }).eq("id", row.id);
  }
  await provisionAuthAccount("student", row.id, row.admission_no, effectivePassword);
  closeModal();
  loadStudentsList();
}
async function deactivateStudent(id) {
  const { data: cur } = await sb.from("students").select("is_active").eq("id", id).single();
  await sb.from("students").update({ is_active: !cur.is_active }).eq("id", id);
  loadStudentsList();
}

// ============================================================
// FEES
// ============================================================
async function renderFees() {
  const el = document.getElementById("panel-fees");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Fees</h1>
        <p>School-wide collection status, per-class fee amounts, and per-student payment ticking.</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Fees Overview — Whole School</div>
      <div class="field" style="max-width:280px;"><label>Term</label><select id="feeOverviewTerm" onchange="loadFeesOverview()">
        ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
      <div id="feeOverviewBody">Loading…</div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Fee Structure by Class</div>
      <p style="font-size:12px;color:var(--dash-muted);">Expected fee per student, per class — Primary 6 typically costs more than Primary 1.</p>
      <div id="feeStructureGrid"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Per-Student Payment</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="field" style="flex:1;min-width:200px;"><label>Select Class</label>
          <select id="feeClassSelect" onchange="loadFeesGrid()"><option value="">— choose —</option>
          ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select></div>
        <div class="field" style="flex:1;min-width:200px;"><label>Term</label><select id="feeTermSelect" onchange="loadFeesGrid()">
        ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
      </div>
      <div id="feeGrid"></div>
    </div>`;
  await loadFeesOverview();
  await loadFeeStructureGrid();
}

async function loadFeeStructureGrid() {
  const host = document.getElementById("feeStructureGrid");
  const { data: rows } = await sb.from("fee_structure").select("class_id, expected_amount, classes(name, sort_order)").order("classes(sort_order)");
  const sorted = (rows||[]).slice().sort((a,b) => (a.classes?.sort_order||0) - (b.classes?.sort_order||0));
  host.innerHTML = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Class</th><th>Expected Amount (₦)</th><th></th></tr></thead>
    <tbody>${sorted.map(r => `<tr>
      <td class="name-cell">${r.classes?.name}</td>
      <td><input type="number" id="fs_amt_${r.class_id}" value="${r.expected_amount}" style="width:110px;"/></td>
      <td><button class="btn btn-green" style="font-size:11px;padding:5px 9px;" onclick="saveFeeStructureRow('${r.class_id}')">Save</button></td>
    </tr>`).join("")}</tbody></table></div>`;
}
async function saveFeeStructureRow(classId) {
  const expected_amount = Number(document.getElementById(`fs_amt_${classId}`).value) || 0;
  const { error } = await sb.from("fee_structure").update({ expected_amount }).eq("class_id", classId);
  if (error) { alert(error.message); return; }
  alert("Saved. Existing fees_status for students in this class recalculates the next time a payment is touched.");
  loadFeesOverview();
}

async function loadFeesOverview() {
  const termId = document.getElementById("feeOverviewTerm").value;
  const body = document.getElementById("feeOverviewBody");
  body.innerHTML = "Loading…";

  const [{ data: structure }, { data: students }, { data: payments }] = await Promise.all([
    sb.from("fee_structure").select("class_id, expected_amount"),
    sb.from("students").select("id, class_id").eq("is_active", true),
    sb.from("fee_payments").select("student_id, amount_paid, is_paid_override").eq("term_id", termId),
  ]);
  const expectedByClass = {}; (structure||[]).forEach(s => expectedByClass[s.class_id] = s.expected_amount);
  const payMap = {}; (payments||[]).forEach(p => payMap[p.student_id] = p);

  // Students with no class assigned have no determinable expected
  // fee — counting them as "paid" (because 0 >= 0) was the bug.
  // Exclude them from fee totals entirely and surface the count
  // separately so it's clear why they're missing, not silently wrong.
  const classedStudents = (students||[]).filter(s => s.class_id);
  const unassignedCount = (students||[]).length - classedStudents.length;

  let totalCollected = 0, totalOutstandingAmount = 0, paidCount = 0, unpaidCount = 0;
  classedStudents.forEach(stu => {
    const expected = expectedByClass[stu.class_id] || 0;
    const pay = payMap[stu.id];
    const paidAmt = pay?.amount_paid || 0;
    const isPaid = pay?.is_paid_override === true ? true : pay?.is_paid_override === false ? false : paidAmt >= expected;
    totalCollected += paidAmt;
    if (isPaid) paidCount++;
    else { unpaidCount++; totalOutstandingAmount += Math.max(expected - paidAmt, 0); }
  });

  body.innerHTML = `<div class="kpi-grid">
    ${kpiCard("fa-money-bill-trend-up", "₦" + totalCollected.toLocaleString(), "Total Collected")}
    ${kpiCard("fa-triangle-exclamation", "₦" + totalOutstandingAmount.toLocaleString(), "Total Outstanding")}
    ${kpiCard("fa-circle-check", paidCount, "Students Fully Paid")}
    ${kpiCard("fa-circle-xmark", unpaidCount, "Students Owing")}
  </div>
  ${unassignedCount > 0 ? `<p style="font-size:12px;color:var(--dash-muted);margin-top:10px;">
    <i class="fa-solid fa-triangle-exclamation"></i> ${unassignedCount} active student(s) have no class assigned and are excluded from these totals —
    see <a href="#" onclick="switchTab('unassignedStudents');return false;" style="color:var(--dash-accent);">Unassigned Students</a> to fix.</p>` : ""}`;
}

async function loadFeesGrid() {
  const classId = document.getElementById("feeClassSelect").value;
  const termId = document.getElementById("feeTermSelect").value;
  const grid = document.getElementById("feeGrid");
  if (!classId) { grid.innerHTML = ""; return; }
  grid.innerHTML = "Loading…";
  const cls = state.classes.find(c => c.id === classId);
  const { data: fs } = await sb.from("fee_structure").select("expected_amount").eq("class_id", classId).maybeSingle();
  const expected = fs?.expected_amount ?? 0;
  const [{ data: students }, { data: payments }] = await Promise.all([
    sb.from("students").select("id, full_name").eq("class_id", classId).eq("is_active", true).order("full_name"),
    sb.from("fee_payments").select("*").eq("class_id", classId).eq("term_id", termId),
  ]);
  const payMap = {}; (payments||[]).forEach(p => payMap[p.student_id] = p);
  grid.innerHTML = `<p style="color:var(--dash-muted);">Expected: ₦${expected} per student — tick "Fully Paid" to mark a student paid in full without typing the exact amount, or enter a partial amount below.</p>
    <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Student</th><th>Fully Paid</th><th>Amount Paid (₦)</th><th></th></tr></thead>
    <tbody>${(students||[]).map(s => { const p = payMap[s.id] || {}; const isFullyPaid = p.is_paid_override === true;
      return `<tr>
        <td class="name-cell">${s.full_name}</td>
        <td style="text-align:center;">
          <input type="checkbox" id="fp_full_${s.id}" ${isFullyPaid?"checked":""} style="width:20px;height:20px;cursor:pointer;"
            onchange="toggleFullyPaid('${s.id}', this.checked, ${expected})"/>
        </td>
        <td><input type="number" id="fp_amt_${s.id}" value="${p.amount_paid||0}" style="width:90px;" ${isFullyPaid?"disabled":""}/></td>
        <td><button class="btn btn-green" onclick="saveFeeRow('${s.id}','${classId}','${termId}')">Save</button></td>
      </tr>`;}).join("")}</tbody></table></div>`;
}
function toggleFullyPaid(studentId, checked, expectedAmount) {
  const amtInput = document.getElementById(`fp_amt_${studentId}`);
  if (checked) { amtInput.value = expectedAmount; amtInput.disabled = true; }
  else { amtInput.disabled = false; }
}
async function saveFeeRow(studentId, classId, termId) {
  const isFullyPaid = document.getElementById(`fp_full_${studentId}`).checked;
  const amount_paid = Number(document.getElementById(`fp_amt_${studentId}`).value) || 0;
  const is_paid_override = isFullyPaid ? true : null;
  const { error } = await sb.from("fee_payments").upsert({
    student_id: studentId, class_id: classId, term_id: termId, amount_paid, is_paid_override,
    updated_by: state.staff ? state.staff.id : null,
  }, { onConflict: "student_id,term_id" });
  if (error) alert(error.message); else { alert("Saved."); loadFeesOverview(); }
}

// ============================================================
// SETTINGS
// ============================================================
async function renderSettings() {
  const el = document.getElementById("panel-settings");
  const s = state.schoolSettings;
  let html = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Settings</h1>
        <p>School profile, admission scheme, term/session, and your own account.</p>
      </div>
    </div>`;
  if (state.role === "admin") {
    html += `<div class="tab-bar no-print" style="overflow-x:auto;">
      <button class="tab-bar-item" onclick="document.getElementById('set-profile').scrollIntoView({behavior:'smooth'})">Profile</button>
      <button class="tab-bar-item" onclick="document.getElementById('set-signatures').scrollIntoView({behavior:'smooth'})">Signatures</button>
      <button class="tab-bar-item" onclick="document.getElementById('set-admission').scrollIntoView({behavior:'smooth'})">Admission</button>
      <button class="tab-bar-item" onclick="document.getElementById('set-terms').scrollIntoView({behavior:'smooth'})">Terms</button>
      <button class="tab-bar-item" onclick="document.getElementById('set-theme').scrollIntoView({behavior:'smooth'})">Theme</button>
      <button class="tab-bar-item" onclick="document.getElementById('set-security').scrollIntoView({behavior:'smooth'})">Security</button>
      <button class="tab-bar-item" onclick="document.getElementById('set-account').scrollIntoView({behavior:'smooth'})">My Account</button>
    </div>`;
    html += `<div class="settings-card" id="set-profile">
      <div class="settings-card-title">School Profile</div>
      <div class="field"><label>School Name</label><input id="setSchoolName" value="${s.school_name||""}"/></div>
      <div class="field"><label>Motto</label><input id="setMotto" value="${s.motto||""}"/></div>
      <div class="field"><label>Address</label><input id="setAddress" value="${s.address||""}"/></div>
      <div class="field"><label>School Email — shown on report cards, optional</label><input id="setEmail" type="email" value="${s.email||""}" placeholder="info@school.edu.ng"/></div>
      <div class="field"><label>School Phone — shown on report cards, optional</label><input id="setPhone" value="${s.phone||""}" placeholder="080..."/></div>
      <div class="field"><label>Current Session</label><input id="setSession" value="${s.current_session||""}"/></div>
      <div class="field"><label>Primary Website</label><input id="setPrimaryWebsite" value="${s.primary_website||""}" placeholder="https://..."/></div>
      <div class="field"><label>Secondary Website</label><input id="setSecondaryWebsite" value="${s.secondary_website||""}" placeholder="https://..."/></div>
      <div class="field"><label>School Logo — paste direct image link (e.g. from postimages.org)</label>
        <input id="setSchoolLogo" value="${s.school_logo_url||""}" placeholder="https://i.postimg.cc/..."/>
        ${s.school_logo_url ? `<img src="${s.school_logo_url}" style="height:50px;margin-top:6px;border-radius:6px;" onerror="this.style.display='none'"/>` : ""}
      </div>
      <div class="field"><label>Coat of Arms Logo — paste direct image link</label>
        <input id="setSecondaryLogo" value="${s.secondary_logo_url||""}" placeholder="https://i.postimg.cc/..."/>
        ${s.secondary_logo_url ? `<img src="${s.secondary_logo_url}" style="height:50px;margin-top:6px;border-radius:6px;" onerror="this.style.display='none'"/>` : ""}
      </div>
      <p style="font-size:11px;color:var(--dash-muted);margin-top:-6px;">On postimages.org, use the "Direct link" URL (ends in .jpg/.png), not the page link.</p>
      <button class="btn btn-green" onclick="saveSchoolSettings()">Save</button>
    </div>
    <div class="settings-card" id="set-signatures">
      <div class="settings-card-title">Report Card Signatures (fallback)</div>
      <p style="font-size:12px;color:var(--dash-muted);">These print on report cards only when no staff member currently holds that position in Staff Directory — if a Headmaster/Principal/Admin Officer exists there, their own name and signature (set on their staff profile) are used instead of these.</p>
      <div class="field"><label>Headmaster Name</label><input id="setHeadmasterName" value="${s.headmaster_fallback_name||""}"/></div>
      <div class="field"><label>Headmaster Signature — paste direct image link</label>
        <input id="setHeadmasterSig" value="${s.headmaster_fallback_sig_url||""}" placeholder="https://i.postimg.cc/..."/>
        ${s.headmaster_fallback_sig_url ? `<img src="${s.headmaster_fallback_sig_url}" style="height:36px;margin-top:6px;" onerror="this.style.display='none'"/>` : ""}
      </div>
      <div class="field"><label>Principal Name</label><input id="setPrincipalName" value="${s.principal_fallback_name||""}"/></div>
      <div class="field"><label>Principal Signature — paste direct image link</label>
        <input id="setPrincipalSig" value="${s.principal_fallback_sig_url||""}" placeholder="https://i.postimg.cc/..."/>
        ${s.principal_fallback_sig_url ? `<img src="${s.principal_fallback_sig_url}" style="height:36px;margin-top:6px;" onerror="this.style.display='none'"/>` : ""}
      </div>
      <div class="field"><label>Admin Officer Name</label><input id="setAdminOfficerName" value="${s.admin_officer_fallback_name||""}"/></div>
      <div class="field"><label>Admin Officer Signature — paste direct image link</label>
        <input id="setAdminOfficerSig" value="${s.admin_officer_fallback_sig_url||""}" placeholder="https://i.postimg.cc/..."/>
        ${s.admin_officer_fallback_sig_url ? `<img src="${s.admin_officer_fallback_sig_url}" style="height:36px;margin-top:6px;" onerror="this.style.display='none'"/>` : ""}
      </div>
      <button class="btn btn-green" onclick="saveSignatureSettings()">Save Signatures</button>
    </div>
    <div class="settings-card" id="set-admission">
      <div class="settings-card-title">Registrar Admission Number Scheme</div>
      <p style="font-size:12px;color:var(--dash-muted);">Controls the automatic admission number registrars get when registering a new student (e.g. prefix "SU2026" + next number "27" → next registration gets SU20260027). After a bulk ID reset, update the next number here so new registrations don't collide with existing ones.</p>
      <div class="field"><label>Prefix</label><input id="setAdmPrefix" value="${s.student_admission_prefix||"SU"}"/></div>
      <div class="field"><label>Next Number</label><input id="setAdmNext" type="number" value="${s.student_admission_next_number||1}"/></div>
      <button class="btn btn-green" onclick="saveAdmissionScheme()">Save</button>
      <button class="btn" onclick="syncAdmissionScheme()" style="margin-left:8px;">Sync to Match Existing Numbers</button>
      <div id="admSchemeInfo" style="margin-top:10px;font-size:12px;color:var(--dash-muted);"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Check an Admission Number</div>
      <p style="font-size:12px;color:var(--dash-muted);">Type a number to check if it's already taken before assigning it manually.</p>
      <div class="field" style="display:flex;gap:8px;">
        <input id="admCheckInput" placeholder="e.g. SU20260012" style="flex:1;"/>
        <button class="btn" onclick="checkAdmissionNumber()">Check</button>
      </div>
      <div id="admCheckResult" style="margin-top:8px;font-size:13px;font-weight:800;"></div>
    </div>
    <div class="settings-card" id="set-terms">
      <div class="settings-card-title">Term Dates</div>
      <p style="font-size:12px;color:var(--dash-muted);">These dates print on every report card (Resumption Date, Closing Date, and the auto-calculated Holidays Duration).</p>
      <div class="field"><label>Term</label><select id="setDatesTerm" onchange="loadTermDatesForm()">
        ${state.terms.map(t => `<option value="${t.id}">${t.name}</option>`).join("")}</select></div>
      <div id="termDatesFormBody"></div>
    </div>
    ${renderDashboardThemePicker()}
    <div class="settings-card" id="set-security">
      <div class="settings-card-title">Security PINs</div>
      <div class="field"><label>PIN Type</label><select id="pinType">
        <option value="fees">Fees</option><option value="teachers">Teachers</option>
        <option value="report_card_first_term">Report Card - First Term</option>
        <option value="report_card_second_term">Report Card - Second Term</option>
        <option value="report_card_third_term">Report Card - Third Term</option></select></div>
      <div class="field"><label>New PIN (4 digits)</label><input id="pinValue" maxlength="4"/></div>
      <button class="btn btn-green" onclick="savePin()">Set PIN</button>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Active Term</div>
      <div class="field"><select id="setActiveTerm">${state.terms.map(t => `<option value="${t.id}" ${t.is_active?"selected":""}>${t.name}</option>`).join("")}</select></div>
      <button class="btn btn-green" onclick="setActiveTermFn()">Set Active Term</button>
    </div>`;
  }
  html += `<div class="settings-card" id="set-account">
    <div class="settings-card-title">My Account</div>
    <div class="settings-row"><span>Name</span><span>${state.staff?.full_name || state.student?.full_name || "—"}</span></div>
    ${state.staff ? `<div class="settings-row"><span>My Salary Status (${state.terms.find(t=>t.id===state.currentTermId)?.name||"This Term"})</span><span id="mySalaryStatus">Loading…</span></div>` : ""}
    <div class="field"><label>New Password</label><input id="myNewPassword" type="password"/></div>
    <button class="btn btn-green" onclick="changeMyPassword()">Update Password</button>
  </div>`;
  el.innerHTML = html;
  if (state.role === "admin") { loadTermDatesForm(); loadAdmSchemeInfo(); }
  if (state.staff) loadMySalaryStatus();
}
async function loadMySalaryStatus() {
  const { data } = await sb.from("staff").select("salary_status").eq("id", state.staff.id).single();
  const el = document.getElementById("mySalaryStatus");
  if (!el) return;
  // salary_status is keyed "<termId>_1"/"_2"/"_3" (one bool per month
  // of the term) — matches the Salary Tracker's own format. Derive
  // the same Fully Paid / Partial / Unpaid verdict here.
  const ss = data?.salary_status || {};
  const months = [1,2,3].map(m => ss[`${state.currentTermId}_${m}`] === true);
  const allPaid = months.every(Boolean);
  const nonePaid = months.every(v => !v);
  el.innerHTML = allPaid ? `<span class="badge badge-success">✔ Fully Paid</span>`
    : nonePaid ? `<span class="badge badge-neutral">Not recorded yet</span>`
    : `<span class="badge badge-warning">◐ Partial (${months.filter(Boolean).length}/3 months)</span>`;
}
async function saveAdmissionScheme() {
  const student_admission_prefix = document.getElementById("setAdmPrefix").value.trim();
  const student_admission_next_number = Number(document.getElementById("setAdmNext").value) || 1;
  if (!student_admission_prefix) { alert("Prefix is required."); return; }
  const { error } = await sb.from("school_settings").update({ student_admission_prefix, student_admission_next_number }).eq("id", true);
  if (error) alert(error.message); else { alert("Saved."); Object.assign(state.schoolSettings, { student_admission_prefix, student_admission_next_number }); loadAdmSchemeInfo(); }
}
async function loadAdmSchemeInfo() {
  const s = state.schoolSettings;
  const prefix = s.student_admission_prefix || "SU";
  const next = s.student_admission_next_number || 1;
  const lastIssued = next > 1 ? prefix + String(next - 1).padStart(4, "0") : "none yet";
  const nextNumber = prefix + String(next).padStart(4, "0");
  const { count } = await sb.from("students").select("id", { count: "exact", head: true }).eq("is_active", true);
  document.getElementById("admSchemeInfo").innerHTML =
    `Last number issued by this scheme: <strong>${lastIssued}</strong> · Next will be: <strong>${nextNumber}</strong> · Total active students in school: <strong>${count ?? "—"}</strong>`;
}
async function syncAdmissionScheme() {
  const prefix = document.getElementById("setAdmPrefix").value.trim() || state.schoolSettings.student_admission_prefix || "SU";
  const { data: students } = await sb.from("students").select("admission_no").ilike("admission_no", prefix + "%");
  let maxNum = 0;
  (students || []).forEach(s => {
    const suffix = s.admission_no.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  });
  const nextNumber = maxNum + 1;
  document.getElementById("setAdmNext").value = nextNumber;
  const { error } = await sb.from("school_settings").update({ student_admission_prefix: prefix, student_admission_next_number: nextNumber }).eq("id", true);
  if (error) { alert(error.message); return; }
  Object.assign(state.schoolSettings, { student_admission_prefix: prefix, student_admission_next_number: nextNumber });
  alert(`Synced. Found highest existing number matching "${prefix}" is ${maxNum > 0 ? prefix + String(maxNum).padStart(4,"0") : "none"} — next registration will be ${prefix}${String(nextNumber).padStart(4,"0")}.`);
  loadAdmSchemeInfo();
}
async function checkAdmissionNumber() {
  const val = document.getElementById("admCheckInput").value.trim();
  const result = document.getElementById("admCheckResult");
  if (!val) { result.textContent = ""; return; }
  const { data } = await sb.from("students").select("full_name, classes(name)").eq("admission_no", val).maybeSingle();
  if (data) {
    result.innerHTML = `<span style="color:var(--dash-danger);">Already taken — belongs to ${data.full_name} (${data.classes?.name||"no class"}).</span>`;
  } else {
    result.innerHTML = `<span style="color:var(--dash-green);">Available.</span>`;
  }
}
async function loadTermDatesForm() {
  const termId = document.getElementById("setDatesTerm").value;
  const term = state.terms.find(t => t.id === termId);
  document.getElementById("termDatesFormBody").innerHTML = `
    <div class="field"><label>Resumption Date</label><input id="setResumptionDate" type="date" value="${term?.resumption_date||""}"/></div>
    <div class="field"><label>Closing Date</label><input id="setClosingDate" type="date" value="${term?.closing_date||""}"/></div>
    <button class="btn btn-green" onclick="saveTermDates('${termId}')">Save Term Dates</button>`;
}
async function saveTermDates(termId) {
  const resumption_date = document.getElementById("setResumptionDate").value || null;
  const closing_date = document.getElementById("setClosingDate").value || null;
  if (resumption_date && closing_date && new Date(resumption_date) < new Date(closing_date)) {
    alert("Resumption Date is before Closing Date. Resumption Date here means when students resume AFTER this term's holiday, so it should come after the Closing Date. Please double-check before saving — this is why Holidays Duration would show blank otherwise.");
    return;
  }
  const { error } = await sb.from("terms").update({ resumption_date, closing_date }).eq("id", termId);
  if (error) { alert(error.message); return; }
  alert("Term dates saved.");
  await loadReferenceData();
}
async function saveSchoolSettings() {
  const payload = {
    school_name: document.getElementById("setSchoolName").value,
    motto: document.getElementById("setMotto").value,
    address: document.getElementById("setAddress").value,
    email: document.getElementById("setEmail").value,
    phone: document.getElementById("setPhone").value,
    current_session: document.getElementById("setSession").value,
    primary_website: document.getElementById("setPrimaryWebsite").value,
    secondary_website: document.getElementById("setSecondaryWebsite").value,
    school_logo_url: document.getElementById("setSchoolLogo").value,
    secondary_logo_url: document.getElementById("setSecondaryLogo").value,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("school_settings").update(payload).eq("id", true);
  if (error) alert(error.message); else { alert("Saved."); Object.assign(state.schoolSettings, payload); }
}
async function saveSignatureSettings() {
  const payload = {
    headmaster_fallback_name: document.getElementById("setHeadmasterName").value,
    headmaster_fallback_sig_url: document.getElementById("setHeadmasterSig").value,
    principal_fallback_name: document.getElementById("setPrincipalName").value,
    principal_fallback_sig_url: document.getElementById("setPrincipalSig").value,
    admin_officer_fallback_name: document.getElementById("setAdminOfficerName").value,
    admin_officer_fallback_sig_url: document.getElementById("setAdminOfficerSig").value,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("school_settings").update(payload).eq("id", true);
  if (error) alert(error.message); else { alert("Saved."); Object.assign(state.schoolSettings, payload); }
}
async function savePin() {
  const pin_type = document.getElementById("pinType").value;
  const pin = document.getElementById("pinValue").value.trim();
  if (!/^\d{4}$/.test(pin)) { alert("PIN must be exactly 4 digits."); return; }
  const { data: hash } = await sb.rpc("hash_secret", { p_plain: pin });
  const { error } = await sb.from("security_pins").upsert({ pin_type, pin_hash: hash, updated_by: state.staff.id, updated_at: new Date().toISOString() }, { onConflict: "pin_type" });
  if (error) alert(error.message); else alert("PIN updated.");
}
async function setActiveTermFn() {
  const termId = document.getElementById("setActiveTerm").value;
  await sb.from("terms").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000");
  const { error } = await sb.from("terms").update({ is_active: true }).eq("id", termId);
  if (error) alert(error.message); else { alert("Active term updated."); await loadReferenceData(); }
}
async function changeMyPassword() {
  const password = document.getElementById("myNewPassword").value;
  if (!password || password.length < 4) { alert("Password must be at least 4 characters."); return; }
  const { data: hash } = await sb.rpc("hash_secret", { p_plain: password });
  if (state.staff) {
    await sb.from("staff").update({ password_hash: hash }).eq("id", state.staff.id);
    await provisionAuthAccount("staff", state.staff.id, state.staff.staff_code, password);
  } else if (state.student) {
    await sb.from("students").update({ password_hash: hash }).eq("id", state.student.id);
    await provisionAuthAccount("student", state.student.id, state.student.admission_no, password);
  }
  alert("Password updated. Use your new password next time you sign in.");
}
