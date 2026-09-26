/* eslint-disable @typescript-eslint/no-require-imports */
// Seed the curated strain catalog — hardened Slice C runner.
//
//   node scripts/seed-strains.cjs           apply to DATABASE_URL (dev only)
//   node scripts/seed-strains.cjs --dry-run validate + report, zero writes
//
// Safety contract:
//   - db-guard refuses production endpoints (same as every DB script)
//   - identity match is case-insensitive on name (the DB unique is
//     case-sensitive; the app's own create path checks insensitively)
//   - rows with a createdById are community-owned — NEVER modified
//   - createdById-null rows are catalog-managed: seed fields update in
//     place, but a null seed field never erases existing data
//   - slugs are written once via the same entitySlug algorithm as the API
//   - all rows are created with createdById: null — no fake attribution,
//     no reputation events
const { PrismaClient } = require("@prisma/client");
const { STRAINS, REMOVED_STRAIN_NAMES = [], FORCE_NULL_GENETICS = [] } = require("./seed-strains-data.cjs");

// Mirrors of src/lib/strain-fields.ts — a seed script can't import TS, so
// the vocab is duplicated here and cross-checked against the real module
// in scripts/discovery-integration-tests.mts.
const STRAIN_TYPES = ["SATIVA", "INDICA", "HYBRID", "AUTO_FLOWER", "CBD", "OTHER"];
const STRAIN_EFFECTS = ["RELAXED", "HAPPY", "EUPHORIC", "UPLIFTED", "ENERGETIC", "CREATIVE", "FOCUSED", "GIGGLY", "TALKATIVE", "HUNGRY", "SLEEPY", "CALM"];
const STRAIN_FLAVORS = ["EARTHY", "SWEET", "CITRUS", "BERRY", "TROPICAL", "SOUR", "DIESEL", "PINE", "SKUNK", "SPICY", "HERBAL", "FLORAL", "WOODY", "CHEESE", "MINT", "NUTTY"];
const STRAIN_DIFFICULTIES = ["EASY", "NORMAL", "HARD"];
const THC_MIN = 0, THC_MAX = 45, FLOWER_MIN = 4, FLOWER_MAX = 20;
const SEED_HARVEST_MIN = 6, SEED_HARVEST_MAX = 24, URL_MAX = 500;
const NAME_MAX = 100, TEXT_MAX = 200, DESC_MAX = 2000;

// Same algorithm as src/lib/slugs.ts entitySlug() + affiliate.slugify().
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const entitySlug = (name, id) => `${slugify(name).replace(/^-+|-+$/g, "") || "strain"}-${id.slice(-6).toLowerCase()}`;

function validate(strains) {
  const errors = [];
  const seen = new Map(); // normalized name → display name (duplicate check)
  strains.forEach((s, i) => {
    const at = `row ${i} (${JSON.stringify(s.name)})`;
    const err = (m) => errors.push(`${at}: ${m}`);
    if (typeof s.name !== "string" || !s.name.trim() || s.name.trim().length > NAME_MAX) err("bad name");
    if (!STRAIN_TYPES.includes(s.type)) err(`bad type ${s.type}`);
    for (const e of s.effects ?? []) if (!STRAIN_EFFECTS.includes(e)) err(`bad effect ${e}`);
    for (const f of s.flavors ?? []) if (!STRAIN_FLAVORS.includes(f)) err(`bad flavor ${f}`);
    if (s.difficulty != null && !STRAIN_DIFFICULTIES.includes(s.difficulty)) err(`bad difficulty ${s.difficulty}`);
    for (const [k, v] of [["thcMin", s.thcMin], ["thcMax", s.thcMax]]) {
      if (v != null && (!Number.isFinite(v) || v < THC_MIN || v > THC_MAX)) err(`bad ${k} ${v}`);
    }
    if (s.thcMin != null && s.thcMax != null && s.thcMin > s.thcMax) err("thcMin > thcMax");
    if (s.floweringWeeks != null && (!Number.isInteger(s.floweringWeeks) || s.floweringWeeks < FLOWER_MIN || s.floweringWeeks > FLOWER_MAX)) err(`bad floweringWeeks ${s.floweringWeeks}`);
    if (s.seedToHarvestWeeks != null && (!Number.isInteger(s.seedToHarvestWeeks) || s.seedToHarvestWeeks < SEED_HARVEST_MIN || s.seedToHarvestWeeks > SEED_HARVEST_MAX)) err(`bad seedToHarvestWeeks ${s.seedToHarvestWeeks}`);
    for (const [k, v] of [["breederImageUrl", s.breederImageUrl], ["breederSourceUrl", s.breederSourceUrl]]) {
      if (v != null && (typeof v !== "string" || v.length > URL_MAX || !/^https:\/\//.test(v))) err(`bad ${k}`);
    }
    // An unattributed breeder image is worse than none — the source link is the attribution.
    if (s.breederImageUrl != null && s.breederSourceUrl == null) err("breederImageUrl without breederSourceUrl");
    for (const [k, v, max] of [["genetics", s.genetics, TEXT_MAX], ["breeder", s.breeder, TEXT_MAX], ["description", s.description, DESC_MAX], ["growingInfo", s.growingInfo, DESC_MAX]]) {
      if (v != null && (typeof v !== "string" || v.length > max)) err(`bad ${k}`);
    }
    const key = s.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) err(`duplicate of ${seen.get(key)}`);
    seen.set(key, s.name);
  });
  return errors;
}

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  const errors = validate(STRAINS);
  if (errors.length) {
    console.error(`Validation failed (${errors.length}):`);
    for (const e of errors.slice(0, 25)) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  await import("./db-guard.mjs"); // refuse production endpoints before any query
  const p = new PrismaClient();

  const report = { created: 0, updated: 0, skippedOwned: 0, unchanged: 0, errors: 0 };
  for (const s of STRAINS) {
    try {
      const existing = await p.strain.findFirst({
        where: { name: { equals: s.name.trim(), mode: "insensitive" } },
      });
      if (existing?.createdById) { report.skippedOwned++; continue; }

      const fields = {
        name: s.name.trim(),
        type: s.type,
        genetics: s.genetics ?? null,
        breeder: s.breeder ?? null,
        description: s.description ?? null,
        growingInfo: s.growingInfo ?? null,
        effects: s.effects ?? [],
        flavors: s.flavors ?? [],
        thcMin: s.thcMin ?? null,
        thcMax: s.thcMax ?? null,
        floweringWeeks: s.floweringWeeks ?? null,
        seedToHarvestWeeks: s.seedToHarvestWeeks ?? null,
        breederImageUrl: s.breederImageUrl ?? null,
        breederSourceUrl: s.breederSourceUrl ?? null,
        difficulty: s.difficulty ?? null,
      };

      if (!existing) {
        if (dryRun) { report.created++; continue; }
        const row = await p.strain.create({ data: { ...fields, createdById: null } });
        await p.strain.update({ where: { id: row.id }, data: { slug: entitySlug(row.name, row.id) } });
        report.created++;
        continue;
      }

      // Catalog-managed row — apply seed fields, but a null seed field never
      // erases data, and a missing slug gets written.
      const patch = {};
      for (const [k, v] of Object.entries(fields)) {
        // A null/absent/empty seed field never erases existing data.
        if (v == null || (Array.isArray(v) && v.length === 0)) continue;
        if (JSON.stringify(existing[k]) !== JSON.stringify(v)) patch[k] = v;
      }
      if (!existing.slug) patch.slug = entitySlug(existing.name, existing.id);
      if (Object.keys(patch).length === 0) { report.unchanged++; continue; }
      if (!dryRun) await p.strain.update({ where: { id: existing.id }, data: patch });
      report.updated++;
    } catch (e) {
      report.errors++;
      console.error(`  ✗ ${s.name}: ${e.message}`);
    }
  }

  // Retired catalog rows: delete by name ONLY when the row is catalog-owned
  // (createdById null). Member-created strains sharing a removed name survive.
  const forceNull = new Set(FORCE_NULL_GENETICS.map((n) => n.trim().toLowerCase()));
  report.removed = 0;
  report.geneticsCleared = 0;
  for (const name of REMOVED_STRAIN_NAMES) {
    try {
      const existing = await p.strain.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
      if (!existing) continue;
      if (existing.createdById) { report.skippedOwned++; continue; }
      if (!dryRun) await p.strain.delete({ where: { id: existing.id } });
      report.removed++;
    } catch (e) {
      report.errors++;
      console.error(`  ✗ remove ${name}: ${e.message}`);
    }
  }
  // Names where a null seed field is authoritative (earlier runs seeded prose
  // junk into genetics; file null must overwrite rather than preserve).
  for (const name of forceNull) {
    try {
      const existing = await p.strain.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
      if (!existing || existing.createdById || existing.genetics == null) continue;
      if (!dryRun) await p.strain.update({ where: { id: existing.id }, data: { genetics: null } });
      report.geneticsCleared++;
    } catch (e) {
      report.errors++;
      console.error(`  ✗ clear ${name}: ${e.message}`);
    }
  }

  const total = dryRun ? null : await p.strain.count();
  console.log(`${dryRun ? "[dry-run] " : ""}catalog=${STRAINS.length} created=${report.created} updated=${report.updated} unchanged=${report.unchanged} removed=${report.removed} geneticsCleared=${report.geneticsCleared} skippedOwned=${report.skippedOwned} errors=${report.errors}${total != null ? ` totalInDb=${total}` : ""}`);
  await p.$disconnect();
  if (report.errors) process.exit(1);
})();
