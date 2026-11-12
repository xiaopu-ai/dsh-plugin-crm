/**
 * 分析查询: the closed list of questions the analyst mode (and the board) can
 * ask of one data version. Every parameter is checked against a closed list;
 * every answer is numbers and category values only. Customers appear as stable
 * codes, never as names or contact details.
 *
 * Units in results: `unit` names the unit of `value` (yuan / people / count);
 * keys ending in `Pct` are percentages; `amount`, `perPerson` are yuan.
 */
import { daysBefore, dayOf } from './clean.js'
import { CAMPAIGN_CAVEAT, LEFT_SEGMENT, NEW_ARRIVAL, OTHER, byCustomer, campaignEffect, existsBy, featuresOf, fieldOf, flows, round1, segmentAll } from './features.js'
import { batchView, GOAL_REACHED, goalText } from './lists.js'
import { maskText } from './profile.js'
import { CrmError, } from './read.js'
import { ACTION_STATES, LEAD_STATES, checkLeadFilter, funnelSteps, groupLeads, leadAbilities, leadDimensions, leadKey, leadMetric, leadPasses, leadSettings, leadStats, monthlyLeads, prepareLeads } from './leads.js'
import { ENTITIES, LEAD_RESULTS, capabilities, customerFieldKeys, customerTagFieldKeys, describeRule, dictValues, entitiesOf, fieldNames, ownerAttributes } from './spec.js'
import { NO_OWNER, hasOwners, ownerBoard, ownerDetail } from './owners.js'
import { reachBoard, reachChannels } from './reach.js'

export const QUERY_KINDS = Object.freeze({
  segments: '各层人数和占比，可带上近 30 天各层之间的流动',
  metric: '某个指标在一段时间里的值',
  breakdown: '某个指标按一个维度拆开',
  compare: '同一个指标在两段时间的值、差值和变化率（报告里「增长了多少」只能从这里来）',
  cohort: '按首次出现的月份分组，看后来有没有交易、有没有复购',
  campaign_effect: '一场活动的参加组和对照组的交易率、金额',
  quality: '数据质量和对账结果',
  sample: '遮过的样例行，最多 20 行',
  list_effect: '一份名单的结果：各结果人数；有目标标记的名单（judgedBy: goal）看后来的数据里多少人带上了那个标记，没有的看交易确认的比例；都和同层没进名单的人比',
  lead_funnel: '线索漏斗：一段时间进来的线索跟进过多少、体验多少、成交多少，首次跟进多快，现在各状态多少条；可按一个线索维度拆开',
  reach: '触达覆盖：标成触达渠道的那几个标记，各覆盖了多少客户、多少人哪个渠道都没有；按分层、按归属方或归属方的属性拆开',
  owner_board: '归属方（门店、经销商）横向对比：每家多少客户、这段时间的交易和线索、跟进快不快、成交率、待处理的线索、每个标记各多少人；可按归属方的属性（大区、负责人）汇总，也可只看一家',
})

export const METRICS = Object.freeze({
  revenue: { name: '交易金额', unit: 'yuan', needs: 'transaction', money: true },
  txn_count: { name: '交易笔数（不含退款）', unit: 'count', needs: 'transaction' },
  buyers: { name: '有交易的客户数', unit: 'people', needs: 'transaction' },
  avg_order: { name: '平均每笔金额（不含退款）', unit: 'yuan', needs: 'transaction', money: true },
  refund_amount: { name: '退款金额', unit: 'yuan', needs: 'transaction', money: true },
  new_customers: { name: '新出现的客户数', unit: 'people', needs: 'customer' },
  customers: { name: '客户总数（截至时间段末）', unit: 'people', needs: 'customer' },
  touches: { name: '互动次数', unit: 'count', needs: 'touch' },
  touched_customers: { name: '有互动的客户数', unit: 'people', needs: 'touch' },
  new_assets: { name: '新增持有物（开始日期在时间段内）', unit: 'count', needs: 'asset' },
  leads: { name: '新线索数（按留资时间）', unit: 'count', needs: 'lead' },
  lead_won: { name: '成交的线索数（这段时间进来的线索，到截止日成交了多少）', unit: 'count', needs: 'lead' },
  lead_win_rate: { name: '线索成交率', unit: 'pct', needs: 'lead' },
  lead_follow_rate: { name: '线索跟进率', unit: 'pct', needs: 'lead' },
  lead_trial_rate: { name: '线索体验率', unit: 'pct', needs: 'lead' },
  lead_follow_hours: { name: '首次跟进用时（中位数）', unit: 'hours', needs: 'lead' },
  lead_action: { name: '待处理的线索（首跟超时、跟进断了）', unit: 'count', needs: 'lead' },
})
const LEAD_METRICS = new Set(Object.keys(METRICS).filter(k => METRICS[k].needs === 'lead'))
const LEAD_ADDITIVE = new Set(['leads', 'lead_won', 'lead_action'])
const PEOPLE_METRICS = new Set(['buyers', 'new_customers', 'customers', 'touched_customers'])
const TXN_METRICS = new Set(['revenue', 'txn_count', 'buyers', 'avg_order', 'refund_amount'])
const MAX_ROWS = 30
const UNIT_WORDS = { yuan: '元', people: '人', count: '次', pct: '%', hours: '小时' }
const SAMPLE_MAX = 20
const DATE = /^\d{4}-\d{2}-\d{2}$/

const bad = (message, extra = {}) => { throw Object.assign(new CrmError('bad-query', message), { details: extra }) }

/** Dimensions a metric can be split by, for one configuration. */
export function dimensions(spec) {
  const fed = entitiesOf(spec)
  const label = e => spec.labels?.[e] ?? ENTITIES[e].name
  const out = { segment: '分层', flag: '标记', month: '月份', quarter: '季度', year: '年份' }
  for (const k of customerFieldKeys(spec)) {
    if (k.startsWith('extra.')) {
      const x = spec.tables.flatMap(t => t.extra ?? []).find(e => e.entity === 'customer' && `extra.${e.key}` === k)
      out[`customer.${k}`] = `${label('customer')}的${x?.name ?? k.slice(6)}`
    } else out[`customer.${k}`] = `${label('customer')}的${ENTITIES.customer.fields[k].name}`
  }
  if (fed.has('transaction')) for (const k of ['type', 'channel', 'owner', 'status']) out[`transaction.${k}`] = `${label('transaction')}的${ENTITIES.transaction.fields[k].name}`
  if (fed.has('touch')) for (const k of ['channel', 'campaign']) out[`touch.${k}`] = `${label('touch')}的${ENTITIES.touch.fields[k].name}`
  if (fed.has('lead')) for (const [k, n] of Object.entries(leadDimensions(spec))) if (!['month', 'quarter', 'year'].includes(k)) out[`lead.${k}`] = `${label('lead')}的${n}`
  return out
}

/** Everything a query reads, built once per data version. */
export function context(data, spec, { recon = null, review = null, pending = null, code = cid => cid, privacy = {}, lists = null, today = data.asOf } = {}) {
  const index = byCustomer(data)
  const left = lists ? new Set(Object.keys(lists.left ?? {})) : null
  let seg = null
  let then = null
  let leads = null
  return {
    data, spec, index, asOf: data.asOf, version: data.version, recon, review, pending, code, privacy, lists, left, today,
    /** The leads that came in by the cutoff, each with where it stands (leads.js). */
    get leads() { return (leads ??= prepareLeads(data, spec, data.asOf)) },
    leadCan: leadAbilities(spec),
    get segments() { return (seg ??= segmentAll(index, spec, data.asOf, { left })) },
    /** The segments 30 days before the cutoff, for people who existed then (the flows' left side). */
    get segmentsThen() { return (then ??= segmentAll(index, spec, daysBefore(data.asOf, 30), { onlyExisting: true })) },
  }
}

// ---- parameters ---------------------------------------------------------------

function range(p, asOf) {
  if (p.from !== undefined || p.to !== undefined) {
    const from = String(p.from ?? '')
    const to = String(p.to ?? asOf)
    if (!DATE.test(from) || !DATE.test(to)) bad('from、to 要写成 2026-01-01 这样的日期')
    if (from > to) bad('from 不能晚于 to')
    return { from, to: to > asOf ? asOf : to }
  }
  const w = p.window === undefined ? 365 : Number(p.window)
  if (!Number.isInteger(w) || w < 1 || w > 3650) bad('window 是 1～3650 的天数')
  return { from: daysBefore(asOf, w - 1), to: asOf }
}

function metricOf(ctx, p) {
  const m = String(p.metric ?? '')
  if (!Object.hasOwn(METRICS, m)) bad(`metric 只能是：${Object.keys(METRICS).join('、')}`, { metrics: METRICS })
  if (!entitiesOf(ctx.spec).has(METRICS[m].needs)) bad(`这个数据集没有${ENTITIES[METRICS[m].needs].name}数据，算不了「${METRICS[m].name}」`)
  const can = leadAbilities(ctx.spec)
  if (m === 'lead_trial_rate' && !can.trial) bad('配置里没有对上「体验」那一列，算不了体验率')
  if (m === 'lead_follow_hours' && !can.firstFollow) bad('配置里没有对上「首次跟进」那一列，算不了首次跟进用时')
  if (['lead_win_rate', 'lead_won'].includes(m) && !can.result) bad('配置里没有对上线索的结果或成交时间，算不了成交')
  if (METRICS[m].money && !capabilities(ctx.spec).has('amount')) bad(`这个数据集的交易没有金额列，算不了「${METRICS[m].name}」；可以看笔数和人数`)
  return m
}

function filtersOf(ctx, p) {
  const f = {}
  if (p.type !== undefined) {
    const allowed = dictValues(ctx.spec, 'transaction.type')
    const list = Array.isArray(p.type) ? p.type.map(String) : [String(p.type)]
    if (allowed && list.some(t => !allowed.includes(t))) bad(`type 只能是：${allowed.join('、')}`)
    f.type = list
  }
  if (p.channel !== undefined) {
    const allowed = dictValues(ctx.spec, 'touch.channel')
    const list = Array.isArray(p.channel) ? p.channel.map(String) : [String(p.channel)]
    if (allowed && list.some(t => !allowed.includes(t))) bad(`channel 只能是：${allowed.join('、')}`)
    f.channel = list
  }
  if (p.segment !== undefined) {
    const names = [...ctx.spec.segments.map(s => s.name), OTHER]
    if (!names.includes(String(p.segment))) bad(`segment 只能是：${names.join('、')}`)
    f.segment = String(p.segment)
  }
  if (p.flag !== undefined) {
    const names = ctx.spec.flags.map(s => s.name)
    if (!names.includes(String(p.flag))) bad(`flag 只能是：${names.join('、') || '（这个数据集没有标记）'}`)
    f.flag = String(p.flag)
  }
  if (p.without !== undefined) {
    const names = ctx.spec.flags.map(s => s.name)
    const list = [...new Set((Array.isArray(p.without) ? p.without : [p.without]).map(String))]
    if (list.length === 0 || list.some(x => !names.includes(x))) bad(`without（不带哪些标记）只能是：${names.join('、') || '（这个数据集没有标记）'}`)
    f.without = list
  }
  if (p.lead !== undefined) {
    if (!entitiesOf(ctx.spec).has('lead')) bad('这个数据集没有线索数据')
    const c = checkLeadFilter(ctx.spec, p.lead)
    if (!c.ok) bad(c.message)
    if (Object.keys(c.filter).length) f.lead = c.filter
  }
  if (p.was !== undefined) {
    const names = [...ctx.spec.segments.map(s => s.name), OTHER, NEW_ARRIVAL]
    if (!names.includes(String(p.was))) bad(`was（30 天前在哪一层）只能是：${names.join('、')}`)
    f.was = String(p.was)
  }
  return f
}

/** Whether a customer was in segment `was` 30 days before the cutoff (`新出现` for people who did not exist yet). */
export function wasIn(ctx, cid, was) {
  return (ctx.segmentsThen.of.get(cid) ?? NEW_ARRIVAL) === was
}

const inRange = (d, r) => d && dayOf(d) >= r.from && dayOf(d) <= r.to

function customerOk(ctx, f) {
  if (!f.segment && !f.flag && !f.was && !f.without) return () => true
  const s = ctx.segments
  return cid => (!f.segment || s.of.get(cid) === f.segment) && (!f.flag || (s.flagsOf.get(cid) ?? []).includes(f.flag)) && (!f.without || f.without.every(x => !(s.flagsOf.get(cid) ?? []).includes(x))) && (!f.was || wasIn(ctx, cid, f.was))
}

/** The value of a metric over a set of rows already filtered to the range. */
function compute(ctx, metric, r, f, keep = () => true) {
  const okC = customerOk(ctx, f)
  const cFilter = f.segment || f.flag || f.without
  const txns = () => ctx.data.transactions.filter(t => t.counted && inRange(t.date, r) && (!f.type || f.type.includes(t.type)) && (!cFilter || (t.cid && okC(t.cid))) && keep(t, 'transaction'))
  switch (metric) {
    case 'revenue': return txns().reduce((a, t) => a + t.amount, 0) / 100
    case 'txn_count': return txns().filter(t => !t.refund).length
    case 'buyers': return new Set(txns().filter(t => !t.refund && t.cid).map(t => t.cid)).size
    case 'avg_order': { const l = txns().filter(t => !t.refund && t.amount !== null); return l.length ? Math.round(l.reduce((a, t) => a + t.amount, 0) / l.length) / 100 : null }
    case 'refund_amount': return Math.abs(txns().filter(t => t.refund).reduce((a, t) => a + t.amount, 0)) / 100
    case 'new_customers': {
      let n = 0
      for (const [cid, e] of ctx.index) {
        if (!okC(cid) || !keep(e.c, 'customer')) continue
        const first = firstSeen(e)
        if (first && first >= r.from && first <= r.to) n++
      }
      return n
    }
    case 'customers': {
      let n = 0
      for (const [cid, e] of ctx.index) if (okC(cid) && keep(e.c, 'customer') && existsBy(e, r.to)) n++
      return n
    }
    case 'touches': return ctx.data.touches.filter(t => inRange(t.date, r) && (!f.channel || f.channel.includes(t.channel)) && (!cFilter || (t.cid && okC(t.cid))) && keep(t, 'touch')).length
    case 'touched_customers': return new Set(ctx.data.touches.filter(t => t.cid && inRange(t.date, r) && (!f.channel || f.channel.includes(t.channel)) && okC(t.cid) && keep(t, 'touch')).map(t => t.cid)).size
    case 'new_assets': return ctx.data.assets.filter(a => inRange(a.start, r) && (!cFilter || (a.cid && okC(a.cid))) && keep(a, 'asset')).length
    default:
      if (LEAD_METRICS.has(metric)) return leadMetric(metric, leadsIn(ctx, r, f, keep), ctx.leadCan)
      return null
  }
}

/** The prepared leads that came in during a range and pass the filters (a customer filter keeps only linked leads). */
function leadsIn(ctx, r, f, keep = () => true) {
  const okC = customerOk(ctx, f)
  const cFilter = f.segment || f.flag || f.was
  return ctx.leads.filter(l => inRange(l.date, r) && (!f.lead || leadPasses(l, f.lead)) && (!cFilter || (l.cid && okC(l.cid))) && keep(l, 'lead'))
}

function firstSeen(e) {
  const all = [e.c.firstSeen, ...e.txns.map(t => t.date), ...e.touches.map(t => t.date), ...e.assets.map(a => a.start), ...(e.leads ?? []).map(l => l.date)].filter(Boolean).map(dayOf).sort()
  return all[0] ?? null
}

// ---- the queries ----------------------------------------------------------------

function qSegments(ctx, p) {
  const s = ctx.segments
  const total = s.total
  const pct = n => (total ? round1((n / total) * 100) : 0)
  const rows = [...ctx.spec.segments.map(x => ({ name: x.name, rule: x.desc || describeRule(x, fieldNames(ctx.spec)), count: s.counts[x.name], sharePct: pct(s.counts[x.name]), off: s.disabled.find(d => d.kind === 'segment' && d.name === x.name)?.missing ?? null })), { name: OTHER, rule: '哪一层都没进', count: s.counts[OTHER], sharePct: pct(s.counts[OTHER]), off: null }]
  const out = {
    kind: 'segments',
    asOf: ctx.asOf,
    total,
    rows,
    flags: ctx.spec.flags.map(x => ({ name: x.name, rule: x.desc || describeRule(x, fieldNames(ctx.spec)), count: s.flags[x.name], sharePct: pct(s.flags[x.name]) })),
    columns: [{ key: 'count', unit: 'people' }],
  }
  if (s.left > 0) out.left = { name: LEFT_SEGMENT, count: s.left, note: '转手或说过不要再联系，不算进上面任何一层的占比' }
  if (p.flows) {
    const fl = flows(ctx.index, ctx.spec, ctx.asOf, 30, { left: ctx.left, before: ctx.segmentsThen })
    out.flows = { from: fl.from, to: fl.to, stayed: fl.stayed, moved: fl.moved, arrived: fl.arrived, net: Object.fromEntries(Object.keys(fl.now).map(k => [k, fl.now[k] - (fl.before[k] ?? 0)])), moves: fl.moves.filter(m => m.from !== m.to).slice(0, 20), stays: Object.fromEntries(fl.moves.filter(m => m.from === m.to).map(m => [m.from, m.count])) }
  }
  return out
}

function qMetric(ctx, p) {
  const metric = metricOf(ctx, p)
  const r = range(p, ctx.asOf)
  const f = filtersOf(ctx, p)
  const value = compute(ctx, metric, r, f)
  const out = { kind: 'metric', metric, name: METRICS[metric].name, unit: METRICS[metric].unit, from: r.from, to: r.to, filters: f, value }
  if (TXN_METRICS.has(metric) && !f.segment && !f.flag && !f.was) {
    const unlinked = ctx.data.transactions.filter(t => t.counted && !t.cid && inRange(t.date, r) && (!f.type || f.type.includes(t.type)))
    out.unlinked = { count: unlinked.length, amount: unlinked.reduce((a, t) => a + t.amount, 0) / 100, note: '含在上面的数里：这些交易没挂到客户身上' }
    if (metric === 'buyers') delete out.unlinked
  }
  // Touches that found nobody are in the count, and say so: a count of touches is not a count of people reached.
  if (metric === 'touches' && !f.segment && !f.flag && !f.was) {
    const loose = ctx.data.touches.filter(t => !t.cid && inRange(t.date, r) && (!f.channel || f.channel.includes(t.channel))).length
    if (loose > 0) out.unlinked = { count: loose, note: '含在上面的数里：这些互动没挂到客户身上，不知道是谁' }
  }
  return out
}

function keyOf(ctx, by, item, kind) {
  const [entity, field] = by.includes('.') ? [by.slice(0, by.indexOf('.')), by.slice(by.indexOf('.') + 1)] : [null, by]
  if (entity === null) {
    const d = item.date ?? item.start ?? null
    if (by === 'month') return d ? dayOf(d).slice(0, 7) : null
    if (by === 'quarter') return d ? `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}` : null
    if (by === 'year') return d ? d.slice(0, 4) : null
  }
  if (entity === 'customer') {
    const c = kind === 'customer' ? item : ctx.index.get(item.cid)?.c
    return c ? fieldOf(c, field) : null
  }
  if (entity === 'lead' && kind === 'lead') return leadKey(item, field)
  if (entity === kind) return item[field] ?? null
  return undefined
}
const keyIs = (v, k) => (Array.isArray(v) ? v.includes(k) : (v ?? null) === k)

function qBreakdown(ctx, p) {
  const metric = metricOf(ctx, p)
  const dims = dimensions(ctx.spec)
  const by = String(p.by ?? '')
  if (!Object.hasOwn(dims, by)) bad(`by 只能是：${Object.entries(dims).map(([k, v]) => `${k}（${v}）`).join('、')}`)
  const r = range(p, ctx.asOf)
  const f = filtersOf(ctx, p)
  const unit = METRICS[metric].unit
  let groups
  if (by === 'segment' || by === 'flag') {
    const names = by === 'segment' ? [...ctx.spec.segments.map(x => x.name), OTHER] : ctx.spec.flags.map(x => x.name)
    groups = names.map(n => ({ key: n, value: compute(ctx, metric, r, { ...f, [by]: n }) }))
  } else {
    const [entity] = by.split('.')
    const eventKind = entity === 'customer' || ['month', 'quarter', 'year'].includes(by) ? null : entity
    const kindOfMetric = TXN_METRICS.has(metric) ? 'transaction' : ['touches', 'touched_customers'].includes(metric) ? 'touch' : metric === 'new_assets' ? 'asset' : LEAD_METRICS.has(metric) ? 'lead' : 'customer'
    if (eventKind && eventKind !== kindOfMetric) bad(`「${METRICS[metric].name}」不能按「${dims[by]}」拆`)
    if (kindOfMetric === 'customer' && ['month', 'quarter', 'year'].includes(by) && metric === 'customers') bad('客户总数不能按时间拆；按时间看新客户用 new_customers')
    const keys = new Set()
    const collect = (item, kind) => { const k = keyOf(ctx, by, item, kind); for (const x of Array.isArray(k) ? (k.length ? k : [null]) : [k]) keys.add(x ?? null) }
    if (kindOfMetric === 'transaction') ctx.data.transactions.filter(t => t.counted && inRange(t.date, r)).forEach(t => collect(t, 'transaction'))
    else if (kindOfMetric === 'touch') ctx.data.touches.filter(t => inRange(t.date, r)).forEach(t => collect(t, 'touch'))
    else if (kindOfMetric === 'asset') ctx.data.assets.filter(a => inRange(a.start, r)).forEach(a => collect(a, 'asset'))
    else if (kindOfMetric === 'lead') leadsIn(ctx, r, f).forEach(l => collect(l, 'lead'))
    else if (['month', 'quarter', 'year'].includes(by)) for (const [, e] of ctx.index) { const fs = firstSeen(e); if (fs) keys.add(keyOf(ctx, by, { date: fs }, 'customer')) }
    else for (const [, e] of ctx.index) collect(e.c, 'customer')
    groups = [...keys].map(k => ({
      key: k ?? '（空）',
      value: compute(ctx, metric, r, f, (item, kind) => {
        if (kind === 'customer' && ['month', 'quarter', 'year'].includes(by)) { const e = ctx.index.get(item.cid); const fs = e ? firstSeen(e) : null; return (fs ? keyOf(ctx, by, { date: fs }, 'customer') : null) === k }
        return keyIs(keyOf(ctx, by, item, kind), k)
      }),
    }))
  }
  const time = ['month', 'quarter', 'year'].includes(by)
  groups.sort((a, b) => (time ? String(a.key).localeCompare(String(b.key)) : (b.value ?? 0) - (a.value ?? 0)))
  // A multi-value field puts one person in several groups: the groups do not add up to the total.
  const tagged = by.startsWith('customer.') && customerTagFieldKeys(ctx.spec).includes(by.slice(9))
  const additive = !tagged && metric !== 'avg_order' && !(PEOPLE_METRICS.has(metric) && by.startsWith('transaction.')) && (!LEAD_METRICS.has(metric) || (LEAD_ADDITIVE.has(metric) && by !== 'lead.table'))
  const total = additive ? groups.reduce((a, g) => a + (g.value ?? 0), 0) : null
  let rows = groups.map(g => ({ ...g, ...(total ? { sharePct: round1(((g.value ?? 0) / total) * 100) } : {}) }))
  let rest = null
  if (rows.length > MAX_ROWS && !time) {
    const tail = rows.slice(MAX_ROWS - 1)
    rows = rows.slice(0, MAX_ROWS - 1)
    rest = { groups: tail.length, value: additive ? round2(tail.reduce((a, g) => a + (g.value ?? 0), 0)) : null }
  }
  return { kind: 'breakdown', metric, name: METRICS[metric].name, unit, by, byName: dims[by], from: r.from, to: r.to, filters: f, rows, rest, total: total === null ? null : round2(total), columns: [{ key: 'value', unit }], note: additive ? undefined : '这个指标各组加起来不等于总数（同一个人可能在几组里）' }
}

const round2 = x => Math.round(x * 100) / 100

function qCompare(ctx, p) {
  const metric = metricOf(ctx, p)
  const f = filtersOf(ctx, p)
  let a
  let b
  if (p.a || p.b) {
    if (!p.a || !p.b) bad('a 和 b 两段时间都要写：{ from, to }')
    a = range(p.a, ctx.asOf)
    b = range(p.b, ctx.asOf)
  } else {
    const w = p.window === undefined ? 30 : Number(p.window)
    if (!Number.isInteger(w) || w < 1 || w > 1825) bad('window 是 1～1825 的天数')
    b = { from: daysBefore(ctx.asOf, w - 1), to: ctx.asOf }
    a = { from: daysBefore(ctx.asOf, 2 * w - 1), to: daysBefore(ctx.asOf, w) }
  }
  const va = compute(ctx, metric, a, f)
  const vb = compute(ctx, metric, b, f)
  const diff = va === null || vb === null ? null : round2(vb - va)
  return { kind: 'compare', metric, name: METRICS[metric].name, unit: METRICS[metric].unit, filters: f, a: { ...a, value: va }, b: { ...b, value: vb }, diff, changePct: va ? round1(((vb - va) / Math.abs(va)) * 100) : null, columns: [{ key: 'value', unit: METRICS[metric].unit }, { key: 'diff', unit: METRICS[metric].unit }], note: va ? undefined : '前一段是 0，算不了变化率' }
}

function qCohort(ctx, p) {
  if (!entitiesOf(ctx.spec).has('transaction')) bad('这个数据集没有交易数据，看不了复购')
  const months = p.months === undefined ? 12 : Number(p.months)
  if (!Number.isInteger(months) || months < 1 || months > 24) bad('months 是 1～24')
  const f = filtersOf(ctx, p)
  const last = ctx.asOf.slice(0, 7)
  const list = []
  for (let i = months - 1; i >= 0; i--) { const d = new Date(`${last}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); list.push(d.toISOString().slice(0, 7)) }
  const okC = customerOk(ctx, f)
  const rows = list.map(m => ({ key: m, size: 0, buyers: 0, repeaters: 0, recent: 0 }))
  const byMonth = new Map(rows.map(r => [r.key, r]))
  for (const [cid, e] of ctx.index) {
    if (!okC(cid)) continue
    const fs = firstSeen(e)
    const row = fs ? byMonth.get(fs.slice(0, 7)) : null
    if (!row) continue
    const real = e.txns.filter(t => t.counted && !t.refund && (!f.type || f.type.includes(t.type)))
    row.size++
    if (real.length > 0) row.buyers++
    if (real.length > 1) row.repeaters++
    if (real.some(t => dayOf(t.date) > daysBefore(ctx.asOf, 365))) row.recent++
  }
  for (const r of rows) Object.assign(r, { buyRatePct: r.size ? round1((r.buyers / r.size) * 100) : null, repeatRatePct: r.size ? round1((r.repeaters / r.size) * 100) : null })
  return { kind: 'cohort', asOf: ctx.asOf, months, filters: f, rows, columns: [{ key: 'size', unit: 'people' }, { key: 'buyers', unit: 'people' }, { key: 'repeaters', unit: 'people' }, { key: 'recent', unit: 'people' }], note: 'size 是那个月第一次出现的人数；buyers 截至截止日有过交易，repeaters 有过两笔以上，recent 近 365 天有交易。最近几个月的人来得晚，比例天然偏低。' }
}

function qCampaign(ctx, p) {
  if (!entitiesOf(ctx.spec).has('touch')) bad('这个数据集没有互动数据，看不了活动效果')
  const name = String(p.campaign ?? '')
  const names = ctx.data.campaigns.map(c => c.name)
  if (!names.includes(name)) bad(`campaign 只能是：${names.join('、') || '（没有活动）'}`)
  const r = campaignEffect(ctx.index, ctx.data, ctx.spec, name, ctx.asOf)
  if (r.error) bad('这场活动没有日期，也没有带日期的签到记录，算不了')
  return { kind: 'campaign_effect', ...r, participants: { ...r.participants, cents: undefined }, control: { ...r.control, cents: undefined }, columns: [{ key: 'people', unit: 'people' }, { key: 'buyers', unit: 'people' }, ...(capabilities(ctx.spec).has('amount') ? [{ key: 'amount', unit: 'yuan' }, { key: 'perPerson', unit: 'yuan' }] : [])], caveat: CAMPAIGN_CAVEAT, note: r.conclusive ? undefined : `参加组或对照组不到 ${r.minGroup} 人：只报数字，不下结论` }
}

function qQuality(ctx) {
  const rec = ctx.recon
  if (!rec) bad('还没有对账结果')
  return {
    kind: 'quality',
    version: ctx.version,
    asOf: ctx.asOf,
    tables: rec.recon.tables.map(t => ({ table: t.table, mode: t.mode, rows: t.sheets.reduce((a, s) => { for (const k of ['total', 'loaded', 'skipped', 'excluded', 'failed', 'duplicate']) a[k] = (a[k] ?? 0) + (s.rows[k] ?? 0); return a }, {}), moneyOk: t.sheets.every(s => !s.money || s.money.ok), superseded: t.superseded.length })),
    rowsOk: rec.recon.rowsOk,
    moneyOk: rec.recon.moneyOk,
    parseProblems: rec.recon.parseProblems.map(x => ({ table: x.table, column: x.column, ratePct: round1(x.rate * 100) })),
    links: Object.fromEntries(Object.entries(rec.recon.link).map(([k, v]) => [k, { total: v.total, linked: v.linked, ratePct: round1(v.rate * 100), unlinkedBy: v.unlinkedBy }])),
    // Tables whose rows mostly found no customer: numbers per person built on them are close to empty.
    weakLinks: (rec.recon.weakLinks ?? []).map(x => ({ table: x.table, entity: x.entity, total: x.total, linked: x.linked, ratePct: round1(x.rate * 100), why: x.why })),
    review: ctx.review ? { open: ctx.review.open, total: ctx.review.total } : null,
    unknownValues: (ctx.pending ?? []).map(x => ({ field: x.key, values: x.values.length, rows: x.values.reduce((a, v) => a + v.count, 0) })),
    statusChanges: rec.changes.length,
    staleStatuses: rec.recon.counts.staleStatuses,
    counts: rec.recon.counts,
  }
}

function qSample(ctx, p) {
  if (ctx.privacy.summaryOnly) bad('这个数据集打开了「只看汇总」，不给样例行')
  const entity = String(p.entity ?? 'customer')
  if (!['customer', 'transaction', 'touch', 'asset', 'lead'].includes(entity)) bad('entity 只能是：customer、transaction、touch、asset、lead')
  if (entity === 'lead' && !entitiesOf(ctx.spec).has('lead')) bad('这个数据集没有线索数据')
  const limit = Math.min(SAMPLE_MAX, Math.max(1, Number(p.limit ?? 10) || 10))
  const f = filtersOf(ctx, p)
  const okC = customerOk(ctx, f)
  const showText = new Set(ctx.privacy.showText ?? [])
  const extras = (obj, e) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => {
    const def = ctx.spec.tables.flatMap(t => t.extra ?? []).find(x => x.entity === e && x.key === k)
    if (!def || def.type === 'category' || def.type === 'tags' || def.type === 'date' || def.type === 'number' || def.type === 'money') return [def?.name ?? k, def?.type === 'money' && typeof v === 'number' ? v / 100 : v]
    return [def.name, showText.has(def.column) ? maskText(String(v ?? '')) : { length: String(v ?? '').length }]
  }))
  const s = ctx.segments
  let rows
  if (entity === 'customer') {
    rows = [...ctx.index].filter(([cid]) => okC(cid)).slice(0, limit).map(([cid, e]) => {
      const fx = featuresOf(e, ctx.asOf)
      return { customer: ctx.code(cid), segment: s.of.get(cid), flags: s.flagsOf.get(cid), city: e.c.city, owner: e.c.owner, channel: e.c.channel, firstSeen: firstSeen(e), txns: fx('txn_count', [3650]), amount365: fx('amount', [365]), daysSinceLastTxn: fx('days_since_last_txn', []), assets: fx('asset_count', []), daysSinceLastTouch: fx('days_since_last_touch', []), extra: extras(e.c.extra, 'customer') }
    })
  } else if (entity === 'lead') {
    rows = ctx.leads.filter(l => (!f.lead || leadPasses(l, f.lead)) && ((!f.segment && !f.flag && !f.was) || (l.cid && okC(l.cid)))).slice(0, limit).map(l => ({
      customer: l.cid ? ctx.code(l.cid) : null, date: l.date, state: LEAD_STATES[l.state], result: l.result, level: l.level, channel: l.channel, source: l.source, campaign: l.campaign, product: l.product, trial: l.trial, owner: l.owner, rep: l.rep, firstFollow: l.firstFollow, lastFollow: l.lastFollow, followHours: l.hours, tables: l.tables, extra: extras(l.extra, 'lead'),
    }))
  } else {
    const list = entity === 'transaction' ? ctx.data.transactions : entity === 'touch' ? ctx.data.touches : ctx.data.assets
    rows = list.filter(x => (!f.segment && !f.flag && !f.was) || (x.cid && okC(x.cid))).filter(x => entity !== 'transaction' || !f.type || f.type.includes(x.type)).slice(0, limit).map(x => {
      const base = { customer: x.cid ? ctx.code(x.cid) : null }
      if (entity === 'transaction') return { ...base, date: x.date, type: x.type, amount: x.amount === null ? null : x.amount / 100, status: x.status, channel: x.channel, owner: x.owner, counted: x.counted, refund: x.refund, extra: extras(x.extra, 'transaction') }
      if (entity === 'touch') return { ...base, date: x.date, channel: x.channel, action: x.action, campaign: x.campaign, extra: extras(x.extra, 'touch') }
      return { ...base, type: x.type, model: x.model, start: x.start, end: x.end, status: x.status, owner: x.owner, extra: extras(x.extra, 'asset') }
    })
  }
  return { kind: 'sample', entity, filters: f, rows, note: entity === 'lead' ? '线索只给归属、渠道、状态这些；姓名、手机都不给。customer 是挂上的客户编号，挂不上是 null。' : '客户只给编号；姓名、手机、证件号、VIN 都不给。' }
}

function qListEffect(ctx, p) {
  const batches = ctx.lists?.batches ?? []
  const b = batches.find(x => x.id === String(p.batch ?? '') || x.name === String(p.batch ?? ''))
  if (!b) bad(`batch 只能是：${batches.map(x => `${x.id}（${x.name}）`).join('、') || '（还没有名单）'}`)
  const v = batchView(b, ctx.lists, ctx, ctx.spec, ctx.today)
  const names = { ...Object.fromEntries((ctx.spec.lists?.outcomes ?? []).map(o => [o.code, o.name])), ...(b.goal ? { [GOAL_REACHED]: `${goalText(b.goal)}了（数据确认，没人标结果）` } : {}) }
  return {
    kind: 'list_effect', batch: b.id, name: b.name, purpose: b.purpose, createdAt: b.createdAt, due: b.due, windowEnd: v.windowEnd, complete: v.complete, to: v.to,
    people: v.people, came: v.came, ratePct: v.ratePct, base: v.base,
    // A list made to close a gap is judged by its tag, not by transactions: `goal` then holds the answer.
    ...(v.goal ? { judgedBy: 'goal', goal: { text: v.goal.text, flags: v.goal.flags, fresh: v.goal.fresh, people: v.goal.people, reached: v.goal.reached, ratePct: v.goal.ratePct, base: v.goal.base, madeAsOf: v.goal.madeAt.asOf, note: v.goal.note } } : { judgedBy: 'transactions' }),
    outcomes: Object.entries(v.counts).map(([code, count]) => ({ code, name: names[code] ?? '还没结果', count })),
    columns: [{ key: 'people', unit: 'people' }, { key: 'came', unit: 'people' }, { key: 'count', unit: 'people' }],
    caveat: v.caveat,
  }
}

/** Counts and rates of a stats object, flat, for a query result (the state counts go in their own list). */
const flatStats = st => ({ leads: st.leads, followed: st.followed, trial: st.trial, won: st.won, lost: st.lost, dormant: st.dormant, open: st.open, action: st.action, followPct: st.followPct, onTimePct: st.onTimePct, trialPct: st.trialPct, winPct: st.winPct, lostPct: st.lostPct, medianHours: st.followHours?.median ?? null, p75Hours: st.followHours?.p75 ?? null })

function qLeadFunnel(ctx, p) {
  if (!entitiesOf(ctx.spec).has('lead')) bad('这个数据集没有线索数据：导入线索、商机、报名这类表，请配置助手把它对成「线索」')
  const r = range(p, ctx.asOf)
  const f = filtersOf(ctx, p)
  const s = leadSettings(ctx.spec)
  const can = ctx.leadCan
  const list = leadsIn(ctx, r, f)
  const total = leadStats(list, can)
  const out = {
    kind: 'lead_funnel', from: r.from, to: r.to, filters: f,
    settings: { followDays: s.followDays, staleDays: s.staleDays, activeDays: s.activeDays, trialName: s.trialName, minGroup: s.minGroup },
    total: flatStats(total),
    steps: funnelSteps(total, can, s.trialName),
    states: Object.entries(LEAD_STATES).map(([key, name]) => ({ key, name, count: total.states[key], action: ACTION_STATES.has(key) })),
    columns: [{ key: 'leads', unit: 'count' }, { key: 'winPct', unit: 'pct' }, { key: 'medianHours', unit: 'hours' }],
    note: `按留资时间取这段时间进来的线索，看它们到 ${ctx.asOf} 为止走到哪一步；最近进来的还没走完，成交率天然偏低。待处理 = 首跟超时 + 跟进断了。`,
  }
  if (p.by !== undefined) {
    const dims = leadDimensions(ctx.spec)
    const by = String(p.by)
    if (!Object.hasOwn(dims, by)) bad(`by 只能是：${Object.entries(dims).map(([k, v]) => `${k}（${v}）`).join('、')}`)
    let rows = groupLeads(list, by).map(g => ({ key: g.key, ...flatStats(leadStats(g.list, can)), small: g.list.length < s.minGroup }))
    let rest = null
    if (rows.length > MAX_ROWS && !['month', 'quarter', 'year'].includes(by)) {
      const tail = rows.slice(MAX_ROWS - 1)
      rows = rows.slice(0, MAX_ROWS - 1)
      rest = { groups: tail.length, leads: tail.reduce((a, g) => a + g.leads, 0) }
    }
    Object.assign(out, { by, byName: dims[by], rows, rest, groupNote: `少于 ${s.minGroup} 条的组标了 small，只报数字，不比高低。${by === 'table' ? '一条线索可以同时出现在几张表里，各组加起来会多于总数。' : ''}` })
  }
  return out
}

const OWNER_SORTS = ['customers', 'newCustomers', 'txns', 'buyers', 'amount', 'leads', 'followPct', 'onTimePct', 'medianHours', 'winPct', 'todo']

function qOwnerBoard(ctx, p) {
  if (!hasOwners(ctx.data)) bad('这个数据集里没有哪一类数据写了归属方（门店、经销商），看不了归属方对比')
  const window = p.window === 'all' ? 'all' : p.window === undefined ? 90 : Number(p.window)
  if (window !== 'all' && (!Number.isInteger(window) || window < 1 || window > 3650)) bad('window 是 1～3650 的天数，或 "all"')
  const attributes = ownerAttributes(ctx.spec)
  if (p.by !== undefined && !Object.hasOwn(attributes, String(p.by))) bad(Object.keys(attributes).length ? `by 只能是：${Object.entries(attributes).map(([k, v]) => `${k}（${v}）`).join('、')}` : '配置里没有归属方的属性（大区、负责人这类），不能汇总；只能一家一家看')
  if (p.owner !== undefined) {
    const d = ownerDetail(ctx, String(p.owner), { window })
    if (!d) bad(`没有叫「${p.owner}」的归属方。名字要和 owner_board 的 rows 里的 key 一字不差`)
    return { ...d, row: flatRow(d.row), total: flatRow(d.total), columns: undefined, segments: undefined }
  }
  const board = ownerBoard(ctx, { window, by: p.by === undefined ? null : String(p.by) })
  const flagNames = board.columns.filter(c => c.flag).map(c => c.flag)
  const sort = p.sort === undefined ? 'customers' : String(p.sort)
  if (!OWNER_SORTS.includes(sort) && !flagNames.includes(sort)) bad(`sort 只能是：${[...OWNER_SORTS.filter(k => board.columns.some(c => c.key === k)), ...flagNames].join('、')}`)
  const value = r => (flagNames.includes(sort) ? r.flags[sort].count : r[sort] ?? -Infinity)
  const asc = p.order === 'asc'
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(p.limit ?? MAX_ROWS) || MAX_ROWS))
  const pick = list => [...list].sort((a, b) => (asc ? value(a) - value(b) : value(b) - value(a))).slice(0, limit).map(flatRow)
  return {
    kind: 'owner_board', from: board.from, to: board.to, window, label: board.label, by: board.by, attributes,
    columns: board.columns.map(c => ({ key: c.flag ? c.flag : c.key, name: c.name, unit: c.unit, ...(c.flag ? { flag: true } : {}), ...(c.windowed ? { windowed: true } : {}) })),
    total: flatRow(board.total), owners: board.rows.filter(r => r.key !== NO_OWNER).length,
    rows: pick(board.groups ?? board.rows),
    rest: (board.groups ?? board.rows).length > limit ? { groups: (board.groups ?? board.rows).length - limit } : null,
    highlights: board.highlights.map(x => ({ title: x.title, detail: x.detail, owners: x.owners })),
    note: `${board.note}标记那几列是人数，带 Pct 的是占这家客户的百分比。`,
  }
}

/** A board row for a model: flags flattened to `名字` (people) and `名字Pct`. */
function flatRow(r) {
  const { flags, segments, ...rest } = r
  const out = { ...rest }
  for (const [k, v] of Object.entries(flags ?? {})) { out[k] = v.count; out[`${k}Pct`] = v.pct }
  if (segments) out.segments = segments
  return out
}

function qReach(ctx, p) {
  const attributes = ownerAttributes(ctx.spec)
  const by = p.by === undefined ? 'segment' : String(p.by)
  if (!['segment', 'owner'].includes(by) && !Object.hasOwn(attributes, by)) bad(`by 只能是：segment（分层）、owner（归属方）${Object.entries(attributes).map(([k, v]) => `、${k}（${v}）`).join('')}`)
  const board = reachBoard(ctx, { by: Object.hasOwn(attributes, by) ? by : null })
  if (!board.on) bad(`配置里没有标成触达渠道的标记，算不了覆盖。哪个标记表示「能通过某个渠道联系上」（加了企微、电话接通过、注册了小程序），就给它写 "kind": "reach"：用 crm_propose_rule 提议（kind: "flag"，rule 里带 "kind": "reach"，replaces 写原来的名字）。现在的标记：${board.candidates.join('、') || '（没有）'}`)
  const flat = r => ({ key: r.key, customers: r.customers, ...(r.owners !== undefined ? { owners: r.owners } : {}), ...Object.fromEntries(board.channels.flatMap(c => [[c, r.channels[c].count], [`${c}Pct`, r.channels[c].pct], [`${c}Missing`, r.channels[c].missing]])), none: r.none.count, nonePct: r.none.pct, small: r.customers < board.minPeople })
  const list = by === 'segment' ? board.segments : by === 'owner' ? board.owners : board.groups ?? []
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(p.limit ?? MAX_ROWS) || MAX_ROWS))
  return {
    kind: 'reach', channels: board.channels, by, byName: by === 'segment' ? '分层' : by === 'owner' ? board.label : attributes[by],
    total: flat(board.total), depth: board.depth,
    rows: list.slice(0, limit).map(flat), rest: list.length > limit ? { groups: list.length - limit } : null,
    highlights: board.highlights.map(x => ({ title: x.title, detail: x.detail })),
    columns: [{ key: 'customers', unit: 'people' }, ...board.channels.flatMap(c => [{ key: c, unit: 'people' }, { key: `${c}Pct`, unit: 'pct' }]), { key: 'none', unit: 'people' }],
    note: `${board.note}每个渠道三列：「渠道名」是带这个标记的人数，「渠道名Pct」是覆盖率，「渠道名Missing」是还差多少人。none 是一个渠道都没有的人数。要这些人的名单：crm_propose_list 带 without。`,
  }
}

const RUN = { reach: qReach, owner_board: qOwnerBoard, lead_funnel: qLeadFunnel, list_effect: qListEffect, segments: qSegments, metric: qMetric, breakdown: qBreakdown, compare: qCompare, cohort: qCohort, campaign_effect: qCampaign, quality: qQuality, sample: qSample }

/**
 * Run one query of the closed list.
 * @param {ReturnType<typeof context>} ctx
 * @param {string} kind - one of QUERY_KINDS.
 * @param {object} params
 */
export function runQuery(ctx, kind, params = {}) {
  if (!Object.hasOwn(RUN, kind)) bad(`kind 只能是：${Object.keys(RUN).join('、')}`)
  const out = RUN[kind](ctx, params && typeof params === 'object' ? params : {})
  return { version: ctx.version, asOf: ctx.asOf, ...out }
}

/** The query vocabulary for the analyst model: kinds, metrics, dimensions, filters. */
export function queryVocabulary(spec) {
  const hasLead = entitiesOf(spec).has('lead')
  return {
    kinds: QUERY_KINDS,
    metrics: Object.fromEntries(Object.entries(METRICS).filter(([, m]) => capabilities(spec).has(m.needs) && (!m.money || capabilities(spec).has('amount'))).map(([k, m]) => [k, `${m.name}（${UNIT_WORDS[m.unit] ?? '次'}）`])),
    dimensions: dimensions(spec),
    segments: [...spec.segments.map(s => s.name), OTHER],
    flags: spec.flags.map(f => f.name),
    transactionTypes: dictValues(spec, 'transaction.type'),
    touchChannels: dictValues(spec, 'touch.channel'),
    ownerAttributes: ownerAttributes(spec),
    reachChannels: reachChannels(spec),
    ...(hasLead ? { leadDimensions: leadDimensions(spec), leadStates: Object.values(LEAD_STATES), leadResults: Object.values(LEAD_RESULTS), leadSettings: leadSettings(spec) } : {}),
    params: {
      segments: '{ flows?: true }',
      metric: '{ metric, window?（天，默认 365）| from、to, type?, channel?, segment?, flag?, was? }',
      breakdown: '{ metric, by, window? | from、to, type?, segment?, flag?, was? }',
      compare: '{ metric, a: { from, to }, b: { from, to } } 或 { metric, window }（最近 window 天对比再往前 window 天）',
      cohort: '{ months?（默认 12）, type?, segment? }',
      campaign_effect: '{ campaign }',
      quality: '{}',
      sample: '{ entity: customer|transaction|touch|asset, limit?（≤ 20）, segment?, flag?, was?, type? }',
      list_effect: '{ batch }（名单编号，见 crm_status 的 lists）',
      ...(hasLead ? { lead_funnel: '{ window?（天，默认 365）| from、to, by?（leadDimensions 里的一个）, lead?: { 维度: 值或值的列表 }, segment?, flag? }' } : {}),
      reach: '{ by?: "segment"（默认）| "owner" | ownerAttributes 里的一个, limit? }',
      owner_board: '{ window?（天，默认 90，或 "all"）, by?（ownerAttributes 里的一个，按它汇总）, owner?（只看一家，返回这一家的明细和各跟进人）, sort?（按哪一列排，默认客户数）, order?: "asc"|"desc", limit?（≤ 30） }',
    },
    filters: {
      segment: '现在在哪一层',
      flag: '带哪个标记',
      without: '不带哪个标记（一个名字，或几个名字的列表：一个都不带）；segments 以外的查询都能用',
      was: `30 天前在哪一层（${NEW_ARRIVAL} = 那时还没有这个人）；和 segment 一起用就是「从哪层换到哪层」的那批人，例如 { segment: 某层, was: 另一层 }`,
      ...(hasLead ? { lead: '只看某些线索：{ channel: "某渠道" }、{ owner: ["甲", "乙"] }、{ state: "首跟超时" }，键是 leadDimensions 里的维度；线索指标（leads、lead_*）和 lead_funnel、sample(entity=lead) 能用。segment、flag 只留挂上了客户的线索' } : {}),
    },
  }
}
