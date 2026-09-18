/* ===============================================================
   Shared report-card renderer — used by report-cards.js (staff,
   any student) and my-report.js (a student's own, fee-gated). One
   function so the printed artefact is identical regardless of who's
   looking at it, and so a branding or layout change only happens
   in one place.

   Ports: buildReportCardHtml (MyPAS1 app-tabs.js), rebuilt with the
   safe DOM layer — the original built this by string-concatenating
   student names and remarks into innerHTML.
   =============================================================== */

import { h } from "./dom.js";
import { safeUrl } from "./dom.js";

/**
 * data: {
 *   school, student, class: {name}, term: {label, sessions:{label}},
 *   scores: [{subject:{name}, ca1,ca2,ca3,exam,total,grade,subject_position}],
 *   summary: {subjects_count,total_score,average_score,class_position,
 *             class_size,overall_grade,teacher_remark,head_remark,
 *             days_present,days_absent},
 *   weights: {ca1_max,ca2_max,ca3_max,exam_max},
 * }
 */
export function renderReportCard(data) {
  const { school, student, class: klass, term, scores, summary, weights } = data;
  const logo = safeUrl(school?.logo_url);

  return h("article.slip.report-card", { style: { fontSize: "13px", padding: "28px", transform: "none", maxWidth: "820px", margin: "0 auto" } },
    h("div.slip-head", {},
      logo ? h("img", { src: logo, alt: "", style: { width: "44px", height: "44px", objectFit: "contain", borderRadius: "6px" } })
           : h("div.slip-crest", { style: { width: "44px", height: "44px", fontSize: "20px" }, text: (school?.name || "AE").slice(0, 1) }),
      h("div", {},
        h("div.slip-school", { style: { fontSize: "18px" }, text: school?.name || "School" }),
        school?.motto ? h("div.slip-motto", { text: school.motto }) : null,
        school?.address ? h("div.u-xs.u-muted", { text: school.address }) : null,
      ),
    ),
    h("h2", { style: { textAlign: "center", margin: "14px 0 4px", fontSize: "15px", letterSpacing: "0.04em" }, text: "TERM REPORT CARD" }),
    h("div.slip-meta", { style: { fontSize: "12px", flexWrap: "wrap", gap: "8px 20px" } },
      h("div", {}, "Student ", h("b", { text: student.full_name })),
      h("div", {}, "Admission no. ", h("b", { text: student.admission_no })),
      h("div", {}, "Class ", h("b", { text: klass?.name || "—" })),
      h("div", {}, "Term ", h("b", { text: `${term?.label || ""} Term, ${term?.sessions?.label || ""}` })),
    ),

    h("table", { style: { fontSize: "12px", marginTop: "10px" } },
      h("thead", {}, h("tr", {},
        h("th", { text: "Subject" }),
        h("th.n", { text: `CA1 /${weights.ca1_max}` }), h("th.n", { text: `CA2 /${weights.ca2_max}` }),
        h("th.n", { text: `CA3 /${weights.ca3_max}` }), h("th.n", { text: `Exam /${weights.exam_max}` }),
        h("th.n", { text: "Total" }), h("th.n", { text: "Grade" }), h("th.n", { text: "Position" }),
      )),
      h("tbody", {}, scores.length
        ? scores.map((s) => h("tr", {},
            h("td", { text: s.subjects?.name || s.subject_name || "—" }),
            h("td.n", { text: fmt(s.ca1) }), h("td.n", { text: fmt(s.ca2) }),
            h("td.n", { text: fmt(s.ca3) }), h("td.n", { text: fmt(s.exam) }),
            h("td.n", { text: fmt(s.total) }),
            h("td.n.g", { text: s.grade || "—" }),
            h("td.n", { text: ordinal(s.subject_position) }),
          ))
        : [h("tr", {}, h("td", { colspan: "8", style: { textAlign: "center", color: "var(--ama-slate)" }, text: "No scores recorded for this term yet." }))]),
    ),

    h("div.slip-foot", { style: { marginTop: "16px", alignItems: "flex-start" } },
      h("div", { style: { display: "flex", gap: "22px", flexWrap: "wrap" } },
        stat("Subjects", summary?.subjects_count),
        stat("Total score", fmt(summary?.total_score)),
        stat("Average", summary ? `${fmt(summary.average_score)}%` : "—"),
        stat("Overall grade", summary?.overall_grade || "—"),
        stat("Position", summary ? `${ordinal(summary.class_position)} of ${summary.class_size}` : "—"),
      ),
      h("div.slip-seal", { text: "SCHOOL SEAL" }),
    ),

    (summary?.teacher_remark || summary?.head_remark) ? h("div", { style: { marginTop: "14px", fontSize: "12px" } },
      summary.teacher_remark ? h("p", {}, h("b", { text: "Class teacher's remark: " }), summary.teacher_remark) : null,
      summary.head_remark    ? h("p", {}, h("b", { text: "Head's remark: " }), summary.head_remark) : null,
    ) : null,

    h("div.u-row.u-mt-6", { style: { justifyContent: "space-between", fontSize: "11px", color: "var(--ama-slate)" } },
      h("div", {}, "Class teacher's signature: ____________________"),
      h("div", {}, "Head's signature: ____________________"),
    ),
  );
}

function stat(label, value) {
  return h("div", {}, h("div.u-xs.u-muted", { text: label }), h("div", { style: { fontWeight: "600" }, text: value ?? "—" }));
}
function fmt(n) { return n == null ? "—" : Number(n).toFixed(1).replace(/\.0$/, ""); }
function ordinal(n) {
  if (n == null) return "—";
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
