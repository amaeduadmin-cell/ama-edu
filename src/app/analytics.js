/* ===============================================================
   Analytics — class averages, pass rates, score-entry completion.

   Ports: renderAnalytics / renderCaTracker (MyPAS1 app-phase2c.js,
   app-phase6.js). Plain HTML/CSS bars rather than a charting
   library — this is a small, mostly-numeric page, and every extra
   dependency is a slower first load on the connections these
   schools actually have.
   =============================================================== */

import { h, mount, skeleton } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState } from "../lib/ui.js";
import { fetchClasses, fetchActiveTerm } from "../lib/data.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal")) return;

  const body = h("div.u-stack");
  mount(outlet, page({ title: "Analytics", body }));
  mount(body, skeleton(6));

  try {
    const [classes, term, bands] = await Promise.all([
      fetchClasses(),
      fetchActiveTerm(),
      unwrap(await supabase.from("grading_bands").select("grade, is_pass"), "fetch grading bands"),
    ]);
    if (!term) return mount(body, emptyState({ title: "No active term", body: "Ask your school administrator to activate a term in Settings." }));
    if (!classes.length) return mount(body, emptyState({ title: "No classes yet", body: "Add classes from Settings first." }));

    const passGrades = new Set(bands.filter((b) => b.is_pass).map((b) => b.grade));

    const [summaries, classSubjects, scores] = await Promise.all([
      unwrap(await supabase.from("student_term_summary").select("class_id, average_score, overall_grade").eq("term_id", term.id), "fetch summaries"),
      unwrap(await supabase.from("class_subjects").select("class_id, subject_id"), "fetch class subjects"),
      unwrap(await supabase.from("student_scores").select("class_id, subject_id").eq("term_id", term.id), "fetch scores"),
    ]);

    mount(body,
      h("p.u-muted.u-small", { text: `${term.label} Term · ${term.sessions?.label || ""}` }),
      averagesCard(classes, summaries, passGrades),
      completionCard(classes, classSubjects, scores),
    );
  } catch (err) {
    logError("analytics", err);
    mount(body, errorState(humanError(err)));
  }
}

function averagesCard(classes, summaries, passGrades) {
  const byClass = new Map(classes.map((c) => [c.id, { name: c.name, count: 0, sum: 0, pass: 0 }]));
  summaries.forEach((s) => {
    const row = byClass.get(s.class_id);
    if (!row || s.average_score == null) return;
    row.count++; row.sum += Number(s.average_score);
    if (passGrades.has(s.overall_grade)) row.pass++;
  });
  const rows = [...byClass.values()].filter((r) => r.count > 0);

  return h("section.card", {},
    h("h2.card-title", { text: "Class averages and pass rates" }),
    rows.length
      ? h("div.table-wrap.u-mt-4", {}, h("table.table", {},
          h("thead", {}, h("tr", {}, h("th", { text: "Class" }), h("th.num", { text: "Students" }), h("th.num", { text: "Average" }), h("th", { text: "Pass rate" }))),
          h("tbody", {}, rows.map((r) => h("tr", {},
            h("td", { text: r.name }),
            h("td.num.u-num", { text: r.count }),
            h("td.num.u-num", { text: `${(r.sum / r.count).toFixed(1)}%` }),
            h("td", {}, bar(Math.round((r.pass / r.count) * 100))),
          ))),
        ))
      : emptyState({ title: "No results yet", body: "Save scores in Classes & Scores to see averages here." }),
  );
}

function completionCard(classes, classSubjects, scores) {
  const expectedByClass = new Map(classes.map((c) => [c.id, new Set()]));
  classSubjects.forEach((cs) => { expectedByClass.get(cs.class_id)?.add(cs.subject_id); });
  const doneByClass = new Map(classes.map((c) => [c.id, new Set()]));
  scores.forEach((s) => { doneByClass.get(s.class_id)?.add(s.subject_id); });

  const rows = classes.map((c) => {
    const expected = expectedByClass.get(c.id)?.size || 0;
    const done = [...(doneByClass.get(c.id) || [])].filter((id) => expectedByClass.get(c.id)?.has(id)).length;
    return { name: c.name, expected, done };
  }).filter((r) => r.expected > 0);

  return h("section.card.u-mt-6", {},
    h("h2.card-title", { text: "Score entry completion by class" }),
    rows.length
      ? h("div.table-wrap.u-mt-4", {}, h("table.table", {},
          h("thead", {}, h("tr", {}, h("th", { text: "Class" }), h("th.num", { text: "Subjects done" }), h("th", { text: "Completion" }))),
          h("tbody", {}, rows.map((r) => h("tr", {},
            h("td", { text: r.name }),
            h("td.num.u-num", { text: `${r.done} / ${r.expected}` }),
            h("td", {}, bar(Math.round((r.done / r.expected) * 100))),
          ))),
        ))
      : emptyState({ title: "No subjects assigned yet", body: "Assign subjects to classes from Curriculum." }),
  );
}

function bar(pct) {
  return h("div.u-row", { style: { gap: "8px" } },
    h("div", { style: { flex: "1 1 120px", height: "8px", borderRadius: "4px", background: "var(--ama-line)", overflow: "hidden" } },
      h("div", { style: { height: "100%", width: `${pct}%`, background: pct >= 70 ? "var(--brand-primary)" : pct >= 40 ? "var(--ama-warn)" : "var(--ama-danger)" } })),
    h("span.u-xs.u-muted", { text: `${pct}%` }),
  );
}
