/**
 * 数据.sqlite: every data version of a dataset, on Node's built-in SQLite.
 *
 * One row per data version (cutoff, configuration version, input files,
 * reconciliation, review items, unknown values, status changes) and the
 * cleaned entities of each version. Entities are stored as JSON with the
 * few columns queries filter on; analysis reads a whole version into memory.
 * Old versions stay, so the board can switch back and finalized reports keep
 * pointing at the data they were written from.
 */
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, built_at TEXT, rebuilt_at TEXT, as_of TEXT, spec_version INTEGER, inputs TEXT, recon TEXT, review TEXT, pending TEXT, changes TEXT, issues TEXT, gate TEXT, acked INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS customers (version INTEGER, cid TEXT, data TEXT, PRIMARY KEY (version, cid))`,
  `CREATE TABLE IF NOT EXISTS transactions (version INTEGER, tid TEXT, cid TEXT, date TEXT, counted INTEGER, data TEXT, PRIMARY KEY (version, tid))`,
  `CREATE TABLE IF NOT EXISTS assets (version INTEGER, aid TEXT, cid TEXT, data TEXT)`,
  `CREATE TABLE IF NOT EXISTS touches (version INTEGER, id TEXT, cid TEXT, date TEXT, data TEXT)`,
  `CREATE TABLE IF NOT EXISTS leads (version INTEGER, lid TEXT, cid TEXT, date TEXT, data TEXT)`,
  `CREATE TABLE IF NOT EXISTS campaigns (version INTEGER, name TEXT, data TEXT)`,
  `CREATE TABLE IF NOT EXISTS owners (version INTEGER, name TEXT, data TEXT)`,
  `CREATE INDEX IF NOT EXISTS tx_cid ON transactions (version, cid)`,
  `CREATE INDEX IF NOT EXISTS asset_cid ON assets (version, cid)`,
  `CREATE INDEX IF NOT EXISTS touch_cid ON touches (version, cid)`,
  `CREATE INDEX IF NOT EXISTS lead_version ON leads (version)`,
]
const ENTITY_TABLES = ['customers', 'transactions', 'assets', 'touches', 'leads', 'campaigns', 'owners']

/** Open (and create) a dataset's database. Close it when done. */
export function openDb(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  for (const sql of SCHEMA) db.exec(sql)
  return db
}

const j = v => JSON.stringify(v ?? null)
const p = s => (s === null || s === undefined ? null : JSON.parse(s))

/** Run fn inside one transaction. */
function tx(db, fn) {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Write a pipeline result as a data version, replacing that version's rows when it exists.
 * @param {DatabaseSync} db
 * @param {number} version
 * @param {object} result - from runPipeline.
 * @param {{ asOf: string, specVersion: number, inputs: object, rebuilt: boolean }} info
 */
export function writeVersion(db, version, result, info) {
  tx(db, () => {
    for (const t of ENTITY_TABLES) db.prepare(`DELETE FROM ${t} WHERE version = ?`).run(version)
    const now = new Date().toISOString()
    const existing = db.prepare('SELECT built_at FROM versions WHERE version = ?').get(version)
    db.prepare('INSERT OR REPLACE INTO versions (version, built_at, rebuilt_at, as_of, spec_version, inputs, recon, review, pending, changes, issues, gate, acked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(version, existing?.built_at ?? now, existing ? now : null, info.asOf, info.specVersion, j(info.inputs), j(result.recon), j(result.review), j(result.pending), j(result.changes), j(result.issues.slice(0, 500)), result.recon.gate, result.recon.gate === 'ok' ? 1 : 0)
    const c = db.prepare('INSERT INTO customers (version, cid, data) VALUES (?, ?, ?)')
    for (const x of result.customers) c.run(version, x.cid, j(x))
    const t = db.prepare('INSERT INTO transactions (version, tid, cid, date, counted, data) VALUES (?, ?, ?, ?, ?, ?)')
    for (const x of result.transactions) t.run(version, x.tid, x.cid, x.date, x.counted ? 1 : 0, j(strip(x)))
    const a = db.prepare('INSERT INTO assets (version, aid, cid, data) VALUES (?, ?, ?, ?)')
    for (const x of result.assets) a.run(version, x.aid, x.cid, j(strip(x)))
    const o = db.prepare('INSERT INTO touches (version, id, cid, date, data) VALUES (?, ?, ?, ?, ?)')
    for (const x of result.touches) o.run(version, x.id, x.cid, x.date, j(strip(x)))
    const l = db.prepare('INSERT INTO leads (version, lid, cid, date, data) VALUES (?, ?, ?, ?, ?)')
    for (const x of result.leads ?? []) l.run(version, x.lid, x.cid ?? null, x.date, j(strip(x)))
    const g = db.prepare('INSERT INTO campaigns (version, name, data) VALUES (?, ?, ?)')
    for (const x of result.campaigns) g.run(version, x.name, j(x))
    const w = db.prepare('INSERT INTO owners (version, name, data) VALUES (?, ?, ?)')
    for (const x of result.owners) w.run(version, x.name, j(x))
  })
}
// Pipeline-only bookkeeping does not belong in the stored row.
const strip = ({ record, refs, linkKey, ...rest }) => ({ ...rest, refs: refs ?? undefined })

/** Every data version, newest last, without the entity rows. */
export function listVersions(db) {
  return db.prepare('SELECT version, built_at, rebuilt_at, as_of, spec_version, inputs, recon, gate, acked FROM versions ORDER BY version').all().map(r => ({
    version: r.version, builtAt: r.built_at, rebuiltAt: r.rebuilt_at, asOf: r.as_of, specVersion: r.spec_version, inputs: p(r.inputs), recon: p(r.recon), gate: r.gate, acked: r.acked === 1,
  }))
}

/** One version's bookkeeping: reconciliation, review items, unknown values, changes, issues. */
export function versionInfo(db, version) {
  const r = db.prepare('SELECT * FROM versions WHERE version = ?').get(version)
  if (!r) return null
  return { version: r.version, builtAt: r.built_at, rebuiltAt: r.rebuilt_at, asOf: r.as_of, specVersion: r.spec_version, inputs: p(r.inputs), recon: p(r.recon), review: p(r.review), pending: p(r.pending), changes: p(r.changes), issues: p(r.issues), gate: r.gate, acked: r.acked === 1 }
}

/** All entity rows of one version. */
export function readVersion(db, version) {
  const all = (table) => db.prepare(`SELECT data FROM ${table} WHERE version = ?`).all(version).map(r => p(r.data))
  return { customers: all('customers'), transactions: all('transactions'), assets: all('assets'), touches: all('touches'), leads: all('leads'), campaigns: all('campaigns'), owners: all('owners') }
}

/** The person looked at the columns that parsed below the bar and wants to go on. */
export function ackVersion(db, version) {
  db.prepare('UPDATE versions SET acked = 1 WHERE version = ?').run(version)
}
