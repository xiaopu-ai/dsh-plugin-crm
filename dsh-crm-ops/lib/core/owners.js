/**
 * 归属方看板: the same numbers the other boards show, one column per 归属方 (store, dealer, campus).
 *
 * A head office runs through the people who hold the customers: who is slow to pick up a lead, whose
 * owners have a benefit about to lapse, who has not added their customers on chat. One row per 归属方:
 * how many customers it holds, what came in during the window (deals, leads and how they were followed),
 * and how many of its customers carry each tag. Rows roll up by any attribute of the 归属方 directory
 * (a region, a manager).
 *
 * Whose a deal is: the deal's own `owner` when the table gives one, else the customer's. A lead belongs to
 * the `owner` on the lead. Customers who left are not counted. Nothing here names an industry.
 */
import { daysBefore, dayOf } from './clean.js'
import { OTHER, firstSeenOf, round1 } from './features.js'
import { kindOf } from './insights.js'
import { ACTION_STATES, LEAD_STATES, leadSettings, leadStats } from './leads.js'
import { ENTITIES, capabilities, missingEntities, ownerAttributes } from './spec.js'

export const NO_OWNER = '（没有归属）'
export const NO_VALUE = '（没填）'
/** Fewer customers than this and a share of them says little. */
const MIN_PEOPLE = 20
const TOP = 3

const pct = (n, total) => (total ? round1((n / total) * 100) : null)
const fmt = n => Number(n).toLocaleString('en-US')

/** Whether any row of the data names a 归属方. */
export function hasOwners(data) {
  return data.customers.some(c => c.owner) || (data.leads ?? []).some(l => l.owner) || data.transactions.some(t => t.owner)
}

/** Sort every customer, deal and lead of a version into its 归属方. */
function buckets(ctx, window) {
  const asOf = ctx.asOf
  const from = window === 'all' ? '1900-01-01' : daysBefore(asOf, Number(window) - 1)
  const inWin = d => Boolean(d) && dayOf(d) >= from && dayOf(d) <= asOf
  const out = new Map()
  const at = name => { const k = name ?? NO_OWNER; if (!out.has(k)) out.set(k, { key: k, cids: [], txns: [], leads: [], todo: 0 }); return out.get(k) }
  const ownerOf = cid => ctx.index.get(cid)?.c.owner ?? null
  for (const [cid, e] of ctx.index) if (!ctx.left?.has(cid)) at(e.c.owner).cids.push(cid)
  for (const t of ctx.data.transactions) if (t.counted && inWin(t.date)) at(t.owner ?? (t.cid ? ownerOf(t.cid) : null)).txns.push(t)
  if (capabilities(ctx.spec).has('lead')) {
    for (const l of ctx.leads) {
      const b = at(l.owner)
      if (inWin(l.date)) b.leads.push(l)
      // What is waiting to be picked up is waiting now, whenever the lead came in.
      if (ACTION_STATES.has(l.state)) b.todo++
    }
  }
  return { out, from, inWin }
}

/** Put several buckets together (a region is its dealers). */
const join = (key, list) => ({ key, cids: list.flatMap(b => b.cids), txns: list.flatMap(b => b.txns), leads: list.flatMap(b => b.leads), todo: list.reduce((a, b) => a + b.todo, 0), owners: list.length })

/** The numbers of one bucket. */
function measure(ctx, b, { fed, flags, segments, inWin, minGroup }) {
  const out = { key: b.key, customers: b.cids.length }
  if (b.owners !== undefined) out.owners = b.owners
  out.newCustomers = b.cids.filter(cid => inWin(firstSeenOf(ctx.index.get(cid)))).length
  if (fed.has('transaction')) {
    const real = b.txns.filter(t => !t.refund)
    out.txns = real.length
    out.buyers = new Set(real.map(t => t.cid).filter(Boolean)).size
    if (fed.has('amount')) out.amount = b.txns.reduce((a, t) => a + (t.amount ?? 0), 0) / 100
  }
  if (fed.has('lead')) {
    const st = leadStats(b.leads, ctx.leadCan)
    Object.assign(out, { leads: st.leads, followPct: st.followPct, onTimePct: st.onTimePct, medianHours: st.followHours?.median ?? null, trialPct: st.trialPct, winPct: st.winPct, won: st.won, todo: b.todo, small: st.leads < minGroup })
  }
  const seg = ctx.segments
  out.flags = {}
  for (const f of flags) {
    const n = b.cids.filter(cid => (seg.flagsOf.get(cid) ?? []).includes(f)).length
    out.flags[f] = { count: n, pct: pct(n, b.cids.length) }
  }
  out.segments = {}
  for (const s of segments) out.segments[s] = 0
  for (const cid of b.cids) { const s = seg.of.get(cid); if (s in out.segments) out.segments[s]++ }
  return out
}

/**
 * The board.
 * @param {object} ctx - analysis context (analysis.js `context`).
 * @param {{ window?: number|'all', by?: string|null }} [options] - days back from the cutoff; an attribute of the
 *   归属方 directory to roll the rows up by (`type`, `city`, `extra.<key>`).
 */
export function ownerBoard(ctx, { window = 90, by = null } = {}) {
  const spec = ctx.spec
  const fed = capabilities(spec)
  const label = e => spec.labels?.[e] ?? ENTITIES[e].name
  const attributes = ownerAttributes(spec)
  if (by !== null && !Object.hasOwn(attributes, by)) by = null
  const flags = spec.flags.filter(f => missingEntities(f, fed).length === 0).map(f => f.name)
  const segments = [...spec.segments.map(s => s.name), OTHER]
  const minGroup = leadSettings(spec).minGroup
  const { out, from, inWin } = buckets(ctx, window)
  const opts = { fed, flags, segments, inWin, minGroup }
  const directory = new Map((ctx.data.owners ?? []).map(o => [o.name, o]))
  const attr = (name, key) => { const o = directory.get(name); const v = !o ? null : key.startsWith('extra.') ? o.extra?.[key.slice(6)] : o[key]; return v ?? NO_VALUE }
  // Rows nobody belongs to and nothing happened on in the window (old leads without a 归属方) are left out.
  for (const [k, b] of out) if (k === NO_OWNER && b.cids.length === 0 && b.txns.length === 0 && b.leads.length === 0 && b.todo === 0) out.delete(k)
  const rows = [...out.values()].map(b => ({ ...measure(ctx, b, opts), id: directory.get(b.key)?.id ?? null, attrs: Object.fromEntries(Object.keys(attributes).map(k => [k, attr(b.key, k)])) }))
    .sort((a, b) => b.customers - a.customers || (b.leads ?? 0) - (a.leads ?? 0) || a.key.localeCompare(b.key, 'zh'))
  const total = measure(ctx, join('合计', [...out.values()]), opts)
  let groups = null
  if (by) {
    const g = new Map()
    for (const b of out.values()) { const k = b.key === NO_OWNER ? NO_OWNER : attr(b.key, by); if (!g.has(k)) g.set(k, []); g.get(k).push(b) }
    groups = [...g].map(([k, list]) => measure(ctx, join(k, list), opts)).sort((a, b) => b.customers - a.customers || (b.leads ?? 0) - (a.leads ?? 0))
  }
  const can = ctx.leadCan
  const columns = [
    { key: 'customers', name: `${label('customer')}数`, unit: 'people' },
    { key: 'newCustomers', name: `新${label('customer')}`, unit: 'people', windowed: true },
    ...(fed.has('transaction') ? [{ key: 'txns', name: `${label('transaction')}（笔）`, unit: 'count', windowed: true }, { key: 'buyers', name: `有${label('transaction')}的人`, unit: 'people', windowed: true }] : []),
    ...(fed.has('amount') ? [{ key: 'amount', name: '金额', unit: 'yuan', windowed: true }] : []),
    ...(fed.has('lead') ? [
      { key: 'leads', name: `新${label('lead')}`, unit: 'count', windowed: true },
      { key: 'followPct', name: '跟进过', unit: 'pct', windowed: true },
      ...(can.follow ? [{ key: 'onTimePct', name: '首跟及时', unit: 'pct', windowed: true }] : []),
      ...(can.firstFollow ? [{ key: 'medianHours', name: '首跟用时（中位）', unit: 'hours', windowed: true }] : []),
      ...(can.result ? [{ key: 'winPct', name: '成交率', unit: 'pct', windowed: true }] : []),
      { key: 'todo', name: '待处理', unit: 'count' },
    ] : []),
    ...flags.map(f => ({ key: `flag:${f}`, name: f, unit: 'people', flag: f, kind: kindOf(spec.flags.find(x => x.name === f)) })),
  ]
  return {
    kind: 'owner_board', asOf: ctx.asOf, from, to: ctx.asOf, window,
    label: label('owner'), attributes, by, columns, segments,
    total, rows, groups,
    highlights: highlights(rows, total, { spec, label, can, flags, minGroup }),
    minGroup, minPeople: MIN_PEOPLE,
    note: `${label('customer')}数和标记是截至 ${ctx.asOf} 的；带时间的列按近 ${window === 'all' ? '全部时间' : `${window} 天`}算。${fed.has('transaction') ? `${label('transaction')}按${label('transaction')}表里写的${label('owner')}算，没写的按${label('customer')}的${label('owner')}算。` : ''}${fed.has('lead') ? `${label('lead')}少于 ${minGroup} 条的只报数字，不比高低；待处理是现在该跟的（首跟超时、跟进断了），不分时间段。` : ''}`,
  }
}

/** What stands out between the rows: the few to look at first. Small rows are left out of every comparison. */
function highlights(rows, total, { spec, label, can, flags, minGroup }) {
  const out = []
  const named = rows.filter(r => r.key !== NO_OWNER)
  const say = (list, f) => list.map(r => `${r.key} ${f(r)}`).join('、')
  const big = named.filter(r => (r.leads ?? 0) >= minGroup)
  if (can?.follow && total.onTimePct !== null && big.length >= 4) {
    const slow = big.filter(r => r.onTimePct !== null && r.onTimePct <= total.onTimePct - 10).sort((a, b) => a.onTimePct - b.onTimePct).slice(0, TOP)
    if (slow.length) out.push({ id: 'slow', tone: 'warn', owners: slow.map(r => r.key), title: `首次跟进最不及时的：${say(slow, r => `${r.onTimePct}%`)}`, detail: `整体是 ${total.onTimePct}%。`, suggest: `先看这几家是没人跟、还是跟了没登记。把它们超时的${label('lead')}导出来，一家一份发过去。` })
  }
  if ((total.todo ?? 0) > 0) {
    const most = named.filter(r => r.todo > 0).sort((a, b) => b.todo - a.todo).slice(0, TOP)
    const sum = most.reduce((a, r) => a + r.todo, 0)
    if (most.length) out.push({ id: 'todo', tone: sum >= total.todo * 0.5 ? 'bad' : 'warn', owners: most.map(r => r.key), title: `待处理的${label('lead')}最多的：${say(most, r => `${fmt(r.todo)} 条`)}`, detail: `这 ${most.length} 家占全部 ${fmt(total.todo)} 条的 ${pct(sum, total.todo)}%。`, suggest: '压得最多的先清：按家导出待处理名单，约定几天内跟完。' })
  }
  if (can?.result && total.winPct !== null && big.length >= 4) {
    const ranked = big.filter(r => r.winPct !== null).sort((a, b) => b.winPct - a.winPct)
    const best = ranked.slice(0, TOP)
    const worst = ranked.slice(-TOP).reverse().filter(r => !best.includes(r) && r.winPct < total.winPct)
    if (best.length && worst.length && best[0].winPct - worst[0].winPct >= 10) out.push({ id: 'win', tone: 'info', owners: [...best, ...worst].map(r => r.key), title: `成交率高的：${say(best, r => `${r.winPct}%`)}；低的：${say(worst, r => `${r.winPct}%`)}`, detail: `整体是 ${total.winPct}%。最近进来的${label('lead')}还没走完，时间段短的时候别急着下结论。`, suggest: `先看低的几家差在哪一步（没跟、没${leadSettings(spec).trialName}、还是谈不下来），再看高的几家是怎么做的。` })
  }
  for (const f of flags) {
    const kind = kindOf(spec.flags.find(x => x.name === f))
    const n = total.flags[f]?.count ?? 0
    if (kind === 'deadline' && n > 0) {
      const most = named.filter(r => r.flags[f].count > 0).sort((a, b) => b.flags[f].count - a.flags[f].count).slice(0, TOP)
      if (most.length) out.push({ id: `deadline:${f}`, tone: 'warn', flag: f, owners: most.map(r => r.key), title: `「${f}」的 ${fmt(n)} 人分在 ${named.filter(r => r.flags[f].count > 0).length} 家，最多的：${say(most, r => `${fmt(r.flags[f].count)} 人`)}`, detail: '', suggest: `有时间点的事，按家出名单发下去最直接：每家只拿到自己的${label('customer')}。` })
    }
    if (kind === 'gap' && n > 0) {
      const worst = named.filter(r => r.customers >= MIN_PEOPLE && r.flags[f].pct !== null && r.flags[f].pct >= (total.flags[f].pct ?? 0) + 10).sort((a, b) => b.flags[f].pct - a.flags[f].pct).slice(0, TOP)
      if (worst.length) out.push({ id: `gap:${f}`, tone: 'warn', flag: f, owners: worst.map(r => r.key), title: `「${f}」占比最高的：${say(worst, r => `${r.flags[f].pct}%`)}`, detail: `整体是 ${total.flags[f].pct}%。`, suggest: '这几家的人最难联系上，补联系方式先从它们开始。' })
    }
  }
  return out.slice(0, 5)
}

/**
 * One 归属方 up close: its row, what it is in the directory, where its leads stand and who follows them.
 * `shared` carries a board and the sorted leads already computed, when many are asked for in one go.
 * @returns {object | null} null when nothing belongs to that name.
 */
export function ownerDetail(ctx, name, { window = 90 } = {}, shared = null) {
  const board = shared?.board ?? ownerBoard(ctx, { window })
  const row = board.rows.find(r => r.key === name)
  if (!row) return null
  const entry = (ctx.data.owners ?? []).find(o => o.name === name) ?? null
  const out = { kind: 'owner_detail', asOf: ctx.asOf, from: board.from, to: board.to, window, label: board.label, owner: name, id: entry?.id ?? null, aliases: entry?.aliases ?? [], attrs: Object.entries(board.attributes).map(([k, n]) => ({ key: k, name: n, value: row.attrs[k] })), row, total: board.total, columns: board.columns, segments: board.segments, minGroup: board.minGroup }
  if (capabilities(ctx.spec).has('lead')) {
    const all = shared?.buckets ?? buckets(ctx, window).out
    const mine = all.get(name)?.leads ?? []
    const st = leadStats(mine, ctx.leadCan)
    out.states = Object.entries(LEAD_STATES).map(([key, n]) => ({ key, name: n, count: st.states[key], action: ACTION_STATES.has(key) }))
    const reps = new Map()
    for (const l of mine) { const k = l.rep ?? NO_VALUE; if (!reps.has(k)) reps.set(k, []); reps.get(k).push(l) }
    out.reps = [...reps].map(([k, list]) => { const s = leadStats(list, ctx.leadCan); return { key: k, leads: s.leads, followPct: s.followPct, onTimePct: s.onTimePct, medianHours: s.followHours?.median ?? null, winPct: s.winPct, todo: s.action, small: s.leads < board.minGroup } }).sort((a, b) => b.leads - a.leads).slice(0, 12)
  }
  return out
}

/**
 * 经营简报: one page per 归属方, as Markdown, made of the board's own numbers and nothing else.
 *
 * What a store or dealer gets from the head office: where it stands against everyone and against its own
 * group (region), what to do first, where its leads are and who holds them, how its customers spread, and
 * how many of them can be reached. Every sentence is a comparison of two numbers on the board; no model
 * writes it, so the same data always gives the same page. No customer is named.
 * @param {object} ctx - analysis context.
 * @param {{ window?: number|'all', by?: string|null, owners?: string[]|null }} [options] - `by`: the attribute
 *   whose value is the "own group" column (default: the first attribute the configuration has).
 * @returns {{ label: string, window: number|'all', from: string, to: string, by: string|null, briefs: { owner: string, id: string|null, markdown: string, todo: number }[] }}
 */
export function ownerBriefs(ctx, { window = 90, by = null, owners = null } = {}) {
  const spec = ctx.spec
  const label = e => spec.labels?.[e] ?? ENTITIES[e].name
  const attributes = ownerAttributes(spec)
  const groupBy = by && Object.hasOwn(attributes, by) ? by : Object.keys(attributes)[0] ?? null
  const board = ownerBoard(ctx, { window, by: groupBy })
  const shared = { board, buckets: buckets(ctx, window).out }
  const can = ctx.leadCan
  const fed = capabilities(spec)
  const span = window === 'all' ? '全部时间' : `近 ${window} 天`
  const n = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'))
  const p = v => (v === null || v === undefined ? '—' : `${v}%`)
  const kinds = Object.fromEntries(spec.flags.map(f => [f.name, kindOf(f)]))
  const has = k => board.columns.some(c => c.key === k)
  // Late and stalled leads of each 归属方 as they stand now, whenever they came in.
  const waiting = new Map()
  if (fed.has('lead')) for (const l of ctx.leads) if (ACTION_STATES.has(l.state)) { const k = l.owner ?? NO_OWNER; const w = waiting.get(k) ?? { late: 0, stalled: 0 }; w[l.state]++; waiting.set(k, w) }
  const peers = board.rows.filter(r => r.key !== NO_OWNER && !r.small && (r.leads ?? 0) > 0)
  // Place among the peers: one more than the number of peers strictly ahead, so equal numbers share a place.
  const rank = (row, key) => {
    const list = peers.filter(r => r[key] !== null && r[key] !== undefined)
    if (list.length < 4 || !list.some(r => r.key === row.key)) return null
    return { place: 1 + list.filter(r => r[key] > row[key]).length, of: list.length, tied: list.filter(r => r[key] === row[key]).length > 1 }
  }
  const picked = (owners ? board.rows.filter(r => owners.includes(r.key)) : board.rows.filter(r => r.key !== NO_OWNER && (r.customers > 0 || (r.leads ?? 0) > 0 || (r.todo ?? 0) > 0)))
  const briefs = picked.map(row => {
    const d = ownerDetail(ctx, row.key, { window }, shared)
    const t = board.total
    const groupValue = groupBy ? row.attrs[groupBy] : null
    const g = groupBy && groupValue && groupValue !== NO_VALUE ? board.groups.find(x => x.key === groupValue) ?? null : null
    const gName = g ? `同${attributes[groupBy]}（${groupValue}，${g.owners} 家）` : null
    const head = ['指标', '这一家', `全部${board.label}`, ...(g ? [gName] : [])]
    const line = (name, f) => `| ${[name, f(row), f(t), ...(g ? [f(g)] : [])].join(' | ')} |`
    const out = [`# ${row.key} · 经营简报`, '']
    out.push([d.id, ...d.attrs.filter(a => a.value !== NO_VALUE).map(a => `${a.name}：${a.value}`)].filter(Boolean).join(' · ') || board.label)
    out.push('', `数据截至 ${ctx.asOf}。带时间的数是${span}（${board.from} ～ ${board.to}）。`, '', '## 一眼看', '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`)
    out.push(line(`${label('customer')}数`, r => n(r.customers)))
    if (has('txns')) out.push(line(`${span}${label('transaction')}（笔）`, r => n(r.txns)))
    if (has('amount')) out.push(line(`${span}金额（元）`, r => n(r.amount)))
    if (has('leads')) out.push(line(`${span}新${label('lead')}`, r => n(r.leads)))
    if (has('onTimePct')) out.push(line('首次跟进及时', r => p(r.onTimePct)))
    else if (has('followPct')) out.push(line('跟进过', r => p(r.followPct)))
    if (has('winPct')) out.push(line('成交率', r => p(r.winPct)))
    if (has('todo')) out.push(line(`现在待处理的${label('lead')}`, r => n(r.todo)))
    // What to do first: each line compares two numbers above.
    const todo = []
    const w = waiting.get(row.key)
    if (w && w.late + w.stalled > 0) todo.push(`有 **${n(w.late + w.stalled)} 条**${label('lead')}等着跟：留资超过 ${leadSettings(spec).followDays} 天还没人跟的 ${n(w.late)} 条，超过 ${leadSettings(spec).staleDays} 天没再联系的 ${n(w.stalled)} 条。先清这些。`)
    const against = (key, name, better) => {
      if (!has(key) || row.small || row[key] === null || t[key] === null) return
      const diff = round1(row[key] - t[key])
      const r = rank(row, key)
      const place = r ? `，在 ${r.of} 家里${r.tied ? '并列' : '排'}第 ${r.place}` : ''
      if (diff <= -10) todo.push(`${name} **${p(row[key])}**，比全部${board.label}的 ${p(t[key])} 低 ${Math.abs(diff)} 个点${place}。${better}`)
      else if (diff >= 10) todo.push(`${name} ${p(row[key])}，比全部${board.label}的 ${p(t[key])} 高 ${diff} 个点${place}。保持。`)
    }
    against('onTimePct', '首次跟进及时', `留资后 ${leadSettings(spec).followDays} 天内要有第一次跟进，并且登记上。`)
    against('winPct', '成交率', `看看是没跟上、没${leadSettings(spec).trialName}，还是谈不下来。`)
    for (const c of board.columns.filter(x => x.flag && kinds[x.flag] === 'deadline')) if (row.flags[c.flag].count > 0) todo.push(`「${c.flag}」**${n(row.flags[c.flag].count)} 人**：有时间点，到期前联系。`)
    const reach = board.columns.filter(x => x.flag && kinds[x.flag] === 'reach')
    for (const c of reach) {
      const mine = row.flags[c.flag]
      const all = t.flags[c.flag]
      if (row.customers >= MIN_PEOPLE && mine.pct !== null && all.pct !== null && mine.pct <= all.pct - 10) todo.push(`「${c.flag}」只有 ${p(mine.pct)}，全部${board.label}是 ${p(all.pct)}，还差 ${n(row.customers - mine.count)} 人。`)
    }
    out.push('', '## 要先做的', '', ...(todo.length ? todo.map(x => `- ${x}`) : ['- 这段时间各项都不比整体差，照常跟进。']))
    if (row.small && has('leads')) out.push('', `> ${span}新${label('lead')}不到 ${board.minGroup} 条，跟进和成交的比例只供参考，不和别家比高低。`)
    if (d.states && row.leads > 0) {
      out.push('', `## ${label('lead')}走到哪了`, '', `${span}进来的 ${n(row.leads)} 条，到 ${ctx.asOf} 为止：`, '', '| 状态 | 条数 |', '|---|---|', ...d.states.filter(x => x.count > 0).map(x => `| ${x.name} | ${n(x.count)} |`))
      // A table of who follows is worth printing when the export names them.
      if (d.reps?.some(x => x.key !== NO_VALUE)) {
        const cols = ['跟进人', label('lead'), has('onTimePct') ? '首跟及时' : '跟进过', ...(has('winPct') ? ['成交率'] : []), '待处理']
        out.push('', '## 谁在跟', '', `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...d.reps.map(x => `| ${[x.key, n(x.leads), p(has('onTimePct') ? x.onTimePct : x.followPct), ...(has('winPct') ? [p(x.winPct)] : []), n(x.todo)].join(' | ')} |`))
      }
    }
    if (row.customers > 0) {
      const share = (k, r) => (r.customers ? p(round1((k / r.customers) * 100)) : '—')
      out.push('', `## ${label('customer')}`, '', `| 分层 | 人数 | 占这一家 | 全部${board.label} |`, '|---|---|---|---|', ...board.segments.filter(s => row.segments[s] > 0).map(s => `| ${s} | ${n(row.segments[s])} | ${share(row.segments[s], row)} | ${share(t.segments[s], t)} |`))
      const marks = board.columns.filter(x => x.flag && kinds[x.flag] !== 'reach')
      if (marks.length) out.push('', `| 标记 | 人数 | 占这一家 | 全部${board.label} |`, '|---|---|---|---|', ...marks.map(c => `| ${c.flag} | ${n(row.flags[c.flag].count)} | ${p(row.flags[c.flag].pct)} | ${p(t.flags[c.flag].pct)} |`))
      if (reach.length) out.push('', '## 联系得上多少人', '', `| 渠道 | 人数 | 覆盖 | 全部${board.label} | 还差 |`, '|---|---|---|---|---|', ...reach.map(c => `| ${c.flag} | ${n(row.flags[c.flag].count)} | ${p(row.flags[c.flag].pct)} | ${p(t.flags[c.flag].pct)} | ${n(row.customers - row.flags[c.flag].count)} |`))
    }
    out.push('', '---', '', `口径：${board.note}`)
    return { owner: row.key, id: d.id, markdown: out.join('\n'), todo: row.todo ?? 0 }
  })
  return { label: board.label, window, from: board.from, to: board.to, by: groupBy, briefs }
}

/** The board as rows of a sheet: header and one line per 归属方 (or per group). */
export function boardSheet(board, rows = board.rows, first = board.label) {
  const attrs = rows === board.rows ? Object.entries(board.attributes) : []
  const head = [first, ...(rows === board.rows ? ['编号'] : ['几家']), ...attrs.map(([, n]) => n), ...board.columns.flatMap(c => (c.flag ? [c.name, `${c.name}占比（%）`] : [c.unit === 'pct' ? `${c.name}（%）` : c.unit === 'hours' ? `${c.name}（小时）` : c.name]))]
  const cell = (r, c) => (c.flag ? [r.flags[c.flag].count, r.flags[c.flag].pct ?? ''] : [r[c.key] ?? ''])
  const line = r => [r.key, rows === board.rows ? r.id ?? '' : r.owners ?? '', ...attrs.map(([k]) => r.attrs?.[k] ?? ''), ...board.columns.flatMap(c => cell(r, c))]
  return [head, ...rows.map(line), line({ ...board.total, key: '合计', id: '', owners: board.rows.length, attrs: {} })]
}
