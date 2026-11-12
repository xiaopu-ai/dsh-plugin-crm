/**
 * 派生特征和分层: every number a rule looks at, computed per customer as of a
 * date. Nothing here names an industry; the configuration's segments and flags
 * are evaluated over the closed feature list in spec.js.
 *
 * Days count back from the cutoff: a window of 365 holds the events 0–364 days
 * before it. Money is in yuan in rules and in cents in the data.
 */
import { daysBefore, daysBetween, dayOf } from './clean.js'
import { LEAD_RESULTS, PERIODS, capabilities, missingEntities } from './spec.js'

const OTHER = '其他'
export { OTHER }

const ago = (asOf, d) => daysBetween(dayOf(d), asOf)
const asList = v => (v === undefined || v === null ? null : Array.isArray(v) ? v : [v])

/** Group one data version by customer: `cid → { c, txns, assets, touches, leads }`. */
export function byCustomer(data) {
  const out = new Map(data.customers.map(c => [c.cid, { c, txns: [], assets: [], touches: [], leads: [] }]))
  for (const t of data.transactions) if (t.cid && out.has(t.cid)) out.get(t.cid).txns.push(t)
  for (const a of data.assets) if (a.cid && out.has(a.cid)) out.get(a.cid).assets.push(a)
  for (const t of data.touches) if (t.cid && out.has(t.cid)) out.get(t.cid).touches.push(t)
  for (const l of data.leads ?? []) if (l.cid && out.has(l.cid)) out.get(l.cid).leads.push(l)
  return out
}

/** Every dated thing about a customer up to a date, oldest first. */
function seenDates(entry, asOf) {
  const inTime = d => d && dayOf(d) <= asOf
  return [entry.c.firstSeen, ...entry.txns.map(t => t.date), ...entry.touches.map(t => t.date), ...entry.assets.map(a => a.start), ...(entry.leads ?? []).map(l => l.date)].filter(inTime).map(dayOf).sort()
}

/** The earliest dated thing about a customer (`YYYY-MM-DD`), or null. */
export function firstSeenOf(entry) {
  if (!entry) return null
  const all = [entry.c.firstSeen, ...entry.txns.map(t => t.date), ...entry.touches.map(t => t.date), ...entry.assets.map(a => a.start), ...(entry.leads ?? []).map(l => l.date)].filter(Boolean).map(dayOf).sort()
  return all[0] ?? null
}

/** Whether a customer is on record by a date: something dated by then, or nothing dated at all. */
export function existsBy(entry, date) {
  const all = [entry.c.firstSeen, ...entry.txns.map(t => t.date), ...entry.touches.map(t => t.date), ...entry.assets.map(a => a.start), ...(entry.leads ?? []).map(l => l.date)].filter(Boolean)
  return all.length === 0 || all.some(d => dayOf(d) <= date)
}

/**
 * The features of one customer as of a date, computed on demand.
 * Transactions count when the build counted them (status, refunds) and they are dated by `asOf`.
 * @returns {(feature: string, args?: any[]) => number | boolean | string | null}
 */
export function featuresOf(entry, asOf) {
  const inTime = d => d && dayOf(d) <= asOf
  const counted = entry.txns.filter(t => t.counted && inTime(t.date))
  const real = counted.filter(t => !t.refund)
  const typed = (list, types) => { const l = asList(types); return l === null ? list : list.filter(t => l.includes(t.type)) }
  const assets = entry.assets.filter(a => !a.start || dayOf(a.start) <= asOf)
  const touches = entry.touches.filter(t => inTime(t.date))
  const channel = (list, ch) => { const l = asList(ch); return l === null ? list : list.filter(t => l.includes(t.channel)) }
  const within = (list, w) => list.filter(t => ago(asOf, t.date) < w)
  // A lead's result is where it stands in the newest export; rules as of an earlier day read it the same way.
  const leads = (entry.leads ?? []).filter(l => inTime(l.date))
  const withResult = (list, r) => { const l = asList(r); return l === null ? list : list.filter(x => l.includes(leadResult(x, asOf))) }
  // `where` narrows the holdings a feature looks at to those passing every condition.
  const held = where => (where?.length ? assets.filter(a => where.every(w => assetPasses(a, w, asOf))) : assets)
  const memo = new Map()
  const compute = (feature, args, where) => {
    switch (feature) {
      case 'days_since_last_txn': { const l = typed(real, args[0]); return l.length ? Math.min(...l.map(t => ago(asOf, t.date))) : null }
      case 'txn_count': return within(typed(real, args[1]), args[0]).length
      case 'amount': return within(typed(counted, args[1]), args[0]).reduce((a, t) => a + t.amount, 0) / 100
      case 'active_periods': return new Set(within(typed(real, args[2]), args[0]).map(t => Math.floor(ago(asOf, t.date) / PERIODS[args[1]]))).size
      case 'days_since_first_seen': { const s = seenDates(entry, asOf); return s.length ? ago(asOf, s[0]) : null }
      case 'asset_count': return held(where).length
      case 'asset_age_days': { const s = held(where).map(a => a.start).filter(Boolean).map(dayOf).sort(); return s.length ? ago(asOf, s[0]) : null }
      case 'asset_days_to_end': {
        const withEnd = held(where).filter(a => a.end).sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))
        return withEnd.length ? -ago(asOf, withEnd[0].end) : null
      }
      case 'days_since_last_touch': { const l = channel(touches, args[0]); return l.length ? Math.min(...l.map(t => ago(asOf, t.date))) : null }
      case 'touch_count': return within(channel(touches, args[1]), args[0]).length
      case 'campaign_count': return new Set(within(touches, args[0]).filter(t => t.campaign).map(t => t.campaign)).size
      case 'has_txn': return typed(real, args[0]).length > 0
      case 'field': return fieldOf(entry.c, args[0])
      case 'tag_count': { const v = fieldOf(entry.c, args[0]); return Array.isArray(v) ? v.length : v === null || v === '' ? 0 : 1 }
      case 'days_since_field': { const d = fieldOf(entry.c, args[0]); return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? ago(asOf, d) : null }
      case 'lead_count': return within(withResult(leads, args[1]), args[0]).length
      case 'days_since_last_lead': return leads.length ? Math.min(...leads.map(l => ago(asOf, l.date))) : null
      case 'has_lead': return withResult(leads, args[0]).length > 0
      default: return null
    }
  }
  return (feature, args = [], where = undefined) => {
    const key = `${feature}|${JSON.stringify(args)}${where ? `|${JSON.stringify(where)}` : ''}`
    if (!memo.has(key)) memo.set(key, compute(feature, args, where))
    return memo.get(key)
  }
}

/** A field of one holding by key: `status`, `model`, … or `extra.<key>`. */
const assetField = (a, key) => (typeof key !== 'string' ? null : key.startsWith('extra.') ? a.extra?.[key.slice(6)] ?? null : a[key] ?? null)

/** Whether one holding passes one `where` condition: a field compared, or the days to or since one of its dates. */
export function assetPasses(a, w, asOf) {
  if (w.field !== undefined) return compare(assetField(a, w.field), w.op, w.value)
  const d = assetField(a, w.days_to ?? w.days_since)
  if (typeof d !== 'string' || !/^\d{4}-\d{2}/.test(d)) return false
  return compare(w.days_to !== undefined ? -ago(asOf, d) : ago(asOf, d), w.op, w.value)
}

/**
 * One comparison. `= ""` asks whether a value is blank and `!= ""` whether it is filled; otherwise a missing
 * value never matches, except `lacks` (someone with no tags lacks every tag). A multi-value field is a set:
 * `has` / `=` look for one value in it, `in` for any of several.
 */
export function compare(x, op, v) {
  const blank = x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0)
  if (v === '' && (op === '=' || op === '!=')) return blank === (op === '=')
  if (op === 'lacks') return blank || !(Array.isArray(x) ? x.includes(v) : x === v)
  if (blank) return false
  if (Array.isArray(x)) {
    if (op === 'has' || op === '=') return x.includes(v)
    if (op === '!=') return !x.includes(v)
    if (op === 'in') return Array.isArray(v) && v.some(k => x.includes(k))
    return false
  }
  switch (op) {
    case '=': case 'has': return x === v
    case '!=': return x !== v
    case '>': return x > v
    case '>=': return x >= v
    case '<': return x < v
    case '<=': return x <= v
    case 'between': return x >= v[0] && x <= v[1]
    case 'in': return Array.isArray(v) && v.includes(x)
    default: return false
  }
}

/** A lead's result as of a date: 成交 when it says so or carries a deal date by then; no result is still being followed. */
export function leadResult(l, asOf) {
  if (l.result === LEAD_RESULTS.won || (l.wonDate && dayOf(l.wonDate) <= asOf)) return LEAD_RESULTS.won
  return l.result ?? LEAD_RESULTS.open
}

/** A customer field by key: `owner`, `city`, … or `extra.<key>`. */
export function fieldOf(c, key) {
  if (typeof key !== 'string') return null
  if (key.startsWith('extra.')) return c.extra?.[key.slice(6)] ?? null
  return c[key] ?? null
}

/** Evaluate a rule (two levels of all/any at most) over a feature getter. See `compare` for how values match. */
export function evalRule(rule, f) {
  const test = c => (Array.isArray(c.all) || Array.isArray(c.any) ? evalRule(c, f) : compare(f(c.feature, c.args ?? [], c.where), c.op, c.value))
  return Array.isArray(rule.all) ? rule.all.every(test) : rule.any.some(test)
}

/**
 * Segment and flag every customer as of a date.
 * Rules whose entities this dataset has no table for are switched off and reported.
 * @returns {{ asOf, of: Map<string,string>, flagsOf: Map<string,string[]>, counts: object, flags: object, disabled: { kind, name, missing }[], total: number }}
 */
export function segmentAll(index, spec, asOf, { onlyExisting = false, left = null } = {}) {
  const fed = capabilities(spec)
  const disabled = []
  const segments = spec.segments.filter(s => { const m = missingEntities(s, fed); if (m.length) disabled.push({ kind: 'segment', name: s.name, missing: m }); return m.length === 0 })
  const flags = spec.flags.filter(s => { const m = missingEntities(s, fed); if (m.length) disabled.push({ kind: 'flag', name: s.name, missing: m }); return m.length === 0 })
  const counts = Object.fromEntries([...spec.segments.map(s => [s.name, 0]), [OTHER, 0]])
  const flagCounts = Object.fromEntries(spec.flags.map(f => [f.name, 0]))
  const of = new Map()
  const flagsOf = new Map()
  let total = 0
  let leftCount = 0
  for (const [cid, entry] of index) {
    if (onlyExisting && !existsBy(entry, asOf)) continue
    // 已离开 (transferred, or asked not to be contacted) is not part of any share.
    if (left?.has(cid)) { of.set(cid, LEFT_SEGMENT); flagsOf.set(cid, []); leftCount++; continue }
    total++
    const f = featuresOf(entry, asOf)
    const seg = segments.find(s => evalRule(s, f))
    const name = seg ? seg.name : OTHER
    counts[name]++
    of.set(cid, name)
    const mine = flags.filter(fl => evalRule(fl, f)).map(fl => fl.name)
    for (const n of mine) flagCounts[n]++
    flagsOf.set(cid, mine)
  }
  return { asOf, of, flagsOf, counts, flags: flagCounts, disabled, total, left: leftCount }
}
export const LEFT_SEGMENT = '已离开'

/**
 * Lifecycle movement: segments as of `days` before the cutoff against now.
 * Customers not on record back then start from 「新出现」.
 */
/** Where someone who did not exist yet `days` ago comes from in the flows. */
export const NEW_ARRIVAL = '新出现'

export function flows(index, spec, asOf, days = 30, { left = null, before: known = null } = {}) {
  const then = daysBefore(asOf, days)
  const before = known ?? segmentAll(index, spec, then, { onlyExisting: true })
  const now = segmentAll(index, spec, asOf, { left })
  const NEW = NEW_ARRIVAL
  const moves = new Map()
  for (const [cid, to] of now.of) {
    const from = before.of.get(cid) ?? NEW
    const k = `${from}\u0001${to}`
    moves.set(k, (moves.get(k) ?? 0) + 1)
  }
  const list = [...moves].map(([k, count]) => { const [from, to] = k.split('\u0001'); return { from, to, count } }).sort((a, b) => b.count - a.count)
  return { from: then, to: asOf, days, before: before.counts, now: now.counts, moves: list, stayed: list.filter(m => m.from === m.to).reduce((a, m) => a + m.count, 0), moved: list.filter(m => m.from !== m.to && m.from !== NEW).reduce((a, m) => a + m.count, 0), arrived: list.filter(m => m.from === NEW).reduce((a, m) => a + m.count, 0) }
}

export const CAMPAIGN_CAVEAT = '这是参加和没参加的差别，不等于活动带来的增量。'

/**
 * 活动效果: participants against non-participants of the same segments as of the day before.
 * @param {Map} index - from byCustomer.
 * @param {object} data - the version (campaigns, touches).
 * @param {object} spec - finalized configuration.
 * @param {string} name - campaign name.
 * @param {string} asOf - the version's cutoff.
 */
export function campaignEffect(index, data, spec, name, asOf) {
  const camp = data.campaigns.find(c => c.name === name)
  if (!camp) return { error: 'no-campaign', campaigns: data.campaigns.map(c => c.name) }
  const dates = data.touches.filter(t => t.campaign === name && t.date).map(t => dayOf(t.date)).sort()
  const start = camp.start ? dayOf(camp.start) : dates[0] ?? null
  const end = camp.end ? dayOf(camp.end) : start
  if (!start) return { error: 'no-dates', name }
  const effectDays = spec.campaign?.effectDays ?? 30
  const minGroup = spec.campaign?.minGroup ?? 30
  const before = daysBefore(start, 1)
  const segBefore = segmentAll(index, spec, before).of
  const isIn = entry => entry.touches.some(t => t.campaign === name)
  const part = []
  const rest = []
  for (const [cid, entry] of index) (isIn(entry) ? part : rest).push([cid, entry])
  const partSegs = new Set(part.map(([cid]) => segBefore.get(cid)))
  const control = rest.filter(([cid]) => partSegs.has(segBefore.get(cid)))
  const windowEnd = daysBefore(end, -effectDays)
  const bought = entry => entry.txns.filter(t => t.counted && t.date && dayOf(t.date) > end && dayOf(t.date) <= windowEnd)
  const rate = list => {
    const buyers = list.filter(([, e]) => bought(e).some(t => !t.refund)).length
    const cents = list.reduce((a, [, e]) => a + bought(e).reduce((b, t) => b + t.amount, 0), 0)
    return { people: list.length, buyers, cents, buyRatePct: list.length ? round1((buyers / list.length) * 100) : null, amount: cents / 100, perPerson: list.length ? Math.round(cents / list.length) / 100 : null }
  }
  const bySegment = [...partSegs].map(s => ({ segment: s, participants: part.filter(([cid]) => segBefore.get(cid) === s).length, control: control.filter(([cid]) => segBefore.get(cid) === s).length }))
  return {
    name,
    type: camp.type ?? null,
    start,
    end,
    budget: camp.budget === null || camp.budget === undefined ? null : camp.budget / 100,
    segmentDate: before,
    windowEnd,
    complete: windowEnd <= asOf,
    effectDays,
    participants: rate(part),
    control: rate(control),
    bySegment,
    conclusive: part.length >= minGroup && control.length >= minGroup,
    minGroup,
    caveat: CAMPAIGN_CAVEAT,
  }
}

export const round1 = x => Math.round(x * 10) / 10
