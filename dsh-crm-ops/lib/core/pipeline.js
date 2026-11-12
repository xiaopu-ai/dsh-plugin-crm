/**
 * 清洗、关联、合并、对账: turn the sheets a configuration binds into one set
 * of customers, transactions, assets, touches, campaigns and owners.
 *
 * 1. Rows. A snapshot table reads only its newest sheet; an append table reads
 *    every sheet in import order. Each data row lands in exactly one place:
 *    loaded, skipped (blank, total, repeated header), excluded (a row filter of
 *    the configuration left it out), failed (a key value would not parse) or
 *    duplicate (an order number or fingerprint seen before).
 * 2. Clean. Every mapped cell goes through `cleanValue`; category values go
 *    through the dictionary, and values outside it wait for the person.
 * 3. Merge. Customer records join by the configuration's identity rules:
 *    strong keys merge (a phone shared by several names is only a weak key),
 *    weak keys only make review items; unconfirmed pairs stay apart. The
 *    person's merge and split decisions are keyed by a hash of both sides'
 *    key values, so they survive re-imports.
 * 4. Link. Transactions, assets and touches attach to one customer by the
 *    same rules; rows that match nobody, or several people, stay unlinked
 *    and are counted.
 * 5. Reconcile. Row and money conservation per sheet, parse rate per column,
 *    link rate per entity.
 *
 * Deterministic: the same sheets, configuration, cutoff and decisions always
 * give the same result.
 */
import { createHash } from 'node:crypto'
import { cleanValue, dayOf, dictionaryIndex, normName } from './clean.js'
import { parseMoney, skipReason } from './profile.js'
import { CONSENT, DICT_TYPES, ENTITIES, REFS, columnOf, describeSkip, pickPart, skipMatch } from './spec.js'

const sha = s => createHash('sha1').update(s).digest('hex')
const KEY_REF = Object.freeze({ 'customer.id': 'customerId', 'customer.phone': 'customerPhone', 'customer.idcard': 'customerIdcard', 'customer.wechat': 'customerWechat', 'customer.name': 'customerName', 'asset.serial': 'assetSerial', 'asset.id': 'assetId' })
const REF_FIELD = Object.freeze({ customerId: 'id', customerName: 'name', customerPhone: 'phone', customerIdcard: 'idcard', customerWechat: 'wechat' })
const STRONG_CUSTOMER = ['id', 'phone', 'idcard', 'wechat']
const KEY_LABEL = Object.freeze({ 'customer.id': '编号', 'customer.phone': '手机号', 'customer.idcard': '证件号', 'customer.wechat': '企微 ID', 'customer.name': '姓名', 'customer.city': '城市', 'customer.birthday': '生日', 'asset.serial': '识别号', 'asset.id': '持有物编号' })
/** Fraction of a mapped column that must parse before the person has to look. */
export const PARSE_RATE_MIN = 0.95
/** Fraction of transactions that should find their customer. */
export const LINK_RATE_MIN = 0.9
/**
 * Below this share of rows finding their customer, a table of transactions, holdings or touches is not
 * "ok": the person looks before going on. Leads are exempt (a lead needs no customer).
 */
export const LINK_GATE_MIN = 0.5
const LINK_GATE_ROWS = 10
const GATED = ['transaction', 'asset', 'touch']
const MAX_PAIRS_PER_GROUP = 20
const SAMPLES = 12

/** Pair key of two records, independent of order. */
export const pairKey = (a, b) => sha([a, b].sort().join('|'))

/** Field definitions of an entity, references included. */
const fieldDef = (entity, field) => ENTITIES[entity].fields[field] ?? REFS[field]

/**
 * Run the whole pipeline.
 * @param {{
 *   spec: object,
 *   tables: { table: object, sheets: { source: string, sheet: number, sourceName: string, sheetName: string, importedAt: string, profile: object, rows: string[][] }[] }[],
 *   asOf: string,
 *   decisions?: { pairs?: object, links?: object },
 *   previous?: Map<string, { status: string|null, tid: string }>,
 * }} input
 */
export function runPipeline({ spec, tables, asOf, decisions = {}, previous = new Map() }) {
  const pairs = decisions.pairs ?? {}
  const linkDecisions = decisions.links ?? {}
  const dicts = new Map(Object.entries(spec.dictionaries ?? {}).map(([k, d]) => [k, dictionaryIndex(d)]))
  const pending = new Map()
  const issues = []
  const changes = []
  const reconTables = []
  const rows = { customer: [], transaction: [], asset: [], touch: [], lead: [], campaign: [], owner: [] }
  const records = []
  // Key values of customer rows a row filter left out: a delivery that points at one of them finds nobody,
  // and says that this is why.
  const excludedKeys = new Map(STRONG_CUSTOMER.map(k => [`customer.${k}`, new Set()]))

  tables.forEach((bound, tableIndex) => {
    const t = bound.table
    const sorted = [...bound.sheets].sort((a, b) => (a.importedAt ?? '').localeCompare(b.importedAt ?? ''))
    const use = t.mode === 'snapshot' ? sorted.slice(-1) : sorted
    const superseded = t.mode === 'snapshot' ? sorted.slice(0, -1) : []
    const seen = new Map()
    const seenFp = new Map()
    const recon = { table: t.name, mode: t.mode, entities: Object.keys(t.entities), sheets: [], superseded: superseded.map(s => ({ source: s.source, sourceName: s.sourceName, sheetName: s.sheetName })), columns: [] }
    reconTables.push(recon)
    const colStats = new Map()
    use.forEach((sh, useIndex) => {
      const profile = sh.profile
      const colIndex = new Map(profile.columns.map(c => [c.name, c.index]))
      const header = profile.columns.map(c => c.header)
      const headerIdx = profile.header.row - 1
      const amountCol = t.entities.transaction?.amount ? colIndex.get(columnOf(t.entities.transaction.amount).column) : undefined
      const r = { source: sh.source, sourceName: sh.sourceName, sheetName: sh.sheetName, rows: { total: profile.rows.total, loaded: 0, skipped: 0, excluded: 0, failed: 0, duplicate: 0, skippedBy: {}, excludedBy: {}, failedBy: {} }, money: null }
      const money = amountCol === undefined ? null : { column: profile.columns[amountCol].name, profileSum: profile.columns[amountCol].sumCents ?? sumColumn(sh.rows, headerIdx, header, amountCol), skippedSum: 0, failedSum: 0, loaded: 0, skipped: 0, excluded: 0, duplicate: 0, unparsed: [] }
      // Row filters of the configuration: the first one that matches names why the row is left out.
      const filters = (t.skipRows ?? []).map(f => ({ f, idx: colIndex.get(f.column), label: describeSkip(f) })).filter(x => x.idx !== undefined)
      for (let i = headerIdx + 1; i < sh.rows.length; i++) {
        const cells = Array.from({ length: header.length }, (_, c) => sh.rows[i][c] ?? '')
        const rowNo = i + 1
        const amountCents = amountCol === undefined ? null : parseMoney(cells[amountCol])
        const why = skipReason(cells, header)
        if (why) {
          r.rows.skipped++
          r.rows.skippedBy[why] = (r.rows.skippedBy[why] ?? 0) + 1
          if (money && amountCents !== null) { money.skipped += amountCents; money.skippedSum += amountCents }
          continue
        }
        const left = filters.find(x => skipMatch(x.f, cells[x.idx]))
        if (left) {
          r.rows.excluded++
          r.rows.excludedBy[left.label] = (r.rows.excludedBy[left.label] ?? 0) + 1
          if (money && amountCents !== null) money.excluded += amountCents
          for (const k of t.entities.customer ? STRONG_CUSTOMER : []) {
            const col = columnOf(t.entities.customer[k])
            const idx = col ? colIndex.get(col.column) : undefined
            if (idx === undefined) continue
            const res = cleanValue(ENTITIES.customer.fields[k].type, pickPart(cells[idx], col))
            if (res.ok && !res.empty) excludedKeys.get(`customer.${k}`).add(res.value)
          }
          continue
        }
        const origin = { table: t.name, source: sh.source, sourceName: sh.sourceName, sheet: sh.sheet, sheetName: sh.sheetName, row: rowNo }
        const cleaned = {}
        const fails = []
        for (const [entity, fields] of Object.entries(t.entities)) {
          const out = { fields: {}, raw: {}, extra: {} }
          for (const [field, mapping] of Object.entries(fields)) {
            const col = columnOf(mapping)
            const idx = colIndex.get(col.column)
            const raw = idx === undefined ? '' : pickPart(cells[idx], col)
            const def = fieldDef(entity, field)
            const res = cleanValue(def.type, raw, { as: col.as, dict: def.type === 'category' ? dicts.get(`${entity}.${field}`) : undefined })
            out.fields[field] = res
            out.raw[col.column] = idx === undefined ? '' : cells[idx]
            stat(colStats, col.column, `${entity}.${field}`, def.type, res, raw, dicts.has(`${entity}.${field}`))
            if (res.unknown) bump(pending, `${entity}.${field}`, res.unknown)
          }
          for (const x of t.extra.filter(e => e.entity === entity)) {
            const idx = colIndex.get(x.column)
            const raw = idx === undefined ? '' : pickPart(cells[idx], columnOf(x))
            const dictKey = `${entity}.extra.${x.key}`
            const res = cleanValue(x.type, raw, { dict: DICT_TYPES.includes(x.type) ? dicts.get(dictKey) : undefined, list: true, sep: x.sep })
            out.extra[x.key] = res
            out.raw[x.column] = idx === undefined ? '' : cells[idx]
            stat(colStats, x.column, dictKey, x.type, res, raw, dicts.has(dictKey))
            for (const u of res.unknowns ?? (res.unknown ? [res.unknown] : [])) bump(pending, dictKey, u)
          }
          cleaned[entity] = out
          const why = failure(entity, out, t)
          if (why) fails.push(why)
        }
        if (fails.length > 0) {
          r.rows.failed++
          for (const f of fails) r.rows.failedBy[f] = (r.rows.failedBy[f] ?? 0) + 1
          if (money) {
            if (amountCents !== null) money.failedSum += amountCents
            else if (money.unparsed.length < SAMPLES) money.unparsed.push({ row: rowNo, raw: cells[amountCol] })
          }
          issues.push({ kind: 'failed', table: t.name, source: sh.source, sheet: sh.sheetName, row: rowNo, reason: fails.join('；') })
          continue
        }
        // Duplicates. Across imports of an append table: the same order number (or, without one, the same
        // fingerprint). Within one import: the same fingerprint, when the measures count same-day repeats once.
        const event = cleaned.transaction ?? cleaned.touch
        let key = null
        if (event) {
          key = eventKey(t, cleaned)
          const fp = fingerprintKey(t, cleaned)
          const earlier = key ? seen.get(key.value) : undefined
          const twin = fp ? seenFp.get(fp) : undefined
          const before = earlier && earlier.useIndex < useIndex ? earlier : twin && twin.useIndex === useIndex && spec.measures.sameDayDuplicates === 'one' ? twin : twin && twin.useIndex < useIndex && key?.kind !== 'order' ? twin : null
          if (before) {
            r.rows.duplicate++
            if (money && amountCents !== null) money.duplicate += amountCents
            const newStatus = cleaned.transaction?.fields.status?.value ?? null
            if (cleaned.transaction && newStatus !== null && before.row.status !== newStatus) {
              changes.push({ key: before.row.key, tid: before.row.tid, field: 'status', old: before.row.status, new: newStatus, origin })
              before.row.status = newStatus
            }
            continue
          }
          if (fp) seenFp.set(fp, { useIndex, row: null })
        }
        r.rows.loaded++
        if (money && amountCents !== null) money.loaded += amountCents
        const rid = `${tableIndex}:${sh.source}:${rowNo}`
        const made = emit(rows, records, t, cleaned, origin, rid, key, { importedAt: sh.importedAt ?? '', tableIndex })
        if (event) {
          if (key && !seen.has(key.value)) seen.set(key.value, { useIndex, row: made })
          const fp = fingerprintKey(t, cleaned)
          if (fp) seenFp.set(fp, { useIndex, row: made })
        }
      }
      if (money) {
        // Every parseable amount must be accounted for: what the profiler summed over the kept rows plus the
        // skipped rows, less the failed rows, equals what was loaded, skipped, excluded and marked duplicate.
        money.parsedTotal = money.profileSum + money.skippedSum
        money.ok = money.parsedTotal - money.failedSum === money.loaded + money.skipped + money.excluded + money.duplicate
        r.money = money
      }
      r.rowsOk = r.rows.total === r.rows.loaded + r.rows.skipped + r.rows.excluded + r.rows.failed + r.rows.duplicate
      recon.sheets.push(r)
    })
    recon.columns = [...colStats.values()].map(c => ({ ...c, rate: c.checked ? (c.filled === 0 ? 1 : c.parsed / c.filled) : null }))
  })

  // One lead per lead number, across tables (an event sign-up sheet that repeats some leads of the full
  // export) and across imports: the newest import says where the lead stands now.
  const leadsBefore = rows.lead.length
  rows.lead = mergeLeads(rows.lead)

  // One 归属方 per code, whatever each table calls it; then every owner value elsewhere reads as its one name.
  const directory = mergeOwners(rows.owner)
  rows.owner = directory.owners
  for (const r of records) r.fields.owner = directory.resolve(r.fields.owner)
  for (const list of [rows.transaction, rows.asset, rows.lead]) for (const x of list) x.owner = directory.resolve(x.owner)
  const ownerUse = ownersApart({ customers: records.map(r => ({ owner: r.fields.owner })), transactions: rows.transaction, assets: rows.asset, leads: rows.lead })

  // Compare with the previous data version by order number or fingerprint (snapshot tables
  // lose the old file's rows; append tables already noted changes between their own files).
  const noted = new Set(changes.map(c => `${c.key}|${c.field}`))
  for (const tx of rows.transaction) {
    if (noted.has(`${tx.key}|status`)) continue
    const before = tx.key ? previous.get(tx.key) : undefined
    if (before && before.status !== tx.status && tx.status !== null && before.status !== undefined) changes.push({ key: tx.key, tid: tx.tid, field: 'status', old: before.status, new: tx.status, origin: tx.origin, fromVersion: true })
  }

  // ---- merge ----
  const shared = sharedPhones(records)
  const uf = unionFind(records.length)
  const bySide = new Map()
  records.forEach((r, i) => { if (!bySide.has(r.sideKey)) bySide.set(r.sideKey, []); bySide.get(r.sideKey).push(i) })
  for (const d of Object.values(pairs)) {
    if (d.decision !== 'split') continue
    for (const a of bySide.get(d.a) ?? []) for (const b of bySide.get(d.b) ?? []) uf.forbid(a, b)
  }
  const review = []
  const reviewSeen = new Set()
  const keyValue = (r, k) => (k.startsWith('asset.') ? (k === 'asset.serial' ? r.serials : r.assetIds) : [r.keys[k] ?? null].filter(Boolean))
  const tuples = (r, keys) => {
    let out = [[]]
    for (const k of keys) {
      const vs = keyValue(r, k)
      if (vs.length === 0) return []
      out = out.flatMap(prefix => vs.map(v => [...prefix, v]))
    }
    return out.map(t => t.join('\u0001'))
  }
  const groupsOf = rule => {
    const g = new Map()
    records.forEach((r, i) => { for (const tup of tuples(r, rule.keys)) { if (!g.has(tup)) g.set(tup, []); g.get(tup).push(i) } })
    return g
  }
  const downgraded = (rule, tuple) => rule.unless === 'shared' && rule.keys.includes('customer.phone') && shared.has(tuple.split('\u0001')[rule.keys.indexOf('customer.phone')])
  const strongRules = spec.identity.filter(r => r.strength === 'strong')
  // Pass 1: strong keys merge.
  for (const rule of strongRules) {
    for (const [tuple, members] of groupsOf(rule)) {
      if (members.length < 2 || downgraded(rule, tuple)) continue
      for (const m of members.slice(1)) uf.union(members[0], m)
      const named = new Map()
      for (const m of members) if (records[m].name && !named.has(records[m].name)) named.set(records[m].name, m)
      if (named.size > 1) {
        const [first, ...rest] = [...named.values()]
        for (const other of rest.slice(0, MAX_PAIRS_PER_GROUP)) {
          const a = records[first]
          const b = records[other]
          const id = pairKey(a.sideKey, b.sideKey)
          if (reviewSeen.has(id)) continue
          reviewSeen.add(id)
          review.push({ id, kind: 'merge', reason: `${rule.keys.map(k => KEY_LABEL[k]).join('和')}相同、姓名不同`, rule: rule.keys, default: 'merged', decision: pairs[id]?.decision ?? null, a: a.sideKey, b: b.sideKey, ra: first, rb: other })
        }
      }
    }
  }
  // Pass 2: weak keys, and phones shared by several names, only suggest.
  for (const rule of spec.identity) {
    for (const [tuple, members] of groupsOf(rule)) {
      if (members.length < 2) continue
      if (rule.strength === 'strong' && !downgraded(rule, tuple)) continue
      const reps = new Map()
      for (const m of members) { const root = uf.find(m); if (!reps.has(root)) reps.set(root, m) }
      if (reps.size < 2) continue
      const list = [...reps.values()]
      let made = 0
      for (let x = 0; x < list.length && made < MAX_PAIRS_PER_GROUP; x++) {
        for (let y = x + 1; y < list.length && made < MAX_PAIRS_PER_GROUP; y++) {
          const a = records[list[x]]
          const b = records[list[y]]
          if (uf.find(list[x]) === uf.find(list[y])) continue
          if (conflicting(records, uf, list[x], list[y])) continue
          const id = pairKey(a.sideKey, b.sideKey)
          if (reviewSeen.has(id)) continue
          reviewSeen.add(id)
          made++
          const decision = pairs[id]?.decision ?? null
          if (decision === 'merge') uf.union(list[x], list[y])
          const sameName = a.name && a.name === b.name
          const reason = rule.strength === 'strong'
            ? (sameName ? '手机号和姓名都一样（这个号码有好几个人用）' : a.name && b.name ? '手机号相同、姓名不同（这个号码有好几个人用）' : '手机号相同（这个号码有好几个人用）')
            : `${rule.keys.map(k => KEY_LABEL[k]).join('和')}都一样`
          review.push({ id, kind: 'merge', reason, rule: rule.keys, default: 'separate', decision, a: a.sideKey, b: b.sideKey, ra: list[x], rb: list[y] })
        }
      }
    }
  }

  // ---- customers ----
  const dateExtras = new Set(spec.tables.flatMap(t => (t.extra ?? []).filter(x => x.entity === 'customer' && x.type === 'date').map(x => x.key)))
  const clusters = new Map()
  records.forEach((r, i) => { const root = uf.find(i); if (!clusters.has(root)) clusters.set(root, []); clusters.get(root).push(i) })
  const customers = []
  const cidOfRoot = new Map()
  const usedCids = new Set()
  // Records alike in every key (a name and nothing else) may stay apart: their ids then also depend on where they came from.
  const rowOf = r => `${r.origin.source}|${r.origin.sheet}|${r.origin.row}`
  for (const [root, members] of clusters) {
    const recs = members.map(i => records[i])
    const side = [...recs.map(r => r.sideKey)].sort()[0]
    let cid = `c${sha(side).slice(0, 10)}`
    for (let n = 0; usedCids.has(cid); n++) cid = `c${sha(`${side}|${recs.map(rowOf).sort()[0]}|${n}`).slice(0, 10)}`
    usedCids.add(cid)
    cidOfRoot.set(root, cid)
    const fields = {}
    for (const f of Object.keys(ENTITIES.customer.fields)) fields[f] = recs.map(r => r.fields[f]).find(v => v !== null && v !== undefined) ?? null
    // Consent is the strictest any record of the person carries: a withdrawal or a refusal on one sheet stands.
    const consents = new Set(recs.map(r => r.fields.consent))
    fields.consent = [CONSENT.withdrawn, CONSENT.denied, CONSENT.granted].find(v => consents.has(v)) ?? null
    const extra = {}
    for (const r of recs) {
      for (const [k, v] of Object.entries(r.extra)) {
        if (v === null) continue
        // A multi-value field of one person is everything any of their records lists.
        if (Array.isArray(v)) { extra[k] = [...new Set([...(Array.isArray(extra[k]) ? extra[k] : []), ...v])]; continue }
        // Records of one person may each carry a date: the latest stands, as with a listed cell.
        if (extra[k] === undefined || (dateExtras.has(k) && dayOf(v) > dayOf(extra[k]))) extra[k] = v
      }
    }
    customers.push({ cid, ...fields, extra, names: [...new Set(recs.map(r => r.name).filter(Boolean))], sideKeys: [...new Set(recs.map(r => r.sideKey))], records: recs.map(r => r.origin) })
  }
  customers.sort((a, b) => a.cid.localeCompare(b.cid))
  const cidOf = i => cidOfRoot.get(uf.find(i))
  const looseCustomers = keylessTables(records, uf)
  for (const item of review) {
    item.a = { sideKey: item.a, ...describeRecord(records[item.ra]), cid: cidOf(item.ra) }
    item.b = { sideKey: item.b, ...describeRecord(records[item.rb]), cid: cidOf(item.rb) }
    delete item.ra
    delete item.rb
  }

  // ---- link ----
  const index = new Map()
  const addIndex = (k, v, cid) => { if (!v) return; if (!index.has(k)) index.set(k, new Map()); const m = index.get(k); if (!m.has(v)) m.set(v, new Set()); m.get(v).add(cid) }
  records.forEach((r, i) => {
    const cid = cidOf(i)
    for (const k of ['customer.id', 'customer.phone', 'customer.idcard', 'customer.wechat', 'customer.name', 'customer.city', 'customer.birthday']) addIndex(k, r.keys[k], cid)
  })
  const namesOf = new Map(customers.map(c => [c.cid, new Set(c.names)]))
  const linkStats = {}
  const linkOne = (entity, row) => {
    const s = (linkStats[entity] ??= { total: 0, linked: 0, byMethod: {}, unlinkedBy: {}, samples: [], byTable: {} })
    s.total++
    const bt = (s.byTable[row.origin.table] ??= { total: 0, linked: 0, unlinkedBy: {} })
    bt.total++
    let result
    if (row.record !== undefined) result = { cid: cidOf(row.record), method: 'same-row' }
    else result = linkRefs(spec, index, shared, row.refs)
    if (result.unlinked === 'no-match' && Object.entries(KEY_REF).some(([k, ref]) => row.refs?.[ref] && excludedKeys.get(k)?.has(row.refs[ref]))) result = { unlinked: 'excluded' }
    if (result.cid && row.refs?.customerName && result.method === 'strong' && !namesOf.get(result.cid)?.has(row.refs.customerName)) {
      const id = sha(`link|${row.linkKey}`)
      const decision = linkDecisions[id]?.decision ?? null
      review.push({ id, kind: 'link', reason: '编号对上了，但姓名不一样', entity, default: 'linked', decision, row: row.origin, name: row.refs.customerName, cid: result.cid, names: [...(namesOf.get(result.cid) ?? [])] })
      if (decision === 'unlink') result = { unlinked: 'person-split' }
    }
    if (result.cid) {
      s.linked++
      bt.linked++
      s.byMethod[result.method] = (s.byMethod[result.method] ?? 0) + 1
      row.cid = result.cid
      row.link = result.method
    } else {
      s.unlinkedBy[result.unlinked] = (s.unlinkedBy[result.unlinked] ?? 0) + 1
      bt.unlinkedBy[result.unlinked] = (bt.unlinkedBy[result.unlinked] ?? 0) + 1
      if (s.samples.length < SAMPLES) s.samples.push({ origin: row.origin, reason: result.unlinked, refs: Object.fromEntries(Object.entries(row.refs ?? {}).filter(([, v]) => v)) })
      row.cid = null
      row.link = `unlinked:${result.unlinked}`
    }
  }
  for (const a of rows.asset) linkOne('asset', a)
  for (const a of rows.asset) if (a.cid) { addIndex('asset.serial', a.serialOk ? a.serial : null, a.cid); addIndex('asset.id', a.extId, a.cid) }
  for (const x of rows.transaction) linkOne('transaction', x)
  for (const x of rows.touch) linkOne('touch', x)
  // A lead that finds nobody still counts in its own funnel; its link rate is shown, never a gate.
  for (const x of rows.lead) linkOne('lead', x)
  for (const x of rows.transaction) if (x.assetRef) x.asset = rows.asset.find(a => (a.serialOk && a.serial === x.assetRef) || a.extId === x.assetRef)?.aid ?? null
  for (const s of Object.values(linkStats)) s.rate = s.total === 0 ? 1 : s.linked / s.total

  // ---- measures ----
  const m = spec.measures
  for (const x of rows.transaction) {
    x.refund = m.refundTypes.includes(x.type) || (x.amount ?? 0) < 0
    if (x.refund && m.refundTypes.includes(x.type) && x.amount > 0) x.amount = -x.amount
    x.stale = false
    // A table without an amount column still counts its rows (as count-only transactions).
    let counted = x.date !== null && (x.amount !== null || x.priced === false) && x.date <= asOf
    if (counted && x.status && m.excludeStatuses.includes(x.status)) counted = false
    if (counted && x.status && m.openStatuses.includes(x.status)) {
      x.stale = true
      if (m.staleStatus !== 'ended') counted = false
    }
    if (counted && x.refund && m.refunds === 'exclude') counted = false
    x.counted = counted
  }

  // ---- campaigns and owners named only by reference ----
  const campaignNames = new Set(rows.campaign.map(c => c.name))
  for (const x of rows.touch) if (x.campaign && !campaignNames.has(x.campaign)) { campaignNames.add(x.campaign); rows.campaign.push({ name: x.campaign, type: null, start: null, end: null, budget: null, channel: null, implicit: true }) }

  // ---- reconciliation summary ----
  const parseProblems = []
  for (const rt of reconTables) for (const c of rt.columns) if (c.rate !== null && c.rate < PARSE_RATE_MIN && c.filled > 0) parseProblems.push({ table: rt.table, column: c.column, rate: c.rate, samples: c.bad })
  const rowsOk = reconTables.every(rt => rt.sheets.every(s => s.rowsOk))
  const moneyOk = reconTables.every(rt => rt.sheets.every(s => !s.money || s.money.ok))
  const txLink = linkStats.transaction ?? { total: 0, linked: 0, rate: 1 }
  // A table that lost most of its rows (a mapped column empty, a date nobody can read) is never "ok".
  const lostRows = []
  for (const rt of reconTables) {
    const total = rt.sheets.reduce((a, s) => a + s.rows.total, 0)
    const failed = rt.sheets.reduce((a, s) => a + s.rows.failed, 0)
    if (failed < 10 || failed < total * 0.5) continue
    const why = new Map()
    for (const s of rt.sheets) for (const [r, n] of Object.entries(s.rows.failedBy)) why.set(r, (why.get(r) ?? 0) + n)
    lostRows.push({ table: rt.table, total, failed, reason: [...why].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null })
  }
  // A row filter that leaves almost nothing: more likely a condition written the wrong way round than a wish.
  const overFiltered = []
  for (const rt of reconTables) {
    const total = rt.sheets.reduce((a, s) => a + s.rows.total - s.rows.skipped, 0)
    const excluded = rt.sheets.reduce((a, s) => a + s.rows.excluded, 0)
    if (excluded < 10 || excluded < total * 0.9) continue
    const why = new Map()
    for (const s of rt.sheets) for (const [r, n] of Object.entries(s.rows.excludedBy)) why.set(r, (why.get(r) ?? 0) + n)
    overFiltered.push({ table: rt.table, total, excluded, by: [...why].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null })
  }
  // A table whose rows mostly found nobody: the numbers built on it (who was touched, who bought) are empty.
  const weakLinks = []
  for (const entity of GATED) {
    for (const [table, x] of Object.entries(linkStats[entity]?.byTable ?? {})) {
      if (x.total < LINK_GATE_ROWS || x.linked / x.total >= LINK_GATE_MIN) continue
      weakLinks.push({ table, entity, total: x.total, linked: x.linked, rate: x.linked / x.total, unlinkedBy: x.unlinkedBy, why: whyUnlinked(spec, table, entity, x.unlinkedBy) })
    }
  }
  const gate = !rowsOk || !moneyOk ? 'error' : parseProblems.length > 0 || lostRows.length > 0 || looseCustomers.length > 0 || weakLinks.length > 0 || overFiltered.length > 0 ? 'ack' : 'ok'
  const reviewOpen = review.filter(i => i.decision === null).length
  return {
    customers,
    transactions: rows.transaction,
    assets: rows.asset,
    touches: rows.touch,
    leads: rows.lead,
    campaigns: rows.campaign,
    owners: rows.owner,
    review,
    pending: [...pending].map(([key, values]) => ({ key, values: [...values].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) })),
    issues,
    changes,
    recon: {
      tables: reconTables,
      link: linkStats,
      rowsOk,
      moneyOk,
      parseProblems,
      linkWarning: txLink.total > 0 && txLink.rate < LINK_RATE_MIN,
      looseCustomers,
      lostRows,
      overFiltered,
      weakLinks,
      owners: { count: directory.owners.length, ...ownerUse },
      gate,
      counts: { records: records.length, customers: customers.length, merged: records.length - customers.length, transactions: rows.transaction.length, assets: rows.asset.length, touches: rows.touch.length, leads: rows.lead.length, leadsMerged: leadsBefore - rows.lead.length, campaigns: rows.campaign.length, owners: rows.owner.length, review: review.length, reviewOpen, staleStatuses: rows.transaction.filter(x => x.stale).length, changes: changes.length, excluded: reconTables.reduce((a, rt) => a + rt.sheets.reduce((b, s) => b + s.rows.excluded, 0), 0) },
    },
  }
}

/**
 * Tables that feed customers with nothing but a name (no code, phone, ID or serial): rows alike in
 * every key stay separate customers, so one person with many rows (opportunities, follow-ups)
 * becomes many customers. Reported when it is more than a handful.
 */
function keylessTables(records, uf) {
  const roots = new Map()
  records.forEach((r, i) => { if (!roots.has(r.sideKey)) roots.set(r.sideKey, new Set()); roots.get(r.sideKey).add(uf.find(i)) })
  const by = new Map()
  for (const r of records) {
    if (r.created) continue
    const x = by.get(r.origin.table) ?? { table: r.origin.table, records: 0, keyless: 0, repeated: 0 }
    by.set(r.origin.table, x)
    x.records++
    if (STRONG_CUSTOMER.some(k => r.keys[`customer.${k}`]) || r.serials.length > 0 || r.assetIds.length > 0) continue
    x.keyless++
    if (roots.get(r.sideKey).size > 1) x.repeated++
  }
  return [...by.values()].filter(x => x.repeated >= 20 && x.repeated >= x.records * 0.05)
}

function sumColumn(rows, headerIdx, header, col) {
  let sum = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = Array.from({ length: header.length }, (_, c) => rows[i][c] ?? '')
    if (skipReason(cells, header)) continue
    const v = parseMoney(cells[col])
    if (v !== null) sum += v
  }
  return sum
}

function bump(map, key, value) {
  if (!map.has(key)) map.set(key, new Map())
  const m = map.get(key)
  m.set(value, (m.get(value) ?? 0) + 1)
}

function stat(stats, column, field, type, res, raw, hasDict) {
  if (!stats.has(column)) stats.set(column, { column, field, type, filled: 0, parsed: 0, checked: !['name', 'text'].includes(type) && !(DICT_TYPES.includes(type) && !hasDict), bad: [] })
  const s = stats.get(column)
  if (res.empty) return
  s.filled++
  if (res.ok || res.unknown) s.parsed++
  else if (s.bad.length < SAMPLES) s.bad.push({ raw, reason: res.reason })
}

/** Why a row cannot be used for one entity, or null. */
function failure(entity, out, table) {
  const f = out.fields
  const v = k => f[k] && f[k].ok && !f[k].empty
  if (entity === 'transaction') {
    if (!v('date')) return f.date?.empty ? '交易没有日期' : `交易日期${f.date?.reason ?? '认不出'}`
    if (table.entities.transaction?.amount && !v('amount')) return f.amount?.empty ? '交易没有金额' : `交易金额${f.amount?.reason ?? '认不出'}`
  }
  if (entity === 'touch' && !v('date')) return f.date?.empty ? '互动没有日期' : `互动日期${f.date?.reason ?? '认不出'}`
  if (entity === 'lead' && !v('date')) return f.date?.empty ? '线索没有留资时间' : `留资时间${f.date?.reason ?? '认不出'}`
  if (entity === 'customer' && !['id', 'name', 'phone', 'idcard', 'wechat'].some(k => v(k))) return '认不出是谁（编号、姓名、手机、证件号都是空的或读不出）'
  if (entity === 'campaign' && !v('name')) return '活动没有名称'
  // A table of 归属方 needs each row to name one; a customer or lead table that also names its 归属方 may leave it blank.
  if (entity === 'owner' && Object.keys(table.entities).length === 1 && !v('name') && !v('id')) return '归属方没有名称也没有编号'
  if (entity === 'asset' && !table.entities.customer && !Object.keys(REFS).some(k => f[k] && !f[k].empty)) return '持有物找不到客户'
  return null
}

/** Order number, or fingerprint, that recognizes the same event across imports. */
function eventKey(table, cleaned) {
  const order = cleaned.transaction?.fields.orderNo
  if (order?.ok && !order.empty) return { kind: 'order', value: `o|${table.name}|${order.value}` }
  const fp = fingerprintKey(table, cleaned)
  return fp ? { kind: 'fingerprint', value: fp } : null
}

/** Fingerprint of an event from the configured fields (default: every mapped field but the status). */
function fingerprintKey(table, cleaned) {
  const e = cleaned.transaction ?? cleaned.touch
  const fields = table.fingerprint.length > 0 ? table.fingerprint : Object.keys(e.fields).filter(k => k !== 'status' && k !== 'orderNo')
  const parts = fields.map(k => {
    const x = e.fields[k] ?? cleaned.customer?.fields[REF_FIELD[k]]
    return x && !x.empty ? String(x.value ?? x.unknown ?? '') : ''
  })
  if (parts.every(p => p === '')) return null
  return `f|${table.name}|${sha(parts.join('\u0001'))}`
}

/** Turn one cleaned row into entity rows and customer records. */
function emit(rows, records, table, cleaned, origin, rid, key, { importedAt = '', tableIndex = 0 } = {}) {
  const val = (e, k) => {
    const x = cleaned[e]?.fields[k]
    return x && x.ok && !x.empty ? x.value : null
  }
  const atOf = (e, k) => {
    const x = cleaned[e]?.fields[k]
    return x && x.ok && !x.empty ? x.at ?? null : null
  }
  const extraOf = e => Object.fromEntries(Object.entries(cleaned[e]?.extra ?? {}).map(([k, x]) => [k, x.ok && !x.empty ? x.value : null]))
  const rawOf = e => cleaned[e]?.raw ?? {}
  let recordIndex
  let made = null
  const serialOf = e => {
    const x = cleaned[e]?.fields.serial
    return x && !x.empty ? { value: x.value, ok: x.ok } : { value: null, ok: false }
  }
  if (cleaned.customer) {
    const keys = {}
    for (const k of ['id', 'phone', 'idcard', 'wechat', 'name', 'city', 'birthday']) keys[`customer.${k}`] = val('customer', k)
    const serial = cleaned.asset ? serialOf('asset') : { value: null, ok: false }
    const rec = {
      rid, origin, name: val('customer', 'name'), keys,
      fields: Object.fromEntries(Object.keys(ENTITIES.customer.fields).map(k => [k, val('customer', k)])),
      extra: extraOf('customer'),
      serials: serial.ok ? [serial.value] : [],
      assetIds: cleaned.asset && val('asset', 'id') ? [val('asset', 'id')] : [],
    }
    rec.sideKey = sideKeyOf(rec)
    recordIndex = records.length
    records.push(rec)
  } else if (table.newCustomers && (cleaned.transaction || cleaned.touch || cleaned.asset || cleaned.lead)) {
    // A lead with a phone or a code may make a prospect: someone on record who has not bought yet.
    const e = cleaned.touch ? 'touch' : cleaned.transaction ? 'transaction' : cleaned.asset ? 'asset' : 'lead'
    const keys = {}
    for (const [ref, f] of Object.entries(REF_FIELD)) keys[`customer.${f}`] = val(e, ref)
    if (STRONG_CUSTOMER.some(k => keys[`customer.${k}`])) {
      const rec = { rid, origin, name: keys['customer.name'], keys, fields: Object.fromEntries(Object.keys(ENTITIES.customer.fields).map(k => [k, keys[`customer.${k}`] ?? null])), extra: {}, serials: [], assetIds: [], created: true }
      rec.sideKey = sideKeyOf(rec)
      recordIndex = records.length
      records.push(rec)
    }
  }
  const refsOf = e => Object.fromEntries(Object.keys(REFS).filter(k => cleaned[e]?.fields[k]).map(k => [k, val(e, k)]))
  const link = (e, row) => {
    if (recordIndex !== undefined) row.record = recordIndex
    else row.refs = refsOf(e)
    row.linkKey = key?.value ?? `${origin.table}|${origin.source}|${origin.row}`
    return row
  }
  if (cleaned.asset) {
    const serial = serialOf('asset')
    rows.asset.push(link('asset', { aid: `a${sha(`${origin.table}|${serial.value ?? val('asset', 'id') ?? `${origin.source}|${origin.row}`}`).slice(0, 10)}`, extId: val('asset', 'id'), serial: serial.value, serialOk: serial.ok, type: val('asset', 'type'), model: val('asset', 'model'), start: val('asset', 'start'), end: val('asset', 'end'), status: val('asset', 'status'), owner: val('asset', 'owner'), extra: extraOf('asset'), origin, raw: rawOf('asset') }))
  }
  if (cleaned.transaction) {
    const assetRef = val('transaction', 'assetSerial') ?? val('transaction', 'assetId')
    const k = key?.value ?? `r|${origin.table}|${origin.source}|${origin.row}`
    made = link('transaction', { tid: `t${sha(`${k}|${origin.source}|${origin.row}`).slice(0, 12)}`, key: key?.value ?? null, orderNo: val('transaction', 'orderNo'), type: val('transaction', 'type'), typeRaw: cleaned.transaction.fields.type?.unknown ?? null, amount: val('transaction', 'amount'), priced: Boolean(table.entities.transaction?.amount), date: val('transaction', 'date'), status: val('transaction', 'status'), channel: val('transaction', 'channel'), owner: val('transaction', 'owner'), payerName: val('transaction', 'payerName'), payerPhone: val('transaction', 'payerPhone'), assetRef, asset: null, extra: extraOf('transaction'), origin, raw: rawOf('transaction') })
    rows.transaction.push(made)
  }
  if (cleaned.touch) {
    made = link('touch', { id: `x${sha(`${key?.value ?? ''}|${origin.source}|${origin.row}`).slice(0, 12)}`, key: key?.value ?? null, channel: val('touch', 'channel'), action: val('touch', 'action'), date: val('touch', 'date'), campaign: val('touch', 'campaign'), extra: extraOf('touch'), origin, raw: rawOf('touch') })
    rows.touch.push(made)
  }
  if (cleaned.lead) {
    const extId = val('lead', 'id')
    const lid = `l${sha(extId ? `id|${extId}` : `${origin.table}|${origin.source}|${origin.row}`).slice(0, 12)}`
    rows.lead.push(link('lead', {
      lid, extId, date: val('lead', 'date'), at: atOf('lead', 'date'),
      result: val('lead', 'result'), resultRaw: cleaned.lead.fields.result?.unknown ?? null,
      level: val('lead', 'level'), channel: val('lead', 'channel'), source: val('lead', 'source'), campaign: val('lead', 'campaign'), product: val('lead', 'product'),
      trial: val('lead', 'trial'), owner: val('lead', 'owner'), rep: val('lead', 'rep'),
      firstFollow: val('lead', 'firstFollow'), firstFollowAt: atOf('lead', 'firstFollow'), lastFollow: val('lead', 'lastFollow'), lastFollowAt: atOf('lead', 'lastFollow'), wonDate: val('lead', 'wonDate'),
      extra: extraOf('lead'), origin, raw: rawOf('lead'), tables: [origin.table], rows: 1, _at: importedAt, _ti: tableIndex,
    }))
  }
  if (cleaned.campaign) rows.campaign.push({ name: val('campaign', 'name'), type: val('campaign', 'type'), start: val('campaign', 'start'), end: val('campaign', 'end'), budget: val('campaign', 'budget'), channel: val('campaign', 'channel'), origin })
  if (cleaned.owner && (val('owner', 'id') || val('owner', 'name'))) rows.owner.push({ id: val('owner', 'id'), name: val('owner', 'name'), type: val('owner', 'type'), city: val('owner', 'city'), extra: extraOf('owner'), table: tableIndex })
  return made ?? true
}

const LEAD_VALUES = ['date', 'at', 'result', 'resultRaw', 'level', 'channel', 'source', 'campaign', 'product', 'trial', 'owner', 'rep', 'firstFollow', 'firstFollowAt', 'lastFollow', 'lastFollowAt', 'wonDate']

/**
 * Lead rows that share a lead number become one lead. The row of the newest import stands (the same import:
 * the table listed first in the configuration); what it leaves blank is filled from the others, newest first.
 * A lead without a number stays as it is.
 */
export function mergeLeads(list) {
  const groups = new Map()
  const out = []
  for (const l of list) {
    if (!l.extId) { out.push([l]); continue }
    let g = groups.get(l.extId)
    if (!g) { g = []; groups.set(l.extId, g); out.push(g) }
    g.push(l)
  }
  return out.map(g => {
    const [base, ...rest] = g.length === 1 ? g : [...g].sort((a, b) => b._at.localeCompare(a._at) || a._ti - b._ti)
    for (const o of rest) {
      for (const f of LEAD_VALUES) if (base[f] === null || base[f] === undefined) base[f] = o[f]
      for (const [k, v] of Object.entries(o.extra ?? {})) if (base.extra[k] === null || base.extra[k] === undefined) base.extra[k] = v
      if (base.record === undefined && o.record !== undefined) { base.record = o.record; delete base.refs }
      if (base.record === undefined && o.refs) base.refs = { ...o.refs, ...Object.fromEntries(Object.entries(base.refs ?? {}).filter(([, v]) => v)) }
    }
    // The results of the same lead disagree only when one export is older; the newest one stood above.
    base.tables = [...new Set(g.sort((a, b) => a._ti - b._ti).flatMap(x => x.tables))]
    base.rows = g.length
    if (base.extId) base.linkKey = `lead|${base.extId}`
    delete base._at
    delete base._ti
    return base
  })
}

/**
 * The 归属方 directory. Rows that share a code are one 归属方; a row with only a name joins the one that
 * already carries that name, or stands for itself. Its name is the one the first table of the configuration
 * gives it (the most frequent there); its attributes are the most frequent value across its rows.
 * @param {{ id: string|null, name: string|null, type: string|null, city: string|null, extra: object, table: number }[]} rows
 * @returns {{ owners: { name: string, id: string|null, type: string|null, city: string|null, extra: object, aliases: string[] }[], resolve: (v: string|null) => string|null }}
 */
export function mergeOwners(rows) {
  const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const groups = new Map()
  const byName = new Map()
  const groupOf = key => { if (!groups.has(key)) groups.set(key, { id: null, names: new Map(), attrs: new Map() }); return groups.get(key) }
  const note = (g, r) => {
    if (r.name) {
      const at = g.names.get(r.name) ?? { table: r.table, count: 0 }
      g.names.set(r.name, { table: Math.min(at.table, r.table), count: at.count + 1 })
      if (!byName.has(norm(r.name))) byName.set(norm(r.name), g)
    }
    for (const [k, v] of [['type', r.type], ['city', r.city], ...Object.entries(r.extra ?? {}).map(([k, v]) => [`extra.${k}`, v])]) {
      if (v === null || v === undefined || Array.isArray(v)) continue
      if (!g.attrs.has(k)) g.attrs.set(k, new Map())
      g.attrs.get(k).set(v, (g.attrs.get(k).get(v) ?? 0) + 1)
    }
  }
  for (const r of rows) if (r.id) { const g = groupOf(`id|${norm(r.id)}`); g.id ??= r.id; note(g, r) }
  for (const r of rows) {
    if (r.id || !r.name) continue
    // A row that gives only a "name" which is another row's code (one table has the code column and nothing else).
    const coded = groups.get(`id|${norm(r.name)}`)
    if (coded) note(coded, { ...r, name: null })
    else note(byName.get(norm(r.name)) ?? groupOf(`name|${norm(r.name)}`), r)
  }
  const most = m => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null
  const alias = new Map()
  const owners = []
  for (const g of groups.values()) {
    const names = [...g.names].sort((a, b) => a[1].table - b[1].table || b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([n]) => n)
    const name = names[0] ?? g.id
    const extra = {}
    for (const [k, m] of g.attrs) if (k.startsWith('extra.')) extra[k.slice(6)] = most(m)
    owners.push({ name, id: g.id, type: g.attrs.has('type') ? most(g.attrs.get('type')) : null, city: g.attrs.has('city') ? most(g.attrs.get('city')) : null, extra, aliases: [...new Set([...names.slice(1), ...(g.id && g.id !== name ? [g.id] : [])])] })
    for (const a of [g.id, ...names]) if (a && !alias.has(norm(a))) alias.set(norm(a), name)
  }
  owners.sort((a, b) => a.name.localeCompare(b.name))
  return { owners, resolve: v => (v === null || v === undefined ? v ?? null : alias.get(norm(v)) ?? v) }
}

/**
 * How the kinds of rows that name a 归属方 line up. Two kinds with hardly a name in common were written two
 * ways (a short name here, a company name there), and whatever is counted per 归属方 falls apart.
 * @param {{ customers: object[], transactions: object[], assets: object[], leads?: object[] }} data - rows with `owner`.
 * @returns {{ byEntity: Record<string, number>, apart: { a: string, b: string, aCount: number, bCount: number, shared: number }[] }}
 */
export function ownersApart(data) {
  const names = Object.fromEntries([['customer', data.customers], ['transaction', data.transactions], ['asset', data.assets], ['lead', data.leads ?? []]].map(([e, list]) => [e, new Set(list.map(x => x.owner).filter(Boolean))]).filter(([, set]) => set.size > 0))
  const apart = []
  const kinds = Object.keys(names)
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      const [a, b] = [names[kinds[i]], names[kinds[j]]]
      const shared = [...a].filter(n => b.has(n)).length
      if (Math.min(a.size, b.size) >= 5 && shared < Math.min(a.size, b.size) * 0.5) apart.push({ a: kinds[i], b: kinds[j], aCount: a.size, bCount: b.size, shared })
    }
  }
  return { byEntity: Object.fromEntries(Object.entries(names).map(([e, set]) => [e, set.size])), apart }
}

/** A record's identity, from its key values only: stable across imports and folders. */
function sideKeyOf(rec) {
  return sha(JSON.stringify([rec.name ?? '', ...['customer.id', 'customer.phone', 'customer.idcard', 'customer.wechat'].map(k => rec.keys[k] ?? ''), [...rec.serials].sort()]))
}

/** One record as the person sees it on the review page (raw values; never sent to a model). */
function describeRecord(r) {
  return { table: r.origin.table, sourceName: r.origin.sourceName, sheetName: r.origin.sheetName, row: r.origin.row, name: r.name, phone: r.keys['customer.phone'], id: r.keys['customer.id'], idcard: r.keys['customer.idcard'], city: r.keys['customer.city'], serials: r.serials, created: r.created === true }
}

/** Phones used by more than one distinct name. */
/**
 * Phones that one table lists under several names (siblings on a parent's phone).
 * Only within a table: a nickname in another table is the same person, not a shared phone.
 */
function sharedPhones(records) {
  const names = new Map()
  for (const r of records) {
    const p = r.keys['customer.phone']
    if (!p || !r.name) continue
    const k = `${r.origin.table}\u0001${p}`
    if (!names.has(k)) names.set(k, new Set())
    names.get(k).add(normName(r.name))
  }
  return new Set([...names].filter(([, s]) => s.size > 1).map(([k]) => k.split('\u0001')[1]))
}

/** Two clusters that hold different values of a key that only one person can have. */
function conflicting(records, uf, a, b) {
  const ra = uf.find(a)
  const rb = uf.find(b)
  const valuesOf = (root, k) => new Set(uf.members(root).map(i => records[i].keys[k]).filter(Boolean))
  for (const k of ['customer.id', 'customer.idcard', 'customer.wechat']) {
    const va = valuesOf(ra, k)
    const vb = valuesOf(rb, k)
    if (va.size > 0 && vb.size > 0 && ![...va].some(v => vb.has(v))) return true
  }
  return false
}

/** Union–find whose unions refuse to join two records a person split apart. */
function unionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const members = Array.from({ length: n }, (_, i) => [i])
  const forbidden = new Map()
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  return {
    find,
    members: root => members[root],
    forbid(a, b) {
      if (!forbidden.has(a)) forbidden.set(a, new Set())
      if (!forbidden.has(b)) forbidden.set(b, new Set())
      forbidden.get(a).add(b)
      forbidden.get(b).add(a)
    },
    union(a, b) {
      let ra = find(a)
      let rb = find(b)
      if (ra === rb) return true
      for (const x of members[ra]) for (const y of forbidden.get(x) ?? []) if (find(y) === rb) return false
      if (members[ra].length < members[rb].length) [ra, rb] = [rb, ra]
      parent[rb] = ra
      members[ra].push(...members[rb])
      members[rb] = []
      return true
    },
  }
}

/** Find the one customer a row's reference fields point at, by the identity rules in order. */
function linkRefs(spec, index, shared, refs) {
  if (!refs || Object.values(refs).every(v => !v)) return { unlinked: 'no-key' }
  for (const rule of spec.identity) {
    const fields = rule.keys.map(k => KEY_REF[k])
    if (fields.some(f => !f || !refs[f])) continue
    let hits = null
    for (let i = 0; i < rule.keys.length; i++) {
      const set = index.get(rule.keys[i])?.get(refs[fields[i]]) ?? new Set()
      hits = hits === null ? new Set(set) : new Set([...hits].filter(x => set.has(x)))
    }
    if (hits.size === 1) {
      const weak = rule.strength === 'weak' || (rule.unless === 'shared' && refs.customerPhone && shared.has(refs.customerPhone) && rule.keys.includes('customer.phone'))
      return { cid: [...hits][0], method: weak ? 'weak' : 'strong' }
    }
    if (hits.size > 1) return { unlinked: 'ambiguous' }
  }
  return { unlinked: 'no-match' }
}

/**
 * Why the rows of a table found nobody, in words a person can act on: what the table gives to find
 * people with, and what went wrong with it.
 */
function whyUnlinked(spec, tableName, entity, unlinkedBy) {
  const t = spec.tables.find(x => x.name === tableName)
  const refs = Object.keys(t?.entities?.[entity] ?? {}).filter(f => REFS[f])
  const names = refs.map(f => REFS[f].name).join('、') || '同一行的客户'
  if (refs.length > 0 && usableRules(spec, t, entity).length === 0) return `这张表只给了${names}，认人规则里没有一条只靠它就能认人`
  const n = k => unlinkedBy[k] ?? 0
  const f = k => n(k).toLocaleString('en-US')
  const parts = [
    n('excluded') && `${f('excluded')} 行指着的客户被行过滤排除了`,
    n('no-match') && `${f('no-match')} 行的${names}在客户表里找不到`,
    n('ambiguous') && `${f('ambiguous')} 行对上了不止一个客户（重名）`,
    n('no-key') && `${f('no-key')} 行找客户的那一列是空的`,
  ].filter(Boolean)
  const nameOnly = refs.length === 1 && refs[0] === 'customerName'
  const hint = nameOnly ? '只靠姓名认不准人；这些人也可能本来就不在客户表里' : n('no-match') ? '两边多半不是同一套编号，或者这些人本来就不在客户表里' : ''
  return `${parts.join('，')}${hint ? `。${hint}` : ''}`
}

/** Identity rules a table's reference fields can use: every key of the rule is a field the table maps. */
export function usableRules(spec, table, entity) {
  const fields = table?.entities?.[entity] ?? {}
  return (spec.identity ?? []).filter(rule => rule.keys.every(k => KEY_REF[k] && fields[KEY_REF[k]]))
}

/**
 * What a run got wrong, in plain sentences: for the draft's trial run, the status the model reads and the
 * screens. Empty when nothing needs a look.
 */
export function reconProblems(recon, labels = {}) {
  const name = e => labels[e] ?? ENTITIES[e]?.name ?? e
  const n = v => Number(v).toLocaleString('en-US')
  const out = []
  for (const x of recon.lostRows ?? []) out.push(`「${x.table}」${n(x.total)} 行里有 ${n(x.failed)} 行没进来（${x.reason ?? '读不出'}）：多半是对了一列空的，或者对错了列`)
  for (const x of recon.overFiltered ?? []) out.push(`「${x.table}」${n(x.total)} 行里有 ${n(x.excluded)} 行被行过滤排除了（${x.by ?? '按配置'}）：几乎没剩下，多半是条件写反了（in 和 not_in），或者取值抄错了`)
  for (const x of recon.looseCustomers ?? []) out.push(`「${x.table}」只有姓名能认人，${n(x.repeated)} 行和别的行同名却各算了一个客户：客户数被撑大了。这张表记的是线索、商机、报名就喂给 lead，是跟进记录就喂给 touch，不要当客户表`)
  for (const x of recon.weakLinks ?? []) out.push(`「${x.table}」的${name(x.entity)} ${n(x.total)} 行里只有 ${n(x.linked)} 行挂上了客户（${Math.round(x.rate * 1000) / 10}%）：${x.why}`)
  for (const x of (recon.parseProblems ?? []).slice(0, 8)) out.push(`「${x.table}」的「${x.column}」只解析出 ${Math.round(x.rate * 1000) / 10}%`)
  return out
}

/** Plain words for the reasons a row stayed unlinked. */
export const UNLINKED = Object.freeze({ 'no-key': '这一行没有能认人的值', 'no-match': '哪个客户都对不上', excluded: '指着的客户被行过滤排除了', ambiguous: '对上了不止一个人', 'person-split': '你拆开了' })
export const LINK_METHODS = Object.freeze({ 'same-row': '同一行', strong: '强键', weak: '弱键（只有一个人对得上）' })
