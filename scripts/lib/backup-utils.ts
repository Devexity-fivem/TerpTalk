// backup-utils.mts — shared, testable helpers for progression backups.
// Pure filesystem/crypto — no DB access, safe to import from tests.
import { createHash } from "node:crypto"
import { createWriteStream, createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve, sep, basename } from "node:path"
import { createInterface } from "node:readline"

export interface BackupTableMeta {
  file: string
  rows: number
  sha256: string
}

export interface BackupManifest {
  exportedAt?: string
  database?: Record<string, string>
  snapshot?: string
  tables: Record<string, BackupTableMeta>
}

/**
 * Backpressure-safe JSONL writer. writeLine() resolves only after the
 * chunk is accepted by the stream — when the kernel buffer is full
 * (write() → false) it waits for 'drain', and rejects on stream error
 * or premature close. Memory stays bounded no matter the row size.
 */
export function createJsonlWriter(file: string) {
  const stream = createWriteStream(file, { encoding: "utf8" })
  const hash = createHash("sha256")
  let rows = 0
  let error: Error | null = null
  let closed = false

  stream.on("error", (e) => {
    error = e
  })

  async function writeLine(obj: unknown): Promise<void> {
    if (error) throw error
    if (closed) throw new Error("jsonl writer already closed")
    const line = JSON.stringify(obj)
    hash.update(line)
    hash.update("\n")
    rows++
    if (!stream.write(line + "\n")) {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const cleanup = () => {
          stream.off("drain", onDrain)
          stream.off("error", onError)
          stream.off("close", onClose)
        }
        const onDrain = () => { cleanup(); resolvePromise() }
        const onError = () => { cleanup(); rejectPromise(error ?? new Error("stream error")) }
        const onClose = () => { cleanup(); rejectPromise(new Error("stream closed before drain")) }
        stream.once("drain", onDrain)
        stream.once("error", onError)
        stream.once("close", onClose)
      })
    }
  }

  /** Flush + close. Returns the row count and SHA-256 over the exact
   *  bytes written (line + "\n" per row — matches --verify hashing). */
  async function close(): Promise<{ rows: number; sha256: string }> {
    if (closed) throw new Error("jsonl writer already closed")
    closed = true
    if (error) throw error
    await new Promise<void>((resolvePromise, rejectPromise) => {
      stream.end(() => (error ? rejectPromise(error) : resolvePromise()))
      stream.once("error", () => rejectPromise(error ?? new Error("stream error")))
    })
    return { rows, sha256: hash.digest("hex") }
  }

  return { writeLine, close }
}

/** A manifest `file` must resolve strictly inside the backup dir —
 *  absolute paths and `..` escapes are rejected. */
export function isSafeBackupRelPath(dir: string, rel: string): boolean {
  if (!rel || rel.includes("\0") || rel.includes("..") || resolve(rel) === rel || /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("/") || rel.startsWith("\\")) {
    return false
  }
  const root = resolve(dir)
  const abs = resolve(root, rel)
  return abs.startsWith(root + sep)
}

/** Structural manifest validation — returns null on any malformed shape. */
export function parseBackupManifest(raw: string): BackupManifest | null {
  let m: unknown
  try {
    m = JSON.parse(raw)
  } catch {
    return null
  }
  if (!m || typeof m !== "object") return null
  const tables = (m as BackupManifest).tables
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) return null
  for (const [name, t] of Object.entries(tables)) {
    if (!name || !t || typeof t !== "object") return null
    if (typeof t.file !== "string" || !t.file) return null
    if (!Number.isInteger(t.rows) || t.rows < 0) return null
    if (typeof t.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(t.sha256)) return null
    if (basename(t.file) !== t.file) return null // flat layout only
  }
  return m as BackupManifest
}

export interface BackupVerifyResult {
  ok: boolean
  errors: string[]
  checked: number
}

/**
 * Verify a backup directory against its manifest. Rejects: missing or
 * malformed manifest, unsafe file paths, missing files, wrong row
 * counts, wrong hashes, and (when `expectedTables` is given) manifest
 * entries that omit a required table.
 */
export async function verifyBackupDir(dir: string, expectedTables?: string[]): Promise<BackupVerifyResult> {
  const errors: string[] = []
  const root = resolve(dir)
  const manifestPath = join(root, "manifest.json")
  if (!existsSync(manifestPath)) {
    return { ok: false, errors: ["manifest.json missing — incomplete or foreign backup"], checked: 0 }
  }
  const manifest = parseBackupManifest(readFileSync(manifestPath, "utf8"))
  if (!manifest) {
    return { ok: false, errors: ["manifest.json is malformed"], checked: 0 }
  }
  if (expectedTables) {
    for (const t of expectedTables) {
      if (!(t in manifest.tables)) errors.push(`manifest missing required table "${t}"`)
    }
  }
  let checked = 0
  for (const [name, meta] of Object.entries(manifest.tables)) {
    if (!isSafeBackupRelPath(root, meta.file)) {
      errors.push(`${name}: unsafe file path "${meta.file}"`)
      continue
    }
    const file = join(root, meta.file)
    if (!existsSync(file) || !statSync(file).isFile()) {
      errors.push(`${name}: missing file ${meta.file}`)
      continue
    }
    const hash = createHash("sha256")
    let lines = 0
    const rl = createInterface({ input: createReadStream(file) })
    for await (const line of rl) {
      if (!line.trim()) continue
      lines++
      hash.update(line)
      hash.update("\n")
    }
    const sha = hash.digest("hex")
    if (lines !== meta.rows) {
      errors.push(`${name}: row count ${lines} != manifest ${meta.rows}`)
    } else if (sha !== meta.sha256) {
      errors.push(`${name}: sha256 mismatch`)
    } else {
      checked++
    }
  }
  return { ok: errors.length === 0, errors, checked }
}
