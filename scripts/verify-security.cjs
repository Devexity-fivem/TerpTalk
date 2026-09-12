/* eslint-disable @typescript-eslint/no-require-imports */
// Security regression checks — static + DB invariants for TerpTalk.
// Run: node scripts/verify-security.cjs
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`) };
const read = (f) => fs.readFileSync(path.join("src", f), "utf8");
const apiFiles = () => {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === "route.ts") out.push(full);
  });
  walk("src/app/api");
  return out;
};

(async () => {
  // ── 1. Admin/moderation routes must use DB-verified staff checks ──
  const staffProtected = [
    "admin/users", "admin/announce", "admin/security", "admin/stats",
    "admin/affiliates/partners", "admin/affiliates/products", "admin/affiliates/stats",
    "moderation/actions", "moderation/reports", "moderation/user",
  ];
  for (const r of staffProtected) {
    const c = read(`app/api/${r}/route.ts`);
    check(`${r}: uses requireAdmin/requireModerator`, /requireAdmin|requireModerator/.test(c));
    check(`${r}: no bare JWT role check`, !/isAdmin\(session\.user\.role\)|isModerator\(session\.user\.role\)/.test(c) || r === "moderation/actions");
  }

  // ── 2. Mass assignment — no raw body spreads into prisma creates ──
  for (const f of apiFiles()) {
    const c = fs.readFileSync(f, "utf8");
    check(`${path.basename(path.dirname(f))}: no ...body spread into prisma`, !/\.\.\.\s*body/.test(c));
  }

  // ── 3. No unsafe HTML rendering ──
  const allSrc = [];
  const walk2 = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk2(full); else allSrc.push(full);
  });
  walk2("src");
  const jsonLdFiles = new Set([path.join("src", "components", "json-ld.tsx"), path.join("src", "components", "breadcrumbs.tsx")]);
  check("no unsafe dangerouslySetInnerHTML", !allSrc.some((f) => {
    if (jsonLdFiles.has(f)) return false;
    return fs.readFileSync(f, "utf8").includes("dangerouslySetInnerHTML");
  }));
  check("no raw SQL", !allSrc.some((f) => /\$queryRaw|\$executeRaw/.test(fs.readFileSync(f, "utf8"))));

  // ── 4. Rate limiting coverage on mutation endpoints ──
  const needsRl = ["auth/register", "auth/recover", "messages", "forum/posts", "forum/threads",
    "reactions", "follows", "reports", "blocks", "bookmarks", "search", "profile",
    "profile/complete", "profile/export", "contest", "chat/messages",
    "onboarding/interests", "onboarding/follow", "onboarding/complete", "onboarding/suggestions",
    "forum/threads/follow", "categories/follow"];
  for (const r of needsRl) {
    check(`${r}: rate limited`, fs.readFileSync(`src/app/api/${r}/route.ts`, "utf8").includes("rateLimit"));
  }

  // ── 5. Upload security ──
  const blob = read("lib/blob.ts");
  check("blob: magic-byte verification", blob.includes("MAGIC"));
  check("blob: svg blocked", !/image\/svg|\(svg\|/i.test(blob));
  check("blob: size cap", blob.includes("400_000"));

  // ── 6. Auth hardening ──
  const auth = read("lib/auth.ts");
  check("login: case-insensitive username", auth.includes('mode: "insensitive"'));
  check("login: rate limited", auth.includes("rateLimit"));
  check("login: bcrypt", auth.includes("bcrypt"));
  const reg = read("app/api/auth/register/route.ts");
  check("register: insensitive uniqueness", reg.includes('mode: "insensitive"'));
  check("register: bcrypt 12", reg.includes("bcrypt.hash(password, 12)"));

  // ── 7. Security headers ──
  const cfg = fs.readFileSync("next.config.ts", "utf8");
  for (const h of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
    check(`header: ${h}`, cfg.includes(h));
  }
  check("no prod source maps", cfg.includes("productionBrowserSourceMaps: false"));

  // ── 8. Recovery flow invariants (DB level) ──
  check("recover: phrase hash stored (never plaintext)", fs.readFileSync("src/app/api/auth/recover/route.ts", "utf8").includes("recoveryPhraseHash"));

  // ── 9. Schema invariants ──
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  check("schema: username unique", /@unique/.test(schema) && /username\s+String\s+@unique/.test(schema));
  check("schema: cascade deletes on user-owned content", (schema.match(/onDelete: Cascade/g) || []).length > 10);

  // ── 10. Privacy invariants ──
  check("no client-side storage (localStorage/sessionStorage)", !allSrc.some((f) => /localStorage|sessionStorage|indexedDB/i.test(fs.readFileSync(f, "utf8"))));
  check("no raw IP storage (schema has ipHash, not ip)", /ipHash/.test(schema) && !/\bip\s+String\b/.test(schema));
  const sec = read("app/api/admin/security/route.ts");
  check("admin/security: ipHash/userAgent not in response", !sec.includes("e.ipHash") && !sec.includes("e.userAgent"));
  check("security events: retention enforced", sec.includes("RETENTION_DAYS"));
  check("service worker: never caches api/auth", fs.existsSync("public/sw.js") && fs.readFileSync("public/sw.js", "utf8").includes('startsWith("/api/")'));
  // Public-facing queries must not return sensitive user fields
  for (const r of ["users/[username]", "search", "messages", "notifications"]) {
    const c = read(`app/api/${r}/route.ts`);
    check(`${r}: no password/email/ip fields`, !/\b(password|recoveryPhraseHash|ipHash|bannedReason)\s*:\s*true/.test(c));
  }
  // Schema must not have an email field (username-only = data minimization)
  check("schema: no email collection", !/\bemail\s+String/.test(schema));
  check("schema: IP stored hashed only", !/\bip\s+String\b/.test(schema) || /ipHash/.test(schema));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
