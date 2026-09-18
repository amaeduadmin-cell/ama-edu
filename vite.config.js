import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // Lets you hit pas.localhost:5173 / pcp.localhost:5173 in dev so the
    // subdomain tenant resolver can be exercised without production DNS.
    host: true,
  },
  build: {
    target: "es2019",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Supabase is the only heavy dependency; splitting it keeps the
        // landing page payload small for first-time visitors on mobile data.
        manualChunks: { supabase: ["@supabase/supabase-js"] },
      },
    },
  },
});
