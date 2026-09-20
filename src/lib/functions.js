/* ===============================================================
   Calling Edge Functions and keeping the real error message.

   supabase.functions.invoke() reports any non-2xx response as a generic
   "Edge Function returned a non-2xx status code" and leaves the actual
   JSON body ({ error: "You do not have permission…" }) on error.context.
   Reading only `data.error`, as the earlier call sites did, therefore
   never saw the function's own message: every failure surfaced as the
   same vague fallback, which made a genuine permission or validation
   problem look like a broken button.

   invokeFunction() reads that body, logs the technical error for
   whoever is debugging, and throws an AppError carrying the sentence
   the function meant the person to read.
   =============================================================== */

import { supabase } from "./supabase.js";
import { AppError, logError } from "./errors.js";

export async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (!error) {
    if (data?.error) throw new AppError(String(data.error), { code: data.stage || data.code });
    return data;
  }

  logError(`edge function ${name}`, error);

  let message = null;
  let stage = null;
  try {
    const res = error.context;
    if (res && typeof res.clone === "function") {
      const payload = await res.clone().json();
      message = payload?.error ? String(payload.error) : null;
      stage = payload?.stage || null;
    }
  } catch { /* the body was not JSON; fall through to the generic text */ }

  if (!message) {
    message = error.name === "FunctionsFetchError"
      ? "Cannot reach the server. Check your internet connection and try again."
      : error.name === "FunctionsRelayError"
        ? "The service is starting up. Wait a few seconds and try again."
        : "The request could not be completed. Try again in a moment.";
  }
  throw new AppError(message, { cause: error, code: stage });
}
