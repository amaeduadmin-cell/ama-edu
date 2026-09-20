/* ===============================================================
   Realtime "something changed" signals (migration 0030).

   The server sends ONLY the name of the table that changed, on a
   private channel that belongs to one school. Nothing here receives
   row data. A page that cares registers a callback with
   onDataChanged() and re-fetches through its normal RLS-protected
   queries, so a signal can never show anyone something they could not
   already read.

   Everything is best-effort. If realtime is unavailable the app works
   exactly as before; people just need to refresh to see new data.
   =============================================================== */

import { supabase } from "./supabase.js";
import { session } from "./auth.js";
import { logError } from "./errors.js";

let channel = null;
let subscribedSchool = null;
let timer = null;
const handlers = new Set();

export function startRealtime() {
  if (!session.authed || !session.schoolId) return stopRealtime();
  if (subscribedSchool === session.schoolId && channel) return;

  stopRealtime();
  subscribedSchool = session.schoolId;
  try {
    channel = supabase
      .channel(`school:${session.schoolId}`, { config: { private: true } })
      .on("broadcast", { event: "changed" }, notify)
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          logError("realtime subscribe", err || new Error(status));
        }
      });
  } catch (err) {
    logError("realtime start", err);
  }
}

export function stopRealtime() {
  if (channel) {
    try { supabase.removeChannel(channel); } catch (err) { logError("realtime stop", err); }
  }
  channel = null;
  subscribedSchool = null;
}

/** Register a callback for the CURRENT page. Returns an unsubscribe. */
export function onDataChanged(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

/** Called whenever a new page renders, so a previous page's callback
 *  cannot fire against a screen that no longer exists. */
export function clearDataChangedHandlers() {
  handlers.clear();
}

// One action often touches several rows (a register is a session plus
// its records), so wait a moment and refresh once instead of five times.
function notify() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    handlers.forEach((fn) => {
      try { fn(); } catch (err) { logError("realtime handler", err); }
    });
  }, 1200);
}
