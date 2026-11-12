/**
 * 名单: batches of people picked here, contacted elsewhere (平台工坊 or an
 * exported sheet), with results coming back.
 *
 * Everything about lists lives in the dataset's 名单.json: the batches with
 * their members and results, who has left, and transfers waiting for review.
 * Members are remembered by their records' side keys as well as by customer
 * id, so a later merge does not lose them.
 *
 * Results and what they do (the outcome kinds come from the configuration):
 *   success      counts only when a transaction in the window confirms it
 *   booked       waits for a transaction; after the window it is a no-show
 *   decline      no new list for the same purpose during the cooldown
 *   unreachable  no new list at all during the cooldown
 *   transfer     goes to review; confirmed → 已离开
 *   leave        → 已离开 at once
 *
 * What counts as the list having worked. By default a transaction in the window. A list made to close a gap
 * ("people without tag X": not added on chat, not registered) is not after a sale: it worked when the person
 * carries the tag at a later import. Such a list has a goal, the tags it is after; the batch remembers who else
 * lacked them that day (same segments, not on the list), and later data says how many on each side gained one.
 */
import { daysBefore, daysBetween, dayOf } from './clean.js'
import { NEW_ARRIVAL, OTHER, round1, segmentAll } from './features.js'
import { CONSENT, consentNeeded, tracksConsent } from './spec.js'

export const LEFT = '已离开'
export const GRACE_DAYS = 7
const DEFAULT_COOLDOWN = { decline: 90, unreachable: 30 }

export const emptyLists = () => ({ schema: 1, seq: 0, batches: [], left: {}, transfers: [], restored: {} })

const addDays = (date, n) => daysBefore(date, -n)

/** The outcome definitions of a configuration, with a lookup by code. */
export function outcomesOf(spec) {
  const list = spec.lists?.outcomes ?? []
  return { list, byCode: new Map(list.map(o => [o.code, o])) }
}

/** Last day results of a batch can be confirmed by transactions. */
export const windowEnd = b => addDays(b.due, GRACE_DAYS)

/** A batch still blocks its open members from new lists. */
export function isLive(b, today) {
  if (b.closedAt) return false
  return b.to === 'excel' ? today <= b.due : today <= windowEnd(b)
}

/** Map side keys and ids of the current version to customers. */
export function memberIndex(data) {
  const bySide = new Map()
  for (const c of data.customers) for (const k of c.sideKeys ?? []) bySide.set(k, c.cid)
  const ids = new Set(data.customers.map(c => c.cid))
  return m => (ids.has(m.cid) ? m.cid : (m.sideKeys ?? []).map(k => bySide.get(k)).find(Boolean) ?? null)
}

/**
 * Why a customer cannot go into a new list for a purpose today, or null.
 * @returns {null | { kind: 'left'|'running'|'cooldown'|'transfer', until?: string, batch?: string, why?: string }}
 */
export function blockOf(cid, file, { purpose, today, spec, resolve }) {
  if (file.left[cid]) return { kind: 'left', why: file.left[cid].why }
  const { byCode } = outcomesOf(spec)
  if (file.transfers.some(t => t.status === 'open' && t.cid === cid)) return { kind: 'transfer' }
  let cooldown = null
  for (const b of file.batches) {
    const m = b.members.find(x => resolve(x) === cid)
    if (!m) continue
    const kind = m.outcome ? byCode.get(m.outcome)?.kind : null
    if (isLive(b, today) && (!kind || kind === 'booked' || kind === 'success')) return { kind: 'running', batch: b.id, name: b.name }
    if (!m.at || (kind !== 'decline' && kind !== 'unreachable')) continue
    if (kind === 'decline' && b.purpose !== purpose) continue
    const days = byCode.get(m.outcome)?.cooldownDays ?? DEFAULT_COOLDOWN[kind]
    const until = addDays(dayOf(m.at), days)
    if (today < until && (!cooldown || until > cooldown.until)) cooldown = { kind: 'cooldown', until, batch: b.id, why: byCode.get(m.outcome)?.name ?? m.outcome }
  }
  return cooldown
}

/**
 * Who a new list would hold: everyone matching the filter, minus those who left,
 * are in a running list, are cooling down or wait for transfer review, and, when
 * the configuration reads marketing consent and the purpose is not a service
 * contact, minus everyone whose consent is not `同意`.
 * @param {object} ctx - analysis context (index, segments, data).
 * @param {object} file - 名单.json.
 * @param {{ segment?, flag?, without?: string[], owner?, cids?, purpose, today }} pick - `without`: tags the person carries none of.
 */
export function poolOf(ctx, file, spec, pick) {
  const resolve = memberIndex(ctx.data)
  const s = ctx.segments
  const candidates = pick.cids
    ? pick.cids.filter(cid => ctx.index.has(cid))
    : [...ctx.index.keys()].filter(cid => (!pick.segment || s.of.get(cid) === pick.segment) && (!pick.flag || (s.flagsOf.get(cid) ?? []).includes(pick.flag)) && (!pick.without || pick.without.every(f => !(s.flagsOf.get(cid) ?? []).includes(f))) && (!pick.owner || ctx.index.get(cid).c.owner === pick.owner) && (!pick.was || (ctx.segmentsThen.of.get(cid) ?? NEW_ARRIVAL) === pick.was))
  const needsConsent = consentNeeded(spec, pick.purpose)
  const excluded = { left: [], running: [], cooldown: [], transfer: [], consent: [] }
  const kept = []
  for (const cid of candidates) {
    const b = blockOf(cid, file, { purpose: pick.purpose, today: pick.today, spec, resolve })
    if (b) excluded[b.kind].push(cid)
    else if (needsConsent && ctx.index.get(cid).c.consent !== CONSENT.granted) excluded.consent.push(cid)
    else kept.push(cid)
  }
  const byOwner = {}
  for (const cid of kept) { const o = ctx.index.get(cid).c.owner ?? '（没有归属）'; byOwner[o] = (byOwner[o] ?? 0) + 1 }
  return { match: candidates.length, kept, excluded, consent: { tracked: tracksConsent(spec), needed: needsConsent }, byOwner: Object.entries(byOwner).sort((a, b) => b[1] - a[1]) }
}

/** A default purpose for a pick: the first purpose whose name the segment or flag suggests, else the first. */
export function suggestPurpose(spec, pick) {
  const purposes = spec.lists?.purposes ?? []
  const hint = `${pick.segment ?? ''}${pick.flag ?? ''}${(pick.without ?? []).join('')}`
  return purposes.find(p => hint && (p.includes(hint) || hint.includes(p.slice(0, 2)))) ?? purposes[0] ?? '跟进'
}

/**
 * The tags a list is after, or null: what was asked for, else the tags the pick says the people lack.
 * @param {object} spec
 * @param {{ without?: string[] }} pick
 * @param {string|string[]|null|undefined} asked - tag names; `null`, `''`, `'none'` or `[]` for no goal;
 *   `undefined` to take it from the pick.
 * @returns {{ flags: string[] } | null}
 * @throws {Error & { code: 'bad-goal' }} a name that is not one of the configuration's tags.
 */
export function goalOf(spec, pick, asked) {
  if (asked === null || asked === '' || asked === 'none' || (Array.isArray(asked) && asked.length === 0)) return null
  const names = asked === undefined ? pick.without ?? [] : [].concat(asked).map(String)
  if (names.length === 0) return null
  const known = (spec.flags ?? []).map(f => f.name)
  const unknown = names.filter(n => !known.includes(n))
  if (unknown.length) throw Object.assign(new Error(`名单的目标只能是配置里的标记：${known.join('、') || '（还没有标记）'}。没有「${unknown.join('、')}」`), { code: 'bad-goal' })
  return { flags: [...new Set(names)] }
}

/** Where a member of a list with a goal is counted when the data shows the tag and nobody marked a result. */
export const GOAL_REACHED = 'goal'

/** The line for those members, shaped like a configured outcome, for the pages that list outcomes. */
export const goalOutcome = goal => ({ code: GOAL_REACHED, name: `${goalText(goal)}了`, kind: 'success', then: '数据里看到的：没人标结果，但新数据里已经带上了' })

/** A goal in words: 带上「已加企微」; with several, any one of them counts. */
export const goalText = goal => (goal ? `带上${goal.flags.map(f => `「${f}」`).join('或')}` : null)

/**
 * A goal as a batch keeps it: the tags, which members already carried one that day (they cannot gain it), and
 * the comparison group: people of the same segments as the members, not on the list, not gone, carrying none
 * of the tags that day.
 */
export function goalAtCreation(ctx, file, goal, memberCids) {
  if (!goal) return null
  const flagsOf = cid => ctx.segments.flagsOf.get(cid) ?? []
  const has = cid => goal.flags.some(f => flagsOf(cid).includes(f))
  const inBatch = new Set(memberCids)
  const segs = new Set(memberCids.map(cid => ctx.segments.of.get(cid) ?? OTHER))
  const control = [...ctx.index.keys()].filter(cid => !inBatch.has(cid) && !file.left[cid] && segs.has(ctx.segments.of.get(cid) ?? OTHER) && !has(cid))
  return { flags: goal.flags, had: memberCids.filter(has), control }
}

/** A readable name: purpose · what was picked. */
export function batchName(purpose, pick, count) {
  const what = pick.cids ? (count === 1 ? '一个人' : `勾选的 ${count} 人`) : [`${pick.segment ?? '全部客户'}${pick.was ? `（30 天前在${pick.was}）` : ''}`, pick.flag, pick.without?.length ? `没有${pick.without.join('、')}` : null, pick.owner].filter(Boolean).join(' · ')
  return `${purpose} · ${what}`
}

/**
 * Where each member of a batch stands now, with the transactions of the latest
 * data deciding what really happened.
 */
export function batchView(b, file, ctx, spec, today) {
  const resolve = memberIndex(ctx.data)
  const { byCode, list } = outcomesOf(spec)
  const end = windowEnd(b)
  const until = end < ctx.asOf ? end : ctx.asOf
  const visited = cid => {
    const e = cid && ctx.index.get(cid)
    return Boolean(e && e.txns.some(t => t.counted && !t.refund && t.date && dayOf(t.date) >= b.createdAt && dayOf(t.date) <= until))
  }
  // A list with a goal is confirmed by the tag, not by a transaction: carrying one of the tags now.
  const goal = b.goal ?? null
  const carries = cid => Boolean(cid) && goal.flags.some(f => (ctx.segments.flagsOf.get(cid) ?? []).includes(f))
  const had = new Set(goal?.had ?? [])
  // Data newer than the day the list was made: before that nothing can have changed.
  const fresh = ctx.asOf > b.asOf || (ctx.version ?? 0) > (b.dataVersion ?? 0)
  const counts = Object.fromEntries([...list.map(o => [o.code, 0]), ...(goal ? [[GOAL_REACHED, 0]] : []), ['wait', 0]])
  const members = b.members.map(m => {
    const cid = resolve(m)
    const kind = m.outcome ? byCode.get(m.outcome)?.kind ?? null : null
    const came = visited(cid)
    const reached = goal ? (had.has(m.cid) ? null : carries(cid)) : null
    const confirmed = goal ? reached === true : came
    let shown = m.outcome ?? 'wait'
    let note = null
    if (confirmed && kind !== 'leave' && kind !== 'transfer') {
      // The success the person marked stays. Nobody marked it: a transaction counts as the first success the
      // configuration names (that is what it has always meant); a tag gained is its own line, because the
      // configured successes are about visits and sales and would mislabel it.
      const success = kind === 'success' ? byCode.get(m.outcome) : goal ? { code: GOAL_REACHED } : list.find(o => o.kind === 'success')
      if (success) shown = success.code
      note = goal ? (kind === 'success' ? '数据确认：带上了' : '没标，但数据显示带上了') : kind === 'success' ? '交易确认' : '没标，但交易显示来了'
    } else if (kind === 'success') {
      const booked = list.find(o => o.kind === 'booked')
      shown = booked ? booked.code : 'wait'
      note = goal ? (fresh ? '标了，但新数据里还没带上' : '等下次导入确认') : ctx.asOf >= end ? '标了，但交易里没对上' : '等交易确认'
    } else if (kind === 'booked' && ctx.asOf >= end && !goal) note = '过了观察期还没交易，算没来'
    if (counts[shown] === undefined) counts[shown] = 0
    counts[shown]++
    const left = cid ? file.left[cid] : null
    const transfer = file.transfers.find(t => t.batch === b.id && t.cid === cid)
    return { ...m, cid, shown, note, came, reached, left: left ?? null, transfer: transfer ? transfer.status : null, segmentNow: cid ? ctx.segments.of.get(cid) ?? null : null, gone: !cid }
  })
  const n = members.length
  const cameN = members.filter(m => m.came).length
  // Control: not in this batch, same segments as the members when the batch was made.
  let base = null
  if (n > 0) {
    const segs = new Set(b.members.map(m => m.segment).filter(Boolean))
    const at = b.asOf <= ctx.asOf ? b.asOf : ctx.asOf
    const before = segmentAll(ctx.index, spec, at).of
    const inBatch = new Set(members.map(m => m.cid).filter(Boolean))
    const control = [...ctx.index.keys()].filter(cid => !inBatch.has(cid) && !file.left[cid] && segs.has(before.get(cid) ?? OTHER))
    const ctlCame = control.filter(visited).length
    base = { people: control.length, came: ctlCame, ratePct: control.length ? round1((ctlCame / control.length) * 100) : null }
  }
  // The goal: of the members who lacked the tags that day and are still in the data, how many carry one now;
  // and the same for the people who lacked them too but were not put on the list.
  let goalView = null
  if (goal) {
    const open = members.filter(m => m.reached !== null && !m.gone)
    const got = open.filter(m => m.reached).length
    const ctl = (goal.control ?? []).filter(cid => ctx.index.has(cid))
    const ctlGot = ctl.filter(carries).length
    goalView = {
      flags: goal.flags, text: goalText(goal), fresh,
      people: open.length, reached: got, ratePct: open.length ? round1((got / open.length) * 100) : null,
      had: had.size, gone: members.filter(m => m.gone).length,
      base: ctl.length ? { people: ctl.length, reached: ctlGot, ratePct: round1((ctlGot / ctl.length) * 100) } : null,
      madeAt: { asOf: b.asOf, version: b.dataVersion ?? null }, now: { asOf: ctx.asOf, version: ctx.version ?? null },
      note: fresh
        ? `看的是数据里的标记：名单是按截至 ${b.asOf} 的数据出的，现在的数据截至 ${ctx.asOf}。对面那一组是当时同层、同样没有这个标记、没进名单的人。`
        : `名单生成以后还没有导入新数据（现在还是截至 ${ctx.asOf} 的那一版），标记不会变。下次导入之后这里才有数。`,
    }
  }
  const status = b.closedAt ? 'closed' : isLive(b, today) ? (b.to === 'excel' ? 'exported' : 'running') : 'done'
  return {
    id: b.id, name: b.name, purpose: b.purpose, createdAt: b.createdAt, due: b.due, windowEnd: end, complete: ctx.asOf >= end, to: b.to, status, source: b.source, byOwner: b.byOwner, workshop: b.workshop ?? null, exported: b.exported ?? null,
    people: n, counts, came: cameN, ratePct: n ? round1((cameN / n) * 100) : null, base, goal: goalView,
    members,
    caveat: '这是进了名单和没进的差别，不等于名单带来的增量。',
  }
}

/** What a result does to the person, in plain words. */
export function consequence(outcome, spec, goal = null) {
  if (!outcome) return '还没结果'
  const o = outcomesOf(spec).byCode.get(outcome)
  if (!o) return ''
  switch (o.kind) {
    case 'success': return goal ? `以数据为准，下次导入${goalText(goal)}了才算` : '以交易为准，下次导入对上了才算'
    case 'booked': return goal ? `等数据确认：下次导入${goalText(goal)}了才算` : `等交易确认；联系完后 ${GRACE_DAYS} 天还没交易，算没来`
    case 'decline': return `${o.cooldownDays ?? DEFAULT_COOLDOWN.decline} 天内不会因为同一个原因再进名单`
    case 'unreachable': return `${o.cooldownDays ?? DEFAULT_COOLDOWN.unreachable} 天内不进新名单`
    case 'transfer': return '进复核「疑似转手」，你确认后移到「已离开」'
    case 'leave': return '移到「已离开」，以后任何名单都不带他'
    default: return ''
  }
}

/** Customers with three unreachable results in a row: the phone number is probably wrong. */
export function unreachableStreaks(file, spec, resolve) {
  const { byCode } = outcomesOf(spec)
  const seq = new Map()
  for (const b of [...file.batches].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    for (const m of b.members) {
      const cid = resolve(m)
      if (!cid || !m.outcome) continue
      const k = byCode.get(m.outcome)?.kind
      seq.set(cid, k === 'unreachable' ? (seq.get(cid) ?? 0) + 1 : 0)
    }
  }
  return [...seq].filter(([, n]) => n >= 3).map(([cid]) => cid)
}

export { daysBetween }
