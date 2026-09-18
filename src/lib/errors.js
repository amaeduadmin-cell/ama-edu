/* ===============================================================
   Error handling.

   Two audiences, always separated: the person gets a plain sentence
   telling them what happened and what to do; the console gets the
   technical detail. Postgres error codes and constraint names never
   reach the screen — they leak schema shape to anyone probing.
   =============================================================== */

const BY_CODE = {
  "PGRST301": "Your session has expired. Sign in again to continue.",
  "42501":    "You do not have permission to do that.",
  "23505":    "That record already exists.",
  "23503":    "Something this record depends on is missing or still in use.",
  "23514":    "Some of those values are not allowed. Check the form and try again.",
  "22P02":    "Some of those values are not in the expected format.",
  "PGRST116": "That record was not found, or you do not have access to it.",
  "invalid_credentials": "Those sign-in details are not correct.",
  "email_not_confirmed": "Confirm your email address first, then sign in.",
  "over_request_rate_limit": "Too many attempts. Wait a minute and try again.",
  "weak_password": "Choose a longer password — at least 8 characters.",
};

export class AppError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = "AppError";
    this.cause = cause;
    this.code = code;
  }
}

/** Turn anything thrown into a sentence safe to show a user. */
export function humanError(err, fallback = "Something went wrong. Try again in a moment.") {
  if (!err) return fallback;
  if (err instanceof AppError) return err.message;

  const code = err.code || err.error_code || err.status;
  if (code && BY_CODE[code]) return BY_CODE[code];

  const message = String(err.message || "");
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Cannot reach the server. Check your internet connection and try again.";
  }
  if (/jwt|token|session/i.test(message)) {
    return "Your session has expired. Sign in again to continue.";
  }
  if (err.status === 429) return BY_CODE.over_request_rate_limit;
  if (err.status >= 500)  return "The server is having trouble. Try again shortly.";

  // Supabase Auth messages are written for end users already.
  if (err.name === "AuthApiError" && message) return message;

  return fallback;
}

/** Log technical detail for whoever is debugging, never for the user. */
export function logError(context, err) {
  // eslint-disable-next-line no-console
  console.error(`[AMA EDU] ${context}`, err);
}

/** Wrap a Supabase { data, error } result and throw a clean error. */
export function unwrap(result, context = "request") {
  if (result?.error) {
    logError(context, result.error);
    throw new AppError(humanError(result.error), { cause: result.error, code: result.error.code });
  }
  return result?.data;
}
