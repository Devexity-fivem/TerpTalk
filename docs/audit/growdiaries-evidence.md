# GrowDiaries competitive evidence file

**Observation date:** 2026-09-27 (UTC). All page observations via anonymous `curl` with a desktop
Chrome UA — no login, no account, no posting. `webfetch` is 403'd; direct curl works for most
pages. Some fetches (sitemap, one question page, `/seeds`) were blocked/failed — see "Blocked".

Tags: **OBSERVED** = seen in fetched HTML/text · **DOCUMENTED** = official GrowDiaries journal
post or store listing · **INFERRED** = my reading of UI/state · **UNKNOWN** = could not verify.

The site is a Nuxt (Vue) SSR app; page HTML embeds a devalue payload plus a `window.__NUXT__.config`
block exposing `baseAPI: https://growdiaries.com/api/v1`, Cloudflare Turnstile site key, and a
gtag id `G-K1T13ERM3V` — [OBSERVED] — growdiaries.com/* (2026-09-27).

## 1. Homepage `/`

- [OBSERVED] Top nav: Home, Threads, Diaries, Strains, Shorts, Questions, Contests, Growers, Seeds, Breeders, Nutrients, Equipment, Blog, language selector ("English"), "Start My Diary" CTA ×3, Log In / Sign Up. Banner: "Threads is in beta — try the new feed". — https://growdiaries.com/ (2026-09-27)
- [OBSERVED] Homepage body is a stream of recent diary cards (each linking `/diaries/<id>-grow-journal-by-<user>`), plus Shorts cards, strain links, grower links, and an "Explore" entry. — https://growdiaries.com/ (2026-09-27)
- [OBSERVED] Paid placements: an ad system serves partner banners from `bucket.growdiaries.com/static/partner/...` with click-out through `growdiaries.com/api/v1/redirect?sc=…&id=…&url=…` (server-side tracked redirects with utm params). Advertisers seen in the payload: Fast Buds / 2fast4buds, Barney's Farm, AC Infinity, PRO-MIX (pthorticulture), American Autoflower Cup (Eventbrite), Autoflower World Cup. Banner fields include `package`, `package_brand_id`, `boosted`, `date_finish`, `sys_impression`. — https://growdiaries.com/ (2026-09-27)
- [OBSERVED] Footer: Contact Us, FAQ, Privacy, Terms, Advertising; legal entity "GrowD soft s.r.o., Lindleyova 2822/10, Dejvice, 160 00 Praha 6, Czech Republic" (rendered with look-alike unicode characters). Social links: Facebook, Instagram, Pinterest; app badges link to Play Store + App Store. — https://growdiaries.com/ (2026-09-27)
- [OBSERVED] No guest-visible age gate on `/` — content renders without interstitial. — https://growdiaries.com/ (2026-09-27)

## 2. Diaries — list `/explore` + detail `/diaries/<id>-<slug>`

- [OBSERVED] `/diaries` itself is 404; the diaries index lives at `/explore` (title: "Search cannabis grow journals"). — https://growdiaries.com/diaries and /explore (2026-09-27)
- [OBSERVED] `/explore` filters with live counts (2026-09-27): All 108,847 · Growing 40,580 · Harvested 68,263 · Autoflowering 48,582 · Photoperiod 48,036 · Indoor 92,521 · Outdoor 12,458 · FL 108,039 · HID 33,084 · LED 80,203 · Organic · CBD 2,687 · Champions 1,745 · Videos 38,025 · Questions 3,229 · language filters Spanish 2,663, German 931 · technique tags LST 59,333, HST 10,893, SoG 4,676, ScrOG 14,886, Topping 38,638, FIMing 6,862, Main-Lining 6,970, 12-12 4,189, Defoliation 53,617, Manifolding 652, Transplantation 3,803 · Germination method (Paper Towel / Glass Of Water / Rockwool Cube / Peat Pellet / Directly In Substrate / Other) · Watering (Manual / Drip / Hydroponics / Aeroponics) · Substrate (Soil / Perlite / Vermiculite / Expanded Clay / Coco Coir / Mineral Wool / Other) · "More filters". — https://growdiaries.com/explore (2026-09-27)
- [OBSERVED] Sort options: last update / grow score / likes / creation date. Cards show week count, title, grower, strain(s) ("+N strains"), time-ago, comment count. — https://growdiaries.com/explore (2026-09-27)
- [OBSERVED] `/explore/harvested` applies the same tag set filtered to Harvested (68,263) with per-tag harvested counts. — https://growdiaries.com/explore/harvested (2026-09-27)
- [OBSERVED] Diary page header block (diaries/315945, /diaries/319473): title, grower, like/comment/share counts, strain + breeder link, nutrients brands used, VEG and FLO light models (e.g. "SF-300 LED/33W ×2 Spider Farmer"), tent, fan, carbon filter, substrate brand+product, Indoor/Outdoor room type, techniques with week ranges ("Defoliation weeks 7, 10, 13, 15"), pot size, watering volume. — https://growdiaries.com/diaries/315945-grow-journal-by-zahradnikbob (2026-09-27)
- [OBSERVED] Timeline model = weeks: "Week G. Germination" then "Week 1. Vegetation"… through "Week N. Harvest"; a "Start at Harvest" jump control exists. Each week shows photo count "1/6", date-ago, and per-week fields: Height (cm), Light Schedule (hrs), Day Air Temp, Night Air Temp, Air Humidity %, pH, PPM/EC (seen as ppm/µscm in user notes), Smell (e.g. "No Smell"), Pot Size, Watering Volume, Lamp Distance, plus Nutrients list with per-product dosing in ml/L (e.g. "CalMag 0.3 mll"), germination method tag, and "Used techniques" chips. Each week has its own like/comment/share. — same URLs (2026-09-27)
- [OBSERVED] Harvest week (diaries/316529): "Happy Harvest Day!" banner, strain rating 9/10, "Spent 128 days" with Ger/Veg/Flo/Har duration split, "57 g Bud dry weight per plant", plants count, grow-room size, difficulty, an Indica↔Sativa / Sleepy↔Energy slider, then a multi-series harvest graph (legend: Height, Day air temperature, Air humidity, PPM, PH, Light schedule, Solution temperature, Night air temperature, Pot size, Lamp distance), and an "Equipment Reviews" section with per-product star ratings (e.g. "Ionboard S44 … AC Infinity 10/10 Rated"). Comments sort: popularity / newest / oldest. — https://growdiaries.com/diaries/316529-grow-journal-by-juschiln420 (2026-09-27)
- [OBSERVED] The "add/update" flow is not guest-visible: `+ Start the Diary` links to `/diaries/edit/new` behind signup; FAQ says minimum cadence is weekly and the editor is "divided by weeks". — https://growdiaries.com/faq (2026-09-27)
- [OBSERVED] Meta description format auto-summarizes the diary: `"X" cannabis grow journal. Strains: <breeder> <strain> by <grower>. Grow room <n>, growing in <medium>. Harvest yield, seeds review, grow details.` — https://growdiaries.com/diaries/316529-… (2026-09-27)

## 3. Strains — `/strains` + detail

- [OBSERVED] Strain index header count "7817 strains" (2026-09-27). Filter chips: High yield, High THC, Best strains, Beginners, Indica, Sativa, Hybrid, Most awarded, CBD, Indoor, Outdoor, Purple, Compact, Fastest, Washers, Mold resistant, Greenhouse, Cold climate, Daily smoke, Hash making; plus facet groups: Genes, Helps with (conditions), Tastes (~50 values: Ammonia…Woody), Effects (Euphoric/Happy/Relaxed/Uplifted/Energetic/Creative/Giggly), Effects to avoid, Difficulty, Height (Low/Medium/Tall), Yield (Medium/Low…), THC level, Features. Sorts: featured / a-z / rating / g/plant / harvests / diaries. — https://growdiaries.com/strains (2026-09-27)
- [OBSERVED] Strain cards show THC%, CBD%, rating x/10, harvests count. — same (2026-09-27)
- [OBSERVED] Strain page (e.g. Runtz): aka-name aliases, aggregate rating 8.7, 281 harvests, hybrid genes, 22% THC / 0.64% CBD, 480 diaries, "Strain Creator" attribution (Runtz Crew), editorial description with inline strain cross-links, Positive/Negative Effects, Conditions ("helps with"), Tastes, Indica↔Sativa slider, potency scale, tabs: Info · Diaries 400+ · Products 24 · Harvests 281 · Gallery · Reviews 236 · Family Tree (crosses list, e.g. "Animal Runtz = Runtz × Animal Face"), and per-breeder "Breeder products" rows with their own diary/harvest/rating counts ("Runtz by Zamnesia Seeds 389 diaries 242 harvests"). — https://growdiaries.com/strains/runtz (2026-09-27)
- [OBSERVED] Same structure on Blue Zushi (The TenCo; 104 diaries, 49 harvests, 36 reviews). — https://growdiaries.com/strains/blue-zushi (2026-09-27)

## 4. Breeders — `/seedbank` + brand page

- [OBSERVED] `/seedbank` is a ranked breeder table: "# N <name> <N> products · <Growers> · <Diaries> · rating /10 · <Harvests>", sorts: Rating / Harvests / Reviews / A-Z / g/plant / Diaries / Growers. Top rows (2026-09-27): Fast Buds (127 products, 8,493 growers, 17,805 diaries, 8.9), Royal Queen Seeds (180 products, 10,816 diaries), Barney's Farm, Sweet Seeds, Zamnesia Seeds (249 products), Dutch Passion, Seedsman, Mephisto Genetics (407 products)… — https://growdiaries.com/seedbank (2026-09-27)
- [OBSERVED] Breeder page (Sensi Seeds): "Message" + "Follow" CTAs, global position (#11), rating 8.6, 999 harvests, 1,930 diaries, country (NL), autoflower/photoperiod split (26%/74%), long editorial bio, tabs Info · Diaries 1K+ · Gallery 11K+ · Growers 1K+ · Harvests 900+ · Strains 275 · Reviews 700+; strain list rows show fem/auto/regular badge, g/p yield, diary counts. — https://growdiaries.com/seedbank/sensi-seeds (2026-09-27)

## 5. Nutrients — `/nutrients` + brand page

- [OBSERVED] `/nutrients` ranked brand table identical shape to breeders (products/growers/diaries/rating/harvests). Top (2026-09-27): Advanced Nutrients (61 products, 6,480 growers, 17,657 diaries, 9.4), BioBizz, Terra Aquatica, Plagron, Canna, Fox Farm… — https://growdiaries.com/nutrients (2026-09-27)
- [OBSERVED] Brand page (Advanced Nutrients): "AdvancedNutrientsLtd **Official Representative**" badge, Follow CTA, rating 9.4/10, tabs Info · Diaries 17K+ · Growers 6K+ · Products 61 · Reviews 6K+, marketing copy block ("Raising the Flavor Profiles…", "pH Perfect®"), "Awards" + "Show All Diaries" feed of diaries using the brand. — https://growdiaries.com/nutrients/advanced-nutrients (2026-09-27)
- [OBSERVED] Individual nutrient products carry their own rating and appear in diary per-week dosing lists (e.g. "SHOGUN Samurai Terra Grow 4 mll"). — diary pages (2026-09-27)

## 6. Equipment — `/equipment` + brand page

- [OBSERVED] `/equipment` category rail lists subcategories: Lights, Grow Tents, Grow Boxes, Ventilation Fans, Air Filter, Air Conditioners, Drip Systems, Hydroponic Systems, Controllers, CO₂ Generators, Substrates, pH Meters, EC/TDS Meters, Thermo-Hygrometers, Loggers & Stations, Light Meters (Lux/PPFD), Timers & Smart Outlets, Mold & Rot Prevention, Pest Control, Beneficial Insects, Traps & Nets, Sprayers. Brand ranking (Lights tab, 2026-09-27): Mars Hydro (53 products, 20,249 diaries), Spider Farmer, ViparSpectra, SANlight (9.9/10), Lumatek, HLG, Vivosun, AC Infinity, Phlizon, Migro… — https://growdiaries.com/equipment (2026-09-27)
- [OBSERVED] Brand page URL pattern is category-scoped, e.g. `/grow-lights/ac-infinity`: "ACINFINITY_INC Official Representative" badge, Follow, 9.5/10, tabs Info · Diaries 2K+ · Growers 1K+ · Products 19 · Reviews 600+, editorial blurb, product cards with per-model harvest counts and ratings ("Ionbeam S16 … 135 harvests 9.6/10"). — https://growdiaries.com/grow-lights/ac-infinity (2026-09-27)

## 7. Growers — `/growers` + profile `/grower/<name>`

- [OBSERVED] `/growers` leaderboard: sorts diaries / likes / signup date / last visited; rows show rank number, username, tier badge (Guru / GrandMaster / Master / Apprentice observed), avg g/plant, diaries count, likes. Top likes count seen: 75,156 (Cannabeast40). — https://growdiaries.com/growers (2026-09-27)
- [OBSERVED] Profile (bartimaeus): self-tagline ("Low Budget Grower"), Message + Follow buttons, "#1962 Global pos.", 8 harvests, 9 diaries, "Growing, years 2", followers, autoflower/photoperiod and indoor split, "Breeders/Nutrients/Lights of choice" percentage breakdowns; tabs: Info · Threads · Replies · Reposts · Diaries · Reviews · Following · Bookmarks · Followers; "Popular Diaries", "Activity" (post events), "Latest Reviews" sections. — https://growdiaries.com/grower/bartimaeus (2026-09-27)

## 8. Grow Questions — `/grow-questions`

- [OBSERVED] Filters: status All/New/Open/Solved/No Diary; stage Germination/Vegetation/Flowering/Harvest; "My Questions / My Answers"; sorts last update / Oldest / Most popular. Symptom taxonomy tree: Buds, Leaves (color/curl/tips/veins/white-powder/wilting…), Plant (node spacing, stem color/weak, height), Roots (brown/mushy/smelly), Setup (clones/lighting/outdoor/seedling/seeds/sensors/substrates/ventilation), Feeding (automatic systems/chemical composition/deficiencies/schedule), Techniques (12-12, defoliation, FIMing, HST, LST, main-lining, ScrOG, SoG, topping), Other (bugs, curing, drying, smoking, mold, general). — https://growdiaries.com/grow-questions (2026-09-27)
- [OBSERVED] Question page: title, asker, "started grow question <time> ago", body text, photo, "Solved" badge, tags (e.g. "Week 2", "Feeding · Other"), answers with likes, a "Selected By The Grower" accepted-answer mark, per-answer "Complain" link. — https://growdiaries.com/grow-questions/93757-ec-ph-levels (2026-09-27)
- [INFERRED] Asking does not require a diary — a "No Diary" status filter exists and questions without linked diaries appear. — same URL (2026-09-27)

## 9. Threads — `/threads` (beta)

- [DOCUMENTED+OBSERVED] Live community feed "of week updates, harvests, questions and wins"; tabs Recommendation / Trends / Search; beta banner solicits feedback via `#threads` hashtag; official post says feed personalizes from reactions ("the feed will learn"), posts can carry a topic, and actions are like, comment, repost, share, translate; posts may include several images; explicit scope includes non-grow "cannabis culture" content. — https://growdiaries.com/threads and https://growdiaries.com/journal/new-feature-threads-is-here (2026-09-27; post dated 2026-08-12)
- [OBSERVED] Feed rows: @username, relative time, free text, optional photo/link/SoundCloud/YouTube, heart-reaction count, comment count; brand accounts post in-feed (Fast_Buds, DryRocket promo with store link); an "18+ NSFW" tag appears on at least one post; @mentions and hashtags observed. — https://growdiaries.com/threads (2026-09-27)

## 10. Shorts — `/shorts`

- [OBSERVED] Vertical-video cards keyed by diary+week: filters All / Photoperiod / Autoflower, stage chips Vegetation/Flowering/Harvest/Flowering+Harvest, week chips Week 1–13 + "All weeks"/"More filters"; sort + Create (upload) + Likes filters. A short page (`/shorts/405915`) shows video, creator follow button, diary/strains attribution, caption (often dense grow logs), Likes/Comments/Share/**Complain**. — https://growdiaries.com/shorts, /shorts/405915 (2026-09-27)

## 11. Contests — `/giveaways`

- [OBSERVED] Active contests (2026-09-27): sponsored brand contests with prize pools and join buttons — Dutch Passion Growing Competition 2026 €1000, Delicious Seeds $3000 (38 participants), ATAMI Bloombastic Diary Contest $6500 (50), Sensi Seeds Grow Cup $2075 (148), Fast Buds Best Outdoor Diary $2500 (82), North Atlantic Seed monthly photo/video/meme contests $540–630, Dream Grow Room €720 (Fast Buds), Sexy Buds €462 (Purple City Genetics), plus Grow Diaries' own "Meme of the Month" and Fast Buds' Diary/Grower/Photo of the Month. — https://growdiaries.com/giveaways (2026-09-27)
- [OBSERVED] Completed-contest archive: "All 704 · EU 6 · US 5 · INT 693", tabs Voting / Sponsored (210) / Not sponsored; The Grow Awards 2025 exists as a separate brand-awards event (`/awards/2025`). — same (2026-09-27)
- [OBSERVED] Contest page (Diary of the Month Sept 2026): categories "Best Diary / Diary with a harvest / Diary with a 'smiley face' / Single strain Diary", "Shipped by Sponsors" note, 114 diaries participating, comment thread, rules summary ("one Diary of a single Grower is eligible", "winners are picked by GD Team", "TEN winners"), entrant table showing grower rank badge + g/watt metric. — https://growdiaries.com/giveaways/diary-of-the-month-september-2026 (2026-09-27)

## 12. Search / tags

- [OBSERVED] Global topbar search with rotating placeholder "Search Diaries" / "Search among …" (typewriter animation). — https://growdiaries.com/ (2026-09-27)
- [OBSERVED] Threads has its own Search tab covering "conversations, growers, topics, and hashtags" (official wording). — journal post (2026-09-27)
- [INFERRED] Search scopes likely diaries/strains/growers/products/questions; the autocomplete category list is rendered client-side — full entity list not captured. — / (2026-09-27)
- [UNKNOWN] No standalone `/tags/*` or `/search` result URL pattern observed in fetched HTML; hashtags in Threads appear clickable client-side.

## 13. SEO

- [OBSERVED] `robots.txt`: disallows `/external`, `/redirect`, `/api`; allows css/js/images; points Googlebot + Yandex + all agents to `Sitemap: https://growdiaries.com/sitemap/sitemap.xml`; Googlebot-specific `Disallow: /posts/photo/*`. — https://growdiaries.com/robots.txt (2026-09-27)
- [UNKNOWN] `/sitemap/sitemap.xml` (and `/sitemap.xml`) return Cloudflare challenge / 404 to curl — child sitemap contents not enumerated. — (2026-09-27)
- [OBSERVED] Diary pages carry JSON-LD `DiscussionForumPosting` (headline, image, datePublished, author Person+profile URL) alongside `WebSite`; homepage carries `WebSite` JSON-LD. — /diaries/316529… (2026-09-27)
- [OBSERVED] Canonical points to `https://growdiaries.com/` on both main and `nl.` host; no `hreflang` links found in fetched HTML. `nl.growdiaries.com` serves an English-titled page (locale likely set client-side/cookie). — / and nl. host (2026-09-27)
- [OBSERVED] Human-friendly URL slugs everywhere: `/diaries/<id>-grow-journal-by-<user>`, `/strains/<name>`, `/grow-questions/<id>-<slug>`, `/seedbank/<brand>`. — various (2026-09-27)

## 14. Mobile apps

- [DOCUMENTED] Android: package `com.growdiaries.droid`, publisher GrowD soft s.r.o., "GrowDiaries", Mature 17+, Productivity, **1K+ downloads**, updated Sep 24 2026 ("fixed a crash … after the 1.0.12 update"); listing claims "over 350,000 enthusiasts" and "over 90,000 grow diaries". — https://play.google.com/store/apps/details?id=com.growdiaries.droid (2026-09-27)
- [DOCUMENTED] iOS: `id6739211123`, "GrowDiary — Plants grow tracker", free, iPhone-only, 18+, Utilities, 48.3 MB, EN + 10 languages; v1.0 released Aug 25, v1.0.4 Sep 18 2026 (stability/background-upload/deep-link fixes); "hasn't received enough ratings to display an overview". — https://apps.apple.com/app/growdiary/id6739211123 (2026-09-27)
- [DOCUMENTED] Open-beta post (2026-03-30): first test build = login/signup, profile tabs, settings, full diary page, diary search, commenting, update feed, add-diary UI, notifications; roadmap names **Chat, Contests, Grow Questions, brand/product pages** as app additions. — https://growdiaries.com/journal/apps-open-beta (2026-09-27)
- [DOCUMENTED] Official release post (2026-09-01): apps can create/update diaries, upload photos, explore diaries, follow feed, comment, manage profile, notifications. — https://growdiaries.com/journal/apps-are-officially-here (2026-09-27)
- [DOCUMENTED] V2.0 (2025-02-17): scroll-down week timeline replacing click navigation; harvest graphs compiling seed-to-harvest env/stage/yield data. V2.2 (2025-06-12): colorful parameter icons back, all weekly photos inline, horizontal photo scrolling, fixed fullscreen video. V2.3 (2025-09-15): notifications split into For You / Following / Messages tabs, auto-read on scroll, per-item delete, @-mention notifications, group chats moved to Messages, Mark All as Read, notification settings incl. opt-outs, profile-menu additions (new diary, upload video). — https://growdiaries.com/journal/introducing-grow-diaries-v2, …-v22, …-v23-notifications-and-messages (2026-09-27)
- [DOCUMENTED] Threads launch post (2026-08-12): beta live feed — posts, photos, multi-image, topics, like/comment/repost/share/translate, Recommendation feed that "learns" from reactions, Trends, Search, #threads feedback channel. — https://growdiaries.com/journal/new-feature-threads-is-here (2026-09-27)

## 15. Commercial signals

- [OBSERVED] `/partner` is a public media kit: plans Platinum 3,699€/mo, Gold 2,499€, Advanced 1,149€, Lite 599€, Trial 849€/mo; line items include sitewide banners (399€), email newsletter (200€), "GD Business" (1,500€/yr), Brand Page Ad-Free, Photos & Videos tab (1,200€/yr), Custom contest (400€), Article + SEO link (800€), Banner designs (150€), Buy Button (1,000€/yr), Featured Brand (1,000€), "Top in the list of brand categories" (700€), homepage box banner (1,000€), seasonal header banners by section (diaries 1,800€/mo high season…), all priced per month/year. — https://growdiaries.com/partner (2026-09-27)
- [OBSERVED] "Official Representative" verified-style badges on brand pages (Advanced Nutrients, AC Infinity); brands can be followed and messaged; brand posts appear natively in Threads; sponsored contests run continuously; every product page is a paid surface ("Brand Page Ad Free" is a purchasable perk). — brand pages + /partner (2026-09-27)
- [OBSERVED] Outbound commerce links are proxied through `/api/v1/redirect` (tracked, robots-disallowed) — monetized clicks. — homepage payload (2026-09-27)

## 16. Trust & safety (guest-visible)

- [OBSERVED] "Complain" link on each grow-question answer and each Short — the guest-visible report mechanism. — question/short pages (2026-09-27)
- [OBSERVED] Cloudflare Turnstile site key present in `__NUXT__.config` (bot protection on forms/login). — all pages (2026-09-27)
- [OBSERVED] FAQ: users cannot add brands — "use the option of 'Custom Breeder & Strain'"; brand additions go through staff email. — https://growdiaries.com/faq (2026-09-27)
- [OBSERVED] NSFW content is tagged in-feed ("18+ NSFW" label on a Threads post); app stores gate at Mature 17+ / 18+. — /threads, store listings (2026-09-27)
- [OBSERVED] Grower profiles are fully public to guests (diaries, reviews, followers, activity). — /grower/bartimaeus (2026-09-27)
- [UNKNOWN] No guest-visible moderation policy page, content-report rationale list, or review-authenticity mechanism observed; no sitewide age gate on the web UI.

## Blocked / not reachable

- `https://growdiaries.com/sitemap/sitemap.xml` and `/sitemap.xml` — Cloudflare challenge / 404 (sitemap index contents UNKNOWN).
- `https://growdiaries.com/grow-questions/93763-…` — HTTP 403 on that specific question page (93757 fetched fine).
- `https://growdiaries.com/seeds` — HTTP 500 at fetch time (seed catalog page not captured).
- `webfetch` on growdiaries.com — 403 globally; all site fetches used curl + browser UA.
- Any login-only surface (diary editor, messages/chat UI, notification settings, Threads composer) — not attempted per scope.
