# TerpTalks — Feature Audit & Strategic Roadmap

*Prepared for the TerpTalks product team. This document is based on an audit of the current codebase, database schema, route structure, and component library. No new code was written or modified to produce this analysis.*

---

## 1. Executive Summary

TerpTalks is already a surprisingly complete cannabis community platform. It contains a full forum, grow diaries, setup showcases, a strain database, reputation/badges, moderation tooling, direct messaging, public chat, notifications, contests, affiliate products, deals, calculators, guides, and PWA scaffolding. Most of the underlying data model and API surface exist; the biggest remaining work is UX polish, intelligent discovery, and a few high-leverage creator/community features.

**Primary opportunity:** TerpTalks can differentiate by tightly coupling *community conversation* with *grower tooling*. The killer feature is the grow journal + forum + strain database triangle, which generic platforms (Reddit, Discord, Facebook Groups) cannot replicate. The near-term focus should be on making that triangle obvious, useful, and addictive.

**Production readiness (current):** Not production-ready. The build is clean, but the site has not been through real responsive, accessibility, cross-browser, or end-to-end user-flow QA.

---

## 2. Existing Feature Inventory

### Existing (functional and wired)

| Area | Features |
|------|----------|
| **Auth / Identity** | Credential/JWT auth, invite-only registration, age verification, recovery-phrase account recovery, public user profiles, roles (USER/MODERATOR/ADMINISTRATOR), bans. |
| **Forum** | Categories, category follows, thread creation with title/content, posts/replies, tags, polls (single-vote), markdown composer with toolbar, image uploads, thread pinning/locking, accepted answers, similar-threads suggestion, replies count, views. |
| **Reactions** | Like/Fire/Thumbs Up/Laugh on posts and diaries. |
| **Bookmarks** | Save threads. |
| **Search** | Full-text-ish search over threads/posts/users/categories, saved searches. |
| **Notifications** | Replies, mentions, follows, reactions, messages, moderation, announcements. Unread badge and mark-all-read. |
| **Messaging** | Direct messages, public chat rooms (Pusher-powered). |
| **Social** | Follow users, follow diaries, follow categories, block users. |
| **Grow Journals** | Create diary, weekly updates, photos, environment charts, diary follows/comments. |
| **Setups** | Grow setup showcases, images, comments. |
| **Strain Database** | Strain profiles, photos, community submissions. |
| **Reputation** | Reputation events, tiers, leaderboards, badges. |
| **Moderation** | Reports, moderation actions, user warnings/suspensions, bulk moderation, security events, rate limiting, captcha. |
| **Admin** | Admin dashboard, stats, user list, announcements, affiliate partners/products/clicks, YouTuber management, security settings. |
| **Content** | Staff guides (with edit history), affiliate product cards, contests, YouTuber directory, deals page, plant problem wizard, grow light calculator. |
| **Discovery** | Latest, trending, following feed, tags, category pages, discover page, leaderboard. |
| **SEO / PWA** | Open Graph image, manifest, service-worker registration, JSON-LD, breadcrumbs, Vercel Analytics. |

### Partial (exists but needs completion)

| Feature | Current state | What's missing |
|---------|---------------|----------------|
| **Reactions** | API supports multiple types, UI only surfaces 4 emojis in a basic popover. | More reaction types, reaction summary bar, per-post breakdown, reaction notifications. |
| **Polls** | Single-vote polls attached to threads. | Multiple-choice polls, poll closing dates, edit/retract vote, admin poll management, results visual polish. |
| **Mentions** | Notifications for @username exist. | Autocomplete in composer, mention highlighting in rendered posts, mention count/limits to prevent spam. |
| **Search** | Basic search exists. | Faceted filters (category, author, date, tags), search suggestions, typo tolerance, popular searches. |
| **User Dashboard** | `/feed` and `/discover` exist. | A true personal dashboard with activity, drafts, saved, messages, followed content in one place. |
| **Grow Journal** | Core data model and UI exist. | Timeline visualization, harvest/yield tracking, comparison mode, templates, alerts. |
| **Media embeds** | YouTube/Vimeo detection added recently. | TikTok/Instagram/spotify? Only where legal; preview cards for generic links; better lazy loading. |
| **Mobile UX** | Mobile nav exists. | Purpose-built touch layouts for composer, image gallery, search, moderation, profiles. |

### Missing (not implemented)

- Personalized home feed based on follows/categories.
- Groups/Clubs or private sub-communities.
- Semantic/AI search or thread summarization.
- Push notifications (web push).
- Email notifications/digests.
- Creator analytics / per-user stats dashboard.
- Vendor/verified business profiles.
- Marketplace or seed-swap features (high legal risk).
- In-app events/calendar.
- Advanced moderation queues with assignment and SLAs.
- User appeal process for moderation actions.
- Content report reasons configuration.
- A/B testing or feature-flag framework.

### Broken / Technical Debt

- `prose` CSS classes are present in some components but no Tailwind Typography plugin is configured; likely dead styling.
- Several large markdown planning files were recently removed, but root still has many production docs that should be reviewed for freshness.
- Lint warnings persist (non-blocking, but indicate cleanup opportunities).
- No formal end-to-end test suite; testing is manual.

---

## 3. Current UX/Product Problems

1. **Discovery friction:** Users can browse latest/trending, but there is no personalized "For You" feed. New users do not get a clear onboarding path to categories or growers to follow.
2. **Feature sprawl:** Many features exist (diaries, setups, strains, guides, contests) but the navigation does not make the *story* obvious: "join → learn → grow → share."
3. **Creator recognition weak:** Reputation and badges exist but are not prominently displayed in the forum thread list or on cards. High-quality contributors do not get enough visibility.
4. **Thread page still basic:** Avatars are now real, but post cards lack threaded indentation, quotes, per-post reactions summary, and rich hover actions.
5. **Mobile composer:** The markdown composer is functional but not optimized for thumb typing or quick camera uploads.
6. **Search underpowered:** Search results are plain and lack filters or autocomplete; this hurts content findability as the corpus grows.
7. **Notification overload risk:** Notification types exist but users cannot granularly control which events generate notifications.

---

## 4. Competitive Analysis

### Platforms TerpTalks competes with

| Platform | Strengths | Weaknesses for cannabis growers |
|----------|-----------|--------------------------------|
| **Reddit** | Massive scale, subreddits, upvotes, search, AMAs. | No grow-specific tooling; age/21+ enforcement weak; subreddit bans; poor photo-series support; no structured strain/equipment data. |
| **Discord** | Real-time chat, voice, community rooms. | Ephemeral; terrible for searchable knowledge; no grow timelines; moderation is labor-intensive. |
| **Facebook Groups** | Familiar to older users, events. | Poor cannabis policy stability, no privacy for growers, no grower tools, algorithmic feed is unpredictable. |
| **GrowDiaries / GrowWeedEasy** | Purpose-built grow journals, strain data. | Often feel like databases with weak social/community loops; limited modern forum experience. |
| **Rollitup, Grasscity, ICMag** | Long history, deep grow knowledge. | Dated UX, poor mobile, limited media/embeds, weak discovery. |

### Opportunities TerpTalks can own

1. **Grow journal + forum integration** — a journal update can *spawn* a discussion thread, and a thread can reference a journal week. No competitor does this natively.
2. **Strain photo community** — user-submitted grow photos tied to strain profiles, not just marketing shots.
3. **Beginner-safe, expert-friendly** — a problem wizard and structured guides lower the barrier; reputation/accepted-answer systems reward experts.
4. **Invite-only, age-gated trust** — creates a safer environment than public platforms for discussing a federally restricted plant.

---

## 5. Feature Gap Analysis

### Community

| Feature | Status | Gap |
|---------|--------|-----|
| User follows | Exists | Needs better activity feed and follow suggestions. |
| Groups/Clubs | Missing | Would create tighter micro-communities (e.g., organic growers, LED-only). |
| Member directory | Missing | Useful for finding growers by skill, location (opt-in), or strain interest. |
| Online status | Exists | Active members shown; could be expanded to "currently growing X strain." |
| Reputation tiers | Exists | Needs clearer in-product explanation and benefits. |

### Content

| Feature | Status | Gap |
|---------|--------|-----|
| Rich posts / Markdown | Exists | Composer is good; could add @mentions autocomplete and embed cards. |
| Polls | Partial | Needs multiple-choice, closing, and richer results. |
| Grow journals | Partial | Missing harvest records, yield, template sharing, grow comparisons. |
| Guides | Exists | Could be community-wiki with approvals. |
| Bookmarks | Exists | No folders/organization. |
| Collections / Series | Missing | Growers want to group related threads/journals. |

### Cannabis-Specific

| Feature | Status | Gap |
|---------|--------|-----|
| Strain database | Exists | Needs reviews, grow difficulty, average yield, breeder links. |
| Plant problem wizard | Exists | Could be expanded with photo diagnosis flow. |
| Grow calculator | Exists | Good; could share results to forum. |
| Harvest logs | Missing | Critical for journal completion. |
| Equipment profiles | Partial | Setups exist but not searchable by component. |

### Discovery

| Feature | Status | Gap |
|---------|--------|-----|
| Trending | Exists | Score is reasonable but not configurable; no admin tuning. |
| Latest | Exists | Fine. |
| Search | Partial | Needs filters, autocomplete, popular searches. |
| Recommendations | Missing | No personalized suggestions. |
| Related threads | Partial | Similar-threads on creation only; not on thread page. |

---

## 6. Recommended New Features

### High-value, low-complexity

1. **@Mention autocomplete** in the markdown composer.
2. **Thread page related threads** (same category/tags).
3. **Per-post reaction summary** with counts per emoji.
4. **Notification preferences** granular settings.
5. **Search filters** (category, author, tags, date, sort).

### High-value, medium-complexity

6. **Personalized "For You" home feed** based on followed categories, tags, users.
7. **Harvest / yield tracking** in grow journals.
8. **Grower collections** (saved threads + journals grouped by the user).
9. **Moderation queue dashboard** with status, assignee, and SLA.
10. **Feature-flags / admin toggle panel** to enable/disable reactions, polls, messaging, follows.

### High-value, high-complexity

11. **Semantic search + thread summarization** (OpenAI/Claude or local embeddings).
12. **Web push + email digests** for notifications.
13. **Groups/Clubs** with private threads.
14. **Verified vendor/business profiles** (legal review required).
15. **AI grow troubleshooting assistant** (privacy and accuracy concerns).

---

## 7. Feature Scoring

| Feature | User Value | Engagement | Retention | Differentiation | Complexity | Risk | Priority |
|---------|-----------:|-----------:|----------:|----------------:|-----------:|-----:|---------:|
| @Mention autocomplete | 8 | 7 | 6 | 5 | Low | Low | 8.5 |
| Per-post reaction summary | 7 | 7 | 5 | 4 | Low | Low | 7.5 |
| Search filters | 9 | 8 | 7 | 6 | Medium | Low | 8.5 |
| Notification preferences | 8 | 6 | 9 | 5 | Low | Low | 8.0 |
| Personalized home feed | 9 | 9 | 9 | 8 | Medium | Medium | 9.0 |
| Harvest/yield tracking | 9 | 7 | 8 | 9 | Medium | Low | 9.0 |
| Moderation queue v2 | 6 | 5 | 6 | 5 | Medium | Low | 6.5 |
| Feature-flag admin panel | 5 | 4 | 6 | 4 | Medium | Low | 5.5 |
| Semantic search | 9 | 8 | 8 | 9 | High | High | 7.5 |
| Web push + email | 7 | 8 | 9 | 6 | High | Medium | 7.0 |
| Groups/Clubs | 8 | 9 | 9 | 8 | High | Medium | 7.5 |
| Vendor profiles | 6 | 5 | 5 | 7 | High | High | 5.0 |
| AI grow assistant | 8 | 7 | 7 | 10 | Very High | High | 6.5 |

*Priority is a weighted composite favoring user value, retention, and differentiation over complexity and risk.*

---

## 8. Top 10 Features to Build

### 1. Personalized "For You" Feed
- **Why:** Returning users need a reason to open the app daily. A feed of followed categories, tags, and growers is the strongest retention tool.
- **UX:** Replace or augment `/feed` with a "For You" tab mixing new threads, followed diary updates, and trending from followed categories.
- **Dependencies:** Following system, activity tracking, trending score, notification feed.
- **Risks:** Cold-start problem for new users; solve with onboarding topic selection.

### 2. Harvest / Yield Tracking for Grow Journals
- **Why:** A grow journal without a harvest record is incomplete. This is the payoff moment growers want to share.
- **UX:** "Mark as harvested" flow with yield weight, dry/cure timeline, final photos, and strain comparison.
- **Dependencies:** `GrowDiary`, `DiaryUpdate`, `Strain`.
- **Risks:** Users may overstate yields; keep it self-reported and flag brag posts if needed.

### 3. Search Filters + Autocomplete
- **Why:** As the thread corpus grows, findability becomes a retention issue.
- **UX:** Facet chips for category, author, tags, date; search-as-you-type suggestions; popular searches.
- **Dependencies:** Existing `/api/search`, `Tag`, `Category`.
- **Risks:** Heavy queries if not indexed; add database indexes for `Thread.createdAt`, `Post.content` search vectors.

### 4. @Mention Autocomplete
- **Why:** Drives user-to-user interaction and notification engagement; expected in any modern forum.
- **UX:** Typing `@` in composer opens a user list with avatars and usernames; filtered as you type.
- **Dependencies:** Existing mentions notification pipeline, user search.
- **Risks:** Spam; enforce rate limits and only mention verified/registered users.

### 5. Notification Preferences
- **Why:** Prevents notification fatigue, which kills retention.
- **UX:** Settings page toggles for replies, mentions, reactions, follows, messages, mod actions, digests.
- **Dependencies:** `Notification` model, settings UI.
- **Risks:** Low.

### 6. Per-Post Reaction Summary
- **Why:** Quick social signal; shows community sentiment at a glance.
- **UX:** A compact bar below each post: "❤️ 12 🔥 3 😂 2"; hover to see who reacted.
- **Dependencies:** `Reaction` model already supports multiple types.
- **Risks:** Potential for brigading; rate-limit and consider hiding counts for new users.

### 7. Related Threads on Thread Page
- **Why:** Keeps users reading, improves SEO internal linking, and surfaces older good content.
- **UX:** "More like this" section below the first post and below replies using category + tags.
- **Dependencies:** `Thread`, `ThreadTag`, `Category`.
- **Risks:** Low; query should be cached/bounded.

### 8. Moderation Queue v2
- **Why:** As the community scales, moderators need a queue, not a list of API endpoints.
- **UX:** `/moderation/queue` with columns: Open, In Review, Resolved; assign to mod; add notes; batch actions.
- **Dependencies:** `Report`, `ModerationAction`, `SecurityEvent`.
- **Risks:** Requires careful permission scoping.

### 9. Feature-Flag Admin Panel
- **Why:** Lets the team turn features on/off without deploys; essential for a platform with many optional modules.
- **UX:** Admin settings page toggles for reactions, polls, messages, follows, contests, etc.
- **Dependencies:** `Setting` model, admin UI.
- **Risks:** Low; improves maintainability.

### 10. Web Push + Weekly Digest Emails
- **Why:** Brings users back when they are not actively browsing.
- **UX:** Opt-in browser push for DMs/mentions; weekly email of top threads from followed categories.
- **Dependencies:** Notification system, email provider, web-push VAPID keys.
- **Risks:** Privacy and deliverability; must be strictly opt-in.

---

## 9. Feature Bundles

### Bundle A — Community 2.0
@Mention autocomplete, per-post reaction summary, notification preferences, personalized feed, groups/clubs.

### Bundle B — Discovery & Retention
Search filters, related threads, trending tuning, weekly digest, web push.

### Bundle C — Grower Tools
Harvest/yield tracking, grow comparisons, equipment component search, problem wizard v2.

### Bundle D — Creator Platform
Verified profiles, creator analytics, content collections, featured creator badges.

### Bundle E — Platform Operations
Feature-flag panel, moderation queue v2, admin analytics, appeal workflow.

### Bundle F — Experimental AI
Semantic search, thread summaries, duplicate-question detection, auto-tag suggestions.

---

## 10. Dependencies

```
Personalized Feed
  -> Following system (User/Follow, CategoryFollow, DiaryFollow)
  -> Notification feed pipeline
  -> Trending score

Harvest Tracking
  -> GrowDiary schema extension
  -> DiaryUpdate entry types
  -> Strain relations

Search v2
  -> Database indexes / full-text search
  -> Tag/Category metadata

Web Push / Email
  -> Notification preferences
  -> External providers (Resend/Postmark, web-push)

Groups/Clubs
  -> New Group/GroupMember/GroupThread models
  -> Privacy/visibility rules

Vendor Profiles
  -> Business verification flow
  -> Legal/compliance review
```

---

## 11. 30-Day Roadmap

1. **Search filters + autocomplete** (high findability, low risk).
2. **@Mention autocomplete** (high social value).
3. **Per-post reaction summary** (uses existing `Reaction` model).
4. **Notification preferences** (reduces churn).
5. **Related threads on thread page** (SEO + engagement).
6. **Polish mobile composer + image upload** (critical for mobile-first goal).

**Goal:** Make the existing forum significantly more usable and sticky.

---

## 12. 60–90-Day Roadmap

1. **Personalized "For You" feed** (retention).
2. **Harvest / yield tracking** (grow journal completion).
3. **Moderation queue v2** (scaling safety).
4. **Feature-flag admin panel** (operational control).
5. **Grower collections** (content organization).
6. **Improved leaderboards + badge display** (recognition).

**Goal:** Move from "functional forum" to "community platform."

---

## 13. 3–6 Month Roadmap

1. **Semantic search + thread summarization** (differentiation, but gated by cost/accuracy).
2. **Web push + email digests** (re-engagement).
3. **Groups / Clubs** (micro-communities).
4. **Creator analytics dashboard** (incentivize high-quality content).
5. **Advanced grow journal timeline + comparisons** (signature feature).

**Goal:** Establish TerpTalks as a differentiated cannabis platform.

---

## 14. 6–12 Month Vision

TerpTalks becomes the default *grower-owned* community platform: a combination of Reddit-like discussions, Instagram-like grow photo series, and Leafly-like strain data, all tied to personal grow journals. The platform supports knowledgeable creators, trusted vendors, and a searchable knowledge base built by the community.

**Key bets for this period:**

- AI-assisted troubleshooting (only after accuracy/privacy safeguards).
- Verified vendor profiles and ethical sponsorships (subject to legal review).
- Native mobile app or installable PWA with push notifications.
- Community events and challenges ("Grow-Offs").

---

## 15. Monetization Opportunities

| Opportunity | Potential | UX Impact | Complexity | Risk | Recommendation |
|-------------|-----------|-----------|------------|------|----------------|
| **Affiliate product cards** | Medium | Low if limited | Low | Low | Already implemented; keep it staff-controlled. |
| **Sponsored guides** | Medium | Medium | Low | Medium | Label clearly; only vetted sponsors. |
| **Premium memberships** | Medium | Low | High | Medium | Optional: ad-free, badges, analytics; only if demand is proven. |
| **Vendor verified profiles** | Medium-High | Medium | High | High | Requires legal review; late-stage. |
| **Marketplace / seed swaps** | High | High | Very High | Very High | **Not recommended** without legal counsel and licensing. |
| **Community events / contests** | Low-Medium | Low | Medium | Low | Good for engagement, not primary revenue. |

**Recommendation:** Start with affiliate and clearly-labeled sponsored content. Avoid marketplace functionality until legal and compliance are resolved.

---

## 16. Cannabis-Specific Opportunities

1. **Strain review aggregation** — tie grow journal harvests to strain ratings.
2. **Equipment database** — structured reviews of lights, tents, nutrients.
3. **Grow environment benchmarks** — anonymized averages from diary logs (e.g., typical DLI, VPD, pH).
4. **Training technique library** — LST, topping, main-lining, SCROG guides with community examples.
5. **Pest/deficiency visual index** — community-curated photos and fixes.
6. **Breeder/genetics tracker** — users track which breeder's cuts they have grown and recommend.

These are all defensible against Reddit/Discord because they require structured data that generic platforms do not collect.

---

## 17. AI Opportunities

| Use Case | Value | Cost | Risk | Verdict |
|----------|-------|------|------|---------|
| **Thread summarization ("Catch me up")** | High | Low | Low | **Good** — optional, summary only. |
| **Similar thread detection** | High | Low-Medium | Low | **Good** — reduces duplicates. |
| **Auto-tag suggestions** | Medium | Low | Low | **Good** — speeds categorization. |
| **Troubleshooting assistant** | High | Medium | High (medical/cultivation advice) | **Gated** — must disclaim and not diagnose. |
| **Toxicity/spam detection** | Medium | Medium | Medium | **Later** — manual moderation first. |
| **Content recommendations** | High | Medium | Medium | **After** following/activity data is richer. |

**Recommendation:** Implement thread summaries and similar-thread detection first. Avoid medical or cultivation advice AI without legal review.

---

## 18. Security & Privacy Considerations

- **Age gating:** Keep strict 21+ entry and account recovery via recovery phrase (good).
- **User images:** Ensure EXIF stripping; verify Vercel Blob does not leak internal paths.
- **Private messages:** Already modelled; enforce block lists and report flows.
- **Profile exposure:** `publicUserSelect` is correctly used. Add granular privacy (hide email, hide online status, hide profile from guests).
- **AI:** If implemented, never send user data to external LLMs without explicit opt-in; prefer local embeddings or zero-retention APIs.
- **Vendor profiles:** Require verification and legal review before launch.

---

## 19. Legal / Compliance Flags

- **Cannabis sales / marketplace:** High risk. Do not implement without legal counsel.
- **Medical claims:** Do not allow users or AI to make medical claims.
- **Seed/clone swapping:** May violate interstate commerce and state laws; treat as high risk.
- **Advertising:** Any ad/sponsored content must be age-gated and clearly labeled.
- **User-generated content:** Maintain moderation tools and clear terms; keep audit logs.
- **Geolocation:** If added, make it strictly opt-in and avoid storing precise location.

---

## 20. Features NOT Recommended

| Feature | Reason |
|---------|--------|
| **Seed/clone marketplace** | Legal/compliance risk outweighs value. |
| **Geolocation-based feeds** | Privacy risk; limited value for grower community. |
| **In-app currency / tokens** | Gamification risk, regulatory scrutiny, maintenance burden. |
| **NFT badges or collectibles** | No community value; reputational risk. |
| **Anonymous posting** | Conflicts with invite-only, age-verified trust model. |
| **Auto-crosspost to social media** | Privacy and legal exposure. |
| **AI medical advice** | Liability risk; not worth the value. |

---

## 21. Final TerpTalks Product Vision

**What TerpTalks should be known for:**
The most useful, respectful, and grower-focused cannabis community on the internet — where a grower can document a full cycle, ask questions, compare genetics, and learn from real harvest data.

**Killer feature:**
Grow journals tightly integrated with the forum and strain database. A journal update becomes a thread; a thread references a strain; a strain page shows real grower outcomes.

**Why someone chooses TerpTalks over Reddit/Discord:**
- Tools built for growers, not generic discussion.
- Age-verified, invite-only environment.
- Searchable, structured knowledge rather than ephemeral chat.
- Recognition for helpful growers and verified harvests.

**What makes users return daily:**
A personalized feed of followed growers, relevant discussions, and an easy way to log a grow update.

**What makes users create content:**
- Recognition (reputation, badges, accepted answers).
- Utility (journals help them track their own grow).
- Community (helping others and showing results).

**Financial sustainability:**
Ethical affiliate partnerships, sponsored educational content, and eventually optional premium features or verified vendor profiles — but only after trust and legal guardrails are in place.

---

*Document generated by Devin based on the current TerpTalks codebase. No production code was modified.*
