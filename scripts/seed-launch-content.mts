// seed-launch-content.mts — one-time launch content seeding for production.
// Creates staff-authored-style guides (by TerpBot), a pinned welcome thread,
// an intro thread, and a couple of chat messages in #general.
//
// Idempotent: existing guide slugs and thread titles are skipped, so a
// re-run only creates what's missing. Requires the production DATABASE_URL
// and ALLOW_PRODUCTION_DB_TESTS=1 (db-guard).
//
// Run:
//   DATABASE_URL="<prod pooled url>" ALLOW_PRODUCTION_DB_TESTS=1 \
//     npx tsx scripts/seed-launch-content.mts
import "./db-guard.mjs"
import { prisma } from "../src/lib/prisma"
import { postToGeneral } from "../src/lib/terpbot"
import { TERPBOT_USERNAME } from "../src/lib/terpbot-constants"

const slugify = (t: string) => {
  const s = t.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim()
  if (s.length <= 60) return s
  // Truncated — drop the dangling partial word so slugs end cleanly.
  return s.slice(0, 60).replace(/-[^-]*$/, "")
}

const GUIDES: { title: string; excerpt: string; topic: string; content: string }[] = [
  {
    title: "How to Germinate Cannabis Seeds",
    excerpt: "Paper towel, direct-to-medium, and water-soak methods — plus the temperatures and mistakes that decide whether a seed pops or rots.",
    topic: "BASICS",
    content: `Three methods work reliably. Pick one and don't overthink it — most germination failures come from cold temperatures or letting things dry out, not from the method.

PAPER TOWEL (most common)
Wet a paper towel so it's damp, not dripping. Put seeds between the folded towel on a plate, cover with a second plate to keep humidity in, and keep it somewhere warm — 70–80°F (21–27°C) is the sweet spot. Check once a day. Most viable seeds crack in 24–72 hours; old seeds can take a week. When the taproot is about a quarter to half inch long, move it to your medium, root down, about a quarter inch deep.

DIRECT TO MEDIUM (least handling)
Plant the seed a quarter inch deep in a light, pre-moistened medium — seedling mix, coco, or a starter plug. Keep the surface damp with a spray bottle and cover with a humidity dome or a cut bottle. This avoids any chance of snapping the taproot during transfer.

WATER SOAK (for hard old seeds)
Drop seeds in a glass of room-temperature water for 12–24 hours. They should sink once they take on water. Don't soak past 24 hours — drowned seeds rot.

WHAT KILLS SEEDS
- Cold. Below 68°F germination slows to a crawl; below 60°F many seeds never pop. A seedling heat mat or the top of a fridge (warm from the compressor) fixes this.
- A dried-out towel. Check daily.
- Soggy, oxygen-starved medium. Damp, not mud.
- Planting too deep. A quarter inch is enough. Buried an inch down, a weak seedling can die trying to reach the light.

AFTER THEY POP
Seedlings want gentle light (a dimmable LED at low power or a cheap CFL/T5 about 24–30 inches up), high humidity (65–75%), and barely any water — the seed carries its own food for the first week. Don't feed nutrients yet. If a seedling stretches tall and skinny, the light is too far away — bring it closer before it topples.`,
  },
  {
    title: "Watering Cannabis: How Often, How Much, and How Not to Kill Roots",
    excerpt: "The wet-dry cycle, the pot-weight trick, runoff, and why droopy plants are usually drowning — not thirsty.",
    topic: "BASICS",
    content: `More first grows are killed by overwatering than by anything else. Roots need oxygen as much as they need water, and a pot that never dries out suffocates them.

THE CORE RULE: WET-DRY CYCLE
Water thoroughly, then wait until the medium has actually dried before watering again. In soil, water when the top inch or two is dry — stick a finger in. The most reliable method is lifting the pot: learn what it weighs fully saturated versus dry, and water when it feels light. It takes two waterings to calibrate and then you'll never guess again.

HOW MUCH PER WATERING
Water slowly until 10–20% runs out the bottom in soil. That runoff pushes built-up salts out and tells you the whole root zone got wet. Don't water a splash every day — shallow watering trains roots to stay near the surface and leaves dry pockets lower down. In coco, more frequent smaller feedings with runoff are normal; coco shouldn't fully dry.

SIGNS YOU'RE OVERWATERING
- Droopy, heavy-looking leaves that curl downward like a claw. The classic tell.
- Slow growth, and fungus gnats appearing (they breed in constantly wet topsoil).
- The fix is not more water. Let the pot dry — it can take a week — and pick it up before you water again.

SIGNS YOU'RE UNDERWATERING
- Leaves droop but look light and papery, not heavy. Pot is feather-light.
- Water and the plant perks back up within hours. Underwatering is forgiving; overwatering is not.

SEEDLINGS ARE DIFFERENT
Tiny root systems in a big pot are the classic trap — the outside stays wet while the middle dries around the roots. Water in a small circle around the stem and widen it as the plant grows, or start in a small pot and transplant up.

PRACTICAL NOTES
- pH your water: 6.0–7.0 for soil, 5.8–6.2 for coco/hydro. Wrong pH locks out nutrients no matter how good your feed is.
- Room-temperature water. Cold shocks roots.
- Fabric pots or air pots dry faster and are far more forgiving of heavy hands than plastic.`,
  },
  {
    title: "Reading Cannabis Leaves: Deficiency and Toxicity Cheat Sheet",
    excerpt: "Mobile vs immobile nutrients, the N-tox claw, calmag under LEDs, and the pH lockout ranges to check before you add anything.",
    topic: "NUTRIENTS",
    content: `First rule of leaf diagnosis: check pH before you add a single nutrient. Most "deficiencies" are actually pH lockout — the nutrient is in the medium, the roots just can't absorb it.

MOBILE VS IMMOBILE — WHERE THE SYMPTOM SHOWS
- Mobile nutrients (N, P, K, Mg): the plant moves them to new growth, so deficiencies show on the OLDER, lower leaves first.
- Immobile nutrients (Ca, Fe, etc.): can't be relocated, so symptoms show on NEW growth at the top first.
That one distinction narrows the diagnosis immediately.

NITROGEN
- Deficiency: lower leaves pale green → yellow → die off evenly. Normal in late flower (senescence); a problem in veg.
- Toxicity (N-tox): leaves go dark glossy green and tips claw downward hard. This is the single most common problem in new grows — too much Grow/Bloom feed or hot soil. Back off the feed; don't add more.

PHOSPHORUS
- Deficiency: dark, bluish-green leaves, sometimes purpling stems, slow growth, occasionally bronze spotting on lower leaves. Often a cold-root-zone symptom too — cold wet soil locks out P even when it's there.

POTASSIUM
- Deficiency: edges of leaves yellow then brown and crisp (marginal burn), usually on older growth first.

CALCIUM / MAGNESIUM ("calmag")
- Calcium deficiency: rust-brown spots on new growth, distorted leaf tips.
- Magnesium deficiency: interveinal yellowing on older leaves — veins stay green, tissue between them pales.
- Both are common under LED lighting, which drives faster growth than old HPS setups. If you run LEDs and RO water, calmag is almost mandatory.

pH LOCKOUT RANGES
- Soil: feed/water at 6.0–7.0. 
- Coco & hydro: 5.8–6.2.
Drift outside those and uptake collapses in a specific order — which is why a "mystery deficiency" that ignores supplements is usually a pH problem, not a nutrient shortage.

FIX PROTOCOL
1. Test runoff pH (water through, measure what comes out).
2. If pH is off, correct it and give plain pH'd water for a watering or two.
3. Only then adjust nutrients — and go up in half-strength steps, not full doses.`,
  },
  {
    title: "Temperature, Humidity, and VPD by Growth Stage",
    excerpt: "Realistic temp/RH targets from seedling to late flower, the VPD bands that matter, and why bud rot lives at high humidity.",
    topic: "ENVIRONMENT",
    content: `Plants ride a temperature–humidity relationship called VPD (vapor pressure deficit). You don't need to obsess over the chart, but the stage-by-stage ranges below keep you in the healthy band.

SEEDLINGS & CLONES
- Temp: 75–80°F (24–27°C)
- RH: 65–75%
Small root systems can't drink fast — high humidity keeps them from drying out while roots develop. A dome helps for the first week or two.

VEGETATIVE
- Temp: 70–85°F (21–29°C), lights on
- RH: 50–70%
Wide tolerance. Growth is fastest around the upper end as long as airflow is good.

FLOWER (weeks 1–6)
- Temp: 65–80°F (18–27°C)
- RH: 45–55%
Drop humidity as buds stack. Dense colas trap moisture inside themselves.

LATE FLOWER (last 2–3 weeks)
- Temp: 65–75°F
- RH: 40–50%, lower if you can manage it
This is where bud rot (botrytis) lives. A big cola at 70% RH in week 8 is a rot farm. Dehumidifier beats everything else here.

LIGHTS-OFF DROP
A 5–10°F drop at lights-off is fine and normal. A big drop (15°F+) combined with high humidity causes condensation inside buds — again, rot. If night temps crash, run a small heater or time the dehumidifier for dark hours.

VPD IN ONE PARAGRAPH
VPD measures how hard the air pulls moisture from leaves. Roughly: seedlings want 0.4–0.8 kPa, veg 0.8–1.2, flower 1.2–1.5. You hit those bands automatically by staying in the temp/RH ranges above. A cheap temp/RH sensor that logs to your phone is worth more than any gadget in the tent.

AIRFLOW IS PART OF ENVIRONMENT
An oscillating fan moving air through the canopy (not blasting it) does more against mold and weak stems than most additives. Stems should sway gently, not thrash.`,
  },
  {
    title: "Low Stress Training (LST), Step by Step",
    excerpt: "When to start, how to bend without snapping, and how a bent stem turns one cola into eight.",
    topic: "TRAINING",
    content: `LST is bending and tying down branches instead of cutting the plant. It works because cannabis pushes most of its growth into the highest point (apical dominance) — bend the main top below the side branches and the plant redistributes growth across all of them. Same plant, same light, dramatically more even canopy and more top sites.

WHEN TO START
Once the plant has 3–4 nodes and a flexible stem — usually 2–4 weeks from sprout for photos. Autos: start around day 14–21 and be gentle; there's no recovery time in an auto's fixed schedule.

WHAT YOU NEED
Soft plant ties, garden wire covered in something soft, or pipe cleaners. And something to anchor to — holes drilled in the pot rim work, or tie to the pot itself.

THE METHOD
1. Water a few hours before — well-hydrated stems bend; dry ones snap.
2. Pick a bend point a few nodes up where the stem still flexes. Hold below the bend with one hand, press gently with the other thumb until you feel the stem soften, then ease it over 90 degrees.
3. Tie the top down so it sits below the side branches. Loose loop — a tight tie girdles the stem as it thickens.
4. Every day or two, adjust ties to keep the canopy level. That's it — LST is a daily five-minute habit, not a one-time event.

IF YOU SNAP A STEM
Tape it back together with plant tape or even duct tape and support it. A partially attached stem heals in a week or two — the plant is tougher than it looks. Full break = it becomes a clone or compost.

COMBINING WITH TOPPING
Topping (cutting the main tip) plus LST is the classic manifold setup: top once at 4–5 nodes, then train the resulting mains outward. More aggressive, still reliable. Never top an auto on a tight schedule — the stunting can cost more than it gains.

WHEN TO STOP
Keep shaping through the first two weeks of flower (the stretch). After week 3 of flower, leave the plant alone — stems lignify, bending gets brittle, and the plant's focus should be on buds.`,
  },
  {
    title: "When to Harvest: Reading Trichomes, Not the Calendar",
    excerpt: "Clear, cloudy, amber — what the trichome stages actually mean for effect, and why pistils lie.",
    topic: "HARVEST",
    content: `Breeders' flower times (8 weeks, 10 weeks) are estimates. Your environment, genetics, and pheno all shift the real window. Trichomes are the truth — pistils are not.

THE TOOL
A jeweler's loupe (30–60x, a few dollars) or a phone macro lens. Check trichomes on the buds themselves, not the sugar leaves — leaf trichomes mature earlier and will make you harvest too soon.

THE THREE STAGES
- Clear: immature. THC still developing, and harvesting now gives weak, racy, sometimes headache-y smoke. Wait.
- Cloudy/milky: peak THC. The classic "up" effect window.
- Amber: THC degrading to CBN — more body-heavy, sedative. 

THE COMMON TARGETS
- Mostly cloudy, ~0–10% amber: energetic, heady.
- Mostly cloudy with 10–20% amber: the standard harvest window — full potency with some depth.
- 30%+ amber: heavy, sleepy. Some people want exactly this for night use.

Check the top colas AND lower buds — tops finish first. A common move is harvesting top colas at peak and giving lowers another week to ripen under the freed-up light.

WHY PISTILS LIE
"When 70% of the hairs turn orange" is folklore. Pistils wither early from stress, handling, wind, or just genetics — and some strains throw fresh white pistils right at the end. Use trichomes; pistil color is at most a supporting hint.

ABOUT "FLUSHING"
You'll see arguments both ways. What's not debatable: don't chop early because you planned a flush — the harvest window doesn't care about your schedule. If you flush, plain pH'd water for the last week or two is the common approach; whether it measurably changes the smoke is honestly contested. What IS worth doing is not overfeeding in the last weeks — heavy late feed is hard on the plant's finish.

AFTER THE CHOP
Have your dry space ready BEFORE you cut — 60°F/60% RH, dark, gentle airflow. A great harvest ruined by a 75°F humid dry is one of the most common rookie tragedies.`,
  },
  {
    title: "Drying and Curing: The 60/60 Method",
    excerpt: "Seven to fourteen days hanging at 60°F and 60% RH, then jars — the unglamorous steps that decide how it actually smokes.",
    topic: "HARVEST",
    content: `Drying and curing decide more about final quality than the last month of growing. Slow is the whole game — chlorophyll and moisture need time to work out of the plant.

THE DRY
- Hang whole plants or branches in the dark at ~60°F (15–16°C) and ~60% RH — the "60/60" rule.
- Gentle airflow in the room, but never a fan pointed at the buds. Drying the outside faster than the inside traps moisture and gives hay smell.
- Target: 7–14 days. Small stems snap instead of bend — that's the ready signal, and it's usually when the outsides feel dry but the bud still has give.

Too hot or too dry and you get the hay smell permanently. Too humid or no airflow and you get mold. Both ruin the same amount of work — the whole grow.

TRIM TIMING
Wet trim (before drying) dries faster — useful in humid climates. Dry trim (after) is slower and kinder to terpenes. Either works; be consistent so you can compare grows.

THE CURE
1. Fill wide-mouth mason jars about 75% full — don't pack.
2. Seal and open ("burp") once or twice a day for the first week to exchange air.
3. Put a cheap hygrometer in a jar. If it reads over 65% RH, dump the buds out for a few hours and re-jar — that's mold territory. If it stays at 58–62%, the cure is dialed.
4. After week one, burp every few days.

HOW LONG
Two weeks of cure makes decent smoke good. Four to eight weeks is where it gets genuinely smooth — the difference is not subtle. Most people never cure long enough to find out.

STORAGE
Airtight glass, dark, cool. No plastic bags for long-term (they breathe and static-steal trichomes), no fridge, no freezer unless vacuum sealed for true long-term. Properly cured and stored, quality holds for a year-plus.`,
  },
  {
    title: "Common Cannabis Pests: Fungus Gnats, Spider Mites, and Thrips",
    excerpt: "Identification, prevention, and treatment for the three pests almost every indoor grower meets — and the sprays to never use in flower.",
    topic: "PESTS",
    content: `You'll meet these eventually. Catching them early is the entire game — a pest you spot at five individuals is a sticky trap; at five hundred it's a war.

FUNGUS GNATS
- ID: tiny black flies hovering over the soil, especially after watering. Larvae in the top inch of wet medium are what actually eat roots.
- Cause: chronically wet topsoil. They're a symptom of overwatering as much as a pest.
- Fix: let the top inch or two of medium dry between waterings — this alone breaks their life cycle. Yellow sticky cards catch adults. BTi (sold as Mosquito Bits/Dunks, watered in) kills larvae biologically and is safe through the whole grow.

SPIDER MITES
- ID: fine yellow-white speckling on leaf tops, then tiny webbing under leaves and between buds. Tap a leaf over white paper and look for moving dots.
- Cause: hot, dry air and hitchhiking on clothes/pets/tools.
- Fix: they hate moisture — lower temps and raise humidity while treating. In veg: insecticidal soap or neem (spray leaf UNDERSIDES, lights off or about to be). Predatory mites (Phytoseiulus persimilis) are the clean nuclear option for a sealed tent. 
- In flower, do NOT spray buds with anything — soap, neem, and oils all ruin them. Predators and environment only, or cull.

THRIPS
- ID: silver/bronze streaks and shiny specks on leaves, with tiny slender yellow-white bugs visible on close inspection.
- Fix: sticky cards, insecticidal soap in veg, spinosad is effective but keep it out of flower — same rule as everything else: nothing sprayed on buds past early flower. Ever.

PREVENTION — THE PART THAT MATTERS
- Sticky cards up from day one, even with no pests — they're your early-warning system.
- Quarantine anything that comes from outside: clones especially (hold 1–2 weeks and inspect daily).
- Keep the floor clean, intake filtered if possible, and don't walk into the tent straight from the garden.
- Inspect leaf undersides weekly with a loupe. Pests hide where nobody looks.`,
  },
]

const THREADS: { title: string; categorySlug: string; pinned: boolean; content: string }[] = [
  {
    title: "Welcome to TerpTalk — start here",
    categorySlug: "general-cannabis-discussion",
    pinned: true,
    content: `Hey, I'm TerpBot — TerpTalk's built-in community assistant. Since you're probably new, here's the quick tour:

Grow Diaries — document a grow from sprout to jar. Post updates with photos, stage, and environment stats. Diaries are the heart of this place, and the monthly contest winner gets picked from them.

Guides — staff-written reference articles covering germination through cure. Good starting point if you're mid-grow and something looks wrong.

Discussions — the forum. New Grower Questions is a friendly first stop; nobody here will roast you for asking about droopy leaves.

Chat — live rooms in the sidebar. Tag me (@terpbot) or type /help in chat and I'll answer questions or point you at the right place.

A few things worth knowing up front: this is a 21+ community, pseudonymous by design — no email required, your recovery phrase is your backup key, and reputation comes from actually contributing (threads, diaries, helpful answers), not from grinding.

Start a diary, introduce yourself, or post your first question. The board's better with your grow in it.`,
  },
  {
    title: "What are you growing right now?",
    categorySlug: "general-cannabis-discussion",
    pinned: false,
    content: `Intro thread — drop your current (or next) grow below:

Strain, medium (soil/coco/hydro), and tent or outdoor — and a photo if you've got one.

Stuck on something? Say that too. There are growers here who've killed the same seedlings, fought the same gnats, and misread the same trichomes you're looking at right now.`,
  },
  {
    title: "First grow? Ask your questions here",
    categorySlug: "new-grower-questions",
    pinned: false,
    content: `Everyone's first grow hits the same wall around week three — something yellows, droops, or just stops, and every forum search gives you six conflicting answers.

Post it here. Include a photo and your basics (medium, light, temps, what you've fed) and you'll get a useful answer instead of a guess. If the question's embarrassing, it's probably been asked — and answered — before.

Tip: marking the reply that fixed it as the accepted answer helps the next grower with the same problem, and earns the helper some rep.`,
  },
]

const CHAT_MESSAGES = [
  "📚 New in Guides: seed germination, watering, leaf diagnosis, VPD, LST, harvest timing, drying & curing, and pest control — all staff-written. Good bookmark material.",
  "👋 If you're new — welcome. Start a grow diary, ask anything in New Grower Questions, or tag me (@terpbot) with a question and I'll point you the right way.",
]

async function main() {
  const bot = await prisma.user.findFirst({
    where: { profile: { username: TERPBOT_USERNAME } },
    select: { id: true },
  })
  if (!bot) throw new Error("TerpBot user not found — is this the production DB?")

  let createdGuides = 0
  for (const g of GUIDES) {
    const slug = slugify(g.title)
    const existing = await prisma.guide.findFirst({ where: { title: g.title }, select: { id: true, slug: true } })
    if (existing) {
      // Repair pass — an earlier run may have left a mid-word-truncated slug.
      if (existing.slug !== slug) {
        await prisma.guide.update({ where: { id: existing.id }, data: { slug } })
        console.log(`  ~ guide slug repaired: ${existing.slug} -> ${slug}`)
      } else {
        console.log(`  skip guide (exists): ${slug}`)
      }
      continue
    }
    await prisma.guide.create({
      data: {
        title: g.title.slice(0, 120),
        slug,
        excerpt: g.excerpt.slice(0, 300),
        content: g.content,
        topic: g.topic,
        authorId: bot.id,
        published: true,
      },
    })
    createdGuides++
    console.log(`  + guide: ${slug}`)
  }

  let createdThreads = 0
  for (const t of THREADS) {
    const cat = await prisma.category.findUnique({ where: { slug: t.categorySlug }, select: { id: true, hidden: true } })
    if (!cat || cat.hidden) { console.log(`  !! category missing: ${t.categorySlug}`); continue }
    const desired = slugify(t.title)
    const existing = await prisma.thread.findFirst({ where: { title: t.title, authorId: bot.id }, select: { id: true, slug: true } })
    if (existing) {
      if (existing.slug !== desired) {
        await prisma.thread.update({ where: { id: existing.id }, data: { slug: desired } })
        console.log(`  ~ thread slug repaired: ${existing.slug} -> ${desired}`)
      } else {
        console.log(`  skip thread (exists): ${t.title}`)
      }
      // Repair: threads seeded before the OP-post duplication have their body
      // only on thread.content and render empty. Backfill the missing row.
      const postRows = await prisma.post.count({ where: { threadId: existing.id } })
      if (postRows === 0) {
        await prisma.post.create({ data: { content: t.content, authorId: bot.id, threadId: existing.id } })
        console.log(`  ~ thread OP post backfilled: ${existing.slug}`)
      }
      continue
    }
    let slug = desired
    while (await prisma.thread.findUnique({ where: { slug } })) {
      slug = `${desired}-${Math.random().toString(36).slice(2, 6)}`
    }
    await prisma.thread.create({
      data: {
        title: t.title,
        slug,
        content: t.content,
        categoryId: cat.id,
        authorId: bot.id,
        pinned: t.pinned,
        // Match the forum POST route: the OP body lives on the thread AND on
        // a first Post row, which is what the thread page actually renders.
        posts: {
          create: {
            content: t.content,
            authorId: bot.id,
          },
        },
      },
    })
    createdThreads++
    console.log(`  + thread: ${slug}`)
  }

  const general = await prisma.chatRoom.findFirst({ where: { slug: "general", isPrivate: false }, select: { id: true } })
  for (const msg of CHAT_MESSAGES) {
    // postBotMessage strips "@terpbot" from its own output — compare stored
    // form so a re-run doesn't repost an identical message.
    const stored = msg.replace(/@terpbot\b/gi, "terpbot")
    const already = general
      ? await prisma.chatMessage.findFirst({
          where: { roomId: general.id, authorId: bot.id, content: stored, deleted: false },
          select: { id: true },
        })
      : null
    if (already) { console.log("  skip chat post (exists)"); continue }
    const dto = await postToGeneral(msg)
    console.log(dto ? `  + chat post (${dto.id})` : "  !! chat post failed")
  }

  console.log(`\nDone: ${createdGuides} guides, ${createdThreads} threads, ${CHAT_MESSAGES.length} chat posts`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
