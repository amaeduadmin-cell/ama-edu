/* ===============================================================
   Report card renderer — now a template BANK rather than one fixed
   design (migration 0019).

     classic  Template 1: every assessment column shown separately.
     compact  Template 2: CA columns collapsed into one total, in the
              Pariya Central style, with more room for remarks.

   Which one is drawn comes from schools.report_card_template, so a
   school can switch design without touching a single stored result —
   the same rows simply render differently.

   Everything is built through the safe DOM layer (h()), never
   innerHTML: a student's name, a teacher's remark and a school's
   motto are all untrusted text as far as this file is concerned.
   =============================================================== */

import { h, safeUrl } from "./dom.js";

/**
 * data: {
 *   school, student, class: {name}, term, scores, summary, weights,
 *   template: "classic" | "compact",
 *   settings: { head_title, show_photo, show_attendance, show_positions },
 *   components: [{ code, label, max_score, is_active }],
 * }
 */
export function renderReportCard(data) {
  const template = data.template || data.school?.report_card_template || "classic";
  return template === "compact" ? compactCard(data) : classicCard(data);
}

/* ---------------- shared pieces ---------------- */

function activeComponents(data) {
  // Prefer the school's configured components; fall back to the legacy
  // weights row so an older school still renders correctly.
  if (data.components?.length) {
    return data.components.filter((c) => c.is_active)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  const w = data.weights || { ca1_max: 20, ca2_max: 20, ca3_max: 20, exam_max: 40 };
  return [
    { code: "ca1", label: "CA1", max_score: w.ca1_max },
    { code: "ca2", label: "CA2", max_score: w.ca2_max },
    { code: "ca3", label: "CA3", max_score: w.ca3_max },
    { code: "exam", label: "Exam", max_score: w.exam_max },
  ].filter((c) => Number(c.max_score) > 0);
}

function header(data, accentClass) {
  const { school, student, settings } = data;
  const logo = safeUrl(school?.logo_url);
  const photo = settings?.show_photo === false ? null : safeUrl(student?.photo_url);

  return h(`div.rc-head.${accentClass}`, {},
    h("div.rc-head-main", {},
      logo
        ? h("img.rc-crest", { src: logo, alt: "" })
        : h("div.rc-crest.rc-crest-fallback", { "aria-hidden": "true", text: (school?.name || "AE").slice(0, 1).toUpperCase() }),
      h("div.rc-school", {},
        h("div.rc-school-name", { text: school?.name || "School" }),
        school?.motto ? h("div.rc-motto", { text: school.motto }) : null,
        h("div.rc-contact", { text: [school?.address, school?.phone, school?.email].filter(Boolean).join("  ·  ") }),
      ),
      photo ? h("img.rc-photo", { src: photo, alt: "" }) : null,
    ),
    h("h2.rc-title", { text: settings?.head_title || "TERM REPORT CARD" }),
  );
}

function metaRow(data) {
  const { student, class: klass, term } = data;
  return h("div.rc-meta", {},
    metaItem("Student", student?.full_name),
    metaItem("Admission no.", student?.admission_no),
    metaItem("Class", klass?.name),
    metaItem("Term", `${term?.label || ""} Term, ${term?.sessions?.label || ""}`),
  );
}
function metaItem(label, value) {
  return h("div.rc-meta-item", {},
    h("span.rc-meta-label", { text: label }),
    h("span.rc-meta-value", { text: value || "—" }));
}

function summaryBlock(data) {
  const { summary, settings } = data;
  const showPositions = settings?.show_positions !== false;
  const showAttendance = settings?.show_attendance !== false;

  const items = [
    ["Subjects", summary?.subjects_count],
    ["Total score", fmt(summary?.total_score)],
    ["Average", summary?.average_score != null ? `${fmt(summary.average_score)}%` : "—"],
    ["Overall grade", summary?.overall_grade || "—"],
  ];
  if (showPositions) {
    items.push(["Position", summary ? `${ordinal(summary.class_position)} of ${summary.class_size ?? "—"}` : "—"]);
  }
  if (showAttendance) {
    items.push(["Days present", summary?.days_present ?? "—"]);
    items.push(["Days absent", summary?.days_absent ?? "—"]);
  }
  return h("div.rc-summary", {}, items.map(([label, value]) =>
    h("div.rc-stat", {},
      h("div.rc-stat-label", { text: label }),
      h("div.rc-stat-value", { text: value ?? "—" }))));
}

function remarksBlock(data) {
  const { summary } = data;
  if (!summary?.teacher_remark && !summary?.head_remark) return null;
  return h("div.rc-remarks", {},
    summary.teacher_remark
      ? h("p", {}, h("b", { text: "Class teacher's remark: " }), summary.teacher_remark) : null,
    summary.head_remark
      ? h("p", {}, h("b", { text: "Head's remark: " }), summary.head_remark) : null,
  );
}

function signatures(data) {
  const { school, settings } = data;
  return h("div", {},
    h("div.rc-signatures", {},
      signatureSlot("Class teacher"),
      signatureSlot("Head / Principal", school?.headmaster_name || school?.principal_name),
      h("div.rc-seal", { text: "SCHOOL SEAL" }),
    ),
    settings?.footer_note ? h("p.rc-footer-note", { text: settings.footer_note }) : null,
  );
}
function signatureSlot(label, name) {
  return h("div.rc-sign", {},
    h("div.rc-sign-line", { "aria-hidden": "true" }),
    h("div.rc-sign-label", { text: label }),
    name ? h("div.rc-sign-name", { text: name }) : null);
}

function gradeKey(data) {
  if (!data.bands?.length) return null;
  return h("div.rc-key", {},
    h("span.rc-key-label", { text: "Grading: " }),
    data.bands
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((b) => h("span.rc-key-item", {
        text: `${b.grade} ${fmt(b.min_score)}–${fmt(b.max_score)}${b.remark ? ` (${b.remark})` : ""}`,
      })),
  );
}

/* ---------------- Template 1: classic ---------------- */

function classicCard(data) {
  const components = activeComponents(data);
  const { scores } = data;

  return h("article.report-card.rc-classic", {},
    header(data, "rc-accent-primary"),
    metaRow(data),
    h("table.rc-table", {},
      h("thead", {}, h("tr", {},
        h("th", { text: "Subject" }),
        components.map((c) => h("th.n", { text: `${c.label} /${fmt(c.max_score)}` })),
        h("th.n", { text: "Total" }),
        h("th.n", { text: "Grade" }),
        data.settings?.show_positions !== false ? h("th.n", { text: "Position" }) : null,
        h("th", { text: "Remark" }),
      )),
      h("tbody", {}, scores?.length
        ? scores.map((s) => h("tr", {},
            h("td", { text: subjectName(s) }),
            components.map((c) => h("td.n", { text: fmt(s[c.code]) })),
            h("td.n.rc-total", { text: fmt(s.total) }),
            h("td.n.rc-grade", { text: s.grade || "—" }),
            data.settings?.show_positions !== false
              ? h("td.n", { text: ordinal(s.subject_position) }) : null,
            h("td.rc-remark-cell", { text: s.remark || remarkFor(data, s.total) || "—" }),
          ))
        : [emptyRow(components.length + 4)]),
    ),
    summaryBlock(data),
    remarksBlock(data),
    gradeKey(data),
    signatures(data),
  );
}

/* ---------------- Template 2: compact ---------------- */

function compactCard(data) {
  const components = activeComponents(data);
  const caComponents = components.filter((c) => c.code !== "exam");
  const examComponent = components.find((c) => c.code === "exam");
  const caMax = caComponents.reduce((sum, c) => sum + Number(c.max_score || 0), 0);
  const { scores } = data;

  return h("article.report-card.rc-compact", {},
    header(data, "rc-accent-secondary"),
    metaRow(data),
    h("table.rc-table", {},
      h("thead", {}, h("tr", {},
        h("th", { text: "Subject" }),
        h("th.n", { text: `CA /${fmt(caMax)}` }),
        examComponent ? h("th.n", { text: `Exam /${fmt(examComponent.max_score)}` }) : null,
        h("th.n", { text: "Total" }),
        h("th.n", { text: "Grade" }),
        data.settings?.show_positions !== false ? h("th.n", { text: "Pos." }) : null,
        h("th", { text: "Remark" }),
      )),
      h("tbody", {}, scores?.length
        ? scores.map((s) => {
            const ca = caComponents.reduce((sum, c) => sum + Number(s[c.code] || 0), 0);
            return h("tr", {},
              h("td", { text: subjectName(s) }),
              h("td.n", { text: ca ? fmt(ca) : "—" }),
              examComponent ? h("td.n", { text: fmt(s.exam) }) : null,
              h("td.n.rc-total", { text: fmt(s.total) }),
              h("td.n.rc-grade", { text: s.grade || "—" }),
              data.settings?.show_positions !== false
                ? h("td.n", { text: ordinal(s.subject_position) }) : null,
              h("td.rc-remark-cell", { text: s.remark || remarkFor(data, s.total) || "—" }),
            );
          })
        : [emptyRow(6)]),
    ),
    h("div.rc-compact-lower", {},
      summaryBlock(data),
      h("div.rc-remark-panel", {},
        h("div.rc-remark-title", { text: "Remarks" }),
        remarksBlock(data) || h("p.rc-muted", { text: "No remarks recorded for this term." }),
      ),
    ),
    gradeKey(data),
    signatures(data),
  );
}

/* ---------------- helpers ---------------- */

function subjectName(s) { return s.subjects?.name || s.subject_name || "—"; }

function emptyRow(span) {
  return h("tr", {}, h("td", {
    colspan: String(span), class: "rc-empty",
    text: "No scores recorded for this term yet.",
  }));
}

/** Per-subject remark from the school's configured remark bands. */
function remarkFor(data, total) {
  if (!data.remarks?.length || total == null) return null;
  const n = Number(total);
  const band = data.remarks.find((r) => n >= Number(r.min_score) && n <= Number(r.max_score));
  return band?.remark || null;
}

function fmt(n) { return n == null ? "—" : Number(n).toFixed(1).replace(/\.0$/, ""); }

function ordinal(n) {
  if (n == null) return "—";
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Everything a report card needs, in one place, so the two pages that
 *  draw one cannot drift apart. */
export async function loadReportCardContext(supabase, unwrap) {
  const [components, bands, remarks, settings, weights] = await Promise.all([
    unwrap(await supabase.from("assessment_components").select("code, label, max_score, is_active, sort_order").order("sort_order"), "components"),
    unwrap(await supabase.from("grading_bands").select("grade, min_score, max_score, remark, sort_order").order("sort_order"), "bands"),
    unwrap(await supabase.from("grade_remarks").select("min_score, max_score, remark, sort_order").order("sort_order"), "remarks"),
    unwrap(await supabase.from("school_report_card_settings").select("*").limit(1), "rc settings"),
    unwrap(await supabase.from("score_weights").select("*").limit(1), "weights"),
  ]);
  return {
    components, bands, remarks,
    settings: settings?.[0] || null,
    weights: weights?.[0] || null,
  };
}

/* ---------------- sample data for previews ---------------- */

const SAMPLE_SUBJECTS = ["English Language", "Mathematics", "Basic Science", "Social Studies", "Civic Education", "Computer Studies"];
const SAMPLE_RATIOS = [0.86, 0.78, 0.72, 0.91, 0.66, 0.83];

/**
 * A believable report card built from a school's OWN assessment system,
 * so a preview shows the columns and totals the school will really get.
 * No real student, score or result is ever read to draw a preview.
 */
export function sampleReportCardData({ school, components, template } = {}) {
  const comps = (components?.length ? components : [
    { code: "ca1", label: "CA1", max_score: 20, is_active: true, sort_order: 1 },
    { code: "ca2", label: "CA2", max_score: 20, is_active: true, sort_order: 2 },
    { code: "ca3", label: "CA3", max_score: 20, is_active: true, sort_order: 3 },
    { code: "exam", label: "Exam", max_score: 40, is_active: true, sort_order: 4 },
  ]).filter((c) => c.is_active !== false);

  const scores = SAMPLE_SUBJECTS.map((name, i) => {
    const row = { ca1: null, ca2: null, ca3: null, exam: null, subjects: { name } };
    let total = 0;
    comps.forEach((c, j) => {
      const ratio = Math.min(0.98, SAMPLE_RATIOS[i] + ((j % 3) - 1) * 0.04);
      const value = Math.round(Number(c.max_score) * ratio * 10) / 10;
      row[c.code] = value;
      total += value;
    });
    row.total = Math.round(total * 10) / 10;
    row.grade = total >= 70 ? "A" : total >= 60 ? "B" : total >= 50 ? "C" : total >= 45 ? "D" : total >= 40 ? "E" : "F";
    row.subject_position = [2, 5, 9, 1, 12, 4][i];
    return row;
  });

  const totalScore = scores.reduce((sum, s) => sum + s.total, 0);
  const average = totalScore / scores.length;

  return {
    school: {
      name: school?.name || "Your School Name",
      motto: school?.motto || "Knowledge and Character",
      address: school?.address || "School address goes here",
      phone: school?.phone || "",
      logo_url: school?.logo_url || null,
      report_card_template: template || school?.report_card_template || "classic",
    },
    student: { full_name: "Sample Student", admission_no: "ADM/0001", photo_url: null },
    class: { name: "Primary 5" },
    term: { label: "First", sessions: { label: "2026/2027" } },
    scores,
    summary: {
      subjects_count: scores.length,
      total_score: Math.round(totalScore * 10) / 10,
      average_score: Math.round(average * 10) / 10,
      overall_grade: average >= 70 ? "A" : average >= 60 ? "B" : "C",
      class_position: 3, class_size: 32, days_present: 58, days_absent: 3,
      teacher_remark: "A hardworking pupil who participates well in class.",
      head_remark: "Keep up the good work.",
    },
    components: comps,
    remarks: [
      { min_score: 70, max_score: 100, remark: "Very good" },
      { min_score: 50, max_score: 69.99, remark: "Good" },
      { min_score: 0, max_score: 49.99, remark: "Fair" },
    ],
    bands: [
      { grade: "A", min_score: 70, max_score: 100, remark: "Excellent", sort_order: 1 },
      { grade: "B", min_score: 60, max_score: 69.99, remark: "Very good", sort_order: 2 },
      { grade: "C", min_score: 50, max_score: 59.99, remark: "Good", sort_order: 3 },
      { grade: "D", min_score: 45, max_score: 49.99, remark: "Fair", sort_order: 4 },
      { grade: "E", min_score: 40, max_score: 44.99, remark: "Pass", sort_order: 5 },
      { grade: "F", min_score: 0, max_score: 39.99, remark: "Fail", sort_order: 6 },
    ],
    settings: { head_title: "TERM REPORT CARD", show_photo: true, show_attendance: true, show_positions: true },
    template: template || school?.report_card_template || "classic",
  };
}
