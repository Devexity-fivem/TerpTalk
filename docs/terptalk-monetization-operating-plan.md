# TerpTalk Monetization — Operating Plan

*Business/operations document. No product code.*

## Affiliate Program Audit (VERIFIED — production, this pass)

**Roster:** 2 active partners, 29 cataloged products (26 active, 3
inactive), 4 categories (Clones, Grow Lights, Grow Tent Kits, Fans &
Ventilation).

| Partner | Code | Products | Prod clicks | Status |
|---|---|---|---|---|
| Mars Hydro | `TCK` | 10 | 37 total (~3–4/product, uniform — likely test/seed traffic, not organic) | KEEP |
| Clone to Home | `TCK10` | 19 (16 active, 3 inactive: Cheese, Mendo Grapes, Watermelon Rush) | **0** | KEEP — see actions |

**Audit findings (concrete):**
- All 29 products have `imageUrl = null` → cards render text-only. **Action: add partner product images** (partner media kits or request assets).
- `mars-hydro-ts1000` and `mars-hydro-ts600` have **no price** — fill in from partner site.
- Clone to Home has **zero recorded clicks** across all products — either untrafficked placement or click attribution gap; Mars Hydro clicks are suspiciously uniform. Watch organic traffic before concluding.
- No `minRank`/`publicAt` gating is in use — Garden Perks plumbing exists but unused. Fine; could gate premium genetics later.
- No duplicate products, no broken `/go/` destinations (all sampled redirects → real partner pages, 302 with affiliate params intact).
- Disclosure text renders on `/deals`; links carry `rel="sponsored nofollow"`. FTC-consistent baseline.

**Classification:** Mars Hydro = KEEP. Clone to Home = KEEP (genetics are uniquely relevant to this audience; zero clicks reflects audience size, not product fit — revisit after first real cohort). No REMOVE. Contact Clone to Home for: product images + confirmation that clone pricing ($89/$125) is current.

## Revenue Staging (strategic hypotheses — not rules)

| Stage | What earns money | Gate to enter |
|---|---|---|
| **NOW** (<100 active members) | Existing affiliate program only. Curate roster; fill missing images/prices. Business outreach only. | — |
| **100–1k** | Affiliate expansion; one challenge-sponsorship pilot; first sponsor/media-kit conversations | Real engagement visible |
| **1k–10k** | TerpTalk Pro (only after billing path confirmed); sponsored knowledge; creator campaigns; Grow Lab pilots | Billing accepted; growers documenting |
| **10k+** | Brand partnerships; aggregate public-data insights (legal review first) | Scale + legal review |

## Sponsor Trust Rules (non-negotiable)

Sponsors never control: answers · Plant Doctor · moderation · search
ranking · grow matching · strain statistics · reputation · negative
reviews · member opinions. All sponsored content is labeled. A sponsored
grow must publish positive, negative, and mixed outcomes equally. The
sponsor pays for exposure and documentation — never for praise.

## What TerpTalk Never Becomes

Ad farm · data broker · pay-to-win · pay-to-help · pay-to-rank ·
sponsor-influenced knowledge base.

## Legal/Policy Checklist (requires professional review before launch)

- [ ] Payment processor acceptance of cannabis-cultivation community
      (see `terptalk-pro-hypothesis.md` — outreach drafts ready)
- [ ] Sponsorship disclosure templates (FTC 16 CFR 255)
- [ ] Affiliate agreement review (existing partners' terms)
- [ ] Contest/sweepstakes rules for sponsored challenges (state variance)
- [ ] Sales tax / VAT treatment (MoR handles if used; direct = we own it)
- [ ] Creator sponsorship disclosure obligations
- [ ] 21+/age-gating consistency in commercial contexts

*This document is business preparation, not legal advice.*
