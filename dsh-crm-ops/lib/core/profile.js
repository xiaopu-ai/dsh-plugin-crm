/**
 * 体检: a deterministic profile of one sheet.
 *
 * Finds the header row, splits a field's name from the instructions people
 * write in brackets, recognizes skipped rows (blank, total, repeated header),
 * and for every column infers a kind with its parse rate, fill rate, distinct
 * count and duplicates. Flags long numbers Excel already destroyed, phones
 * shared by several names, computed columns, stale statuses, and whether the
 * sheet is row-level detail or a summary.
 *
 * Nothing here talks to a model. `redactProfile` produces the copy a model may
 * see: no raw values of sensitive columns, free text masked.
 */
import { TAG_SEPARATORS } from './spec.js'

const HEADER_SCAN = 20

// ---- value recognizers --------------------------------------------------------

const FULLWIDTH = /[！-～]/g
/** Full-width ASCII to half-width, ideographic space to space. */
export const halfWidth = s => String(s).replace(FULLWIDTH, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ')

const MOBILE = /^1[3-9]\d{9}$/
/** Normalize a mainland mobile number, or return null. */
export function parsePhone(raw) {
  let s = halfWidth(raw).replace(/[\s\-()（）.]/g, '')
  if (s.startsWith('+86')) s = s.slice(3)
  else if (s.startsWith('0086')) s = s.slice(4)
  else if (s.startsWith('86') && s.length === 13) s = s.slice(2)
  return MOBILE.test(s) ? s : null
}
const LANDLINE = /^0\d{2,3}-?\d{7,8}$/

const pad = n => String(n).padStart(2, '0')
const validDate = (y, m, d) => {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}
/**
 * Parse an unambiguous date to `YYYY-MM-DD`; a month alone to `YYYY-MM`.
 * Day-month order that cannot be told apart (`3/1/25`) returns `{ ambiguous: true }`.
 */
export function parseDate(raw) {
  const s = halfWidth(raw).trim()
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s)
  if (m) return validDate(+m[1], +m[2], +m[3]) ? { value: `${m[1]}-${pad(m[2])}-${pad(m[3])}` } : null
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return validDate(+m[1], +m[2], +m[3]) ? { value: `${m[1]}-${m[2]}-${m[3]}` } : null
  m = /^(\d{4})[-/.年](\d{1,2})月?$/.exec(s)
  if (m && +m[2] >= 1 && +m[2] <= 12) return { value: `${m[1]}-${pad(m[2])}`, month: true }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s)
  if (m) {
    const a = +m[1]; const b = +m[2]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    if (a > 12 && validDate(y, b, a)) return { value: `${y}-${pad(b)}-${pad(a)}` }
    if (b > 12 && validDate(y, a, b)) return { value: `${y}-${pad(a)}-${pad(b)}` }
    if (validDate(y, a, b) || validDate(y, b, a)) return { ambiguous: true }
  }
  return null
}

/**
 * Parse a money amount to integer cents. Handles ¥/元, thousands separators,
 * 万, a sign or accounting brackets for negatives. Returns null otherwise.
 */
export function parseMoney(raw) {
  let s = halfWidth(raw).replace(/\s/g, '')
  if (s === '') return null
  let negative = false
  if (/^\(.*\)$/.test(s) || /^（.*）$/.test(raw.trim())) { negative = true; s = s.slice(1, -1) }
  s = s.replace(/^(?:¥|￥|RMB|CNY)/i, '').replace(/(?:元|块|RMB|CNY)$/i, '')
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1) } else if (s.startsWith('+')) s = s.slice(1)
  let scale = 1
  if (s.endsWith('万')) { scale = 10000; s = s.slice(0, -1) } else if (s.endsWith('千')) { scale = 1000; s = s.slice(0, -1) }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return null
  const [int, frac = ''] = s.replace(/,/g, '').split('.')
  // Exact decimal arithmetic in BigInt: value × scale × 100, rounded half up.
  const digits = frac.length
  const whole = BigInt(int + frac) * BigInt(scale) * 100n
  const div = 10n ** BigInt(digits)
  const cents = (whole + div / 2n) / div
  const n = Number(cents)
  return negative ? -n : n
}

/** A number written in plain digits (no unit), as a JS number, or null. */
export function parseNumber(raw) {
  const s = halfWidth(raw).replace(/\s/g, '')
  if (!/^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/.test(s)) return null
  return Number(s.replace(/[,%]/g, ''))
}

/**
 * Money with a unit, such as a salary: `15k`, `1.5万`, `15*13` (monthly × months), `300/天`.
 * Returns `{ cents, per, months? }` or null. `per` is 'month', 'day', 'year' or 'unknown'.
 */
export function parseUnitMoney(raw) {
  const s = halfWidth(raw).replace(/\s/g, '').replace(/^[一-龥]{2,4}(?=\d)/, '')
  let m = /^(\d+(?:\.\d+)?)([kKwW万千]?)\*(\d{1,2})(?:薪)?$/.exec(s)
  if (m) return { cents: unitCents(m[1], m[2], true), per: 'month', months: +m[3] }
  m = /^(\d+(?:\.\d+)?)(?:元)?\/(天|日|月|年)$/.exec(s)
  if (m) return { cents: unitCents(m[1], ''), per: { 天: 'day', 日: 'day', 月: 'month', 年: 'year' }[m[2]] }
  m = /^(\d+(?:\.\d+)?)([kKwW万千])(?:\/(月|年))?$/.exec(s)
  if (m) return { cents: unitCents(m[1], m[2]), per: m[3] === '年' ? 'year' : m[3] === '月' ? 'month' : 'unknown' }
  return null
}
function unitCents(num, unit, bareIsThousands = false) {
  const scale = /[kK千]/.test(unit) ? 1000 : /[wW万]/.test(unit) ? 10000 : bareIsThousands && Number(num) < 1000 ? 1000 : 1
  return parseMoney(String(Number(num) * scale))
}

const VIN_MAP = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 }
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
/** `{ value, valid }` for a 17-character VIN, null when it is not shaped like one. */
export function parseVin(raw) {
  const s = halfWidth(raw).replace(/[\s-]/g, '').toUpperCase()
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(s) || !/[A-Z]/.test(s) || !/\d/.test(s)) return null
  let sum = 0
  for (let i = 0; i < 17; i++) sum += (/\d/.test(s[i]) ? +s[i] : VIN_MAP[s[i]]) * VIN_WEIGHTS[i]
  const check = sum % 11 === 10 ? 'X' : String(sum % 11)
  return { value: s, valid: s[8] === check }
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK = '10X98765432'
/** `{ value, valid }` for an 18-digit mainland ID number, null when not shaped like one. */
export function parseIdCard(raw) {
  const s = halfWidth(raw).replace(/\s/g, '').toUpperCase()
  if (!/^\d{17}[\dX]$/.test(s)) return null
  const birth = parseDate(s.slice(6, 14))
  if (!birth?.value) return null
  let sum = 0
  for (let i = 0; i < 17; i++) sum += +s[i] * ID_WEIGHTS[i]
  return { value: s, valid: ID_CHECK[sum % 11] === s[17] }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/
const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i
/** Excel already turned a long number into scientific notation; the digits are gone. */
export const isScientific = raw => /^\d(\.\d+)?E\+\d+$/i.test(halfWidth(raw).trim())

// ---- header, field names, skipped rows -----------------------------------------

/**
 * Split a header into its name and the instruction people write in brackets.
 * `进度（面试取消直接删除整行）` → `{ name: '进度', note: '面试取消直接删除整行' }`.
 * Short qualifiers like `金额(元)` stay in the name.
 */
export function splitFieldName(header) {
  const s = String(header).trim()
  const m = /^(.+?)\s*[（(]([^（）()]{6,})[)）]\s*(.*)$/.exec(s)
  if (m) return { name: `${m[1]}${m[3]}`.trim(), note: m[2].trim() }
  const bang = /^(.+?)\s*[（(](.+[！!].*)[)）]\s*$/.exec(s)
  if (bang) return { name: bang[1].trim(), note: bang[2].trim() }
  return { name: s, note: '' }
}

const looksLikeLabel = v => v !== '' && !/^[-+]?[\d,.]+%?$/.test(v) && parseDate(v) === null && v.length <= 40

/**
 * The written form of a value: letters → a, digits → 9, Chinese characters → 字, other
 * characters kept; runs longer than three collapse to `x{n}`. `C0001:K12 某机构 : 张三` →
 * `a9{4}:a99 字{3} : 字字`.
 */
export function patternOf(value) {
  const s = String(value).replace(/[A-Za-z]/g, 'a').replace(/[0-9０-９]/g, '9').replace(/[一-龥]/g, '字').replace(/\s+/g, ' ')
  return s.replace(/(.)\1{3,}/g, (run, ch) => `${ch}{${run.length}}`).slice(0, 60)
}

/** The most common written forms of a column's values, with counts. */
export function patternsOf(values, top = 3) {
  const counts = new Map()
  for (const v of values) { const p = patternOf(v); counts.set(p, (counts.get(p) ?? 0) + 1) }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, top).map(([pattern, count]) => ({ pattern, count }))
}

/**
 * Pick the header row: within the first 20 rows, the row that is mostly
 * distinct text labels and is followed by rows of data. Returns candidates
 * with scores so the person can pick when the best one is not clear.
 * @param {string[][]} rows - sheet rows.
 * @returns {{ index: number, sure: boolean, candidates: number[] }}
 */
export function findHeader(rows) {
  const width = Math.max(0, ...rows.map(r => r.length))
  if (rows.length === 0 || width === 0) return { index: 0, sure: false, candidates: [] }
  const scored = []
  for (let i = 0; i < Math.min(HEADER_SCAN, rows.length); i++) {
    const row = rows[i]
    const labels = row.filter(looksLikeLabel)
    if (labels.length === 0) continue
    const filled = row.filter(v => v !== '').length
    const distinct = new Set(labels).size
    const fill = filled / width
    // Exports with many optional columns have sparse data rows; a third of the header's width is enough.
    const below = rows.slice(i + 1, i + 6)
    const dataBelow = below.length === 0 ? 0 : below.filter(r => r.filter(v => v !== '').length >= Math.max(1, filled * 0.3)).length / below.length
    // Headers are words; a row holding numbers and dates is data, however full it is.
    const values = (filled - labels.length) / filled
    const score = (labels.length / width) * 2 + (distinct / labels.length) + fill + dataBelow * 2 - values * 2 - (labels.length === 1 && width > 2 ? 3 : 0)
    scored.push({ i, score })
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  if (scored.length === 0) return { index: 0, sure: false, candidates: [0] }
  // Sure when the winner clearly beats the runner-up, or when it is the first row and the
  // runner-up is a data row below it (data rows that contain text always score a little).
  const sure = scored.length === 1 || scored[0].score - scored[1].score > 0.6 || (scored[0].i === 0 && scored.slice(1).every(s => s.i > 0) && rows[0].every(looksLikeLabel))
  return { index: scored[0].i, sure, candidates: scored.slice(0, 3).map(s => s.i) }
}

const TOTAL_WORDS = /^(合计|总计|小计|总和|汇总|累计|total|subtotal|sum)[:：]?$/i

/**
 * Why a data row is skipped, or null to keep it.
 * @param {string[]} row - one data row.
 * @param {string[]} header - header row.
 */
export function skipReason(row, header) {
  if (row.every(v => v === '')) return 'blank'
  if (row.length === header.length && row.every((v, i) => v === header[i])) return 'repeated-header'
  const firstFilled = row.find(v => v !== '')
  if (firstFilled !== undefined && TOTAL_WORDS.test(firstFilled.replace(/\s/g, ''))) return 'total'
  return null
}
export const SKIP_REASONS = Object.freeze({ blank: '空行', 'repeated-header': '重复的表头', total: '合计或小计行' })

// ---- column kinds -------------------------------------------------------------

/** Column kinds, each with a person-facing name and whether its raw values are sensitive. */
export const KINDS = Object.freeze({
  phone: { name: '手机号', sensitive: true },
  idcard: { name: '身份证号', sensitive: true },
  vin: { name: '车架号（VIN）', sensitive: true },
  email: { name: '邮箱', sensitive: true },
  date: { name: '日期', sensitive: false },
  money: { name: '金额', sensitive: false },
  unitmoney: { name: '带单位的金额', sensitive: false },
  number: { name: '数字', sensitive: false },
  id: { name: '编号', sensitive: false },
  category: { name: '类别', sensitive: false },
  url: { name: '链接', sensitive: false },
  attachment: { name: '附件', sensitive: false },
  name: { name: '姓名', sensitive: true },
  text: { name: '文字', sensitive: true },
  empty: { name: '空列', sensitive: false },
})

const NAME_HEADER = /^(姓名|名字|客户姓名|学生姓名|学员姓名|车主姓名|联系人|面试人|客户|学员|学生|车主|name)$/i
const PERSON_NAME = /^[一-龥·]{2,4}$/
const ID_HEADER = /(编号|学号|工号|单号|订单号|流水号|ID|id|No\.?|序号|code)$/
const MONEY_HEADER = /(金额|价格|价|费|收入|付款|实付|应付|实收|应收|退款|薪资|工资|amount|price)/i
const DATE_HEADER = /(日期|时间|生日|date|time)/i

/**
 * Infer a column's kind from its non-empty values and header.
 * A kind wins when at least 80% of values parse as it.
 */
export function inferKind(header, values, feishuKind) {
  const vals = values.filter(v => v !== '')
  if (vals.length === 0) return { kind: 'empty', rate: 1 }
  if (feishuKind === 'attachment') return { kind: 'attachment', rate: 1 }
  if (feishuKind === 'url') return { kind: 'url', rate: 1 }
  if (feishuKind === 'datetime' || feishuKind === 'created_time' || feishuKind === 'modified_time') return { kind: 'date', rate: rate(vals, v => parseDate(v)?.value) }
  if (feishuKind === 'phone') return { kind: 'phone', rate: rate(vals, parsePhone) }
  const r = {
    phone: rate(vals, parsePhone),
    idcard: rate(vals, parseIdCard),
    vin: rate(vals, parseVin),
    email: rate(vals, v => EMAIL.test(v)),
    url: rate(vals, v => URL_RE.test(v)),
    date: rate(vals, v => parseDate(v)?.value ?? parseDate(v)?.ambiguous),
    money: rate(vals, v => parseMoney(v) !== null),
    unitmoney: rate(vals, v => parseUnitMoney(v) !== null || parseMoney(v) !== null || v === '-'),
    number: rate(vals, v => parseNumber(v) !== null),
    name: rate(vals, v => PERSON_NAME.test(v)),
  }
  for (const k of ['phone', 'idcard', 'vin', 'email', 'url']) if (r[k] >= 0.8) return { kind: k, rate: r[k] }
  // A key column where Excel already destroyed some values: count the damaged ones as the key's shape.
  const keyHeader = /手机|电话/.test(header) ? 'phone' : /vin|车架/i.test(header) ? 'vin' : /证件|身份证/.test(header) ? 'idcard' : null
  if (keyHeader && rate(vals, v => isScientific(v) || { phone: parsePhone, vin: parseVin, idcard: parseIdCard }[keyHeader](v)) >= 0.8) return { kind: keyHeader, rate: r[keyHeader] }
  if (r.date >= 0.8 && (DATE_HEADER.test(header) || r.number < 0.8)) return { kind: 'date', rate: r.date }
  const distinct = new Set(vals).size
  if (r.number >= 0.8) {
    // Unique numbers alone are not IDs (counts in a summary are unique too): the header has to say so,
    // or the values have to look like codes (6+ digits, all the same length).
    const codeLike = vals.every(v => /^\d{6,}$/.test(v)) && new Set(vals.map(v => v.length)).size === 1
    if (ID_HEADER.test(header) || (codeLike && distinct === vals.length && !MONEY_HEADER.test(header))) return { kind: 'id', rate: r.number }
    if (MONEY_HEADER.test(header)) return { kind: 'money', rate: r.money }
    return { kind: 'number', rate: r.number }
  }
  if (r.money >= 0.8) return { kind: 'money', rate: r.money }
  if (MONEY_HEADER.test(header) && r.unitmoney >= 0.6) return { kind: 'unitmoney', rate: rate(vals, v => parseUnitMoney(v) !== null || parseMoney(v) !== null) }
  // Without a name-like header, only a long column of distinct 2-4 character names counts (statuses like 已付 do not).
  if (NAME_HEADER.test(header) || (r.name >= 0.9 && vals.length >= 5 && distinct >= vals.length * 0.9)) return { kind: 'name', rate: r.name }
  if (feishuKind === 'select' || feishuKind === 'multiselect' || feishuKind === 'checkbox') return { kind: 'category', rate: 1 }
  if (ID_HEADER.test(header) && distinct === vals.length) return { kind: 'id', rate: 1 }
  const avgLen = vals.reduce((a, v) => a + v.length, 0) / vals.length
  if (distinct <= Math.max(12, vals.length * 0.2) && avgLen <= 12) return { kind: 'category', rate: 1 }
  return { kind: 'text', rate: 1 }
}
const rate = (vals, fn) => vals.filter(v => Boolean(fn(v))).length / vals.length

// ---- stale statuses -----------------------------------------------------------

export const OPEN_STATUS = /(已预约|待|进行中|未完成|处理中|跟进中|预约|pending|open|scheduled)/i
/** A date something is due, booked or ends on: the only kind of date that can leave a status behind. */
const DEADLINE_HEADER = /(到期|截止|截至|结束|失效|过期|期满|届满|预约|计划|预计|预定|应还|应付|应收|交期|结课|毕业|结业|due|end|expir|deadline|appoint|schedul|plan)/i
/** Share of a date column's values that lie after the cutoff for it to count as a planned date. */
const FUTURE_SHARE = 0.1

/**
 * Rows whose due date has passed while their status still says "in progress".
 *
 * Only a date something is due on can make a status stale: a creation or delivery date in the past says
 * nothing about a status that is still open. A date column counts as due when its header says so, or when
 * a good part of its values lie after the cutoff (nothing has "happened" in the future). Each status column
 * is checked against one date only, the due date nearest to it in the sheet, so one neglected column makes
 * one finding and not one per date column.
 * @param {object[]} columns - profiled columns.
 * @param {string[][]} data - data rows.
 * @param {string} asOf - `YYYY-MM-DD` cutoff.
 */
export function staleStatuses(columns, data, asOf) {
  const out = []
  const statuses = columns.filter(c => c.kind === 'category' && !c.computed && c.values?.some(v => OPEN_STATUS.test(v.value)))
  if (statuses.length === 0) return out
  const due = columns.filter(c => {
    if (c.kind !== 'date' || c.computed) return false
    if (DEADLINE_HEADER.test(c.name)) return true
    let dated = 0
    let future = 0
    for (const row of data) { const day = parseDate(row[c.index])?.value; if (day && day.length === 10) { dated++; if (day > asOf) future++ } }
    return dated > 0 && future / dated >= FUTURE_SHARE
  })
  for (const s of statuses) {
    const d = [...due].sort((a, b) => Math.abs(a.index - s.index) - Math.abs(b.index - s.index))[0]
    if (!d) continue
    let count = 0
    let noStatus = 0
    const open = new Map()
    for (const row of data) {
      const day = parseDate(row[d.index])?.value
      if (!day || day.length !== 10 || day >= asOf) continue
      const status = row[s.index]
      if (status === '') noStatus++
      else if (OPEN_STATUS.test(status)) { count++; open.set(status, (open.get(status) ?? 0) + 1) }
    }
    if (count > 0 || noStatus > 0) out.push({ status: s.name, date: d.name, stale: count, missing: noStatus, values: [...open].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v]) => v) })
  }
  return out
}

// ---- several values in one cell -------------------------------------------------

const MULTI_SEP = /[,，;；、|]/
const MULTI_ITEMS_MAX = 60

/**
 * A column whose cells list several values ("全地形车,摩托艇"): how many cells do, and the values once cut
 * apart. Reported when the cut values form a small vocabulary; a column of free text with commas does not.
 * A column listing several dates ("2019-08,2022-08") is reported as `dates`.
 * @param {string[]} values - the column's non-empty values.
 * @returns {{ cells: number, sharePct: number, dates?: true, distinct?: number, items?: { value: string, count: number }[] } | null}
 */
export function multiValues(values) {
  if (values.length === 0) return null
  const lists = values.filter(v => MULTI_SEP.test(v))
  if (lists.length < 3 && lists.length < values.length * 0.5) return null
  const cut = v => v.split(TAG_SEPARATORS).map(s => s.trim()).filter(Boolean)
  const sharePct = Math.round((lists.length / values.length) * 1000) / 10
  const sample = lists.slice(0, 200).flatMap(cut)
  if (sample.length > 0 && sample.filter(x => parseDate(x)?.value).length >= sample.length * 0.8) return { cells: lists.length, sharePct, dates: true }
  const counts = new Map()
  for (const v of values) for (const x of new Set(cut(v))) counts.set(x, (counts.get(x) ?? 0) + 1)
  if (counts.size > MULTI_ITEMS_MAX) return null
  // The values of a list also turn up alone in other cells ("摩托艇" and "全地形车,摩托艇"). The pieces of
  // free text, or of "Zhang, Wei", never do.
  const alone = new Set(values.filter(v => !MULTI_SEP.test(v)).map(v => v.trim()))
  const listed = new Set(lists.flatMap(cut))
  if ([...listed].filter(x => alone.has(x)).length < listed.size * 0.5) return null
  if ([...counts.keys()].some(x => x.length > 20)) return null
  return { cells: lists.length, sharePct, distinct: counts.size, items: [...counts].sort((a, b) => b[1] - a[1]).slice(0, TOP_VALUES).map(([value, count]) => ({ value, count })) }
}

// ---- the profile --------------------------------------------------------------

const SAMPLE = 5
const TOP_VALUES = 12

/**
 * Profile one sheet.
 * @param {{ name: string, rows: string[][], filled?: Set<string>, formulaColumns?: number[], columns?: object[], headerRow?: number }} sheet
 * @param {{ headerRow?: number, asOf?: string }} [options] - forced header row; cutoff date for stale checks.
 * @returns {object} profile.
 */
export function profileSheet(sheet, options = {}) {
  const rows = sheet.rows
  const found = options.headerRow !== undefined ? { index: options.headerRow, sure: true, candidates: [options.headerRow] } : sheet.headerRow !== undefined ? { index: sheet.headerRow, sure: true, candidates: [sheet.headerRow] } : findHeader(rows)
  const headerIndex = found.index
  const headerCells = rows[headerIndex] ?? []
  const width = Math.max(headerCells.length, ...rows.slice(headerIndex + 1).map(r => r.length), 0)
  const header = Array.from({ length: width }, (_, c) => headerCells[c] ?? '')
  const kept = []
  const skipped = []
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = Array.from({ length: width }, (_, c) => rows[r][c] ?? '')
    const reason = skipReason(row, header)
    if (reason) skipped.push({ row: r + 1, reason })
    else kept.push({ row: r + 1, cells: row })
  }
  const data = kept.map(k => k.cells)
  const formula = new Set(sheet.formulaColumns ?? [])
  const usedNames = new Map()
  const columns = header.map((h, index) => {
    const { name: base, note } = splitFieldName(h || `第 ${index + 1} 列`)
    const n = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, n)
    const name = n > 1 ? `${base} ${n}` : base
    const values = data.map(r => r[index])
    const feishu = sheet.columns?.[index]
    const { kind, rate: parseRate } = inferKind(base, values, feishu?.kind)
    const nonEmpty = values.filter(v => v !== '')
    const counts = new Map()
    for (const v of nonEmpty) counts.set(v, (counts.get(v) ?? 0) + 1)
    const duplicates = [...counts.values()].filter(c => c > 1).reduce((a, c) => a + c - 1, 0)
    const inColumn = set => (set ? [...set].filter(k => +k.split(',')[1] === index && +k.split(',')[0] > headerIndex).length : 0)
    const filledByMerge = inColumn(sheet.filled)
    const col = {
      index,
      header: h,
      name,
      note,
      kind,
      kindName: KINDS[kind].name,
      sensitive: KINDS[kind].sensitive,
      source: feishu ? { feishuKind: feishu.kind } : undefined,
      computed: formula.has(index),
      fillRate: data.length ? nonEmpty.length / data.length : 0,
      filled: nonEmpty.length,
      parseRate,
      distinct: counts.size,
      duplicates,
      mergedFilled: filledByMerge,
      damaged: nonEmpty.filter(isScientific).length + inColumn(sheet.damaged),
      ambiguousDates: kind === 'date' ? nonEmpty.filter(v => parseDate(v)?.ambiguous).length : 0,
      samples: [...new Set(nonEmpty)].slice(0, SAMPLE),
    }
    if (kind === 'category') col.values = [...counts].sort((a, b) => b[1] - a[1]).slice(0, TOP_VALUES).map(([value, count]) => ({ value, count }))
    if (kind === 'date') {
      const days = nonEmpty.map(v => parseDate(v)?.value).filter(v => v && v.length === 10).sort()
      col.range = days.length ? [days[0], days.at(-1)] : null
    }
    if (kind === 'money') {
      let sum = 0
      let bad = 0
      for (const v of nonEmpty) { const c = parseMoney(v); if (c === null) bad++; else sum += c }
      col.sumCents = sum
      col.unparsed = bad
    }
    if (kind === 'unitmoney') {
      const shapes = new Map()
      for (const v of nonEmpty) {
        const u = parseUnitMoney(v)
        const shape = u ? (u.months ? '月薪×月数' : { month: '月薪', day: '日薪', year: '年薪', unknown: '没写单位' }[u.per]) : parseMoney(v) !== null ? '纯数字' : v === '-' ? '空（-）' : '认不出'
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1)
      }
      col.shapes = [...shapes].sort((a, b) => b[1] - a[1]).map(([shape, count]) => ({ shape, count }))
    }
    // How the values are written, with every letter, digit and character replaced: shows that a
    // cell packs a code and a name together without showing either.
    if (['text', 'name', 'id'].includes(kind) && counts.size > 1) col.patterns = patternsOf(nonEmpty)
    if (['category', 'text'].includes(kind)) { const multi = multiValues(nonEmpty); if (multi) col.multi = multi }
    return col
  })

  // Shared phones: one phone, several distinct names in the same row set.
  const nameCol = columns.find(c => c.kind === 'name')
  for (const c of columns.filter(x => x.kind === 'phone')) {
    if (!nameCol) break
    const byPhone = new Map()
    for (const r of data) {
      const p = parsePhone(r[c.index])
      const n = r[nameCol.index].replace(/\s/g, '')
      if (!p || !n) continue
      if (!byPhone.has(p)) byPhone.set(p, new Set())
      byPhone.get(p).add(n)
    }
    const shared = [...byPhone.values()].filter(s => s.size > 1)
    c.sharedPhones = { phones: shared.length, rows: shared.reduce((a, s) => a + s.size, 0) }
  }
  for (const c of columns.filter(x => x.kind === 'vin' || x.kind === 'idcard')) {
    const parse = c.kind === 'vin' ? parseVin : parseIdCard
    // Values Excel already destroyed are reported once, as damaged, not again as bad check digits.
    const broken = new Set([...(sheet.damaged ?? [])].filter(k => +k.split(',')[1] === c.index).map(k => +k.split(',')[0]))
    c.invalid = kept.filter(k => !broken.has(k.row - 1) && !isScientific(k.cells[c.index])).map(k => parse(k.cells[c.index])).filter(v => v && !v.valid).length
  }

  // A phone column shared by several people cannot identify one person on its own.
  const keyColumns = columns.filter(c => !c.computed && ['phone', 'idcard', 'vin', 'id', 'email'].includes(c.kind) && c.fillRate >= 0.5 && !(c.sharedPhones?.phones > 0))
  const nameColumns = columns.filter(c => c.kind === 'name')
  const summary = keyColumns.length === 0 && nameColumns.length === 0 && (data.length <= 60 || columns.filter(c => c.kind === 'number' || c.kind === 'money').length >= columns.length * 0.5)
  // No person column, but every row has its own name (活动名称、门店): a reference list, not a total.
  const label = summary && data.length >= 2 ? columns.find(c => !c.computed && ['category', 'text'].includes(c.kind) && c.fillRate === 1 && c.distinct === data.length) : null
  const asOf = options.asOf ?? latestDate(columns)
  const profile = {
    sheet: sheet.name,
    header: { row: headerIndex + 1, sure: found.sure, candidates: found.candidates.map(i => i + 1) },
    rows: { total: Math.max(0, rows.length - headerIndex - 1), kept: data.length, skipped: skipped.length, skippedByReason: countBy(skipped, s => s.reason), skippedRows: skipped.slice(0, 50) },
    columns,
    keys: keyColumns.map(c => c.name),
    detail: !summary,
    list: label ? label.name : null,
    asOf,
    stale: asOf ? staleStatuses(columns, data, asOf) : [],
  }
  profile.warnings = warnings(profile)
  return profile
}

function latestDate(columns) {
  const ends = columns.filter(c => c.kind === 'date' && !c.computed && c.range).map(c => c.range[1])
  return ends.length ? ends.sort().at(-1) : null
}
const countBy = (items, key) => items.reduce((m, x) => (m[key(x)] = (m[key(x)] ?? 0) + 1, m), {})

/** Plain-language findings a person should look at, most important first. */
export function warnings(p) {
  const out = []
  const pct = x => `${Math.round(x * 100)}%`
  if (!p.detail && p.list) out.push({ level: 'check', text: `这张表没有能认出每个人的列，每行是一个「${p.list}」。如果它是活动、门店这样的名录，留着，配置时当参考表用；如果是按地区、按月合计出来的数，客户运营用不了，把勾去掉` })
  else if (!p.detail) out.push({ level: 'block', text: '这张表看起来是汇总数据（没有能认出每个人的列）。客户运营需要每个客户、每笔交易一行的明细表' })
  if (!p.header.sure) out.push({ level: 'check', text: `表头在第几行不太确定，按第 ${p.header.row} 行读的；不对的话在下面换一行` })
  for (const c of p.columns) {
    if (c.damaged > 0) out.push({ level: 'block', text: `「${c.name}」有 ${c.damaged} 个值已经被 Excel 弄坏了（变成 1.38E+10 这样，或者超过 15 位的数字丢了末尾几位），原来的数字找不回来。请在原系统导出时把这一列设成文本格式` })
    if (c.computed) out.push({ level: 'info', text: `「${c.name}」是公式或引用算出来的，值可能已经过期，默认不当原始数据用` })
    if (c.sharedPhones?.phones > 0) out.push({ level: 'check', text: `「${c.name}」里有 ${c.sharedPhones.phones} 个号码对应不止一个姓名（共 ${c.sharedPhones.rows} 人），可能是家长或销售的号码，不能直接用来认人` })
    if (c.invalid > 0) out.push({ level: 'check', text: `「${c.name}」有 ${c.invalid} 个值校验位不对，可能录错了` })
    if (c.ambiguousDates > 0) out.push({ level: 'check', text: `「${c.name}」有 ${c.ambiguousDates} 个日期分不清月和日（像 3/1/25），要你确认是哪种写法` })
    if (c.kind === 'unitmoney' && c.shapes.length > 1) out.push({ level: 'check', text: `「${c.name}」的写法有 ${c.shapes.length} 种（${c.shapes.map(s => `${s.shape} ${s.count}`).join('、')}），要先说清楚怎么折算` })
    if (c.kind === 'money' && c.unparsed > 0) out.push({ level: 'check', text: `「${c.name}」有 ${c.unparsed} 个值认不出是多少钱` })
    if (!['text', 'name', 'category', 'empty', 'attachment'].includes(c.kind) && c.parseRate < 0.95 && c.filled > 0) out.push({ level: 'check', text: `「${c.name}」只有 ${pct(c.parseRate)} 的值能按${c.kindName}读出来` })
    if (c.mergedFilled > 0) out.push({ level: 'info', text: `「${c.name}」有 ${c.mergedFilled} 格来自合并单元格，已按合并的值补上` })
    if (c.note) out.push({ level: 'info', text: `「${c.name}」的表头写着说明：${c.note}` })
  }
  // Empty columns in one line: a system export often carries a dozen of them.
  const empty = p.columns.filter(c => c.kind === 'empty').map(c => c.name)
  if (empty.length > 0) out.push({ level: 'info', text: empty.length === 1 ? `「${empty[0]}」整列是空的` : `有 ${empty.length} 列整列是空的：${empty.slice(0, 8).join('、')}${empty.length > 8 ? ' 等' : ''}` })
  // Columns whose cells list several values, in one line each kind; the model reads the details per column.
  const multi = p.columns.filter(c => c.multi && !c.multi.dates).map(c => c.name)
  if (multi.length > 0) out.push({ level: 'info', text: `${multi.length === 1 ? `「${multi[0]}」` : `有 ${multi.length} 列（${multi.slice(0, 6).join('、')}${multi.length > 6 ? ' 等' : ''}）`}一格里写了不止一个值，配置里可以当多值标签用：每个值各算一个标签` })
  const dateLists = p.columns.filter(c => c.multi?.dates).map(c => c.name)
  if (dateLists.length > 0) out.push({ level: 'info', text: `「${dateLists.slice(0, 4).join('」「')}」一格里写了不止一个日期，配置里当日期用时取最近的那个` })
  for (const s of p.stale) {
    if (s.stale > 0) out.push({ level: 'check', text: `有 ${s.stale} 行「${s.date}」已经过了，「${s.status}」还停在${(s.values ?? []).length ? `「${s.values.join('」「')}」` : '进行中'}，状态可能没人更新` })
    if (s.missing > 0) out.push({ level: 'check', text: `有 ${s.missing} 行「${s.date}」已经过了，但「${s.status}」是空的` })
  }
  if (p.rows.skipped > 0) out.push({ level: 'info', text: `跳过了 ${p.rows.skipped} 行：${Object.entries(p.rows.skippedByReason).map(([k, v]) => `${SKIP_REASONS[k]} ${v}`).join('、')}` })
  const order = { block: 0, check: 1, info: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}

// ---- what a model may see -----------------------------------------------------

// Longest patterns first, and digits must not continue on either side, so an ID number is not read as a phone.
const MASK_PATTERNS = [
  [/(?<![\dA-Za-z])\d{17}[\dXx](?![\dA-Za-z])/g, '[证件号]'],
  [/(?<![A-Za-z0-9])(?=[A-HJ-NPR-Z0-9]*[A-Z])(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}(?![A-Za-z0-9])/g, '[VIN]'],
  [/[^\s@，,。；;：:]+@[^\s@]+\.[A-Za-z]{2,}/g, '[邮箱]'],
  [/(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, '[手机号]'],
]
/** Mask phone numbers, ID numbers, VINs and emails inside free text. */
export const maskText = s => MASK_PATTERNS.reduce((t, [re, rep]) => t.replace(re, rep), String(s))

/**
 * The copy of a profile a model may read: sensitive columns keep only their
 * statistics; category values and free text are masked; no row content.
 * @param {object} profile - from profileSheet.
 * @param {{ summaryOnly?: boolean }} [options] - only statistics, no sample values at all.
 */
export function redactProfile(profile, { summaryOnly = false } = {}) {
  return {
    sheet: profile.sheet,
    header: profile.header,
    rows: { total: profile.rows.total, kept: profile.rows.kept, skipped: profile.rows.skipped, skippedByReason: profile.rows.skippedByReason },
    detail: profile.detail,
    asOf: profile.asOf,
    keys: profile.keys,
    stale: profile.stale,
    warnings: profile.warnings.map(w => ({ level: w.level, text: maskText(w.text) })),
    columns: profile.columns.map(c => {
      const out = { name: c.name, note: maskText(c.note), kind: c.kindName, computed: c.computed, fillRate: round(c.fillRate), parseRate: round(c.parseRate), distinct: c.distinct, duplicates: c.duplicates }
      if (c.range) out.range = c.range
      if (c.sumCents !== undefined) out.sumCents = c.sumCents
      if (c.shapes) out.shapes = c.shapes
      if (c.patterns) out.patterns = c.patterns
      if (c.multi) out.multi = c.multi.dates ? { cells: c.multi.cells, dates: true } : { cells: c.multi.cells, sharePct: c.multi.sharePct, distinct: c.multi.distinct, items: summaryOnly ? undefined : c.multi.items.map(v => ({ value: maskText(v.value), count: v.count })) }
      if (c.sharedPhones) out.sharedPhones = c.sharedPhones
      if (!summaryOnly && c.values) out.values = c.values.map(v => ({ value: maskText(v.value), count: v.count }))
      if (!summaryOnly && !c.sensitive && !['category'].includes(c.kind)) out.samples = c.samples.map(maskText)
      return out
    }),
  }
}
const round = x => Math.round(x * 1000) / 1000

/**
 * The kept data rows of a sheet, read the same way its profile was:
 * same header row, same skipped rows. Cells are aligned to `profile.columns`.
 * @param {{ rows: string[][] }} sheet - the sheet the profile came from.
 * @param {object} profile - from profileSheet.
 * @returns {{ row: number, cells: string[] }[]} 1-based source row numbers.
 */
export function keptRows(sheet, profile) {
  const headerIndex = profile.header.row - 1
  const width = profile.columns.length
  const header = profile.columns.map(c => c.header)
  const out = []
  for (let r = headerIndex + 1; r < sheet.rows.length; r++) {
    const cells = Array.from({ length: width }, (_, c) => sheet.rows[r][c] ?? '')
    if (skipReason(cells, header) === null) out.push({ row: r + 1, cells })
  }
  return out
}

/** A person's name for a model: the first character, the rest as `*`. */
export function maskName(name) {
  const chars = [...String(name).trim()]
  if (chars.length === 0) return ''
  return chars[0] + '*'.repeat(Math.max(1, chars.length - 1))
}
