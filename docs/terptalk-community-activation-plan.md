# TerpTalk — 4-Week Community Activation Plan

**Status:** Operations playbook · **Scope:** No code, no schema, no engineering
**Baseline:** `a22d1d0` on `master` · prod `terp-talk-ey684sqlz` ● Ready
**Written:** 2026-10-06

---

## 1. Current Baseline (measured, not inferred)

| Metric | Value |
|---|---|
| Real members | 8 (excl. admin + terpbot) |
| Onboarding completion | 8/8 |
| Members who returned ≥1 day | 3/8 |
| Members producing content | **1** |
| Public diaries | 3 — all one grower, still active (last update Oct 5) |
| Threads | 4 (1 real, 3 TerpBot seeds) |
| Member-to-member replies | **0** |
| Accepted answers / solved questions | 0 |
| Setups / harvests / experiments / Plant Doctor cases | 0 |
| Push subscriptions | 0 |
| Affiliate clicks | 122 total, **3 member-attributed** |
| Catalog fixtures | 658 strains (seed), 8 guides (staff) |

The product machinery is verified complete end-to-end: discovery, onboarding,
next-action engine, diaries/updates, questions with the evidence panel, answer
recruitment, follows, notifications, weekly digest, progression, contests,
creator pipeline, Plant Doctor. **Zero member-to-member social edges exist** —
not because a feature is missing, but because there is essentially one
contributor.

## 2. Why Operations Is the Current Priority

The audit decision was `OPERATE`: the dominant bottleneck is member/content
volume, not software. Two implications:

1. Every remaining engineering initiative would optimize a machine with no
   input. A "better" question page still has zero answerers; better digest has
   one reader.
2. The one engaged member proves the loop works when a real grower with a real
   grow finds the product. The job of the next 4 weeks is to create the
   conditions — and the humans — that let the existing machinery fire.

Nothing in this plan requires engineering. Where a task lists a surface, it
means *use what exists*, not build on it.

---

## 3. Goal 1 — Operator Grow-Along

The operator starts and maintains a real public grow diary under the admin
account. Purpose: give every visitor and recruit a second live grow to look at,
generate authentic questions, and personally exercise every system the
community will be invited to use.

### 3.1 What to document

- **One honest grow.** Use a real grow the operator is actually running or can
  run for the 4 weeks. If no live grow exists, a small seed-to-finish run
  (autoflower in a small tent, a windowsill test, even a re-potting log) is
  acceptable — but it must be *real*, with real inputs and real mistakes.
- **Structured data filled in completely:** strain (linked to catalog),
  medium, light, pot size, feeding approach. This is what powers grow
  matching, strain knowledge, and the evidence panel later.
- **A named setup.** Create the grow setup record (tent size, light model,
  ventilation, medium). Setups = 0 today; the first one should be real and
  complete so invited growers have a template to imitate.

### 3.2 What makes it authentic (not promotional)

- **Problems are logged, not hidden.** The first pH drift, stretch issue, or
  feeding mistake goes in the diary — that content is worth more than glossy
  photos because it creates the questions the community answers.
- **Uncertain moments, narrated.** "Not sure if this is calmag or lockout" is
  a real update; it is also the natural precursor to a question thread.
- **No marketing voice.** Write like a grower with a notebook, not a founder
  with a landing page. The admin badge is fine — authenticity is the point.
- **Photos when they exist; text when they don't.** Do not let "no photo"
  delay a real update.

### 3.3 Cadence (realistic for 4 weeks)

| Day | Action |
|---|---|
| Weekly ×1 | **Structured diary update** — stage, height/observations, feed/environment numbers. Minimum 1, target 2. |
| Weekly ×1 | **Micro-note or photo update** — shorter, shows cadence between structured entries. |
| On trigger | **Question thread** — ask the community the real questions that come up (see 3.5). |
| Daily ×5min | **Reply/engage** — respond to anything addressed to you within ~24h; follow new growers; welcome new members in threads when natural. |

### 3.4 Systems to deliberately exercise during the grow

- **Diary updates** → generates the stale-diary nudge path and feed/digest
  content for followers — this is what the product shows to anyone who
  follows the operator.
- **Questions on real grow moments** → populates the evidence panel, gives
  invited members something real to answer, feeds the answer-recruitment
  engine with a real `helpWanted` candidate.
- **Contest entry** — the existing `/contest` runs "Budshot of the Week" and
  "Diary of the Month." Submit the operator diary/photos where eligible;
  the contest having real entries is what makes it worth a recruit joining.
- **Follows** — follow each invited grower; expect/facilitate reciprocal
  follows. The person-graph is the retention asset.
- **Progression** — no gaming; rank/badges accrue naturally and are evidence
  the progression loop is honest.

### 3.5 Questions that naturally come from the grow

Generate 2–3 real questions over the 4 weeks, e.g.: seedling stretch,
watering cadence in coco, early defoliation timing, light distance,
temperature swings, "first grow — what am I missing about runoff pH."
Rules: ask only what the operator genuinely wants answered; tag/link the
context diary so the evidence panel can work; answer-relevant threads stay
in question categories (so recruitment machinery sees them).

---

## 4. Goal 2 — Direct Grower Recruitment (~5 growers)

No outreach is executed by this document — this is the workflow the operator
runs.

### 4.1 Ideal grower profile

Prioritize in this order:

1. **Someone currently growing** — a grow in progress means immediate diary
   content (the #1 missing artifact).
2. **Intermediate, not famous** — 1–3 completed grows; knows enough to answer
   beginner questions, still learning enough to ask their own.
3. **Already documents somewhere** — Reddit grow logs, Discord diaries, IG
   grow journals. Porting an existing habit is 10× easier than creating one.
4. **Pseudonymous-comfortable** — matches the product's identity model.

### 4.2 Recruit sources, separated

| Source | Approach | Expectation |
|---|---|---|
| **Personal network** | Direct 1:1 message to people you already know who grow. | Highest conversion; 1–2 of the 5. |
| **Communities you already participate in** | Where your presence is already established and self-promotion norms are understood — share your diary link as "where I'm logging my grow," not a site ad. | 2–3 of the 5; slower but real. |
| **YouTube/grow creators** | Direct outreach to small/mid channels (see Goal 3). | 1–2 of the 5; longer cycle. |
| **Long-term creators** | Identify 2–3 people with audience but low community overhead; invite them to *try* the site, not partner. | Month-2 payoff; track separately. |

### 4.3 The invitation (what to invite them to do)

- "I'm documenting my grow on TerpTalk — a grow-diary community I'm running.
  I'd actually like you in it: **start a diary and log your current grow**"
  is the ask. One concrete action, not "join my site."
- Second action after signup/onboarding: post or reply to a question (the
  operator's real questions exist for this).
- Never ask them to "test" or "review" — recruit *growers*, not testers.

### 4.4 What they receive (the honest pitch)

- A structured grow diary that compounds (strain stats, timeline, setup).
- Real questions get surfaced to people who can answer (the evidence panel +
  recruitment engine actually working — and the operator personally engaging).
- Early-member status on a community where their content *defines* the
  knowledge base; contests where a real entry has a real shot at a badge.

### 4.5 What NOT to promise

- Traffic, monetization, partnership, or "exposure."
- That their content will be boosted/featured automatically.
- Any roadmap, feature, or reward that doesn't exist.
- Anything that requires engineering to keep.

### 4.6 Cadence after signup

- **Day 0:** they sign up; onboarding handles setup.
- **Day 0–1:** operator follows them, comments/welcomes on their first diary
  or first update — one human interaction, unprompted, is the retention
  moment.
- **Week 1:** if they haven't logged an update, a *personal* nudge (not
  system-generated) — "how's the grow going?" is allowed because a human
  would ask that.
- **Ongoing:** answer their questions within ~24h; reply to their diary
  updates occasionally, not ceremonially.

### 4.7 Anti-spam rules

- 1:1 messages only; no mass posts, no link-drops in communities where it
  violates norms, no unsolicited DMs to strangers.
- One ask per person. If no response, stop.
- Never misrepresent affiliation — the operator is transparently "I run this."
- Community posts only where self-promotion is explicitly allowed, and
  framed as "my grow diary," not "join my forum."

---

## 5. Goal 3 — Creator Pipeline Activation

### 5.1 What already works (verified against code at `a22d1d0`)

- `/youtubers` — public "Featured YouTubers" listing, renders verified
  creators with channel links; currently empty ("No featured YouTubers yet"
  state renders correctly).
- `/youtubers/apply` — authenticated member submits a YouTube channel URL →
  stored on `Profile.youtubeChannelUrl` → admins get a `MODERATOR_ANNOUNCEMENT`
  notification pointing at `/admin/youtubers`.
- `/admin/youtubers` — staff review queue; one-click Verify awards the
  "Verified YouTuber" badge (and Remove revokes it). Channel-URL changes
  automatically strip the badge pending re-review.
- The loop YouTube → profile → badge → featured listing is fully functional.

### 5.2 What requires staff action (operations, not code)

- **Manual review** — verification is a human click; that's correct and
  should stay that way.
- **Outreach** — the pipeline has zero applicants because nobody has been
  invited. The missing input is the operator contacting small/mid grow
  creators directly.
- **First-creator onboarding** — the first verified creator should be walked
  through personally: apply → verify → encouraged to keep a diary or post a
  thread so their profile isn't an empty shell.

### 5.3 What to do manually this month

- Identify 5–10 small/mid cannabis grow channels (1k–50k subs range — big
  enough to have an audience, small enough to answer a personal message).
- Personal outreach: "I'm running a grow-diary community; I'd feature your
  channel if you keep a diary there" — the diary is the ask, the badge is
  the thank-you, not the product.
- Verify only channels staff actually reviewed (that is literally what the
  badge means).

### 5.4 What NOT to engineer

- No auto-approval, no API channel verification, no crossposting/import,
  no analytics for creators, no monetization tooling.
- The apply→review→badge loop works. The problem is zero applicants — an
  outreach problem.

---

## 6. Goal 4 — Weekly Content Calendar

Targets are deliberately floor-level. The goal is a *visibly alive* site,
not volume theater.

### Week 1 — Seed genuine conversation + establish the operator grow

**Operator actions**
- Create the grow setup record (complete structured data).
- Start the operator grow diary — entry 0 (setup + intent) + first update.
- Post 1 real question from the grow (question category, context-diary
  linked so the evidence panel renders).
- Enter eligible contest (budshot if a photo exists).
- Reply to the one existing member thread that has 0 replies — the site's
  first member-to-member reply.

**Member invitation actions**
- 1:1 invite to 2 people from the personal network (current growers only).

**Content targets:** 1 new diary (operator), ≥2 updates, 1 real question.
**Conversation targets:** first member-to-member reply anywhere on site.
**Creator actions:** shortlist 5–10 grow channels; no outreach yet.
**Measure:** new signups from invites; diary/update count; first real reply.

### Week 2 — Bring in outside growers + cross-member interaction

**Operator actions**
- 2 diary updates on the grow.
- Post 1 question (or answer a new member's).
- Personal welcome comment on each new member's first content — same day.
- Second real reply wave: reply to any existing member thread/diary comment.

**Member invitation actions**
- 2–3 more invites (community acquaintances — framed as diary invitation).
- Follow up with week-1 invitees who haven't posted (personal nudge).

**Content targets:** target 2–3 active diaries total (operator + recruits).
**Conversation targets:** ≥2 member-to-member exchanges; one question with
a human answer (operator answering a recruit's question counts).
**Creator actions:** 3–5 personal outreach messages to shortlisted creators.
**Measure:** real new members; onboarding completion; first grow per new
member; first reply; return-after-24h for new cohort.

### Week 3 — Participation through existing mechanics

**Operator actions**
- 2 diary updates; 1 question OR an accepted-answer moment (mark the best
  reply if a real question got a real answer).
- Answer every unanswered question <24h — this is where the question
  evidence panel + accepted answers start producing real artifacts.
- Follow every active grower; check the "Could use your help" surface and
  act on it personally.
- Contest: submit; if members have diaries, they're eligible — point it out.

**Member invitation actions**
- No new mass push. Focus: get existing members to second action.

**Content targets:** ≥3 active diaries; ≥1 additional question thread.
**Conversation targets:** ≥1 accepted answer on a real question; members
replying to *each other* (not just to operator).
**Creator actions:** verify any applicants; check if any outreach converted.
**Measure:** follows, member-to-member replies, accepted answers, return
rate of the invite cohort, second-meaningful-action rate.

### Week 4 — Visible milestone + next-month setup

**Operator actions**
- Diary continues; if a grow (operator or member) is near a harvestable
  state, complete the harvest flow — the first real harvest artifact.
- Post a genuine community thread noting where things stand ("first month
  on TerpTalk" — honest, not marketing).
- Contest results: winners/badges as they land.

**Member invitation actions**
- Thank/recap 1:1 to recruited growers; ask what worked and what didn't
  (this is also the qualitative input for the decision gate).

**Content targets:** sustain, don't spike.
**Conversation targets:** organic (non-operator) thread or reply activity.
**Creator actions:** process any pending applications; second outreach wave
only if the first produced replies.
**Measure:** full monthly funnel review (Section 7) + decision gate.

---

## 7. Goal 5 — Measurement Framework

Use only existing data: the same read-only aggregate queries from the audit
(User.lastSeenAt, onboardingCompletedAt, content tables, follows,
notifications). No new instrumentation.

### 7.1 Tracked metrics (weekly snapshot)

| Metric | Real definition |
|---|---|
| New real members | `role='MEMBER'` signups this week, excl. fixtures/terpbot |
| Onboarding completion | `onboardingCompletedAt` set |
| First grow | first `GrowDiary` row per member |
| First question | first `Thread` in a question category |
| First reply | first `Post` |
| Reply to another member | Post whose author ≠ thread author ≠ self |
| Follows | `Follow` + `ThreadFollow` rows (split user vs thread) |
| Return after 24h | `lastSeenAt > createdAt + 1 day` |
| Second meaningful action | ≥2 of: diary, update, thread, post |
| Harvests | `GrowDiary.harvested` (or harvest table) > 0 |
| Public diaries | `visibility='PUBLIC'`, non-deleted |
| Accepted answers | `acceptedAnswerId` non-null |
| Questions solved | same, question categories |
| Creator applications | profiles with `youtubeChannelUrl` pending verify |
| Creator participation | verified creators with diary/thread activity |
| Member-attributed clicks | `AffiliateClick.userId` non-null |

### 7.2 Activity classification (mandatory split)

Every count above is reported in three buckets:

- **Real member activity** — the metric that matters.
- **Operator activity** — counted separately, honestly labeled. The
  operator's diary is content, but it is not evidence of community health
  by itself.
- **System/bot activity** — TerpBot threads, system notifications,
  onboarding-suggestion follows. **Never** counted as community.

If a metric can't be split cleanly, say so rather than blending it.

---

## 8. Success Signals (community is beginning to work)

Any of these by end of week 4 is meaningful:

- **≥2 independent members** (not operator) producing content
- **At least one member-to-member reply** the operator didn't initiate
- **A question answered by a human** other than the operator
- **≥1 member returned a second/third week** unprompted
- **Growers following each other** (not just following the operator)
- **≥3 active public diaries** from ≥2 different authors
- **At least one harvest** or a long-running grow approaching it
- **≥1 creator** verified or actively participating

## 9. Failure Signals (still too early)

- Operator is still the only meaningful poster
- Engagement is almost entirely staff/system-generated
- Invited members signed up but produced zero content
- Questions still have no human answers
- Returns too sparse to interpret (cohort n<3 returning)

---

## 10. End-of-Month Decision Gate

Apply the observed evidence to one of four outcomes — do not force a build.

| Outcome | Trigger | Next move |
|---|---|---|
| **BUILD** | A specific friction is demonstrated by real users (e.g., invited growers sign up but consistently fail at a specific step) | Scope the fix against that friction only |
| **OPERATE** | Participation is growing but still needs hands-on development | Extend this plan; widen outreach |
| **GROW** | Content/community works for those who arrive, but arrivals are the constraint | Acquisition focus; engineering supports growth surfaces if needed |
| **MEASURE** | Too little activity to conclude anything (e.g., <3 recruited members active) | Gather another cycle before deciding |

The evidence expected: if ≥2 independent members are active and replies are
happening, `OPERATE` continues at a larger scale. If invited growers bounced
at a specific step, that's the first honest `BUILD` signal. If nobody arrived
at all despite outreach, `GROW`. If the sample stayed tiny, `MEASURE`.

## 11. Engineering NOT to do during these 4 weeks

Explicit freeze — none of these while this plan runs:

- No new features, surfaces, or dashboards
- No schema changes or migrations
- No notification/digest redesign
- No analytics instrumentation beyond existing queries
- No Pro/billing/subscription work
- No sponsorship tooling or new affiliate partners
- No Plant Doctor or progression changes
- No AI/LLM/embeddings/external APIs
- No "improvements" to the question/evidence/matching systems just shipped
- No performance work unless prod actually degrades

The only engineering allowed: a **demonstrated** bug affecting a real
member's attempt to use the product (and even then, the smallest fix).

---

*This document is the whole deliverable — a plan, not a commitment to code.*
