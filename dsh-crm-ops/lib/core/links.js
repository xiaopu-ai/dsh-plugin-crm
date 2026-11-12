/**
 * How the sheets of a dataset point at each other, found from the values themselves.
 *
 * For every column that could identify something, look its values up in the other sheets'
 * unique columns (codes) and name columns. A cell may pack a code with other things
 * (`C0001:K12 某机构 : 张三`), so the parts of a cell split by a common separator are tried too.
 * The result says which column (or which part of it) finds which other sheet's rows, and how
 * often, without carrying any value: it is the evidence for "交易靠哪一列找到客户" that the
 * configuration chat and the person both read.
 */
import { halfWidth } from './profile.js'
import { describeMapping } from './spec.js'

const SEPARATORS = [' : ', ' ', ':', '/', '|', '，', ',', '-', '_', '#']
const SAMPLE_ROWS = 4000
const MIN_RATE = 0.3
const MIN_DISTINCT = 5
const UNIQUE = 0.98
const SKIP_KINDS = new Set(['date', 'money', 'unitmoney', 'empty', 'url', 'attachment'])
const NAME_HEADER = /(姓名|名字|昵称|联系人|客户名称|^客户$|^name$)/i

const norm = v => halfWidth(String(v ?? '')).trim().toLowerCase()

/** Every k-th row so that at most `max` rows are looked at; deterministic. */
function sample(rows, max) {
  if (rows.length <= max) return rows
  const step = rows.length / max
  return Array.from({ length: max }, (_, i) => rows[Math.floor(i * step)])
}

/** The ways to read a column: the whole cell, and parts of it for separators most cells contain. */
function readings(values) {
  const out = [{ split: null, part: null, values }]
  if (values.length === 0) return out
  for (const sep of SEPARATORS) {
    const having = values.filter(v => v.includes(sep)).length
    if (having / values.length < 0.5) continue
    for (const part of [1, -1, 2]) {
      const parts = values.map(v => {
        const ps = v.split(sep).map(s => s.trim()).filter(Boolean)
        const i = part > 0 ? part - 1 : ps.length + part
        return ps[i] ?? ''
      })
      // Part 2 is part -1 when every cell has two parts; keep -1, which survives an extra part in front.
      if (out.some(r => r.values.every((v, i) => v === parts[i]))) continue
      out.push({ split: sep, part, values: parts })
    }
  }
  return out
}

/**
 * Share of matches to expect by chance when both sides are integers and the target's codes
 * fill most of their range (row ids of one system: 1…20000 and 1…60000 overlap anyway).
 */
function byChance(values, target) {
  if (!target.numeric) return 0
  const nums = values.filter(v => /^\d{1,15}$/.test(v)).map(Number)
  if (nums.length < values.length * 0.9) return 0
  const inRange = nums.filter(n => n >= target.lo && n <= target.hi).length / values.length
  return target.density * inRange
}

/**
 * @param {{ source: string, sourceName: string, sheetName: string, columns: { name: string, kind: string }[], rows: string[][] }[]} sheets
 *   usable sheets with their kept data rows (cells aligned to columns).
 * @returns {{ from: object, to: object, kind: 'key'|'name', rate: number, matched: number, checked: number, uniqueRate?: number, chance?: number, mapping: string|object, plain: string }[]}
 */
export function findLinks(sheets) {
  // Targets: columns whose values are unique within their sheet (codes), and name columns.
  const targets = []
  sheets.forEach((s, si) => {
    s.columns.forEach((c, ci) => {
      if (SKIP_KINDS.has(c.kind)) return
      const counts = new Map()
      for (const r of s.rows) { const v = norm(r[ci]); if (v !== '') counts.set(v, (counts.get(v) ?? 0) + 1) }
      const filled = [...counts.values()].reduce((a, n) => a + n, 0)
      if (counts.size < MIN_DISTINCT || filled === 0) return
      const unique = counts.size / filled >= UNIQUE
      const name = c.kind === 'name' || NAME_HEADER.test(c.name)
      if (!unique && !name) return
      // A name stays weak evidence even when no two people share one in this sheet.
      const t = { si, ci, column: c.name, counts, kind: name ? 'name' : 'key', numeric: false }
      const keys = [...counts.keys()]
      if (keys.every(v => /^\d{1,15}$/.test(v))) {
        const nums = keys.map(Number)
        t.lo = Math.min(...nums)
        t.hi = Math.max(...nums)
        t.numeric = true
        t.density = Math.min(1, counts.size / (t.hi - t.lo + 1))
      }
      targets.push(t)
    })
  })

  const found = []
  sheets.forEach((s, si) => {
    const rows = sample(s.rows, SAMPLE_ROWS)
    s.columns.forEach((c, ci) => {
      if (SKIP_KINDS.has(c.kind)) return
      const values = rows.map(r => norm(r[ci])).filter(v => v !== '')
      if (new Set(values).size < MIN_DISTINCT) return
      const ways = readings(values)
      const nameLike = c.kind === 'name' || NAME_HEADER.test(c.name)
      const best = new Map()
      for (const t of targets) {
        if (t.si === si) continue
        for (const w of ways) {
          // A whole column matches names only when it is itself a name column; a part of a packed
          // cell may be a name whatever the header says.
          if (t.kind === 'name' && w.split === null && !nameLike) continue
          let matched = 0
          let uniq = 0
          let checked = 0
          const hit = new Set()
          const seen = new Set()
          for (const v of w.values) {
            if (v === '') continue
            checked++
            seen.add(v)
            const n = t.counts.get(v)
            if (n) { matched++; hit.add(v); if (n === 1) uniq++ }
          }
          if (checked === 0) continue
          const rate = matched / checked
          // A handful of repeated values (product lines, years) matching is no evidence.
          if (rate < MIN_RATE || hit.size < Math.min(20, Math.ceil(seen.size * 0.5))) continue
          const chance = byChance(w.values.filter(v => v !== ''), t)
          if (rate - chance < 0.1) continue
          const score = t.kind === 'name' ? uniq / checked : rate
          const key = `${t.si}:${t.ci}`
          const prev = best.get(key)
          if (!prev || score > prev.score || (score === prev.score && w.split === null)) best.set(key, { t, w, rate, score, matched, checked, chance, uniqueRate: uniq / checked })
        }
      }
      // The best code target and the best name target per column are enough.
      const pick = kind => [...best.values()].filter(b => b.t.kind === kind).sort((x, y) => y.score - x.score)[0]
      for (const b of [pick('key'), pick('name')].filter(Boolean)) {
        const target = sheets[b.t.si]
        const mapping = b.w.split === null ? c.name : { column: c.name, split: b.w.split, part: b.w.part }
        const pct = x => Math.round(x * 1000) / 10
        found.push({
          from: { source: s.source, sourceName: s.sourceName, sheet: s.sheetName, column: c.name, ...(b.w.split === null ? {} : { split: b.w.split, part: b.w.part }) },
          to: { source: target.source, sourceName: target.sourceName, sheet: target.sheetName, column: b.t.column },
          kind: b.t.kind,
          rate: Math.round(b.rate * 1000) / 1000,
          matched: b.matched,
          checked: b.checked,
          ...(b.t.kind === 'name' ? { uniqueRate: Math.round(b.uniqueRate * 1000) / 1000 } : {}),
          ...(b.chance >= 0.05 ? { chance: Math.round(b.chance * 1000) / 1000 } : {}),
          mapping,
          plain: `「${s.sheetName}」的${describeMapping(mapping)} → 「${target.sheetName}」的「${b.t.column}」：${b.checked < s.rows.length ? `抽查 ${b.checked} 行，` : ''}${pct(b.rate)}% 对得上${b.t.kind === 'name' ? `（按姓名，其中 ${pct(b.uniqueRate)}% 只对上一个人）` : ''}${b.chance >= 0.05 ? `（两边都是连续数字编号，碰巧对上的也有约 ${pct(b.chance)}%）` : ''}`,
        })
      }
    })
  })
  // Codes before names; names by how many find exactly one person.
  const rank = l => (l.kind === 'key' ? 2 + l.rate : l.uniqueRate)
  return found.sort((a, b) => rank(b) - rank(a)).slice(0, 24)
}
