/**
 * 线索: the funnel of one data version, computed without a model.
 *
 * A lead (线索、商机、留资、报名、咨询) is one expressed interest. Where it stands is read from its result
 * and its follow-up dates as of the cutoff:
 *   成交 / 战败 / 休眠                     the result says so (成交 also when a deal date is there by then)
 *   待首跟                                 no follow-up yet, still within `followDays` of coming in
 *   首跟超时                               no follow-up and older than `followDays`           → 待处理
 *   跟进中                                 followed, last contact within `staleDays`
 *   跟进断了                               followed, nothing for more than `staleDays`        → 待处理
 *   放太久                                 still open `activeDays` or more after coming in (backlog, not a to-do)
 *
 * Rates are over the leads that came in during a window and where those leads stand at the cutoff, so the
 * newest months have had less time to win. Nothing here names an industry; 体验 is a test drive, a trial
 * class or a visit, named by the configuration (`leads.trialName`).
 */
import { daysBetween, dayOf } from './clean.js'
import { leadResult } from './features.js'
import { ENTITIES, LEAD_DEFAULTS, LEAD_RESULTS, LEAD_TRIAL } from './spec.js'

export const LEAD_STATES = Object.freeze({ waiting: '待首跟', late: '首跟超时', following: '跟进中', stalled: '跟进断了', aged: '放太久', won: '成交', lost: '战败', dormant: '休眠' })
/** States a person should act on now. */
export const ACTION_STATES = new Set(['late', 'stalled'])
const STATE_OF_RESULT = { [LEAD_RESULTS.won]: 'won', [LEAD_RESULTS.lost]: 'lost', [LEAD_RESULTS.dormant]: 'dormant' }
const TIME_DIMS = Object.freeze({ month: '留资月份', quarter: '留资季度', year: '留资年份' })
const EMPTY = '（空）'

/** The lead timing settings of a configuration, defaults filled in. */
export const leadSettings = spec => ({ ...LEAD_DEFAULTS, ...(spec?.leads ?? {}) })

/** Which lead fields some table of the configuration maps; screens and queries leave out the rest. */
export function leadFields(spec) {
  const out = new Set()
  for (const t of spec?.tables ?? []) for (const f of Object.keys(t.entities?.lead ?? {})) out.add(f)
  return out
}
const leadTables = spec => (spec?.tables ?? []).filter(t => t.entities?.lead).map(t => t.name)

/** What the funnel can say with the columns this configuration has. */
export function leadAbilities(spec) {
  const f = leadFields(spec)
  return { follow: f.has('firstFollow') || f.has('lastFollow'), firstFollow: f.has('firstFollow'), trial: f.has('trial'), result: f.has('result') || f.has('wonDate'), level: f.has('level') }
}

/** Where a lead stands at the cutoff (a key of LEAD_STATES). */
export function leadState(l, s, asOf, can) {
  const done = STATE_OF_RESULT[leadResult(l, asOf)]
  if (done) return done
  const age = daysBetween(dayOf(l.date), asOf)
  // A window of N days holds ages 0 to N-1, so a lead N days old is past it.
  if (age >= s.activeDays) return 'aged'
  if (!can.follow) return 'following'
  const last = [l.lastFollow, l.firstFollow].filter(d => d && dayOf(d) <= asOf).sort().at(-1)
  if (!last) return age > s.followDays ? 'late' : 'waiting'
  return daysBetween(dayOf(last), asOf) > s.staleDays ? 'stalled' : 'following'
}

const stamp = (day, at) => Date.parse(`${at ?? `${dayOf(day)}T00:00`}Z`)

/** Hours from coming in to the first follow-up; whole days when a side has no time. Null when unknown or negative. */
export function followHours(l) {
  if (!l.firstFollow || !l.date) return null
  const both = l.at && l.firstFollowAt
  const h = both ? (stamp(l.date, l.at) - stamp(l.firstFollow, l.firstFollowAt)) / -3600000 : daysBetween(dayOf(l.date), dayOf(l.firstFollow)) * 24
  return Number.isFinite(h) && h >= 0 ? Math.round(h * 10) / 10 : null
}

/**
 * The leads of a version that came in by the cutoff, each with where it stands (`state`), whether it was
 * followed at all (`followed`), how fast (`hours`) and whether the first follow-up came on time (`onTime`).
 */
export function prepareLeads(data, spec, asOf) {
  const s = leadSettings(spec)
  const can = leadAbilities(spec)
  const out = []
  for (const l of data.leads ?? []) {
    if (!l.date || dayOf(l.date) > asOf) continue
    const state = leadState(l, s, asOf, can)
    const result = leadResult(l, asOf)
    const hasFollow = [l.firstFollow, l.lastFollow].some(d => d && dayOf(d) <= asOf)
    const hours = can.firstFollow && l.firstFollow && dayOf(l.firstFollow) <= asOf ? followHours(l) : null
    // On time: followed within followDays; leads still inside that window and not yet followed are left out.
    const onTime = !can.follow || state === 'waiting' ? null : hasFollow && l.firstFollow ? daysBetween(dayOf(l.date), dayOf(l.firstFollow)) <= s.followDays : false
    out.push({ ...l, state, result, followed: hasFollow || result !== LEAD_RESULTS.open || l.trial === LEAD_TRIAL.yes, hours, onTime })
  }
  return out
}

// ---- dimensions and filters -------------------------------------------------------

/** Dimensions leads can be split and filtered by, for one configuration: `key → 名字`. */
export function leadDimensions(spec) {
  const f = leadFields(spec)
  const s = leadSettings(spec)
  const out = {}
  // 归属方 goes by the dataset's own word for it (门店、经销商、校区).
  for (const k of ['channel', 'source', 'campaign', 'owner', 'rep', 'product', 'level']) if (f.has(k)) out[k] = k === 'owner' ? spec?.labels?.owner ?? ENTITIES.lead.fields[k].name : ENTITIES.lead.fields[k].name
  if (f.has('result') || f.has('wonDate')) out.result = '结果'
  if (f.has('trial')) out.trial = `有没有${s.trialName}`
  out.state = '现在的状态'
  if (leadTables(spec).length > 1) out.table = '来自哪张表'
  for (const t of spec?.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'lead' && x.type === 'category') out[`extra.${x.key}`] = x.name
  return { ...out, ...TIME_DIMS }
}

/** The value of a lead along a dimension: a string, or for `table` the list of tables it came from. */
export function leadKey(l, dim) {
  if (dim === 'month') return dayOf(l.date).slice(0, 7)
  if (dim === 'quarter') return `${l.date.slice(0, 4)} Q${Math.floor((Number(l.date.slice(5, 7)) - 1) / 3) + 1}`
  if (dim === 'year') return l.date.slice(0, 4)
  if (dim === 'state') return LEAD_STATES[l.state]
  if (dim === 'table') return l.tables ?? []
  if (dim.startsWith('extra.')) return l.extra?.[dim.slice(6)] ?? null
  return l[dim] ?? null
}

const matches = (v, want) => (Array.isArray(v) ? v.some(x => want.includes(x)) : want.includes(v ?? EMPTY))

/**
 * Check a lead filter `{ dim: value | [values] }`. `state` takes the Chinese state names.
 * @returns {{ ok: true, filter: object } | { ok: false, message: string }}
 */
export function checkLeadFilter(spec, input) {
  if (input === undefined || input === null) return { ok: true, filter: {} }
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: 'lead 写成 { 维度: 值 } 或 { 维度: [值, ...] }' }
  const dims = leadDimensions(spec)
  const out = {}
  for (const [k, v] of Object.entries(input)) {
    if (!Object.hasOwn(dims, k)) return { ok: false, message: `线索只能按这些筛：${Object.entries(dims).map(([d, n]) => `${d}（${n}）`).join('、')}` }
    const list = (Array.isArray(v) ? v : [v]).map(x => String(x))
    if (list.length === 0 || list.length > 30) return { ok: false, message: `lead.${k} 写 1～30 个值` }
    if (k === 'state' && list.some(x => !Object.values(LEAD_STATES).includes(x))) return { ok: false, message: `state 只能是：${Object.values(LEAD_STATES).join('、')}` }
    out[k] = list
  }
  return { ok: true, filter: out }
}

/** Whether a lead passes a checked filter. */
export const leadPasses = (l, filter) => Object.entries(filter ?? {}).every(([k, want]) => matches(leadKey(l, k), want))

// ---- numbers -------------------------------------------------------------------------

const pctOf = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null)
function quantile(list, q) {
  if (list.length === 0) return null
  const s = [...list].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return Math.round((s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)) * 10) / 10
}

/** Counts and rates of a set of prepared leads. Rates the configuration cannot know are null. */
export function leadStats(list, can) {
  const states = Object.fromEntries(Object.keys(LEAD_STATES).map(k => [k, 0]))
  let followed = 0
  let trial = 0
  let onTime = 0
  let onTimeBase = 0
  const hours = []
  for (const l of list) {
    states[l.state]++
    if (l.followed) followed++
    if (l.trial === LEAD_TRIAL.yes) trial++
    if (l.onTime !== null) { onTimeBase++; if (l.onTime) onTime++ }
    if (l.hours !== null) hours.push(l.hours)
  }
  const n = list.length
  const action = states.late + states.stalled
  return {
    leads: n,
    followed,
    trial: can.trial ? trial : null,
    won: states.won,
    lost: states.lost,
    dormant: states.dormant,
    open: n - states.won - states.lost - states.dormant,
    action,
    states,
    followPct: pctOf(followed, n),
    onTimePct: can.follow ? pctOf(onTime, onTimeBase) : null,
    trialPct: can.trial ? pctOf(trial, n) : null,
    winPct: can.result ? pctOf(states.won, n) : null,
    lostPct: can.result ? pctOf(states.lost, n) : null,
    followHours: can.firstFollow ? { median: quantile(hours, 0.5), p75: quantile(hours, 0.75), n: hours.length } : null,
  }
}

/** One lead metric (analysis.js METRICS with needs 'lead') over a set of prepared leads. */
export function leadMetric(metric, list, can) {
  switch (metric) {
    case 'leads': return list.length
    case 'lead_won': return list.filter(l => l.state === 'won').length
    case 'lead_action': return list.filter(l => ACTION_STATES.has(l.state)).length
    case 'lead_win_rate': return can.result ? pctOf(list.filter(l => l.state === 'won').length, list.length) : null
    case 'lead_follow_rate': return pctOf(list.filter(l => l.followed).length, list.length)
    case 'lead_trial_rate': return can.trial ? pctOf(list.filter(l => l.trial === LEAD_TRIAL.yes).length, list.length) : null
    case 'lead_follow_hours': return can.firstFollow ? quantile(list.map(l => l.hours).filter(h => h !== null), 0.5) : null
    default: return null
  }
}

/** The funnel steps of a stats object, as far as the configuration can tell. */
export function funnelSteps(st, can, trialName) {
  const step = (key, name, count) => ({ key, name, count, pct: pctOf(count, st.leads) })
  return [
    step('leads', '线索', st.leads),
    step('followed', '跟进过', st.followed),
    ...(can.trial ? [step('trial', trialName, st.trial)] : []),
    ...(can.result ? [step('won', '成交', st.won)] : []),
  ]
}

/** Prepared leads grouped by a dimension: `[{ key, list }]`, biggest first (time in order). */
export function groupLeads(list, dim) {
  const groups = new Map()
  for (const l of list) {
    const v = leadKey(l, dim)
    for (const k of Array.isArray(v) ? (v.length ? v : [EMPTY]) : [v ?? EMPTY]) {
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(l)
    }
  }
  const time = Object.hasOwn(TIME_DIMS, dim)
  return [...groups].map(([key, items]) => ({ key, list: items })).sort((a, b) => (time ? String(a.key).localeCompare(String(b.key)) : b.list.length - a.list.length))
}

/** Leads per month for the last `months` months before the cutoff, with where they stand now. */
export function monthlyLeads(list, asOf, can, months = 12) {
  const last = asOf.slice(0, 7)
  const keys = []
  for (let i = months - 1; i >= 0; i--) { const d = new Date(`${last}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); keys.push(d.toISOString().slice(0, 7)) }
  const by = new Map(keys.map(k => [k, []]))
  for (const l of list) by.get(dayOf(l.date).slice(0, 7))?.push(l)
  return keys.map(k => { const st = leadStats(by.get(k), can); return { key: k, leads: st.leads, won: st.won, winPct: st.winPct, followPct: st.followPct, onTimePct: st.onTimePct, trialPct: st.trialPct, medianHours: st.followHours?.median ?? null } })
}

// ---- findings ------------------------------------------------------------------------

const fmt = n => Number(n).toLocaleString('en-US')
const hoursText = h => (h === null ? '—' : h < 1 ? '不到 1 小时' : h < 48 ? `${fmt(h)} 小时` : `${fmt(Math.round((h / 24) * 10) / 10)} 天`)

/**
 * What the lead funnel shows this time, and what to do. Every finding points at a set of leads (`leads`: a
 * lead filter) that the lead page can list and the analyst can be asked about.
 * @param {object[]} all - prepared leads (prepareLeads).
 * @param {object} spec
 * @param {string} asOf
 */
export function leadInsights(all, spec, asOf) {
  const s = leadSettings(spec)
  const can = leadAbilities(spec)
  const dims = leadDimensions(spec)
  const items = []
  const add = x => items.push(x)
  const since = days => all.filter(l => daysBetween(dayOf(l.date), asOf) < days)
  const floor = Math.max(5, Math.round(all.length * 0.001))

  // Leads nobody picked up: the cheapest win there is.
  const late = all.filter(l => l.state === 'late').length
  if (late >= floor) {
    add({ id: 'lead:late', tone: 'bad', count: late, leads: { state: [LEAD_STATES.late] },
      title: `${fmt(late)} 条线索留资超过 ${s.followDays} 天还没人跟进`,
      detail: `都是近 ${s.activeDays} 天进来、到截止日还没有任何跟进记录的线索。`,
      suggest: '线索越晚跟越凉。先按留资时间从近到远打一遍；再拆开看是哪些归属方、跟进人压着没跟。' })
  }
  const stalled = all.filter(l => l.state === 'stalled').length
  if (stalled >= floor) {
    add({ id: 'lead:stalled', tone: 'warn', count: stalled, leads: { state: [LEAD_STATES.stalled] },
      title: `${fmt(stalled)} 条线索跟进断了`,
      detail: `跟进过，但已经超过 ${s.staleDays} 天没再联系，结果还没定。`,
      suggest: '跟过一次就停的，多半卡在价格、时机或者没约上。先找级别高、跟进过多次的，换个理由再约一次。' })
  }

  // Fewer or more leads than the 30 days before.
  const now = since(30).length
  const before = all.filter(l => { const d = daysBetween(dayOf(l.date), asOf); return d >= 30 && d < 60 }).length
  if (Math.max(now, before) >= 20 && before > 0) {
    const change = Math.round(((now - before) / before) * 1000) / 10
    if (Math.abs(change) >= 20) {
      add({ id: 'lead:trend', tone: change > 0 ? 'good' : 'warn', count: now, leads: null,
        title: `近 30 天进来 ${fmt(now)} 条线索，比前 30 天${change > 0 ? '多' : '少'}了 ${Math.abs(change)}%`,
        detail: `${fmt(before)} → ${fmt(now)}。`,
        suggest: change > 0 ? '看看多出来的是哪个渠道、哪个活动带来的，跟进的人手够不够。' : '先确认最近的数据导全了没有；导全了的话，按渠道拆开看是哪里少了。' })
    }
  }

  // The channel that wins most often against the one that wins least (last 365 days, big enough groups).
  const dim = dims.channel ? 'channel' : dims.source ? 'source' : null
  if (can.result && dim) {
    const year = since(365)
    const rows = groupLeads(year, dim).filter(g => g.key !== EMPTY && g.list.length >= s.minGroup).map(g => ({ key: g.key, n: g.list.length, rate: leadMetric('lead_win_rate', g.list, can) })).filter(g => g.rate !== null)
    if (rows.length >= 2) {
      const best = rows.reduce((a, b) => (b.rate > a.rate ? b : a))
      const worst = rows.reduce((a, b) => (b.rate < a.rate ? b : a))
      if (best.rate >= 1 && best.rate >= worst.rate * 1.5 && best.key !== worst.key) {
        add({ id: `lead:best:${dim}`, tone: 'info', count: best.n, leads: { [dim]: [best.key] },
          title: `近一年「${best.key}」来的线索成交率 ${best.rate}%，「${worst.key}」只有 ${worst.rate}%`,
          detail: `按${dims[dim]}拆，每组至少 ${s.minGroup} 条才比。成交率是这些线索到截止日为止成交了多少，最近进来的还没走完。`,
          suggest: '成交率高的渠道值得多投人和预算；低的先看是线索本身不准，还是跟进没跟上（对比首跟时长和跟进率）。' })
      }
    }
  }

  // The owner who picks leads up slowest.
  if (can.firstFollow && dims.owner) {
    const year = since(365)
    const overall = leadMetric('lead_follow_hours', year, can)
    const rows = groupLeads(year, 'owner').filter(g => g.key !== EMPTY).map(g => ({ key: g.key, n: g.list.filter(l => l.hours !== null).length, h: leadMetric('lead_follow_hours', g.list, can) })).filter(g => g.n >= s.minGroup && g.h !== null)
    const slow = rows.sort((a, b) => b.h - a.h)[0]
    if (slow && overall !== null && slow.h >= Math.max(overall * 2, 24)) {
      add({ id: 'lead:slow', tone: 'warn', count: slow.n, leads: { owner: [slow.key] },
        title: `「${slow.key}」首次跟进中位要 ${hoursText(slow.h)}，整体是 ${hoursText(overall)}`,
        detail: `近一年的线索，跟进过的至少 ${s.minGroup} 条才比。`,
        suggest: '跟得慢的归属方，先看是人手不够还是线索没及时分下去；把超时没跟的那批名单直接发给他们。' })
    }
  }
  return items
}
