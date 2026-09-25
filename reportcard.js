/* ===============================================================
   Report card renderer — now a template BANK rather than one fixed
   design (migration 0019).

     classic   Template 1: every assessment column shown separately.
     compact   Template 2: CA columns collapsed into one total, in the
               Pariya Central style, with more room for remarks.
     heritage  Template 3: bordered three-column info box, pill
               banners and a signatures row — ported from the
               original MyPAS1 report-sheet design (newpariyacentral).
     pariya    Template 4: exact port of newpariyacentral's own
               Pariya Classic layout (its behaviour, not its client-
               side privilege model) — adds an annual/session summary
               box and a QR verification code Templates 1-3 don't have.

   Which one is drawn comes from schools.report_card_template, so a
   school can switch design without touching a single stored result —
   the same rows simply render differently.

   Everything is built through the safe DOM layer (h()), never
   innerHTML: a student's name, a teacher's remark and a school's
   motto are all untrusted text as far as this file is concerned.
   =============================================================== */

import { h, safeUrl } from "./dom.js";
import { qrSvg } from "./qrcode.js";
import { platformUrl } from "./tenant.js";

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
  if (template === "compact") return compactCard(data);
  if (template === "heritage") return richCard(data);
  if (template === "pariya") return pariyaCard(data);
  return classicCard(data);
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

/* ---------------- Template 3: heritage ---------------- */
/* Ported from newpariyacentral's buildReportCardHtml(): a navy-bordered
   sheet with a banner-pill title, a three-column bordered info box and
   a bottom signature row. Rebuilt here through h() rather than the
   original's innerHTML string — a student's name, a remark and a
   school's motto are untrusted text as far as this file is concerned,
   same as the other two templates. Uses the same `data` shape (school,
   student, class, term, scores, summary, components) as Template 1/2,
   so it drops into every page that already renders a report card with
   no extra fields required. */

function richCard(data) {
  const { school, student, class: klass, term, summary, settings } = data;
  const components = activeComponents(data);
  const { scores } = data;
  const showPositions = settings?.show_positions !== false;

  const logo = safeUrl(school?.logo_url);
  const photo = settings?.show_photo === false ? null : safeUrl(student?.photo_url);
  const contact = [school?.phone ? `☎ ${school.phone}` : null, school?.email ? `✉ ${school.email}` : null].filter(Boolean);
  const colCount = components.length + 5 + (showPositions ? 1 : 0);

  return h("article.report-card.rc-rich", {},
    h("div.rc3-header", {},
      h("div.rc3-crest", {}, logo
        ? h("img", { src: logo, alt: "" })
        : h("span", { "aria-hidden": "true", text: (school?.name || "AE").slice(0, 1).toUpperCase() })),
      h("div.rc3-title-block", {},
        h("h2", { text: school?.name || "Your School Name" }),
        school?.address ? h("p.rc3-address", { text: school.address }) : null,
        contact.length ? h("div.rc3-contact", {}, contact.map((t) => h("span", { text: t }))) : null,
        school?.motto ? h("div.rc3-motto", {}, h("span", { text: "MOTTO: " }), String(school.motto).toUpperCase()) : null,
      ),
      h("div.rc3-photo-box", {}, photo ? h("img", { src: photo, alt: "" }) : null),
    ),
    h("hr.rc3-divider"),
    h("div.rc3-banner-wrap", {},
      h("span.rc3-banner", { text: `${term?.label ? term.label + " Term " : ""}Report Sheet`.toUpperCase() })),

    h("div.rc3-infobox", {},
      h("div.rc3-info-col", {},
        rc3Line("Name", student?.full_name),
        rc3Line("Total score", fmt(summary?.total_score)),
        rc3Line("Average", summary?.average_score != null ? `${fmt(summary.average_score)}%` : "—"),
        rc3Line("Grade", summary?.overall_grade),
      ),
      h("div.rc3-info-col", {},
        rc3Line("Admission no.", student?.admission_no),
        rc3Line("Class", klass?.name),
        rc3Line("Subjects", summary?.subjects_count),
        showPositions
          ? rc3Line("Position", summary ? `${ordinal(summary.class_position)} of ${summary.class_size ?? "—"}` : "—")
          : rc3Line("Term", term?.label),
      ),
      h("div.rc3-info-col.rc3-info-col-last", {},
        rc3Line("Session", term?.sessions?.label),
        settings?.show_attendance !== false ? rc3Line("Days present", summary?.days_present) : rc3Line("Term", term?.label),
        settings?.show_attendance !== false ? rc3Line("Days absent", summary?.days_absent) : null,
      ),
    ),

    h("div.rc3-perf-banner", { text: "Student's Academic Performance" }),
    h("table.rc3-table", {},
      h("thead", {}, h("tr", {},
        h("th", { text: "S/N" }),
        h("th", { text: "Subject" }),
        components.map((c) => h("th.n", { text: `${c.label} /${fmt(c.max_score)}` })),
        h("th.n", { text: "Total" }),
        h("th.n", { text: "Grade" }),
        showPositions ? h("th.n", { text: "Position" }) : null,
        h("th", { text: "Remark" }),
      )),
      h("tbody", {}, scores?.length
        ? scores.map((s, i) => h("tr", {},
            h("td.n", { text: String(i + 1) }),
            h("td", { text: subjectName(s) }),
            components.map((c) => h("td.n", { text: fmt(s[c.code]) })),
            h("td.n.rc3-total", { text: fmt(s.total) }),
            h("td.n.rc3-grade", { text: s.grade || "—" }),
            showPositions ? h("td.n", { text: ordinal(s.subject_position) }) : null,
            h("td.rc3-remark-cell", { text: s.remark || remarkFor(data, s.total) || "—" }),
          ))
        : [emptyRow(colCount)]),
    ),

    h("div.rc3-remarks-box", {},
      summary?.teacher_remark
        ? h("div.rc3-remark-line", {}, h("span.rc3-label", { text: "Class teacher's remark: " }), summary.teacher_remark) : null,
      summary?.head_remark
        ? h("div.rc3-remark-line", {}, h("span.rc3-label", { text: "Head's remark: " }), summary.head_remark) : null,
      (!summary?.teacher_remark && !summary?.head_remark)
        ? h("div.rc3-remark-line.rc3-muted", { text: "No remarks recorded for this term." }) : null,
    ),

    h("div.rc3-bottom-row", {},
      rc3Signature("Class teacher"),
      h("div.rc3-seal", { text: "SCHOOL SEAL" }),
      rc3Signature("Head / Principal", school?.headmaster_name || school?.principal_name),
    ),
    gradeKey(data),
  );
}

function rc3Line(label, value) {
  return h("div.rc3-info-line", {},
    h("span.rc3-label", { text: label }),
    h("span.rc3-value", { text: (value === null || value === undefined || value === "") ? "—" : value }));
}

function rc3Signature(label, name) {
  return h("div.rc3-sign", {},
    h("div.rc3-sign-line", { "aria-hidden": "true" }),
    h("div.rc3-sign-label", { text: label }),
    name ? h("div.rc3-sign-name", { text: name }) : null);
}

/* ---------------- Template 4: Pariya Classic (rc-pariya) ---------------- */
/* Exact port of newpariyacentral's buildReportCardHtml() markup, colours
   and layout — see styles/reportcard.css for why every class name is
   renamed rc4-... / rc-pariya rather than pasted verbatim (the source doc's
   .card collides with this app's own site-wide card component). Adds
   three things Templates 1-3 don't have: term dates -> holiday duration
   (migration 0033, reusing terms.ends_on/next_term_starts_on), the
   annual/session summary box (migrations 0034-0035), and a scannable QR
   verification block (migration 0036).

   Extra optional fields this template reads, beyond the shared `data`
   shape (fetched by the calling page only when template === "pariya"):
     data.sessionSummaries  [{ label, average_score }] — 1st/2nd/3rd
                             term averages for the annual-summary row.
     data.headSignatory     { label, name, signature_url } — role-
                             mapped Headmaster/Principal lookup.
     data.verificationCode  string | null — from
                             get_or_create_report_verification(); when
                             null (e.g. template previews) the QR block
                             is simply omitted rather than faked. */

const CATEGORY_LABEL = {
  nursery: "Nursery", primary: "Primary", jss: "Junior Secondary",
  ss: "Senior Secondary", islamiyya: "Islamiyya", other: "",
};

function pariyaCard(data) {
  const { school, student, class: klass, term, summary, settings, sessionSummaries, headSignatory, verificationCode } = data;
  const components = activeComponents(data);
  const { scores } = data;
  const showPositions = settings?.show_positions !== false;

  const logo = safeUrl(school?.logo_url);
  const photo = settings?.show_photo === false ? null : safeUrl(student?.photo_url);
  const contact = [
    school?.phone ? `☎ ${school.phone}` : null,
    school?.email ? `✉ ${school.email}` : null,
    school?.website ? `🌐 ${school.website}` : null,
  ].filter(Boolean);

  const category = klass?.category;
  const categoryLabel = CATEGORY_LABEL[category] || "";
  const wantsPrincipal = category === "jss" || category === "ss";
  const headLabel = headSignatory?.label || (wantsPrincipal ? "Principal" : "Headmaster");
  const headName = headSignatory?.name || (wantsPrincipal ? school?.principal_name : school?.headmaster_name);
  const headSig = safeUrl(headSignatory?.signature_url);

  const colCount = 2 + components.length + 2 + (showPositions ? 1 : 0) + 1;

  return h("article.report-card.rc-pariya", {},
    h("div.rc4-header", {},
      h("div.rc4-logo-box", {}, logo
        ? h("img", { src: logo, alt: "" })
        : h("div.rc4-crest-fallback", { "aria-hidden": "true", text: (school?.name || "AE").slice(0, 1).toUpperCase() })),
      h("div.rc4-title-block", {},
        h("h2", { text: school?.name || "Your School Name" }),
        school?.address ? h("p.rc4-address", { text: school.address }) : null,
        contact.length ? h("div.rc4-contact", {}, contact.map((t) => h("span", { text: t }))) : null,
      ),
      h("div.rc4-photo-box", {}, photo ? h("img", { src: photo, alt: "" }) : null),
    ),
    school?.motto ? h("div.rc4-motto", { text: school.motto }) : null,
    h("hr.rc4-divider"),

    h("div.rc4-banner-wrap", {},
      h("span.rc4-banner", { text: `${term?.label ? term.label + " Term " : ""}Report Sheet`.toUpperCase() })),

    h("div.rc4-infobox", {},
      h("div.rc4-info-cols", {},
        h("div.rc4-info-col-left", {},
          rc4Line("Name", student?.full_name),
          rc4Line("Total score", fmt(summary?.total_score)),
          rc4Line("Average", summary?.average_score != null ? `${fmt(summary.average_score)}%` : "—"),
          rc4Line("Grade", summary?.overall_grade),
          rc4Line("Position", summary ? `${ordinal(summary.class_position)} of ${summary.class_size ?? "—"}` : "—"),
        ),
        h("div.rc4-info-col-mid", {},
          rc4Line("Gender", student?.gender ? capitalize(student.gender) : "—"),
          rc4Line("Admission no.", student?.admission_no),
          rc4Line("Class", klass?.name),
          rc4Line("Class size", summary?.class_size),
          rc4Line("Term", term?.label ? `${term.label} Term` : "—"),
        ),
        h("div.rc4-info-col-right", {},
          rc4Line("Session", term?.sessions?.label),
          rc4Line("Date of birth", formatDob(student?.date_of_birth)),
          rc4Line("Closing date", formatDate(term?.ends_on)),
          rc4Line("Resumption date", formatDate(term?.next_term_starts_on)),
          rc4Line("Holiday duration", holidayDuration(term?.ends_on, term?.next_term_starts_on)),
        ),
      ),
    ),

    h("div.rc4-perf-banner", { text: `Student's Academic Performance${categoryLabel ? ` (${categoryLabel} Category)` : ""}` }),
    h("table.rc4-table", {},
      h("thead", {}, h("tr", {},
        h("th", { text: "S/N" }),
        h("th", { text: "Subject" }),
        components.map((c) => h("th", { text: `${c.label} /${fmt(c.max_score)}` })),
        h("th", { text: "Total" }),
        h("th", { text: "Grade" }),
        showPositions ? h("th", { text: "Position" }) : null,
        h("th", { text: "Remark" }),
      )),
      h("tbody", {}, scores?.length
        ? scores.map((s, i) => h("tr", {},
            h("td", { text: String(i + 1) }),
            h("td", { text: subjectName(s) }),
            components.map((c) => h("td", { text: fmt(s[c.code]) })),
            h("td", { text: fmt(s.total) }),
            h("td", { text: s.grade || "—" }),
            showPositions ? h("td", { text: ordinal(s.subject_position) }) : null,
            h("td", { text: s.remark || remarkFor(data, s.total) || "—" }),
          ))
        : [emptyRow(colCount)]),
    ),

    sessionSummaries?.length || summary?.annual_average != null ? annualSummaryBox(data) : null,

    h("div.rc4-remarks-box", {},
      summary?.teacher_remark
        ? h("div.rc4-remark-line", {}, h("span.rc4-label", { text: "Class teacher's remark: " }), summary.teacher_remark) : null,
      summary?.head_remark
        ? h("div.rc4-remark-line", {}, h("span.rc4-label", { text: "Head's remark: " }), summary.head_remark) : null,
      summary?.annual_average != null
        ? h("div.rc4-remark-line", {}, h("span.rc4-label", { text: "Annual remark: " }), annualRemark(data)) : null,
      (!summary?.teacher_remark && !summary?.head_remark && summary?.annual_average == null)
        ? h("div.rc4-remark-line.rc4-muted", { text: "No remarks recorded for this term." }) : null,
    ),

    h("div.rc4-bottom-row", {},
      rc4Signature("Admin Officer"),
      h("div.rc4-mid-col", {},
        verificationCode
          ? qrSvg(platformUrl(`/verify/${verificationCode}`), { size: 78, label: "Report card verification QR code" })
          : h("div.rc4-seal-box", { text: "SCHOOL SEAL" }),
        verificationCode ? h("div.u-xs.u-muted", { text: verificationCode }) : null,
      ),
      rc4Signature(headLabel, headName, headSig),
    ),
    gradeKey(data),
  );
}

function annualSummaryBox(data) {
  const { summary, sessionSummaries } = data;
  const terms = sessionSummaries?.length ? sessionSummaries : [];
  return h("div.rc4-annual-box", {},
    h("div.rc4-annual-title", { text: "Annual / Session Summary" }),
    h("table", {},
      h("thead", {}, h("tr", {},
        terms.map((t) => h("th", { text: `${t.label} Avg` })),
        h("th", { text: "Annual Avg" }),
        h("th", { text: "Annual Grade" }),
        h("th", { text: "Annual Position" }),
      )),
      h("tbody", {}, h("tr", {},
        terms.map((t) => h("td", { text: t.average_score != null ? `${fmt(t.average_score)}%` : "—" })),
        h("td", { text: summary?.annual_average != null ? `${fmt(summary.annual_average)}%` : "—" }),
        h("td", { text: summary?.annual_grade || "—" }),
        h("td", { text: summary?.annual_position_label || "—" }),
      )),
    ),
  );
}

/** Default annual remark keyed off the annual grade, reusing each
 *  school's own configured grading_bands.remark rather than a separate
 *  hardcoded string or a brand-new editable field — the band's remark
 *  is exactly "what this grade means" already, wherever else it's used. */
function annualRemark(data) {
  const grade = data.summary?.annual_grade;
  if (!grade || !data.bands?.length) return "—";
  const band = data.bands.find((b) => b.grade === grade);
  return band?.remark || "—";
}

function rc4Line(label, value) {
  return h("div.rc4-info-line", {},
    h("span.rc4-label", { text: label }),
    h("span.rc4-value", { text: (value === null || value === undefined || value === "") ? "—" : String(value) }));
}

function rc4Signature(label, name, signatureUrl) {
  return h("div.rc4-sign", {},
    signatureUrl ? h("img.rc4-sig-img", { src: signatureUrl, alt: "" }) : null,
    h("div.rc4-sign-line", { "aria-hidden": "true" }),
    h("div.rc4-sign-label", { text: label }),
    name ? h("div.rc4-sign-name", { text: name }) : null);
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDob(d) {
  if (!d) return "—";
  const dob = new Date(d + "T00:00:00");
  if (Number.isNaN(dob.getTime())) return "—";
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return `${formatDate(d)} (${age} yrs)`;
}

/** Whole days between a term's closing date and the next term's
 *  resumption date; "—" if either is missing, per spec. */
function holidayDuration(endsOn, resumesOn) {
  if (!endsOn || !resumesOn) return "—";
  const a = new Date(endsOn + "T00:00:00");
  const b = new Date(resumesOn + "T00:00:00");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
  const days = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return days >= 0 ? `${days} day${days === 1 ? "" : "s"}` : "—";
}

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
    student: { full_name: "Sample Student", admission_no: "ADM/0001", photo_url: null, gender: "female", date_of_birth: "2015-03-14" },
    class: { name: "Primary 5", category: "primary" },
    term: { label: "Third", sessions: { label: "2026/2027" }, ends_on: "2027-07-16", next_term_starts_on: "2027-09-09" },
    scores,
    summary: {
      subjects_count: scores.length,
      total_score: Math.round(totalScore * 10) / 10,
      average_score: Math.round(average * 10) / 10,
      overall_grade: average >= 70 ? "A" : average >= 60 ? "B" : "C",
      class_position: 3, class_size: 32, days_present: 58, days_absent: 3,
      teacher_remark: "A hardworking pupil who participates well in class.",
      head_remark: "Keep up the good work.",
      annual_average: Math.round((average - 1.5) * 10) / 10,
      annual_grade: average >= 70 ? "A" : average >= 60 ? "B" : "C",
      annual_position_label: "4th of 32",
    },
    sessionSummaries: [
      { label: "First", average_score: Math.round((average - 3) * 10) / 10 },
      { label: "Second", average_score: Math.round((average - 1) * 10) / 10 },
      { label: "Third", average_score: Math.round(average * 10) / 10 },
    ],
    headSignatory: { label: "Headmaster", name: school?.headmaster_name || "Headmaster's name", signature_url: null },
    // A fixed, obviously-fake code — previews never call the real
    // verification RPC, so this never touches report_card_verifications.
    verificationCode: template === "pariya" ? "SAMPLE01" : null,
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
