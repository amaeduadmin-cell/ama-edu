import "../../styles/marketing.css";
import { h, mount, setBusy } from "../../lib/dom.js";
import { supabase } from "../../lib/supabase.js";
import { unwrap, humanError, logError } from "../../lib/errors.js";
import { emptyState, errorState, footerNote, confirmAction, toastOk, toastError, inlineAlert } from "../../lib/ui.js";
import { signOut } from "../../lib/auth.js";
import { fmtDate } from "../../lib/data.js";

export default async function render({ outlet }) {
  document.title = "Applications — AMA EDU console";
  const body = h("div.shell-width", { style: { paddingBlock: "24px" } });
  mount(outlet, h("div", {}, topbar(), body, footerNote()));
  await load();

  async function load() {
    mount(body, h("div.page-head", {}, h("h1", { text: "School applications" }), h("p.card-sub", { text: "Review applications before a school portal is provisioned." })), h("div.card", {}, h("div.skeleton", { style: { height: "180px" } })));
    try {
      const rows = unwrap(await supabase.from("school_applications").select("*").order("submitted_at", { ascending: false }), "fetch school applications");
      draw(rows);
    } catch (err) { logError("platform applications", err); mount(body, errorState(humanError(err), load)); }
  }

  function draw(rows) {
    const pending = rows.filter((row) => row.status === "pending").length;
    mount(body,
      h("div.page-head", {}, h("div", {}, h("h1", { text: "School applications" }), h("p.card-sub", { text: `${pending} awaiting review · ${rows.length} total` })), h("a.btn.btn-outline", { href: "/admin", text: "Back to overview" })),
      rows.length ? h("div.u-stack", {}, rows.map(applicationCard)) : emptyState({ title: "No applications yet", body: "New school applications will appear here." }),
    );
  }

  function applicationCard(application) {
    const note = h("div");
    const decisionNote = h("textarea.textarea", { placeholder: "Decision note (required when rejecting)", rows: 2 });
    const approve = h("button.btn.btn-primary.btn-sm", { type: "button", text: "Approve", disabled: application.status !== "pending" });
    const reject = h("button.btn.btn-outline.btn-sm", { type: "button", text: "Reject", disabled: application.status !== "pending" });
    approve.addEventListener("click", () => decide(application, "approved", decisionNote, approve));
    reject.addEventListener("click", () => decide(application, "rejected", decisionNote, reject));
    const provisionUser = h("input.input", { placeholder: "Supabase Auth user ID", value: "" });
    const provision = h("button.btn.btn-primary.btn-sm", { type: "button", text: "Provision live portal", disabled: application.status !== "approved" });
    provision.addEventListener("click", async () => {
      if (!/^[0-9a-f-]{36}$/i.test(provisionUser.value.trim())) return mount(note, inlineAlert("Enter the Auth user UUID created for the applicant's administrator email."));
      setBusy(provision, true, "Provisioning…");
      try {
        const result = unwrap(await supabase.rpc("provision_school_application", { p_id: application.id, p_admin_user_id: provisionUser.value.trim() }), "provision school application");
        toastOk(`Portal provisioned: ${result?.[0]?.slug || "school"}`); await load();
      } catch (err) { mount(note, inlineAlert(humanError(err))); } finally { setBusy(provision, false); }
    });
    return h("section.card", {},
      h("div.card-head", {}, h("div", {}, h("h2.card-title", { text: application.school_name }), h("div.card-sub", { text: `${application.reference} · Submitted ${fmtDate(application.submitted_at)}` })), h(`span.badge.${application.status === "pending" ? "badge-warn" : application.status === "approved" ? "badge-ok" : "badge-info"}`, { text: application.status })),
      h("div.form-grid.cols-2", {}, h("div", {}, h("div.u-small", { text: `Portal: ${application.requested_slug}.amaedu.com.ng` }), h("div.u-small", { text: `Type: ${application.school_type}` }), h("div.u-small", { text: `Sections: ${(application.sections || []).join(", ") || "Not specified"}` }), h("div.u-small", { text: `Students: ${application.declared_student_count ?? "Not supplied"}` })), h("div", {}, h("div.u-small", { text: `School email: ${application.school_email}` }), h("div.u-small", { text: `Administrator: ${application.admin_full_name}` }), h("div.u-small", { text: `Admin email: ${application.admin_email}` }), h("div.u-small", { text: application.address || "Address not supplied" }))),
      application.message ? h("p.u-small.u-muted", { text: application.message }) : null,
      note, decisionNote,
      h("div.u-row.u-wrap.u-mt-3", {}, approve, reject),
      application.status === "approved" ? h("div.card.u-mt-3", {}, h("strong", { text: "Final setup" }), h("p.u-small.u-muted", { text: "Create a Supabase Auth user using the applicant's administrator email, then enter its UUID below. Provisioning creates the school portal, admin staff record, defaults, and live tenant membership atomically." }), h("div.u-row.u-wrap", {}, provisionUser, provision)) : null,
    );
  }

  async function decide(application, decision, noteInput, button) {
    if (decision === "rejected" && noteInput.value.trim().length < 3) return toastError("Add a short rejection reason first.");
    const ok = await confirmAction({ title: `${decision === "approved" ? "Approve" : "Reject"} ${application.school_name}?`, message: decision === "approved" ? "The requested portal address will remain held until the school is provisioned." : "The applicant will need to submit a new application.", confirmLabel: decision === "approved" ? "Approve" : "Reject", danger: decision === "rejected" });
    if (!ok) return;
    setBusy(button, true, "Saving…");
    try { unwrap(await supabase.rpc("decide_school_application", { p_id: application.id, p_decision: decision, p_note: noteInput.value.trim() || null }), "decide school application"); toastOk(`Application ${decision}`); await load(); }
    catch (err) { toastError(humanError(err)); } finally { setBusy(button, false); }
  }
}

function topbar() {
  return h("header.topbar.no-print.shell-width", { style: { borderBottom: "1px solid var(--ama-line)" } }, h("a.wordmark", { href: "/admin" }, "AMA ", h("b", { text: "EDU" })), h("nav.u-row", { style: { marginLeft: "24px", gap: "16px" } }, h("a.u-small", { href: "/admin", text: "Overview" }), h("a.u-small", { href: "/admin/schools", text: "Schools" }), h("a.u-small", { href: "/admin/applications", text: "Applications" })), h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Sign out", style: { marginLeft: "auto" }, onclick: () => signOut() }));
}
