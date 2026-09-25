import { h, mount } from "../lib/dom.js";
import { platformUrl } from "../lib/tenant.js";

const content = {
  "/privacy": {
    title: "Privacy policy",
    intro: "AMA EDU helps schools manage enrolment, teaching, fees, results, and parent access. We process school data only to provide and secure those services.",
    sections: [
      ["Data we process", "Schools may store student, parent, staff, academic, attendance, fee, and communication records. Account details and security events are processed to authenticate users and protect each school's tenant."],
      ["School responsibility", "The school is responsible for deciding what information it collects, obtaining appropriate permissions, and responding to data-subject requests. AMA EDU acts as the technology provider for school-managed records."],
      ["Isolation and security", "School records are separated by database-enforced tenant policies. We use authentication, row-level authorization, audit records, encrypted transport, and restricted server-side secrets. No payment secret is stored in browser code."],
      ["Retention and requests", "Schools may request exports or deletion subject to legal, billing, security, and backup-retention requirements. Contact the school administrator or AmaEdu Digital Solutions for platform support."],
    ],
  },
  "/terms": {
    title: "Terms of service",
    intro: "These terms govern use of AMA EDU by schools, staff, students, parents, and platform administrators.",
    sections: [
      ["School accounts", "A school must provide accurate registration details, keep administrator credentials private, and manage its users and permissions. A school may not use AMA EDU to impersonate another school or access another tenant."],
      ["Acceptable operation", "Users must use the platform for legitimate educational administration, follow applicable law, and avoid uploading malicious code, unlawful material, or information they are not authorized to process."],
      ["Availability", "We work to keep AMA EDU reliable but may perform maintenance, apply security controls, or temporarily restrict access to protect the platform and its users."],
      ["Billing", "AMA EDU subscription charges are separate from school-collected student fees. Invoice status, grace periods, and payment-provider events are recorded according to the school's selected plan."],
    ],
  },
  "/acceptable-use": {
    title: "Acceptable use",
    intro: "AMA EDU is an education administration platform. This policy protects schools, learners, families, and the platform itself.",
    sections: [
      ["Do", "Use only accounts and school records you are authorized to access; keep contact and academic records accurate; report security issues; and use exports only for approved school purposes."],
      ["Do not", "Do not probe another school's tenant, share credentials, evade permissions, submit harmful content, scrape private records, abuse payment callbacks, or use the service to discriminate, harass, or defraud."],
      ["Enforcement", "We may suspend accounts, restrict exports, preserve audit records, or notify the school when activity risks data protection, platform reliability, or legal compliance."],
    ],
  },
};

export default function render({ outlet }) {
  const page = content[window.location.pathname] || content["/privacy"];
  document.title = `${page.title} — AMA EDU`;
  mount(outlet, h("div.panel-page", {}, h("article.panel.wide", {},
    h("a.wordmark", { href: platformUrl("/") }, "AMA ", h("b", { text: "EDU" })),
    h("div.panel-head", {}, h("div.eyebrow", { text: "AmaEdu Digital Solutions" }), h("h1.panel-title", { text: page.title }), h("p.panel-sub", { text: page.intro })),
    h("div.u-stack", {}, page.sections.map(([heading, body]) => h("section", {}, h("h2.card-title", { text: heading }), h("p", { text: body })))),
    h("div.panel-foot", {}, h("a", { href: platformUrl("/"), text: "Back to AMA EDU" }), h("span.u-muted", { text: `Last updated ${new Date().toISOString().slice(0, 10)}` })),
  )));
}
