/* ===============================================================
   Supabase client.

   The URL and anon (publishable) key are public by design — Vite
   inlines them into the bundle and anyone can read them. They are
   NOT what protects data; Row Level Security is. The service role
   key must never appear in this directory: privileged work happens
   in Edge Functions, which read it from Supabase secrets.

   The auth storage key is namespaced per hostname so a session on
   pas.amaedu.com.ng and one on pcp.amaedu.com.ng can coexist in the
   same browser without overwriting each other. Cookies would be
   shared across the wildcard; localStorage is origin-scoped, which
   is the behaviour we want here.
   =============================================================== */

import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON) {
  console.error(
    "[AMA EDU] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
    "Copy .env.example to .env and fill both in, then restart the dev server."
  );
}

const storageKey = `ama.auth.${window.location.hostname.replace(/[^a-z0-9]/gi, "_")}`;

export const supabase = createClient(URL || "", ANON || "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey,
  },
  global: { headers: { "x-ama-client": "web" } },
});

export const hasConfig = Boolean(URL && ANON);
