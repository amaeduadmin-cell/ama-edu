/* ===============================================================
   AMA EDU platform admin — public website content, SEO, pricing,
   payment configuration and the blog.

   Everything here is platform-level: RLS on platform_settings,
   platform_posts and platform_payment_settings admits only a
   platform admin for writes. Schools can READ the payment settings
   (they need to know where to pay) but cannot change them, which is
   the "schools must not change AMA EDU's payment destination" rule.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../../lib/dom.js";
import { page } from "../shell.js";
import { supabase } from "../../lib/supabase.js";
import { unwrap, humanError, logError } from "../../lib/errors.js";
import { errorState, field, inlineAlert, toastOk, toastError, emptyState, openModal, confirmAction } from "../../lib/ui.js";
import { session } from "../../lib/auth.js";

const TABS = [["site", "Website"], ["seo", "SEO"], ["plans", "Plans & pricing"], ["payments", "Payments"], ["posts", "Posts"]];

export default async function render({ outlet }) {
  if (!session.isPlatformAdmin) {
    return mount(outlet, page({
      title: "No access",
      body: emptyState({ title: "Platform administrators only", body: "This area manages the AMA EDU public website." }),
    }));
  }

  const state = { tab: "site", settings: null, payments: null, posts: [] };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Public website", subtitle: "What visitors see at amaedu.com.ng.", body }));
  mount(body, skeleton(6));

  await load();

  async function load() {
    try {
      const [settings, payments, posts] = await Promise.all([
        unwrap(await supabase.from("platform_settings").select("*").limit(1), "settings"),
        unwrap(await supabase.from("platform_payment_settings").select("*").limit(1), "payments"),
        unwrap(await supabase.from("platform_posts").select("*").order("created_at", { ascending: false }), "posts"),
      ]);
      state.settings = settings?.[0] || {};
      state.payments = payments?.[0] || {};
      state.posts = posts || [];
      draw();
    } catch (err) {
      logError("platform content", err);
      mount(body, errorState(humanError(err), load));
    }
  }

  function draw() {
    const tabs = h("div.u-row", { style: { gap: "6px", flexWrap: "wrap", marginBottom: "12px" } },
      TABS.map(([k, label]) => h(`button.btn.${state.tab === k ? "btn-primary" : "btn-outline"}.btn-sm`, {
        type: "button", text: label, onclick: () => { state.tab = k; draw(); },
      })));

    const panel = {
      site: sitePanel, seo: seoPanel, plans: plansPanel,
      payments: paymentsPanel, posts: postsPanel,
    }[state.tab]();

    mount(body, tabs, panel);
  }

  /* ---------------- website ---------------- */
  function sitePanel() {
    const s = state.settings;
    const name = h("input.input", { value: s.site_name || "" });
    const tagline = h("input.input", { value: s.tagline || "" });
    const about = h("textarea.input", { rows: "5" }, s.about_text || "");
    const founderName = h("input.input", { value: s.founder_name || "", placeholder: "Founder name" });
    const founderTitle = h("input.input", { value: s.founder_title || "", placeholder: "Founder and education advocate" });
    const founderHistory = h("textarea.input", { rows: "6" }, s.founder_history || "");
    const founderImage = h("input.input", { type: "url", value: s.founder_image_url || "", placeholder: "https://…" });
    const email = h("input.input", { type: "email", value: s.contact_email || "" });
    const phone = h("input.input", { type: "tel", value: s.contact_phone || "" });
    const address = h("input.input", { value: s.contact_address || "" });
    const logo = h("input.input", { type: "url", value: s.logo_url || "" });
    const favicon = h("input.input", { type: "url", value: s.favicon_url || "" });
    const announcement = h("input.input", { value: s.announcement || "" });
    const features = jsonArea(s.features, '[{"title":"Report cards","body":"Printable, per school"}]');
    const faqs = jsonArea(s.faqs, '[{"q":"How much does it cost?","a":"Per student, per term."}]');
    const slot = h("div");

    return card("Website content", slot, [
      row(field({ label: "Site name", id: "pName", control: name }),
          field({ label: "Tagline", id: "pTag", control: tagline })),
      field({ label: "About", id: "pAbout", control: about }),
      row(field({ label: "Founder name", id: "pFounderName", control: founderName }),
          field({ label: "Founder title", id: "pFounderTitle", control: founderTitle })),
      field({ label: "Founder history", id: "pFounderHistory", control: founderHistory, hint: "This appears in the public Founder & story section." }),
      field({ label: "Founder image URL", id: "pFounderImage", control: founderImage, hint: "Use a trusted HTTPS image URL. The platform stores the URL, not an uploaded file." }),
      row(field({ label: "Contact email", id: "pEmail", control: email }),
          field({ label: "Contact phone", id: "pPhone", control: phone })),
      field({ label: "Contact address", id: "pAddr", control: address }),
      row(field({ label: "Logo URL", id: "pLogo", control: logo }),
          field({ label: "Favicon URL", id: "pFav", control: favicon })),
      field({ label: "Site-wide announcement", id: "pAnn", control: announcement, hint: "Leave blank to hide the banner." }),
      field({ label: "Features (JSON)", id: "pFeat", control: features, hint: "A list of { title, body } objects." }),
      field({ label: "FAQs (JSON)", id: "pFaq", control: faqs, hint: "A list of { q, a } objects." }),
    ], async () => {
      const parsedFeatures = parseJson(features.value, slot, "Features");
      if (parsedFeatures === undefined) return false;
      const parsedFaqs = parseJson(faqs.value, slot, "FAQs");
      if (parsedFaqs === undefined) return false;
      return {
        site_name: name.value.trim() || "AMA EDU", tagline: tagline.value.trim() || null,
        about_text: about.value.trim() || null, contact_email: email.value.trim() || null,
        contact_phone: phone.value.trim() || null, contact_address: address.value.trim() || null,
        founder_name: founderName.value.trim() || null, founder_title: founderTitle.value.trim() || null,
        founder_history: founderHistory.value.trim() || null, founder_image_url: founderImage.value.trim() || null,
        logo_url: logo.value.trim() || null, favicon_url: favicon.value.trim() || null,
        announcement: announcement.value.trim() || null,
        features: parsedFeatures, faqs: parsedFaqs,
      };
    }, "platform_settings");
  }

  /* ---------------- SEO ---------------- */
  function seoPanel() {
    const s = state.settings;
    const title = h("input.input", { value: s.seo_title || "", maxlength: "70" });
    const desc = h("textarea.input", { rows: "3", maxlength: "180" }, s.seo_description || "");
    const og = h("input.input", { type: "url", value: s.og_image_url || "" });
    const social = jsonArea(s.social_links, '{"facebook":"https://facebook.com/...","x":"https://x.com/..."}');
    const slot = h("div");

    return card("Search engines and sharing", slot, [
      inlineAlert("These fill the page title, meta description, Open Graph and JSON-LD tags on the public site. Search engines decide for themselves when to index a site — this makes the information available, it does not guarantee listing.", "info"),
      field({ label: "SEO title", id: "sTitle", control: title, hint: "Keep under about 60 characters." }),
      field({ label: "Meta description", id: "sDesc", control: desc, hint: "Keep under about 160 characters." }),
      field({ label: "Sharing image URL", id: "sOg", control: og, hint: "Used for Open Graph and X cards. 1200×630 works well." }),
      field({ label: "Social links (JSON)", id: "sSocial", control: social }),
    ], async () => {
      const parsed = parseJson(social.value, slot, "Social links");
      if (parsed === undefined) return false;
      return {
        seo_title: title.value.trim() || null,
        seo_description: desc.value.trim() || null,
        og_image_url: og.value.trim() || null,
        social_links: parsed,
      };
    }, "platform_settings");
  }

  /* ---------------- plans ---------------- */
  function plansPanel() {
    const s = state.settings;
    const plans = jsonArea(s.plans, '[{"name":"Standard","price":"₦200 / student / term","features":["Report cards","Attendance"]}]');
    const feePolicy = h("select.select", {}, [
      ["block_unpaid", "Block results for unpaid students"],
      ["always_visible", "Do not block results for unpaid students"],
    ].map(([v, l]) => h("option", { value: v, selected: (s.default_result_fee_policy || "block_unpaid") === v, text: l })));
    const slot = h("div");
    return card("Subscription plans and defaults", slot, [
      field({ label: "Plans (JSON)", id: "pPlans", control: plans, hint: "A list of { name, price, features } objects shown on the pricing section." }),
      field({
        label: "Default result policy for new schools", id: "pFeePolicy", control: feePolicy,
        hint: "Applies to schools that register from now on. Each school can change its own setting; existing schools are not touched.",
      }),
    ], async () => {
      const parsed = parseJson(plans.value, slot, "Plans");
      if (parsed === undefined) return false;
      return { plans: parsed, default_result_fee_policy: feePolicy.value };
    }, "platform_settings");
  }

  /* ---------------- payments ---------------- */
  function paymentsPanel() {
    const p = state.payments;
    const gatewayEnabled = h("input", { type: "checkbox", checked: p.gateway_enabled === true, style: { width: "20px", height: "20px" } });
    const method = h("select.select", {}, [
      ["bank_transfer", "Bank transfer only"], ["gateway", "Payment gateway only"], ["both", "Both"],
    ].map(([v, l]) => h("option", { value: v, selected: p.method === v, text: l })));
    const bank = h("input.input", { value: p.bank_name || "" });
    const accName = h("input.input", { value: p.account_name || "" });
    const accNo = h("input.input", { value: p.account_number || "", inputmode: "numeric" });
    const instructions = h("textarea.input", { rows: "3" }, p.payment_instructions || "");
    const gateway = h("input.input", { value: p.gateway_name || "", placeholder: "e.g. Paystack" });
    const gatewayKey = h("input.input", { value: p.gateway_public_key || "", placeholder: "pk_live_..." });
    const price = h("input.input", { type: "number", min: "0", step: "1", value: p.price_per_student ?? "" });
    const period = h("select.select", {}, [
      ["monthly", "Monthly"], ["termly", "Per term"], ["annually", "Annually"],
    ].map(([v, l]) => h("option", { value: v, selected: p.billing_period === v, text: l })));
    const slot = h("div");

    return card("How schools pay AMA EDU", slot, [
      inlineAlert("This is AMA EDU's own subscription billing. It is separate from the fees a school collects from its students, and a school cannot change these details.", "info"),
      h("label.u-row", { style: { gap: "8px", margin: "8px 0 14px" } }, gatewayEnabled, h("span", { text: "Payment gateway connected and available" })),
      inlineAlert("The publishable key is safe for the browser. Keep the gateway secret key in Supabase Edge Function secrets (for example PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY), never in this database or frontend. Untick the connection above and save to disconnect gateway payments immediately.", "info"),
      field({ label: "Method", id: "payMethod", control: method }),
      row(field({ label: "Bank name", id: "payBank", control: bank }),
          field({ label: "Account name", id: "payAccName", control: accName })),
      field({ label: "Account number", id: "payAccNo", control: accNo }),
      field({ label: "Payment instructions", id: "payNote", control: instructions }),
      row(field({ label: "Gateway", id: "payGw", control: gateway }),
          field({ label: "Gateway publishable key", id: "payKey", control: gatewayKey, hint: "Publishable key only. Secret keys belong in Edge Function secrets, never in the database." })),
      row(field({ label: "Price per student", id: "payPrice", control: price }),
          field({ label: "Billing period", id: "payPeriod", control: period })),
    ], async () => ({
      method: method.value,
      bank_name: bank.value.trim() || null, account_name: accName.value.trim() || null,
      account_number: accNo.value.trim() || null,
      payment_instructions: instructions.value.trim() || null,
      gateway_name: gateway.value.trim() || null,
      gateway_public_key: gatewayKey.value.trim() || null,
      gateway_enabled: gatewayEnabled.checked,
      gateway_disconnected_at: gatewayEnabled.checked ? (p.gateway_disconnected_at || null) : new Date().toISOString(),
      price_per_student: price.value ? Number(price.value) : null,
      billing_period: period.value,
    }), "platform_payment_settings");
  }

  /* ---------------- posts ---------------- */
  function postsPanel() {
    return h("div", {},
      h("div.u-row", { style: { justifyContent: "flex-end", marginBottom: "10px" } },
        h("button.btn.btn-primary.btn-sm", { type: "button", text: "New post", onclick: () => openPost() })),
      state.posts.length
        ? h("div.card.card-flush", {}, h("div.table-wrap", {}, h("table.table", {},
            h("thead", {}, h("tr", {},
              h("th", { text: "Title" }), h("th", { text: "Slug" }),
              h("th", { text: "Status" }), h("th", { text: "Published" }), h("th", { text: "" }))),
            h("tbody", {}, state.posts.map((p) => h("tr", {},
              h("td", { text: p.title }),
              h("td.u-xs.u-muted", { text: `/blog/${p.slug}` }),
              h("td", {}, h(`span.badge.${p.is_published ? "badge-ok" : "badge"}`, { text: p.is_published ? "Published" : "Draft" })),
              h("td.u-xs.u-muted", { text: p.published_at ? new Date(p.published_at).toLocaleDateString() : "—" }),
              h("td", {}, h("div.u-row", { style: { gap: "6px", justifyContent: "flex-end" } },
                h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Edit", onclick: () => openPost(p) }),
                h("button.btn.btn-ghost.btn-sm", { type: "button", text: p.is_published ? "Unpublish" : "Publish", onclick: (e) => togglePost(e.target, p) }),
                h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Delete", onclick: () => deletePost(p) }),
              )),
            ))),
          )))
        : emptyState({ title: "No posts yet", body: "Write your first post for the public site." }),
    );
  }

  function openPost(existing = null) {
    const title = h("input.input", { value: existing?.title || "", required: true });
    const slug = h("input.input", { value: existing?.slug || "", placeholder: "my-first-post" });
    const excerpt = h("textarea.input", { rows: "2" }, existing?.excerpt || "");
    const bodyText = h("textarea.input", { rows: "10" }, existing?.body || "");
    const image = h("input.input", { type: "url", value: existing?.featured_image_url || "" });
    const seoTitle = h("input.input", { value: existing?.seo_title || "" });
    const seoDesc = h("textarea.input", { rows: "2" }, existing?.seo_description || "");
    const slot = h("div");
    const save = h("button.btn.btn-primary", { type: "button", text: existing ? "Save changes" : "Create post" });

    title.addEventListener("input", () => {
      if (!existing && !slug.dataset.touched) slug.value = slugify(title.value);
    });
    slug.addEventListener("input", () => { slug.dataset.touched = "1"; });

    const close = openModal({
      title: existing ? "Edit post" : "New post", wide: true,
      body: h("div", {}, slot,
        row(field({ label: "Title", id: "poTitle", control: title }),
            field({ label: "Slug", id: "poSlug", control: slug, hint: "Lower case, hyphens only." })),
        field({ label: "Excerpt", id: "poExcerpt", control: excerpt }),
        field({ label: "Body", id: "poBody", control: bodyText, hint: "Plain text. It is rendered as text, never as HTML, so a post can never inject a script into the public site." }),
        field({ label: "Featured image URL", id: "poImage", control: image }),
        row(field({ label: "SEO title", id: "poSeoT", control: seoTitle }),
            field({ label: "SEO description", id: "poSeoD", control: seoDesc })),
      ),
      actions: [h("button.btn.btn-outline", { type: "button", text: "Cancel", onclick: () => close() }), save],
    });

    save.addEventListener("click", async () => {
      mount(slot);
      const s = slugify(slug.value || title.value);
      if (title.value.trim().length < 2) return mount(slot, inlineAlert("Give the post a title."));
      if (!/^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/.test(s)) return mount(slot, inlineAlert("That slug is not valid. Use lower-case letters, numbers and hyphens."));
      if (bodyText.value.trim().length < 2) return mount(slot, inlineAlert("Write the body of the post."));
      setBusy(save, true, "Saving…");
      const payload = {
        title: title.value.trim(), slug: s,
        excerpt: excerpt.value.trim() || null, body: bodyText.value,
        featured_image_url: image.value.trim() || null,
        seo_title: seoTitle.value.trim() || null,
        seo_description: seoDesc.value.trim() || null,
        author_name: session.fullName || "AMA EDU",
      };
      try {
        if (existing) unwrap(await supabase.from("platform_posts").update(payload).eq("id", existing.id), "update post");
        else unwrap(await supabase.from("platform_posts").insert(payload), "create post");
        toastOk(existing ? "Post updated" : "Post created");
        close();
        await load();
      } catch (err) {
        mount(slot, inlineAlert(humanError(err, "That post could not be saved. The slug may already be in use.")));
      } finally { setBusy(save, false); }
    });
  }

  async function togglePost(btn, p) {
    setBusy(btn, true, "…");
    try {
      unwrap(await supabase.from("platform_posts").update({
        is_published: !p.is_published,
        published_at: !p.is_published ? new Date().toISOString() : p.published_at,
      }).eq("id", p.id), "toggle post");
      toastOk(!p.is_published ? "Published" : "Unpublished");
      await load();
    } catch (err) { toastError(humanError(err)); } finally { setBusy(btn, false); }
  }

  async function deletePost(p) {
    const ok = await confirmAction({
      title: "Delete this post?", message: `"${p.title}" will be removed from the public site.`,
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    try {
      unwrap(await supabase.from("platform_posts").delete().eq("id", p.id), "delete post");
      toastOk("Deleted");
      await load();
    } catch (err) { toastError(humanError(err)); }
  }

  /* ---------------- small helpers ---------------- */
  function card(title, slot, fields, collect, table) {
    const save = h("button.btn.btn-primary", { type: "button", text: "Save" });
    save.addEventListener("click", async () => {
      mount(slot);
      const payload = await collect();
      if (payload === false) return;
      setBusy(save, true, "Saving…");
      try {
        unwrap(await supabase.from(table).update(payload).eq("id", true), "save settings");
        toastOk("Saved");
        await load();
      } catch (err) {
        mount(slot, inlineAlert(humanError(err, "Those settings could not be saved.")));
      } finally { setBusy(save, false); }
    });
    return h("div.card", {},
      h("h2.card-title", { text: title }), slot, ...fields,
      h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "12px" } }, save));
  }

  function row(a, b) { return h("div.form-grid.cols-2", {}, a, b); }

  function jsonArea(value, placeholder) {
    // A textarea's text is its CHILD, not a value attribute (browsers ignore
    // the attribute), so it is passed as content.
    return h("textarea.input", {
      rows: "6", placeholder,
      style: { fontFamily: "ui-monospace, monospace", fontSize: "12px" },
    }, value ? JSON.stringify(value, null, 2) : "");
  }

  function parseJson(text, slot, label) {
    const raw = text.trim();
    if (!raw) return label === "Social links" ? {} : [];
    try { return JSON.parse(raw); }
    catch { mount(slot, inlineAlert(`${label} is not valid JSON. Check the brackets and commas.`)); return undefined; }
  }

  function slugify(v) {
    return String(v || "").toLowerCase().trim()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 80);
  }
}
