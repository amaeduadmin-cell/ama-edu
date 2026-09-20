/* ===============================================================
   Result publication — the release gate.

   Fixes the behaviour where results appeared to students the moment a
   teacher saved a score. Every class+term now sits in Draft until an
   authorised administrator releases it here. The rules are enforced
   by set_result_status() and RLS (migration 0020), not by this page —
   this is the control surface, not the boundary.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, confirmAction, toastOk, toastError } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";
import { onDataChanged } from "../lib/realtime.js";

const STATUS = {
  draft:     { label: "Draft",     badge: "badge",       note: "Teachers are still entering scores. Students and parents cannot see anything." },
  ready:     { label: "Ready",     badge: "badge-warn",  note: "Marked ready for review. Still not visible to students." },
  published: { label: "Published", badge: "badge-ok",    note: "Released — students and parents can see this report card." },
};

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal")) return;

  const state = { term: null, rows: [], loading: true };
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Publish results",
    subtitle: "Results stay hidden from students and parents until you release them here.",
    body,
  }));

  onDataChanged(() => load());
  await load();

  async function load() {
    state.loading = true; draw();
    try {
      state.term = await fetchActiveTerm();
      if (!state.term) { state.loading = false; return draw(); }
      state.rows = unwrap(
        await supabase.rpc("result_publication_overview", { p_term_id: state.term.id }),
        "publication overview"
      );
    } catch (err) {
      logError("publication load", err);
      state.error = humanError(err);
    } finally {
      state.loading = false; draw();
    }
  }

  function draw() {
    if (state.loading) return mount(body, h("div.card", {}, skeleton(6)));
    if (state.error)   return mount(body, errorState(state.error, load));
    if (!state.term)   return mount(body, emptyState({ title: "No active term", body: "Activate a term in Settings first." }));
    if (!state.rows.length) return mount(body, emptyState({ title: "No classes yet", body: "Add classes before publishing results." }));

    mount(body,
      h("div.card-head", {},
        h("div", {},
          h("h2.card-title", { text: `${state.term.label} Term` }),
          h("div.card-sub", { text: state.term.sessions?.label || "" })),
      ),
      h("div.card.card-flush", {}, h("div.table-wrap", {}, h("table.table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Class" }), h("th", { text: "Scores entered" }),
          h("th", { text: "Status" }), h("th", { text: "Released" }), h("th", { text: "" }))),
        h("tbody", {}, state.rows.map(rowView)),
      ))),
    );
  }

  function rowView(r) {
    const meta = STATUS[r.status] || STATUS.draft;
    const entered = Number(r.students_with_scores || 0);
    const total = Number(r.students || 0);
    const complete = total > 0 && entered >= total;

    return h("tr", {},
      h("td", {}, h("div", { style: { fontWeight: "600" }, text: r.class_name }),
                  h("div.u-xs.u-muted", { text: meta.note })),
      h("td", {}, h("div", { text: `${entered} of ${total} students` }),
                  !complete && total > 0
                    ? h("div.u-xs", { style: { color: "var(--ama-warn)" }, text: "Not every student has scores yet" })
                    : null),
      h("td", {}, h(`span.badge.${meta.badge}`, { text: meta.label })),
      h("td.u-xs.u-muted", { text: r.published_at ? new Date(r.published_at).toLocaleString() : "—" }),
      h("td", {}, h("div.u-row", { style: { gap: "6px", justifyContent: "flex-end" } },
        r.status !== "published"
          ? h("button.btn.btn-primary.btn-sm", { type: "button", text: "Publish",
              onclick: (e) => change(e.target, r, "published", complete) })
          : h("button.btn.btn-outline.btn-sm", { type: "button", text: "Unpublish",
              onclick: (e) => change(e.target, r, "draft", true) }),
        r.status === "draft"
          ? h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Mark ready",
              onclick: (e) => change(e.target, r, "ready", true) })
          : null,
      )),
    );
  }

  async function change(btn, row, status, complete) {
    const prompts = {
      published: {
        title: `Publish ${row.class_name}?`,
        message: complete
          ? "Students and parents in this class will be able to see their report cards immediately."
          : "Some students in this class have no scores yet. Their report cards will show as incomplete. Publish anyway?",
        confirmLabel: "Publish results",
      },
      draft: {
        title: `Unpublish ${row.class_name}?`,
        message: "Students and parents will immediately lose access to these report cards again. Nothing is deleted.",
        confirmLabel: "Unpublish", danger: true,
      },
      ready: {
        title: `Mark ${row.class_name} ready for review?`,
        message: "This flags the class for the head to review. It does not make anything visible to students.",
        confirmLabel: "Mark ready",
      },
    };
    const ok = await confirmAction(prompts[status]);
    if (!ok) return;

    setBusy(btn, true, "Working…");
    try {
      unwrap(await supabase.rpc("set_result_status", {
        p_class_id: row.class_id, p_term_id: state.term.id, p_status: status, p_note: null,
      }), "set result status");
      toastOk(status === "published" ? "Results published" : status === "draft" ? "Results unpublished" : "Marked ready");
      await load();
    } catch (err) {
      toastError(humanError(err, "The result status could not be changed."));
    } finally {
      setBusy(btn, false);
    }
  }
}
