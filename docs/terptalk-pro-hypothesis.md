# TerpTalk Pro — Hypothesis & Billing Path

*Strategy document only. Nothing here is built, priced, or validated.*

## Concept

**Community = free · Knowledge = free · Help = free · Power tools = paid.**

Pro sells capability to growers who already love the free product —
never access, never help, never status.

- **Target user:** the documenting grower — someone running multiple
  diaries who wants deeper analytics on their own data.
- **Candidate paid features** (all small-medium extensions of existing
  systems): PDF/season grow reports & data export · cross-grow
  comparisons · extended environmental history · advanced personal grow
  statistics · advanced strain comparison · private archive.
- **Always free:** posting · replying · questions & answers · reading all
  knowledge · basic diaries · Plant Doctor · progression · notifications
  · matching.

## Pricing Hypothesis — NOT VALIDATED

| Tier | Price | Note |
|---|---|---|
| Monthly | ~$5/mo | comparable niche power-user tools cluster $3–8/mo |
| Annual | ~$45/yr | ~25% annual discount |
| Founder lifetime | ~$100–150 | early-member reward; capped count |

Hypothetical economics (HYPOTHETICAL): 100 paying members × $5/mo =
$500/mo gross. At ~1k active members that's an optimistic ~10%
conversion assumption — treat as a ceiling, not a forecast.

## Billing Path — Current Research (web sources, not legal advice)

| Provider | Subscriptions | Cannabis/cultivation risk | Status | Needs direct confirmation |
|---|---|---|---|---|
| **Stripe** | Yes | **Prohibited categories include "courses and information on cultivating marijuana"** and grow equipment marketed for marijuana — a cultivation community is squarely in scope. Documented enforcement vs cannabis-adjacent businesses. | Likely incompatible | Yes — but expect refusal |
| **PayPal** | Yes | AUP bans drug paraphernalia + items that "instruct others to engage in illegal activity"; cultivation content plausibly covered. Enforcement inconsistent. | High risk | **Yes** |
| **Paddle** (MoR, 5%+50¢) | Yes | No explicit public cannabis-community policy found; MoR absorbs tax/VAT but content risk remains | Uncertain — best mechanical fit | **Yes — ask first** |
| **Lemon Squeezy** (MoR, 5%+50¢+0.5% subs; Stripe-owned) | Yes | Parent Stripe's underwriting rules may apply | Uncertain | **Yes — ask** |
| **High-risk specialists** (GoPayhawk, PayBlox, PayRio, Spectrum, Midnight Payments) | Yes — recurring supported | **Explicitly underwrite cannabis-ancillary businesses on their own model** | Realistic path | Yes — underwriting call |

**Assessment:** the two realistic Pro billing paths are (a) a
merchant-of-record that explicitly accepts the category — best tax
story, or (b) a high-risk cannabis-ancillary processor — higher fees,
manual underwriting, but designed for this. **Do not write billing code
until one provider confirms in writing.**

## Provider Outreach Drafts (ready to send — do NOT send until reviewed)

### To Paddle / Lemon Squeezy

> Subject: Acceptable-use confirmation — cannabis cultivation community subscription
>
> We operate TerpTalk (terp-talk.vercel.app), a pseudonymous online
> community for adults 21+ where members document cannabis grows, ask
> and answer cultivation questions, and share growing knowledge.
> TerpTalk does not sell cannabis, cannabis products, seeds, clones, or
> cultivation equipment. Members may not sell anything through the
> platform.
>
> We are considering a paid "Pro" tier that gives members software tools
> on their own data: grow analytics, PDF reports, comparisons, and
> archives. The subscription is for software features only — no physical
> goods, no cannabis-adjacent product sales.
>
> Please confirm in writing:
> 1. Does this business model qualify under your acceptable-use policy?
> 2. Is recurring subscription billing permitted for it?
> 3. Does cannabis-related educational/community content on the platform
>    (no product sales) violate your policy?
> 4. Are there restricted categories we must avoid to remain compliant?
>
> A written answer lets us build on the right foundation. Thank you.

### To a high-risk specialist (GoPayhawk / PayBlox / PayRio)

> Subject: Underwriting inquiry — cannabis-adjacent SaaS subscription
>
> TerpTalk is a cannabis-**ancillary** software business: a pseudonymous
> community + grow-documentation platform for adults 21+. We never touch
> the plant and sell no physical goods — the product is hosted software:
> grow diaries, community discussion, cultivation analytics.
>
> We want recurring subscription billing for a member "Pro" tier
> (software tools only). Rough volume to start: under $5k/mo, US-based,
> adult members.
>
> Questions:
> 1. Will you underwrite a cannabis-adjacent SaaS/community of this kind?
> 2. What documentation does your underwriting require?
> 3. What are the fees, reserve requirements, and chargeback terms?
> 4. Any content restrictions on member-generated cultivation discussion?
