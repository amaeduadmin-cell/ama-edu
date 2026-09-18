/* ===============================================================
   Authentication and session state.

   MyPAS1 signed people in with a staff code or admission number and
   no notion of which school they belong to:

       verify_staff_password(p_staff_code, p_password)

   Those identifiers are only unique WITHIN a school, so on a
   platform the RPC would have two candidate rows the moment a second
   school reuses a staff code — and would then hand the browser a real
   session for whichever it happened to return. Every login path here
   therefore carries the tenant, and the shadow email that backs the
   Supabase Auth account is namespaced per school:

       staff.T001@pas.tenant.amaedu.internal
       student.PAS-0142@pas.tenant.amaedu.internal

   The server still decides everything. resolve_login_identity() only
   maps (school, identifier) -> shadow email; it verifies no password
   and returns nothing else. The actual credential check is Supabase
   Auth's, and what the account may then READ is decided by RLS from
   the school_id stamped on the JWT — not by anything this file says.
   =============================================================== */

import { supabase } from "./supabase.js";
import { AppError, humanError, logError, unwrap } from "./errors.js";

export const session = {
  authed: false,
  userId: null,
  schoolId: null,
  schoolSlug: null,
  school: null,          // active tenant config
  roles: [],             // e.g. ["admin", "teacher"]
  primaryRole: null,
  isPlatformAdmin: false,
  staffId: null,
  studentId: null,
  fullName: "",
  ready: false,
};

const listeners = new Set();
export function onSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(session); } catch (e) { logError("session listener", e); } }); }

export function hasRole(...roles) { return roles.some((r) => session.roles.includes(r)); }
export function isStaff() { return hasRole("admin", "headmaster", "principal", "bursar", "teacher", "registrar_primary", "registrar_secondary"); }

/** Derived password for the shadow auth account. Namespaced per school
 *  so the same staff code at two schools yields different secrets. */
function shadowPassword(schoolId, identifier, plain) {
  // Lowercased so "T001" and "t001" reach the same account. This string
  // must stay byte-identical to shadowPassword() in the provision-user
  // Edge Function -- that function is what sets the password, this is
  // what replays it. Change one, change both.
  return `ama:${schoolId}:${identifier.trim().toLowerCase()}:${plain}`;
}

/**
 * Sign in a staff member or student at a specific school.
 * kind: "staff" | "student"
 */
export async function signIn({ schoolId, schoolSlug, kind, identifier, password, classId = null }) {
  if (!schoolId) throw new AppError("This school could not be identified. Check the web address and try again.");
  if (!identifier || !password) throw new AppError("Enter both your ID and your password.");

  const rows = unwrap(
    await supabase.rpc("resolve_login_identity", {
      p_school_id: schoolId,
      p_kind: kind,
      p_identifier: identifier.trim(),
      p_class_id: classId,
    }),
    "resolve_login_identity"
  );

  const row = Array.isArray(rows) ? rows[0] : rows;
  // Deliberately identical message whether the identifier is unknown or
  // the password is wrong — otherwise this endpoint enumerates the roster.
  const generic = kind === "student"
    ? "Those details are not correct. Check the admission number, class and password."
    : "Those details are not correct. Check your Staff ID and password.";

  if (!row?.shadow_email) throw new AppError(generic);

  const { error } = await supabase.auth.signInWithPassword({
    email: row.shadow_email,
    password: shadowPassword(schoolId, identifier.trim(), password),
  });
  if (error) {
    logError("signInWithPassword", error);
    throw new AppError(error.status === 429 ? humanError(error) : generic);
  }

  await loadSession();
  if (!session.authed) throw new AppError("That account is not active. Ask your school administrator to check it.");
  if (session.schoolId !== schoolId) {
    // Belt and braces: should be impossible, RLS would block the data anyway.
    await signOut({ reload: false });
    throw new AppError("That account belongs to a different school portal.");
  }
  return session;
}

/** Platform staff (AMA EDU super admins) use a normal email login. */
export async function signInPlatform({ email, password }) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    logError("platform signIn", error);
    throw new AppError("Those sign-in details are not correct.");
  }
  await loadSession();
  if (!session.isPlatformAdmin) {
    await signOut({ reload: false });
    throw new AppError("That account does not have platform access.");
  }
  return session;
}

/** School self-registration creates a real email/password admin account. */
export async function signUpSchoolAdmin({ email, password }) {
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) { logError("signUp", error); throw new AppError(humanError(error)); }
  return data;
}

/**
 * Load who the caller is. Everything comes from one SECURITY DEFINER
 * RPC that reads the JWT server-side — the browser never tells the
 * server which school it is in.
 */
export async function loadSession() {
  const { data: { session: raw } } = await supabase.auth.getSession();

  if (!raw) {
    Object.assign(session, {
      authed: false, userId: null, schoolId: null, schoolSlug: null,
      roles: [], primaryRole: null, isPlatformAdmin: false,
      staffId: null, studentId: null, fullName: "", ready: true,
    });
    emit();
    return session;
  }

  try {
    const rows = unwrap(await supabase.rpc("current_app_user"), "current_app_user");
    const me = Array.isArray(rows) ? rows[0] : rows;

    if (!me || (!me.school_id && !me.is_platform_admin)) {
      await supabase.auth.signOut();
      Object.assign(session, { authed: false, ready: true, roles: [] });
      emit();
      return session;
    }

    Object.assign(session, {
      authed: true,
      userId: raw.user.id,
      schoolId: me.school_id || null,
      schoolSlug: me.school_slug || null,
      roles: me.roles?.length ? me.roles : (me.role ? [me.role] : []),
      primaryRole: me.role || me.roles?.[0] || null,
      isPlatformAdmin: Boolean(me.is_platform_admin),
      staffId: me.staff_id || null,
      studentId: me.student_id || null,
      fullName: me.full_name || "",
      ready: true,
    });
  } catch (err) {
    logError("loadSession", err);
    Object.assign(session, { authed: false, ready: true, roles: [] });
  }

  emit();
  return session;
}

export async function signOut({ reload = true } = {}) {
  await supabase.auth.signOut();
  Object.assign(session, {
    authed: false, userId: null, schoolId: null, schoolSlug: null,
    roles: [], primaryRole: null, isPlatformAdmin: false,
    staffId: null, studentId: null, fullName: "",
  });
  emit();
  if (reload) window.location.assign("/login");
}

export async function changeOwnPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) { logError("changeOwnPassword", error); throw new AppError(humanError(error)); }
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) logError("requestPasswordReset", error);
  // Always report success — otherwise this tells an attacker which
  // email addresses have accounts.
}

/* Keep local state honest if the session is refreshed or revoked in
   another tab. */
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
    loadSession();
  }
});
