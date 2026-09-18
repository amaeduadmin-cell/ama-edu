/* School dashboard. Every figure comes from one RPC that counts only
   rows the caller's RLS context can see, so a teacher's "students"
   number is their own classes and an admin's is the whole school —
   without either number being computed in the browser. */

import { h, mount, skeleton } from "../lib/dom.js";
import { page } from "./shell.js";
import { session } from "../lib/auth.js";
import { context } from "../main.js";
import { supabase } from "../lib/supabase.js";
import { errorState, emptyState } from "../lib/ui.js";
import { humanError, logError } from "../lib/errors.js";

export default async function render({ outlet }) {
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Dashboard",
    subtitle: greeting(),
    body,
  }));
  load(body);
}

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = session.fullName ? session.fullName.split(/\s+/)[0] : "";
  const term = context.school?.current_term_label;
  return [name ? `${part}, ${name}.` : `${part}.`, term ? `Active term: ${term}` : null]
    .filter(Boolean).join("  ");
}

async function load(body) {
  mount(body,
    h("div.stat-grid", {}, Array.from({ length: 4 }, () => h("div.skeleton", { style: { height: "84px" } }))),
    h("div.card.u-mt-4", {}, skeleton(3)),
  );

  try {
    const { data, error } = await supabase.rpc("dashboard_summary");
    if (error) throw error;
    const summary = (Array.isArray(data) ? data[0] : data) || {};
    mount(body, statGrid(summary), panels(summary));
  } catch (err) {
    logError("dashboard_summary", err);
    mount(body, errorState(humanError(err), () => load(body)));
  }
}

function statGrid(s) {
  const cards = [
    ["Students", s.student_count, "/students"],
    ["Staff", s.staff_count, "/staff"],
    ["Classes", s.class_count, "/classes"],
    ["Subjects", s.subject_count, "/curriculum"],
  ].filter(([, value]) => value != null);

  if (!cards.length) return h("div");

  return h("div.stat-grid", {}, cards.map(([label, value, href]) =>
    h("a.stat", { href, style: { textDecoration: "none", color: "inherit" } },
      h("div.stat-value", { text: formatNumber(value) }),
      h("div.stat-label", { text: label }),
    )));
}

function panels(s) {
  return h("div.u-stack.u-mt-4", {},
    scoreEntryPanel(s),
    announcementsPanel(s),
    feesPanel(s),
  );
}

function scoreEntryPanel(s) {
  const pending = Number(s.pending_score_entries || 0);
  return h("section.card", {},
    h("div.card-head", {},
      h("div", {},
        h("h2.card-title", { text: "Score entry" }),
        h("div.card-sub", { text: "This term, across the classes you can mark" }),
      ),
      h("a.btn.btn-outline.btn-sm", { href: "/classes", text: "Open classes" }),
    ),
    pending === 0
      ? emptyState({ title: "Everything is entered", body: "No subject is waiting on scores for the active term." })
      : h("div", {},
          h("p.u-small.u-muted", { text: `${formatNumber(pending)} subject ${pending === 1 ? "sheet is" : "sheets are"} still incomplete for this term.` }),
          h("div", { style: { height: "8px", borderRadius: "4px", background: "var(--ama-line)", overflow: "hidden" } },
            h("div", { style: {
              height: "100%",
              width: `${Math.round(Number(s.score_completion_pct || 0))}%`,
              background: "var(--brand-primary)",
            } })),
          h("div.u-xs.u-muted.u-mt-4", { text: `${Math.round(Number(s.score_completion_pct || 0))}% complete` }),
        ),
  );
}

function announcementsPanel(s) {
  const items = s.recent_announcements || [];
  return h("section.card", {},
    h("div.card-head", {},
      h("h2.card-title", { text: "Announcements" }),
      h("a.btn.btn-outline.btn-sm", { href: "/announcements", text: "All announcements" }),
    ),
    items.length
      ? h("div.u-stack", {}, items.slice(0, 4).map(a =>
          h("div", { style: { paddingBottom: "12px", borderBottom: "1px solid var(--ama-line-2)" } },
            h("div", { style: { fontWeight: "600" }, text: a.title }),
            h("div.u-xs.u-muted", { text: formatDate(a.created_at) }),
          )))
      : emptyState({
          title: "No announcements yet",
          body: "Post one to reach every parent and member of staff at once.",
          action: h("a.btn.btn-primary.btn-sm", { href: "/announcements", text: "Write an announcement" }),
        }),
  );
}

function feesPanel(s) {
  if (s.fees_expected == null) return null;
  const collected = Number(s.fees_collected || 0);
  const expected = Number(s.fees_expected || 0);
  const pct = expected ? Math.round((collected / expected) * 100) : 0;

  return h("section.card", {},
    h("div.card-head", {},
      h("h2.card-title", { text: "Fees this term" }),
      h("a.btn.btn-outline.btn-sm", { href: "/fees", text: "Open fees" }),
    ),
    h("div.u-row.u-wrap", { style: { gap: "32px" } },
      h("div", {},
        h("div.stat-value", { text: formatMoney(collected) }),
        h("div.stat-label", { text: "Collected" }),
      ),
      h("div", {},
        h("div.stat-value", { text: `${pct}%` }),
        h("div.stat-label", { text: `of ${formatMoney(expected)} expected` }),
      ),
    ),
  );
}

/* ---------------- formatting ---------------- */
const NUM = new Intl.NumberFormat("en-NG");
const MONEY = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

function formatNumber(value) { return NUM.format(Number(value || 0)); }
function formatMoney(value)  { return MONEY.format(Number(value || 0)); }
function formatDate(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return ""; }
}
