/* Helps someone who knows their school's name but not its address. */

import "../styles/marketing.css";
import { h, mount } from "../lib/dom.js";
import { field } from "../lib/ui.js";
import { emptyState } from "../lib/ui.js";
import { supabase } from "../lib/supabase.js";
import { tenantUrl, ROOT } from "../lib/tenant.js";
import { logError } from "../lib/errors.js";

export default function render({ outlet }) {
  document.title = "Find your school — AMA EDU";

  const input = h("input.input", { id: "q", type: "search", placeholder: "Start typing your school's name", autocomplete: "off" });
  const results = h("div.u-stack.u-mt-4");
  let timer;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) return mount(results);
    timer = setTimeout(() => search(term), 300);
  });

  async function search(term) {
    mount(results, h("div.skeleton.skeleton-row"), h("div.skeleton.skeleton-row"));
    try {
      // Returns name + slug for ACTIVE schools only. No contact details,
      // no counts, nothing that would make this a useful scraping target.
      const { data, error } = await supabase.rpc("search_public_schools", { p_term: term });
      if (error) throw error;
      if (!data?.length) {
        return mount(results, emptyState({
          title: "No school with that name",
          body: "Check the spelling, or ask your school for the exact web address they gave you.",
        }));
      }
      mount(results, data.map(school =>
        h("a.tenancy-row", { href: tenantUrl(school.slug, "/login"), "data-native": "true" },
          h("span.tenancy-dot", { style: { background: "var(--ama-green)" } }),
          h("span.u-grow", {},
            h("div", { text: school.name }),
            h("div.u-xs.u-muted", { text: `${school.slug}.${ROOT}` }),
          ),
          h("span.u-small", { text: "Open" }),
        )));
    } catch (err) {
      logError("search_public_schools", err);
      mount(results, emptyState({ title: "Search is unavailable", body: "Try again in a moment." }));
    }
  }

  mount(outlet,
    h("div.panel-page", {},
      h("a.wordmark", { href: "/", style: { marginBottom: "20px" } }, "AMA ", h("b", { text: "EDU" })),
      h("div.panel.wide", {},
        h("div.panel-head", {},
          h("h1.panel-title", { text: "Find your school portal" }),
          h("p.panel-sub", { text: "Every school on AMA EDU has its own address. Search for yours below." }),
        ),
        field({ label: "School name", id: "q", control: input }),
        results,
      ),
      h("div.panel-foot", { text: "Copyright © AMAEdu 2026 All Rights Reserved!" }),
    ));
}
