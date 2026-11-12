/**
 * Datasets and their sources, on disk.
 *
 * A dataset is a visible folder under `documentsDir/客户运营/<name>`:
 *   .crm-ops.json        marker and dataset state (sources, cutoff date)
 *   原始/                 imported originals, never modified
 *   体检/<sourceId>.json  the full profile of each source (raw samples stay here, on this machine)
 *   工作台.json            what the person adds: notes, tags, reminders, saved views (keyed by person id)
 *   导出/                  Excel files the person exported
 *   回收站/               removed sources
 *
 * Every mutation runs through one queue and writes atomically.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { access, appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { COMPUTED_KINDS, readFeishuBase } from './feishu.js'
import { keptRows, maskName, maskText, profileSheet, redactProfile } from './profile.js'
import { findLinks } from './links.js'
import { USER_DIR_NAME, getPreset, loadPresets } from './presets.js'
import { ENTITIES, capabilities, checkSpec, checkTables, describeRule, dictValues, diffSpec, entitiesOf, mappedColumns, presetTables, ruleFeatures, summarizeSpec, tracksConsent, withoutColumns } from './spec.js'
import { ackVersion, listVersions, openDb, readVersion, versionInfo, writeVersion } from './db.js'
import { ownersApart, reconProblems, runPipeline } from './pipeline.js'
import { insights, kindOf } from './insights.js'
import { daysBefore, daysBetween } from './clean.js'
import { context as queryContext, runQuery, wasIn } from './analysis.js'
import { ACTION_STATES, LEAD_STATES, checkLeadFilter, leadDimensions, leadInsights, leadPasses, leadSettings, monthlyLeads } from './leads.js'
import { NEW_ARRIVAL, OTHER, byCustomer, campaignEffect, featuresOf, segmentAll } from './features.js'
import { allowedNumbers, appendix, checkNumbers, render, renderMarked, resolveRefs, resultTables } from './report.js'
import { markdownToDocx, zip } from './docx.js'
import { NO_OWNER, boardSheet, hasOwners, ownerBoard, ownerBriefs, ownerDetail } from './owners.js'
import { reachBoard } from './reach.js'
import { LEFT, batchName, batchView, blockOf, consequence, emptyLists, goalAtCreation, goalOf, goalOutcome, goalText, memberIndex, outcomesOf, poolOf, suggestPurpose, unreachableStreaks } from './lists.js'
import * as XLSX from '../vendor/xlsx.mjs'
import { CrmError, readFileBytes } from './read.js'

export { CrmError }

const SCHEMA = 2
/** Bump when profiling logic changes; stored profiles of another version are recomputed on read. */
export const PROFILER_VERSION = 4
const LINKS_FILE = '关联.json'
const ROOT = '客户运营'
const MARKER = '.crm-ops.json'
const ORIGINALS = '原始'
const PROFILES = '体检'
const TRASH = '回收站'
const EXPORTS = '导出'
/** Largest file a person may import, in bytes. */
export const IMPORT_LIMIT = 50 * 1024 * 1024
const CONFIG = '配置'
const DB_FILE = '数据.sqlite'
const DECISIONS = '复核决定.json'
const MERGE_LOG = '合并日志.jsonl'
const QUERY_LOG = '查询记录.jsonl'
const PENDING = '待确认.json'
const REPORTS = '报告'
const REPORT_INDEX = '报告.json'
const REPORT_TEXT = 40000
const LISTS = '名单.json'
const LIST_LIMIT = 5000
const STARTER = '起点.json'
const DRAFT = '草稿.json'
async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    // access() rejects for a missing or unreadable path; both mean "not there" here.
    return false
  }
}
async function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

/** A folder-safe name: separators and reserved characters become `-`, at most 60 characters. */
/** A worksheet title Excel accepts: none of \ / ? * [ ] :, at most 28 characters. */
const sheetTitle = k => String(k).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || '表'

/** Hand out names that never repeat (two dealers whose names shorten to the same thing): `名字`, `名字-2`, … */
function uniqueNames(max = 60) {
  const used = new Set()
  return base => { let n = base; for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, max - 3)}-${i}`; used.add(n.toLowerCase()); return n }
}

export function folderName(title) {
  const cleaned = [...String(title)].map(ch => (/[\\/:*?"<>|\u0000-\u001f]/.test(ch) ? '-' : ch)).join('').trim().replace(/^\.+/, '').slice(0, 60).trim()
  return cleaned === '' ? '未命名' : cleaned
}
// The date and the time where the person is. The UTC date is still yesterday until 8 in the morning in China,
// which would refuse a cutoff of today, date a list a day early and stamp exports eight hours off.
const two = n => String(n).padStart(2, '0')
const localDay = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
const localStamp = (d = new Date()) => `${localDay(d)} ${two(d.getHours())}:${two(d.getMinutes())}`
const today = () => localDay()

/** A report's text without a heading of its own on top: the report has a title, and a writer tends to repeat it. */
const untitled = body => String(body).trim().replace(/^#\s+[^\n]*(\n|$)/, '').trim()
const shortId = () => randomUUID().replace(/-/g, '').slice(0, 8)
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Owner of every dataset under one documents folder. */
/** The header, the row and the "about" sheet of a lead export, shared by every way of splitting it. */
function leadSheets(ctx, { withName = false } = {}) {
  const s = leadSettings(ctx.spec)
  const ownerWord = ctx.spec.labels?.owner ?? '归属方'
  const head = ['线索编号', '留资时间', '姓名', ownerWord, '跟进人', '来源渠道', '来源明细', '活动', '意向产品', '级别', s.trialName, '结果', '现在的状态', '首次跟进', '最近跟进', '距最近跟进（天）', '挂上的客户', '跟进结果（联系后填）']
  const line = l => { const r = leadRow(ctx, l); return [r.extId ?? '', r.at ?? r.date, withName ? r.name ?? '' : maskName(r.name ?? ''), r.owner ?? '', r.rep ?? '', r.channel ?? '', r.source ?? '', r.campaign ?? '', r.product ?? '', r.level ?? '', r.trial ?? '', r.result ?? '', r.state, r.firstFollow ?? '', r.lastFollow ?? '', r.quietDays ?? '', r.code ?? '', ''] }
  const about = (n, what, how) => [['导出', localStamp()], ['数据截至', ctx.asOf], ['筛选', what], ['线索数', n], ['分表', how], ['状态口径', `首跟超时：留资超过 ${s.followDays} 天没有跟进记录；跟进断了：超过 ${s.staleDays} 天没再联系；放太久：留资满 ${s.activeDays} 天还没结果`], ['姓名', withName ? '这份表带原始姓名，请只发给负责跟进的人。' : '姓名遮过了；要原始姓名请在客户运营台勾选「带上姓名」重新导出。']]
  return { head, line, about }
}

/** One workbook of leads (a 线索 sheet and a 说明 sheet), as bytes. */
function leadWorkbook(ctx, list, { withName = false, what, how }) {
  const { head, line, about } = leadSheets(ctx, { withName })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...list.map(line)]), '线索')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(about(list.length, what, how)), '说明')
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

/**
 * The tags a pick asks people to carry none of: one name or several, each a tag of the configuration.
 * @returns {string[] | null} null when nothing is asked.
 */
export function withoutOf(spec, input) {
  if (input === undefined || input === null || input === '') return null
  const list = [...new Set((Array.isArray(input) ? input : [input]).map(String).filter(Boolean))]
  if (list.length === 0) return null
  const names = spec.flags.map(f => f.name)
  const bad = list.find(f => !names.includes(f))
  if (bad) throw new CrmError('bad-pick', `没有「${bad}」这个标记。标记只能是：${names.join('、') || '（这个数据集没有标记）'}`)
  return list
}

/**
 * Fit one preset's ready-made tables onto a dataset's usable sheets (see `Datasets.presetFit`).
 * `drafts` are the tables as the configuration would carry them: bound to their sheet, without what maps
 * an optional column the sheet lacks.
 */
export function fitPreset(preset, sheets) {
  const templates = presetTables(preset)
  if (templates.length === 0) return { templates: 0, ready: false, tables: [], unmatched: [], dropped: [], lacks: [], drafts: [] }
  const taken = new Set()
  const usable = (s, c) => s.columns.includes(c) && !(s.empty ?? []).includes(c)
  const tables = []
  const unmatched = []
  const dropped = []
  for (const t of templates) {
    const need = [...new Set(mappedColumns(t.table).map(c => c.column))].filter(c => !t.optional.includes(c))
    const free = sheets.filter(s => !taken.has(`${s.source}:${s.sheet}`))
    // The newest import wins when two exports of the same table are there.
    const s = free.filter(x => need.every(c => usable(x, c))).sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))[0]
    if (!s) {
      // Say what kept the nearest sheet out, so a renamed column is seen at once.
      const near = free.map(x => ({ x, missing: need.filter(c => !usable(x, c)) })).sort((a, b) => a.missing.length - b.missing.length)[0]
      unmatched.push({ name: t.name, optional: t.sheetOptional, ...(near && near.missing.length <= Math.max(3, need.length * 0.3) ? { nearest: `${near.x.sourceName} · ${near.x.sheetName}`, missing: near.missing } : {}) })
      continue
    }
    taken.add(`${s.source}:${s.sheet}`)
    const gone = t.optional.filter(c => !usable(s, c))
    if (gone.length) dropped.push({ name: t.name, columns: gone })
    tables.push({ name: t.name, source: s.source, sourceName: s.sourceName, sheet: s.sheet, sheetName: s.sheetName, table: { ...withoutColumns(t.table, gone), source: s.source, sheet: s.sheetName } })
  }
  const fed = entitiesOf({ tables: tables.map(x => x.table) })
  const lacks = Object.entries(ENTITIES).filter(([e, def]) => def.required && !fed.has(e)).map(([, def]) => def.name)
  return { templates: templates.length, ready: lacks.length === 0 && unmatched.every(x => x.optional), tables: tables.map(({ table, ...rest }) => rest), unmatched, dropped, lacks, drafts: tables.map(x => x.table) }
}

const ENTITY_WORDS = { transaction: '交易', asset: '持有物', touch: '互动', lead: '线索' }
/** Share of buyers with a second deal below which "long since the last deal" reads as a stage, not a loss. */
const REPEAT_SHARE_MIN = 0.2

/**
 * For a draft's trial run: how many people each segment and tag would hold as of the cutoff, and what looks
 * off about the rules without being wrong: a group nobody falls into, and segments the board would read as
 * "lapsed" in a dataset where hardly anyone ever buys twice.
 */
export function trialGroups(result, spec, asOf) {
  const index = byCustomer({ customers: result.customers, transactions: result.transactions, assets: result.assets, touches: result.touches, leads: result.leads })
  const seg = segmentAll(index, spec, asOf)
  const off = new Set(seg.disabled.map(d => `${d.kind}:${d.name}`))
  const groups = {
    total: seg.total,
    segments: [...spec.segments.map(x => ({ name: x.name, count: seg.counts[x.name], kind: kindOf(x), ...(off.has(`segment:${x.name}`) ? { off: true } : {}) })), { name: OTHER, count: seg.counts[OTHER], kind: null }],
    flags: spec.flags.map(x => ({ name: x.name, count: seg.flags[x.name], kind: kindOf(x), ...(off.has(`flag:${x.name}`) ? { off: true } : {}) })),
  }
  const hints = []
  const n = v => Number(v).toLocaleString('en-US')
  const empty = [...groups.segments, ...groups.flags].filter(g => g.name !== OTHER && !g.off && g.count === 0).map(g => g.name)
  if (empty.length > 0 && seg.total > 0) hints.push(`${empty.map(x => `「${x}」`).join('')}现在一个人都没有：看看规则里的取值和天数是不是写对了（取值要和字典或原表里的写法一字不差），本来就该是空的就不用管`)
  // "Came back" means a deal in another month: several units bought in one go are one occasion.
  let buyers = 0
  let repeat = 0
  for (const [, e] of index) {
    const months = new Set(e.txns.filter(t => t.counted && !t.refund && t.date).map(t => t.date.slice(0, 7)))
    if (months.size >= 1) buyers++
    if (months.size >= 2) repeat++
  }
  const SINCE = new Set(['days_since_last_txn', 'days_since_field'])
  const lapsed = spec.segments.filter(x => x.kind === undefined && kindOf(x) === 'lapsed' && ruleFeatures(x).some(c => SINCE.has(c.feature))).map(x => x.name)
  if (lapsed.length > 0 && buyers >= 30 && repeat / buyers < REPEAT_SHARE_MIN) {
    hints.push(`${lapsed.map(x => `「${x}」`).join('')}是按「多久没有交易」分的，看板会把掉进去的人算成变差、要去拉回来。但这份数据里有交易的 ${n(buyers)} 位客户只有 ${Math.round((repeat / buyers) * 1000) / 10}% 隔月又来过：如果这一行是买一次用很多年，这几层其实是「买了多久」的阶段，给它们写 "kind": "lifecycle"；确实该定期回来（保养、续费、复购）才不用改`)
  }
  return { groups, hints }
}

export class Datasets {
  /**
   * @param {{ documentsDir: string, readFeishu?: (link: string) => Promise<object>, today?: () => string }} options
   *   `today` is for tests whose synthetic data runs past the real date.
   */
  constructor({ documentsDir, readFeishu = readFeishuBase, today: todayFn = today }) {
    this.today = todayFn
    this.root = join(documentsDir, ROOT)
    this.presetDir = join(this.root, USER_DIR_NAME)
    this.cache = new Map()
    this.readFeishu = readFeishu
    this.queue = Promise.resolve()
    // Marks code running inside a mutation, so shared helpers know whether they may write the state.
    this.inMutation = new AsyncLocalStorage()
    this.logQueue = Promise.resolve()
    this.listeners = new Set()
  }

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Run one mutation after every earlier one, then notify listeners. */
  mutate(fn) {
    this.cache.clear()
    this.epoch = (this.epoch ?? 0) + 1
    const run = this.queue.then(() => this.inMutation.run(true, fn))
    this.queue = run.catch(() => {})
    // What a change read on its way (the lists as they were before it wrote a new one, who had left before it
    // marked someone) must not outlive it: the next reader would be told the list it just made does not exist.
    const settle = () => { this.epoch += 1; this.cache.clear() }
    return run.then(value => {
      settle()
      for (const l of this.listeners) l()
      return value
    }, error => { settle(); throw error })
  }

  async dirOf(id) {
    if (!/^[a-f0-9]{8}$/.test(String(id))) throw new CrmError('no-dataset', '找不到这个数据集')
    if (!(await exists(this.root))) throw new CrmError('no-dataset', '找不到这个数据集')
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const marker = join(this.root, entry.name, MARKER)
      if (await exists(marker)) {
        const state = await readJson(marker)
        if (state.id === id) return join(this.root, entry.name)
      }
    }
    throw new CrmError('no-dataset', '找不到这个数据集')
  }

  async load(id) {
    const dir = await this.dirOf(id)
    const state = await readJson(join(dir, MARKER))
    if (state.schema === 1) migrate1(state)
    if (state.schema !== SCHEMA) throw new CrmError('schema', `数据集「${state.name}」的版本是 ${state.schema}，这个插件只认 ${SCHEMA}`)
    if (!state.salt) {
      // Datasets made before customer codes existed get their secret on first read.
      state.salt = randomBytes(16).toString('hex')
      await writeJson(join(dir, MARKER), state)
    }
    return { dir, state }
  }

  /** Every dataset, newest first, with a short summary. */
  async list() {
    if (!(await exists(this.root))) return []
    const out = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const marker = join(this.root, entry.name, MARKER)
      if (!(await exists(marker))) continue
      try {
        const s = await readJson(marker)
        out.push({ id: s.id, name: s.name, preset: s.preset, createdAt: s.createdAt, asOf: s.asOf, sources: s.sources.length, dir: join(this.root, entry.name) })
      } catch {
        // A marker that is not valid JSON is not one of ours to show.
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Full state of one dataset, with every source's warnings. */
  async get(id) {
    const { dir, state } = await this.load(id)
    return { ...state, dir }
  }

  create({ name, preset }) {
    return this.mutate(async () => {
      const title = String(name ?? '').trim()
      if (title === '' || [...title].length > 30) throw new CrmError('bad-name', '数据集名字要有 1～30 个字')
      const starter = await getPreset(String(preset ?? ''), this.presetDir)
      if (!starter) throw new CrmError('bad-preset', '选一个起点：教育示例、动力运动或从零开始')
      await mkdir(this.root, { recursive: true })
      let folder = folderName(title)
      for (let n = 2; await exists(join(this.root, folder)); n++) folder = `${folderName(title)} ${n}`
      const dir = join(this.root, folder)
      await mkdir(join(dir, ORIGINALS), { recursive: true })
      await mkdir(join(dir, PROFILES), { recursive: true })
      await mkdir(join(dir, CONFIG), { recursive: true })
      // The dataset keeps its own copy of the preset, so later preset edits never change it.
      await writeJson(join(dir, CONFIG, STARTER), starter)
      const state = { schema: SCHEMA, id: shortId(), name: title, preset, createdAt: new Date().toISOString(), asOf: null, asOfConfirmed: false, sources: [], bindings: [], spec: emptySpecState(), salt: randomBytes(16).toString('hex') }
      await writeJson(join(dir, MARKER), state)
      return { ...state, dir }
    })
  }

  /**
   * Import one file: keep the original, read it, profile every sheet.
   * @param {string} id - dataset id.
   * @param {string} fileName - original file name.
   * @param {Buffer} bytes - file contents.
   */
  importFile(id, fileName, bytes) {
    return this.mutate(async () => {
      const name = basename(String(fileName ?? '')).trim()
      if (name === '') throw new CrmError('bad-file', '文件没有名字')
      if (bytes.length === 0) throw new CrmError('bad-file', `「${name}」是空文件`)
      if (bytes.length > IMPORT_LIMIT) throw new CrmError('too-big', `文件最大 ${IMPORT_LIMIT / 1024 / 1024} MB`)
      const { dir, state } = await this.load(id)
      const read = readFileBytes(name, new Uint8Array(bytes))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const dup = state.sources.find(s => s.sha256 === sha256)
      if (dup) throw new CrmError('duplicate', `这个文件已经导入过了（「${dup.name}」）`)
      const sourceId = shortId()
      const stored = `${sourceId}-${folderName(name.replace(extname(name), ''))}${extname(name).toLowerCase()}`
      await writeFile(join(dir, ORIGINALS, stored), bytes, { flag: 'wx' })
      return this.#addSource(dir, state, { id: sourceId, kind: 'file', name, stored, sha256, bytes: bytes.length, encoding: read.encoding ?? null }, read.sheets)
    })
  }

  /**
   * Import a Feishu Base by link through the local lark-cli.
   * The snapshot is stored as JSON in 原始/ so later steps never call Feishu again for this import.
   */
  importFeishu(id, link) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const base = await this.readFeishu(String(link ?? ''))
      const sourceId = shortId()
      const stored = `${sourceId}-飞书-${folderName(base.title || '多维表格')}.json`
      const snapshot = { link: String(link), title: base.title, baseToken: base.baseToken, readAt: new Date().toISOString(), sheets: base.sheets.map(s => ({ name: s.name, columns: s.columns, rows: s.rows })) }
      const text = JSON.stringify(snapshot)
      await writeFile(join(dir, ORIGINALS, stored), text, { flag: 'wx' })
      const sha256 = createHash('sha256').update(text).digest('hex')
      return this.#addSource(dir, state, { id: sourceId, kind: 'feishu', name: base.title || '飞书多维表格', stored, sha256, bytes: Buffer.byteLength(text), link: String(link) }, base.sheets)
    })
  }

  async #addSource(dir, state, source, sheets) {
    const entry = { ...source, importedAt: new Date().toISOString(), sheets: sheets.map((sh, i) => ({ index: i, name: sh.name, use: true })) }
    state.sources.push(entry)
    // During first setup a new file means the health checks need another look; later imports are increments.
    if (state.spec.current === null) delete state.checkedAt
    const before = state.asOf
    const latest = suggestAsOf(state, sheets.map(sh => profileSheet(sh)), this.today())
    if (!state.asOfConfirmed) state.asOf = latest ?? state.asOf
    // A confirmed cutoff stays where the person put it. When the new file runs past it (next month's export),
    // say so: until the cutoff moves, those rows are "after the cutoff" and count for nothing.
    else if (latest && state.asOf && latest > state.asOf) entry.asOfLater = latest
    // Every sheet is checked against the same cutoff, so a new cutoff re-profiles the earlier sources too.
    for (const s of state.sources) if (s === entry || state.asOf !== before) await this.#profileSource(dir, state, s, s === entry ? sheets : undefined)
    for (const x of entry.sheets) x.use = x.rows > 0
    // A new export of a table the configuration already has (same columns) goes under it by itself.
    entry.bound = []
    if (state.spec.current !== null) {
      const spec = await readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
      const profiles = (await readJson(join(dir, PROFILES, `${entry.id}.json`))).sheets
      entry.sheets.forEach((x, i) => {
        if (!x.use || !x.detail) return
        const columns = profiles[i].columns.map(c => c.name)
        const fits = spec.tables.filter(t => mappedColumns(t).every(c => columns.includes(c.column)))
        if (fits.length !== 1) return
        state.bindings.push({ source: entry.id, sheet: i, table: fits[0].name })
        entry.bound.push({ sheet: x.name, table: fits[0].name })
      })
    }
    await writeJson(join(dir, MARKER), { ...state, sources: state.sources.map(s => (s === entry ? { ...s, bound: undefined, asOfLater: undefined } : s)) })
    return entry
  }

  /** Profile every sheet of one source against the dataset's cutoff, keeping headers the person picked. */
  async #profileSource(dir, state, source, sheets) {
    const read = sheets ?? (await this.#readSheets(dir, source))
    const profiles = read.map((sheet, i) => {
      const meta = source.sheets[i]
      return profileSheet(sheet, { asOf: state.asOf ?? undefined, headerRow: meta?.headerManual ? meta.headerRow - 1 : undefined })
    })
    await writeJson(join(dir, PROFILES, `${source.id}.json`), { sourceId: source.id, version: PROFILER_VERSION, asOf: state.asOf, sheets: profiles })
    profiles.forEach((p, i) => {
      source.sheets[i] = { index: i, name: p.sheet, use: source.sheets[i]?.use ?? true, ...(source.sheets[i]?.headerManual ? { headerManual: true } : {}), ...sheetSummary(p) }
    })
    return profiles
  }

  /**
   * Profiles of one source for code already running inside a mutation (no queueing):
   * stored ones when current, otherwise recomputed and saved on the spot.
   */
  async #profilesIn(dir, state, source) {
    const path = join(dir, PROFILES, `${source.id}.json`)
    const stored = (await exists(path)) ? await readJson(path) : null
    if (stored && stored.version === PROFILER_VERSION && stored.asOf === state.asOf) return stored.sheets
    // Recomputing saves the state. A reader outside the queue (links, status, sheetsOf) holds a copy
    // that a running import may be replacing; writing it back would drop that import. Wait for a turn.
    if (!this.inMutation.getStore()) return this.mutate(() => this.#profilesIn(dir, state, source))
    const fresh = await readJson(join(dir, MARKER))
    if (fresh.schema === 1) migrate1(fresh)
    const src = fresh.sources.find(s => s.id === source.id)
    const sheets = await this.#profileSource(dir, fresh, src)
    await writeJson(join(dir, MARKER), fresh)
    return sheets
  }

  /** Full profiles of one source (raw samples included; for the person's own screen only). */
  async profile(id, sourceId) {
    const { dir, state } = await this.load(id)
    const source = state.sources.find(s => s.id === sourceId)
    if (!source) throw new CrmError('no-source', '找不到这个数据源')
    const path = join(dir, PROFILES, `${sourceId}.json`)
    const stored = (await exists(path)) ? await readJson(path) : null
    if (stored && stored.version === PROFILER_VERSION && stored.asOf === state.asOf) return { source, sheets: stored.sheets }
    // Stale: profiled by older logic or against another cutoff. Recompute in the queue.
    return this.mutate(async () => {
      const fresh = await this.load(id)
      const src = fresh.state.sources.find(s => s.id === sourceId)
      if (!src) throw new CrmError('no-source', '找不到这个数据源')
      const sheets = await this.#profileSource(fresh.dir, fresh.state, src)
      await writeJson(join(fresh.dir, MARKER), fresh.state)
      return { source: src, sheets }
    })
  }

  /** The model's copy of a source's profiles: statistics only, sensitive values removed. */
  async redactedProfile(id, sourceId, options) {
    const { source, sheets } = await this.profile(id, sourceId)
    return { source: { id: source.id, name: source.name, kind: source.kind }, sheets: sheets.filter((_, i) => source.sheets[i]?.use !== false).map(p => redactProfile(p, options)) }
  }

  /** Re-profile one sheet with a header row the person picked. */
  setHeader(id, sourceId, sheetIndex, headerRow) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const source = state.sources.find(s => s.id === sourceId)
      if (!source) throw new CrmError('no-source', '找不到这个数据源')
      const sheets = await this.#readSheets(dir, source)
      const i = Number(sheetIndex)
      const sheet = sheets[i]
      if (!sheet) throw new CrmError('no-sheet', '找不到这个工作表')
      const row = Number(headerRow)
      if (!Number.isInteger(row) || row < 1 || row > Math.min(20, sheet.rows.length)) throw new CrmError('bad-header', '表头只能是前 20 行中的一行')
      Object.assign(source.sheets[i], { headerRow: row, headerManual: true })
      await this.#profileSource(dir, state, source, sheets)
      await writeJson(join(dir, MARKER), state)
      return source.sheets[i]
    })
  }

  /** Include or leave out one sheet. */
  useSheet(id, sourceId, sheetIndex, use) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const sheet = state.sources.find(s => s.id === sourceId)?.sheets[Number(sheetIndex)]
      if (!sheet) throw new CrmError('no-sheet', '找不到这个工作表')
      sheet.use = use === true
      await writeJson(join(dir, MARKER), state)
      return sheet
    })
  }

  /** Confirm the cutoff date every "days since" counts from. */
  setAsOf(id, asOf) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const value = String(asOf ?? '')
      if (!DATE.test(value) || Number.isNaN(Date.parse(value))) throw new CrmError('bad-date', '数据截止日要写成 2026-11-07 这样')
      if (value > this.today()) throw new CrmError('bad-date', '数据截止日不能晚于今天')
      const changed = state.asOf !== value
      state.asOf = value
      state.asOfConfirmed = true
      if (changed) for (const s of state.sources) await this.#profileSource(dir, state, s)
      await writeJson(join(dir, MARKER), state)
      return { asOf: value }
    })
  }

  /**
   * Replace a file source with a new export of the same table. The old original moves to 回收站;
   * the source keeps its id and place, and sheets keep their 用这张表 choice by name.
   */
  replaceFile(id, sourceId, fileName, bytes) {
    return this.mutate(async () => {
      const name = basename(String(fileName ?? '')).trim()
      if (name === '' || bytes.length === 0) throw new CrmError('bad-file', '文件是空的')
      if (bytes.length > IMPORT_LIMIT) throw new CrmError('too-big', `文件最大 ${IMPORT_LIMIT / 1024 / 1024} MB`)
      const { dir, state } = await this.load(id)
      const source = state.sources.find(s => s.id === sourceId)
      if (!source) throw new CrmError('no-source', '找不到这个数据源')
      if (source.kind !== 'file') throw new CrmError('bad-source', '飞书多维表格请重新贴链接导入')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (sha256 === source.sha256) throw new CrmError('duplicate', '这还是原来那个文件，内容没有变')
      const read = readFileBytes(name, new Uint8Array(bytes))
      const bin = join(dir, TRASH, `${new Date().toISOString().replace(/[:.]/g, '-')}-${source.id}-旧版`)
      await mkdir(bin, { recursive: true })
      await rename(join(dir, ORIGINALS, source.stored), join(bin, source.stored))
      const stored = `${source.id}-${folderName(name.replace(extname(name), ''))}-${sha256.slice(0, 6)}${extname(name).toLowerCase()}`
      await writeFile(join(dir, ORIGINALS, stored), bytes, { flag: 'wx' })
      const use = new Map(source.sheets.map(x => [x.name, x.use]))
      Object.assign(source, { name, stored, sha256, bytes: bytes.length, encoding: read.encoding ?? null, importedAt: new Date().toISOString(), replaced: (source.replaced ?? 0) + 1 })
      source.sheets = read.sheets.map((sh, i) => ({ index: i, name: sh.name, use: use.get(sh.name) ?? true }))
      await this.#profileSource(dir, state, source, read.sheets)
      await writeJson(join(dir, MARKER), state)
      return source
    })
  }

  // ---- 进度 -------------------------------------------------------------------

  /** Mark the health checks as looked at (setup step 2). A new import clears it. */
  markChecked(id) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      if (!state.sources.some(s => s.sheets.some(x => x.use && x.rows > 0))) throw new CrmError('no-sheet', '先导入至少一张有数据的表')
      state.checkedAt = new Date().toISOString()
      await writeJson(join(dir, MARKER), state)
      return { checkedAt: state.checkedAt }
    })
  }

  /** Where a dataset stands and what comes next; the model and the stepper read the same thing. */
  async status(id) {
    const { dir, state } = await this.load(id)
    const draft = await this.#draft(dir)
    const data = await this.dataStatus(id, state)
    const table = (source, i) => state.bindings.find(b => b.source === source && b.sheet === i)?.table ?? null
    const usable = state.sources.some(s => s.sheets.some(x => x.use && x.rows > 0))
    const fit = state.spec.current === null ? null : await this.#fit(id, dir, state)
    // Before the first configuration: whether the preset's ready-made tables already fit what was imported.
    const presetFit = state.spec.current === null && usable ? await this.presetFit(id).then(({ drafts, ...rest }) => rest).catch(() => null) : null
    let step = 'ready'
    if (!usable) step = 'import'
    else if (!state.checkedAt) step = 'check'
    else if (!state.asOfConfirmed) step = 'cutoff'
    else if (state.spec.current === null || fit?.reshaped) step = 'config'
    else if (!data || data.stale) step = 'build'
    else if (data.broken) step = 'config'
    else if (data.review.open > 0 && !data.review.skipped) step = 'review'
    return {
      id: state.id,
      name: state.name,
      preset: state.preset,
      asOf: state.asOf,
      asOfConfirmed: state.asOfConfirmed,
      sources: state.sources.map(s => ({ id: s.id, name: s.name, kind: s.kind === 'feishu' ? '飞书多维表格' : '文件', importedAt: s.importedAt, sheets: s.sheets.map(x => ({ name: x.name, use: x.use, rows: x.rows, columns: x.columns, detail: x.detail, list: x.list ?? null, blocks: x.blocks, checks: x.checks, table: table(s.id, x.index) })) })),
      spec: { current: state.spec.current, versions: state.spec.versions.length, draft: draft ? draft.revision : null },
      fit,
      ...(presetFit?.templates ? { presetFit } : {}),
      data: data ?? null,
      step,
      next: fit?.reshaped && step === 'config' ? NEXT_RESHAPED : data?.broken && step === 'config' ? NEXT_BROKEN : presetFit?.ready && !draft && ['check', 'cutoff', 'config'].includes(step) ? NEXT_PRESET : NEXT[step],
    }
  }

  // ---- 预设 and 配置 -----------------------------------------------------------

  /** Presets on offer: built-in ones and the person's edited copies in 客户运营/预设. */
  presets() {
    return loadPresets(this.presetDir)
  }

  /** The preset this dataset started from (its own copy). */
  async starter(id) {
    const { dir, state } = await this.load(id)
    const path = join(dir, CONFIG, STARTER)
    if (await exists(path)) return readJson(path)
    return (await getPreset(state.preset, this.presetDir)) ?? (await getPreset('blank', this.presetDir))
  }

  /**
   * How a preset's ready-made tables fit the sheets now in the dataset: which sheet each one would read,
   * which ones found no sheet, and whether that is enough to draft the whole configuration without anyone
   * writing it. A table fits a sheet that has every column it maps (optional ones aside) with something in it.
   *
   * The dataset's own preset is tried first. When it has no ready-made tables, or they do not fit, the other
   * presets on offer are tried: files dropped on a fresh dataset (made from 从零开始) still find the preset
   * that knows them, and drafting from it makes it the dataset's preset.
   * @returns {Promise<{ templates: number, ready: boolean, own: boolean, preset: { id: string, name: string }, tables: object[], unmatched: object[], dropped: object[], lacks: string[] }>}
   */
  async presetFit(id) {
    const { state } = await this.load(id)
    const sheets = await this.sheetsOf(id)
    const starter = await this.starter(id)
    const own = { ...fitPreset(starter, sheets), own: true, preset: { id: state.preset, name: starter.name ?? state.preset } }
    if (own.ready) return own
    const { presets } = await this.presets()
    for (const p of presets) {
      if (p.id === state.preset) continue
      const fit = fitPreset(p, sheets)
      if (fit.ready) return { ...fit, own: false, preset: { id: p.id, name: p.name } }
    }
    return own
  }

  /**
   * Draft the configuration straight from a preset's ready-made tables, for the sheets they fit. Saved as
   * a draft like any other (checked, tried on the real sheets); the person finalizes. Tables that found no
   * sheet are left out and named in the result. When another preset than the dataset's own is the one that
   * fits, it becomes the dataset's preset.
   */
  draftFromPreset(id, options = {}) {
    return this.mutate(async () => {
      const fit = await this.presetFit(id)
      if (fit.templates === 0) throw new CrmError('no-template', '这个预设没有现成的表对应，请和 AI 聊配置')
      if (fit.lacks.length > 0) throw new CrmError('no-fit', `按预设对不上：现在导入的表里找不到${fit.lacks.map(x => `「${x}」`).join('')}那张（预设里的${fit.unmatched.filter(x => !x.optional).map(x => `「${x.name}」${x.missing ? `差 ${x.missing.join('、')} 这几列` : '没有对应的表'}`).join('；')}）。先把那张表导进来，或者和 AI 聊配置`)
      let preset = await this.starter(id)
      if (!fit.own) {
        const { dir, state } = await this.load(id)
        preset = await getPreset(fit.preset.id, this.presetDir)
        await writeJson(join(dir, CONFIG, STARTER), preset)
        state.preset = fit.preset.id
        await writeJson(join(dir, MARKER), state)
      }
      const spec = {}
      for (const k of ['labels', 'dictionaries', 'identity', 'measures', 'segments', 'flags', 'lists', 'leads', 'campaign', 'privacy', 'report', 'notes']) if (preset[k] !== undefined) spec[k] = structuredClone(preset[k])
      spec.tables = structuredClone(fit.drafts)
      const saved = await this.#saveDraft(id, spec, options)
      return { ...saved, preset: fit.preset, tables: fit.tables, unmatched: fit.unmatched, dropped: fit.dropped }
    })
  }

  /**
   * How the finalized configuration fits the sheets now in the dataset. `empty`: its tables no
   * sheet feeds; `loose`: detail sheets feeding none of its tables, with the tables whose columns
   * they carry. `reshaped` when tables lost their data and sheets came in that fit none of them:
   * the files were swapped for differently shaped ones and the configuration has to follow.
   */
  async #fit(id, dir, state) {
    const spec = await readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
    const sheets = await this.sheetsOf(id)
    const meta = s => state.sources.find(x => x.id === s.source)?.sheets[s.sheet]
    const boundTo = s => state.bindings.find(b => b.source === s.source && b.sheet === s.sheet)?.table ?? null
    const empty = spec.tables.filter(t => !sheets.some(s => boundTo(s) === t.name)).map(t => t.name)
    const loose = sheets
      .filter(s => !boundTo(s) && (meta(s)?.detail || meta(s)?.list))
      .map(s => ({ source: s.source, sourceName: s.sourceName, sheet: s.sheet, sheetName: s.sheetName, fits: spec.tables.filter(t => mappedColumns(t).every(c => s.columns.includes(c.column))).map(t => t.name) }))
    const unfit = loose.filter(l => l.fits.length === 0)
    return { tables: spec.tables.map(t => t.name), empty, loose, reshaped: empty.length > 0 && unfit.length > 0, extra: empty.length === 0 && unfit.length > 0 }
  }

  /** Usable sheets of a dataset with their column names, for checking a configuration's tables. */
  async sheetsOf(id) {
    const { dir, state } = await this.load(id)
    const out = []
    for (const source of state.sources) {
      const sheets = await this.#profilesIn(dir, state, source)
      sheets.forEach((p, i) => {
        if (source.sheets[i]?.use === false || p.rows.kept === 0) return
        out.push({ source: source.id, sourceName: source.name, sheet: i, sheetName: p.sheet, columns: p.columns.map(c => c.name), empty: p.columns.filter(c => c.fillRate === 0).map(c => c.name), importedAt: source.importedAt })
      })
    }
    return out
  }

  /**
   * How the usable sheets point at each other (see links.js). Computed from the originals once
   * per set of files and header rows, kept in 体检/关联.json.
   */
  async links(id) {
    const { dir, state } = await this.load(id)
    const used = state.sources.flatMap(s => s.sheets.filter(x => x.use !== false && x.rows > 0).map(x => `${s.id}:${s.sha256}:${x.index}:${x.headerRow}`))
    const stamp = `${PROFILER_VERSION}|${used.sort().join('|')}`
    const path = join(dir, PROFILES, LINKS_FILE)
    const stored = (await exists(path)) ? await readJson(path).catch(() => null) : null
    if (stored?.stamp === stamp) return stored.links
    const sheets = []
    for (const source of state.sources) {
      const profiles = await this.#profilesIn(dir, state, source)
      if (!source.sheets.some(x => x.use !== false && x.rows > 0)) continue
      const raw = await this.#readSheets(dir, source)
      profiles.forEach((p, i) => {
        if (source.sheets[i]?.use === false || p.rows.kept === 0 || !raw[i]) return
        sheets.push({ source: source.id, sourceName: source.name, sheetName: p.sheet, columns: p.columns.map(c => ({ name: c.name, kind: c.kind })), rows: keptRows(raw[i], p).map(r => r.cells) })
      })
    }
    const links = sheets.length < 2 ? [] : findLinks(sheets)
    await mkdir(join(dir, PROFILES), { recursive: true })
    await writeJson(path, { stamp, links })
    return links
  }

  /** The finalized configuration in use, or null. */
  async currentSpec(id) {
    const { dir, state } = await this.load(id)
    if (state.spec.current === null) return null
    return readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
  }

  async #draft(dir) {
    const path = join(dir, CONFIG, DRAFT)
    return (await exists(path)) ? readJson(path) : null
  }

  /** Configuration state for the page: current version, versions, draft with its checks. */
  async specState(id) {
    const { dir, state } = await this.load(id)
    const current = state.spec.current === null ? null : await readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
    const draft = await this.#draft(dir)
    return {
      current: state.spec.current,
      versions: state.spec.versions,
      spec: current,
      summary: current ? summarizeSpec(current) : null,
      draft: draft ? { ...draft, summary: summarizeSpec(draft.spec) } : null,
      bindings: state.bindings,
    }
  }

  /**
   * Save a configuration draft. It must pass `checkSpec` and match the dataset's sheets;
   * otherwise a CrmError with `details.errors` (paths and fixes) is thrown and nothing is saved.
   * @returns {Promise<{ revision: number, summary: object }>}
   */
  saveSpecDraft(id, input, options = {}) {
    return this.mutate(() => this.#saveDraft(id, input, options))
  }

  async #saveDraft(id, input, { sessionId = null, adopted } = {}) {
    {
      const { dir, state } = await this.load(id)
      const checked = checkSpec(input)
      const errors = [...checked.errors]
      let bindings = state.bindings
      if (checked.ok) {
        const tables = checkTables(checked.spec, await this.sheetsOf(id), state.bindings)
        errors.push(...tables.errors)
        bindings = tables.bindings
      }
      if (errors.length > 0) throw Object.assign(new CrmError('bad-spec', `配置有 ${errors.length} 处要改：${errors.slice(0, 3).map(e => `${e.path}：${e.message}`).join('；')}`), { details: { errors } })
      // Try the draft on the real sheets before anyone finalizes it: what it would load and how much finds its customer.
      const trial = await this.#trial(id, dir, state, checked.spec, bindings)
      const previous = await this.#draft(dir)
      state.spec.draftRevision += 1
      // What this draft changes, worked out by the plugin and not taken from whoever wrote it: against the
      // configuration in use, or, before there is one, against the first draft of this round (a preset's own draft,
      // usually). `sinceLast` is the same against the draft just before it, for the writer to check its last step.
      const current = state.spec.current === null ? null : await readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
      const origin = current ? null : previous?.origin ?? (previous ? { revision: previous.revision, spec: previous.spec } : null)
      const base = current ? { against: `现在用的配置（第 ${state.spec.current} 版）`, spec: current } : origin ? { against: `第 ${origin.revision} 稿`, spec: origin.spec } : null
      const diff = base ? { against: base.against, lines: diffSpec(base.spec, checked.spec), sinceLast: previous ? diffSpec(previous.spec, checked.spec) : null } : null
      const draft = { revision: state.spec.draftRevision, at: new Date().toISOString(), sessionId: sessionId ?? previous?.sessionId ?? null, base: state.spec.current, spec: checked.spec, bindings, adopted: adopted ?? previous?.adopted ?? [], trial, diff, ...(origin ? { origin } : {}) }
      await mkdir(join(dir, CONFIG), { recursive: true })
      await writeJson(join(dir, CONFIG, DRAFT), draft)
      await writeJson(join(dir, MARKER), state)
      return { revision: draft.revision, summary: summarizeSpec(draft.spec), trial, diff }
    }
  }

  /**
   * Run a draft over the sheets it binds without keeping the result: row counts, how many rows of each table
   * found their customer, what the row filters left out, how many people each segment and tag would hold, and
   * the problems in plain words. `hints` are things worth a second look that are not wrong by themselves.
   * Never stops a draft from being saved.
   * @returns {Promise<{ ok: boolean, asOf: string, counts: object, links: object[], problems: string[], excluded: object[], groups: object, hints: string[] } | { ok: null, note: string }>}
   */
  async #trial(id, dir, state, spec, bindings) {
    try {
      const tables = await this.#boundTables(id, dir, state, spec, bindings)
      if (tables.some(t => t.sheets.length === 0)) return { ok: null, note: '有的表这次没有数据，没试跑' }
      const asOf = state.asOf ?? this.today()
      const result = runPipeline({ spec, tables, asOf, decisions: await this.#decisions(dir) })
      const { recon } = result
      const problems = reconProblems(recon, spec.labels)
      const links = Object.entries(recon.link).flatMap(([entity, x]) => Object.entries(x.byTable ?? {}).map(([table, t]) => ({ table, entity, total: t.total, linked: t.linked, ratePct: t.total ? Math.round((t.linked / t.total) * 1000) / 10 : null })))
      const excluded = recon.tables.map(t => {
        const by = {}
        for (const sh of t.sheets) for (const [k, n] of Object.entries(sh.rows.excludedBy ?? {})) by[k] = (by[k] ?? 0) + n
        return { table: t.table, rows: Object.values(by).reduce((a, n) => a + n, 0), by }
      }).filter(x => x.rows > 0)
      const { groups, hints } = trialGroups(result, spec, asOf)
      // A row filter on the customer table that other tables still point into.
      const pointing = new Map()
      for (const [entity, x] of Object.entries(recon.link)) {
        for (const [table, t] of Object.entries(x.byTable ?? {})) {
          const lost = t.unlinkedBy?.excluded ?? 0
          if (lost === 0) continue
          const at = pointing.get(table) ?? { lost: 0, kinds: [] }
          pointing.set(table, { lost: Math.max(at.lost, lost), kinds: [...at.kinds, spec.labels?.[entity] ?? ENTITY_WORDS[entity] ?? entity] })
        }
      }
      // The same 归属方 written two ways in two tables: nothing counted per 归属方 will line up.
      const word = e => spec.labels?.[e] ?? ENTITIES[e]?.name ?? e
      for (const x of recon.owners?.apart ?? []) hints.push(`${word(x.a)}上写的${word('owner')}有 ${x.aCount} 个，${word(x.b)}上有 ${x.bCount} 个，名字对得上的只有 ${x.shared} 个：多半一边是简称、一边是全称或代码。按${word('owner')}看的数会对不上。给这几张表都喂上 owner 这一类（id 写代码那一列或那一段，name 写名称），插件按代码把它们认成同一家；没有代码就把两边的 owner 对到写法相同的那一列`)
      // A directory whose names are codes: the code went into `name`, so the board would list codes.
      const coded = result.owners.filter(o => !o.id && /^[A-Za-z]{0,6}[-_]?\d+$/.test(o.name))
      if (result.owners.length >= 3 && coded.length >= result.owners.length * 0.8) hints.push(`${word('owner')}现在是拿代码当名字的（「${coded[0].name}」这样），看板和导出的文件都会显示代码。喂给 owner 这一类时，代码写到 "id"，名称（简称）写到 "name"：{ "owner": { "id": 代码那一列, "name": 名称那一列 } }，写名称的那张表排在最前面；各张表自己的 owner 字段写代码、简称、全称都行，会读成同一个名字`)
      const filters = excluded.filter(e => spec.tables.find(tb => tb.name === e.table)?.entities?.customer).flatMap(e => Object.keys(e.by)).join('、')
      for (const [table, x] of pointing) hints.unshift(`「${table}」有 ${x.lost.toLocaleString('en-US')} 行（${x.kinds.join('、')}）挂不上客户，因为它们指着的客户被行过滤排除了（${filters || '见 excluded'}）。这些记录就不算在任何人身上了：确实不要这些客户就留着；只是想去掉重复的人，别用行过滤，靠认人规则合并`)
      return { ok: problems.length === 0, asOf, counts: recon.counts, links, problems, excluded, groups, hints, weakLinks: recon.weakLinks, lostRows: recon.lostRows, looseCustomers: recon.looseCustomers }
    } catch (error) {
      return { ok: null, note: `没试跑成：${error?.message ?? error}` }
    }
  }

  /** Finalize the draft: person only. The revision must be the one the person saw. */
  finalizeSpec(id, revision) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const draft = await this.#draft(dir)
      if (!draft) throw new CrmError('no-draft', '还没有配置草案')
      if (Number(revision) !== draft.revision) throw new CrmError('stale-draft', '草案刚刚又改过了，请看一眼最新的再定稿')
      // Sheets may have changed since the draft was saved; check again.
      const tables = checkTables(draft.spec, await this.sheetsOf(id), draft.bindings)
      if (tables.errors.length > 0) throw Object.assign(new CrmError('bad-spec', `数据源变了，草案里有 ${tables.errors.length} 处对不上：${tables.errors[0].path}：${tables.errors[0].message}`), { details: { errors: tables.errors } })
      const version = (state.spec.versions.at(-1)?.version ?? 0) + 1
      const spec = { ...draft.spec }
      for (const t of spec.tables) { delete t.source; delete t.sheet }
      await writeJson(join(dir, CONFIG, `v${version}.json`), spec)
      state.spec.versions.push({ version, at: new Date().toISOString(), revision: draft.revision, base: draft.base, adopted: draft.adopted.length })
      state.spec.current = version
      state.bindings = tables.bindings
      await rename(join(dir, CONFIG, DRAFT), join(dir, CONFIG, `草稿-r${draft.revision}-已定稿.json`))
      await writeJson(join(dir, MARKER), state)
      return { version }
    })
  }

  /** Throw the draft away (kept in 配置/ as a file, never deleted). */
  discardSpecDraft(id) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const draft = await this.#draft(dir)
      if (!draft) throw new CrmError('no-draft', '没有草案可以丢掉')
      await rename(join(dir, CONFIG, DRAFT), join(dir, CONFIG, `草稿-r${draft.revision}-已丢弃.json`))
      return { discarded: draft.revision }
    })
  }

  /** Go back to an earlier finalized version. Person only. */
  useSpecVersion(id, version) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const v = Number(version)
      if (!state.spec.versions.some(x => x.version === v)) throw new CrmError('no-version', `没有第 ${v} 版配置`)
      state.spec.current = v
      await writeJson(join(dir, MARKER), state)
      return { current: v }
    })
  }

  // ---- 清洗、关联、合并 ---------------------------------------------------------

  /** Run fn with the dataset's database open. */
  #withDb(dir, fn) {
    const db = openDb(join(dir, DB_FILE))
    try {
      return fn(db)
    } finally {
      db.close()
    }
  }

  async #decisions(dir) {
    const path = join(dir, DECISIONS)
    return (await exists(path)) ? readJson(path) : { schema: 1, pairs: {}, links: {}, left: {} }
  }

  /** What a data version is built from; a version is stale when these change. */
  #inputs(state) {
    return {
      specVersion: state.spec.current,
      asOf: state.asOf,
      sheets: state.bindings.map(b => {
        const source = state.sources.find(s => s.id === b.source)
        const sheet = source?.sheets[b.sheet]
        return { table: b.table, source: b.source, sheet: b.sheet, sha: source?.sha256 ?? null, header: sheet?.headerRow ?? null, use: sheet?.use !== false }
      }).sort((a, b) => `${a.table}${a.source}${a.sheet}`.localeCompare(`${b.table}${b.source}${b.sheet}`)),
    }
  }

  /** Data-version summary for status(): latest version, whether it is stale, review counts. */
  async dataStatus(id, state) {
    const { dir } = await this.load(id)
    if (!(await exists(join(dir, DB_FILE)))) return null
    return this.#withDb(dir, db => {
      const versions = listVersions(db)
      const latest = versions.at(-1)
      if (!latest) return null
      const info = versionInfo(db, latest.version)
      const open = info.review.filter(i => i.decision === null).length
      const link = info.recon.link.transaction ?? null
      return {
        version: latest.version,
        versions: versions.length,
        builtAt: latest.rebuiltAt ?? latest.builtAt,
        asOf: latest.asOf,
        gate: latest.gate,
        acked: latest.acked,
        stale: JSON.stringify(latest.inputs) !== JSON.stringify(this.#inputs(state)),
        counts: info.recon.counts,
        linkRate: link ? Math.round(link.rate * 1000) / 1000 : null,
        // How many rows of each kind found their customer (leads need not).
        links: Object.fromEntries(Object.entries(info.recon.link).map(([k, x]) => [k, { total: x.total, linked: x.linked, rate: Math.round(x.rate * 1000) / 1000 }])),
        weakLinks: info.recon.weakLinks ?? [],
        problems: latest.acked ? [] : reconProblems(info.recon),
        review: { open, total: info.review.length, skipped: state.reviewSkipped === latest.version },
        pending: info.pending.reduce((a, x) => a + x.values.length, 0),
        looseCustomers: info.recon.looseCustomers ?? [],
        lostRows: info.recon.lostRows ?? [],
        // The run went through but the result looks wrong; until the person goes on anyway (ack) the next step is the configuration.
        broken: (info.recon.lostRows?.length > 0 || info.recon.looseCustomers?.length > 0 || info.recon.weakLinks?.length > 0 || info.recon.overFiltered?.length > 0) && !latest.acked,
      }
    })
  }

  /** The tables of the current configuration with their bound sheets, read from the originals. */
  async #boundTables(id, dir, state, spec, bindings = state.bindings) {
    const out = []
    for (const table of spec.tables) {
      const sheets = []
      for (const b of bindings.filter(x => x.table === table.name)) {
        const source = state.sources.find(s => s.id === b.source)
        if (!source || source.sheets[b.sheet]?.use === false) continue
        const profiles = await this.#profilesIn(dir, state, source)
        const raw = await this.#readSheets(dir, source)
        if (!profiles[b.sheet] || !raw[b.sheet]) continue
        sheets.push({ source: source.id, sheet: b.sheet, sourceName: source.name, sheetName: profiles[b.sheet].sheet, importedAt: source.importedAt, profile: profiles[b.sheet], rows: raw[b.sheet].rows })
      }
      out.push({ table, sheets })
    }
    return out
  }

  async #runBuild(id, { forceSame = false } = {}) {
    const { dir, state } = await this.load(id)
    if (state.spec.current === null) throw new CrmError('no-spec', '配置还没定稿，先和 AI 把配置聊完、点定稿')
    if (!state.asOfConfirmed) throw new CrmError('no-asof', '先确认数据截止日')
    const spec = await readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
    const tables = await this.#boundTables(id, dir, state, spec)
    const missing = tables.filter(t => t.sheets.length === 0).map(t => t.table.name)
    if (missing.length > 0) throw new CrmError('unbound', `配置里的${missing.map(t => `「${t}」`).join('')}这次没有数据：导入它的新一期会自动归进去；以后不用这张表了，就让 AI 改一版配置`)
    for (const t of tables) {
      const newest = [...t.sheets].sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))[0]
      const cols = new Set(newest.profile.columns.map(c => c.name))
      const lost = mappedColumns(t.table).filter(c => !cols.has(c.column)).map(c => c.column)
      if (lost.length > 0) throw new CrmError('columns-changed', `「${t.table.name}」最新的表里找不到这几列：${lost.join('、')}。请让 AI 只针对变了的列重新访谈，或者换回原来格式的导出`)
    }
    const decisions = await this.#decisions(dir)
    const inputs = this.#inputs(state)
    return this.#withDb(dir, db => {
      const versions = listVersions(db)
      const latest = versions.at(-1)
      const same = latest && (forceSame || JSON.stringify(latest.inputs) === JSON.stringify(inputs))
      const version = same ? latest.version : (latest?.version ?? 0) + 1
      // Snapshot tables compare with the version before, so a changed status keeps its history.
      const previous = new Map()
      const prevVersion = same ? versions.at(-2)?.version : latest?.version
      if (prevVersion !== undefined) for (const x of readVersion(db, prevVersion).transactions) if (x.key) previous.set(x.key, { status: x.status, tid: x.tid })
      const result = runPipeline({ spec, tables, asOf: state.asOf, decisions, previous })
      writeVersion(db, version, result, { asOf: state.asOf, specVersion: state.spec.current, inputs: forceSame && latest ? latest.inputs : inputs })
      this.cache.delete(`data:${id}`)
      return { version, rebuilt: Boolean(same), gate: result.recon.gate, counts: result.recon.counts, rowsOk: result.recon.rowsOk, moneyOk: result.recon.moneyOk, parseProblems: result.recon.parseProblems.length, linkWarning: result.recon.linkWarning, looseCustomers: result.recon.looseCustomers, lostRows: result.recon.lostRows, weakLinks: result.recon.weakLinks, problems: reconProblems(result.recon, spec.labels) }
    })
  }

  /** Clean, link and merge with the finalized configuration: a new data version, or the latest one again. Person only. */
  build(id) {
    return this.mutate(() => this.#runBuild(id))
  }

  /** All data versions, newest last. */
  async versions(id) {
    const { dir } = await this.load(id)
    if (!(await exists(join(dir, DB_FILE)))) return []
    return this.#withDb(dir, db => listVersions(db).map(v => ({ version: v.version, builtAt: v.builtAt, rebuiltAt: v.rebuiltAt, asOf: v.asOf, specVersion: v.specVersion, gate: v.gate, acked: v.acked, counts: v.recon.counts, sources: v.inputs.sheets })))
  }

  /** Reconciliation, issues and status changes of one version (default: latest). For the person's screen. */
  async reconciliation(id, version) {
    const { dir } = await this.load(id)
    if (!(await exists(join(dir, DB_FILE)))) throw new CrmError('no-data', '还没有运行过清洗和合并')
    return this.#withDb(dir, db => {
      const v = version ?? listVersions(db).at(-1)?.version
      const info = v === undefined ? null : versionInfo(db, Number(v))
      if (!info) throw new CrmError('no-version', '没有这个数据版本')
      return { version: info.version, asOf: info.asOf, builtAt: info.rebuiltAt ?? info.builtAt, gate: info.gate, acked: info.acked, recon: info.recon, issues: info.issues, changes: info.changes, pending: info.pending }
    })
  }

  /** The person looked at the columns that parse below 95% and goes on anyway. */
  ackData(id) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      return this.#withDb(dir, db => {
        const latest = listVersions(db).at(-1)
        if (!latest) throw new CrmError('no-data', '还没有运行过清洗和合并')
        if (latest.gate === 'error') throw new CrmError('recon-failed', '对账没通过，不能继续：这是程序的问题，请点「问题报告」发给开发者')
        ackVersion(db, latest.version)
        return { version: latest.version, acked: true }
      })
    })
  }

  /** The entity rows of a version (default latest), cached until the next change. */
  async data(id, version) {
    const { dir } = await this.load(id)
    if (!(await exists(join(dir, DB_FILE)))) throw new CrmError('no-data', '还没有运行过清洗和合并')
    const key = `data:${id}`
    return this.#withDb(dir, db => {
      const versions = listVersions(db)
      const v = version === undefined || version === null ? versions.at(-1)?.version : Number(version)
      const meta = versions.find(x => x.version === v)
      if (!meta) throw new CrmError('no-version', '没有这个数据版本')
      const stamp = `${v}:${meta.rebuiltAt ?? meta.builtAt}`
      const hit = this.cache.get(key)
      if (hit?.stamp === stamp) return hit.value
      const value = { version: v, asOf: meta.asOf, specVersion: meta.specVersion, gate: meta.gate, acked: meta.acked, ...readVersion(db, v) }
      this.cache.set(key, { stamp, value })
      return value
    })
  }

  // ---- 复核 ---------------------------------------------------------------------

  /** Review items of the latest version, grouped by reason, open ones first. */
  async review(id) {
    const { dir, state } = await this.load(id)
    if (!(await exists(join(dir, DB_FILE)))) return { version: null, groups: [], open: 0, total: 0 }
    return this.#withDb(dir, db => {
      const latest = listVersions(db).at(-1)
      if (!latest) return { version: null, groups: [], open: 0, total: 0 }
      const items = versionInfo(db, latest.version).review
      const groups = new Map()
      for (const it of items) {
        const k = `${it.kind}|${it.reason}`
        if (!groups.has(k)) groups.set(k, { kind: it.kind, reason: it.reason, default: it.default, items: [] })
        groups.get(k).items.push(it)
      }
      return {
        version: latest.version,
        skipped: state.reviewSkipped === latest.version,
        open: items.filter(i => i.decision === null).length,
        total: items.length,
        groups: [...groups.values()].map(g => ({ ...g, open: g.items.filter(i => i.decision === null).length })).sort((a, b) => b.open - a.open || b.items.length - a.items.length),
      }
    })
  }

  /**
   * Decide review items, one or a whole group at once. Person only.
   * merge items: 'merge' (same person) or 'split' (different people); link items: 'link' or 'unlink'.
   * The decisions are kept by key hash and the latest version is rebuilt with them.
   */
  decide(id, decisions) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const list = Array.isArray(decisions) ? decisions : []
      if (list.length === 0) throw new CrmError('nothing', '没有要处理的条目')
      const items = this.#withDb(dir, db => { const latest = listVersions(db).at(-1); return latest ? versionInfo(db, latest.version).review : [] })
      const byId = new Map(items.map(i => [i.id, i]))
      const file = await this.#decisions(dir)
      const log = []
      const at = new Date().toISOString()
      for (const d of list) {
        const item = byId.get(String(d.id))
        if (!item) throw new CrmError('no-item', '复核清单变了，请刷新后再点')
        const allowed = item.kind === 'merge' ? ['merge', 'split'] : ['link', 'unlink']
        if (!allowed.includes(d.decision)) throw new CrmError('bad-decision', `这一条只能选：${allowed.join('、')}`)
        if (item.kind === 'merge') file.pairs[item.id] = { decision: d.decision, a: item.a.sideKey, b: item.b.sideKey, reason: item.reason, at }
        else file.links[item.id] = { decision: d.decision, reason: item.reason, row: item.row, at }
        log.push({ at, action: 'decide', id: item.id, kind: item.kind, decision: d.decision, reason: item.reason })
      }
      await writeJson(join(dir, DECISIONS), file)
      await appendLog(dir, log)
      return this.#runBuild(id, { forceSame: true })
    })
  }

  /** Take back a decision; the item goes back to the review list. Person only. */
  undoDecision(id, itemId) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const file = await this.#decisions(dir)
      const key = String(itemId)
      if (!file.pairs[key] && !file.links[key]) throw new CrmError('no-item', '这一条没有做过决定')
      delete file.pairs[key]
      delete file.links[key]
      await writeJson(join(dir, DECISIONS), file)
      await appendLog(dir, [{ at: new Date().toISOString(), action: 'undo', id: key }])
      return this.#runBuild(id, { forceSame: true })
    })
  }

  /** Go on without finishing the review: unconfirmed pairs stay different people. Person only. */
  skipReview(id) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const v = this.#withDb(dir, db => listVersions(db).at(-1)?.version)
      if (v === undefined) throw new CrmError('no-data', '还没有运行过清洗和合并')
      state.reviewSkipped = v
      await writeJson(join(dir, MARKER), state)
      return { skipped: v }
    })
  }

  /** The decision log, newest first. */
  async mergeLog(id) {
    const { dir } = await this.load(id)
    const path = join(dir, MERGE_LOG)
    if (!(await exists(path))) return []
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l)).reverse()
  }

  // ---- 数据源归到表 ------------------------------------------------------------

  /** Put a sheet under one of the configuration's tables (a new export of 缴费, say). Person only. */
  bindSheet(id, sourceId, sheetIndex, tableName) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      if (state.spec.current === null) throw new CrmError('no-spec', '配置定稿以后才能把表归进来')
      const spec = await readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
      const table = spec.tables.find(t => t.name === String(tableName))
      if (!table) throw new CrmError('no-table', `配置里没有「${tableName}」这张表`)
      const sheets = await this.sheetsOf(id)
      const sheet = sheets.find(s => s.source === sourceId && s.sheet === Number(sheetIndex))
      if (!sheet) throw new CrmError('no-sheet', '找不到这张工作表，或者它没有数据')
      const lost = mappedColumns(table).filter(c => !sheet.columns.includes(c.column)).map(c => c.column)
      if (lost.length > 0) throw new CrmError('columns-changed', `这张表里找不到「${table.name}」要用的列：${lost.join('、')}`)
      state.bindings = state.bindings.filter(b => !(b.source === sourceId && b.sheet === Number(sheetIndex)))
      state.bindings.push({ source: sourceId, sheet: Number(sheetIndex), table: table.name })
      await writeJson(join(dir, MARKER), state)
      return { source: sourceId, sheet: Number(sheetIndex), table: table.name }
    })
  }

  /** Take a sheet out of its table. Person only. */
  unbindSheet(id, sourceId, sheetIndex) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const before = state.bindings.length
      state.bindings = state.bindings.filter(b => !(b.source === sourceId && b.sheet === Number(sheetIndex)))
      if (state.bindings.length === before) throw new CrmError('no-binding', '这张工作表没有归到任何表')
      await writeJson(join(dir, MARKER), state)
      return { unbound: true }
    })
  }

  /** Unbound sheets whose columns cover a table's mapping: likely a new export of that table. */
  async bindSuggestions(id) {
    const { dir, state } = await this.load(id)
    if (state.spec.current === null) return []
    const spec = await readJson(join(dir, CONFIG, `v${state.spec.current}.json`))
    const out = []
    for (const s of await this.sheetsOf(id)) {
      if (state.bindings.some(b => b.source === s.source && b.sheet === s.sheet)) continue
      const fits = spec.tables.filter(t => mappedColumns(t).every(c => s.columns.includes(c.column)))
      out.push({ source: s.source, sourceName: s.sourceName, sheet: s.sheet, sheetName: s.sheetName, tables: fits.map(t => t.name) })
    }
    return out
  }

  // ---- 分析 ---------------------------------------------------------------------

  /** Stable customer codes for the model: keyed by a per-dataset secret that never leaves this computer. */
  async #coder(id) {
    const { state } = await this.load(id)
    const salt = state.salt
    return cid => `K${createHmac('sha256', salt).update(String(cid)).digest('hex').slice(0, 8).toUpperCase()}`
  }

  /** The configuration a data version was built with. */
  async #specOfVersion(dir, data) {
    return readJson(join(dir, CONFIG, `v${data.specVersion}.json`))
  }

  /** Everything queries read for one version (default latest), cached until the next change. */
  async analysisContext(id, version) {
    const epoch = this.epoch ?? 0
    const { dir } = await this.load(id)
    const data = await this.data(id, version)
    const key = `ctx:${id}`
    const stamp = `${data.version}:${data.asOf}:${this.cache.get(`data:${id}`)?.stamp ?? ''}`
    const hit = this.cache.get(key)
    if (hit?.stamp === stamp) return hit.value
    const spec = await this.#specOfVersion(dir, data)
    const recon = await this.reconciliation(id, data.version)
    const review = await this.review(id)
    const lists = await this.#listsFile(dir)
    const value = queryContext(data, spec, { recon, review, pending: recon.pending, code: await this.#coder(id), privacy: spec.privacy ?? {}, lists, today: this.today() })
    // Kept only when no change started or finished while it was being put together.
    if ((this.epoch ?? 0) === epoch) this.cache.set(key, { stamp, value })
    return value
  }

  /**
   * Run a closed-list query and log it as q1, q2, … so a report draft can cite it.
   * Bad parameters throw CrmError('bad-query') with the allowed values in the message.
   */
  async query(id, kind, params = {}, { session = null, log = true } = {}) {
    const ctx = await this.analysisContext(id)
    const result = lossless(runQuery(ctx, kind, params))
    if (!log) return { ref: null, result }
    // Appending to the log changes no data, so it has its own queue and keeps the caches.
    const run = this.logQueue.then(async () => {
      const { dir } = await this.load(id)
      const path = join(dir, QUERY_LOG)
      const n = (await exists(path)) ? (await readFile(path, 'utf8')).split('\n').filter(Boolean).length + 1 : 1
      await appendFile(path, `${JSON.stringify({ n, at: new Date().toISOString(), session, kind, params, result })}\n`, 'utf8')
      return { ref: `q${n}`, result }
    })
    this.logQueue = run.catch(() => {})
    return run
  }

  /** Logged queries by number (all when `refs` is empty). */
  async queryLog(id, refs = []) {
    const { dir } = await this.load(id)
    const path = join(dir, QUERY_LOG)
    if (!(await exists(path))) return []
    const all = (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l))
    if (refs.length === 0) return all
    const want = new Set(refs.map(r => Number(String(r).replace(/^q/, ''))))
    return all.filter(q => want.has(q.n))
  }

  /** The board: segments with flows, flags, headline numbers, quality. For the person's screen. */
  async overview(id, version) {
    const ctx = await this.analysisContext(id, version)
    const seg = runQuery(ctx, 'segments', { flows: true })
    const can = capabilities(ctx.spec)
    const has = e => can.has(e)
    const metric = (m, extra = {}) => runQuery(ctx, 'metric', { metric: m, ...extra })
    const headline = []
    headline.push({ key: 'customers', ...pick(metric('customers')) })
    if (has('transaction')) {
      // Without a price column the board counts deals and buyers instead of money.
      if (has('amount')) headline.push({ key: 'revenue', ...pick(metric('revenue')) })
      else headline.push({ key: 'txn_count', ...pick(metric('txn_count')) })
      headline.push({ key: 'buyers', ...pick(metric('buyers')) })
      if (has('amount')) headline.push({ key: 'avg_order', ...pick(metric('avg_order')) })
    }
    // One sheet feeding both deals and holdings (a delivery list) would show the same count twice.
    const ownAssets = ctx.spec.tables.some(t => t.entities.asset && !t.entities.transaction)
    if (has('asset') && (ownAssets || !has('transaction'))) headline.push({ key: 'new_assets', ...pick(metric('new_assets')) })
    if (has('touch')) headline.push({ key: 'touches', ...pick(metric('touches', { window: 90 })) })
    if (has('lead')) headline.push({ key: 'leads', ...pick(metric('leads', { window: 90 })) })
    if (headline.length < 4) headline.push({ key: 'new_customers', ...pick(metric('new_customers')) })
    const money = has('transaction') && has('amount')
    const compare = has('transaction') ? runQuery(ctx, 'compare', { metric: money ? 'revenue' : 'txn_count', window: 30 }) : null
    const found = insights(ctx.spec, seg, compare && { metric: compare.metric, name: compare.name, before: compare.a.value, now: compare.b.value, changePct: compare.changePct })
    // Lead findings point at leads (a lead filter), not at a group of customers.
    const leadFound = has('lead') ? leadInsights(ctx.leads, ctx.spec, ctx.asOf).slice(0, 3) : []
    const TONE = { bad: 0, warn: 1, good: 2, info: 3 }
    const items = [...found.items, ...leadFound].sort((a, b) => TONE[a.tone] - TONE[b.tone] || (b.count ?? 0) - (a.count ?? 0)).slice(0, 8)
    return {
      version: ctx.version,
      asOf: ctx.asOf,
      labels: ctx.spec.labels ?? {},
      // What this configuration feeds (entities, and 'amount' when deals carry a price): screens hide the rest.
      can: [...can],
      segments: seg,
      // What each segment and tag is about (read from its rule), and what the board found this time.
      kinds: { segments: found.kinds, flags: found.flagKinds },
      insights: items,
      headline,
      revenue30: compare && { money, now: compare.b.value, before: compare.a.value, changePct: compare.changePct },
      quality: runQuery(ctx, 'quality', {}),
      campaigns: ctx.data.campaigns.filter(c => !c.implicit || withPeople(ctx).has(c.name)).map(c => ({ name: c.name, type: c.type, start: c.start, end: c.end, implicit: Boolean(c.implicit) })),
      owners: [...new Set(ctx.data.customers.map(c => c.owner).filter(Boolean))].sort(),
    }
  }

  /** The people table: raw names and phones, for the person only. Filter by segment, flag, owner, text. */
  async customers(id, { segment, flag, without, was, owner, q, sort = 'recent', limit = 200, offset = 0, version } = {}) {
    const ctx = await this.analysisContext(id, version)
    const s = ctx.segments
    const lacks = withoutOf(ctx.spec, without)
    const text = String(q ?? '').trim()
    const rows = []
    for (const [cid, e] of ctx.index) {
      if (segment && s.of.get(cid) !== segment) continue
      if (flag && !(s.flagsOf.get(cid) ?? []).includes(flag)) continue
      if (lacks && lacks.some(f => (s.flagsOf.get(cid) ?? []).includes(f))) continue
      if (was && !wasIn(ctx, cid, was)) continue
      if (owner && e.c.owner !== owner) continue
      if (text && ![e.c.name, e.c.phone, e.c.id, ...(e.c.names ?? [])].some(v => v && String(v).includes(text)) && !e.assets.some(a => a.serial && a.serial.includes(text.toUpperCase()))) continue
      const f = featuresOf(e, ctx.asOf)
      rows.push({ cid, name: e.c.name, phone: e.c.phone, id: e.c.id, owner: e.c.owner, segment: s.of.get(cid), flags: s.flagsOf.get(cid) ?? [], daysSinceLastTxn: f('days_since_last_txn', []), amount365: f('amount', [365]), txns: e.txns.filter(t => t.counted && !t.refund).length, assets: e.assets.length, daysSinceLastTouch: f('days_since_last_touch', []), lastEvent: lastEvent(e) })
    }
    const by = { recent: (a, b) => (b.lastEvent ?? '').localeCompare(a.lastEvent ?? ''), amount: (a, b) => b.amount365 - a.amount365, quiet: (a, b) => (b.daysSinceLastTxn ?? -1) - (a.daysSinceLastTxn ?? -1), name: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh') }
    rows.sort(by[sort] ?? by.recent)
    return { version: ctx.version, asOf: ctx.asOf, total: rows.length, rows: rows.slice(Number(offset) || 0, (Number(offset) || 0) + Math.min(1000, Number(limit) || 200)), segments: Object.keys(s.counts), flags: ctx.spec.flags.map(f => f.name) }
  }

  /** One customer: fields, where the records came from, timeline, features. Raw values: for the person only. */
  async customer(id, cid, version) {
    const ctx = await this.analysisContext(id, version)
    const e = ctx.index.get(String(cid))
    if (!e) throw new CrmError('no-customer', '找不到这个客户')
    const s = ctx.segments
    const f = featuresOf(e, ctx.asOf)
    const timeline = [
      ...e.txns.map(t => ({ kind: 'transaction', date: t.date, type: t.type, amount: t.amount, status: t.status, counted: t.counted, refund: t.refund, stale: t.stale, owner: t.owner, origin: t.origin })),
      ...e.touches.map(t => ({ kind: 'touch', date: t.date, channel: t.channel, action: t.action, campaign: t.campaign, origin: t.origin })),
      ...e.assets.map(a => ({ kind: 'asset', date: a.start, end: a.end, type: a.type, model: a.model, serial: a.serial, status: a.status, origin: a.origin })),
      ...(e.leads ?? []).map(l => ({ kind: 'lead', date: l.date, channel: l.channel, campaign: l.campaign, product: l.product, result: l.result, level: l.level, owner: l.owner, origin: l.origin })),
    ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return {
      cid: e.c.cid, code: ctx.code(e.c.cid), customer: e.c, segment: s.of.get(e.c.cid), flags: s.flagsOf.get(e.c.cid) ?? [],
      // Extra fields are stored by key; the configuration names them for people.
      extraNames: Object.fromEntries(ctx.spec.tables.flatMap(t => (t.extra ?? []).filter(x => x.entity === 'customer').map(x => [x.key, x.name ?? x.key]))),
      features: { daysSinceLastTxn: f('days_since_last_txn', []), txnCount365: f('txn_count', [365]), amount365: f('amount', [365]), daysSinceFirstSeen: f('days_since_first_seen', []), assetCount: f('asset_count', []), assetDaysToEnd: f('asset_days_to_end', []), daysSinceLastTouch: f('days_since_last_touch', []), leadCount: (e.leads ?? []).length, daysSinceLastLead: f('days_since_last_lead', []) },
      timeline,
      consentTracked: tracksConsent(ctx.spec),
      asOf: ctx.asOf,
      version: ctx.version,
    }
  }

  /**
   * Campaigns with their effect, once per data version. A campaign known only by name from touches that found
   * nobody has no one to compare; it is counted, not computed.
   */
  async campaigns(id, version) {
    const ctx = await this.analysisContext(id, version)
    ctx.campaignView ??= (() => {
      const people = withPeople(ctx)
      const list = ctx.data.campaigns.filter(c => !c.implicit || people.has(c.name))
      return { version: ctx.version, asOf: ctx.asOf, campaigns: list.map(c => ({ ...c, effect: campaignEffect(ctx.index, ctx.data, ctx.spec, c.name, ctx.asOf) })), nameOnly: ctx.data.campaigns.length - list.length }
    })()
    return ctx.campaignView
  }

  // ---- 线索 ---------------------------------------------------------------------

  /**
   * The lead page in one call: the funnel of the window (split by one dimension), the window against the one
   * before, the last 12 months, findings, and what the configuration can tell. Counts only: no names.
   */
  async leadBoard(id, { window = 90, by = null, lead = null, version } = {}) {
    const ctx = await this.analysisContext(id, version)
    if (!capabilities(ctx.spec).has('lead')) return { version: ctx.version, asOf: ctx.asOf, on: false, labels: ctx.spec.labels ?? {} }
    const f = checkLeadFilter(ctx.spec, lead)
    if (!f.ok) throw new CrmError('bad-query', f.message)
    const params = { ...(window === 'all' ? { from: '1900-01-01', to: ctx.asOf } : { window: Number(window) || 90 }), ...(Object.keys(f.filter).length ? { lead: f.filter } : {}) }
    const funnel = runQuery(ctx, 'lead_funnel', { ...params, ...(by ? { by } : {}) })
    const compare = window === 'all' ? null : runQuery(ctx, 'compare', { metric: 'leads', window: Number(window) || 90, ...(params.lead ? { lead: params.lead } : {}) })
    const pool = ctx.leads.filter(l => !params.lead || leadPasses(l, params.lead))
    return {
      version: ctx.version,
      asOf: ctx.asOf,
      on: true,
      labels: ctx.spec.labels ?? {},
      settings: leadSettings(ctx.spec),
      can: ctx.leadCan,
      dimensions: leadDimensions(ctx.spec),
      states: Object.entries(LEAD_STATES).map(([key, name]) => ({ key, name, action: ACTION_STATES.has(key) })),
      funnel,
      compare: compare && { now: compare.b.value, before: compare.a.value, changePct: compare.changePct, from: compare.b.from, to: compare.b.to },
      monthly: monthlyLeads(pool, ctx.asOf, ctx.leadCan, 12),
      insights: leadInsights(ctx.leads, ctx.spec, ctx.asOf),
      link: ctx.recon?.recon?.link?.lead ? { total: ctx.recon.recon.link.lead.total, linked: ctx.recon.recon.link.lead.linked } : null,
      merged: ctx.recon?.recon?.counts?.leadsMerged ?? 0,
      total: ctx.leads.length,
    }
  }

  /** The prepared leads a filter picks: state (Chinese name), a lead filter, a window or a text search. */
  #pickLeads(ctx, { state, lead, window, q }) {
    const f = checkLeadFilter(ctx.spec, { ...(lead ?? {}), ...(state ? { state } : {}) })
    if (!f.ok) throw new CrmError('bad-query', f.message)
    const from = window && window !== 'all' ? daysBefore(ctx.asOf, Number(window) - 1) : null
    const text = String(q ?? '').trim()
    return ctx.leads.filter(l => (!from || l.date >= from) && leadPasses(l, f.filter) && (!text || [l.extId, l.refs?.customerName, l.refs?.customerPhone, l.owner, l.rep].some(v => v && String(v).includes(text))))
  }

  /** Leads for the person's screen: raw names, newest first. */
  async leads(id, { state, lead, window, q, limit = 50, offset = 0, version } = {}) {
    const ctx = await this.analysisContext(id, version)
    if (!capabilities(ctx.spec).has('lead')) return { version: ctx.version, total: 0, rows: [], counts: {} }
    const picked = this.#pickLeads(ctx, { state, lead, window, q })
    const counts = {}
    for (const l of this.#pickLeads(ctx, { lead, window, q })) counts[LEAD_STATES[l.state]] = (counts[LEAD_STATES[l.state]] ?? 0) + 1
    // Newest first, to-dos included: the fresher a lead, the more a call is worth.
    picked.sort((a, b) => (b.at ?? b.date).localeCompare(a.at ?? a.date) || String(a.lid).localeCompare(String(b.lid)))
    const start = Math.max(0, Number(offset) || 0)
    return {
      version: ctx.version, asOf: ctx.asOf, total: picked.length, counts,
      // How many 归属方 the pick spans: an export makes one sheet for each.
      owners: new Set(picked.map(l => l.owner ?? '')).size,
      rows: picked.slice(start, start + Math.min(500, Number(limit) || 50)).map(l => leadRow(ctx, l)),
    }
  }

  // ---- 归属方 -------------------------------------------------------------------

  /** The 归属方 board for the person's screen: one row per store or dealer, and how its names line up. */
  async ownerBoard(id, { window = 90, by = null, version } = {}) {
    const ctx = await this.analysisContext(id, version)
    const label = ctx.spec.labels?.owner ?? ENTITIES.owner.name
    if (!hasOwners(ctx.data)) return { version: ctx.version, asOf: ctx.asOf, on: false, label, labels: ctx.spec.labels ?? {} }
    return { version: ctx.version, on: true, labels: ctx.spec.labels ?? {}, apart: ownersApart(ctx.data).apart, directory: (ctx.data.owners ?? []).length, ...ownerBoard(ctx, { window, by }) }
  }

  /** One 归属方 up close. */
  async ownerDetail(id, owner, { window = 90, version } = {}) {
    const ctx = await this.analysisContext(id, version)
    const d = ownerDetail(ctx, String(owner ?? ''), { window })
    if (!d) throw new CrmError('no-owner', `没有叫「${owner}」的${ctx.spec.labels?.owner ?? ENTITIES.owner.name}`)
    return { version: ctx.version, labels: ctx.spec.labels ?? {}, ...d }
  }

  /** The board to Excel in 导出/: one row per 归属方, and the roll-up when one is asked for. Numbers only. Person only. */
  exportOwnerBoard(id, { window = 90, by = null } = {}) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      if (!hasOwners(ctx.data)) throw new CrmError('no-owner', '这个数据集里没有归属方')
      const board = ownerBoard(ctx, { window, by })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(boardSheet(board)), sheetTitle(board.label))
      if (board.groups) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(boardSheet(board, board.groups, board.attributes[board.by])), sheetTitle(`按${board.attributes[board.by]}`))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['导出', localStamp()], ['数据截至', ctx.asOf], ['时间段', `${board.from} ～ ${board.to}`], ['口径', board.note]]), '说明')
      const { dir } = await this.load(id)
      await mkdir(join(dir, EXPORTS), { recursive: true })
      const path = join(dir, EXPORTS, `${folderName(board.label)}对比-${ctx.asOf}-近${window === 'all' ? '全部' : `${window}天`}.xlsx`)
      await writeFile(path, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
      return { file: path, name: path.split('/').pop(), rows: board.rows.length }
    })
  }

  /** 触达覆盖 for the person's screen: each channel overall, by segment and by 归属方. */
  async reachBoard(id, { by = null, version } = {}) {
    const ctx = await this.analysisContext(id, version)
    return { version: ctx.version, labels: ctx.spec.labels ?? {}, ...reachBoard(ctx, { by }) }
  }

  /**
   * 经营简报 to 导出/: one Word page per 归属方 in a zip, made of the board's numbers (no customer is
   * named, no model writes it). `withLeads` puts each one's late and stalled leads beside its page, in its
   * own folder, names masked. `note` is a line from the head office printed on every page. Person only.
   */
  exportOwnerBriefs(id, { window = 90, by = null, owners = null, withLeads = false, note = '' } = {}) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      if (!hasOwners(ctx.data)) throw new CrmError('no-owner', '这个数据集里没有归属方')
      const made = ownerBriefs(ctx, { window, by, owners: Array.isArray(owners) && owners.length ? owners.map(String) : null })
      if (made.briefs.length === 0) throw new CrmError('no-owner', `没有可以出简报的${made.label}`)
      const words = String(note ?? '').trim().slice(0, 400)
      const names = uniqueNames()
      const files = {}
      let leadFiles = 0
      const todo = withLeads && capabilities(ctx.spec).has('lead') ? this.#pickLeads(ctx, { state: [LEAD_STATES.late, LEAD_STATES.stalled] }).sort((a, b) => (b.at ?? b.date).localeCompare(a.at ?? a.date)) : []
      for (const b of made.briefs) {
        const name = names(folderName(b.owner))
        const md = words ? b.markdown.replace('\n## 一眼看', `\n> ${words.replace(/\n+/g, ' ')}\n\n## 一眼看`) : b.markdown
        const mine = todo.filter(l => (l.owner ?? NO_OWNER) === b.owner)
        if (withLeads) {
          files[`${name}/经营简报.docx`] = markdownToDocx(md)
          if (mine.length) { files[`${name}/待处理${folderName(ctx.spec.labels?.lead ?? '线索')}.xlsx`] = leadWorkbook(ctx, mine, { withName: false, what: `待处理 · ${b.owner}`, how: `只有「${b.owner}」的` }); leadFiles++ }
        } else files[`${name}-经营简报.docx`] = markdownToDocx(md)
      }
      const { dir } = await this.load(id)
      await mkdir(join(dir, EXPORTS), { recursive: true })
      const path = join(dir, EXPORTS, `经营简报-每个${folderName(made.label)}一份-${ctx.asOf}-近${window === 'all' ? '全部' : `${window}天`}.zip`)
      await writeFile(path, zip(files, { date: this.today() }))
      return { file: path, name: path.split('/').pop(), owners: made.briefs.length, files: Object.keys(files).length, leadFiles }
    })
  }

  /**
   * Leads to Excel in 导出/, names masked unless the person asks. `split`: `owner` one sheet per 归属方 in
   * one workbook (for whoever chases all of them); `files` one workbook per 归属方 in a zip (to hand each
   * its own and nobody else's); `none` one sheet. Person only. Returns the file to download.
   */
  exportLeads(id, { state, lead, window, q, split = 'owner', withName = false } = {}) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      if (!capabilities(ctx.spec).has('lead')) throw new CrmError('no-leads', '这个数据集没有线索数据')
      const picked = this.#pickLeads(ctx, { state, lead, window, q }).sort((a, b) => (b.at ?? b.date).localeCompare(a.at ?? a.date))
      if (picked.length === 0) throw new CrmError('no-leads', '这样筛出来没有线索')
      const ownerWord = ctx.spec.labels?.owner ?? '归属方'
      const { head, line, about: aboutLeads } = leadSheets(ctx, { withName })
      const groups = new Map()
      for (const l of picked) { const k = split === 'none' ? '线索' : l.owner ?? NO_OWNER; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l) }
      const sorted = [...groups].sort((a, b) => b[1].length - a[1].length)
      // The states in words. Late plus stalled is what every page calls 待处理; the file is named that way too.
      const stateKey = x => Object.entries(LEAD_STATES).find(([k, n]) => k === x || n === x)?.[0] ?? x
      const states = state ? [].concat(state).map(stateKey) : []
      const todo = states.length === ACTION_STATES.size && states.every(x => ACTION_STATES.has(x))
      const stateNames = states.map(x => LEAD_STATES[x] ?? x).join('、')
      const what = [states.length === 0 ? '全部状态' : todo ? `待处理（${stateNames}）` : stateNames, window && window !== 'all' ? `近 ${window} 天进来的` : '所有时间', ...Object.entries(lead ?? {}).map(([k, v]) => `${k}=${[].concat(v).join('/')}`)].join(' · ')
      const about = (n, how) => aboutLeads(n, what, how)
      const { dir } = await this.load(id)
      await mkdir(join(dir, EXPORTS), { recursive: true })
      const tag = `线索-${folderName(states.length === 0 ? '全部' : todo ? '待处理' : stateNames)}-${ctx.asOf}`
      if (split === 'files') {
        // One workbook per 归属方: each gets its own leads and nobody else's.
        const files = {}
        const names = uniqueNames()
        for (const [k, list] of sorted) files[`${names(folderName(k))}.xlsx`] = leadWorkbook(ctx, list, { withName, what, how: `只有「${k}」的` })
        const path = join(dir, EXPORTS, `${tag}-每个${folderName(ownerWord)}一份${withName ? '-带姓名' : ''}.zip`)
        await writeFile(path, zip(files, { date: this.today() }))
        return { file: path, name: path.split('/').pop(), rows: picked.length, sheets: groups.size, files: groups.size }
      }
      const wb = XLSX.utils.book_new()
      const sheetName = uniqueNames(28)
      for (const [k, list] of sorted) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...list.map(line)]), sheetName(sheetTitle(k)))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(about(picked.length, split === 'owner' ? `每个${ownerWord}一张表，可以直接发给各家跟进` : '一张表')), sheetName('说明'))
      const path = join(dir, EXPORTS, `${tag}${split === 'owner' ? `-按${folderName(ownerWord)}` : ''}${withName ? '-带姓名' : ''}.xlsx`)
      await writeFile(path, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
      return { file: path, name: path.split('/').pop(), rows: picked.length, sheets: groups.size }
    })
  }

  // ---- 待确认 -------------------------------------------------------------------

  async #pendingFile(dir) {
    const path = join(dir, PENDING)
    return (await exists(path)) ? readJson(path) : { schema: 1, proposals: [] }
  }

  /** Unknown category values of the latest version and the AI's open proposals. */
  async pending(id) {
    const { dir, state } = await this.load(id)
    const file = await this.#pendingFile(dir)
    let unknown = []
    if (await exists(join(dir, DB_FILE))) unknown = await this.reconciliation(id).then(r => r.pending).catch(() => [])
    const spec = await this.#baseSpec(dir, state).then(b => b.spec).catch(() => null)
    return {
      // Values the cleaning did not recognise, with the standard values they can be filed under.
      unknown: unknown.map(u => ({ ...u, standards: spec ? dictValues(spec, u.key) ?? [] : [] })),
      proposals: file.proposals.slice().reverse().map(p => ({ ...p, plain: plainProposal(p) })),
    }
  }

  /** The spec a change applies to: the open draft, else the finalized one. */
  async #baseSpec(dir, state) {
    const draft = await this.#draft(dir)
    if (draft) return { spec: structuredClone(draft.spec), bindings: draft.bindings, adopted: draft.adopted ?? [] }
    if (state.spec.current === null) throw new CrmError('no-spec', '配置还没定稿，先把配置聊完')
    return { spec: await readJson(join(dir, CONFIG, `v${state.spec.current}.json`)), bindings: state.bindings, adopted: [] }
  }

  /**
   * The AI proposes a dictionary entry, segment or flag. It is checked against the configuration
   * and kept in 待确认 until the person adopts (→ a config draft) or rejects it.
   */
  propose(id, proposal, { session = null } = {}) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const p = normalizeProposal(proposal)
      const { spec } = await this.#baseSpec(dir, state)
      const next = applyProposal(spec, p)
      const checked = checkSpec(next)
      if (!checked.ok) throw Object.assign(new CrmError('bad-proposal', `这条提议放进配置后有 ${checked.errors.length} 处不对：${checked.errors.slice(0, 3).map(e => `${e.path}：${e.message}`).join('；')}`), { details: { errors: checked.errors } })
      const file = await this.#pendingFile(dir)
      const entry = { id: shortId(), at: new Date().toISOString(), session, status: 'open', ...p }
      file.proposals.push(entry)
      await writeJson(join(dir, PENDING), file)
      return entry
    })
  }

  /** Adopt a proposal: it goes into a config draft the person then finalizes. Person only. */
  adoptProposal(id, proposalId) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const file = await this.#pendingFile(dir)
      const p = file.proposals.find(x => x.id === String(proposalId))
      if (!p || p.status !== 'open') throw new CrmError('no-proposal', '这条提议已经处理过了')
      const base = await this.#baseSpec(dir, state)
      const saved = await this.#saveDraft(id, applyProposal(base.spec, p), { adopted: [...base.adopted, p.id] })
      p.status = 'adopted'
      p.revision = saved.revision
      await writeJson(join(dir, PENDING), file)
      return { revision: saved.revision, summary: saved.summary }
    })
  }

  /** Reject a proposal. Person only. */
  rejectProposal(id, proposalId) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const file = await this.#pendingFile(dir)
      const p = file.proposals.find(x => x.id === String(proposalId))
      if (!p || p.status !== 'open') throw new CrmError('no-proposal', '这条提议已经处理过了')
      p.status = 'rejected'
      await writeJson(join(dir, PENDING), file)
      return { rejected: p.id }
    })
  }

  /** The person maps an unknown value to a standard value (or makes it one): straight into a config draft. */
  mapUnknown(id, key, raw, standard) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const std = String(standard ?? '').trim()
      const value = String(raw ?? '').trim()
      if (!std || !value) throw new CrmError('bad-map', '要选一个标准值')
      const p = normalizeProposal({ kind: 'dictionary', dictionary: key, value: std, variants: std === value ? [] : [value], reason: '用户在「待确认」里归类' })
      const base = await this.#baseSpec(dir, state)
      const saved = await this.#saveDraft(id, applyProposal(base.spec, p), { adopted: base.adopted })
      return { revision: saved.revision, summary: saved.summary }
    })
  }

  /** An exported file as base64, for the browser to save. Only files in the dataset's 导出 folder. */
  async download(id, file) {
    const { dir } = await this.load(id)
    const path = resolve(String(file ?? ''))
    if (!path.startsWith(join(dir, EXPORTS) + sep)) throw new CrmError('bad-file', '只能下载导出文件夹里的文件')
    if (!(await exists(path))) throw new CrmError('no-file', '这个导出文件已经不在了，重新导出一次')
    return { name: basename(path), base64: (await readFile(path)).toString('base64') }
  }

  // ---- 报告 ---------------------------------------------------------------------

  async #reportDir(dir, name) {
    const folder = folderName(name)
    if (folder !== String(name)) throw new CrmError('no-report', '找不到这份报告')
    const path = join(dir, REPORTS, folder)
    if (!(await exists(join(path, REPORT_INDEX)))) throw new CrmError('no-report', '找不到这份报告')
    return path
  }

  /** Every report of a dataset with its draft and finalized versions. */
  async reports(id) {
    const { dir } = await this.load(id)
    const root = join(dir, REPORTS)
    if (!(await exists(root))) return []
    const out = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !(await exists(join(root, entry.name, REPORT_INDEX)))) continue
      const idx = await readJson(join(root, entry.name, REPORT_INDEX))
      out.push({ name: entry.name, title: idx.title, createdAt: idx.createdAt, draft: idx.draft, versions: idx.versions })
    }
    return out.sort((a, b) => (b.draft?.at ?? b.versions.at(-1)?.at ?? '').localeCompare(a.draft?.at ?? a.versions.at(-1)?.at ?? ''))
  }

  /** One report: the draft (source, rendered preview, problems) and its finalized versions. */
  async report(id, name) {
    const { dir } = await this.load(id)
    const path = await this.#reportDir(dir, name)
    const idx = await readJson(join(path, REPORT_INDEX))
    let draft = null
    if (idx.draft && (await exists(join(path, '草稿.md')))) {
      const body = await readFile(join(path, '草稿.md'), 'utf8')
      const frozen = await readJson(join(path, '草稿.数据.json'))
      draft = { ...idx.draft, body, preview: render(untitled(body), frozen.refs), marked: renderMarked(untitled(body), frozen.refs), refs: Object.keys(frozen.refs), asOf: frozen.asOf, version: frozen.version }
    }
    return { name, title: idx.title, draft, versions: idx.versions }
  }

  /** A finalized version's text (numbers frozen). */
  async reportVersion(id, name, version) {
    const { dir } = await this.load(id)
    const path = await this.#reportDir(dir, name)
    const v = Number(version)
    if (!(await exists(join(path, `v${v}.md`)))) throw new CrmError('no-version', '没有这个定稿版本')
    return { name, version: v, text: await readFile(join(path, `v${v}.md`), 'utf8'), data: await readJson(join(path, `v${v}.数据.json`)) }
  }

  /** Check a draft body: references resolve, every other number has a reason to be there. */
  async #checkDraft(id, dir, body) {
    const log = new Map((await this.queryLog(id)).map(q => [`q${q.n}`, q]))
    const { refs, problems } = resolveRefs(body, log)
    const ctx = await this.analysisContext(id)
    const spec = ctx.spec
    const names = [
      ...spec.segments.map(x => x.name), ...spec.flags.map(x => x.name), '其他',
      ...Object.values(spec.dictionaries ?? {}).flatMap(d => Object.entries(d).flatMap(([k, v]) => [k, ...v])),
      ...ctx.data.campaigns.map(c => c.name), ...ctx.data.customers.map(c => c.owner).filter(Boolean), ...(ctx.data.owners ?? []).map(o => o.name),
      ...Object.values(spec.labels ?? {}), ...(spec.report?.sections ?? []).map(x => x.title),
    ].filter(Boolean)
    const numberProblems = checkNumbers(body.replace(/\bK[0-9A-F]{8}\b/g, m => ' '.repeat(m.length)), { names, allowed: allowedNumbers(spec, refs) })
    return { refs, problems: [...problems, ...numberProblems], ctx }
  }

  /**
   * Save a report draft. References are resolved and frozen next to it; problems
   * (unknown references, numbers without a source) are returned and block finalizing.
   * `by` is 'ai' from the analyst mode or 'person' from the editor.
   */
  saveReportDraft(id, { title, body, name }, { session = null, by = 'ai' } = {}) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const text = String(body ?? '').replace(/\r\n/g, '\n').trim()
      if (text === '' || text.length > REPORT_TEXT) throw new CrmError('bad-report', `报告正文要有 1～${REPORT_TEXT} 个字`)
      let folder
      let idx
      if (name) {
        const path = await this.#reportDir(dir, String(name))
        folder = String(name)
        idx = await readJson(join(path, REPORT_INDEX))
      } else {
        const t = String(title ?? '').trim()
        if (t === '' || [...t].length > 60) throw new CrmError('bad-report', '报告标题要有 1～60 个字')
        folder = folderName(t)
        const path = join(dir, REPORTS, folder)
        idx = (await exists(join(path, REPORT_INDEX))) ? await readJson(join(path, REPORT_INDEX)) : { title: t, createdAt: new Date().toISOString(), draft: null, versions: [] }
        await mkdir(path, { recursive: true })
      }
      const path = join(dir, REPORTS, folder)
      const { refs, problems, ctx } = await this.#checkDraft(id, dir, text)
      const versions = Object.values(refs).map(r => r.version)
      const version = versions.length ? Math.max(...versions) : ctx.version
      const revision = (idx.draft?.revision ?? idx.lastRevision ?? 0) + 1
      await writeFile(join(path, '草稿.md'), `${text}\n`, 'utf8')
      await writeJson(join(path, '草稿.数据.json'), { revision, version, asOf: ctx.version === version ? ctx.asOf : Object.values(refs).find(r => r.version === version)?.asOf ?? ctx.asOf, specVersion: ctx.data.specVersion, reviewOpen: ctx.review?.open ?? 0, refs })
      idx.draft = { revision, at: new Date().toISOString(), session, by, problems }
      idx.lastRevision = revision
      if (title && name) idx.title = String(title).trim().slice(0, 60) || idx.title
      await writeJson(join(path, REPORT_INDEX), idx)
      return { name: folder, title: idx.title, revision, problems, refs: Object.keys(refs) }
    })
  }

  /** Finalize the draft the person looked at: numbers rendered, 口径 appended, both frozen. Person only. */
  finalizeReport(id, name, revision) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const path = await this.#reportDir(dir, String(name))
      const idx = await readJson(join(path, REPORT_INDEX))
      if (!idx.draft) throw new CrmError('no-draft', '这份报告没有草稿')
      if (Number(revision) !== idx.draft.revision) throw new CrmError('stale-draft', '草稿刚刚又改过了，请看一眼最新的再定稿')
      if (idx.draft.problems.length > 0) throw new CrmError('report-problems', `草稿里还有 ${idx.draft.problems.length} 个数字没有出处，改好或删掉再定稿`)
      const body = await readFile(join(path, '草稿.md'), 'utf8')
      const frozen = await readJson(join(path, '草稿.数据.json'))
      const spec = await readJson(join(dir, CONFIG, `v${frozen.specVersion}.json`))
      const v = (idx.versions.at(-1)?.version ?? 0) + 1
      // The body may already open with the title as its heading; the version gets it once.
      const own = untitled(body)
      const text = `# ${idx.title}\n\n${render(own, frozen.refs)}\n${appendix(spec, { asOf: frozen.asOf, version: frozen.version, reviewOpen: frozen.reviewOpen, refs: frozen.refs })}\n`
      await writeFile(join(path, `v${v}.md`), text, 'utf8')
      await writeJson(join(path, `v${v}.数据.json`), { ...frozen, finalizedAt: new Date().toISOString() })
      await rename(join(path, '草稿.md'), join(path, `v${v}.草稿.md`))
      await rename(join(path, '草稿.数据.json'), join(path, `草稿-r${frozen.revision}-已定稿.数据.json`))
      idx.versions.push({ version: v, at: new Date().toISOString(), revision: idx.draft.revision, dataVersion: frozen.version, asOf: frozen.asOf })
      idx.draft = null
      await writeJson(join(path, REPORT_INDEX), idx)
      return { name, version: v }
    })
  }

  /** Throw a draft away (kept as a file). Person only. */
  discardReportDraft(id, name) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const path = await this.#reportDir(dir, String(name))
      const idx = await readJson(join(path, REPORT_INDEX))
      if (!idx.draft) throw new CrmError('no-draft', '这份报告没有草稿')
      await rename(join(path, '草稿.md'), join(path, `草稿-r${idx.draft.revision}-已丢弃.md`))
      idx.draft = null
      await writeJson(join(path, REPORT_INDEX), idx)
      return { discarded: true }
    })
  }

  /** Export a finalized version to 导出/ as md, docx or xlsx (the cited tables). Person only. */
  exportReport(id, name, version, format) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const path = await this.#reportDir(dir, String(name))
      const idx = await readJson(join(path, REPORT_INDEX))
      const v = Number(version ?? idx.versions.at(-1)?.version)
      if (!(await exists(join(path, `v${v}.md`)))) throw new CrmError('no-version', '先定稿，再导出')
      const text = await readFile(join(path, `v${v}.md`), 'utf8')
      const data = await readJson(join(path, `v${v}.数据.json`))
      await mkdir(join(dir, EXPORTS), { recursive: true })
      const base = `${folderName(idx.title)}-v${v}`
      let file
      if (format === 'md') {
        file = join(dir, EXPORTS, `${base}.md`)
        await writeFile(file, text, 'utf8')
      } else if (format === 'docx') {
        file = join(dir, EXPORTS, `${base}.docx`)
        await writeFile(file, markdownToDocx(text))
      } else if (format === 'xlsx') {
        file = join(dir, EXPORTS, `${base}.xlsx`)
        const wb = XLSX.utils.book_new()
        const summary = [['报告', idx.title], ['定稿版本', v], ['数据截止日', data.asOf], ['数据版本', data.version], [], ['引用', '查询', '说明']]
        const tables = resultTables(data.refs)
        for (const t of tables) summary.push([t.ref, t.title, ''])
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), '说明')
        const used = new Set(['说明'])
        for (const t of tables) {
          let sheet = t.title.replace(/[\\/?*[\]:]/g, '-').slice(0, 31)
          while (used.has(sheet)) sheet = `${sheet.slice(0, 28)}-${used.size}`
          used.add(sheet)
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.rows), sheet)
        }
        await writeFile(file, Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))
      } else throw new CrmError('bad-format', '只能导出 md、docx、xlsx')
      return { file, name: file.split('/').pop() }
    })
  }

  // ---- 名单 ---------------------------------------------------------------------

  async #listsFile(dir) {
    const path = join(dir, LISTS)
    return (await exists(path)) ? { ...emptyLists(), ...(await readJson(path)) } : emptyLists()
  }

  #pick(ctx, input = {}) {
    const pick = {}
    const segNames = [...ctx.spec.segments.map(x => x.name), '其他']
    if (input.segment) { if (!segNames.includes(String(input.segment))) throw new CrmError('bad-pick', '没有这个分层'); pick.segment = String(input.segment) }
    if (input.flag) { if (!ctx.spec.flags.some(f => f.name === String(input.flag))) throw new CrmError('bad-pick', '没有这个标记'); pick.flag = String(input.flag) }
    const without = withoutOf(ctx.spec, input.without)
    if (without) pick.without = without
    if (input.owner) pick.owner = String(input.owner)
    if (input.was) { if (![...segNames, NEW_ARRIVAL].includes(String(input.was))) throw new CrmError('bad-pick', '30 天前没有这一层'); pick.was = String(input.was) }
    if (Array.isArray(input.cids)) {
      pick.cids = [...new Set(input.cids.map(String))].slice(0, LIST_LIMIT)
      if (pick.cids.length === 0) throw new CrmError('bad-pick', '没有选人')
    }
    return pick
  }

  /** The goal of a list as asked, or the one its pick implies; a wrong tag name is the caller's error. */
  #goal(ctx, pick, asked) {
    try { return goalOf(ctx.spec, pick, asked) } catch (e) { if (e.code === 'bad-goal') throw new CrmError('bad-goal', e.message); throw e }
  }

  /** What a new list would hold, for the 生成名单 sheet. Names for the person's screen only. */
  async listPool(id, input = {}) {
    const ctx = await this.analysisContext(id)
    const { dir } = await this.load(id)
    const file = await this.#listsFile(dir)
    const pick = this.#pick(ctx, input)
    const purpose = input.purpose ? String(input.purpose) : suggestPurpose(ctx.spec, pick)
    const pool = poolOf(ctx, file, ctx.spec, { ...pick, purpose, today: this.today() })
    const goal = this.#goal(ctx, pick, input.goal)
    return {
      purpose,
      purposes: ctx.spec.lists?.purposes ?? [],
      // What the list is judged by: a tag the people gain by a later import, or (null) a transaction.
      goal: goal && { flags: goal.flags, text: goalText(goal) },
      flags: ctx.spec.flags.map(f => f.name),
      name: batchName(purpose, pick, pool.kept.length),
      match: pool.match,
      kept: pool.kept.length,
      excluded: Object.fromEntries(Object.entries(pool.excluded).map(([k, v]) => [k, v.length])),
      leftTotal: Object.keys(file.left).length,
      consent: pool.consent,
      byOwner: pool.byOwner,
      preview: pool.kept.slice(0, 8).map(cid => { const c = ctx.index.get(cid).c; return { cid, id: c.id, name: c.name, owner: c.owner, segment: ctx.segments.of.get(cid) } }),
      followDays: ctx.spec.lists?.followDays ?? 14,
      workshop: Boolean(this.workshopAvailable?.()),
    }
  }

  /**
   * Make a list (person only). `to` is 'workshop' (pushed by the host right after) or 'excel'
   * (an .xlsx in 导出/, phone numbers only when the person ticks withPhone).
   */
  createBatch(id, { pick: input, purpose, dueDays, to = 'excel', withPhone = false, source = null, split = 'none', goal: askedGoal } = {}) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const pick = this.#pick(ctx, input)
      if (!['workshop', 'excel'].includes(to)) throw new CrmError('bad-target', '只能推到平台工坊或导出 Excel')
      const why = String(purpose ?? '').trim() || suggestPurpose(ctx.spec, pick)
      const days = Number(dueDays ?? ctx.spec.lists?.followDays ?? 14)
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new CrmError('bad-due', '联系完的期限是 1～90 天')
      const today = this.today()
      const pool = poolOf(ctx, file, ctx.spec, { ...pick, purpose: why, today })
      if (pool.kept.length === 0) throw new CrmError('empty-list', '没有能进名单的人')
      const goal = goalAtCreation(ctx, file, this.#goal(ctx, pick, askedGoal), pool.kept)
      file.seq += 1
      const b = {
        id: `B${file.seq}`, name: batchName(why, pick, pool.kept.length), purpose: why, createdAt: today, due: daysBefore(today, -days), asOf: ctx.asOf, dataVersion: ctx.version, to,
        source: { ...pick, cids: pick.cids ? pick.cids.length : undefined, label: source ? String(source).slice(0, 60) : null },
        byOwner: Object.fromEntries(pool.byOwner),
        excluded: Object.fromEntries(Object.entries(pool.excluded).map(([k, v]) => [k, v.length])),
        members: pool.kept.map(cid => { const c = ctx.index.get(cid).c; return { cid, code: ctx.code(cid), sideKeys: c.sideKeys, name: c.name, owner: c.owner ?? null, segment: ctx.segments.of.get(cid), outcome: null, at: null, by: null } }),
        ...(goal ? { goal } : {}),
      }
      file.batches.unshift(b)
      await writeJson(join(dir, LISTS), file)
      let exported = null
      if (to === 'excel') exported = await this.#exportBatchFile(dir, file, b, ctx, { withPhone, split })
      return { id: b.id, name: b.name, people: b.members.length, byOwner: b.byOwner, exported, goal: goal ? { flags: goal.flags, text: goalText(goal), compare: goal.control.length } : null }
    })
  }

  /**
   * A list to 导出/. `split: 'owner'` writes one workbook per 归属方 into a zip, so each store or dealer
   * gets its own people and nobody else's; otherwise one workbook with everyone and a 归属方 column.
   */
  async #exportBatchFile(dir, file, b, ctx, { withPhone, split = 'none' }) {
    const resolve = memberIndex(ctx.data)
    // The source system's own id (customer.id), so a list can be taken back to the system the data came from.
    const withSourceId = ctx.spec.tables.some(t => t.entities?.customer?.id)
    const ownerWord = ctx.spec.labels?.owner ?? '归属'
    const head = ['客户编号', ...(withSourceId ? ['原系统编号'] : []), '姓名', ...(withPhone ? ['手机'] : []), '现在在哪一层', ownerWord, '原因', '联系完', '结果（联系后填）']
    const line = m => {
      const cid = resolve(m)
      const c = cid ? ctx.index.get(cid).c : null
      return [m.code, ...(withSourceId ? [c?.id ?? ''] : []), withPhone ? (c?.name ?? m.name ?? '') : maskName(c?.name ?? m.name ?? ''), ...(withPhone ? [c?.phone ?? ''] : []), cid ? ctx.segments.of.get(cid) ?? '' : '', m.owner ?? '', b.purpose, b.due, '']
    }
    const about = (n, who) => [['名单', b.name], ...(who ? [[ownerWord, who]] : []), ['生成', b.createdAt], ['联系完', b.due], ['人数', n], ['结果可以填', outcomesOf(ctx.spec).list.map(o => o.name).join('、')], ['说明', withPhone ? '这份表带手机号，请只发给要打电话的人。' : '这份表只带客户编号和遮过的姓名；要手机号请在客户运营台勾选「带上手机号」重新导出。'], ...(withSourceId ? [['原系统编号', '这一列是数据来源系统里的客户编号。表里没有联系方式时，拿这一列回原系统按它的流程申请。']] : [])]
    const book = (members, who) => {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...members.map(line)]), '名单')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(about(members.length, who)), '说明')
      return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    }
    await mkdir(join(dir, EXPORTS), { recursive: true })
    const base = `名单-${folderName(b.name)}-${b.createdAt}`
    let path
    let files = 1
    if (split === 'owner') {
      const groups = new Map()
      for (const m of b.members) { const k = m.owner ?? NO_OWNER; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m) }
      const names = uniqueNames()
      const out = {}
      for (const [k, list] of [...groups].sort((x, y) => y[1].length - x[1].length)) out[`${names(folderName(k))}.xlsx`] = book(list, k)
      files = groups.size
      path = join(dir, EXPORTS, `${base}-每个${folderName(ownerWord)}一份${withPhone ? '-带手机号' : ''}.zip`)
      await writeFile(path, zip(out, { date: this.today() }))
    } else {
      path = join(dir, EXPORTS, `${base}${withPhone ? '-带手机号' : ''}.xlsx`)
      await writeFile(path, book(b.members, null))
    }
    b.exported = { file: path, withPhone: Boolean(withPhone), at: new Date().toISOString(), ...(split === 'owner' ? { files } : {}) }
    await writeJson(join(dir, LISTS), file)
    return { file: path, name: path.split('/').pop(), withPhone: Boolean(withPhone), files }
  }

  exportBatch(id, batchId, { withPhone = false, split = 'none' } = {}) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const b = file.batches.find(x => x.id === String(batchId))
      if (!b) throw new CrmError('no-batch', '找不到这份名单')
      return this.#exportBatchFile(dir, file, b, ctx, { withPhone, split })
    })
  }

  /** All lists with their results, who left, transfers waiting. */
  async lists(id) {
    const { dir } = await this.load(id)
    const file = await this.#listsFile(dir)
    if (file.batches.length === 0 && !(await exists(join(dir, DB_FILE)))) return { batches: [], left: 0, transfers: 0, streaks: 0 }
    const ctx = await this.analysisContext(id)
    const today = this.today()
    const batches = file.batches.map(b => { const v = batchView(b, file, ctx, ctx.spec, today); delete v.members; return v })
    return {
      batches,
      running: batches.filter(b => b.status === 'running' || b.status === 'exported').length,
      runningPeople: batches.filter(b => b.status === 'running' || b.status === 'exported').reduce((a, b) => a + b.people, 0),
      left: Object.keys(file.left).length,
      transfers: file.transfers.filter(t => t.status === 'open').length,
      streaks: unreachableStreaks(file, ctx.spec, memberIndex(ctx.data)).length,
      // A list with a goal counts the people the data confirmed on a line of its own; one name serves the page.
      outcomes: [...outcomesOf(ctx.spec).list.map(o => ({ ...o, then: consequence(o.code, ctx.spec) })), ...(file.batches.some(b => b.goal) ? [{ ...goalOutcome(file.batches.find(b => b.goal).goal), name: '带上了（数据确认）' }] : [])],
    }
  }

  /** One list with every member (raw names and phones: for the person only). */
  async batch(id, batchId) {
    const { dir } = await this.load(id)
    const file = await this.#listsFile(dir)
    const b = file.batches.find(x => x.id === String(batchId))
    if (!b) throw new CrmError('no-batch', '找不到这份名单')
    const ctx = await this.analysisContext(id)
    const v = batchView(b, file, ctx, ctx.spec, this.today())
    v.members = v.members.map(m => ({ ...m, id: m.cid ? ctx.index.get(m.cid)?.c.id ?? null : null, phone: m.cid ? ctx.index.get(m.cid)?.c.phone ?? null : null, nameNow: m.cid ? ctx.index.get(m.cid)?.c.name ?? m.name : m.name, then: consequence(m.outcome, ctx.spec, b.goal) }))
    v.outcomes = [...outcomesOf(ctx.spec).list.map(o => ({ ...o, then: consequence(o.code, ctx.spec, b.goal) })), ...(b.goal ? [goalOutcome(b.goal)] : [])]
    return v
  }

  /** Apply one result to a member, with its consequence. Shared by the person's click and the 平台工坊 sync. */
  #applyOutcome(file, b, m, outcome, { at, by }, spec, cid) {
    const { byCode } = outcomesOf(spec)
    if (outcome !== null && !byCode.has(outcome)) throw new CrmError('bad-outcome', `结果只能是：${[...byCode.values()].map(o => o.name).join('、')}`)
    if (m.outcome === outcome) return false
    m.outcome = outcome
    m.at = outcome === null ? null : at
    m.by = outcome === null ? null : by
    const kind = outcome === null ? null : byCode.get(outcome).kind
    const restored = (file.restored[cid] ?? []).includes(b.id)
    if (kind === 'leave' && cid && !file.left[cid] && !restored) file.left[cid] = { why: byCode.get(outcome).name, at, via: { batch: b.id, by }, name: m.name }
    if (kind === 'transfer' && cid && !file.left[cid] && !file.transfers.some(t => t.batch === b.id && t.cid === cid)) file.transfers.push({ id: shortId(), cid, batch: b.id, at, status: 'open', name: m.name, by })
    return true
  }

  /** The person records a result (or clears it with null). */
  setOutcome(id, batchId, cid, outcome) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const b = file.batches.find(x => x.id === String(batchId))
      if (!b) throw new CrmError('no-batch', '找不到这份名单')
      const resolve = memberIndex(ctx.data)
      const m = b.members.find(x => x.cid === String(cid) || resolve(x) === String(cid))
      if (!m) throw new CrmError('no-member', '这个人不在这份名单里')
      this.#applyOutcome(file, b, m, outcome === null || outcome === '' ? null : String(outcome), { at: this.today(), by: 'person' }, ctx.spec, resolve(m))
      await writeJson(join(dir, LISTS), file)
      return { batch: b.id, cid: m.cid, outcome: m.outcome, then: consequence(m.outcome, ctx.spec) }
    })
  }

  /** Results reported by 平台工坊, by customer code. Returns how many changed. */
  syncOutcomes(id, batchId, rows) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const b = file.batches.find(x => x.id === String(batchId))
      if (!b) throw new CrmError('no-batch', '找不到这份名单')
      const resolve = memberIndex(ctx.data)
      const byCode = new Map(b.members.map(m => [m.code, m]))
      const known = outcomesOf(ctx.spec).byCode
      let changed = 0
      for (const r of Array.isArray(rows) ? rows : []) {
        const m = byCode.get(String(r.ref ?? ''))
        if (!m || m.by === 'person') continue
        const outcome = r.outcome && known.has(r.outcome) ? r.outcome : null
        if (this.#applyOutcome(file, b, m, outcome, { at: String(r.at ?? this.today()).slice(0, 10), by: 'workshop' }, ctx.spec, resolve(m))) changed++
      }
      b.workshop = { ...(b.workshop ?? {}), syncedAt: new Date().toISOString() }
      await writeJson(join(dir, LISTS), file)
      return { changed }
    })
  }

  /** Remember that a list went to 平台工坊. */
  markPushed(id, batchId, info) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const b = file.batches.find(x => x.id === String(batchId))
      if (!b) throw new CrmError('no-batch', '找不到这份名单')
      b.workshop = { ...info, pushedAt: new Date().toISOString() }
      await writeJson(join(dir, LISTS), file)
      return b.workshop
    })
  }

  /** Rows to push to 平台工坊 for a list: code, name, and the phone only when the person ticked it. */
  async pushRows(id, batchId, { withPhone = false } = {}) {
    const ctx = await this.analysisContext(id)
    const { dir } = await this.load(id)
    const file = await this.#listsFile(dir)
    const b = file.batches.find(x => x.id === String(batchId))
    if (!b) throw new CrmError('no-batch', '找不到这份名单')
    const resolve = memberIndex(ctx.data)
    const ownerLabel = ctx.spec.labels?.owner ?? '归属'
    return {
      batch: { id: b.id, name: b.name, purpose: b.purpose, due: b.due, createdAt: b.createdAt, outcomes: outcomesOf(ctx.spec).list.map(o => ({ code: o.code, name: o.name })) },
      rows: b.members.map(m => {
        const cid = resolve(m)
        const c = cid ? ctx.index.get(cid).c : null
        return { ref: m.code, title: c?.name ?? m.name ?? m.code, values: { 姓名: c?.name ?? m.name ?? '', ...(withPhone && c?.phone ? { 手机: c.phone } : {}), 客户编号: m.code, 分层: cid ? ctx.segments.of.get(cid) ?? '' : '', [ownerLabel]: m.owner ?? '', 原因: b.purpose, 联系完: b.due } }
      }),
    }
  }

  /** Stop a list early. Person only. */
  closeBatch(id, batchId) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const b = file.batches.find(x => x.id === String(batchId))
      if (!b) throw new CrmError('no-batch', '找不到这份名单')
      b.closedAt = new Date().toISOString()
      await writeJson(join(dir, LISTS), file)
      return { closed: b.id }
    })
  }

  /** Transfers waiting for the person, with names (person only). */
  async transfers(id) {
    const { dir } = await this.load(id)
    const file = await this.#listsFile(dir)
    return file.transfers.filter(t => t.status === 'open').map(t => ({ ...t, batchName: file.batches.find(b => b.id === t.batch)?.name ?? t.batch }))
  }

  /** Confirm a transfer: the person moves to 已离开. Reject: no consequence. Person only. */
  decideTransfer(id, transferId, confirm) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const t = file.transfers.find(x => x.id === String(transferId))
      if (!t || t.status !== 'open') throw new CrmError('no-transfer', '这一条已经处理过了')
      t.status = confirm ? 'confirmed' : 'rejected'
      t.decidedAt = this.today()
      if (confirm) file.left[t.cid] = { why: '转手', at: this.today(), via: { batch: t.batch, by: 'person' }, name: t.name }
      await writeJson(join(dir, LISTS), file)
      return { id: t.id, status: t.status }
    })
  }

  /** Move a customer to 已离开 by hand. Person only. */
  leave(id, cid, why) {
    return this.mutate(async () => {
      const ctx = await this.analysisContext(id)
      const { dir } = await this.load(id)
      const e = ctx.index.get(String(cid))
      if (!e) throw new CrmError('no-customer', '找不到这个客户')
      const file = await this.#listsFile(dir)
      file.left[e.c.cid] = { why: String(why ?? '').trim().slice(0, 40) || '不要再联系', at: this.today(), via: { by: 'person' }, name: e.c.name }
      await writeJson(join(dir, LISTS), file)
      return { cid: e.c.cid, left: file.left[e.c.cid] }
    })
  }

  /** Bring a customer back from 已离开. A later sync of the same list does not move them out again. Person only. */
  unleave(id, cid) {
    return this.mutate(async () => {
      const { dir } = await this.load(id)
      const file = await this.#listsFile(dir)
      const entry = file.left[String(cid)]
      if (!entry) throw new CrmError('not-left', '这个人不在「已离开」里')
      delete file.left[String(cid)]
      if (entry.via?.batch) file.restored[String(cid)] = [...new Set([...(file.restored[String(cid)] ?? []), entry.via.batch])]
      await writeJson(join(dir, LISTS), file)
      return { cid: String(cid), restored: true }
    })
  }

  /** Everyone in 已离开 (names: person only). */
  async leftList(id) {
    const { dir } = await this.load(id)
    const file = await this.#listsFile(dir)
    return Object.entries(file.left).map(([cid, v]) => ({ cid, ...v })).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  }

  /** A customer's list history and whether they can go into a new list. */
  async customerLists(id, cid) {
    const ctx = await this.analysisContext(id)
    const { dir } = await this.load(id)
    const file = await this.#listsFile(dir)
    const resolve = memberIndex(ctx.data)
    const { byCode } = outcomesOf(ctx.spec)
    const history = file.batches.flatMap(b => b.members.filter(m => resolve(m) === String(cid)).map(m => ({ batch: b.id, name: b.name, purpose: b.purpose, createdAt: b.createdAt, outcome: m.outcome, outcomeName: m.outcome ? byCode.get(m.outcome)?.name ?? m.outcome : null, at: m.at, by: m.by, then: consequence(m.outcome, ctx.spec) })))
    return { history, left: file.left[String(cid)] ?? null, block: blockOf(String(cid), file, { purpose: null, today: this.today(), spec: ctx.spec, resolve }) }
  }

  /** Move a source's original and profile to 回收站; nothing is deleted. */
  removeSource(id, sourceId) {
    return this.mutate(async () => {
      const { dir, state } = await this.load(id)
      const index = state.sources.findIndex(s => s.id === sourceId)
      if (index < 0) throw new CrmError('no-source', '找不到这个数据源')
      const [source] = state.sources.splice(index, 1)
      state.bindings = state.bindings.filter(b => b.source !== source.id)
      const bin = join(dir, TRASH, `${new Date().toISOString().replace(/[:.]/g, '-')}-${source.id}`)
      await mkdir(bin, { recursive: true })
      await rename(join(dir, ORIGINALS, source.stored), join(bin, source.stored))
      if (await exists(join(dir, PROFILES, `${source.id}.json`))) await rename(join(dir, PROFILES, `${source.id}.json`), join(bin, '体检.json'))
      await writeJson(join(dir, MARKER), state)
      return { removed: source.id }
    })
  }

  async #readSheets(dir, source) {
    const bytes = await readFile(join(dir, ORIGINALS, source.stored))
    if (source.kind === 'feishu') {
      const snap = JSON.parse(bytes.toString('utf8'))
      return snap.sheets.map(s => ({ ...s, filled: new Set(), formulaColumns: s.columns.map((c, i) => (COMPUTED_KINDS.includes(c.kind) ? i : -1)).filter(i => i >= 0), headerRow: 0 }))
    }
    return readFileBytes(source.name, new Uint8Array(bytes)).sheets
  }
}

const sheetSummary = p => ({
  headerRow: p.header.row,
  rows: p.rows.kept,
  columns: p.columns.length,
  detail: p.detail,
  list: p.list ?? null,
  blocks: p.warnings.filter(w => w.level === 'block').length,
  checks: p.warnings.filter(w => w.level === 'check').length,
})

/**
 * A copy that JSON carries exactly: no undefined properties, no NaN/Infinity, no -0. The tool
 * channel rejects anything JSON.stringify would silently change, and refs must read back the same.
 */
export function lossless(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null
  if (Array.isArray(value)) return value.map(v => (v === undefined ? null : lossless(v)))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== 'function') out[k] = lossless(v)
    return out
  }
  return value
}

/**
 * The latest date that already happened, across a dataset's sheets. Columns that run past
 * today hold plans (保修到期、结课日期), not events, so they do not count; if every date
 * column runs into the future, today is the best guess.
 */
export function suggestAsOf(state, profiles, now = today()) {
  const ends = profiles.flatMap(p => p.columns.filter(c => c.kind === 'date' && !c.computed && c.range).map(c => c.range[1]))
  const dates = ends.filter(d => d <= now)
  if (dates.length === 0 && ends.length) dates.push(now)
  if (state.asOf && state.asOf <= now) dates.push(state.asOf)
  return dates.length ? dates.sort().at(-1) : null
}


/** What to do at each setup step, in the person's words. */
const NEXT_BROKEN = '清洗跑完了，但结果看起来不对（data.problems 里逐条写了：有表大半行没进来、只有姓名的表把客户数撑大了，或者有表的行大半没挂上客户）：先读现在的配置，只改出问题的表，交一版草案看试跑结果（trial），用户定稿后再运行清洗。确实就该这样（这些人本来就不在客户表里）就请用户点「先这样用」'
const NEXT_PRESET = '这批表预设认识，不用从头配：直接按预设起草（数据源页的「按预设直接起草」，或者跟助手说一声），看一眼试跑结果，定稿后运行清洗'
const NEXT_RESHAPED = '新导入的表和定稿的配置对不上（配置里的表没有数据了，新表又对不上任何一张）：按新表重新起草配置，用户定稿后再运行清洗'
export const NEXT = Object.freeze({
  import: '导入客户表和交易表（Excel、CSV 或飞书多维表格）',
  check: '看一遍体检结果，勾掉不用的表，点「这些表能用」',
  cutoff: '确认数据截止日：这批数据导出到哪一天',
  config: '和 AI 聊一聊，把列、取值和分层配置好，然后定稿',
  build: '运行清洗和合并，看对账结果',
  review: '复核拿不准的合并和关联，或者先跳过（没确认的当成不同的人）',
  ready: '数据准备好了，可以看分析、出名单',
})

const emptySpecState = () => ({ current: null, versions: [], draftRevision: 0 })

/** Schema 1 → 2: datasets learn configurations and table bindings. */
function migrate1(state) {
  state.schema = 2
  state.bindings ??= []
  state.spec ??= emptySpecState()
}

async function appendLog(dir, entries) {
  if (entries.length === 0) return
  await appendFile(join(dir, MERGE_LOG), entries.map(e => `${JSON.stringify(e)}\n`).join(''), 'utf8')
}

const pick = m => ({ name: m.name, unit: m.unit, value: m.value, from: m.from, to: m.to })

/** Campaign names that some customer is linked to through a touch: the ones a comparison can be made for. */
const withPeople = ctx => (ctx.campaignPeople ??= new Set(ctx.data.touches.filter(t => t.campaign && t.cid).map(t => t.campaign)))

/** One prepared lead for the person's screen (raw name; never for a model). */
function leadRow(ctx, l) {
  const last = [l.lastFollow, l.firstFollow].filter(Boolean).sort().at(-1) ?? null
  return {
    lid: l.lid, extId: l.extId, date: l.date, at: l.at ? l.at.replace('T', ' ') : null, name: l.refs?.customerName ?? (l.cid ? ctx.index.get(l.cid)?.c.name ?? null : null),
    owner: l.owner, rep: l.rep, channel: l.channel, source: l.source, campaign: l.campaign, product: l.product, level: l.level, trial: l.trial, result: l.result,
    state: LEAD_STATES[l.state], action: ACTION_STATES.has(l.state), firstFollow: l.firstFollow, lastFollow: l.lastFollow, hours: l.hours,
    quietDays: last ? daysBetween(last, ctx.asOf) : null, ageDays: daysBetween(l.date, ctx.asOf), cid: l.cid ?? null, code: l.cid ? ctx.code(l.cid) : null, tables: l.tables,
  }
}
const lastEvent = e => [...e.txns.map(t => t.date), ...e.touches.map(t => t.date)].filter(Boolean).sort().at(-1) ?? null

/** Check the shape of a proposal from the model. */
export function normalizeProposal(input) {
  const p = input && typeof input === 'object' ? input : {}
  const kind = String(p.kind ?? '')
  const reason = String(p.reason ?? '').trim().slice(0, 200)
  if (kind === 'dictionary') {
    const dictionary = String(p.dictionary ?? '')
    const value = String(p.value ?? '').trim()
    const variants = (Array.isArray(p.variants) ? p.variants : []).map(v => String(v).trim()).filter(Boolean).slice(0, 40)
    if (!/^(customer|transaction|asset|touch|lead|campaign|owner)\.[a-zA-Z0-9_.]+$/.test(dictionary)) throw new CrmError('bad-proposal', 'dictionary 要写成 transaction.type 这样：实体.字段')
    if (!value) throw new CrmError('bad-proposal', 'value 要写标准值')
    return { kind, dictionary, value, variants, reason }
  }
  if (kind === 'segment' || kind === 'flag') {
    const rule = p.rule && typeof p.rule === 'object' ? p.rule : null
    if (!rule || !String(rule.name ?? '').trim()) throw new CrmError('bad-proposal', 'rule 要写 { name, all 或 any: [...] }')
    const position = p.position === undefined ? null : Number(p.position)
    return { kind, rule, replaces: p.replaces ? String(p.replaces) : null, position: Number.isInteger(position) ? position : null, reason }
  }
  throw new CrmError('bad-proposal', 'kind 只能是：dictionary（字典条目）、segment（分层规则）、flag（标记规则）')
}

/** A configuration with one proposal applied (the input is not changed). */
export function applyProposal(spec, p) {
  const next = structuredClone(spec)
  if (p.kind === 'dictionary') {
    next.dictionaries ??= {}
    const dict = (next.dictionaries[p.dictionary] ??= {})
    dict[p.value] = [...new Set([...(dict[p.value] ?? []), ...p.variants])]
    return next
  }
  const list = p.kind === 'segment' ? (next.segments ??= []) : (next.flags ??= [])
  const target = p.replaces ?? p.rule.name
  const at = list.findIndex(r => r.name === target)
  if (at >= 0) list[at] = p.rule
  else if (p.position !== null) list.splice(Math.max(0, Math.min(list.length, p.position)), 0, p.rule)
  else list.push(p.rule)
  return next
}

/** A proposal in one plain sentence, for the 待确认 page and the chat card. */
export function plainProposal(p) {
  if (p.kind === 'dictionary') return `把「${(p.variants ?? []).join('、') || p.value}」归到「${p.value}」`
  const what = p.kind === 'segment' ? '分层' : '标记'
  const rule = p.rule ? p.rule.desc || describeRule(p.rule) : ''
  return `${p.replaces ? `把${what}「${p.replaces}」换成` : `新增${what}`}「${p.rule?.name ?? ''}」：${rule}`
}
