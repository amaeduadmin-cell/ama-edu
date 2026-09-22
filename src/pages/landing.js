/* AMA EDU marketing site — apex domain only. */

import "../styles/marketing.css";
import { h, mount } from "../lib/dom.js";
import { ROOT } from "../lib/tenant.js";
import { renderReportCard, sampleReportCardData } from "../lib/reportcard.js";

export default function render({ outlet }) {
  document.title = "AMA EDU — school management for Nigerian schools";
  mount(outlet, siteNav(), hero(), whatItDoes(), howTenancyWorks(), builtFor(), ctaBand(), siteFooter());
}

/* ---------------- Nav ---------------- */
function siteNav() {
  return h("header.site-nav.no-print", {},
    h("div.shell-width", {},
      h("div.site-nav-inner", {},
        h("a.wordmark", { href: "/" }, "AMA ", h("b", { text: "EDU" })),
        h("nav.site-nav-links", { "aria-label": "Sections" },
          h("a", { href: "#what", text: "What it does" }),
          h("a", { href: "#schools", text: "For many schools" }),
          h("a", { href: "#built", text: "Built for Nigeria" }),
        ),
        h("div.site-nav-cta", {},
          h("a.btn.btn-ghost.btn-sm", { href: "/find-school", text: "Find my school" }),
          h("a.btn.btn-primary.btn-sm", { href: "/register", text: "Register a school" }),
        ),
      )));
}

/* ---------------- Hero ----------------
   The artefact on the right is a report card, because that document
   is the thing this whole system exists to produce, and the one part
   of a school's paperwork every parent already knows on sight. It is
   drawn through renderReportCard() itself (Template 3 — Heritage), so
   what a visitor sees here is exactly what a school actually gets,
   never a hand-built lookalike. */
function hero() {
  return h("section.hero", {},
    h("div.shell-width", {},
      h("div.hero-grid", {},
        h("div", {},
          h("h1", { text: "Every result, every term, every school." }),
          h("p.hero-lede", { text: "AMA EDU runs the whole school on one system — enrolment, scores, report cards, fees and parent access. Each school gets its own portal and its own data, kept completely separate from every other school." }),
          h("a.btn.btn-primary.btn-lg", { href: "/register", text: "Register a school" }),
        ),
        h("div.slip-stage", {},
          h("span.slip-tag.t1", { text: "Positions calculated automatically" }),
          h("span.slip-tag.t2", { text: "Printed or shared as PDF" }),
          reportSlip(),
        ),
      )));
}

function reportSlip() {
  const data = sampleReportCardData({
    school: { name: "AmaEdu Academy", motto: "Knowledge, character, service" },
    template: "heritage",
  });
  return h("div.rc3-frame", { "aria-label": "Example report card" }, renderReportCard(data));
}

/* ---------------- What it does ---------------- */
function whatItDoes() {
  const features = [
    ["Students and enrolment", "Admit students, assign them to classes, move a whole class up at the end of the year, and keep leavers on file without losing their history."],
    ["Scores and grading", "Teachers enter CA1, CA2, CA3 and exam scores for their own subjects. Averages, grades and positions are worked out by the system the moment a score is saved."],
    ["Report cards", "Produce a term report card for one student or a whole class, carrying your school's crest, colours and signatures. Print it or send it as a PDF."],
    ["Staff and permissions", "Give each teacher, headmaster, principal, bursar or registrar exactly the access their job needs. One person can hold more than one role."],
    ["Fees", "Record payments per class and term, see who has paid at a glance, and hold back a result until fees are settled if that is your school's policy."],
    ["Parents and announcements", "Parents see their own children's results and nothing else. Post announcements to the whole school, one class, or staff only."],
  ];

  return h("section.section#what", {},
    h("div.shell-width", {},
      h("h2", { text: "What your school gets" }),
      h("p.section-lede", { text: "The parts of running a school that eat the most time, handled in one place instead of across notebooks, spreadsheets and WhatsApp." }),
      h("div.feature-grid", {}, features.map(([title, body]) =>
        h("article.feature", {}, h("h3", { text: title }), h("p", { text: body })))),
    ));
}

/* ---------------- Multi-tenancy, drawn honestly ---------------- */
function howTenancyWorks() {
  const schools = [
    ["pas", "Pariya Academy for Modern Science & Qur'an", "#0f6b3f"],
    ["pcp", "Pariya Central Primary", "#1d4ed8"],
    ["your-school", "Your school", "#b8862b"],
  ];

  return h("section.section#schools", {},
    h("div.shell-width", {},
      h("h2", { text: "One platform, many schools, no shared data" }),
      h("p.section-lede", { text: "Every school gets its own web address and its own branding. Underneath, the database refuses to return one school's records to anyone signed in at another — that rule is enforced by the database itself, not by the app asking politely." }),
      h("div.tenancy", {},
        h("div.tenancy-root", {},
          h("span.tenancy-dot", { style: { background: "var(--ama-ink)" } }),
          h("span.tenancy-host", { text: ROOT }),
          h("span.tenancy-name.u-small", { text: "Platform — registration and support" }),
        ),
        schools.map(([slug, name, colour]) =>
          h("div.tenancy-row", {},
            h("span.tenancy-dot", { style: { background: colour } }),
            h("span.tenancy-host", { text: `${slug}.${ROOT}` }),
            h("span.tenancy-name", { text: name }),
          )),
      ),
    ));
}

/* ---------------- Built for Nigeria ---------------- */
function builtFor() {
  const points = [
    ["Works on the phone in your pocket", "Score entry, report cards and parent access all work on a mid-range Android on mobile data. Pages load in pieces, so you are never staring at a blank screen."],
    ["Your terms, your grading", "Three terms, CA1 to CA3, your own grade boundaries and remarks. Subjects a student does not offer are left out of their average rather than scored as zero."],
    ["Nothing lost in the move", "Existing rosters come across by pasting a CSV. Schools already running on AMA EDU keep every past term's results."],
  ];

  return h("section.section#built", {},
    h("div.shell-width", {},
      h("h2", { text: "Built for how Nigerian schools actually work" }),
      h("div.feature-grid", {}, points.map(([title, body]) =>
        h("article.feature", {}, h("h3", { text: title }), h("p", { text: body })))),
    ));
}

function ctaBand() {
  return h("section.section", {},
    h("div.shell-width", {},
      h("div.cta-band", {},
        h("h2", { text: "Set your school up this afternoon" }),
        h("p", { text: "Registration takes a few minutes. Pick your web address, add your first classes, and start entering scores." }),
        h("div.u-row.u-wrap", { style: { justifyContent: "center" } },
          h("a.btn.btn-primary.btn-lg", { href: "/register", text: "Register a school" }),
          h("a.btn.btn-outline.btn-lg", { href: "/find-school", text: "Find my school" }),
        ),
      )));
}

function siteFooter() {
  return h("footer.site-foot", {},
    h("div.shell-width", {},
      h("div.site-foot-grid", {},
        h("div", {},
          h("a.wordmark", { href: "/" }, "AMA ", h("b", { text: "EDU" })),
          h("div.u-xs.u-muted", { text: "School management for Nigerian schools" }),
        ),
        h("nav", { "aria-label": "Footer" },
          h("a", { href: "/register", text: "Register" }),
          h("a", { href: "/find-school", text: "Find my school" }),
          h("a", { href: "/login", text: "Platform sign in" }),
        ),
      ),
      h("div.u-xs.u-muted.u-mt-6", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    ));
}
