/* Root of a school portal: send people where they belong. */

import { session, loadSession } from "../lib/auth.js";
import { navigate } from "../lib/router.js";
import { landingRouteFor } from "../main.js";

export default async function render() {
  if (!session.ready) await loadSession();
  navigate(session.authed ? landingRouteFor() : "/login", { replace: true });
}
