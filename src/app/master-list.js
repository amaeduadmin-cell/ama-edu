/* ===============================================================
   Master list — full roster for a class, ready to print.

   Ports: renderMasterList / loadMasterList (MyPAS1 app-admin.js).
   =============================================================== */

import "../styles/marketing.css";
import { h, mount, skeleton, safeUrl } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState } from "../lib/ui.js";
import { fetchClasses } from "../lib/data.js";
import { context } from "../main.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "admin", "headmaster", "principal", "teacher", "registrar_primary", "registrar_secondary")) return;

  const state = { classes: [], classId: "" };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Master list", subtitle: "Full roster for a class, ready to print.", body }));

  try {
    state.classes = await fetchClasses();
    state.classId = state.classes[0]?.id || "";
  } catch (err) {
    logError("master-list boot", err);
    return mount(body, errorState(humanError(err)));
  }

  if (!state.classes.length) return mount(body, emptyState({ title: "No classes yet", body: "Add classes from Settings first." }));

  draw();
  await load();

  function draw() {
    const classSel = h("select.select.no-print", { style: { maxWidth: "220px" }, onchange: (e) => { state.classId = e.target.value; load(); } },
      state.classes.map((c) => h("option", { value: c.id, selected: c.id === state.classId, text: c.name })));
    const printBtn = h("button.btn.btn-outline.no-print", { type: "button", text: "Print", onclick: () => window.print() });

    mount(body,
      h("div.u-row.no-print", { style: { marginBottom: "12px" } }, classSel, printBtn),
      h("div#listHost", {}, skeleton(6)),
    );
  }

  async function load() {
    const host = document.getElementById("listHost");
    try {
      const rows = unwrap(
        await supabase.from("students").select("admission_no, full_name, gender, guardian_name, guardian_phone").eq("class_id", state.classId).eq("is_active", true).order("full_name"),
        "fetch roster"
      );
      const klass = state.classes.find((c) => c.id === state.classId);
      renderList(host, klass, rows);
    } catch (err) {
      logError("load roster", err);
      mount(host, errorState(humanError(err), load));
    }
  }

  function renderList(host, klass, rows) {
    const school = context.school;
    const logo = safeUrl(school?.logo_url);

    if (!rows.length) {
      return mount(host, emptyState({ title: "No students in this class", body: "Admit students from the Students page first." }));
    }

    mount(host, h("div.card", { style: { maxWidth: "820px", margin: "0 auto" } },
      h("div.slip-head", {},
        logo ? h("img", { src: logo, alt: "", style: { width: "40px", height: "40px", objectFit: "contain", borderRadius: "6px" } })
             : h("div.slip-crest", { text: (school?.name || "AE").slice(0, 1) }),
        h("div", {},
          h("div.slip-school", { text: school?.name || "School" }),
          h("div.u-xs.u-muted", { text: `Master list — ${klass.name} · ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}` }),
        ),
      ),
      h("table.table.u-mt-4", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "#" }), h("th", { text: "Admission no." }), h("th", { text: "Name" }),
          h("th", { text: "Gender" }), h("th", { text: "Guardian" }), h("th", { text: "Guardian phone" }),
        )),
        h("tbody", {}, rows.map((s, i) => h("tr", {},
          h("td.u-num", { text: i + 1 }),
          h("td.u-num", { text: s.admission_no }),
          h("td", { text: s.full_name }),
          h("td", { text: s.gender ? s.gender[0].toUpperCase() + s.gender.slice(1) : "—" }),
          h("td", { text: s.guardian_name || "—" }),
          h("td", { text: s.guardian_phone || "—" }),
        ))),
      ),
      h("p.u-xs.u-muted.u-mt-4", { text: `${rows.length} students` }),
    ));
  }
}
