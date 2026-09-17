// ============================================================
// SCHOOL WEBSITES / CREDENTIAL VAULT
// ============================================================
async function renderWebsites() {
  const el = document.getElementById("panel-websites");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>School Websites</h1>
        <p>Credential vault for school-related web accounts. Passwords are hidden by default.</p>
      </div>
    </div>
    <div class="settings-card">
    <div class="settings-card-title">Add Entry</div>
    <div class="field"><label>Function / Name</label><input id="wsFunc" placeholder="e.g. School Portal, Domain Registrar"/></div>
    <div class="field"><label>URL</label><input id="wsUrl"/></div>
    <div class="field"><label>Username</label><input id="wsUser"/></div>
    <div class="field"><label>Password</label><input id="wsPass" type="password"/></div>
    <button class="btn btn-green" onclick="addWebsiteEntry()">Add</button>
  </div>
  <div id="wsList"></div>`;
  await loadWebsitesList();
}
async function loadWebsitesList() {
  const { data: rows } = await sb.from("school_websites").select("*").order("created_at", { ascending: false });
  document.getElementById("wsList").innerHTML = (rows||[]).map(r => `
    <div class="settings-card">
      <div class="settings-row"><strong>${r.function_name}</strong><button class="btn btn-danger" onclick="deleteWebsiteEntry('${r.id}')">Delete</button></div>
      <div class="settings-row"><span>URL</span><span>${r.url ? `<a href="${r.url}" target="_blank">${r.url}</a>` : "—"}</span></div>
      <div class="settings-row"><span>Username</span><span>${r.username || "—"}</span></div>
      <div class="settings-row"><span>Password</span><span style="display:flex;align-items:center;gap:8px;">
        <span id="wspass-${r.id}">${r.password_encrypted ? "••••••••" : "—"}</span>
        ${r.password_encrypted ? `<button class="btn no-print" style="padding:2px 8px;font-size:10px;" onclick="toggleWebsitePassword('${r.id}','${String(r.password_encrypted).replace(/'/g,"&apos;")}',this)"><i class="fa-solid fa-eye"></i></button>` : ""}
      </span></div>
    </div>`).join("") || `<div class="empty-state"><i class="fa-solid fa-vault"></i><p>No entries yet.</p></div>`;
}
function toggleWebsitePassword(id, plain, btn) {
  const span = document.getElementById(`wspass-${id}`);
  const showing = span.dataset.showing === "1";
  span.textContent = showing ? "••••••••" : plain;
  span.dataset.showing = showing ? "0" : "1";
  btn.innerHTML = showing ? `<i class="fa-solid fa-eye"></i>` : `<i class="fa-solid fa-eye-slash"></i>`;
}
async function addWebsiteEntry() {
  const function_name = document.getElementById("wsFunc").value.trim();
  const url = document.getElementById("wsUrl").value.trim();
  const username = document.getElementById("wsUser").value.trim();
  const password_encrypted = document.getElementById("wsPass").value;
  if (!function_name) { alert("Please give this entry a name."); return; }
  const { error } = await sb.from("school_websites").insert({ function_name, url, username, password_encrypted });
  if (error) { alert(error.message); return; }
  ["wsFunc","wsUrl","wsUser","wsPass"].forEach(id => document.getElementById(id).value = "");
  await loadWebsitesList();
}
async function deleteWebsiteEntry(id) {
  if (!confirm("Delete this entry?")) return;
  await sb.from("school_websites").delete().eq("id", id);
  await loadWebsitesList();
}

// ============================================================
// BULK IMPORT — one-time migration tool for existing Google
// Sheets data (students & staff). Paste CSV, preview, then
// import. Expected headers (case-insensitive):
//   Students: admission_no, full_name, class_name, gender, date_of_birth, guardian_name, guardian_phone, password (optional — falls back to school default)
//   Staff:    staff_code, full_name, phone, email, positions (semicolon-separated), password
// ============================================================
async function renderImportTool() {
  const el = document.getElementById("panel-importTool");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Bulk Import</h1>
        <p>Paste CSV → Preview → Import. Creates working logins automatically for every row.</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Import Students</div>
      <p style="font-size:12px;color:var(--dash-muted);">CSV headers: admission_no, full_name, class_name, gender, date_of_birth (YYYY-MM-DD), guardian_name, guardian_phone, password (optional — leave blank to use the school default password)</p>
      <textarea id="importStudentsCsv" rows="8" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:10px;font-family:monospace;font-size:12px;" placeholder="admission_no,full_name,class_name,gender,date_of_birth,guardian_name,guardian_phone
P3-001,Aisha Bello,Primary 3,Female,2016-04-12,Mr Bello,08012345678"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn" onclick="previewImport('students')">Preview</button>
        <button class="btn btn-green" onclick="runImport('students')">Import</button>
      </div>
      <div id="importStudentsPreview" style="margin-top:12px;"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Import Staff</div>
      <p style="font-size:12px;color:var(--dash-muted);">CSV headers: staff_code, full_name, phone, email, positions (semicolon-separated, e.g. "Teacher"), password</p>
      <textarea id="importStaffCsv" rows="6" style="width:100%;background:var(--dash-surface);color:var(--dash-text);border:1px solid var(--dash-border);border-radius:8px;padding:10px;font-family:monospace;font-size:12px;" placeholder="staff_code,full_name,phone,email,positions,password
T001,Musa Ibrahim,08099998888,musa@example.com,Teacher,ChangeMe123"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn" onclick="previewImport('staff')">Preview</button>
        <button class="btn btn-green" onclick="runImport('staff')">Import</button>
      </div>
      <div id="importStaffPreview" style="margin-top:12px;"></div>
    </div>`;
}

function parseCsv(text) {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cells = line.split(",").map(c => c.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = cells[i] || "");
    return obj;
  });
}

function previewImport(kind) {
  const raw = document.getElementById(kind === "students" ? "importStudentsCsv" : "importStaffCsv").value;
  const rows = parseCsv(raw);
  const host = document.getElementById(kind === "students" ? "importStudentsPreview" : "importStaffPreview");
  if (!rows.length) { host.innerHTML = "<p style='color:var(--dash-muted);'>Nothing to preview.</p>"; return; }
  const cols = Object.keys(rows[0]);
  host.innerHTML = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0,10).map(r => `<tr>${cols.map(c=>`<td>${r[c]}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p style="font-size:12px;color:var(--dash-muted);">${rows.length} row(s) total${rows.length>10?" (showing first 10)":""}.</p>`;
}

async function runImport(kind) {
  const raw = document.getElementById(kind === "students" ? "importStudentsCsv" : "importStaffCsv").value;
  const rows = parseCsv(raw);
  if (!rows.length) { alert("Paste some CSV data first."); return; }
  if (!confirm(`Import ${rows.length} ${kind}? This will create new records.`)) return;

  let success = 0, failed = 0, errors = [];
  if (kind === "students") {
    for (const r of rows) {
      const cls = state.classes.find(c => c.name.toLowerCase() === (r.class_name||"").toLowerCase());
      if (!r.admission_no || !r.full_name) { failed++; errors.push(`Missing admission_no/full_name for row: ${JSON.stringify(r)}`); continue; }
      const { data: newStudent, error } = await sb.from("students").insert({
        admission_no: r.admission_no, full_name: r.full_name, class_id: cls ? cls.id : null,
        gender: r.gender || null, date_of_birth: r.date_of_birth || null,
        guardian_name: r.guardian_name || null, guardian_phone: r.guardian_phone || null,
      }).select("id, admission_no").single();
      if (error) { failed++; errors.push(`${r.admission_no}: ${error.message}`); continue; }
      // Always provision a real login account, using the row's own
      // password column if given, otherwise the current school
      // default — without this, imported students silently have no
      // way to sign in at all. Caught explicitly so a provisioning
      // failure is reported per-row instead of aborting the loop.
      const effectivePassword = r.password || state.schoolSettings.student_default_password || "student123";
      try {
        const prov = await provisionAuthAccountSilent("student", newStudent.id, newStudent.admission_no, effectivePassword);
        if (prov.error) { errors.push(`${r.admission_no}: saved, but login setup failed — ${prov.error}`); }
      } catch (e) {
        errors.push(`${r.admission_no}: saved, but login setup failed — ${e.message || e}`);
      }
      success++;
    }
  } else {
    for (const r of rows) {
      if (!r.staff_code || !r.full_name || !r.password) { failed++; errors.push(`Missing required field for row: ${JSON.stringify(r)}`); continue; }
      const positions = (r.positions || "Teacher").split(";").map(p => p.trim()).filter(Boolean);
      const { data: hash } = await sb.rpc("hash_secret", { p_plain: r.password });
      const { data: staffRow, error } = await sb.from("staff").insert({
        staff_code: r.staff_code, full_name: r.full_name, phone: r.phone || null, email: r.email || null,
        positions, is_admin: positions.includes("Admin"), password_hash: hash,
      }).select("id, staff_code").single();
      if (error) { failed++; errors.push(`${r.staff_code}: ${error.message}`); continue; }
      try {
        const prov = await provisionAuthAccountSilent("staff", staffRow.id, staffRow.staff_code, r.password);
        if (prov.error) { errors.push(`${r.staff_code}: saved, but login setup failed — ${prov.error}`); }
      } catch (e) {
        errors.push(`${r.staff_code}: saved, but login setup failed — ${e.message || e}`);
      }
      success++;
    }
  }
  alert(`Import complete: ${success} succeeded, ${failed} failed.${errors.length ? "\n\nErrors:\n" + errors.slice(0,5).join("\n") : ""}`);
}
