/* ===============================================================
   Report-card template chooser, shared by the registration wizard
   and Settings so a school sees the same two options with the same
   preview in both places.

   Previews are drawn from sample data (reportcard.js →
   sampleReportCardData), never from a real student.
   =============================================================== */

import { h } from "./dom.js";
import { openModal } from "./ui.js";
import { renderReportCard, sampleReportCardData } from "./reportcard.js";

export const TEMPLATES = [
  {
    code: "classic",
    name: "Template 1 — Classic",
    blurb: "Every assessment column shown separately, one row per subject. Best when parents expect to see each test score.",
  },
  {
    code: "compact",
    name: "Template 2 — Compact",
    blurb: "Continuous assessment combined into one column, with a larger remarks panel. Best for many subjects or narrow paper.",
  },
  {
    code: "heritage",
    name: "Template 3 — Heritage",
    blurb: "A bordered three-column info box, a banner-style title and a bottom signatures row, in the classic Nigerian report-sheet look.",
  },
  {
    code: "pariya",
    name: "Template 4 — Pariya Classic",
    blurb: "The original Pariya report sheet layout: brown-bordered header, green term banner, annual/session summary box and a scannable QR verification code.",
  },
];

export function previewTemplate(code, { school, components } = {}) {
  const meta = TEMPLATES.find((t) => t.code === code);
  const close = openModal({
    title: `Preview — ${meta?.name || code}`,
    wide: true,
    body: h("div", { style: { maxHeight: "68vh", overflow: "auto" } },
      h("p.u-xs.u-muted", { text: "Sample data only. No real student appears here." }),
      renderReportCard(sampleReportCardData({ school, components, template: code }))),
    actions: [h("button.btn.btn-outline", { type: "button", text: "Close", onclick: () => close() })],
  });
}

/**
 * @param value     the currently selected template code
 * @param onChange  called with the new code whenever the choice changes
 */
export function templatePicker({ value, school, components, onChange, name = "rcTemplate" }) {
  let current = value || "classic";
  const cards = TEMPLATES.map((t) => {
    const input = h("input", {
      type: "radio", name, value: t.code, checked: current === t.code,
      style: { width: "20px", height: "20px", flex: "none", marginTop: "2px" },
      onchange: () => { current = t.code; paint(); if (onChange) onChange(t.code); },
    });
    const box = h("div", {
      style: { border: "2px solid var(--ama-line)", borderRadius: "12px", padding: "14px", background: "var(--ama-surface)" },
    },
      h("label.u-row", { style: { gap: "10px", alignItems: "flex-start", cursor: "pointer" } },
        input,
        h("span.u-grow", {},
          h("span", { style: { fontWeight: "700", display: "block" }, text: t.name }),
          h("span.u-xs.u-muted", { text: t.blurb }))),
      h("div.u-row", { style: { marginTop: "10px", justifyContent: "flex-end" } },
        h("button.btn.btn-outline.btn-sm", {
          type: "button", text: "Preview",
          onclick: () => previewTemplate(t.code, { school, components }),
        })),
    );
    return { t, box };
  });

  function paint() {
    cards.forEach(({ t, box }) => {
      const on = current === t.code;
      box.style.borderColor = on ? "var(--ama-green)" : "var(--ama-line)";
      box.style.background = on ? "var(--ama-green-soft)" : "var(--ama-surface)";
    });
  }
  paint();

  const node = h("div", { style: { display: "grid", gap: "12px" }, role: "radiogroup", "aria-label": "Report card template" },
    cards.map((c) => c.box));
  return { node, get value() { return current; } };
}
