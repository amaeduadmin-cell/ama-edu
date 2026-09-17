// ============================================================
// ANNOUNCEMENTS — teacher/headmaster/principal/admin post, targeted
// by class/subject/category/all; students see only what's targeted
// to them (enforced by RLS against their real class/category, never
// a hardcoded student list).
// ============================================================

async function renderAnnouncements() {
  if (state.student) return renderAnnouncementsStudent();
  return renderAnnouncementsStaff();
}

// ---------------- STAFF ----------------
async function renderAnnouncementsStaff() {
  const el = document.getElementById("panel-announcements");
  const canPostBroad = (state.allRoles||[state.role]).some(r => ["admin","headmaster","principal"].includes(r));
  const pairs = canPostBroad ? null : await getMyAssessableClassSubjects();
  const myClasses = canPostBroad ? state.classes : [...new Map((pairs||[]).map(p => [p.class_id, { id: p.class_id, name: p.class_name }])).values()];
  const mySubjects = canPostBroad ? state.subjects : [...new Map((pairs||[]).map(p => [p.subject_id, { id: p.subject_id, name: p.subject_name }])).values()];
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Announcements</h1>
        <p>Post notices to a class, subject, category, or everyone.</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">New Announcement</div>
      <div class="field"><label>Title</label><input id="anTitle" placeholder="e.g. Mathematics test moved to Friday"/></div>
      <div class="field"><label>Content</label><textarea id="anContent" rows="3" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:8px;"></textarea></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div class="field" style="flex:1;min-width:180px;"><label>Posted As</label>
          <select id="anLevel">
            <option value="teacher">Teacher Announcement</option>
            ${canPostBroad ? `<option value="headmaster">Headmaster Announcement (Nursery + Primary students)</option>
            <option value="principal">Principal Announcement (JSS + SS students)</option>
            <option value="admin">Admin Announcement</option>` : ""}
          </select></div>
        <div class="field" style="flex:1;min-width:180px;"><label>Audience</label>
          <select id="anTargetType" onchange="toggleAnnouncementTargetFields()">
            <option value="class">${canPostBroad ? "Specific Class" : "My Class"}</option>
            <option value="subject">${canPostBroad ? "Specific Subject" : "My Subject"}</option>
            ${canPostBroad ? `<option value="all">All Students</option>
            <option value="nursery">Nursery Only</option><option value="primary">Primary Only</option>
            <option value="jss">JSS Only</option><option value="ss">SS Only</option>` : ""}
          </select></div>
      </div>
      <div id="anTargetClassField" class="field"><label>Class</label>
        <select id="anTargetClass">${myClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join("") || `<option value="">No classes assigned to you yet</option>`}</select></div>
      <div id="anTargetSubjectField" class="field" style="display:none;"><label>Subject</label>
        <select id="anTargetSubject">${mySubjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("") || `<option value="">No subjects assigned to you yet</option>`}</select></div>
      <button class="btn btn-green" onclick="postAnnouncement()"><i class="fa-solid fa-bullhorn"></i> Post Announcement</button>
    </div>
    <div class="settings-card-title" style="margin:18px 0 10px;">All Announcements</div>
    <div id="anListHost"></div>`;
  await loadAnnouncementsStaffList();
}
function toggleAnnouncementTargetFields() {
  const t = document.getElementById("anTargetType").value;
  document.getElementById("anTargetClassField").style.display = t === "class" ? "block" : "none";
  document.getElementById("anTargetSubjectField").style.display = t === "subject" ? "block" : "none";
}
async function postAnnouncement() {
  const title = document.getElementById("anTitle").value.trim();
  const content = document.getElementById("anContent").value.trim();
  if (!title || !content) { alert("Title and content are required."); return; }
  const announcement_level = document.getElementById("anLevel").value;
  const target_type = document.getElementById("anTargetType").value;
  const target_class_id = target_type === "class" ? document.getElementById("anTargetClass").value : null;
  const target_subject_id = target_type === "subject" ? document.getElementById("anTargetSubject").value : null;
  const { error } = await sb.from("announcements").insert({
    title, content, sender_staff_id: state.staff.id, announcement_level, target_type, target_class_id, target_subject_id,
  });
  if (error) { alert(error.message); return; }
  document.getElementById("anTitle").value = "";
  document.getElementById("anContent").value = "";
  await loadAnnouncementsStaffList();
}
async function loadAnnouncementsStaffList() {
  const host = document.getElementById("anListHost");
  const { data: rows } = await sb.from("announcements").select("*, staff(full_name), classes(name), subjects(name)").order("created_at", { ascending: false }).limit(50);
  if (!rows || !rows.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-bullhorn"></i><p>No announcements posted yet.</p></div>`; return; }
  host.innerHTML = rows.map(r => `
    <div class="settings-card">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div style="font-weight:800;">${r.title}</div>
        <div style="display:flex;gap:5px;">
          <span class="badge badge-info">${announcementLevelLabel(r.announcement_level)}</span>
          <span class="badge badge-neutral">${announcementTargetLabel(r)}</span>
        </div>
      </div>
      <p style="font-size:13px;margin:8px 0;">${r.content}</p>
      <div style="font-size:11px;color:var(--dash-muted);display:flex;justify-content:space-between;">
        <span>${r.staff?.full_name || "—"} · ${new Date(r.created_at).toLocaleString()}</span>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px;" onclick="deleteAnnouncement('${r.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`).join("");
}
function announcementLevelLabel(l) { return { teacher:"Teacher", headmaster:"Headmaster", principal:"Principal", admin:"Admin" }[l] || l; }
function announcementTargetLabel(r) {
  if (r.target_type === "all") return "All Students";
  if (r.target_type === "class") return r.classes?.name || "Class";
  if (r.target_type === "subject") return r.subjects?.name || "Subject";
  return r.target_type.toUpperCase();
}
async function deleteAnnouncement(id) {
  if (!confirm("Delete this announcement?")) return;
  const { error } = await sb.from("announcements").delete().eq("id", id);
  if (error) alert(error.message); else loadAnnouncementsStaffList();
}

// ---------------- STUDENT ----------------
async function renderAnnouncementsStudent() {
  const el = document.getElementById("panel-announcements");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Announcements</h1>
        <p>Notices posted to you, your class, or the whole school.</p>
      </div>
    </div>
    <div id="anStudentBody">Loading…</div>`;
  await loadAnnouncementsForStudent("anStudentBody", 100);
}
async function loadAnnouncementsForStudent(hostId, limit) {
  const host = document.getElementById(hostId);
  const [{ data: rows }, { data: reads }] = await Promise.all([
    sb.from("announcements").select("*, staff(full_name)").order("publish_at", { ascending: false }).limit(limit),
    sb.from("announcement_reads").select("announcement_id").eq("student_id", state.student.id),
  ]);
  const readSet = new Set((reads||[]).map(r => r.announcement_id));
  if (!rows || !rows.length) { host.innerHTML = `<div class="empty-state"><i class="fa-solid fa-bullhorn"></i><p>No announcements right now.</p></div>`; return; }
  host.innerHTML = rows.map(r => {
    const isRead = readSet.has(r.id);
    return `<div class="settings-card" style="${isRead?"":"border-left:3px solid var(--dash-green);"}">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div style="font-weight:800;">${r.title}</div>
        ${!isRead ? `<span class="badge badge-success">New</span>` : ""}
      </div>
      <p style="font-size:13px;margin:8px 0;">${r.content}</p>
      <div style="font-size:11px;color:var(--dash-muted);">${r.staff?.full_name || "School"} · ${new Date(r.publish_at).toLocaleDateString()}</div>
      ${!isRead ? `<button class="btn no-print" style="margin-top:8px;padding:3px 9px;font-size:10px;" onclick="markAnnouncementRead('${r.id}', this)">Mark as read</button>` : ""}
    </div>`;
  }).join("");
}
async function markAnnouncementRead(announcementId, btn) {
  await sb.from("announcement_reads").insert({ announcement_id: announcementId, student_id: state.student.id });
  btn.closest(".settings-card").style.borderLeft = "none";
  btn.remove();
  const badge = btn.parentElement.querySelector(".badge-success");
  if (badge) badge.remove();
}

// ---------------- DASHBOARD WIDGET (used by renderMyReport) ----------------
async function renderAnnouncementsWidget(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const { data: rows } = await sb.from("announcements").select("id, title, content, publish_at, staff(full_name)").order("publish_at", { ascending: false }).limit(3);
  if (!rows || !rows.length) { host.style.display = "none"; return; }
  host.innerHTML = `
    <div class="settings-card-title">📢 Announcements</div>
    ${rows.map(r => `<div style="padding:8px 0;border-bottom:1px solid var(--dash-border);">
      <div style="font-weight:800;font-size:13px;">${r.title}</div>
      <div style="font-size:12px;color:var(--dash-muted);">${r.content.slice(0,90)}${r.content.length>90?"…":""}</div>
      <div style="font-size:10px;color:var(--dash-muted);margin-top:2px;">${r.staff?.full_name || "School"} · ${new Date(r.publish_at).toLocaleDateString()}</div>
    </div>`).join("")}
    <button class="btn no-print" style="margin-top:10px;" onclick="switchTab('announcements')">View All Announcements</button>`;
}
