/* ===============================================================
   Announcements — post to the whole school, one audience, or one
   class; read receipts per viewer.

   Ports: app-announcements.js. In MyPAS1 this file existed but was
   never included in index.html's script tags, so the tab threw
   ReferenceError for every role that had it. Wired up properly here,
   and RLS was widened (migration 0013) so staff managing this page
   can see every announcement regardless of audience — the audience
   gate governs the student/parent-facing feed, not staff visibility.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, field, inlineAlert, confirmAction, toastOk, toastError, openModal } from "../lib/ui.js";
import { fetchClasses, fmtDate } from "../lib/data.js";
import { isStaff, session } from "../lib/auth.js";

const AUDIENCE_LABEL = { all: "Everyone", staff: "Staff only", students: "Students only", parents: "Parents only", class: "One class" };

export default async function render({ outlet }) {
  const canPost = isStaff();
  const body = h("div.u-stack");
  mount(outlet, page({
    title: "Announcements",
    subtitle: canPost ? "Post to the whole school, one audience, or one class." : "Announcements for you.",
    actions: canPost ? [h("button.btn.btn-primary", { type: "button", text: "New announcement", onclick: () => openForm() })] : [],
    body,
  }));

  const classes = canPost ? await fetchClasses().catch(() => []) : [];
  await load();

  async function load() {
    mount(body, h("div.card", {}, skeleton(4)));
    try {
      const rows = unwrap(
        await supabase.from("announcements")
          .select("id, title, body, audience, class_id, is_pinned, published_at, expires_at, classes(name)")
          .order("is_pinned", { ascending: false })
          .order("published_at", { ascending: false }),
        "fetch announcements"
      );
      draw(rows);
    } catch (err) {
      logError("announcements load", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function draw(rows) {
    if (!rows.length) {
      return mount(body, emptyState({
        title: "No announcements yet",
        body: canPost ? "Post one to reach the whole school, or a specific audience." : "Check back later.",
        action: canPost ? h("button.btn.btn-primary.btn-sm", { type: "button", text: "New announcement", onclick: () => openForm() }) : null,
      }));
    }
    mount(body, h("div.u-stack", {}, rows.map((a) => card(a))));
  }

  function card(a) {
    return h("article.card", {},
      h("div.card-head", {},
        h("div", {},
          h("div.u-row", { style: { gap: "8px" } },
            a.is_pinned ? h("span.badge.badge-brass", { text: "Pinned" }) : null,
            h("h3.card-title", { text: a.title }),
          ),
          h("div.card-sub", { text: `${AUDIENCE_LABEL[a.audience]}${a.audience === "class" ? ` — ${a.classes?.name || ""}` : ""} · ${fmtDate(a.published_at)}` }),
        ),
        canPost ? h("div.u-row", { style: { gap: "4px" } },
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: a.is_pinned ? "Unpin" : "Pin", onclick: () => togglePin(a) }),
          h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Delete", onclick: () => remove(a) }),
        ) : null,
      ),
      h("p", { text: a.body }),
    );
  }

  async function togglePin(a) {
    try {
      unwrap(await supabase.from("announcements").update({ is_pinned: !a.is_pinned }).eq("id", a.id), "toggle pin");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }

  async function remove(a) {
    const ok = await confirmAction({ title: "Delete this announcement?", message: `"${a.title}" will be removed for everyone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      unwrap(await supabase.from("announcements").delete().eq("id", a.id), "delete announcement");
      toastOk("Deleted");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }

  function openForm() {
    const titleInput = h("input.input", { required: true });
    const bodyInput = h("textarea.textarea", { required: true, style: { minHeight: "120px" } });
    const audienceSel = h("select.select", {}, Object.entries(AUDIENCE_LABEL).map(([v, l]) => h("option", { value: v, text: l })));
    const classSel = h("select.select.u-hide", {}, classes.map((c) => h("option", { value: c.id, text: c.name })));
    const pinCb = h("input", { type: "checkbox" });
    const errorSlot = h("div");
    const submit = h("button.btn.btn-primary", { type: "submit", form: "annForm", text: "Post" });

    audienceSel.addEventListener("change", () => classSel.classList.toggle("u-hide", audienceSel.value !== "class"));

    let close;
    close = openModal({
      title: "New announcement",
      wide: true,
      body: h("form", { id: "annForm", novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        mount(errorSlot);
        const title = titleInput.value.trim();
        const text = bodyInput.value.trim();
        if (!title || !text) return mount(errorSlot, inlineAlert("Enter a title and a message."));
        if (audienceSel.value === "class" && !classSel.value) return mount(errorSlot, inlineAlert("Choose a class."));

        setBusy(submit, true, "Posting…");
        try {
          unwrap(await supabase.from("announcements").insert({
            school_id: session.schoolId,
            title, body: text,
            audience: audienceSel.value,
            class_id: audienceSel.value === "class" ? classSel.value : null,
            is_pinned: pinCb.checked,
            created_by: session.staffId || null,
          }), "post announcement");
          toastOk("Announcement posted");
          close();
          await load();
        } catch (err) {
          mount(errorSlot, inlineAlert(humanError(err)));
        } finally { setBusy(submit, false); }
      } },
        errorSlot,
        field({ label: "Title", id: "annTitle", control: titleInput }),
        field({ label: "Message", id: "annBody", control: bodyInput }),
        h("div.form-grid.cols-2", {},
          field({ label: "Audience", id: "annAudience", control: audienceSel }),
          field({ label: "Class", id: "annClass", control: classSel }),
        ),
        h("label.u-row", { style: { gap: "8px" } }, pinCb, "Pin to the top"),
      ),
      actions: [submit],
    });
  }
}
