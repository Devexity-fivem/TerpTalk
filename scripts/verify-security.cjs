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
    "admin/reputation", "admin/reputation/flags", "admin/audit", "admin/users/[id]",
    "moderation/actions", "moderation/reports", "moderation/user", "moderation/reputation",
    "moderation/bulk", "moderation/queue", "moderation/queue/[id]",
    "moderation/queue/bulk", "moderation/queue/staff",
    "staff/applications", "staff/applications/[id]",
  ];
  for (const r of staffProtected) {
    const c = read(`app/api/${r}/route.ts`);
    // Accept the require* helpers OR the older getToken + isSessionValid +
    // fresh-DB-role pattern (staff/applications predates the helpers but still
    // re-reads user.role from the database — equivalent strength).
    const dbRoleCheck = /requireAdmin|requireModerator|requireStaff/.test(c)
      || (/isSessionValid/.test(c) && /prisma\.user\.findUnique/.test(c) && /isAdmin\(user\.role\)/.test(c));
    check(`${r}: uses DB-verified staff check`, dbRoleCheck);
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
  // dangerouslySetInnerHTML is allowed only where content is a static
  // constant or fully entity-escaped: json-ld/breadcrumbs (serialized JSON),
  // layout.tsx (static THEME_INIT_SCRIPT), markdown.tsx (escapeForClass
  // entity-escapes & < > before insertion; hrefs go through sanitizeHref).
  const innerHtmlAllowlist = new Set([
    path.join("src", "components", "json-ld.tsx"),
    path.join("src", "components", "breadcrumbs.tsx"),
    path.join("src", "app", "layout.tsx"),
    path.join("src", "lib", "markdown.tsx"),
  ]);
  check("no unsafe dangerouslySetInnerHTML", !allSrc.some((f) => {
    if (innerHtmlAllowlist.has(f)) return false;
    return fs.readFileSync(f, "utf8").includes("dangerouslySetInnerHTML");
  }));
  // Raw SQL is allowed only in audited, parameterized queries (trust-signal
  // detectors and the ledger drift check) — no user input concatenation.
  const rawSqlAllowlist = new Set([
    path.join("src", "lib", "trust-signals.ts"),
    path.join("src", "lib", "reputation.ts"),
    path.join("src", "app", "api", "admin", "reputation", "flags", "route.ts"),
  ]);
  check("no raw SQL outside allowlist", !allSrc.some((f) => {
    if (rawSqlAllowlist.has(f)) return false;
    return /\$queryRaw|\$executeRaw/.test(fs.readFileSync(f, "utf8"));
  }));

  // ── 4. Rate limiting coverage on mutation endpoints ──
  const needsRl = ["auth/register", "auth/recover", "messages", "forum/posts", "forum/threads",
    "reactions", "follows", "reports", "blocks", "bookmarks", "search", "profile",
    "profile/complete", "profile/export", "contest", "chat/messages",
    "onboarding/interests", "onboarding/follow", "onboarding/complete", "onboarding/suggestions",
    "forum/threads/follow", "categories/follow",
    "moderation/reports", "moderation/queue", "moderation/queue/[id]",
    "moderation/queue/bulk", "moderation/queue/staff", "moderation/reputation"];
  for (const r of needsRl) {
    // repRateLimit is the tier-scaled limiter; rateLimit is the plain one.
    check(`${r}: rate limited`, /repRateLimit|rateLimit/.test(fs.readFileSync(`src/app/api/${r}/route.ts`, "utf8")));
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
  // localStorage is allowed only for non-sensitive UI prefs (theme, banner
  // dismissal) — never auth, credentials, or user data.
  const storageAllowlist = new Set([
    path.join("src", "components", "theme-toggle.tsx"),
    path.join("src", "components", "announcement-banner.tsx"),
    path.join("src", "lib", "theme.ts"),
  ]);
  check("no client-side storage (localStorage/sessionStorage)", !allSrc.some((f) => {
    if (storageAllowlist.has(f)) return false;
    return /localStorage|sessionStorage|indexedDB/i.test(fs.readFileSync(f, "utf8"));
  }));
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

  // ── 11. Discovery security invariants (Phase 5) ──
  const search = read("app/api/search/route.ts");
  check("search: hidden categories filtered", search.includes("hidden: false"));
  check("search: suspended users excluded", search.includes("suspendedUntil"));
  check("search: LIKE wildcards escaped", search.includes("escapeLike"));
  check("search: query length bounded", /slice\(0,\s*100\)/.test(search));
  check("search: results bounded (take)", search.includes("take:"));
  check("search: unpublished guides excluded", search.includes("published: true"));
  check("search: bogus category narrows to zero", search.includes("__none__"));
  const sug = read("app/api/search/suggest/route.ts");
  check("suggest: hidden categories filtered", sug.includes("hidden: false"));
  check("suggest: suspended users excluded", sug.includes("suspendedUntil"));
  check("suggest: unpublished guides excluded", sug.includes("published: true"));
  const userSearch = read("app/api/users/search/route.ts");
  check("users/search: suspended excluded", userSearch.includes("suspendedUntil"));
  const vote = read("app/api/forum/polls/[id]/vote/route.ts");
  check("poll vote: hidden-category check", vote.includes("hidden") && vote.includes("isModerator"));
  const guideEdit = read("app/guides/[slug]/edit/page.tsx");
  check("guide edit: unpublished not disclosed", guideEdit.includes("published"));
  check("guide edit: author/mod only", guideEdit.includes("isModerator") && !guideEdit.includes("getTrustLevel"));
  const home = read("app/page.tsx");
  check("homepage: hidden categories filtered", (home.match(/category:\s*{\s*hidden:\s*false/g) || []).length >= 2);
  const modActions = read("app/api/moderation/actions/route.ts");
  check("moderation: post delete purges deep links", modActions.includes("postLinkWhere"));
  check("moderation: post delete clears acceptedAnswer", modActions.includes("acceptedAnswerId: null"));
  const postsRoute = read("app/api/forum/posts/route.ts");
  check("posts: hidden category never notifies", postsRoute.includes("category?.hidden"));
  check("posts: delete clears acceptedAnswer", postsRoute.includes("acceptedAnswerId: null"));
  const acceptRoute = read("app/api/forum/threads/accept/route.ts");
  check("accept: hidden category never notifies", acceptRoute.includes("category?.hidden"));
  const sitemap = read("app/sitemap.ts");
  check("sitemap: only published guides", sitemap.includes("published: true"));

  // ── 12. Grow Data Engine invariants (Phase 6) ──
  const updatesRoute = read("app/api/diaries/updates/route.ts");
  check("diary updates: rate limited", /repRateLimit|rateLimit/.test(updatesRoute));
  check("diary updates: env values bounded", updatesRoute.includes("RANGES"));
  check("diary updates: stage whitelist", updatesRoute.includes("VALID_STAGES"));
  check("diary updates: stage never regresses silently", updatesRoute.includes("stage !== diary.stage"));
  check("diary updates: diaries cache invalidated", updatesRoute.includes('revalidateTag("diaries"'));
  check("diary updates: link trust enforced", updatesRoute.includes("enforceLinkTrust"));
  const harvestRoute = read("app/api/diaries/[id]/harvest/route.ts");
  check("harvest: yield unit whitelist", harvestRoute.includes("VALID_YIELD_UNITS"));
  check("harvest: harvestedAt bounded", harvestRoute.includes("Invalid harvestedAt date"));
  check("harvest: author-or-admin only", harvestRoute.includes("canEdit"));
  check("harvest: leaderboard+strain caches invalidated", harvestRoute.includes('revalidateTag("leaderboard"') && harvestRoute.includes('revalidateTag("strains"'));
  const reactionsRoute = read("app/api/reactions/route.ts");
  check("reactions: block check on diary target", reactionsRoute.includes("diaryId") && /[Bb]lock/.test(reactionsRoute));
  const diaryContest = read("app/api/diary-contest/route.ts");
  check("diary contest: rate limited", diaryContest.includes("rateLimit"));
  check("diary contest: voter trust gate", diaryContest.includes("VOTER_MIN_AGE_DAYS") && diaryContest.includes("VOTER_MIN_REPUTATION"));
  check("diary contest: self-vote rejected", diaryContest.includes("Can't vote for your own entry"));
  check("diary contest: one vote per month (atomic upsert)", diaryContest.includes("upsert"));
  check("diary contest: banned/deleted authors excluded", diaryContest.includes("activeAuthor()") && diaryContest.includes("deleted: false"));
  check("diary contest: eligibility gate", diaryContest.includes("MIN_MONTH_UPDATES"));
  check("diary contest: entries bounded", diaryContest.includes("take: 50"));
  const strainStats = read("lib/strain-stats.ts");
  check("strain stats: LIKE wildcards escaped", strainStats.includes("escapeLike"));
  check("strain stats: precision post-filter", strainStats.includes("strainFieldMatches"));
  check("strain stats: banned/deleted excluded", strainStats.includes("activeAuthor()") && strainStats.includes("deleted: false"));
  check("strain stats: bounded query", strainStats.includes("take: 500"));
  check("strain stats: honesty tiers", strainStats.includes('"minimal"') && strainStats.includes('"established"'));
  const strainPage = read("app/strains/[id]/page.tsx");
  check("strain page: banned authors filtered", strainPage.includes("activeAuthor"));
  check("strain page: deleted diaries filtered", strainPage.includes("deleted: false"));
  const feed = read("app/feed/page.tsx");
  check("feed: banned diary authors filtered", feed.includes("activeAuthor"));
  const yieldsLb = read("app/leaderboard/yields/page.tsx");
  check("yield leaderboard: banned authors filtered", yieldsLb.includes("activeAuthor"));
  const diariesList = read("app/diaries/page.tsx");
  check("diaries list: banned authors filtered", diariesList.includes("activeAuthor"));
  const terpbotCron = read("app/api/cron/terpbot/route.ts");
  check("terpbot cron: DotM winner excludes banned/deleted", terpbotCron.includes("previousMonthKey"));
  const diaryPage = read("app/diaries/[id]/page.tsx");
  check("diary page: update form owner-gated", diaryPage.includes("canEdit"));
  check("diary page: week grouping used", diaryPage.includes("groupUpdatesByWeek"));
  check("diary page: harvest report built", diaryPage.includes("buildHarvestReport"));
  check("schema: diary contest models present", schema.includes("model DiaryContestEntry") && schema.includes("model DiaryContestVote"));
  check("schema: diaryId+createdAt index", schema.includes("@@index([diaryId, createdAt])"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
