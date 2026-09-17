// ============================================================
// PARIYA CENTRAL PRIMARY — REPORT CARD SYSTEM — Supabase Edition
// ============================================================

const SUPABASE_URL = "https://bjwjjacqzvfxyjxkazgo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tfC5fbjTZVT5kE1q18K7Og_cyFWNTkw";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "pariya-sms-auth" }
});

const state = {
  session: null,
  role: null,        // 'admin' | 'headmaster' | 'principal' | 'bursar' | 'teacher' | 'student'
  staff: null,        // staff row (if staff)
  student: null,      // student row (if student)
  classes: [],
  subjects: [],
  terms: [],
  sessions: [],
  activeTerm: null,
  schoolSettings: null,
  currentClass: null,
  currentTermId: null,
};

document.getElementById("heroYear").textContent = new Date().getFullYear();

// ---------------------------------------------------------------
// LOGIN MODE TOGGLE
// ---------------------------------------------------------------
function setLoginMode(mode) {
  document.querySelectorAll(".login-tab").forEach(t => t.classList.toggle("active", t.dataset.mode === mode));
  document.getElementById("staffLoginForm").style.display = mode === "staff" ? "block" : "none";
  document.getElementById("studentLoginForm").style.display = mode === "student" ? "block" : "none";
  hideLoginError();
}
function showLoginError(msg) {
  const el = document.getElementById("loginError");
  el.textContent = msg; el.style.display = "block";
}
function hideLoginError() { document.getElementById("loginError").style.display = "none"; }

// Populate the student-login class dropdown from public classes list (no auth needed to view names)
async function loadClassOptionsForLogin() {
  const { data } = await sb.from("classes").select("id,name").order("sort_order");
  const sel = document.getElementById("stuClass");
  sel.innerHTML = (data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}
loadClassOptionsForLogin();

// Show school name + logo on the login screen before anyone signs
// in (school_settings is publicly readable for exactly this reason).
(async function loadLoginBranding() {
  const { data: settings } = await sb.from("school_settings").select("school_name, school_logo_url").maybeSingle();
  if (!settings) return;
  if (settings.school_name) document.getElementById("loginSchoolName").textContent = settings.school_name;
  if (settings.school_logo_url) {
    const img = document.getElementById("loginSchoolLogo");
    img.src = settings.school_logo_url;
    img.style.display = "block";
  }
})();

// ---------------------------------------------------------------
// AUTH: STAFF LOGIN
// ---------------------------------------------------------------
async function handleStaffLogin(e) {
  e.preventDefault();
  hideLoginError();
  const btn = document.getElementById("staffLoginBtn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const staff_code = document.getElementById("staffCode").value.trim();
    const password = document.getElementById("staffPassword").value;
    const { data, error } = await sb.rpc("verify_staff_password", { p_staff_code: staff_code, p_password: password });
    if (error || !data || !data.length) throw new Error("Invalid Staff ID or password.");
    const { shadow_email } = data[0];
    const { error: signInErr } = await sb.auth.signInWithPassword({ email: shadow_email, password: shadowPasswordFor(staff_code, password) });
    if (signInErr) throw new Error("Login failed: " + signInErr.message + " (code: " + (signInErr.code || signInErr.status || "unknown") + ")");
    await bootAfterLogin();
  } catch (err) {
    showLoginError(err.message || "Login failed.");
  } finally {
    btn.disabled = false; btn.textContent = "Sign In";
  }
}

// ---------------------------------------------------------------
// AUTH: STUDENT LOGIN
// ---------------------------------------------------------------
async function handleStudentLogin(e) {
  e.preventDefault();
  hideLoginError();
  const btn = document.getElementById("studentLoginBtn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const admission_no = document.getElementById("stuAdm").value.trim();
    const class_id = document.getElementById("stuClass").value;
    const password = document.getElementById("stuPassword").value;
    const { data, error } = await sb.rpc("verify_student_password", { p_admission_no: admission_no, p_class_id: class_id, p_password: password });
    if (error || !data || !data.length) throw new Error("Invalid Admission Number, Class, or Password.");
    const { shadow_email } = data[0];
    const { error: signInErr } = await sb.auth.signInWithPassword({ email: shadow_email, password: shadowPasswordFor(admission_no, password) });
    if (signInErr) throw new Error("Login failed: " + signInErr.message + " (code: " + (signInErr.code || signInErr.status || "unknown") + ")");
    await bootAfterLogin();
  } catch (err) {
    showLoginError(err.message || "Login failed.");
  } finally {
    btn.disabled = false; btn.textContent = "Sign In";
  }
}

// NOTE on shadow auth accounts:
// Real Supabase Auth requires a matching auth.users row with a real
// password for signInWithPassword to work. Each staff/student's
// shadow auth account password is derived deterministically from
// their staff_code/admission_no + the actual password they typed,
// so it never needs to be stored separately — the admin creation
// flow (see admin > Staff/Students > "Create login") sets the
// Supabase Auth password to this exact same derived value at
// account-creation time. If you change a staff/student's password
// in the app, both the `password_hash` column AND the shadow auth
// account password are updated together (see savePassword()).
function shadowPasswordFor(id, plain) {
  return "pariya_" + id + "_" + plain;
}

async function signOut() {
  await sb.auth.signOut();
  state.session = null;
  // Hash routes ("#/login") never depend on server config, so no
  // special-casing needed here anymore — this always resolves
  // correctly on any static host.
  location.hash = "/login";
  location.reload();
}

// ---------------------------------------------------------------
// BOOT SEQUENCE (after login OR on page reload with a live session)
// ---------------------------------------------------------------
async function bootAfterLogin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { state.session = null; renderRoute(); return; }
  state.session = session;

  const { data: roleRows, error: roleErr } = await sb.rpc("current_app_role");
  if (roleErr || !roleRows || !roleRows.length || roleRows[0].role === "anonymous") {
    showLoginError("Account not recognised. Contact your admin.");
    state.session = null;
    await sb.auth.signOut();
    navigate("/login", { push: false });
    return;
  }
  const r = roleRows[0];
  state.role = r.role;
  state.allRoles = r.all_roles && r.all_roles.length ? r.all_roles : [r.role];

  if (r.staff_id) {
    const { data: staffRow, error } = await sb.from("staff")
      .select("id, staff_code, full_name, phone, email, positions, is_admin, signature_url, salary_status, is_active, created_at, updated_at")
      .eq("id", r.staff_id).single();
    if (error) console.error("Failed to load staff profile:", error.message);
    state.staff = staffRow;
  }
  if (r.student_id) {
    const { data: studentRow, error } = await sb.from("students")
      .select("id, admission_no, full_name, class_id, gender, date_of_birth, guardian_name, guardian_phone, is_active, registered_by, created_at, updated_at, classes(name,category)")
      .eq("id", r.student_id).single();
    if (error) console.error("Failed to load student profile:", error.message);
    state.student = studentRow;
  }

  await loadReferenceData();
  showAppShell(true);
  buildSidebar();
  handlePostAuthRouting();
}

async function loadReferenceData() {
  const [{ data: classes }, { data: subjects }, { data: terms }, { data: sessions }, { data: settings }] = await Promise.all([
    sb.from("classes").select("*").order("sort_order"),
    sb.from("subjects").select("*").order("sort_order"),
    sb.from("terms").select("*, sessions(label)").order("order_index"),
    sb.from("sessions").select("*"),
    sb.from("school_settings").select("*").single(),
  ]);
  state.classes = classes || [];
  state.subjects = subjects || [];
  state.terms = terms || [];
  state.sessions = sessions || [];
  state.schoolSettings = settings || {};
  state.activeTerm = (terms || []).find(t => t.is_active) || (terms || [])[0];
  state.currentTermId = state.activeTerm ? state.activeTerm.id : null;

  document.getElementById("loginSchoolName").textContent = state.schoolSettings.school_name || "Pariya Central Primary";
  document.getElementById("sidebarSchoolName").textContent = state.schoolSettings.school_name || "Pariya Central Primary";
  applyDashboardTheme(state.schoolSettings.dashboard_theme || "chocolate");
}

function showAppShell(show) {
  document.getElementById("loginScreen").style.display = show ? "none" : "flex";
  document.getElementById("appShell").style.display = show ? "block" : "none";
}

// Restore session automatically on page load (persistent login).
// Deferred to DOMContentLoaded rather than running immediately: all
// <script> tags (including router.js, loaded after this file) are
// guaranteed to have finished executing by the time DOMContentLoaded
// fires, so renderRoute()/NAV_BY_ROLE/etc. are always defined by the
// time this runs — calling it immediately risked a race where
// getSession() resolves before later script tags even load.
window.addEventListener("DOMContentLoaded", async function initSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await bootAfterLogin();
  else renderRoute();
});

function toggleSidebar(open) {
  document.getElementById("sidebar").classList.toggle("open", open);
  document.getElementById("sidebarOverlay").classList.toggle("show", open);
}
function toggleTheme() {
  const html = document.documentElement;
  const cur = html.getAttribute("data-theme");
  const next = cur === "light" ? "" : "light";
  html.setAttribute("data-theme", next);
  localStorage.setItem("pariya-theme", next);
}
(function initTheme() {
  const t = localStorage.getItem("pariya-theme");
  if (t) document.documentElement.setAttribute("data-theme", t);
})();

// ---------------------------------------------------------------
// MODAL HELPER
// ---------------------------------------------------------------
function openModal(html) {
  document.getElementById("modalBox").innerHTML = html;
  document.getElementById("modalOverlay").classList.add("show");
}
function closeModal() { document.getElementById("modalOverlay").classList.remove("show"); }
document.getElementById("modalOverlay").addEventListener("click", (e) => { if (e.target.id === "modalOverlay") closeModal(); });
