/**
 * 报告: drafts whose statistics are references to logged queries.
 *
 * A draft is Markdown with `{{q3.value}}`-style references. Saving resolves
 * every reference against the query log and freezes the cited results next to
 * the draft; the number checker then flags every other number in the text that
 * is not a date, an ordinal, list numbering, part of a known name, or a window
 * that matches the configuration or the cited queries' parameters. Finalizing
 * renders the numbers, appends the 口径 and caveats, and freezes both files, so
 * later imports never change a finalized report.
 */
import { CAMPAIGN_CAVEAT } from './features.js'
import { LEAD_DEFAULTS } from './spec.js'

// A path step is `.name`, `[3]` or `["a name with spaces"]`. Names are in the dataset's own words (a row of the
// reach query is keyed by the channel's name), so a step may be in any script.
const STEP = String.raw`\.[\p{L}_][\p{L}\p{N}_]*|\[\d+\]|\["[^"\]]+"\]`
const REF = new RegExp(String.raw`\{\{\s*(q\d+)((?:${STEP})+)\s*\}\}`, 'gu')
// The same, with a percent sign the writer put right after it.
const REF_THEN_PCT = new RegExp(`${REF.source}(\\s*[%％])?`, 'gu')
const STEPS = new RegExp(STEP, 'gu')

/** All references in a body: `[{ ref: 'q3', path: '.value', index, length }]`. */
export function parseRefs(body) {
  const out = []
  for (const m of body.matchAll(REF)) out.push({ ref: m[1], path: m[2], index: m.index, length: m[0].length, text: m[0] })
  return out
}

/** Follow `.rows[0].count` into a value; undefined when the path does not exist. */
export function resolvePath(obj, path) {
  let cur = obj
  for (const part of path.match(STEPS) ?? []) {
    if (cur === null || cur === undefined) return undefined
    cur = part.startsWith('["') ? cur[part.slice(2, -2)] : part.startsWith('[') ? cur[Number(part.slice(1, -1))] : cur[part.slice(1)]
  }
  return cur
}

/** Format a cited value: thousands separators, at most two decimals, `%` for *Pct keys. */
export function formatValue(value, path) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value !== 'number') return String(value)
  const leaf = (path.match(STEPS) ?? []).at(-1)?.replace(/^\.|^\["|"\]$/g, '') ?? ''
  const pct = /Pct$|^pct$/.test(leaf)
  const text = value.toLocaleString('en-US', { maximumFractionDigits: pct ? 1 : 2, minimumFractionDigits: 0 })
  return pct ? `${text}%` : text
}

/**
 * Resolve every reference against the logged queries.
 * @param {string} body
 * @param {Map<string, object>} log - `q3 → { n, kind, params, result }`.
 * @returns {{ refs: object, problems: object[] }}
 */
export function resolveRefs(body, log) {
  const refs = {}
  const problems = []
  for (const r of parseRefs(body)) {
    const q = log.get(r.ref)
    if (!q) { problems.push({ ...where(body, r.index), kind: 'no-ref', text: r.text, message: `没有 ${r.ref} 这次查询` }); continue }
    const v = resolvePath(q.result, r.path)
    if (v === undefined || (typeof v === 'object' && v !== null)) { problems.push({ ...where(body, r.index), kind: 'bad-path', text: r.text, message: `${r.ref} 的结果里没有「${r.path.slice(1)}」这个数` }); continue }
    refs[r.ref] = { n: q.n, kind: q.kind, params: q.params, result: q.result, version: q.result.version, asOf: q.result.asOf }
  }
  return { refs, problems }
}

/** Line and column of an index, with a short snippet around it. */
function where(body, index) {
  const before = body.slice(0, index)
  const line = before.split('\n').length
  const col = index - before.lastIndexOf('\n')
  const lineText = body.split('\n')[line - 1] ?? ''
  return { line, column: col, snippet: lineText.length > 80 ? `${lineText.slice(Math.max(0, col - 40), col + 40)}` : lineText }
}

const DATE_PATTERNS = [
  /\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}/g,
  /\d{4}\s*年\s*\d{1,2}\s*月(\s*\d{1,2}\s*[日号])?/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g,
  /\d{4}\s*[-/]\s*\d{1,2}(?!\d)/g,
  /\d{4}\s*年/g,
  /\d{4}\s*Q[1-4]/gi,
  // 9、10 月；9-10 月；6 月到 8 月
  /\d{1,2}(\s*月)?\s*[-～~—–、到至和]\s*\d{1,2}\s*月份?/g,
  /\d{1,2}\s*月份?/g,
  /[第]\s*\d+\s*[层版条周个次季期名位步]/g,
  /\bq\d+\b/g,
]
const WINDOW = /(近|最近|过去|前|后|未来|超过|不到|以内|内)?\s*(\d+(?:\.\d+)?)\s*(天|日|周|个月|月|年|季度)/g
// 3～12 个月、1～2 年: both ends are windows.
const WINDOW_RANGE = /(\d+(?:\.\d+)?)\s*[-～~—–到至]\s*(\d+(?:\.\d+)?)\s*(天|日|周|个月|月|年|季度)/g
// A list ordinal, also inside a bullet or quote, after bold markers, or with a full-width point.
const LIST_NUMBER = /^((?:\s*(?:[-*+>]\s+|\*\*|__))*\s*)(\d+)([.、)）．])/gm

/** Numbers the configuration itself contains (rule values and windows, follow-up days, cooldowns). */
export function allowedNumbers(spec, refs) {
  const out = new Set()
  const add = v => { if (typeof v === 'number' && Number.isFinite(v)) out.add(v) }
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); else add(v) }
  walk(spec.segments ?? [])
  walk(spec.flags ?? [])
  add(spec.lists?.followDays)
  // The lead timing the configuration sets (first follow-up within N days, stalled after N, aged after N).
  for (const k of ['followDays', 'staleDays', 'activeDays']) add(spec.leads?.[k] ?? LEAD_DEFAULTS[k])
  for (const o of spec.lists?.outcomes ?? []) add(o.cooldownDays)
  add(spec.campaign?.effectDays)
  add(spec.campaign?.minGroup)
  for (const r of Object.values(refs)) {
    walk(r.params ?? {})
    for (const k of ['from', 'to']) if (typeof r.result?.[k] === 'string') { /* dates are allowed as dates */ }
    if (r.result?.flows?.days) add(r.result.flows.days)
    if (r.kind === 'segments' && r.params?.flows) add(30)
    if (r.kind === 'campaign_effect') { add(r.result.effectDays); add(r.result.minGroup) }
  }
  // Common time words that need no source: a week, a month, a quarter, a year.
  for (const n of [1, 7, 12, 24, 52, 90, 365]) out.add(n)
  return out
}

/**
 * Flag every number in the text that is neither a reference nor an allowed kind of number.
 * @param {string} body
 * @param {{ names: string[], allowed: Set<number> }} context
 */
export function checkNumbers(body, { names = [], allowed = new Set() }) {
  // Blank out what may hold digits legitimately, keeping offsets.
  let text = body.replace(REF, m => ' '.repeat(m.length))
  text = text.replace(/```[\s\S]*?```/g, m => m.replace(/[^\n]/g, ' '))
  const blank = re => { text = text.replace(re, m => ' '.repeat(m.length)) }
  for (const n of [...names].filter(n => /\d/.test(n)).sort((a, b) => b.length - a.length)) blank(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
  for (const re of DATE_PATTERNS) blank(re)
  text = text.replace(LIST_NUMBER, (m, sp, d, tail) => sp + ' '.repeat(d.length) + tail)
  text = text.replace(/^(#{1,6}\s*)(\d+(\.\d+)*)/gm, (m, h, d) => h + ' '.repeat(d.length))
  const problems = []
  // A window is fine when the configuration or a cited query uses it. Rules count in days and often start a day
  // after the round number (91 to 365 days is "3 to 12 months"), so a day either side counts too.
  const known = (n, unit) => {
    const days = unit === '周' ? n * 7 : unit === '个月' || unit === '月' ? n * 30 : unit === '年' ? n * 365 : unit === '季度' ? n * 91 : n
    return allowed.has(n) || [days - 1, days, days + 1].some(d => allowed.has(d))
  }
  text = text.replace(WINDOW_RANGE, (m, a, b, unit) => (known(Number(a), unit) && known(Number(b), unit) ? ' '.repeat(m.length) : m))
  for (const m of text.matchAll(WINDOW)) {
    const n = Number(m[2])
    const unit = m[3]
    if (known(n, unit)) {
      text = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length)
      continue
    }
    problems.push({ ...where(body, m.index + m[0].indexOf(m[2])), kind: 'window', text: m[0].trim(), message: `「${m[0].trim()}」和配置、查询参数里的时间窗口对不上` })
    text = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length)
  }
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*\s*(%|万|亿|元|人|笔|次|个|位|单|台|辆|倍)?/g)) {
    problems.push({ ...where(body, m.index), kind: 'number', text: m[0].trim(), message: `「${m[0].trim()}」没有出处：统计数字要写成 {{q几.路径}} 的引用` })
  }
  return problems
}

/** Replace references with formatted values from the frozen results. */
export function render(body, refs) {
  return fill(body, refs, text => text)
}

/**
 * Put the value of every reference in its place. A percentage comes with its sign; a writer who does not know that
 * adds one after the reference, and the text would read "95.7%%". The second sign is dropped.
 */
function fill(body, refs, wrap) {
  return body.replace(REF_THEN_PCT, (m, ref, path, sign) => {
    const r = refs[ref]
    if (!r) return m
    const text = formatValue(resolvePath(r.result, path), path)
    return wrap(text, ref, r) + (sign && !text.endsWith('%') ? sign : '')
  })
}

/**
 * Like render, but each cited number is wrapped as `\u0001ref\u0002text\u0003` so the
 * Client can show where it came from. Line breaks stay where they are.
 */
export function renderMarked(body, refs) {
  return fill(body, refs, (text, ref, r) => `\u0001${ref} · ${r.kind}\u0002${text}\u0003`)
}

const REFUNDS = { net: '退款从收入里减掉（净额）', exclude: '退款不算进收入' }
const SAME_DAY = { each: '同一天同一人同样金额的几笔各算一笔', one: '同一天同一人同样金额的几笔只算一笔' }

/** The appendix every finalized report carries: cutoff, version, 口径, open review items, caveats. */
export function appendix(spec, { asOf, version, reviewOpen, refs }) {
  const m = spec.measures ?? {}
  const lines = ['', '---', '', '### 数据说明', '']
  lines.push(`- 数据截止日：${asOf}；数据版本：第 ${version} 版。`)
  const versions = [...new Set(Object.values(refs).map(r => r.version))]
  if (versions.length > 1) lines.push(`- 注意：引用的查询来自不同的数据版本（${versions.map(v => `第 ${v} 版`).join('、')}）。`)
  lines.push(`- 统计口径：${REFUNDS[m.refunds] ?? REFUNDS.net}${m.refundTypes?.length ? `（退款类型：${m.refundTypes.join('、')}）` : ''}；${m.excludeStatuses?.length ? `状态为 ${m.excludeStatuses.join('、')} 的不算` : '所有状态都算'}；${SAME_DAY[m.sameDayDuplicates] ?? SAME_DAY.each}${m.openStatuses?.length ? `；${m.openStatuses.join('、')} 这类没走完的状态${m.staleStatus === 'ended' ? '按已完成算' : '不算'}` : ''}。`)
  lines.push(`- 分层：${(spec.segments ?? []).map(s => s.name).join('、')}，按顺序第一条命中就归这一层，都不命中的归「其他」。`)
  if (reviewOpen > 0) lines.push(`- 还有 ${reviewOpen} 对疑似同一人没复核，按不同的人算，人数可能偏多。`)
  if (Object.values(refs).some(r => r.kind === 'campaign_effect')) lines.push(`- ${CAMPAIGN_CAVEAT}`)
  lines.push('- 金额单位为元。本报告的数字在定稿时冻结，之后导入的新数据不会改变它们。')
  return lines.join('\n')
}

/** Cited query results flattened into tables for the xlsx export: one sheet per query. */
export function resultTables(refs) {
  const out = []
  for (const [ref, r] of Object.entries(refs).sort((a, b) => a[1].n - b[1].n)) {
    const res = r.result
    const title = `${ref} ${res.name ?? res.kind}`
    if (Array.isArray(res.rows) && res.rows.length) {
      const keys = [...new Set(res.rows.flatMap(x => Object.keys(x).filter(k => typeof x[k] !== 'object' || x[k] === null)))]
      out.push({ ref, title, rows: [keys, ...res.rows.map(x => keys.map(k => x[k] ?? ''))] })
    } else {
      const flat = []
      const walk = (v, p) => { if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k); else if (!Array.isArray(v)) flat.push([p, v ?? '']) }
      walk(res, '')
      out.push({ ref, title, rows: [['项', '值'], ...flat.filter(([k]) => !['columns', 'caveat', 'note'].some(x => k.startsWith(x)))] })
    }
  }
  return out
}
