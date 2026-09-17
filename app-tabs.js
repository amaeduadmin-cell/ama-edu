// ============================================================
// SIDEBAR + TAB ROUTING
// ============================================================
const NAV_BY_ROLE = {
  admin: [
    ["dashboard","fa-gauge","Dashboard"], ["classes","fa-chalkboard","Classes & Scores"],
    ["masterlist","fa-list","Master List"], ["assignments","fa-diagram-project","Curriculum"],
    ["staffDirectory","fa-user-tie","Staff Directory"], ["students","fa-user-graduate","Students"],
    ["timetable","fa-calendar-days","Timetable"], ["certificates","fa-award","Certificates & Awards"],
    ["analytics","fa-chart-line","Analytics"], ["catracker","fa-list-check","CA Tracker"],
    ["assessments","fa-file-circle-question","Exams & Tests"], ["homework","fa-book-open","Homework"],
    ["announcements","fa-bullhorn","Announcements"],
    ["fees","fa-money-bill","Fees"], ["websites","fa-globe","School Websites"],
    ["importTool","fa-file-import","Bulk Import"], ["classManagement","fa-school","Manage Classes"],
    ["salaryTracker","fa-money-check-dollar","Salary Tracker"],
    ["transferStudents","fa-people-arrows","Transfer Students"], ["scoreControl","fa-lock","Score Control"],
    ["printReports","fa-print","Print Report Cards"], ["unassignedStudents","fa-user-slash","Unassigned Students"],
    ["settings","fa-gear","Settings"],
  ],
  headmaster: [["dashboard","fa-gauge","Dashboard"], ["classes","fa-chalkboard","Classes & Scores"], ["masterlist","fa-list","Master List"], ["certificates","fa-award","Certificates & Awards"], ["assessments","fa-file-circle-question","Exams & Tests"], ["announcements","fa-bullhorn","Announcements"], ["printReports","fa-print","Print Report Cards"], ["settings","fa-gear","My Profile"]],
  principal: [["dashboard","fa-gauge","Dashboard"], ["classes","fa-chalkboard","Classes & Scores"], ["masterlist","fa-list","Master List"], ["certificates","fa-award","Certificates & Awards"], ["assessments","fa-file-circle-question","Exams & Tests"], ["announcements","fa-bullhorn","Announcements"], ["printReports","fa-print","Print Report Cards"], ["settings","fa-gear","My Profile"]],
  bursar: [["fees","fa-money-bill","Fees"], ["settings","fa-gear","My Profile"]],
  teacher: [["dashboard","fa-gauge","Dashboard"], ["classes","fa-chalkboard","My Classes"], ["masterlist","fa-list","Master List"], ["assessments","fa-file-circle-question","Exams & Tests"], ["homework","fa-book-open","Homework"], ["announcements","fa-bullhorn","Announcements"], ["settings","fa-gear","My Profile"]],
  student: [["myReport","fa-file-lines","My Report Card"], ["examsTests","fa-file-circle-question","Exams / Tests"], ["homework","fa-book-open","Homework"], ["announcements","fa-bullhorn","Announcements"], ["settings","fa-gear","My Profile"]],
  registrar: [["registerStudent","fa-user-plus","Register Student"], ["masterlist","fa-list","Master List"], ["settings","fa-gear","My Profile"]],
};
const TAB_TITLES = { dashboard:"Dashboard", classes:"Classes & Scores", masterlist:"Master List", assignments:"Curriculum",
  staffDirectory:"Staff Directory", students:"Students", timetable:"Timetable", certificates:"Certificates & Awards",
  analytics:"Analytics", catracker:"CA Tracker", fees:"Fees", websites:"School Websites", importTool:"Bulk Import",
  classManagement:"Manage Classes", transferStudents:"Transfer Students", scoreControl:"Score Control",
  printReports:"Print Report Cards", unassignedStudents:"Unassigned Students", salaryTracker:"Salary Tracker",
  registerStudent:"Register Student", assessments:"Exams & Tests", examsTests:"Exams / Tests", homework:"Homework", announcements:"Announcements",
  settings:"Settings", myReport:"My Report Card" };

// Visual grouping only — purely cosmetic ordering/labelling in the
// sidebar. Does NOT affect which tabs a role can see (NAV_BY_ROLE
// above still owns that), routes, or permissions in any way.
const NAV_GROUPS = [
  { label: "Overview", tabs: ["dashboard", "analytics", "catracker"] },
  { label: "Academic", tabs: ["classes", "assignments", "timetable", "scoreControl", "printReports"] },
  { label: "Learning", tabs: ["assessments", "examsTests", "homework", "announcements"] },
  { label: "Students", tabs: ["students", "masterlist", "transferStudents", "unassignedStudents", "registerStudent"] },
  { label: "Staff", tabs: ["staffDirectory", "salaryTracker"] },
  { label: "Finance", tabs: ["fees"] },
  { label: "Certificates", tabs: ["certificates"] },
  { label: "Administration", tabs: ["classManagement", "importTool", "websites", "settings"] },
  { label: "My Portal", tabs: ["myReport"] }, // student role only
];

function buildSidebar() {
  // Merge nav tabs across ALL of this person's roles (e.g. an
  // Admin who is also Teacher + Registrar sees every relevant tab
  // for each duty, not just the highest-priority one).
  const seen = new Set();
  const navById = {};
  (state.allRoles || [state.role]).forEach(role => {
    (NAV_BY_ROLE[role] || []).forEach(item => {
      if (!seen.has(item[0])) { seen.add(item[0]); navById[item[0]] = item; }
    });
  });

  // Render in NAV_GROUPS order (visual only) so related items sit
  // together; anything not covered by a group (shouldn't happen,
  // but safe) falls into a trailing ungrouped section.
  let html = "";
  const placed = new Set();
  NAV_GROUPS.forEach(group => {
    const items = group.tabs.map(id => navById[id]).filter(Boolean);
    if (!items.length) return;
    items.forEach(item => placed.add(item[0]));
    html += `<div class="sidebar-group"><div class="sidebar-group-label">${group.label}</div>${sidebarItemsHtml(items)}</div>`;
  });
  const leftover = Object.values(navById).filter(item => !placed.has(item[0]));
  if (leftover.length) html += `<div class="sidebar-group">${sidebarItemsHtml(leftover)}</div>`;

  document.getElementById("sidebarNav").innerHTML = html;
  const displayLabel = r => r.charAt(0).toUpperCase() + r.slice(1);
  const roleText = (state.allRoles && state.allRoles.length > 1)
    ? state.allRoles.map(displayLabel).join(" + ")
    : displayLabel(state.role);
  document.getElementById("topbarRole").textContent = roleText;
  const fullName = state.staff?.full_name || state.student?.full_name || "";
  document.getElementById("topbarGreeting").textContent = fullName ? `Welcome, ${fullName}!` : "";
  initSidebarCollapseState();
}
function sidebarItemsHtml(items) {
  return items.map(([id,icon,label]) =>
    `<a href="#${TAB_TO_ROUTE[id] || ""}" class="sidebar-item" data-tab="${id}" data-label="${label}" onclick="switchTab('${id}');return false;"><span class="si-icon"><i class="fa-solid ${icon}"></i></span><span>${label}</span></a>`
  ).join("");
}

// ---- Sidebar collapse (desktop only; mobile always uses the full
// slide-out drawer regardless of this setting) ----
function initSidebarCollapseState() {
  const collapsed = localStorage.getItem("pariya-sidebar-collapsed") === "1";
  document.getElementById("sidebar").classList.toggle("collapsed", collapsed);
  const btn = document.getElementById("sidebarCollapseBtn");
  if (btn) btn.querySelector("i").className = collapsed ? "fa-solid fa-angles-right" : "fa-solid fa-angles-left";
}
function toggleSidebarCollapse() {
  const sidebar = document.getElementById("sidebar");
  const collapsed = !sidebar.classList.contains("collapsed");
  sidebar.classList.toggle("collapsed", collapsed);
  localStorage.setItem("pariya-sidebar-collapsed", collapsed ? "1" : "0");
  const btn = document.getElementById("sidebarCollapseBtn");
  if (btn) btn.querySelector("i").className = collapsed ? "fa-solid fa-angles-right" : "fa-solid fa-angles-left";
}

// Pure rendering — draws tab `id` into the DOM. Never touches the
// URL/history; that's router.js's job. The public switchTab(id)
// (defined in router.js) is what everything else in the app should
// call — it routes through navigate() and ends up calling this.
function renderTab(id) {
  unsubscribeAllLive();
  document.querySelectorAll(".sidebar-item").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  document.getElementById("topbarTitle").textContent = TAB_TITLES[id] || id;
  toggleSidebar(false);
  const root = document.getElementById("tabRoot");
  root.innerHTML = `<div class="tab-panel active" id="panel-${id}"></div>`;
  const renderers = { dashboard: renderDashboard, classes: renderClasses, masterlist: renderMasterList,
    staffDirectory: renderStaffDirectory, students: renderStudents, fees: renderFees, settings: renderSettings, myReport: renderMyReport,
    assignments: renderAssignments, timetable: renderTimetable, certificates: renderCertificates,
    analytics: renderAnalytics, catracker: renderCaTracker, websites: renderWebsites, importTool: renderImportTool,
    classManagement: renderClassManagement, transferStudents: renderTransferStudents, scoreControl: renderScoreControl,
    printReports: renderPrintReports, registerStudent: renderRegisterStudent, unassignedStudents: renderUnassignedStudents,
    salaryTracker: renderSalaryTracker, assessments: renderAssessmentsAdmin, examsTests: renderExamsTestsStudent,
    homework: renderHomework, announcements: renderAnnouncements };
  (renderers[id] || (() => { document.getElementById(`panel-${id}`).innerHTML = "Coming soon."; }))();
}

// ============================================================
// DASHBOARD
// ============================================================
async function renderDashboard() {
  const el = document.getElementById("panel-dashboard");
  const fullName = state.staff?.full_name || state.student?.full_name || "";
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>${fullName ? "Welcome back, " + fullName.split(" ")[0] + "." : "Welcome."}</h1>
        <p>Here's the current snapshot of Pariya Central Primary.</p>
      </div>
    </div>
    <div class="kpi-grid" id="dashStats"></div>
    <div class="settings-card">
      <div class="settings-card-title">Quick Links</div>
      <div class="quicklinks-grid" id="dashQuickLinks"></div>
    </div>`;
  await loadDashboardStats();
  // Quick Links use the exact same nav entries/routes this role
  // already has in the sidebar — no new destinations, just faster
  // access to a handful of the most common ones from the home page.
  const seen = new Set();
  const nav = [];
  (state.allRoles || [state.role]).forEach(role => {
    (NAV_BY_ROLE[role] || []).forEach(item => { if (!seen.has(item[0]) && item[0] !== "dashboard") { seen.add(item[0]); nav.push(item); } });
  });
  document.getElementById("dashQuickLinks").innerHTML = nav.slice(0, 8).map(([id,icon,label]) =>
    `<a href="#${TAB_TO_ROUTE[id] || ""}" class="quicklink-card" onclick="switchTab('${id}');return false;"><i class="fa-solid ${icon}"></i> ${label}</a>`
  ).join("") || `<p style="color:var(--dash-muted);font-size:12px;">No other sections available for your role.</p>`;
}
async function loadDashboardStats() {
  const el = document.getElementById("dashStats");
  if (!el) return;
  const { count: studentCount } = await sb.from("students").select("id", { count: "exact", head: true }).eq("is_active", true);
  const { count: staffCount } = await sb.from("staff").select("id", { count: "exact", head: true }).eq("is_active", true);
  el.innerHTML = `
    ${kpiCard("fa-user-graduate", studentCount ?? "—", "Active Students")}
    ${kpiCard("fa-user-tie", staffCount ?? "—", "Active Staff")}
    ${kpiCard("fa-chalkboard", state.classes.length, "Classes")}
    ${kpiCard("fa-book", state.subjects.length, "Subjects")}
  `;
}
function statCard(icon, value, label) {
  return `<div class="class-card"><div class="cc-icon"><i class="fa-solid ${icon}"></i></div><div class="cc-name">${value}</div><div class="cc-sub">${label}</div></div>`;
}
function kpiCard(icon, value, label) {
  return `<div class="kpi-card"><div class="kpi-icon"><i class="fa-solid ${icon}"></i></div><div><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div></div>`;
}

// ============================================================
// CLASSES & SCORES
// ============================================================
async function renderClasses() {
  const el = document.getElementById("panel-classes");
  const roles = state.allRoles || [state.role];
  let myClasses = state.classes;
  if (!roles.includes("admin")) {
    const idSet = new Set();
    if (roles.includes("teacher")) {
      const { data: assigns } = await sb.from("class_teacher_subjects").select("class_id").eq("staff_id", state.staff.id);
      (assigns || []).forEach(a => idSet.add(a.class_id));
    }
    if (roles.includes("headmaster") || roles.includes("principal")) {
      state.classes.forEach(c => idSet.add(c.id));
    }
    if (idSet.size) myClasses = state.classes.filter(c => idSet.has(c.id));
  }
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Classes &amp; Scores</h1>
        <p>Select a class to enter or review CA and exam scores for the current term.</p>
      </div>
    </div>
    <div class="card-grid">${myClasses.map(c => `
    <div class="class-card" onclick="openClass('${c.id}')">
      <div class="cc-icon">${c.icon || "📚"}</div>
      <div class="cc-name">${c.name}</div>
      <div class="cc-sub">${c.category.toUpperCase()}${c.is_graduating_class ? " · Graduating" : ""}</div>
    </div>`).join("")}</div>`;
}

async function openClass(classId) {
  unsubscribeAllLive();
  state.currentClass = state.classes.find(c => c.id === classId);
  const el = document.getElementById("tabRoot");
  el.innerHTML = `<div class="tab-panel active">
    <div class="page-header">
      <div class="page-header-text">
        <h1>${state.currentClass.name}</h1>
        <p>Enter CA1 (15), CA2 (15), and Exam (70) scores per subject. Totals, grades, and positions update automatically once saved.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn" onclick="switchTab('classes')"><i class="fa-solid fa-arrow-left"></i> Back to Classes</button>
      </div>
    </div>
    <div class="term-pills" id="termPills"></div>
    <div id="liveUpdateBanner" style="display:none;"></div>
    <div id="classBody"></div>
  </div>`;
  document.getElementById("termPills").innerHTML = state.terms.map(t =>
    `<div class="term-pill ${t.id === state.currentTermId ? "active" : ""}" onclick="setClassTerm('${t.id}')">${t.name}</div>`
  ).join("");
  await loadClassScoreGrid();
  // Scores are the one place "live" needs a safety valve: this grid
  // IS the editable form (per-cell dirty tracking), so a naive
  // reload could wipe someone's unsaved keystrokes. If there's
  // nothing unsaved, refresh silently; otherwise show a banner
  // instead of overwriting their in-progress work.
  const onScoreChange = () => {
    const dirty = document.querySelectorAll('#classBody input[data-dirty="1"]').length;
    if (dirty === 0) { loadClassScoreGrid(); return; }
    const banner = document.getElementById("liveUpdateBanner");
    if (banner) {
      banner.style.display = "block";
      banner.innerHTML = `<div class="badge badge-warning" style="cursor:pointer;margin-bottom:10px;" onclick="loadClassScoreGrid()">🔄 New updates available — you have unsaved changes, click to refresh anyway (unsaved edits will be lost)</div>`;
    }
  };
  subscribeLive("student_scores_changes", onScoreChange);
  subscribeLive("term_period_windows_changes", onScoreChange);
  subscribeLive("subject_score_locks_changes", onScoreChange);
}
function setClassTerm(termId) {
  state.currentTermId = termId;
  document.querySelectorAll(".term-pill").forEach(p => p.classList.remove("active"));
  event.target.classList.add("active");
  loadClassScoreGrid();
}

async function loadClassScoreGrid() {
  const body = document.getElementById("classBody");
  body.innerHTML = "Loading…";
  const classId = state.currentClass.id, termId = state.currentTermId;
  const isNurseryPrimary = state.currentClass.category === "nursery" || state.currentClass.category === "primary";

  const [{ data: students }, { data: classSubjects }, { data: scores }, { data: windows }, { data: liveRanks }] = await Promise.all([
    sb.from("students").select("id, full_name, admission_no").eq("class_id", classId).eq("is_active", true).order("full_name"),
    sb.from("class_subjects").select("subject_id, subjects(id,name,sort_order)").eq("class_id", classId),
    sb.from("student_scores").select("*").eq("class_id", classId).eq("term_id", termId),
    sb.from("term_period_windows").select("*").eq("term_id", termId),
    sb.rpc("get_class_subject_ranks", { p_class_id: classId, p_term_id: termId }),
  ]);
  const rankMap = {}; (liveRanks || []).forEach(r => { rankMap[r.subject_id + "_" + r.student_id] = r.position_label; });

  let subjectList = (classSubjects || []).map(cs => cs.subjects).sort((a,b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  const roles = state.allRoles || [state.role];
  if (roles.includes("teacher") && !roles.some(r => ["admin","headmaster","principal"].includes(r))) {
    const { data: mySubs } = await sb.from("class_teacher_subjects").select("subject_id").eq("staff_id", state.staff.id).eq("class_id", classId);
    const allowed = new Set((mySubs || []).map(s => s.subject_id));
    subjectList = subjectList.filter(s => allowed.has(s.id));
  }

  if (!subjectList.length) { body.innerHTML = `<p style="color:var(--dash-muted)">No subjects assigned to this class yet. ${state.role === "admin" ? "Add some in Curriculum." : ""}</p>`; return; }
  if (!students || !students.length) { body.innerHTML = `<p style="color:var(--dash-muted)">No students in this class yet.</p>`; return; }

  const scoreMap = {};
  (scores || []).forEach(s => { scoreMap[s.student_id + "_" + s.subject_id] = s; });
  const windowMap = {}; (windows || []).forEach(w => { windowMap[w.period] = w.is_open; });

  // Locks + approved unlock exceptions, for this class+term (all subjects at once)
  const { data: locks } = await sb.from("subject_score_locks").select("*").eq("class_id", classId).eq("term_id", termId);
  const lockSet = new Set((locks || []).map(l => l.subject_id + "_" + l.period));
  const { data: approvedReqs } = await sb.from("score_unlock_requests").select("*").eq("class_id", classId).eq("term_id", termId).eq("status", "approved");
  state.currentApprovedExceptions = approvedReqs || [];

  const roles2 = state.allRoles || [state.role];
  const isPrivileged = roles2.some(r => ["admin", "headmaster", "principal"].includes(r));
  function cellEditable(subjectId, period, studentId) {
    if (isPrivileged) return true;
    if (!windowMap[period]) return false;
    const locked = lockSet.has(subjectId + "_" + period);
    if (!locked) return true;
    return (state.currentApprovedExceptions || []).some(r =>
      r.subject_id === subjectId && r.period === period && r.student_ids.includes(studentId));
  }

  const caCols = isNurseryPrimary ? ["ca1","ca2"] : ["ca1","ca2","ca3"];
  const periodOf = { ca1: "ca1", ca2: "ca2", ca3: "ca3", exam_score: "exam" };

  let html = `<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;">`;
  ["ca1","ca2","ca3","exam"].forEach(p => {
    if (p === "ca3" && isNurseryPrimary) return;
    const open = !!windowMap[p];
    html += `<span class="tag" style="${open ? '' : 'opacity:.5;'}">${p.toUpperCase()} ${open ? "🟢 Open" : "🔒 Closed"}</span>`;
  });
  html += `</div>`;

  html += `<div style="overflow-x:auto;"><table class="data-table sticky-head"><thead><tr><th>Student</th>`;
  subjectList.forEach(s => { html += `<th colspan="${caCols.length + 4}">${s.name}</th>`; });
  html += `</tr><tr><th></th>`;
  subjectList.forEach(subj => {
    caCols.forEach(c => {
      const p = periodOf[c];
      const locked = lockSet.has(subj.id + "_" + p);
      html += `<th>${c.toUpperCase()}${locked ? ' <i class="fa-solid fa-lock" title="Locked"></i>' : ""}</th>`;
    });
    const examLocked = lockSet.has(subj.id + "_exam");
    html += `<th>Exam${examLocked ? ' <i class="fa-solid fa-lock" title="Locked"></i>' : ""}</th><th>Total</th><th>Grade</th><th>Pos</th>`;
  });
  html += `</tr></thead><tbody>`;

  students.forEach(stu => {
    html += `<tr><td class="name-cell">${stu.full_name}</td>`;
    subjectList.forEach(subj => {
      const key = stu.id + "_" + subj.id;
      const rec = scoreMap[key] || {};
      caCols.forEach(c => {
        const period = periodOf[c];
        const editable = cellEditable(subj.id, period, stu.id);
        const val = rec[c] === null || rec[c] === undefined ? "" : rec[c];
        html += `<td><input type="number" min="0" max="15" value="${val}" placeholder="—"
          data-stu="${stu.id}" data-subj="${subj.id}" data-field="${c}" onchange="markDirty(this)"
          ${editable ? "" : "disabled"} style="${editable ? "" : "opacity:.45;"}"/></td>`;
      });
      const examEditable = cellEditable(subj.id, "exam", stu.id);
      const examVal = rec.exam_score === null || rec.exam_score === undefined ? "" : rec.exam_score;
      html += `<td><input type="number" min="0" max="70" value="${examVal}" placeholder="—"
        data-stu="${stu.id}" data-subj="${subj.id}" data-field="exam_score" onchange="markDirty(this)"
        ${examEditable ? "" : "disabled"} style="${examEditable ? "" : "opacity:.45;"}"/></td>`;
      const total = (rec.ca1||0) + (rec.ca2||0) + (isNurseryPrimary?0:(rec.ca3||0)) + (rec.exam_score||0);
      const anyEntered = rec.ca1 != null || rec.ca2 != null || rec.ca3 != null || rec.exam_score != null;
      const gradeLetter = anyEntered ? gradeFor(total).grade : "";
      html += `<td style="font-weight:800;">${total || ""}</td>`;
      html += `<td>${gradeLetter ? `<span class="grade-badge grade-${gradeLetter}">${gradeLetter}</span>` : ""}</td>`;
      html += `<td style="font-size:11px;color:var(--dash-muted);">${anyEntered ? (rankMap[subj.id + "_" + stu.id] || "—") : ""}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>
    <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <button class="btn btn-green" onclick="saveClassScores()"><i class="fa-solid fa-floppy-disk"></i> Save Scores</button>
      <button class="btn" onclick="viewClassReportCards()"><i class="fa-solid fa-file-lines"></i> View Report Cards</button>
      <button class="btn" onclick="openBulkScoreImport()"><i class="fa-solid fa-file-import"></i> Bulk Import Scores</button>
      <span id="scoresDirtyBadge" class="badge badge-warning" style="display:none;"></span>
    </div>`;

  // Per-subject submit / request-unlock controls (teachers submit their
  // own subject; anyone assigned can request an unlock for missed students)
  if (roles2.includes("teacher") || isPrivileged) {
    html += `<div class="settings-card" style="margin-top:16px;"><div class="settings-card-title">Submit / Unlock Scores</div>`;
    subjectList.forEach(subj => {
      html += `<div class="settings-row"><span>${subj.name}</span><div style="display:flex;gap:6px;flex-wrap:wrap;">`;
      ["ca1","ca2","ca3","exam"].forEach(p => {
        if (p === "ca3" && isNurseryPrimary) return;
        const locked = lockSet.has(subj.id + "_" + p);
        const open = !!windowMap[p];
        if (!open) return;
        if (!locked) {
          html += `<button class="btn btn-green" style="font-size:10px;padding:5px 9px;" onclick="submitPeriod('${subj.id}','${p}')">Submit ${p.toUpperCase()}</button>`;
        } else {
          html += `<button class="btn" style="font-size:10px;padding:5px 9px;" onclick="openRequestUnlockModal('${subj.id}','${subj.name.replace(/'/g,"&apos;")}','${p}')">Request Unlock (${p.toUpperCase()})</button>`;
          if (isPrivileged) html += `<button class="btn btn-danger" style="font-size:10px;padding:5px 9px;" onclick="forceUnlock('${subj.id}','${p}')">Force Unlock</button>`;
        }
      });
      html += `</div></div>`;
    });
    html += `</div>`;
  }

  body.innerHTML = html;
}

async function submitPeriod(subjectId, period) {
  if (!confirm(`Submit ${period.toUpperCase()} for this subject? Once submitted, it locks immediately and you won't be able to edit it without admin approval.`)) return;
  const { error } = await sb.rpc("submit_score_period", { p_class_id: state.currentClass.id, p_subject_id: subjectId, p_term_id: state.currentTermId, p_period: period });
  if (error) { alert(error.message); return; }
  alert("Submitted and locked.");
  loadClassScoreGrid();
}
async function forceUnlock(subjectId, period) {
  if (!confirm("Force-unlock this subject/period for everyone? Use sparingly.")) return;
  const { error } = await sb.rpc("force_unlock_subject_period", { p_class_id: state.currentClass.id, p_subject_id: subjectId, p_term_id: state.currentTermId, p_period: period });
  if (error) { alert(error.message); return; }
  loadClassScoreGrid();
}
async function openRequestUnlockModal(subjectId, subjectName, period) {
  const { data: students } = await sb.from("students").select("id, full_name").eq("class_id", state.currentClass.id).eq("is_active", true).order("full_name");
  openModal(`<h3>Request Unlock — ${subjectName} (${period.toUpperCase()})</h3>
    <p style="font-size:12px;color:var(--dash-muted);">Select the students who missed this test and need their score added.</p>
    <div class="field" style="max-height:200px;overflow-y:auto;">
      ${(students||[]).map(s => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:6px;">
        <input type="checkbox" value="${s.id}" class="unlockStuCheck"/> ${s.full_name}</label>`).join("")}
    </div>
    <div class="field"><label>Reason</label><input id="unlockReason" placeholder="e.g. Was absent for the test"/></div>
    <button class="btn btn-green" style="width:100%;" onclick="submitUnlockRequest('${subjectId}','${period}')">Send Request to Admin</button>`);
}
async function submitUnlockRequest(subjectId, period) {
  const btn = event.target;
  const studentIds = [...document.querySelectorAll(".unlockStuCheck:checked")].map(c => c.value);
  const reason = document.getElementById("unlockReason").value.trim();
  if (!studentIds.length) { alert("Select at least one student."); return; }
  btn.disabled = true; btn.textContent = "Sending…";
  const { error } = await sb.from("score_unlock_requests").insert({
    class_id: state.currentClass.id, subject_id: subjectId, term_id: state.currentTermId, period,
    staff_id: state.staff.id, student_ids: studentIds, reason,
  });
  if (error) { alert("Couldn't send request: " + error.message); btn.disabled = false; btn.textContent = "Send Request to Admin"; return; }
  closeModal();
  alert("Request sent. The subject stays locked until admin approves.");
}

function markDirty(input) {
  input.dataset.dirty = "1";
  input.style.borderColor = "var(--dash-green)";
  updateDirtyCount();
}
function updateDirtyCount() {
  const badge = document.getElementById("scoresDirtyBadge");
  if (!badge) return;
  const n = document.querySelectorAll('#classBody input[data-dirty="1"]').length;
  badge.textContent = n ? `${n} unsaved change${n === 1 ? "" : "s"}` : "";
  badge.style.display = n ? "inline-flex" : "none";
}

async function saveClassScores() {
  const inputs = document.querySelectorAll('#classBody input[data-dirty="1"]');
  if (!inputs.length) { alert("No changes to save."); return; }
  const byKey = {};
  inputs.forEach(inp => {
    const key = inp.dataset.stu + "_" + inp.dataset.subj;
    byKey[key] = byKey[key] || { student_id: inp.dataset.stu, subject_id: inp.dataset.subj };
    byKey[key][inp.dataset.field] = inp.value === "" ? null : Number(inp.value);
  });
  // Fill any missing fields from the current cell values (not just dirty ones)
  Object.keys(byKey).forEach(key => {
    const [stu, subj] = key.split("_");
    document.querySelectorAll(`#classBody input[data-stu="${stu}"][data-subj="${subj}"]`).forEach(inp => {
      if (!(inp.dataset.field in byKey[key])) {
        byKey[key][inp.dataset.field] = inp.value === "" ? null : Number(inp.value);
      }
    });
  });
  const rows = Object.values(byKey).map(r => ({
    ...r, class_id: state.currentClass.id, term_id: state.currentTermId,
    created_by: state.staff ? state.staff.id : null,
  }));
  const { error } = await sb.from("student_scores").upsert(rows, { onConflict: "student_id,subject_id,term_id" });
  if (error) { alert("Save failed: " + error.message); return; }
  alert("Scores saved. Averages and positions have been recomputed automatically.");
  loadClassScoreGrid();
}

async function viewClassReportCards() {
  const { data: students } = await sb.from("students").select("id, full_name").eq("class_id", state.currentClass.id).eq("is_active", true).order("full_name");
  const opts = (students || []).map(s => `<option value="${s.id}">${s.full_name}</option>`).join("");
  openModal(`<h3>Select Student</h3>
    <div class="field"><select id="rcStudentPick">${opts}</select></div>
    <button class="btn btn-green" style="width:100%;" onclick="closeModal();renderReportCardFor(document.getElementById('rcStudentPick').value)">View Report Card</button>`);
}

// ============================================================
// REPORT CARD RENDERER — reproduces the exact grading logic
// ============================================================
async function renderReportCardFor(studentId) {
  const el = document.getElementById("tabRoot");
  el.innerHTML = `<div class="tab-panel active"><button class="btn no-print" onclick="switchTab('classes')">
    <i class="fa-solid fa-arrow-left"></i> Back</button>
    <div style="margin:14px 0;" id="rcHost">Loading…</div></div>`;
  const html = await buildReportCardHtml(studentId, state.currentTermId);
  document.getElementById("rcHost").innerHTML = html + `
    <div class="no-print" style="text-align:center;margin-top:16px;">
      <button class="btn btn-green" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>
    </div>`;
  renderReportCardQr(studentId);
}

// Age + holiday-duration helpers, matching the original app's flexible
// date parsing and formatting exactly.
function calcAgeFromDob(dobRaw) {
  if (!dobRaw) return null;
  const dob = new Date(dobRaw);
  if (isNaN(dob)) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const beforeBirthday = (today.getMonth() < dob.getMonth()) || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
  if (beforeBirthday) age--;
  return age >= 0 ? age : null;
}
function formatDobWithAge(dobRaw) {
  if (!dobRaw) return "—";
  const age = calcAgeFromDob(dobRaw);
  return age !== null ? `${dobRaw} (${age}yrs)` : dobRaw;
}
function calcHolidaysDuration(resumptionRaw, closingRaw) {
  if (!resumptionRaw || !closingRaw) return "—";
  const resumption = new Date(resumptionRaw), closing = new Date(closingRaw);
  if (isNaN(resumption) || isNaN(closing)) return "—";
  const diffDays = Math.round((resumption - closing) / 86400000);
  if (diffDays < 0) return "—";
  return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
}
function getAnnualRemark(grade) {
  const remarks = {
    A: "Outstanding annual performance! This student has shown exceptional dedication and excellence throughout the entire academic year. Keep soaring higher!",
    B: "Very good annual performance. This student demonstrated commendable effort and consistency throughout the academic year. With a little more push, excellence is within reach.",
    C: "Fair annual performance. The student showed moderate effort across all three terms. Greater focus and consistency will produce significantly better results next year.",
    D: "Weak annual performance. The student needs to significantly improve study habits and dedication. More effort and discipline are required for meaningful progress.",
    E: "Poor annual performance. The student struggled considerably throughout the academic year. Urgent attention, guidance, and parental support are strongly recommended.",
    F: "The student failed to meet the required academic standard for the year. Immediate and sustained intervention is necessary to prevent further regression.",
  };
  return remarks[grade] || "Academic record incomplete for annual assessment.";
}
function getCardCategoryClass(category) {
  const c = (category || "").toLowerCase();
  if (c.includes("nursery")) return "category-nursery";
  if (c.includes("jss")) return "category-jss";
  if (c.includes("ss")) return "category-ss";
  return "category-primary";
}
// value===null/undefined → not entered yet (dashed blank). A genuine
// explicit 0 is shown as "0", matching the nullable-scores model.
function displayScore(value) {
  return (value === null || value === undefined)
    ? '<span style="border-bottom:1px dashed #000;display:inline-block;width:20px"></span>'
    : value;
}

// shared (optional): when building MANY report cards at once (bulk
// print), pass pre-fetched class-wide data here so this function
// makes ZERO extra network round-trips per student. Without it,
// falls back to fetching everything itself (fine for a single card).
async function buildReportCardHtml(studentId, termId, shared = null) {
  let student, summary, scores, term;
  if (shared?.studentsById) {
    student = shared.studentsById[studentId];
    summary = shared.summaryByStudent?.[studentId] || null;
    scores = shared.scoresByStudent?.[studentId] || [];
    term = shared.term;
  } else {
    const results = await Promise.all([
      sb.from("students").select("id, admission_no, full_name, class_id, gender, date_of_birth, guardian_name, guardian_phone, is_active, classes(name,category)").eq("id", studentId).single(),
      sb.from("student_term_summary").select("*").eq("student_id", studentId).eq("term_id", termId).maybeSingle(),
      sb.from("student_scores").select("*, subjects(name, sort_order)").eq("student_id", studentId).eq("term_id", termId),
      sb.from("terms").select("*, sessions(label)").eq("id", termId).single(),
    ]);
    if (results[0].error) console.error("Report card: failed to load student:", results[0].error.message);
    student = results[0].data; summary = results[1].data; scores = results[2].data; term = results[3].data;
  }
  if (!student) return "<p>Student not found.</p>";
  const isNurseryPrimary = student.classes.category === "nursery" || student.classes.category === "primary";
  const settings = state.schoolSettings;

  const totalInClass = shared?.classSize ?? (await sb.rpc("get_class_size", { p_class_id: student.class_id })).data;

  let authorityName, authoritySig, adminOfficerName, adminOfficerSig, wantPosition;
  if (shared?.signatories) {
    ({ authorityName, authoritySig, adminOfficerName, adminOfficerSig, wantPosition } = shared.signatories[isNurseryPrimary ? "primary" : "secondary"]);
  } else {
    wantPosition = isNurseryPrimary ? "Headmaster" : "Principal";
    const { data: sigStaff } = await sb.from("staff").select("full_name, signature_url, positions").contains("positions", [wantPosition]);
    const { data: adminOfficer } = await sb.from("staff").select("full_name, signature_url").contains("positions", ["Admin Officer"]);
    authorityName = (sigStaff && sigStaff[0]?.full_name) || settings[`${wantPosition.toLowerCase()}_fallback_name`] || wantPosition;
    authoritySig = (sigStaff && sigStaff[0]?.signature_url) || settings[`${wantPosition.toLowerCase()}_fallback_sig_url`] || "";
    adminOfficerName = (adminOfficer && adminOfficer[0]?.full_name) || settings.admin_officer_fallback_name || "Admin Officer";
    adminOfficerSig = (adminOfficer && adminOfficer[0]?.signature_url) || settings.admin_officer_fallback_sig_url || "";
  }
  const website = isNurseryPrimary ? (settings.primary_website || "") : (settings.secondary_website || "");

  const schoolLogoHtml = settings.school_logo_url ? `<img src="${settings.school_logo_url}" class="school-logo-img" crossorigin="anonymous" onerror="this.style.opacity='0'">` : "";
  const secondaryLogoHtml = settings.secondary_logo_url ? `<img src="${settings.secondary_logo_url}" class="school-logo-img" crossorigin="anonymous" onerror="this.style.opacity='0'">` : "";
  const authoritySigHtml = authoritySig ? `<img class="sig-img" src="${authoritySig}" crossorigin="anonymous" alt="${wantPosition} Signature">` : "";
  const adminOfficerSigHtml = adminOfficerSig ? `<img class="sig-img" src="${adminOfficerSig}" crossorigin="anonymous" alt="Admin Officer Signature">` : "";

  let subjRows = "";
  let subjNo = 0;
  const orderedScores = (scores || []).slice().sort((a, b) => (a.subjects.sort_order ?? 99) - (b.subjects.sort_order ?? 99));
  for (const s of orderedScores) {
    subjNo++;
    const anyEntered = s.ca1 !== null || s.ca2 !== null || s.ca3 !== null || s.exam_score !== null;
    const total = (s.ca1||0)+(s.ca2||0)+(isNurseryPrimary?0:(s.ca3||0))+(s.exam_score||0);
    const grade = anyEntered ? gradeFor(total).grade : "";
    let posLabel = "—";
    if (anyEntered) {
      if (shared?.ranksMap) {
        posLabel = shared.ranksMap[s.subject_id]?.[studentId] || "—";
      } else {
        const { data: ranks } = await sb.rpc("subject_ranks", { p_class_id: student.class_id, p_term_id: termId, p_subject_id: s.subject_id });
        const mine = (ranks || []).find(r => r.student_id === studentId);
        posLabel = mine ? mine.position_label : "—";
      }
    }
    subjRows += `<tr>
      <td>${subjNo}</td>
      <td style="text-align:left">${s.subjects.name}</td>
      <td>${displayScore(s.ca1)}</td>
      <td>${displayScore(s.ca2)}</td>
      ${isNurseryPrimary ? "" : `<td>${displayScore(s.ca3)}</td>`}
      <td>${displayScore(s.exam_score)}</td>
      <td>${anyEntered ? total : ""}</td>
      <td>${grade}</td>
      <td>${anyEntered ? posLabel : "—"}</td>
      <td>${anyEntered ? subjectRemarkFor(grade) : "ABSENT"}</td>
    </tr>`;
  }

  const avg = summary?.average ?? 0;
  const gr = gradeFor(avg);
  const s3Head = isNurseryPrimary ? "" : `<th>3rd CA (10)</th>`;
  const termLower = (term?.name || "").toLowerCase();
  const isFirstTerm = termLower.includes("first");
  const isSecondTerm = termLower.includes("second");
  const isThirdTerm = termLower.includes("third");
  const posLabelTop = summary?.class_position_label || "—";

  // The summary strip is ALWAYS shown (title switches to "Annual
  // Summary" only on Third Term) — 1st/2nd/3rd Avg columns fill in
  // as terms pass, each showing "—" until that term's own average
  // exists. This mirrors the current term's own total/average/grade/
  // position already shown at the top of the info box — this strip
  // is purely the historical/annual roll-up, so nothing duplicates.
  let firstAvg = null, secondAvg = null, thirdAvg = null;
  if (isFirstTerm) firstAvg = avg;
  else if (isSecondTerm) secondAvg = avg;
  else thirdAvg = avg;

  if (!isFirstTerm) {
    let firstSummary, secondSummary;
    if (shared?.siblingSummaries) {
      firstSummary = shared.siblingSummaries.first?.[studentId];
      secondSummary = shared.siblingSummaries.second?.[studentId];
    } else {
      const { data: session } = await sb.from("sessions").select("id").eq("label", term?.sessions?.label || settings.current_session).maybeSingle();
      const { data: siblingTerms } = await sb.from("terms").select("id, name").eq("session_id", session?.id || term?.session_id);
      const firstTermId = siblingTerms?.find(t => t.name === "First Term")?.id;
      const secondTermId = siblingTerms?.find(t => t.name === "Second Term")?.id;
      const [{ data: fs }, { data: ss }] = await Promise.all([
        firstTermId ? sb.from("student_term_summary").select("average").eq("student_id", studentId).eq("term_id", firstTermId).maybeSingle() : { data: null },
        secondTermId && isThirdTerm ? sb.from("student_term_summary").select("average").eq("student_id", studentId).eq("term_id", secondTermId).maybeSingle() : { data: null },
      ]);
      firstSummary = fs; secondSummary = ss;
    }
    firstAvg = firstSummary?.average ?? null;
    if (isThirdTerm) secondAvg = secondSummary?.average ?? null;
  }

  const fmtAvg = v => (v === null || v === undefined ? "—" : v + "%");
  const summaryTitle = isThirdTerm ? "★ Annual Summary ★" : "★ Term Summary ★";
  const haveAnnual = isThirdTerm && summary?.annual_average != null;
  const annualGrade = haveAnnual ? gradeFor(summary.annual_average).grade : null;

  const annualSummaryHtml = `
    <div class="annual-summary-box">
      <div class="ann-title">${summaryTitle}</div>
      <table>
        <thead><tr><th>1st Avg</th><th>2nd Avg</th><th>3rd Avg</th><th>Ann. Avg</th><th>Grade</th><th>Pos</th></tr></thead>
        <tbody><tr>
          <td>${fmtAvg(firstAvg)}</td>
          <td>${fmtAvg(secondAvg)}</td>
          <td>${fmtAvg(thirdAvg)}</td>
          <td><strong>${haveAnnual ? summary.annual_average + "%" : "—"}</strong></td>
          <td><strong>${haveAnnual ? annualGrade : "—"}</strong></td>
          <td>${haveAnnual ? (summary.annual_position_label || "—") : "—"}</td>
        </tr></tbody>
      </table>
    </div>`;
  const remarkText = haveAnnual ? getAnnualRemark(annualGrade) : gr.remark;

  const contactParts = [];
  if (settings.email) contactParts.push(`<span>✉ ${settings.email}</span>`);
  if (settings.phone) contactParts.push(`<span>☎ ${settings.phone}</span>`);
  if (website) contactParts.push(`<span>Website: <a href="${website}" target="_blank" style="color:inherit;text-decoration:none;">${website}</a></span>`);
  const contactHtml = contactParts.length ? `<div class="rc-contact">${contactParts.join("")}</div>` : "";
  const coatOfArmsHtml = secondaryLogoHtml || `<img src="" alt="" style="opacity:0;">`;

  return `<div class="card" id="rc-card-${studentId}">
    <div class="rc-header">
      <div class="logo-container">${schoolLogoHtml}</div>
      <div class="rc-title-block">
        <h2>${settings.school_name || "Pariya Central Primary"}</h2>
        <p class="rc-address">${settings.address || ""}</p>
        ${contactHtml}
        <div class="rc-motto"><span>MOTTO:</span> ${(settings.motto || "").toUpperCase()}</div>
      </div>
      <div class="rc-photo-box">${coatOfArmsHtml}</div>
    </div>

    <hr class="rc-divider">

    <div class="rc-banner-wrap"><span class="rc-banner">${(term?.name || "").toUpperCase()} REPORT SHEET</span></div>

    <div class="rc-infobox">
      <div class="rc-info-cols">
        <div class="rc-info-col-left">
          <div class="rc-info-line"><span class="rc-label">Name:</span><span class="rc-value">${(student.full_name||"").toUpperCase()}</span></div>
          <div class="rc-info-line"><span class="rc-label">Overall Total:</span><span class="rc-value">${summary?.total_marks ?? "—"}</span></div>
          <div class="rc-info-line"><span class="rc-label">Average:</span><span class="rc-value">${avg}</span></div>
          <div class="rc-info-line"><span class="rc-label">Grade:</span><span class="rc-value">${gr.grade}</span></div>
          <div class="rc-info-line"><span class="rc-label">Position:</span><span class="rc-value"><span class="pos-plain" style="font-size:12px;display:inline;">${posLabelTop}</span></span></div>
        </div>
        <div class="rc-info-col-mid">
          <div class="rc-info-line"><span class="rc-label">Gender:</span><span class="rc-value">${student.gender || "-"}</span></div>
          <div class="rc-info-line"><span class="rc-label">Admission No:</span><span class="rc-value">${student.admission_no || "-"}</span></div>
          <div class="rc-info-line"><span class="rc-label">Class:</span><span class="rc-value">${student.classes.name}</span></div>
          <div class="rc-info-line"><span class="rc-label">No in Class:</span><span class="rc-value">${totalInClass ?? "—"}</span></div>
          <div class="rc-info-line"><span class="rc-label">Term:</span><span class="rc-value">${term?.name || ""}</span></div>
        </div>
        <div class="rc-info-col-right">
          <div class="rc-info-line"><span class="rc-label">Session:</span><span class="rc-value">${term?.sessions?.label || settings.current_session || ""}</span></div>
          <div class="rc-info-line"><span class="rc-label">Date of Birth:</span><span class="rc-value">${formatDobWithAge(student.date_of_birth)}</span></div>
          <div class="rc-info-line"><span class="rc-label">Closing Date:</span><span class="rc-value">${term?.closing_date || "—"}</span></div>
          <div class="rc-info-line"><span class="rc-label">Resumption Date:</span><span class="rc-value">${term?.resumption_date || "—"}</span></div>
          <div class="rc-info-line"><span class="rc-label">Holiday Duration:</span><span class="rc-value">${calcHolidaysDuration(term?.resumption_date, term?.closing_date)}</span></div>
        </div>
      </div>
    </div>

    <div class="rc-perf-banner">Student's Academic Performance (${(student.classes.category||"Primary").toUpperCase()} Category)</div>
    <div class="card-subjects">
      <table>
        <thead>
          <tr>
            <th>S/N</th><th style="text-align:left">Subject</th>
            <th>1st CA (15)</th><th>2nd CA (15)</th>
            ${s3Head}
            <th>Exam (70)</th><th>Total (100)</th><th>Grade</th><th>Subject<br>Position</th><th>Remark</th>
          </tr>
        </thead>
        <tbody>${subjRows}</tbody>
      </table>
    </div>

    ${annualSummaryHtml}

    <div class="rc-remarks-box">
      <div class="rc-remark-line"><span class="rc-label">Class Teacher's Remark:</span>${remarkText}</div>
      <div class="bottom-row">
        <div class="signature-block">
          ${adminOfficerSigHtml}
          <div class="sig-line"></div>
          <div style="font-weight:900;text-align:center;">${adminOfficerName}</div>
          <div class="sig-caption">Admin Officer</div>
        </div>
        <div class="rc-mid-col">
          <div id="qrcode-${studentId}" class="qr-code-container"></div>
          <div class="rc-qr-caption">Scan to verify authenticity</div>
          <div class="rc-mid-date"><span class="rc-label">Date:</span> ${new Date().toLocaleDateString()}</div>
        </div>
        <div class="signature-block">
          ${authoritySigHtml}
          <div class="sig-line"></div>
          <div style="font-weight:900;text-align:center;">${authorityName}</div>
          <div class="sig-caption">${wantPosition}</div>
        </div>
      </div>
    </div>
  </div>`;
}

async function renderReportCardQr(studentId, shared = null) {
  const container = document.getElementById(`qrcode-${studentId}`);
  if (!container || typeof QRCode === "undefined") return;
  let student, summary;
  if (shared?.studentsById) {
    student = shared.studentsById[studentId];
    summary = shared.summaryByStudent?.[studentId] || null;
  } else {
    const results = await Promise.all([
      sb.from("students").select("full_name, class_id, classes(name)").eq("id", studentId).single(),
      sb.from("student_term_summary").select("*").eq("student_id", studentId).eq("term_id", state.currentTermId).maybeSingle(),
    ]);
    student = results[0].data; summary = results[1].data;
  }
  const settings = state.schoolSettings;
  const qrText = `SCHOOL: ${settings.school_name || ""}\nSTUDENT: ${student?.full_name || ""}\nCLASS: ${student?.classes?.name || ""}\n` +
    `TOTAL: ${summary?.total_marks ?? ""}\nAVG: ${summary?.average ?? ""}%\nPOS: ${summary?.class_position_label || ""}\n` +
    `SESSION: ${settings.current_session || ""}\nDATE: ${new Date().toLocaleDateString()}`;
  container.innerHTML = "";
  new QRCode(container, { text: qrText, width: 100, height: 100, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
}

// Short grade-letter remark used ONLY in the subject table's Remark
// column (distinct from the longer Term Summary remark below it).
function subjectRemarkFor(grade) {
  const map = { A: "Excellent", B: "Very Good", C: "Good", D: "Fair", E: "Pass", F: "Fail" };
  return map[grade] || "";
}
function gradeFor(avg) {
  if (avg >= 70) return { grade: "A", remark: "Excellent result, keep the flag flying!" };
  if (avg >= 60) return { grade: "B", remark: "Very good performance, aim even higher!" };
  if (avg >= 50) return { grade: "C", remark: "Good effort, you can still improve." };
  if (avg >= 45) return { grade: "D", remark: "Needs improvement, keep trying." };
  if (avg >= 40) return { grade: "E", remark: "Can do better with guidance and determination." };
  return { grade: "F", remark: "A disappointing result, but not the end. You can still turn things around." };
}

// ============================================================
// STUDENT PORTAL: MY REPORT
// ============================================================
async function renderPrintReports() {
  const el = document.getElementById("panel-printReports");
  let myClasses = state.classes;
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Print Report Cards</h1>
        <p>Select a class and term → Load every active student's report card → Review → Print.</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Print All Report Cards — One Class, One Term</div>
      <p style="font-size:12px;color:var(--dash-muted);">Loads every active student's report card for the class + term below, one per printed page, then opens the print dialog. Nothing else on the page will print — just the report cards.</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <div class="field" style="flex:1;min-width:180px;"><label>1. Class</label><select id="prClassSelect">
          <option value="">— choose —</option>
          ${myClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select></div>
        <div class="field" style="flex:1;min-width:180px;"><label>2. Term</label><select id="prTermSelect">
          ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-green" onclick="loadBulkReportCards()"><i class="fa-solid fa-file-lines"></i> 3. Load Report Cards</button>
        <button class="btn no-print" id="prPrintBtnTop" disabled onclick="window.print()"><i class="fa-solid fa-print"></i> 4. Print All (load first)</button>
      </div>
    </div>
    <div id="prStatus" style="margin:10px 0;color:var(--dash-muted);font-size:13px;"></div>
    <div id="prBulkHost"></div>`;
  // Only re-triggers once a batch has actually been loaded (don't
  // auto-load before the admin has picked a class/term and clicked
  // "Load Report Cards") — keeps whatever's currently on screen in
  // sync with score changes happening elsewhere (e.g. an online test
  // submission syncing a score after this batch was pulled).
  const refreshIfLoaded = () => {
    const host = document.getElementById("prBulkHost");
    if (host && host.innerHTML.trim()) loadBulkReportCards();
  };
  subscribeLive("student_scores_changes", refreshIfLoaded);
  subscribeLive("student_term_summary_changes", refreshIfLoaded);
}

async function loadBulkReportCards() {
  const classId = document.getElementById("prClassSelect").value;
  const termId = document.getElementById("prTermSelect").value;
  const status = document.getElementById("prStatus");
  const host = document.getElementById("prBulkHost");
  const printBtn = document.getElementById("prPrintBtnTop");
  if (!classId) { alert("Choose a class."); return; }
  host.innerHTML = "";
  printBtn.disabled = true; printBtn.classList.remove("btn-green"); printBtn.textContent = "Print All (load first)";
  status.textContent = "Loading students…";

  const { data: students, error: stuErr } = await sb.from("students")
    .select("id, admission_no, full_name, class_id, gender, date_of_birth, guardian_name, guardian_phone, classes(name,category)")
    .eq("class_id", classId).eq("is_active", true).order("full_name");
  if (stuErr) console.error("Bulk print: failed to load students:", stuErr.message);
  if (!students || !students.length) { status.textContent = "No active students in this class."; return; }

  // Fetch everything the WHOLE class needs in a handful of queries,
  // instead of buildReportCardHtml doing it per-student. This is
  // what actually made bulk printing slow before: a 60-student,
  // 15-subject class was making 900+ sequential round-trips just
  // for subject rankings alone, plus hundreds more for signatures,
  // class size, and annual-summary lookups repeated per student.
  status.textContent = "Loading class data…";
  const cls = state.classes.find(c => c.id === classId);
  const isNurseryPrimary = cls.category === "nursery" || cls.category === "primary";
  const wantPosition = isNurseryPrimary ? "Headmaster" : "Principal";
  const settings = state.schoolSettings;

  const [{ data: classSize }, { data: ranks }, { data: sigStaff }, { data: adminOfficer }, { data: term },
    { data: allScores }, { data: allSummaries }] = await Promise.all([
    sb.rpc("get_class_size", { p_class_id: classId }),
    sb.rpc("get_class_subject_ranks", { p_class_id: classId, p_term_id: termId }),
    sb.from("staff").select("full_name, signature_url, positions").contains("positions", [wantPosition]),
    sb.from("staff").select("full_name, signature_url").contains("positions", ["Admin Officer"]),
    sb.from("terms").select("*, sessions(label)").eq("id", termId).single(),
    sb.from("student_scores").select("*, subjects(name, sort_order)").eq("class_id", classId).eq("term_id", termId),
    sb.from("student_term_summary").select("*").eq("class_id", classId).eq("term_id", termId),
  ]);

  const studentsById = {}; students.forEach(s => studentsById[s.id] = s);
  const scoresByStudent = {}; (allScores || []).forEach(s => (scoresByStudent[s.student_id] ||= []).push(s));
  const summaryByStudent = {}; (allSummaries || []).forEach(s => summaryByStudent[s.student_id] = s);
  const ranksMap = {};
  (ranks || []).forEach(r => { (ranksMap[r.subject_id] ||= {})[r.student_id] = r.position_label; });

  const authorityName = (sigStaff && sigStaff[0]?.full_name) || settings[`${wantPosition.toLowerCase()}_fallback_name`] || wantPosition;
  const authoritySig = (sigStaff && sigStaff[0]?.signature_url) || settings[`${wantPosition.toLowerCase()}_fallback_sig_url`] || "";
  const adminOfficerName = (adminOfficer && adminOfficer[0]?.full_name) || settings.admin_officer_fallback_name || "Admin Officer";
  const adminOfficerSig = (adminOfficer && adminOfficer[0]?.signature_url) || settings.admin_officer_fallback_sig_url || "";
  const signatoryInfo = { authorityName, authoritySig, adminOfficerName, adminOfficerSig, wantPosition };
  const signatories = { primary: signatoryInfo, secondary: signatoryInfo };

  // Third Term annual summary needs First/Second term averages for
  // every student — fetch both sibling terms for the WHOLE class
  // at once, not per student.
  let siblingSummaries = null;
  if ((term?.name || "").toLowerCase().includes("third")) {
    const { data: session } = await sb.from("sessions").select("id").eq("label", term?.sessions?.label || settings.current_session).maybeSingle();
    const { data: siblingTerms } = await sb.from("terms").select("id, name").eq("session_id", session?.id || term?.session_id);
    const firstTermId = siblingTerms?.find(t => t.name === "First Term")?.id;
    const secondTermId = siblingTerms?.find(t => t.name === "Second Term")?.id;
    const [{ data: firstRows }, { data: secondRows }] = await Promise.all([
      firstTermId ? sb.from("student_term_summary").select("student_id, average").eq("class_id", classId).eq("term_id", firstTermId) : { data: [] },
      secondTermId ? sb.from("student_term_summary").select("student_id, average").eq("class_id", classId).eq("term_id", secondTermId) : { data: [] },
    ]);
    const first = {}; (firstRows || []).forEach(r => first[r.student_id] = r);
    const second = {}; (secondRows || []).forEach(r => second[r.student_id] = r);
    siblingSummaries = { first, second };
  }

  const shared = { classSize, ranksMap, signatories, siblingSummaries, studentsById, scoresByStudent, summaryByStudent, term };

  let cardsHtml = "";
  for (let i = 0; i < students.length; i++) {
    status.textContent = `Building report card ${i + 1} of ${students.length}…`;
    cardsHtml += await buildReportCardHtml(students[i].id, termId, shared);
  }
  host.innerHTML = cardsHtml;
  status.textContent = `${students.length} report card(s) ready.`;

  // QR codes render after the HTML is in the DOM (must not touch
  // host.innerHTML again after this, since re-serializing would
  // wipe the QR canvases).
  for (const s of students) {
    await renderReportCardQr(s.id, shared);
  }

  printBtn.disabled = false;
  printBtn.classList.add("btn-green");
  printBtn.innerHTML = `<i class="fa-solid fa-print"></i> Print All ${students.length} Report Cards`;
}
// ============================================================
// REGISTRAR: REGISTER STUDENT (auto admission number)
// ============================================================
// ============================================================
// UNASSIGNED STUDENTS — active students with no class set
// ============================================================
async function renderUnassignedStudents() {
  const el = document.getElementById("panel-unassignedStudents");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Unassigned Students</h1>
        <p>These students have no class yet, so they're excluded from Fees totals, report cards, and the Master List until assigned.</p>
      </div>
    </div>
    <div id="unassignedBody">Loading…</div>`;
  await loadUnassignedStudents();
}
async function loadUnassignedStudents() {
  const body = document.getElementById("unassignedBody");
  const { data: students } = await sb.from("students").select("id, full_name, admission_no, gender")
    .is("class_id", null).eq("is_active", true).order("full_name");
  if (!students || !students.length) { body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>None — every active student is assigned to a class.</p></div>`; return; }
  body.innerHTML = `
    <div class="badge badge-warning" style="margin-bottom:12px;"><i class="fa-solid fa-triangle-exclamation"></i> ${students.length} student${students.length===1?"":"s"} awaiting class assignment</div>
    <div style="overflow-x:auto;"><table class="data-table">
    <thead><tr><th>Admission No</th><th>Name</th><th>Gender</th><th>Assign to Class</th></tr></thead>
    <tbody>${students.map(s => `<tr>
      <td>${s.admission_no}</td><td class="name-cell">${s.full_name}</td><td>${s.gender||"-"}</td>
      <td style="display:flex;gap:6px;">
        <select id="ua_cls_${s.id}" style="flex:1;">
          <option value="">— choose class —</option>
          ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}
        </select>
        <button class="btn btn-green" onclick="assignUnassignedStudent('${s.id}')">Assign</button>
      </td>
    </tr>`).join("")}</tbody></table></div>`;
}
async function assignUnassignedStudent(studentId) {
  const classId = document.getElementById(`ua_cls_${studentId}`).value;
  if (!classId) { alert("Choose a class first."); return; }
  const { error } = await sb.from("students").update({ class_id: classId, updated_at: new Date().toISOString() }).eq("id", studentId);
  if (error) { alert(error.message); return; }
  loadUnassignedStudents();
}
async function renderRegisterStudent() {
  const el = document.getElementById("panel-registerStudent");
  // Primary-only school — admin and registrar both see every class.
  const myClasses = state.classes;
  const s = state.schoolSettings;
  const prefix = s.student_admission_prefix || "SU";
  const next = s.student_admission_next_number || 1;
  const lastIssued = next > 1 ? prefix + String(next - 1).padStart(4, "0") : "none yet";
  const nextNumber = prefix + String(next).padStart(4, "0");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Register Student</h1>
        <p>Registers using the school's auto admission-number scheme below.</p>
      </div>
    </div>
    <div class="settings-card" style="background:var(--dash-green-soft);">
      <div style="font-size:12px;">Last admission number issued: <strong id="regLastIssued">${lastIssued}</strong></div>
      <div style="font-size:12px;">This registration will get: <strong id="regNextNumber">${nextNumber}</strong></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Register New Student</div>
      <div class="field"><label>Full Name</label><input id="regStuName"/></div>
      <div class="field"><label>Class</label><select id="regStuClass">
        ${myClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}
      </select></div>
      <div class="field"><label>Gender</label><select id="regStuGender">
        <option>Male</option><option>Female</option></select></div>
      <div class="field"><label>Date of Birth</label><input id="regStuDob" type="date"/></div>
      <button class="btn btn-green" onclick="doRegisterStudent()"><i class="fa-solid fa-user-plus"></i> Register Student</button>
      <div id="regStuResult" style="margin-top:14px;"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Recently Registered (this session)</div>
      <div id="regStuRecent"><p style="color:var(--dash-muted);font-size:12px;">None yet this session.</p></div>
    </div>`;
}
async function doRegisterStudent() {
  const full_name = document.getElementById("regStuName").value.trim();
  const class_id = document.getElementById("regStuClass").value;
  const gender = document.getElementById("regStuGender").value;
  const dob = document.getElementById("regStuDob").value || null;
  if (!full_name || !class_id) { alert("Full name and class are required."); return; }

  const { data, error } = await sb.rpc("register_student", { p_full_name: full_name, p_class_id: class_id, p_gender: gender, p_dob: dob });
  if (error) { alert(error.message); return; }
  const row = data && data[0];
  if (!row) { alert("Registration failed — no admission number returned."); return; }

  const defaultPw = state.schoolSettings.student_default_password || "student123";
  await provisionAuthAccount("student", row.id, row.admission_no, defaultPw);

  document.getElementById("regStuResult").innerHTML = `
    <div style="background:var(--dash-green-soft);border:1px solid var(--dash-green);border-radius:10px;padding:14px;text-align:center;">
      <div style="font-size:11px;color:var(--dash-muted);">Admission Number</div>
      <div style="font-size:22px;font-weight:900;color:var(--dash-accent);">${row.admission_no}</div>
      <div style="font-size:11px;color:var(--dash-muted);margin-top:6px;">Login password: <strong>${defaultPw}</strong> (school default)</div>
    </div>`;

  const recentHost = document.getElementById("regStuRecent");
  if (recentHost.querySelector("p")) recentHost.innerHTML = "";
  const cls = state.classes.find(c => c.id === class_id);
  recentHost.innerHTML = `<div class="settings-row"><span>${full_name} (${cls?.name||""})</span><span><strong>${row.admission_no}</strong></span></div>` + recentHost.innerHTML;

  // Refresh the "last/next number" info box in place (without
  // wiping the Recently Registered list we just built above it).
  const { data: freshSettings } = await sb.from("school_settings").select("*").single();
  if (freshSettings) {
    Object.assign(state.schoolSettings, freshSettings);
    const prefix = freshSettings.student_admission_prefix || "SU";
    const next = freshSettings.student_admission_next_number || 1;
    document.getElementById("regLastIssued").textContent = next > 1 ? prefix + String(next - 1).padStart(4, "0") : "none yet";
    document.getElementById("regNextNumber").textContent = prefix + String(next).padStart(4, "0");
  }

  document.getElementById("regStuName").value = "";
  document.getElementById("regStuDob").value = "";
}
async function renderMyReport() {
  const el = document.getElementById("panel-myReport");
  el.innerHTML = `<div id="myAnnouncementsWidget" style="margin-bottom:16px;"></div><div class="term-pills" id="myTermPills"></div><div id="myReportHost"></div>`;
  renderAnnouncementsWidget("myAnnouncementsWidget");
  document.getElementById("myTermPills").innerHTML = state.terms.map(t =>
    `<div class="term-pill ${t.id===state.currentTermId?'active':''}" onclick="loadMyReport('${t.id}')">${t.name}</div>`).join("");
  await loadMyReport(state.currentTermId);
}
async function loadMyReport(termId) {
  state.currentTermId = termId;
  document.querySelectorAll("#myTermPills .term-pill").forEach(p => p.classList.remove("active"));
  if (event) event.target.classList.add("active");
  const host = document.getElementById("myReportHost");
  host.innerHTML = "Loading…";
  const { data: summary } = await sb.from("student_term_summary").select("fees_status").eq("student_id", state.student.id).eq("term_id", termId).maybeSingle();
  if (!summary || summary.fees_status !== "paid") {
    const { data: fp } = await sb.from("fee_payments").select("amount_paid").eq("student_id", state.student.id).eq("term_id", termId).maybeSingle();
    const { data: fs } = await sb.from("fee_structure").select("expected_amount").eq("class_id", state.student.class_id).maybeSingle();
    host.innerHTML = `<div class="settings-card">
      <h3 style="color:var(--dash-danger);">Fees Not Paid</h3>
      <p>Your report card for this term is locked until your school fees are settled.</p>
      <p>Expected: ₦${fs?.expected_amount ?? "—"} · Paid: ₦${fp?.amount_paid ?? 0}</p>
      <p style="color:var(--dash-muted);font-size:12px;">Please contact the school bursar to complete payment.</p>
    </div>`;
    return;
  }
  const { data: myStanding } = await sb.from("student_term_summary").select("class_position").eq("student_id", state.student.id).eq("term_id", termId).maybeSingle();
  const topperBanner = myStanding?.class_position === 1 ? `
    <div class="settings-card" style="text-align:center;background:var(--dash-green-soft);border-color:var(--dash-green);">
      <div style="font-size:28px;">🏆</div>
      <div style="font-weight:900;color:var(--dash-accent);font-size:15px;">Congratulations! You are 1st in your class this term.</div>
      <div style="font-size:12px;color:var(--dash-muted);margin-top:4px;">See Settings → nothing to do here, just keep it up! Ask your admin about a Best Student certificate.</div>
    </div>` : "";
  host.innerHTML = topperBanner + await buildReportCardHtml(state.student.id, termId) + `
    <div class="no-print" style="text-align:center;margin-top:16px;">
      <button class="btn btn-green" onclick="window.print()"><i class="fa-solid fa-print"></i> Print / Download</button>
    </div>`;
  renderReportCardQr(state.student.id);
}
