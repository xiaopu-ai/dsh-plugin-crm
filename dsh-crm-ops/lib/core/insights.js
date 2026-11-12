/**
 * 发现和建议: what the board can tell about one data version without a model, and what to do next.
 *
 * What a segment or a tag means is read from the shape of its own rule, never from its name, so
 * this holds for any trade: "more than N days since the last deal" is a lapsing group, "the holding
 * ends within N days" has a deadline, "this field is blank" is a gap. Every finding points at a
 * group of people (`group`: segment, tag, and where they were 30 days ago) that the screens can
 * list and the analyst can be asked about.
 */
import { NEW_ARRIVAL, OTHER } from './features.js'

const SINCE = new Set(['days_since_last_txn', 'days_since_field', 'days_since_last_touch'])
const YOUNG = new Set(['days_since_first_seen', 'asset_age_days'])
const MORE = new Set(['>', '>='])
const LESS = new Set(['<', '<='])

/**
 * What a segment or tag rule is about.
 * @param {{ all?: object[], any?: object[] }} rule
 * @returns {'deadline'|'lapsed'|'never'|'new'|'valuable'|'active'|'gap'|null}
 */
export function ruleKind(rule) {
  // Conditions may nest (`any: [{ all: [...] }, ...]`); what they are about is the same.
  const flat = r => (r?.all ?? r?.any ?? []).flatMap(c => (c && (c.all || c.any) ? flat(c) : [c]))
  const cs = flat(rule)
  const has = test => cs.some(c => c && test(c))
  const low = c => c.op === 'between' && Array.isArray(c.value) && Number(c.value[0]) <= 30
  const none = c => (c.op === '=' && Number(c.value) === 0) || (c.op === '<' && Number(c.value) <= 1) || (c.op === '<=' && Number(c.value) === 0)
  // A deadline is still ahead: "ends within 60 days", not "ended already" (`< 0`).
  const ahead = c => (LESS.has(c.op) && Number(c.value) > 0) || (c.op === 'between' && Number(c.value?.[1]) >= 0)
  if (has(c => c.feature === 'asset_days_to_end' && ahead(c))) return 'deadline'
  // A holding picked by how many days are left to one of its dates ("the benefit ends within 60 days").
  if (has(c => (c.where ?? []).some(w => w?.days_to !== undefined && ahead(w)))) return 'deadline'
  if (has(c => SINCE.has(c.feature) && (MORE.has(c.op) || (c.op === 'between' && !low(c))))) return 'lapsed'
  if (has(c => (c.feature === 'has_txn' && c.op === '=' && c.value === false) || (['txn_count', 'asset_count'].includes(c.feature) && none(c)))) return 'never'
  if (has(c => YOUNG.has(c.feature) && (LESS.has(c.op) || c.op === 'between'))) return 'new'
  if (has(c => (c.feature === 'amount' && MORE.has(c.op)) || (['txn_count', 'asset_count', 'active_periods'].includes(c.feature) && MORE.has(c.op) && Number(c.value) >= (c.op === '>' ? 1 : 2)))) return 'valuable'
  if (has(c => (SINCE.has(c.feature) && (LESS.has(c.op) || low(c))) || (['txn_count', 'touch_count', 'active_periods'].includes(c.feature) && MORE.has(c.op)) || (c.feature === 'has_txn' && c.value === true))) return 'active'
  // A blank field, or one that says something is not there ("未…", "无…", "不…").
  if (has(c => c.feature === 'field' && c.op === '=' && (c.value === '' || /^(未|无|没|不|缺|非)/.test(String(c.value))))) return 'gap'
  return null
}

/**
 * What a segment or tag is: what its configuration says (`kind`), else what its rule looks like.
 * `lifecycle` and `plain` carry no judgment: nobody "slips" into a stage of ownership.
 * @returns {'deadline'|'lapsed'|'never'|'new'|'valuable'|'active'|'gap'|'lifecycle'|null}
 */
export function kindOf(rule) {
  if (rule?.kind === 'plain') return null
  return rule?.kind ?? ruleKind(rule)
}

const TONE_ORDER = { bad: 0, warn: 1, good: 2, info: 3 }
const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0)
const fmt = n => Number(n).toLocaleString('en-US')

/**
 * @param {object} spec - finalized configuration (segments, flags with their rules).
 * @param {object} seg - the `segments` query with flows.
 * @param {{ metric: string, name: string, before: number, now: number, changePct: number|null }|null} trend - last 30 days against the 30 before.
 * @returns {{ kinds: Record<string, string|null>, items: { id: string, tone: 'bad'|'warn'|'good'|'info', title: string, detail: string, suggest: string, count: number|null, group: { segment?: string, flag?: string, was?: string }|null }[] }}
 */
export function insights(spec, seg, trend = null) {
  const kinds = {}
  for (const s of spec.segments ?? []) kinds[s.name] = kindOf(s)
  const flagKinds = {}
  for (const f of spec.flags ?? []) flagKinds[f.name] = kindOf(f)
  const total = seg.total
  const rows = seg.rows.filter(r => r.name !== OTHER && !r.off)
  const ruleOf = name => seg.rows.find(r => r.name === name)?.rule ?? seg.flags.find(f => f.name === name)?.rule ?? ''
  const items = []
  const add = x => items.push(x)
  // Tags first: they are what the configuration marks for follow-up.
  const groups = [...(spec.flags ?? []).map(f => ({ name: f.name, kind: flagKinds[f.name], flag: true })), ...rows.map(r => ({ name: r.name, kind: kinds[r.name], flag: false }))]
  const countOf = g => (g.flag ? seg.flags.find(f => f.name === g.name)?.count : seg.rows.find(r => r.name === g.name)?.count) ?? 0
  const groupOf = g => (g.flag ? { flag: g.name } : { segment: g.name })
  const floor = Math.max(5, Math.round(total * 0.0005))

  // People who were fine 30 days ago and lapsed since: the easiest to win back.
  const slipped = (seg.flows?.moves ?? []).filter(m => kinds[m.to] === 'lapsed' && m.from !== NEW_ARRIVAL && kinds[m.from] !== 'lapsed' && m.count >= floor).sort((a, b) => b.count - a.count)[0]
  if (slipped) {
    add({ id: `slipped:${slipped.from}>${slipped.to}`, tone: 'bad', count: slipped.count, group: { segment: slipped.to, was: slipped.from },
      title: `近 30 天 ${fmt(slipped.count)} 人从「${slipped.from}」掉进了「${slipped.to}」`,
      detail: `30 天前他们还在「${slipped.from}」，现在${ruleOf(slipped.to) ? `符合「${slipped.to}」：${ruleOf(slipped.to)}` : `在「${slipped.to}」`}。`,
      suggest: `刚掉下去的人最容易拉回来，他们还记得你。先联系这 ${fmt(slipped.count)} 人，比在整个「${slipped.to}」里挑有效得多。` })
  }

  // A deadline is the best reason to call.
  for (const g of groups.filter(x => x.kind === 'deadline')) {
    const count = countOf(g)
    if (!count) continue
    add({ id: `deadline:${g.name}`, tone: 'warn', count, group: groupOf(g),
      title: `${fmt(count)} 人「${g.name}」`,
      detail: ruleOf(g.name) ? `规则：${ruleOf(g.name)}。` : '',
      suggest: '有明确的时间点，到期前联系最有理由、也最不打扰。按到期先后排，先联系最快到期的。' })
  }

  // The biggest lapsed pool.
  const pool = rows.filter(r => kinds[r.name] === 'lapsed').sort((a, b) => b.count - a.count)[0]
  if (pool && pool.sharePct >= 25) {
    add({ id: `pool:${pool.name}`, tone: 'warn', count: pool.count, group: { segment: pool.name },
      title: `${pool.sharePct}% 的人在「${pool.name}」（${fmt(pool.count)} 人）`,
      detail: pool.rule ? `「${pool.name}」：${pool.rule}。` : '',
      suggest: '这是最大的一块存量，别全量群发。先挑里面最近还有互动、或者手上的东西还在用的人试一小批，看回应再扩大。' })
  }

  // A tag most people carry that blocks reaching them.
  for (const f of seg.flags) {
    if (flagKinds[f.name] !== 'gap' || f.sharePct < 30 || !f.count) continue
    add({ id: `gap:${f.name}`, tone: 'warn', count: f.count, group: { flag: f.name },
      title: `${f.sharePct}% 的人「${f.name}」`,
      detail: f.rule ? `规则：${f.rule}。` : '',
      suggest: '大部分人现在没法低成本地联系上，后面的跟进都会卡在这一步。每次接触（成交、服务、活动）时顺手补上，比事后补便宜得多。' })
  }

  // Even the widest way to reach people covers less than half of them.
  const reach = seg.flags.filter(f => flagKinds[f.name] === 'reach' && total > 0)
  const wide = [...reach].sort((a, b) => b.sharePct - a.sharePct)[0]
  if (wide && wide.sharePct < 50) {
    add({ id: `reach:${wide.name}`, tone: 'warn', count: total - wide.count, group: { without: [wide.name] },
      title: `联系面最广的「${wide.name}」也只覆盖了 ${wide.sharePct}%，还差 ${fmt(total - wide.count)} 人`,
      detail: reach.length > 1 ? `各个渠道：${reach.map(f => `${f.name} ${f.sharePct}%`).join('、')}。` : '',
      suggest: '在「触达」页看是哪一层、哪几家差得最多，把缺的人按家出成名单去补。' })
  }

  // Fewer new people coming in than growing out of the new segment.
  for (const r of rows.filter(x => kinds[x.name] === 'new')) {
    const net = seg.flows?.net?.[r.name]
    if (net === undefined || net > -Math.max(10, floor)) continue
    const moves = seg.flows.moves
    const out = moves.filter(m => m.from === r.name).reduce((a, m) => a + m.count, 0)
    const came = moves.filter(m => m.to === r.name).reduce((a, m) => a + m.count, 0)
    add({ id: `new:${r.name}`, tone: 'warn', count: r.count, group: { segment: r.name },
      title: `「${r.name}」比 30 天前少了 ${fmt(-net)} 人`,
      detail: `${fmt(out)} 人过了这一层的时间转到别的层，新进来只有 ${fmt(came)} 人。`,
      suggest: '新客户来得少了。先确认最近的数据导全了没有；导全了的话，查一查新客户的来源哪里变少了。' })
  }

  // Deals up or down a lot.
  if (trend && trend.changePct !== null && Math.abs(trend.changePct) >= 20 && Math.max(trend.before, trend.now) >= 10) {
    const up = trend.changePct > 0
    add({ id: `trend:${trend.metric}`, tone: up ? 'good' : 'warn', count: null, group: null,
      title: `近 30 天${trend.name}比前 30 天${up ? '多了' : '少了'} ${Math.abs(trend.changePct)}%`,
      detail: `${fmt(trend.before)} → ${fmt(trend.now)}。`,
      suggest: up ? '看看多出来的是哪一层、哪些人带来的，把做法复制到别的层。' : '先确认最近的数据导全了没有（最后几天常常还没录完）；导全了的话，按分层拆开看是哪些人少了。' })
  }

  // Interested but never bought.
  const never = rows.filter(r => kinds[r.name] === 'never').sort((a, b) => b.count - a.count)[0]
  if (never && never.sharePct >= 10) {
    add({ id: `never:${never.name}`, tone: 'info', count: never.count, group: { segment: never.name },
      title: `${fmt(never.count)} 人（${never.sharePct}%）在「${never.name}」，还没成交过`,
      detail: never.rule ? `「${never.name}」：${never.rule}。` : '',
      suggest: '有过接触、没有成交。挑最近有互动的先跟，问清楚卡在哪一步（价格、时机、选择）。' })
  }

  // The people most worth keeping.
  for (const g of groups.filter(x => x.kind === 'valuable')) {
    const count = countOf(g)
    if (!count) continue
    add({ id: `valuable:${g.name}`, tone: 'good', count, group: groupOf(g),
      title: `${fmt(count)} 位「${g.name}」（${pct(count, total)}%）`,
      detail: ruleOf(g.name) ? `规则：${ruleOf(g.name)}。` : '',
      suggest: '最值得维护的一批。优先请他们参加活动、体验新品，别和普通客户收一样的群发。' })
  }

  items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (b.count ?? 0) - (a.count ?? 0))
  return { kinds: { ...kinds }, flagKinds, items: items.slice(0, 6) }
}
