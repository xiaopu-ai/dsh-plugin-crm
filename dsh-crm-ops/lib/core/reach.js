/**
 * 触达覆盖: how many of the customers can be reached, and through what.
 *
 * A configuration marks some tags as ways to reach a person (`kind: "reach"`): added on chat, picked up
 * the phone, registered in the app. Coverage of a channel is the share of customers carrying its tag; the
 * people who carry none of them cannot be reached at all. The board lays coverage out by segment and by
 * 归属方, so the gaps show where they are: which stage of ownership nobody added on chat, which dealer
 * never got its customers into the app. Every cell names a group of people a list can be made from:
 * a segment or a 归属方, without one channel.
 *
 * Customers who left are not counted. Nothing here names an industry.
 */
import { OTHER, round1 } from './features.js'
import { kindOf } from './insights.js'
import { ENTITIES, capabilities, missingEntities, ownerAttributes } from './spec.js'

export const NO_OWNER = '（没有归属）'
const NO_VALUE = '（没填）'
/** Fewer people than this in a row and its share says little. */
export const REACH_MIN_PEOPLE = 20
const TOP = 3

const pct = (n, total) => (total ? round1((n / total) * 100) : null)
const fmt = n => Number(n).toLocaleString('en-US')

/** The tags a configuration marks as ways to reach a person, in its order; tags switched off are left out. */
export function reachChannels(spec) {
  const fed = capabilities(spec)
  return (spec.flags ?? []).filter(f => kindOf(f) === 'reach' && missingEntities(f, fed).length === 0).map(f => f.name)
}

/** The numbers of one group of customers: how many carry each channel, how many carry none. */
function measure(ctx, key, cids, channels) {
  const flagsOf = ctx.segments.flagsOf
  const out = { key, customers: cids.length, channels: {}, none: null, any: null }
  const counts = Object.fromEntries(channels.map(c => [c, 0]))
  let none = 0
  for (const cid of cids) {
    const mine = flagsOf.get(cid) ?? []
    let hit = false
    for (const c of channels) if (mine.includes(c)) { counts[c]++; hit = true }
    if (!hit) none++
  }
  for (const c of channels) out.channels[c] = { count: counts[c], pct: pct(counts[c], cids.length), missing: cids.length - counts[c] }
  out.none = { count: none, pct: pct(none, cids.length) }
  out.any = { count: cids.length - none, pct: pct(cids.length - none, cids.length) }
  return out
}

/**
 * The board.
 * @param {object} ctx - analysis context (analysis.js `context`).
 * @param {{ by?: string|null }} [options] - an attribute of the 归属方 directory to roll the owners up by.
 * @returns {object} `on: false` when the configuration marks no channel.
 */
export function reachBoard(ctx, { by = null } = {}) {
  const spec = ctx.spec
  const label = e => spec.labels?.[e] ?? ENTITIES[e].name
  const channels = reachChannels(spec)
  if (channels.length === 0) return { kind: 'reach', asOf: ctx.asOf, on: false, channels: [], candidates: spec.flags.map(f => f.name) }
  const attributes = ownerAttributes(spec)
  if (by !== null && !Object.hasOwn(attributes, by)) by = null
  const all = [...ctx.index.keys()].filter(cid => !ctx.left?.has(cid))
  const total = measure(ctx, '合计', all, channels)
  // How many channels each person has: 0, 1, 2, …
  const depth = Array.from({ length: channels.length + 1 }, () => 0)
  for (const cid of all) depth[(ctx.segments.flagsOf.get(cid) ?? []).filter(f => channels.includes(f)).length]++
  const segNames = [...spec.segments.map(s => s.name), OTHER]
  const bySeg = new Map(segNames.map(n => [n, []]))
  const byOwner = new Map()
  for (const cid of all) {
    bySeg.get(ctx.segments.of.get(cid))?.push(cid)
    const o = ctx.index.get(cid).c.owner ?? NO_OWNER
    if (!byOwner.has(o)) byOwner.set(o, [])
    byOwner.get(o).push(cid)
  }
  const segments = segNames.map(n => measure(ctx, n, bySeg.get(n), channels)).filter(r => r.customers > 0)
  const directory = new Map((ctx.data.owners ?? []).map(o => [o.name, o]))
  const attr = (name, key) => { const o = directory.get(name); const v = !o ? null : key.startsWith('extra.') ? o.extra?.[key.slice(6)] : o[key]; return v ?? NO_VALUE }
  const named = [...byOwner.keys()].some(k => k !== NO_OWNER)
  const owners = named ? [...byOwner].map(([k, cids]) => ({ ...measure(ctx, k, cids, channels), id: directory.get(k)?.id ?? null, attrs: Object.fromEntries(Object.keys(attributes).map(a => [a, attr(k, a)])) })).sort((a, b) => b.customers - a.customers || a.key.localeCompare(b.key, 'zh')) : []
  let groups = null
  if (by && named) {
    const g = new Map()
    for (const [k, cids] of byOwner) { const v = k === NO_OWNER ? NO_OWNER : attr(k, by); if (!g.has(v)) g.set(v, { cids: [], owners: 0 }); g.get(v).cids.push(...cids); g.get(v).owners++ }
    groups = [...g].map(([k, x]) => ({ ...measure(ctx, k, x.cids, channels), owners: x.owners })).sort((a, b) => b.customers - a.customers)
  }
  return {
    kind: 'reach', asOf: ctx.asOf, on: true,
    label: label('owner'), customerLabel: label('customer'), channels, attributes, by,
    total, depth: depth.map((count, n) => ({ channels: n, count, pct: pct(count, all.length) })),
    segments, owners, groups,
    highlights: highlights({ total, segments, owners, channels, label, kinds: Object.fromEntries(spec.segments.map(x => [x.name, kindOf(x)])) }),
    minPeople: REACH_MIN_PEOPLE,
    note: `覆盖 = 带这个标记的${label('customer')}占这一行${label('customer')}的比例，截至 ${ctx.asOf}。少于 ${REACH_MIN_PEOPLE} 人的行只报数字，不比高低。「都没有」是哪个渠道都联系不上的人。`,
  }
}

/**
 * Where the gaps are: the few to look at first. Small rows are left out of every comparison; a segment or a
 * 归属方 is named once, for the channel where it is missing the most people.
 */
function highlights({ total, segments, owners, channels, label, kinds = {} }) {
  const out = []
  const who = label('customer')
  if (total.none.count > 0 && total.none.pct >= 10) {
    const worst = segments.filter(r => r.customers >= REACH_MIN_PEOPLE).sort((a, b) => b.none.count - a.none.count)[0]
    out.push({ id: 'none', tone: total.none.pct >= 50 ? 'bad' : 'warn', group: { without: channels }, count: total.none.count,
      title: `${fmt(total.none.count)} 位${who}（${total.none.pct}%）哪个渠道都联系不上`,
      detail: `${channels.map(c => `「${c}」`).join('')}一个都没有。${worst ? `最多的在「${worst.key}」：${fmt(worst.none.count)} 人。` : ''}`,
      suggest: '这些人现在只能等他们自己来。下一次有接触（到店、交付、活动、售后）的时候，先把一个渠道补上。' })
  }
  // Channels from the widest down: the gap in the channel most people already use is the cheapest to close.
  const wide = [...channels].filter(c => total.channels[c].pct !== null).sort((a, b) => total.channels[b].pct - total.channels[a].pct)
  const seenSeg = new Set()
  const seenOwner = new Set()
  for (const c of wide) {
    const all = total.channels[c]
    // People the configuration files under "never bought" or "just a group" are not where a channel is built first.
    const seg = segments.filter(r => !seenSeg.has(r.key) && !['never', null].includes(kinds[r.key] ?? null) && r.customers >= REACH_MIN_PEOPLE && r.channels[c].pct <= all.pct - 10).sort((a, b) => b.channels[c].missing - a.channels[c].missing)[0]
    if (seg) {
      seenSeg.add(seg.key)
      out.push({ id: `segment:${c}`, tone: 'warn', group: { segment: seg.key, without: [c] }, count: seg.channels[c].missing,
        title: `「${seg.key}」里「${c}」只有 ${seg.channels[c].pct}%，还差 ${fmt(seg.channels[c].missing)} 人`,
        detail: `整体是 ${all.pct}%。`,
        suggest: `这一层比别的层落后，先从这里补：把这 ${fmt(seg.channels[c].missing)} 人出成名单，按家发下去。` })
    }
    const low = owners.filter(r => r.key !== NO_OWNER && !seenOwner.has(r.key) && r.customers >= REACH_MIN_PEOPLE && r.channels[c].pct <= all.pct - 10).sort((a, b) => b.channels[c].missing - a.channels[c].missing).slice(0, TOP)
    if (low.length) {
      for (const r of low) seenOwner.add(r.key)
      out.push({ id: `owner:${c}`, tone: 'info', channel: c, owners: low.map(r => r.key), count: low.reduce((a, r) => a + r.channels[c].missing, 0),
        title: `「${c}」差得最多的${label('owner')}：${low.map(r => `${r.key} ${r.channels[c].pct}%（差 ${fmt(r.channels[c].missing)} 人）`).join('、')}`,
        detail: `整体是 ${all.pct}%。`,
        suggest: '先问这几家是没做，还是做了没登记；再把缺的人按家出名单。' })
    }
  }
  const order = { bad: 0, warn: 1, info: 2 }
  return out.sort((a, b) => order[a.tone] - order[b.tone] || b.count - a.count).slice(0, 4)
}
