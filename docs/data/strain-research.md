# Strain catalog research ledger (Slice C)

Authoring-time provenance for `scripts/seed-strains-data.cjs`. No runtime
use — catalog rows are stored locally in Postgres; this file exists so a
future audit can trace every populated field back to evidence.

Field policy: only populate a field a source supports; `null` in the
dataset means "not reliably reported". THC = breeder-published figure or
documented range; single value → `thcMax`. Flowering rounds the breeder
range to the upper week. Autoflowers never get `floweringWeeks` (days
from seed ≠ photoperiod flowering).

## Source categories

- Official breeder pages: Sensi Seeds, Green House Seed Co., Dutch Passion,
  Serious Seeds, DNA Genetics, Barney's Farm, Mr. Nice, Soma Seeds,
  T.H.Seeds, Big Buddha Seeds, Ethos Genetics, Seed Junky (via PCN/shop
  listings), Symbiotic Genetics, Oni Seed Co., In House Genetics,
  Exotic/Mamiko, Capulator references, Fast Buds, Royal Queen Seeds,
  Humboldt Seed Organisation, Resin Seeds, Medical Marijuana Genetics,
  Silent Seeds (Dinafem successor), 303 Seeds, Crockett Family Farms,
  Connected Cannabis, ThugPug Genetics.
- Strain databases / informational: Leafly, SeedFinder, PhenoDB,
  Seedfinder.com, Prime Cuts Nursery, Cannigma, Seedsman blog, Azarius,
  Cannaconnection, StrainCompass, HashBible.
- ~140 distinct source pages consulted.

## Legacy reconciliation

88 legacy rows reviewed. Two were removed from the dataset (DB rows
untouched — nothing deleted server-side):

- `Royal Gorilla` → folded into `Gorilla Glue #4` (the RQS seed version of
  the same Chem's Sister x Sour Dubb x Chocolate Diesel cultivar; keeping
  both would be a semantic duplicate).
- `Royal AK` → rejected (Royal Queen Seeds rebadge of AK-47; no distinct
  cultivar identity or additional data value).

`Mac 1` was renamed to `MAC 1` (Capulator's canonical spelling) with
corrected genetics: the legacy `Alien Cookies x Colombian x Starfighter`
conflated the Miracle 15 male with direct parents. Corrected to
`Alien Cookies F2 x Miracle 15` per Capulator-documented lineage.

All `"Various"` breeder values were replaced with researched breeder
attribution (Fast Buds autos, Royal Queen Seeds autos).

## Unresolved source conflicts (preserved, not averaged)

- **Granddaddy Purple** — commonly Purple Urkle x Big Bud (Ken Estes); some
  sources cite Mendo Purps x Skunk x Afghanistan. Catalog keeps the
  commonly cited lineage; conflict noted in description.
- **Girl Scout Cookies** — OG Kush x Durban Poison is the widely reported
  cross but Cookie Fam has publicly disputed/obscured the exact lineage.
- **Wedding Cake** — Seed Junky/Archive documents Triangle Kush x
  Animal Mints (Triangle Mints #23). A different Cherry Pie x GSC cultivar
  circulates under the same name; noted in description.
- **Ice Cream Cake** — Seed Junky: Wedding Cake x Gelato #33. A separate
  Mad Scientist Genetics Ice Cream Cake has different parents.
- **Zkittlez** — Grape Ape x Grapefruit is the documented parent pair; a
  third undisclosed component is referenced by sources.
- **MAC 1** — Alien Cookies F2 x Miracle 15 documented; SeedFinder flags
  possible backcross ambiguity.
- **GMO Cookies** — Chem D x GSC Forum Cut; credit attribution varies
  between Mamiko/Skunkmasterflex circles.
- **Forbidden Fruit** — Chameleon Extracts Cherry Pie x Tangie; original
  is clone-only, seed offerings are reproductions.
- **Strawberry Cough** — Strawberry Fields x Haze is the commonly cited
  pair; true origin undocumented (Kyle Kushman popularized).
- **Sour Diesel** — multiple Chemdawg-line parent stories circulate.
  Catalog uses the most commonly cited Chemdawg x Northern Lights.
- **OG Kush** — Chemdawg x (Lemon Thai x Hindu Kush) is the most cited
  lineage; Florida-based origin stories differ.
- **Pineapple Express** — Trainwreck x Hawaiian (G13 Labs version) is the
  documented commercial line; film-era naming muddied identity.
- **Amnesia Haze** — two distinct cultivars share the name: the
  Hy-Pro/Zwiep Amsterdam clone (undisclosed genetics, catalog entry) and
  Soma Seeds' Amnesia Haze (South Asian x Jamaican x Afghani — different
  plant). Genetics intentionally null.
- **Cannatonic** — breeder-corrected genetics are Reina Madre x NYCD
  (Resin Seeds' own disclosure); MK Ultra x G13 Haze is the older,
  still-widely-cited cross.
- **Holland's Hope** — Dutch Passion documents it as their outdoor line;
  White Label (Sensi) also distributes the cultivar.
- **Critical Mass** — Mr. Nice explicitly documents it as the reworked
  Big Bud line (Afghani x Skunk #1).
- **Green Crack** — HSO's commercial version is 1989 SSSC Skunk #1 x
  Afghani; the Cecil B. clone line has a different reported history.
- **Chemdawg 91** — parentage genuinely unknown; genetics null.
- **Super Lemon Haze / Super Silver Haze** — Green House lab-reports
  ~26% THC while dispensary/lab data commonly sits 15-24%; catalog stores
  the broader documented range.

## Per-strain ledger

Each entry lists: sources → supported facts → conflicts → intentional nulls.

### Northern Lights
Sources: Sensi Seeds product page, PhenoDB, Dutch Passion cross-references.
Supported: Afghani x Thai, ~45-55d flowering (→7wk), THC ~16-21%,
easy/forgiving grow, indica-dominant.
Conflicts: none material. Nulls: none.

### White Widow
Sources: Green House Seeds, PhenoDB, Leafly.
Supported: Brazilian sativa x South Indian indica, ~8-9wk, GHS lab ~21% THC.
Conflicts: White Label/Sensi heritage claims differ on the White Widow name
origin; genetics consistent across sources.
Nulls: thcMin (GHS publishes a single lab figure).

### Jack Herer
Sources: Sensi Seeds, PhenoDB, Leafly.
Supported: Haze x NL5 x Shiva Skunk, 9-10wk, sativa-leaning, spicy pine.
Conflicts: none material. Nulls: thcMin.

### Durban Poison
Sources: Dutch Passion product page, Leafly, PhenoDB.
Supported: South African landrace sativa, 8-9wk, hardy, ~14-16% breeder THC
(higher modern figures documented up to 20%).
Conflicts: commercial versions vary in landrace purity. Nulls: thcMin.

### OG Kush
Sources: Leafly, PCN, Seedsman blog, documented breeder histories.
Supported: Chemdawg x (Lemon Thai x Hindu Kush) most cited; indica-leaning
structure despite sativa-heavy genetics; ~9wk.
Conflicts: multiple Florida vs California origin stories; breeder of record
does not exist (clone-era cultivar) → breeder null.

### Sour Diesel
Sources: Leafly, PCN, Seedsman blog, multiple breeder pages.
Supported: Chemdawg-derived, ~10wk, energetic, fuel aroma.
Conflicts: at least three parentage stories; documented Chemdawg x
Northern Lights used, alternates preserved here.
Nulls: breeder (no breeder of record).

### Chemdawg 91
Sources: Leafly, PCN, community documentation.
Supported: parent of OG Kush/Sour Diesel; ~9-10wk; high THC.
Conflicts: true parentage unknown → genetics null, breeder null.

### Blue Dream
Sources: Leafly, PCN, grower databases.
Supported: Blueberry x Haze, ~9-10wk, easy/high-yielding.
Conflicts: Santa Cruz clone origin — breeder of record undocumented → null.

### AK-47
Sources: Serious Seeds, PhenoDB, Leafly.
Supported: Colombian x Mexican x Thai x Afghani, ~8-9wk, high award count.
Conflicts: none material.

### Skunk #1
Sources: Sensi Seeds, Sacred Seeds history, PhenoDB.
Supported: Afghani x Acapulco Gold x Colombian Gold, ~7-8wk, ~15-19% THC.
Conflicts: breeder credit split between Sacred Seeds (origin) and Sensi
(maintenance) → Sensi as current canonical breeder.

### Original Haze
Sources: Seedsman blog, Seedfinder, community documentation.
Supported: four-way landrace sativa, 12-16wk flowering.
Conflicts: exact parent landraces vary by retelling; genetics recorded as
the most commonly cited four-way. Nulls: breeder, THC.

### Hindu Kush
Sources: Sensi Seeds, PhenoDB.
Supported: Hindu Kush landrace indica, ~7wk. Nulls: none material.

### Afghani #1
Sources: Sensi Seeds, PhenoDB.
Supported: Afghani landrace selection, ~7wk. Nulls: thcMin.

### Acapulco Gold
Sources: Leafly, Seedsman blog, historical references.
Supported: Mexican landrace, slow flowering, energetic.
Conflicts: modern seed versions are reproductions — no breeder of record.
Nulls: breeder, THC (no published figure), difficulty documented HARD.

### Maui Wowie
Sources: Leafly, Seedsman blog.
Supported: Hawaiian landrace, ~9-10wk. Nulls: breeder, THC.

### Lamb's Bread
Sources: Leafly, community documentation.
Supported: Jamaican landrace, uplifting spiritual sativa.
Nulls: breeder, THC.

### Colombian Gold
Sources: Seedsman blog, Leafly.
Supported: Santa Marta landrace, very long flower, Skunk #1 parent.
Nulls: breeder, THC.

### G13
Sources: multiple documentation sources.
Supported: dense resinous indica.
Conflicts: origin story is an urban legend; genetics and breeder null.

### Bubble Gum
Sources: T.H.Seeds, Serious Seeds, Seedfinder.
Supported: Indiana clone line, ~8-9wk, sweet.
Conflicts: both THSeeds and Serious hold versions; THSeeds listed as the
documented seed-bank distributor.

### Chronic
Sources: Serious Seeds, PhenoDB.
Supported: NL x Skunk x AK-47, ~8-9wk, high yield. Nulls: thcMin.

### Hash Plant
Sources: Sensi Seeds, Mr. Nice references, PhenoDB.
Supported: NL x Hash Plant, ~6-8wk → 7. Nulls: thcMin.

### Black Domina
Sources: Sensi Seeds, PhenoDB.
Supported: four-way indica, ~7-8wk → 8. Nulls: thcMin.

### Shiva Skunk
Sources: Sensi Seeds, PhenoDB.
Supported: NL5 x Skunk #1, ~8wk. Nulls: thcMin.

### Super Skunk
Sources: Sensi Seeds, PhenoDB.
Supported: Skunk #1 x Afghani, ~7-8wk → 8. Nulls: thcMin.

### Neville's Haze
Sources: Green House Seeds, Mr. Nice references, PhenoDB.
Supported: NL5 x Haze, 14-16wk → 14, very potent haze.
Nulls: thcMin.

### Kali Mist
Sources: Serious Seeds, PhenoDB.
Supported: mostly-sativa, ~10-12wk → 12.
Conflicts: breeder has never disclosed parentage → genetics null.
Nulls: thcMin.

### Cinderella 99
Sources: Brothers Grimm references, Seedfinder, Leafly.
Supported: Jack Herer x Shiva Skunk, fast sativa ~7-8wk → 8.

### Romulan
Sources: Federation Seeds references, Leafly, PCN.
Supported: North American indica x White Rhino, ~8wk, sedating.
Nulls: breeder (clone-era, undocumented).

### God Bud
Sources: BC Bud Depot, Leafly.
Supported: Hawaiian x Purple Skunk, ~8-9wk → 9.

### Moby Dick
Sources: Dinafem/Silent Seeds, PhenoDB, Leafly.
Supported: White Widow x Haze, ~9-10wk → 10, very high yield.
Nulls: thcMin (Dinafem lists "high", documented range used).

### Critical+ 2.0
Sources: Dinafem, Silent Seeds.
Supported: Critical+ backcross, ~6-7wk → 7, improved yield. Nulls: thcMin.

### LSD
Sources: Barney's Farm, PhenoDB.
Supported: Mazar x Skunk #1, ~8-9wk → 8, breeder ~24% THC → 20-24.

### Pineapple Chunk
Sources: Barney's Farm, PhenoDB.
Supported: Pineapple x Skunk #1 x Cheese, ~8-9wk → 9, ~18-23%.

### Blue Cheese
Sources: Big Buddha Seeds, Leafly.
Supported: Blueberry x UK Cheese, ~8-9wk → 9. Nulls: thcMin.

### Aurora Indica
Sources: Nirvana Seeds, PhenoDB.
Supported: NL x Afghani, ~7-9wk → 9. Nulls: thcMin.

### White Russian
Sources: Serious Seeds, PhenoDB.
Supported: AK-47 x White Widow, ~9wk, breeder lab-tested high THC.
Conflicts: some sources list AK-47 x Silver Widow — Serious' own page
confirms AK-47 x White Widow → documented version used.

### Orange Bud
Sources: Dutch Passion, PhenoDB.
Supported: Skunk selections, ~7-8wk → 8, citrus-sweet. Nulls: thcMin.

### Power Plant
Sources: Dutch Passion, PhenoDB.
Supported: South African-derived, ~8wk, high yield.

### Strawberry Banana
Sources: DNA Genetics, PhenoDB.
Supported: Banana Kush x Bubble Gum, ~9wk, very high resin.

### Pineapple Express
Sources: G13 Labs product page, Leafly, Seedsman.
Supported: Big Bud x Hawaiian Skunk (G13 Labs' own published genetics
for their seed line), 50-55d → 8.
Conflicts: film-era name; the Trainwreck x Hawaiian lineage belongs to
the clone-only original, not G13's seed version — breeder product page
wins for the attributed breeder.
Nulls: thcMin.

### Clementine
Sources: Crockett Family Farms references, Leafly.
Supported: Tangie x Lemon Skunk, ~8-9wk → 9.

### Death Star
Sources: Leafly, PCN, community documentation.
Supported: Sensi Star x Sour Diesel, Ohio clone-only.
Nulls: breeder documented as Team Death Star circle — not a commercial
breeder, recorded null.

### Tangie
Sources: DNA Genetics, PhenoDB, Leafly.
Supported: California Orange x Skunk #1, ~9-10wk → 10.

### Sunset Sherbet
Sources: Sherbinski/Cookies references, Leafly, PCN.
Supported: GSC x Pink Panties, ~8-9wk → 9.

### Lemon Skunk
Sources: Green House references, Leafly, Seedfinder.
Supported: Skunk #1 citrus selection, ~8wk, easy.
Conflicts: multiple breeders distribute the line — no canonical breeder
of record → null.

### Girl Scout Cookies
Sources: Cookies references, Leafly, Seedfinder.
Supported: ~9-10wk → 10, potent indica-leaning hybrid.
Conflicts: OG Kush x Durban Poison is widely reported but Cookie Fam has
disputed the exact lineage — most cited cross used, conflict noted.

### Gelato
Sources: Sherbinski/Cookies references, Leafly, PCN.
Supported: Sunset Sherbet x Thin Mint GSC, ~8-9wk → 9.

### Wedding Cake
Sources: Seed Junky references, PCN, Archive references.
Supported: Triangle Kush x Animal Mints, ~8-9wk → 9, 22-27% documented.
Conflicts: Cherry Pie x GSC line uses the same name — noted.

### Runtz
Sources: Cookies/Runtz references, Leafly, PCN.
Supported: Zkittlez x Gelato, ~8-9wk → 9, documented up to ~29%.

### Zkittlez
Sources: 3rd Gen Family references, Leafly, Seedfinder.
Supported: Grape Ape x Grapefruit, ~7-8wk → 8.
Conflicts: undisclosed third parent referenced — noted.

### Do-Si-Dos
Sources: Archive/NorCal IC Mag references, Leafly, PCN.
Supported: OGKB x Face Off OG, ~8-9wk → 9.

### GMO Cookies
Sources: Mamiko/Skunkmasterflex references, Leafly, PCN.
Supported: Chem D x GSC, ~9-10wk → 10, very high resin.
Conflicts: breeder attribution varies — Mamiko Seeds used as the most
commonly documented breeder.

### Mimosa
Sources: Symbiotic Genetics, Leafly, Seedsman.
Supported: Clementine x Purple Punch, ~9wk.

### Purple Punch
Sources: Supernova Gardens references, Leafly, PCN.
Supported: Larry OG x GDP, ~7-8wk → 8, ~18-20%.

### Ice Cream Cake
Sources: Seed Junky references, PCN, Leafly.
Supported: Wedding Cake x Gelato #33, ~8-9wk → 9.
Conflicts: Mad Scientist Genetics version differs — noted.

### Slurricane
Sources: In House Genetics, Leafly, PCN.
Supported: Do-Si-Dos x Purple Punch, ~9wk.

### Apple Fritter
Sources: Lumpy's Flowers references, Leafly, PCN.
Supported: Sour Apple x Animal Cookies, ~8-9wk → 9, very high THC claims
(20-30% documented range).

### Cereal Milk
Sources: Cookies/Powerzzzup references, Leafly, PCN.
Supported: The Y x Snowman, ~9-10wk → 10.

### Gary Payton
Sources: Cookies/Powerzzzup references, Leafly, PCN.
Supported: The Y x Snowman, ~8-9wk → 9, ~20-25%.
Conflicts: some databases list derivative crosses — Cookies-documented
pair used.

### Tropicana Cookies
Sources: Oni Seed Co., Leafly, PCN.
Supported: GSC x Tangie, ~9-10wk → 10, purple coloration, orange terps.

### MAC 1
Sources: Capulator references, Leafly, Seedfinder.
Supported: Alien Cookies F2 x Miracle 15, ~9-10wk → 10.
Conflicts: SeedFinder flags backcross ambiguity — noted.

### Granddaddy Purple
Sources: PCN, PhenoDB, seed-bank references.
Supported: ~8-9wk → 9, ~17-23%, purple.
Conflicts: Purple Urkle x Big Bud vs Mendo Purps-line ancestry —
noted in description.

### Bruce Banner
Sources: Delta 9 Labs / Dark Horse references, PhenoDB, Leafly.
Supported: OG Kush x Strawberry Diesel, ~9-10wk → 10.

### Strawberry Cough
Sources: Dutch Passion, Cannaconnection, Leafly.
Supported: sativa, ~9wk, smooth strawberry. Nulls: breeder (Kyle Kushman
popularized but is not a breeder entity).

### Amnesia Haze
Sources: Soma Seeds, PhenoDB, Amsterdam Seed Center, Azarius.
Supported: ~10-12wk → 11, energetic.
Conflicts: two cultivars share the name — Soma's (documented different
genetics) vs the Hy-Pro clone (undisclosed). Genetics null.

### White Rhino
Sources: Green House Seeds, PhenoDB, Leafly.
Supported: Afghan x Brazilian x South Indian, ~8-9wk → 9.

### Critical Mass
Sources: Mr. Nice official, Seedfinder.
Supported: Afghani x Skunk #1, ~6-7wk → 7, huge mold-prone yields.

### Forbidden Fruit
Sources: Cannabis Now, PCN, Seedfinder, Cannigma.
Supported: Cherry Pie x Tangie, Chameleon Extracts, ~8-10wk → 10.
Conflicts: clone-only original; seed versions are reproductions — noted.

### Jet Fuel
Sources: 303 Seeds, PhenoDB, Leafly.
Supported: Aspen OG x High Country Diesel, ~9-10wk → 10.

### Super Lemon Haze
Sources: Green House Seeds, PhenoDB, Leafly, Azarius.
Supported: Lemon Skunk x SSH, ~10wk.
Conflicts: breeder lab 26% vs common 15-24%. Catalog stores 19-26 —
the breeder ceiling with a mid-range floor, not the full 15-26 union.

### Super Silver Haze
Sources: Green House Seeds, PhenoDB, Leafly.
Supported: Skunk x NL x Haze, ~10-11wk → 11, HARD difficulty.
Conflicts: same breeder-lab vs typical range pattern as SLH — breeder
lab reports exceed commonly reported ~15-24%. Catalog stores 18-24 —
the commonly reported range, not the breeder-lab ceiling.

### Chocolope
Sources: DNA Genetics, PhenoDB.
Supported: OG Chocolate Thai x Cannalope Haze, ~8-9wk → 9, easy.

### Green Crack
Sources: Humboldt Seed Organisation, PhenoDB, Seedfinder.
Supported: 1989 SSSC Skunk #1 x Afghani (HSO version), ~8-9wk → 9, easy.
Conflicts: Cecil B. clone history differs — noted.

### LA Confidential
Sources: DNA Genetics, PCN, PhenoDB.
Supported: OG LA Affie x Afghani, ~7-8wk → 8, easy, ~19-25%.

### Cheese
Sources: Big Buddha Seeds, Seedfinder, Leafly.
Supported: UK Cheese x Afghani seed version, ~63d → 9wk.
Nulls: none.

### Big Bud
Sources: Sensi Seeds, PhenoDB.
Supported: Afghani x Skunk #1 x NL, ~50-65d → 9wk, ~15-20% (Sensi grow
report tested 25.3% — higher test noted as phenotype/outlier).

### Mazar
Sources: Dutch Passion, PhenoDB.
Supported: Afghan x Skunk #1, ~8-9wk → 9, ~19-20% breeder, easy.

### Blueberry
Sources: DJ Short references, Dutch Passion, PhenoDB.
Supported: Purple Thai x Afghani x Highland Thai line, ~8-9wk → 9.

### Critical Kush
Sources: Barney's Farm, PhenoDB.
Supported: Critical Mass x OG Kush, ~55-60d → 8wk, breeder 22-26%.

### Liberty Haze
Sources: Barney's Farm, PhenoDB.
Supported: G13 x Chemdawg 91, ~60-65d → 9wk.
Conflicts: breeder claims 25-28%; documented 22-26% range stored.

### Gorilla Glue #4
Sources: GG Genetics documentation, Royal Queen Seeds blog, PCN.
Supported: Chem's Sister x Sour Dubb x Chocolate Diesel, ~8-9wk → 9,
~20-26% typical (30% claimed max).

### Maple Leaf Indica
Sources: Sensi Seeds, Seedfinder, PhenoDB.
Supported: Mazar-region Afghani, ~45-50d → 7wk, easy.

### Lavender
Sources: Soma Seeds, PhenoDB, Seedfinder.
Supported: Super Skunk x Big Skunk Korean x Afghani x Hawaiian, ~8-10wk → 10.
Conflicts: THC varies 19-23% across tests — range stored.

### Sage N Sour
Sources: T.H.Seeds, Leafly, Herbies.
Supported: Sour Diesel x S.A.G.E., ~9wk. Nulls: thcMin.

### Great White Shark
Sources: Green House Seeds, PhenoDB.
Supported: Super Skunk x Brazilian x South Indian, ~9wk, breeder ~23%.
Nulls: thcMin.

### Holland's Hope
Sources: Dutch Passion, White Label references.
Supported: Afghan x Skunk, ~7-8wk → 8, ~15%, easy, mold-resistant.
Conflicts: Dutch Passion vs White Label distribution — Dutch Passion used
as documented developer.

### Motavation
Sources: Serious Seeds, PhenoDB.
Supported: Sensi Star x Warlock, ~8-9wk → 9.

### Bubblelicious
Sources: Nirvana Seeds, PhenoDB, Seed City.
Supported: Big Bud x Skunk #1, ~9-10wk → 10, breeder 13-18%.

### Arjan's Strawberry Haze
Sources: Green House Seeds, Amsterdam Seed Center.
Supported: Swiss Sativa x NL5 Haze Mist, ~10-11wk → 11, ~19.7% breeder.
Nulls: thcMin.

### Arjan's Haze #1
Sources: Green House Seeds product page ("Arjan's Ultra Haze 1").
Supported: Neville's Haze x Cambodian x Laos (breeder-published genetics
card on the Ultra Haze 1 product page — corrects the earlier G13 x Haze
attribution), ~11wk, ~21% breeder. Nulls: thcMin.

### The Church
Sources: Green House Seeds, Azarius, PhenoDB.
Supported: Swiss Sativa x Super Skunk x NL, ~8wk, ~20%, mold-resistant.

### Mandarin Cookies
Sources: Ethos Genetics, PhenoDB.
Supported: Forum Cut Cookies x Mandarin Sunset, ~8-9wk → 9, easy.
Conflicts: V1/V2/R1 versions differ slightly — documented 20-28%.

### Planet of the Grapes
Sources: Ethos Genetics, PhenoDB, Seedsman.
Supported: Grape Diamonds x (Chem D x i95), ~60-63d → 9, easy.

### Jealousy
Sources: Seed Junky references, PCN, Leafly, Barney's reproduction page.
Supported: Sherbert Bx1 x Gelato 41, ~8-9wk → 9.
Conflicts: breeder claims ~28%; lab samples 17-23%. Catalog stores
20-28 — the breeder ceiling with a floor at the upper end of documented
lab results, not the full 17-28 union.

### Kush Mints
Sources: Seed Junky references, PhenoDB, PCN.
Supported: Bubba Kush x Animal Mints, ~8-10wk → 9, THC 25-28% per
Seed Junky-documented figures (PhenoDB/PCN listings corroborate the
upper-20s range).

### Peanut Butter Breath
Sources: ThugPug references, PhenoDB, PCN.
Supported: Do-Si-Dos x Mendo Breath F2, ~60-70d → 9.

### Trainwreck
Sources: Humboldt Seed Organisation, Leafly, HENDRX.
Supported: Mexican x Thai x Afghani, ~8-9wk → 9.
Conflicts: HSO breeder lists 13-15% THC; documented field/lab reports are
17-25%. Catalog stores 15-22 — the overlapping mid-range between the
breeder figure and field reports, not the full 13-25 union.
Breeder null (heirloom clone).

### Bubba Kush
Sources: Seedsman blog, PCN, Leafly, Katsu Seeds documentation.
Supported: Northern Lights pheno x OG Kush accidental cross, ~8-9wk → 9.
Nulls: breeder (Matt Berger is an individual clone-holder, not a breeder
entity; documented null).

### Biscotti
Sources: Connected Cannabis product page, GreenState, PCN.
Supported: South Florida OG x Gelato #25, ~8-9wk → 9, ~17-25%.

### Cherry Pie
Sources: Weedmaps, PCN, Leafly.
Supported: GDP x F1 Durban Poison, ~8-9wk → 9, ~16-24%.
Nulls: breeder (Powerzzzup/Cookie Fam clone, no breeder entity).

### Cannatonic
Sources: Resin Seeds, Seedfinder, Leafly, 1000Seeds.
Supported: ~9-10wk → 10, ~1:1 CBD:THC in most phenos.
Conflicts: breeder-corrected genetics Reina Madre x NYCD vs older
MK Ultra x G13 Haze — breeder's own correction used.

### ACDC
Sources: Cannigma, Leafly, Seedfinder, Leafbuyer.
Supported: Cannatonic phenotype, ~20:1 CBD:THC, ~9-10wk → 9, THC <5%.
Nulls: breeder (phenotype selected by Dr. Courtney; clone-line cultivar).

### Harlequin
Sources: Cannigma, Seedfinder, HashBible, Leafly.
Supported: Colombian Gold x Thai x Swiss x Nepalese, ~9-10wk → 9,
~5-10% THC / ~8-15% CBD.
Conflicts: "found" rather than engineered cultivar; House of David
documented as originating breeder circle.

### Candida CD-1
Sources: Medical Marijuana Genetics, Seedsman, Seed City.
Supported: ACDC x Harlequin, ~9wk, 10-20% CBD / <1% THC, vigorous.

### Charlotte's Web
Sources: Wikipedia, Leafly, USPTO patent documentation, CW Holdings.
Supported: proprietary hemp cultivar CW1AS1, <0.3% THC (stored as
thcMax 0.3 — the documented hemp ceiling), ~6% CBD.
Nulls: floweringWeeks, difficulty (no published photoperiod flowering data
for the proprietary line; breeding is proprietary).

### Northern Light Automatic
Sources: Royal Queen Seeds.
Supported: NL x Ruderalis, ~10-12wk seed to harvest, ~14% THC.
Nulls: floweringWeeks (auto — days-from-seed only).

### Amnesia Haze Auto
Sources: Royal Queen Seeds.
Supported: Amnesia x Ruderalis, ~11-12wk seed to harvest, ~18%.
Nulls: floweringWeeks.

### Sour Diesel Auto
Sources: Fast Buds.
Supported: Sour Diesel Cut x FB Auto #1, ~9-10wk from seed, ~21%.
Nulls: floweringWeeks.

### Blue Dream Auto
Sources: Fast Buds, PhenoDB.
Supported: Blue Dream line x Ruderalis, ~9-11wk from seed, ~22%.
Nulls: floweringWeeks.

### Pineapple Express Auto
Sources: Fast Buds, PhenoDB, Azarius.
Supported: Skunk x Hawaii x Trainwreck x Ruderalis, ~9-10wk from seed, ~20%.
Nulls: floweringWeeks.

### Bruce Banner Auto
Sources: Fast Buds.
Supported: Bruce Banner BX 2.0 x Strawberry Pie Auto, ~10-11wk, ~25%.
Nulls: floweringWeeks.

### Gelato Auto
Sources: Fast Buds.
Supported: Gelato x Cookies Auto, ~9wk, ~26%. Nulls: floweringWeeks.

### Gorilla Cookies Auto
Sources: Fast Buds.
Supported: GG4 Auto x Cookies Auto, ~10wk, ~28%. Nulls: floweringWeeks.

### Zkittlez Auto
Sources: Fast Buds.
Supported: Zkittlez x Ruderalis, ~9-10wk, ~23%. Nulls: floweringWeeks.

## Breeder-page enrichment pass (2026-09)

Schema added `seedToHarvestWeeks` (AUTO_FLOWER full-cycle estimate),
`breederImageUrl` + `breederSourceUrl` (linked breeder product photo with
source attribution — never re-hosted). `RUDERALIS` was removed from the
active type vocabulary; `AUTO_FLOWER` covers that segment and legacy rows
still render their label.

All 9 autoflowers carry breeder-published seed-to-harvest windows
(7 Fast Buds, 2 Royal Queen Seeds). 50 strains carry verified breeder
product images + source URLs across 12 breeder webshops: Fast Buds
(2fast4buds.com), Royal Queen Seeds, Sensi Seeds, Dutch Passion, Serious
Seeds, Green House Seeds, Barney's Farm, DNA Genetics, Nirvana (Shopify
CDN), Dinafem, Brothers Grimm, G13 Labs. Every image URL was verified
with a live fetch returning 200 + an image content-type without a
Referer, so the linked photo loads with attribution.

Flowering corrections applied where the breeder's own product page
publishes a different figure than the catalog stored: White Widow 9→8
(GHS "8 weeks"), Durban Poison 9→8, Orange Bud 8→9 (DP "7-9 weeks"),
Mazar 9→8, Holland's Hope 8→9 (DP "7-9 weeks"), LSD 8→9 (Barney's
"60-65 days"), Critical Kush 8→9 (Barney's "55-60 days"), Aurora Indica
9→11 (Nirvana "9-11 weeks"), Pineapple Express 9→8 (G13 "50-55 days").

Genetics corrections from breeder-published lineage: Pineapple Express
(G13) Trainwreck x Hawaiian → Big Bud x Hawaiian Skunk; Arjan's Haze #1
(GHS Ultra Haze 1) G13 x Haze → Neville's Haze x Cambodian x Laos;
Blue Dream Auto → Blue Dream cut x Blueberry Auto F4; Bruce Banner Auto
→ Bruce Banner BX 2.0 x Strawberry Pie Auto F5; Gelato Auto → Gelato
California Cut x Cookies Auto (all Fast Buds genetic-tree pages).

Cross-verification: 67 strains checked against Seedfinder per-breeder
lineage trees — catalog genetics matched the direct parents in every
case (the trees add deeper grandparents, which the catalog's direct-cross
format intentionally omits).

Intentional nulls: boutique US breeders with no public seed webshop
(Cookies, Seed Junky, Sherbinski, Capulator, Lumpy's, Oni, Mamiko,
Symbiotic, Supernova, In House, 3rd Gen Family, NorCal IC Mag, Crockett,
Ken Estes, Dark Horse, Chameleon, 303, Connected, House of David,
Stanley Brothers, ThugPug, Ethos — retailer-only), breeders with dead
sites (Big Buddha 503, BC Bud Depot, T.H.Seeds product gone), and
breeder-less clone-era cultivars keep `breederImageUrl`/`breederSourceUrl`
null — attribution is only stored when a live breeder product page was
verified.

## Pass 2 — Fast Buds full-catalog expansion (September 2026, cont.)

Source: 2fast4buds.com catalog crawl — every `/seeds/` product page.

- 72 individual Fast Buds cultivars extracted from the catalog page
  (89 product paths discovered; mix packs and trial packs excluded
  because they are bundles, not single cultivars).
- 67 new catalog entries added; 5 existing Fast Buds entries
  (Gorilla Cookies, Gelato, Blue Dream, Sour Diesel, Pineapple
  Express Auto) enriched in place.
- One name collision handled: Fast Buds' "Amnesia Haze Auto" page
  (slug `original-auto-amnesia-haze`) is stored as
  "Original Auto Amnesia Haze" — the RQS "Amnesia Haze Automatic"
  already holds the plain name.

Per-strain fields taken from the breeder's own parameter table
(`th.param-icon` rows): Genetics (genetic tree as published), Flowering
(= total seed-to-harvest cycle for autos -> `seedToHarvestWeeks`),
THC ("Up to X%" -> `thcMax`), Taste tags -> `flavors` (controlled
vocab), and the gauged Effects section (bars >= 30% intensity ->
`effects`). `og:image` -> `breederImageUrl`; product URL ->
`breederSourceUrl`. All 72 image URLs verified live (200 + image/*).

Known gaps per policy: 8 newer products (RF3 line, Sundae Frost,
Mango Cherry Runtz, Banana Cherry Cookies, Frostbanger) publish no
Effects section -> `effects` left empty. `difficulty` is null — Fast
Buds does not publish a difficulty rating. `floweringWeeks` stays
null on every autoflower — the published cycle is seed-to-harvest.

## Pass 3 — Multi-breeder full-catalog expansion

Method: per-site crawlers fetch each breeder's public seed catalog and
extract product-page facts. 639 product records collected; 563 new
entries added after excluding bundles, mix packs, category pages, and
merch. Catalog is now 744 strains across 12+ breeders.

Per-site extraction:
- Fast Buds photoperiods (+11): same param-icon table; "Feminized"/
  "F1 hybrid" seed types; floweringWeeks from breeder Flowering param.
- Dutch Passion (+36): product-featureitem spec rows (Flowertime,
  Effect). Genetics not published as a spec field — prose extraction
  only when a clean "A x B" cross appears; else null.
- Barney's Farm (+83): JSON-LD PropertyValue specs (Genetics, THC %,
  Sativa/Indica %, Taste, Effect, Flowering Time days->weeks).
  Merchandise pages sharing the slug pattern excluded via spec check.
- Royal Queen Seeds (+155): full data sheet (th/td pairs) — Genetic
  Background, Type %, THC, Flowering time, Effect, Flavour. Most
  complete source after Fast Buds.
- Nirvana (+86): Shopify product JSON (.js endpoint); genetics/timing
  from description prose where present.
- Dinafem (+28): spec table via cell parsing — Cross, Indoor
  flowering, THC, Morphology.
- Sensi Seeds (+32): product-attribute-name/value pairs; flowering is
  qualitative ("Short flowering period") so timing stays null.
- Green House Seeds (+32): slug-derived names (h1 catches spec labels);
  genetics from grid-list__genetics_mod; collection/family/bundle
  pages excluded by URL.
- DNA Genetics (+22): WooCommerce product prose for genetics/flowering.
- Serious Seeds (+22): prose genetics/flowering; product images stay
  null (site markup doesn't expose a per-strain product image).
- G13 Labs (+56): product images at /Content/images/Products/;
  genetics/timing from prose.

Rules applied:
- Same-breeder name match -> enrich existing row (fill nulls, refresh
  breeder image/source links); never duplicate.
- Cross-breeder name collision -> disambiguated "Name (Breeder)".
- Auto vs photoperiod: autos get seedToHarvestWeeks only; fem get
  floweringWeeks only. Day counts converted to weeks (>bound values
  treated as days). Out-of-range values -> null.
- Genetics strings containing nav/junk text -> null (never guess).
- CSP img-src += cdn.shopify.com (Nirvana product CDN); all other
  hosts were already enumerated.

## Pass 4 — Quality hardening: dedupe, image recovery, prune, genetics fill

Goal (user direction): catalog = reputable seed-bank products with photos,
accurate genetics, and descriptions only. Catalog now 658 strains.

Additions:
- Fast Buds "FastFlowering" photoperiod line (+6): GG4 Sherbet FF,
  Gorilla Cookies FF, Orange Sherbet FF, Purple Lemonade FF,
  Tropicana Cookies FF, Wedding Cheesecake FF — same param-icon spec
  table; genetics documented as "(photoperiod parent) x (auto parent)".
- Fast Buds /feminized-seeds coverage re-verified: 11 photoperiod
  products is the complete current catalog (the /us/ locale path lists
  the identical set).

Dedupe (same-breeder collisions created by pass-3 suffixing):
- 30 rows merged into their base row and deleted, e.g.
  "Durban Poison (Dutch Passion)" -> "Durban Poison" when both rows
  were the same breeder's same product. Cross-breeder suffixed rows
  (e.g. "White Widow (Royal Queen Seeds)" vs GHS "White Widow") kept —
  they are distinct products.
- Breeder alias normalized: "Nirvana Seeds" == "Nirvana".

Serious Seeds recovery:
- Pass-3 strict filename matching dropped real images. Re-extracted:
  all 22 Serious rows now carry the /sites/default/files/styles/306_535/
  public/strains/[NAME] [VRIJSTAAND].png product shot.
- Genetics from breeder prose: Seriotica (Serious Mimosa x Cookies),
  Seriosa (AK-47 x Serious Mimosa), CBD-Chronic (Chronic x Remedy),
  CBD-Warlock (Warlock x Cannatonic), Serious Happiness (Warlock x
  AK-47), Serious Kush (White Russian x OG Kush), Double Dutch (Warlock
  x pre-2000 Chronic), Fruity Durban (Durban Poison x Mimosa), autos
  documented as parent-cross x Ruderalis.

Image rescues:
- Green Crack -> Humboldt Seed Org product page; Cannatonic -> Resin
  Seeds shop page. CSP img-src += www.humboldtseeds.net, resinseeds.net.

Prune (REMOVED_STRAIN_NAMES, deleted where createdById is null):
- 62 rows removed: every entry with no verifiable breeder photo/source —
  breeder-less clone-era legends (OG Kush, Blue Dream, Sour Diesel, ...)
  and boutique breeders without public seed shops (Cookies, Seed Junky,
  Capulator, Sherbinski, etc.). Famous names survive through the
  seed-bank versions (e.g. "OG Kush (Barney's Farm)").
- 1 orphan row "Jack Herer&#xAE;" (entity-named RQS product, renamed to
  "Jack Herer (Royal Queen Seeds)") removed.

Genetics:
- Seedfinder lineage-tree pass over remaining null-genetics rows:
  114/155 resolved to documented parents (strain-info lineage <ul>).
  Pseudo-parent classifiers stripped ("x Indica", "x Mostly Sativa",
  "Africa - Sativa"); sentence fragments truncated. 41 rows remain null
  where no source reliably documents a cross.
- Prose-junk genetics cleared (16 rows: sentence fragments, boilerplate)
  via FORCE_NULL_GENETICS — the seed runner overwrites these names'
  genetics to null since null fields normally never erase.
- Seed runner now processes REMOVED_STRAIN_NAMES (deletes unowned
  catalog rows only) and FORCE_NULL_GENETICS (null-authoritative
  genetics overwrite).
