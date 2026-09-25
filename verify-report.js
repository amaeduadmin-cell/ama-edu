/* ===============================================================
   Public report-card verification — the landing page a scanned QR
   code (Template 4 / "Pariya Classic", migration 0036) points to.

   Backed by verify_report_card(), an anon-callable RPC that returns
   only a first name + last initial, class, term and an "issued" flag —
   never a score, full name or admission number. A forgery-check, not
   a results viewer, same narrowness spirit as public_school_profile()
   next door.
   =============================================================== */

import "../styles/marketing.css";
import { h, mount } from "../lib/dom.js";
import { supabase } from "../lib/supabase.js";
import { logError } from "../lib/errors.js";
import { setSeo } from "../lib/seo.js";

export default async function render({ outlet, params }) {
  const code = (params?.code || "").trim().toUpperCase();
  setSeo({ title: "Verify a report card — AMA EDU", description: "Check whether a report card code was issued by an AMA EDU school.", noindex: true });

  let result = null, failed = false;
  if (code) {
    try {
      const { data, error } = await supabase.rpc("verify_report_card", { p_code: code });
      if (error) throw error;
      result = Array.isArray(data) ? data[0] : data;
    } catch (err) {
      logError("verify report card", err);
      failed = true;
    }
  }

  mount(outlet, h("div.panel-page", {}, h("div.panel", {},
    h("h1.panel-title", { text: "Report card verification" }),
    !code
      ? h("p.panel-sub", { text: "No verification code was given." })
      : failed
      ? h("p.panel-sub", { text: "We couldn't check this code right now — please try again shortly." })
      : result
      ? h("div", {},
          h("div.u-row", { style: { gap: "10px", alignItems: "center", margin: "12px 0" } },
            h("span.badge.badge-ok", { text: "✓ Genuine AMA EDU report card" })),
          verifyRow("Student", `${result.first_name || "—"} ${result.last_initial ? result.last_initial + "." : ""}`.trim()),
          verifyRow("Class", result.class_name),
          verifyRow("Term", [result.term_label ? `${result.term_label} Term` : null, result.session_label].filter(Boolean).join(", ")),
          verifyRow("Status", result.issued ? "Officially issued" : "Not yet officially issued by the school"),
          verifyRow("Code generated", result.issued_at),
          h("p.u-xs.u-muted", { style: { marginTop: "14px" }, text: "This page only confirms that a code came from AMA EDU's system. It never shows scores, a full name or an admission number." }),
        )
      : h("div", {},
          h("div.u-row", { style: { gap: "10px", alignItems: "center", margin: "12px 0" } },
            h("span.badge.badge-danger", { text: "✕ Code not recognised" })),
          h("p.panel-sub", { text: "This code doesn't match any report card in our system. Double-check it against the printed card, or contact the school directly." }),
        ),
  )));
}

function verifyRow(label, value) {
  return h("div.u-row", { style: { justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--ama-line-2)" } },
    h("span.u-muted", { text: label }),
    h("span", { style: { fontWeight: "600" }, text: value || "—" }));
}
