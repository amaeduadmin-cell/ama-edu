import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const failures = [];
const pass = (message) => console.log(`PASS ${message}`);
const fail = (message) => failures.push(message);
const exists = (file) => fs.existsSync(path.join(root, file));

for (const file of ["src/main.js", "src/lib/supabase.js", "public/sw.js", "supabase/config.toml", "TESTING.md", "RELIABILITY.md"]) {
  if (exists(file)) pass(`required artifact: ${file}`); else fail(`missing required artifact: ${file}`);
}

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") walk(full);
    else if (entry.isFile() && full.endsWith(".js")) sourceFiles.push(full);
  }
}
walk(path.join(root, "src"));
for (const file of sourceFiles) {
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
  catch { fail(`JavaScript syntax: ${path.relative(root, file)}`); }
}
if (!failures.some(x => x.startsWith("JavaScript syntax"))) pass(`JavaScript syntax: ${sourceFiles.length} source files`);

const main = fs.readFileSync(path.join(root, "src/main.js"), "utf8");
for (const route of ["/status", "/maintenance", "/privacy", "/terms", "/acceptable-use", "/admin/operations", "/api-access", "/corrections"]) {
  if (main.includes(`\"${route}\"`)) pass(`route registered: ${route}`); else fail(`route not registered: ${route}`);
}
const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
for (const fn of ["payment-webhook", "billing-automation", "data-export", "public-api", "notification-dispatcher"]) {
  if (config.includes(`[functions.${fn}]`)) pass(`Edge Function configured: ${fn}`); else fail(`Edge Function missing from config: ${fn}`);
}

const migrationFiles = fs.readdirSync(path.join(root, "supabase/migrations")).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
const numbers = migrationFiles.map(name => Number(name.split("_", 1)[0]));
const duplicateNumbers = [...new Set(numbers.filter((number, index) => numbers.indexOf(number) !== index))];
if (!duplicateNumbers.length) pass(`migration numbering: ${migrationFiles.length} unique migration files`);
else if (duplicateNumbers.length === 1 && duplicateNumbers[0] === 42 && migrationFiles.filter(name => name.startsWith("0042_")).length === 2) pass("migration numbering: preserved historical 0042 migration pair");
else fail(`unexpected duplicate migration number(s): ${duplicateNumbers.join(", ")}`);
for (const file of ["0057_reliability_backup_dr_foundations.sql", "0058_fix_reliability_runner.sql", "0059_fix_reliability_status.sql", "0060_backup_verification_timestamp.sql", "0061_release_security_checks.sql"]) {
  if (exists(`supabase/migrations/${file}`)) pass(`release migration present: ${file}`); else fail(`release migration missing: ${file}`);
}

if (exists("dist")) {
  const bundleText = fs.readdirSync(path.join(root, "dist/assets")).filter(name => name.endsWith(".js")).map(name => fs.readFileSync(path.join(root, "dist/assets", name), "utf8")).join("\n");
  const secretPatterns = [/SUPABASE_SERVICE_ROLE_KEY\s*[:=]/i, /AUTOMATION_RUNNER_SECRET\s*[:=]/i, /PAYSTACK_SECRET_KEY\s*[:=]/i, /FLUTTERWAVE_SECRET_KEY\s*[:=]/i, /sk_live_[A-Za-z0-9]{8,}/, /sk_test_[A-Za-z0-9]{8,}/, /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/];
  const leaked = secretPatterns.filter(pattern => pattern.test(bundleText));
  if (leaked.length) fail(`possible credential material in dist: ${leaked.map(String).join(", ")}`); else pass("dist secret scan: no credential values or privileged secret names");
} else {
  fail("dist directory missing; run npm run build first");
}

const url = process.env.RELEASE_SUPABASE_URL;
const anon = process.env.RELEASE_SUPABASE_ANON_KEY;
if (url && anon) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  for (const rpc of ["public_platform_maintenance", "public_service_status", "public_platform_content", "public_posts"]) {
    try {
      const args = rpc === "public_posts" ? { p_limit: 5 } : {};
      const { error } = await client.rpc(rpc, args);
      if (error) fail(`anonymous RPC ${rpc}: ${error.message}`); else pass(`anonymous RPC: ${rpc}`);
    } catch (error) { fail(`anonymous RPC ${rpc}: ${error.message}`); }
  }
} else if (process.env.RELEASE_REQUIRE_LIVE === "1") {
  fail("RELEASE_SUPABASE_URL and RELEASE_SUPABASE_ANON_KEY are required when RELEASE_REQUIRE_LIVE=1");
} else {
  console.log("SKIP live anonymous RPCs: set RELEASE_SUPABASE_URL and RELEASE_SUPABASE_ANON_KEY to enable them");
}

const tenantConfig = [process.env.RELEASE_TENANT_A_TOKEN, process.env.RELEASE_TENANT_B_TOKEN, process.env.RELEASE_SCHOOL_A_ID, process.env.RELEASE_SCHOOL_B_ID];
if (tenantConfig.every(Boolean) && url && anon) {
  const tenantTables = ["students", "staff", "classes", "subjects", "terms", "student_scores", "attendance_records", "notifications"];
  for (const [label, token, ownSchool, otherSchool] of [["A", tenantConfig[0], tenantConfig[2], tenantConfig[3]], ["B", tenantConfig[1], tenantConfig[3], tenantConfig[2]]]) {
    const client = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    for (const table of tenantTables) {
      const { data, error } = await client.from(table).select("id,school_id").limit(100);
      if (error) fail(`tenant ${label} ${table}: ${error.message}`);
      else if ((data || []).some(row => row.school_id !== ownSchool || row.school_id === otherSchool)) fail(`tenant ${label} ${table}: cross-school row visible`);
      else pass(`tenant ${label} isolation: ${table}`);
    }
  }
} else if (process.env.RELEASE_REQUIRE_LIVE === "1") {
  fail("tenant isolation tokens and school IDs are required when RELEASE_REQUIRE_LIVE=1");
} else {
  console.log("SKIP authenticated tenant matrix: set RELEASE_TENANT_A_TOKEN, RELEASE_TENANT_B_TOKEN, RELEASE_SCHOOL_A_ID, and RELEASE_SCHOOL_B_ID to enable it");
}

if (failures.length) {
  console.error(`\n${failures.length} release check(s) failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("\nRelease checks passed.");
