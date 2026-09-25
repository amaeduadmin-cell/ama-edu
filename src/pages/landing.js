/* AMA EDU marketing site — apex domain only. */

import "../styles/marketing.css";
import { h, mount } from "../lib/dom.js";
import { ROOT } from "../lib/tenant.js";
import { supabase } from "../lib/supabase.js";

export default async function render({ outlet }) {
  document.title = "AMA EDU — school management for Nigerian schools";
  const founderHost = h("div");
  mount(outlet, siteNav(), hero(), proofStrip(), whatItDoes(), howTenancyWorks(), builtFor(), founderHost, ctaBand(), siteFooter());
  try {
    const { data, error } = await supabase.rpc("public_platform_content");
    if (error) throw error;
    const content = Array.isArray(data) ? data[0] : data;
    if (content?.founder_name || content?.founder_history || content?.founder_image_url) mount(founderHost, founderSection(content));
  } catch { /* The public landing page remains usable if CMS content is unavailable. */ }
}

function siteNav() {
  return h("header.site-nav.no-print", {},
    h("div.shell-width", {},
      h("div.site-nav-inner", {},
        h("a.wordmark", { href: "/", "aria-label": "AMA EDU home" }, h("span.wordmark-mark", { text: "A" }), h("span", {}, "AMA ", h("b", { text: "EDU" }))),
        h("nav.site-nav-links", { "aria-label": "Sections" },
          h("a", { href: "#what", text: "Platform" }),
          h("a", { href: "#schools", text: "School portals" }),
          h("a", { href: "#built", text: "Built for Nigeria" }),
        ),
        h("div.site-nav-cta", {},
          h("a.btn.btn-ghost.btn-sm.nav-login", { href: "/find-school", text: "Find my school" }),
          h("a.btn.btn-primary.btn-sm", { href: "/register", text: "Register a school" }),
        ),
      )));
}

function hero() {
  return h("section.hero", {},
    h("div.hero-glow.hero-glow-one"),
    h("div.hero-glow.hero-glow-two"),
    h("div.shell-width", {},
      h("div.hero-grid", {},
        h("div.hero-copy", {},
          h("div.eyebrow", {}, h("span.eyebrow-dot"), "The school operating system for Nigeria"),
          h("h1", {}, "Run the school. ", h("em", { text: "Not the paperwork." })),
          h("p.hero-lede", { text: "AMA EDU brings enrolment, teaching, fees, report cards and parent access into one calm, connected workspace — built for the way Nigerian schools actually work." }),
          h("div.hero-actions", {},
            h("a.btn.btn-primary.btn-lg", { href: "/register", text: "Create your school portal" }),
            h("a.text-link", { href: "/find-school" }, "Already registered? Sign in ", h("span", { text: "→" })),
          ),
          h("div.hero-assurance", {},
            h("span", { text: "No credit card" }), h("i"),
            h("span", { text: "Setup in minutes" }), h("i"),
            h("span", { text: "Works on mobile" }),
          ),
        ),
        h("div.slip-stage", {},
          h("div.slip-orbit orbit-a"), h("div.slip-orbit orbit-b"),
          h("span.slip-tag.t1", { text: "Everything in one place" }),
          h("span.slip-tag.t2", { text: "Built for busy school days" }),
          schoolWorkspacePreview(),
        ),
      )));
}

function schoolWorkspacePreview() {
  return h("div.workspace-preview", { "aria-label": "Illustration of the AmaEdu school workspace" },
    h("div.workspace-topbar", {},
      h("div.workspace-brand", {}, h("span.workspace-brand-mark", { text: "A" }), h("span", { text: "AmaEdu Academy" })),
      h("span.workspace-status", { text: "Term 1 · 2026/27" }),
    ),
    h("div.workspace-body", {},
      h("div.workspace-sidebar", {}, h("span.workspace-sidebar-active", { text: "Overview" }), h("span", { text: "Students" }), h("span", { text: "Classes" }), h("span", { text: "Announcements" })),
      h("div.workspace-content", {},
        h("div.workspace-greeting", {}, h("span", { text: "Good morning, Amina" }), h("small", { text: "Your school at a glance" })),
        h("div.workspace-stats", {},
          statTile("842", "Students", "green"), statTile("38", "Staff", "gold"), statTile("24", "Classes", "blue")),
        h("div.workspace-lower", {},
          h("div.workspace-panel workspace-panel-chart", {}, h("div.workspace-panel-title", { text: "School activity" }), h("div.workspace-bars", {}, [42, 65, 52, 84, 70, 92, 76].map(value => h("span", { style: { height: `${value}%` } })))),
          h("div.workspace-panel", {}, h("div.workspace-panel-title", { text: "Next up" }), h("div.workspace-task", {}, h("span.workspace-task-dot"), h("span", { text: "Complete score entry" })), h("div.workspace-task", {}, h("span.workspace-task-dot gold"), h("span", { text: "Send announcement" }))),
        ),
      ),
    ),
  );
}

function statTile(value, label, tone) {
  return h(`div.workspace-stat ${tone}`, {}, h("strong", { text: value }), h("span", { text: label }));
}

function proofStrip() {
  return h("section.proof-strip", {}, h("div.shell-width", {},
    h("div.proof-item", {}, h("strong", { text: "One source of truth" }), h("span", { text: "for every term" })),
    h("div.proof-item", {}, h("strong", { text: "Private by design" }), h("span", { text: "each school stays separate" })),
    h("div.proof-item", {}, h("strong", { text: "Made for the phone" }), h("span", { text: "where school work happens" })),
  ));
}

function whatItDoes() {
  const features = [
    ["01", "Students and enrolment", "Admit students, assign them to classes, move a whole class up at the end of the year, and keep leavers on file without losing their history."],
    ["02", "Scores and grading", "Teachers enter CA1, CA2, CA3 and exam scores for their own subjects. Averages, grades and positions are worked out the moment a score is saved."],
    ["03", "Report cards", "Produce a term report card for one student or a whole class, carrying your school's crest, colours and signatures. Print it or send it as a PDF."],
    ["04", "Staff and permissions", "Give each teacher, headmaster, principal, bursar or registrar exactly the access their job needs."],
    ["05", "Fees", "Record payments per class and term, see who has paid at a glance, and hold back a result until fees are settled if that is your policy."],
    ["06", "Parents and announcements", "Parents see their own children's results and nothing else. Keep every family close to the school."],
  ];
  return h("section.section.section-light#what", {}, h("div.shell-width", {},
    h("div.section-intro", {}, h("div.eyebrow", { text: "One connected workspace" }), h("h2", { text: "The everyday work of school, made lighter." }), h("p.section-lede", { text: "The parts of running a school that eat the most time, handled in one place instead of across notebooks, spreadsheets and WhatsApp." })),
    h("div.feature-grid", {}, features.map(([number, title, body]) => h("article.feature", {}, h("span.feature-number", { text: number }), h("h3", { text: title }), h("p", { text: body }), h("span.feature-arrow", { text: "↗" })))),
  ));
}

function howTenancyWorks() {
  const schools = [
    ["pas", "Pariya Academy for Modern Science & Qur'an", "#0f6b3f"],
    ["pcp", "Pariya Central Primary", "#1d4ed8"],
    ["your-school", "Your school", "#b8862b"],
  ];
  return h("section.section#schools", {}, h("div.shell-width", {},
    h("div.split-heading", {}, h("div", {}, h("div.eyebrow", { text: "Private school portals" }), h("h2", { text: "One platform. Your school's world." })), h("p.section-lede", { text: "Every school gets its own web address and branding. Your staff, students and parents see only what belongs to your school." })),
    h("div.tenancy", {},
      h("div.tenancy-root", {}, h("span.tenancy-dot", { style: { background: "var(--ama-ink)" } }), h("span.tenancy-host", { text: ROOT }), h("span.tenancy-name.u-small", { text: "Platform — registration and support" })),
      schools.map(([slug, name, colour]) => h("div.tenancy-row", {}, h("span.tenancy-dot", { style: { background: colour } }), h("span.tenancy-host", { text: `${slug}.${ROOT}` }), h("span.tenancy-name", { text: name }))),
    ),
  ));
}

function builtFor() {
  const points = [
    ["Works on the phone in your pocket", "Score entry, report cards and parent access all work on a mid-range Android on mobile data."],
    ["Your terms, your grading", "Three terms, CA1 to CA3, your own grade boundaries and remarks — without forcing your school into someone else's system."],
    ["Nothing lost in the move", "Existing rosters come across by pasting a CSV. Schools keep every past term's results."],
  ];
  return h("section.section.section-dark#built", {}, h("div.shell-width", {},
    h("div.section-intro section-intro-dark", {}, h("div.eyebrow", { text: "Designed for real school days" }), h("h2", { text: "Less chasing. More teaching." }), h("p.section-lede", { text: "A dependable system for the pace, connectivity and responsibilities of Nigerian schools." })),
    h("div.feature-grid built-grid", {}, points.map(([title, body]) => h("article.feature", {}, h("h3", { text: title }), h("p", { text: body })))),
  ));
}

function founderSection(content) {
  const image = content.founder_image_url && /^https:\/\//i.test(content.founder_image_url)
    ? h("img", { src: content.founder_image_url, alt: content.founder_name || "AMA EDU founder", loading: "lazy", referrerpolicy: "no-referrer", style: { width: "100%", maxWidth: "320px", aspectRatio: "4 / 5", objectFit: "cover", borderRadius: "18px", boxShadow: "0 18px 45px rgba(5, 24, 18, .18)" } })
    : h("div", { style: { width: "100%", maxWidth: "320px", aspectRatio: "4 / 5", borderRadius: "18px", background: "linear-gradient(145deg, var(--ama-green-soft), var(--ama-gold-soft))", display: "grid", placeItems: "center", color: "var(--ama-green-deep)", fontSize: "64px", fontWeight: "800" }, text: (content.founder_name || "A").slice(0, 1).toUpperCase() });
  return h("section.section.section-light", {}, h("div.shell-width", {}, h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "clamp(28px, 6vw, 76px)", alignItems: "center" } },
    h("div", { style: { display: "grid", placeItems: "center" } }, image),
    h("div", {}, h("div.eyebrow", { text: "Founder & story" }), h("h2", { text: content.founder_name || "Built with purpose" }), content.founder_title ? h("p", { style: { color: "var(--ama-gold-deep)", fontWeight: "700" }, text: content.founder_title }) : null, h("p.section-lede", { style: { whiteSpace: "pre-line" }, text: content.founder_history || "AMA EDU exists to make excellent school administration more accessible, consistent and human." }))
  )));
}

function ctaBand() {
  return h("section.section.cta-section", {}, h("div.shell-width", {}, h("div.cta-band", {},
    h("div.eyebrow", { text: "Your next term starts here" }), h("h2", { text: "Set your school up this afternoon." }), h("p", { text: "Registration takes a few minutes. Pick your web address, add your first classes, and start entering scores." }),
    h("div.u-row.u-wrap", { style: { justifyContent: "center" } }, h("a.btn.btn-primary.btn-lg", { href: "/register", text: "Register a school" }), h("a.btn.btn-outline.btn-lg", { href: "/find-school", text: "Find my school" })),
  )));
}

function siteFooter() {
  return h("footer.site-foot", {}, h("div.shell-width", {}, h("div.site-foot-grid", {},
    h("div", {}, h("a.wordmark", { href: "/" }, h("span.wordmark-mark", { text: "A" }), h("span", {}, "AMA ", h("b", { text: "EDU" }))), h("div.u-xs.u-muted", { text: "School management for Nigerian schools" })),
    h("nav", { "aria-label": "Footer" }, h("a", { href: "/register", text: "Register" }), h("a", { href: "/find-school", text: "Find my school" }), h("a", { href: "/login", text: "Platform sign in" })),
  ), h("div.u-xs.u-muted.u-mt-6", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" })));
}
