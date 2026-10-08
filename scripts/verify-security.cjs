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
    check(`${r}: no bare JWT role check`, !/isAdmin\(session\.user\.role\)|isModerator\(session\.user\.role\)/.test(c));
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
  // detectors, the ledger drift check, and the distinct-day streak query) —
  // no user input concatenation.
  const rawSqlAllowlist = new Set([
    path.join("src", "lib", "trust-signals.ts"),
    path.join("src", "lib", "reputation.ts"),
    path.join("src", "lib", "grow-streak.ts"),
    path.join("src", "lib", "challenges.ts"),
    path.join("src", "lib", "quests.ts"),
    // Rep 3.0: ledger aggregates (streak days, mutual-like detection,
    // milestone/badge checks) — all parameterized tagged templates.
    path.join("src", "lib", "streaks.ts"),
    path.join("src", "lib", "grow-streak.ts"),
    path.join("src", "lib", "trust-signals.ts"),
    path.join("src", "lib", "reputation.ts"),
    // Progression V2: drift reconciliation + long-content quest counters —
    // parameterized tagged templates, no user input concatenated.
    path.join("src", "lib", "progression.ts"),
    path.join("src", "lib", "challenges.ts"),
    path.join("src", "app", "api", "admin", "reputation", "flags", "route.ts"),
    // DISTINCT ON (partner) inbox query — reviewed raw SQL.
    path.join("src", "app", "api", "messages", "route.ts"),
    // Ops dashboard: unique-contributor UNION + rate-limit GROUP BY —
    // parameterized tagged template, no user input.
    path.join("src", "lib", "ops-metrics.ts"),
    // lockUserRow: parameterized FOR UPDATE row lock serializing
    // check-then-act dedupe/cap writes inside interactive transactions.
    path.join("src", "lib", "prisma.ts"),
    // Grow Journey compact update scan — parameterized tagged template;
    // the only interpolation is MEANINGFUL_UPDATE_SQL (a static fragment)
    // and the parameterized diaryId.
    path.join("src", "lib", "grow-journey.ts"),
    // rateLimitMany: multi-row upsert — the only interpolated fragment is
    // a statically generated "($N, 1, $M)" placeholder list; every key and
    // expiry value travels as a bound parameter.
    path.join("src", "lib", "rate-limit.ts"),
    // Answer-recruitment: per-category participation GROUP BY queries —
    // parameterized tagged templates, categoryId/userId bound params only.
    path.join("src", "lib", "answer-match.ts"),
    // Activation milestones: column-to-column (createdAt + 24h) and
    // reply-vs-own-thread joins — parameterized tagged templates, the
    // cohort id array is a bound ANY($1) param; no string interpolation.
    path.join("src", "lib", "activation.ts"),
    // Social Grow Updates: per-update inline comment window — one
    // ROW_NUMBER() OVER (PARTITION BY diaryUpdateId) pass instead of N
    // queries. Parameterized tagged template; the update-id and blocked-id
    // arrays are bound ANY($n::text[]) params, the window size a bound int.
    path.join("src", "lib", "update-social.ts"),
  ]);
  check("no raw SQL outside allowlist", !allSrc.some((f) => {
    if (rawSqlAllowlist.has(f)) return false;
    return /\$queryRaw|\$executeRaw/.test(fs.readFileSync(f, "utf8"));
  }));

  // ── 3b. Reputation V1 freeze contract ──
  // The V1 ledger is frozen: no member-facing API route may import the award
  // path. Live writes are allowed only in the defined compatibility paths —
  // reversal/reinstate (terpbot-events.js residue drain, update-reversals
  // cron, moderation reinstate) — which import reputation-config, never the
  // award engine. Guard: no route under src/app/api may import
  // awardReputation/applyReputationAward.
  const v1Writers = /awardReputation|applyReputationAward/
  const violating = apiFiles().filter((f) => v1Writers.test(fs.readFileSync(f, "utf8")));
  check("v1 freeze: no API route writes the V1 ledger", violating.length === 0);

  // ── 4. Rate limiting coverage on mutation endpoints ──
  const needsRl = ["auth/register", "auth/recover", "messages", "forum/posts", "forum/threads",
    "reactions", "follows", "reports", "blocks", "bookmarks", "search", "profile",
    "profile/complete", "profile/export", "contest", "chat/messages",
    "onboarding/interests", "onboarding/complete", "onboarding/suggestions",
    "forum/threads/follow", "categories/follow",
    "moderation/reports", "moderation/queue", "moderation/queue/[id]",
    "moderation/queue/bulk", "moderation/queue/staff", "moderation/reputation"];
  for (const r of needsRl) {
    // repRateLimit was the tier-scaled limiter; progressionRateLimit is its
    // V2 rank-scaled successor; rateLimit is the plain one.
    check(`${r}: rate limited`, /progressionRateLimit|repRateLimit|rateLimit/.test(fs.readFileSync(`src/app/api/${r}/route.ts`, "utf8")));
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
  // All public username surfaces resolve case-insensitively. The public
  // profile route delegates to lib/public-profile.ts, so the invariant
  // checks the file that actually performs the lookup.
  for (const f of [
    "app/u/[username]/page.tsx",
    "lib/public-profile.ts",
    "app/api/users/[username]/card/route.ts",
    "app/api/auth/register/route.ts",
  ]) {
    check(`${f}: insensitive username lookup`, read(f).includes('mode: "insensitive"'));
  }
  check("public profile route shares the aggregation lib", read("app/api/users/[username]/route.ts").includes("getPublicProfileData"));
  // Register: captcha claim is atomic; Turnstile fails closed in prod.
  check("register: captcha atomic claim", reg.includes("updateMany") && reg.includes("used: false") && reg.includes("expiresAt"));
  check("register: Turnstile fails closed in prod", /turnstile_not_configured|production/.test(reg));
  check("register: captchaId type guard", reg.includes('typeof captchaId !== "string"'));

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
    // Chat last-seen timestamps + last-room id — non-sensitive UI state,
    // deliberately client-side so read state is never stored server-side.
    path.join("src", "lib", "chat-client.ts"),
    path.join("src", "components", "chat-panel.tsx"),
    path.join("src", "components", "chat-room.tsx"),
    // Per-session dismissal flag for the recovery-phrase banner.
    path.join("src", "components", "recovery-warning-banner.tsx"),
    // Push invitation "Not now"/declined flag — one boolean, no identity,
    // so a dismissed or declined member is never re-prompted on this device.
    path.join("src", "components", "push-toggle.tsx"),
    // ⌘K discoverability hint — one-time "palette seen" flag.
    path.join("src", "components", "navigation.tsx"),
    // Diary update drafts — text-only unsaved form fields, scoped by
    // user+diary id in the key so drafts never cross accounts or grows.
    path.join("src", "components", "update-form.tsx"),
    // AsyncLocalStorage (node:async_hooks) — server-side request scope,
    // not browser storage; the class name trips the literal scan.
    path.join("src", "lib", "query-count.ts"),
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
  {
    const sw = fs.readFileSync("public/sw.js", "utf8");
    // Every precached STATIC entry must be servable by the fetch handler's
    // isStatic extension allowlist — a dead precache entry is wasted work.
    const isStaticExt = /\.(png|jpg|jpeg|webp|svg|ico|js|css|woff2?)$/;
    const statics = (sw.match(/const\s+STATIC\s*=\s*\[([^\]]*)\]/)?.[1].match(/"[^"]+"/g) || []).map((s) => s.slice(1, -1));
    check("service worker: precache list only servable extensions", statics.every((s) => isStaticExt.test(s)));
  }
  {
    // Operator backup script must never interpolate the DB URL (credentials)
    // into a shell command line — arg array only.
    const backup = fs.readFileSync("scripts/backup.ts", "utf8");
    check("backup: pg_dump invoked without shell interpolation", !/execSync\s*\(`/.test(backup) && backup.includes("execFileSync"));
  }
  // Public-facing queries must not return sensitive user fields
  for (const r of ["users/[username]", "search", "messages", "notifications"]) {
    const c = read(`app/api/${r}/route.ts`);
    check(`${r}: no password/email/ip fields`, !/\b(password|recoveryPhraseHash|ipHash|bannedReason)\s*:\s*true/.test(c));
  }
  // Schema must not have an email field (username-only = data minimization)
  check("schema: no email collection", !/\bemail\s+String/.test(schema));
  check("schema: IP stored hashed only", !/\bip\s+String\b/.test(schema) || /ipHash/.test(schema));

  // ── 11. Discovery security invariants ──
  const search = read("app/api/search/route.ts");
  check("search: hidden categories filtered", search.includes("hidden: false"));
  check("search: suspended users excluded", search.includes("suspendedUntil") || search.includes("activeAuthor()"));
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
  const home = read("app/(home)/page.tsx");
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

  // ── 12. Grow Data Engine invariants ──
  const updatesRoute = read("app/api/diaries/updates/route.ts");
  check("diary updates: rate limited", /repRateLimit|rateLimit/.test(updatesRoute));
  check("diary updates: env values bounded", updatesRoute.includes("RANGES"));
  check("diary updates: stage whitelist", /UPDATE_STAGES\.has\(stage\)|VALID_STAGES/.test(updatesRoute));
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
  const diariesList = read("app/diaries/(index)/page.tsx");
  check("diaries list: banned authors filtered", diariesList.includes("activeAuthor"));
  const terpbotCron = read("app/api/cron/terpbot/route.ts");
  check("terpbot cron: DotM winner excludes banned/deleted", terpbotCron.includes("previousMonthKey"));
  const diaryPage = read("app/diaries/[id]/page.tsx");
  check("diary page: update form owner-gated", diaryPage.includes("canEdit"));
  check("diary page: week grouping used", diaryPage.includes("groupUpdatesByWeek"));
  check("diary page: harvest report built", diaryPage.includes("buildHarvestReport"));
  check("schema: diary contest models present", schema.includes("model DiaryContestEntry") && schema.includes("model DiaryContestVote"));
  check("schema: diaryId+createdAt index", schema.includes("@@index([diaryId, createdAt])"));

  // ── 13. Progression — milestones, celebrations, Garden Perks ──
  const repLib = read("lib/reputation.ts");
  check("reputation: milestone markers are zero-amount ledger rows",
    repLib.includes("REP_EVENT_TYPES.MILESTONE") && repLib.includes("amount: 0"));
  check("reputation: tier milestones claimed once-ever",
    repLib.includes("claimMilestone") && repLib.includes("`milestone:tier:"));
  check("reputation: stage milestones claimed once-ever",
    repLib.includes("`milestone:stage:"));
  check("reputation: demotion prunes pinned harvest + pins",
    repLib.includes("enforcePinnedHarvest") && repLib.includes("pinned: false"));
  check("reputation: rung crossings derived from REP_LADDER",
    repLib.includes("crossedRungs("));
  const repCfg2 = read("lib/reputation-config.ts");
  const pubBlock = repCfg2.slice(repCfg2.indexOf("PUBLIC_REP_TYPES"), repCfg2.indexOf("])", repCfg2.indexOf("PUBLIC_REP_TYPES")));
  check("config: MILESTONE never public", !/["']MILESTONE["']/.test(pubBlock));
  const profileRoute = read("app/api/profile/route.ts");
  check("profile: pinned-harvest write gated by the unlock",
    profileRoute.includes('hasUnlock(userId, "pinned-harvest")'));
  const notifyLib = read("lib/notify.ts");
  check("notify: metadata reaches push DTO", notifyLib.includes("metadata: n.metadata"));
  const chatMessages = read("app/api/chat/messages/route.ts");
  const chatCommands = read("app/api/chat/commands/route.ts");
  const terpbotLib = read("lib/terpbot.ts");
  check("chat: all three DTO sites use chatAuthorSelect",
    chatMessages.includes("chatAuthorSelect") && chatCommands.includes("chatAuthorSelect") && terpbotLib.includes("chatAuthorSelect"));
  const chatRoom = read("components/chat-room.tsx");
  check("chat: no cosmetic fields emitted or rendered",
    !chatMessages.includes("avatarFrame") && !chatRoom.includes("avatarFrame"));
  const celebration = read("components/milestone-celebration.tsx");
  check("celebration: polite live region", celebration.includes('role="status"'));
  check("celebration: Escape dismiss", celebration.includes('e.key === "Escape"'));
  check("celebration: client-side dedupe by notification id", celebration.includes("seen.current.has"));
  check("celebration: no metadata = no celebration", /!\[[^\]]*"tier"[^\]]*"stage"[^\]]*"badge"[^\]]*\]\.includes\(kind\)/.test(celebration));
  const progRoute = read("app/api/progression/route.ts");
  check("progression api: owner-only (session + no-store)",
    progRoute.includes("session?.user?.id") && progRoute.includes("no-store"));

  // ── 14. Cron route fail-loud contracts ──
  const cronSrc = read("app/api/cron/terpbot/route.ts");
  check("cron: BotEvent markers prevent duplicate announcements", cronSrc.includes("wasAnnounced"));
  for (const t of ["digest post to #general failed", "grower-of-the-week post to #general failed",
    "contest-winner post to #general failed", "diary-contest-winner post to #general failed"]) {
    check(`cron: throws on failure — ${t}`, cronSrc.includes(`throw new Error("${t}")`));
  }

  // ── 15. Input bound + payout floor contracts ──
  const diariesPost = read("app/api/diaries/route.ts");
  check("diaries POST: startDate server-bounded (MAX_BACKDATE_MS)", diariesPost.includes("MAX_BACKDATE_MS"));
  check("diaries POST: invalid start date rejected", diariesPost.includes("Invalid start date"));
  const harvestPost = read("app/api/diaries/[id]/harvest/route.ts");
  check("harvest: reward span anchors on createdAt", harvestPost.includes("createdAt") && /spanDays[\s\S]*createdAt/.test(harvestPost));
  const forumPosts = read("app/api/forum/posts/route.ts");
  check("posts: reply reputation paid-content floor", forumPosts.includes("POST_MIN_PAID_LENGTH"));

  // ── Media migration tool invariants (ops safety; the live blob store
  //    can't be exercised without a token, so this pins the contract) ──
  const mig = read("../scripts/migrate-private-media.mts");
  check("migration: strict revocation — public-source delete failure counts", mig.includes("deleteImageStrict(row.url)") && mig.includes("tally.failed++"));
  check("migration: failures exit non-zero", /failed \+ post\.failed \+ setup\.failed > 0\) process\.exit\(1\)/.test(mig));
  check("migration: orphan deletion requires --confirm", mig.includes('process.argv.includes("--confirm")') && mig.includes("if (!CONFIRM)"));
  check("migration: only twin-verified public orphans are deleted", mig.includes("for (const o of tally.orphanTwin)") && !/for \(const \w+ of tally\.orphanUnique/.test(mig) && !/for \(const \w+ of tally\.orphanPrivate/.test(mig));
  check("migration: list-store reports every bucket", ["referencedPublic", "orphanTwin", "orphanUnique", "orphanPrivate", "suspicious"].every((b) => mig.includes(b)));

  // ── Affiliate image hosts ⊆ CSP img-src ──
  // Partner product images are hotlinked; a seed imageUrl on a host missing
  // from img-src silently renders broken in production. Pin the invariant.
  {
    const proxySrc = read("proxy.ts");
    const imgSrc = (proxySrc.match(/"img-src ([^"]+)"/) || [])[1] || "";
    for (const seed of ["seed-clone-to-home.cjs", "seed-mars-hydro-products.cjs"]) {
      const urls = (read(`../scripts/${seed}`).match(/imageUrl:\s*"([^"]+)"/g) || [])
        .map((s) => s.replace(/imageUrl:\s*"/, "").replace(/"$/, ""));
      for (const u of urls) {
        const host = new URL(u).host;
        const allowed = imgSrc.split(/\s+/).some((h) => host === h.replace(/^https?:\/\//, "") || (h.includes("*.") && host.endsWith(h.split("*.")[1])));
        check(`${seed}: image host ${host} in CSP img-src`, allowed);
      }
    }
  }

  // ── Deals + question-evidence integrity contracts ──
  {
    const dealsData = read("lib/deals-data.ts");
    check("deals: partner count filtered to active products",
      /products:\s*{\s*where:\s*{\s*active:\s*true\s*}\s*}/.test(dealsData));
    const dealsPage = read("app/deals/page.tsx");
    check("deals: no untracked price-freshness claim", !dealsPage.includes("prices checked by staff"));

    const ev = read("lib/question-evidence.ts");
    check("evidence: question-category gate is the shared convention",
      ev.includes("QUESTION_CATEGORY_RE.test"));
    check("evidence: grow pool is public-only", ev.includes("publicDiaryWhere"));
    check("evidence: grow pool filters blocked + asker", ev.includes("notBlockedAuthor") && ev.includes("activeAuthor()"));
    check("evidence: solved requires live accepted answer",
      ev.includes("acceptedAnswerId: { not: null }") && ev.includes("!t.acceptedAnswer.deleted"));
    check("evidence: reuses canonical matchers — no second engine",
      ev.includes("scoreGrowMatch") && ev.includes("extractQuestionSignals") && ev.includes("getStrainKnowledge") && ev.includes("suggestStrainLink"));
    check("evidence: non-public context diary never a reference",
      ev.includes('contextDiary.visibility === "PUBLIC"'));

    const followPrompt = read("components/answer-follow-prompt.tsx");
    check("answer-follow: prompt goes through /api/follows", followPrompt.includes('"/api/follows"'));
    const threadPage = read("app/forum/thread/[slug]/page.tsx");
    check("answer-follow: asker-scoped eligibility via helper", threadPage.includes("helperFollowPromptAllowed"));
  }

  // ── Social Grow Updates (Phase 1) — update interaction contracts ──
  {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf8");
    const model = (name) => schema.slice(schema.indexOf(`model ${name} {`), schema.indexOf("}", schema.indexOf(`model ${name} {`)));
    const reaction = model("Reaction");
    const post = model("Post");
    check("social: Reaction keeps explicit target columns (no polymorphic target)",
      /postId\s+String\?/.test(reaction) && /diaryId\s+String\?/.test(reaction) && /diaryUpdateId\s+String\?/.test(reaction)
      && !/targetType|targetId/.test(reaction));
    check("social: one reaction per member per update (unique)", reaction.includes("@@unique([userId, diaryUpdateId])"));
    check("social: update reactions cascade with the update",
      /diaryUpdate\s+DiaryUpdate\?\s+@relation\(fields: \[diaryUpdateId\], references: \[id\], onDelete: Cascade\)/.test(reaction));
    check("social: comment anchor is optional + SetNull (Post survives as soft-deleted)",
      /diaryUpdateId\s+String\?/.test(post) && /onDelete: SetNull\)/.test(post.slice(post.indexOf("diaryUpdate "))));
    check("social: no standalone Comment / SocialPost model", !/^model (Comment|SocialPost|UpdateComment) \{/m.test(schema));

    const social = read("lib/update-social.ts");
    check("social: anchored-comment gate = PUBLIC + not deleted + active author",
      /anchoredDiaryWhere = \{[\s\S]*deleted: false[\s\S]*publicDiaryWhere[\s\S]*activeAuthor\(\)/.test(social));
    check("social: inline comment window is bounded per update (ROW_NUMBER)",
      social.includes("ROW_NUMBER() OVER") && social.includes("UPDATE_INLINE_COMMENTS"));

    const reactions = read("app/api/reactions/route.ts");
    check("social: reaction body must name exactly one target",
      reactions.includes("[hasPostId, hasDiaryId, hasUpdateId].filter(Boolean).length !== 1"));
    const updBranch = reactions.slice(reactions.indexOf("prisma.diaryUpdate.findUnique"));
    check("social: update reactions use canonical canViewDiary + deleted + active-author gates",
      updBranch.includes("canViewDiary(update.diary, session.user.id)") && updBranch.includes("update.diary.deleted")
      && updBranch.includes("isActiveAuthorRow(update.diary.author)"));
    check("social: update reactions keep the block check + rate limit",
      reactions.includes("blockExistsBetween(session.user.id, targetAuthorId)") && reactions.includes("progressionRateLimit"));
    check("social: reaction writes use the explicit target, never the raw body",
      reactions.includes("data: { type, userId: session.user.id, ...target }") && !/\.\.\.body\b/.test(reactions));

    const posts = read("app/api/forum/posts/route.ts");
    check("social: anchored comment requires PUBLIC grow + the grow's own discussion thread",
      posts.includes('update.diary.visibility !== "PUBLIC"') && posts.includes("update.diary.threadId !== threadId")
      && posts.includes("update.diary.deleted") && posts.includes("isActiveAuthorRow(update.diary.author)"));
    check("social: anchor written from the validated update, not the body",
      posts.includes("diaryUpdateId: anchor?.updateId ?? null"));
    check("social: comment notifications reuse COMMENT with a cleanup-safe ?post= link",
      posts.includes('type: "COMMENT"') && posts.includes("updateAnchor(anchor.diaryHref, anchor.updateId, post.id)"));

    const notifyLib = read("lib/notify.ts");
    check("social: no new notification types (COMMENT/REACTION reused)",
      !notifyLib.includes('"UPDATE_COMMENT"') && !notifyLib.includes('"UPDATE_REACTION"'));
    const webPush = read("lib/web-push.ts");
    const pushSwitch = webPush.slice(webPush.indexOf("export function pushCategory"), webPush.indexOf("export function pushConfigured"));
    check("social: reactions/comments stay out of Web Push", !pushSwitch.includes('"REACTION"') && !pushSwitch.includes('"COMMENT"'));

    // Every surface that renders post content to other members applies
    // the anchored-comment visibility fragment.
    for (const f of [
      "app/forum/thread/[slug]/page.tsx",
      "app/api/forum/threads/[slug]/activity/route.ts",
      "app/api/search/route.ts",
      "lib/terpbot-data.ts",
    ]) {
      check(`social: ${f} filters anchored comments by grow visibility`, read(f).includes("anchoredPostVisibleWhere()"));
    }

    const updates = read("app/api/diaries/updates/route.ts");
    const del = updates.slice(updates.indexOf("export async function DELETE"));
    const softIdx = del.indexOf("where: { diaryUpdateId: id, deleted: false }");
    const hardIdx = del.indexOf("tx.diaryUpdate.delete");
    check("social: update delete soft-deletes anchored comments before the hard delete",
      softIdx > -1 && hardIdx > softIdx && del.includes("data: { deleted: true }") && del.includes("updateLinkWhere(id)"));
    check("social: removed comments enqueue durable rep + XP reversals",
      del.includes('sourceType: "POST"') && del.includes("enqueueReversals(tx, intents)") && del.includes("enqueueXpReversals(tx, intents)"));

    const diaryPage = read("app/diaries/[id]/page.tsx");
    check("social: diary page loads update social state in one batch",
      diaryPage.includes("loadUpdateSocial(updates.map((u) => u.id)") && diaryPage.includes('withComments: commentable'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
