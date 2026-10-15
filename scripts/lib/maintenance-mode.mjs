// Shared maintenance-mode toggle for canonical test suites.
//
// `checkMaintenance()` reads Setting.maintenance_mode live, so a suite can
// exercise the freeze by writing the row — but a suite that crashes or fails
// mid-test must not leave the shared dev database frozen for later suites.
// This module provides both sides of that contract:
//
//   - enableMaintenanceForTest() — suite-side: snapshots the current value,
//     turns maintenance ON, and returns an idempotent restore() that puts the
//     original state back (deleting the row when it did not previously exist —
//     a missing row and a stored "false" are NOT interchangeable to
//     getBooleanSetting callers that distinguish null). Call restore() in a
//     finally block so both success and assertion-failure paths reset.
//
//   - restoreMaintenanceBaseline() — runner-side: the master runner snapshots
//     the value the first time it calls this, then restores that baseline
//     after every suite that opts in. A suite process that dies holding the
//     freeze cannot poison the next suite.
//
// Both throw on failure — callers must treat a failed restore as a failed
// suite precondition, never continue into a possibly frozen environment.
//
// Plain .mjs + own PrismaClient so both node-runner (.mjs) and tsx-runner
// (.mts) suites can import it; keyed by the literal setting name rather than
// SITE_SETTINGS so it stays dependency-free under plain node.

import "../db-guard.mjs"
import { PrismaClient } from "@prisma/client"

const KEY = "maintenance_mode"
const ON = "true"

// Module-level client: node-runner suites can't import "@/lib/prisma".
const prisma = new PrismaClient()

async function readValue() {
  const row = await prisma.setting.findUnique({ where: { key: KEY }, select: { value: true } })
  return row?.value ?? null
}

async function writeOriginal(original) {
  if (original === null) {
    await prisma.setting.deleteMany({ where: { key: KEY } })
  } else {
    await prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: original },
      update: { value: original },
    })
  }
}

/**
 * Turn maintenance ON for a test section. Returns an idempotent restore
 * function — call it in `finally`. Restores the exact prior state, including
 * deleting the row when it did not exist before.
 */
export async function enableMaintenanceForTest() {
  const original = await readValue()
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: ON },
    update: { value: ON },
  })
  let restored = false
  return async () => {
    if (restored) return
    restored = true
    await writeOriginal(original)
  }
}

// Runner-side baseline, captured lazily on first use inside the parent
// process. Cached so every suite boundary restores the same pre-run value.
let baseline

/**
 * Ensure maintenance_mode matches the value captured at first call. Returns
 * whether a restore write was needed. Throws on database failure.
 */
export async function restoreMaintenanceBaseline() {
  if (baseline === undefined) baseline = await readValue()
  const current = await readValue()
  if (current === baseline) return { restored: false }
  await writeOriginal(baseline)
  return { restored: true }
}
