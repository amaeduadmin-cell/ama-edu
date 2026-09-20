// ===============================================================
// Minimal transactional-email helper shared by Edge Functions.
//
// Deliberately provider-agnostic at the call site: every caller uses
// sendEmail({ to, subject, html, text }) and knows nothing about
// Resend specifically. Swapping providers later means editing this
// one file, not every function that sends mail.
//
// With no RESEND_API_KEY configured, this logs and returns instead of
// throwing -- email is a nice-to-have on top of a working registration
// or login, never a blocker for either.
// ===============================================================

export async function sendEmail(
  { to, subject, html, text }: { to: string; subject: string; html?: string; text?: string },
) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "AMA EDU <no-reply@amaedu.com.ng>";

  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set -- skipping "${subject}" to ${to}`);
    return { skipped: true as const };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, text: text ?? html?.replace(/<[^>]+>/g, "") }),
    });
    if (!res.ok) {
      console.error(`[email] Resend API responded ${res.status}: ${await res.text().catch(() => "")}`);
      return { error: true as const, status: res.status };
    }
    return { sent: true as const };
  } catch (err) {
    console.error("[email] send failed", err);
    return { error: true as const };
  }
}

/** HTML-escape user-supplied text before interpolating it into an email body. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
