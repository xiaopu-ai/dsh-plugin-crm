// 引擎的五个补丁：
// 1. 行过滤：配置里写哪些行不读，对账里单独记一类，金额照样对得上；被排除的客户还有别的表指着时要说出来；
// 2. 多值标签：一格几个值各算一个标签，规则能问「含有」「不含」「有几个」；
// 3. 持有物上的字段进规则：两个条件要落在同一件持有物上才算；
// 4. 分层的性质：写了 lifecycle 的层不算流失；没写、而数据里几乎没人隔月再来时，试跑会提醒；
// 5. 体检少报：只有「到期」这种日期才会让状态过期，一个状态列只报一次。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { cleanValue, dictionaryIndex } from '../lib/core/clean.js'
import { compare } from '../lib/core/features.js'
import { kindOf, ruleKind } from '../lib/core/insights.js'
import { multiValues, profileSheet } from '../lib/core/profile.js'
import { checkSpec, describeRule, fieldNames } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'

const AS_OF = '2026-10-31'
const csv = rows => Buffer.from(rows.map(r => r.map(c => (/[,"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n'))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// 40 位客户。C1～C5 原表标了重复；产品线一格里可能有几个值。
const lines = i => (i <= 10 ? '摩托艇' : i <= 20 ? '摩托艇,全地形车' : i <= 25 ? '全地形车、雪地车' : i <= 30 ? '' : '雪地车')
const CUSTOMERS = [['客户编号', '姓名', '手机', '产品线', '标记'], ...range(1, 40).map(i => [`C${i}`, `客户${i}`, `138000001${String(i).padStart(2, '0')}`, lines(i), i <= 5 ? '重复' : ''])]
// 每位客户一台车，C12 有两台。C37～C40 的是试乘试驾车。权益：状态和失效日期。
const benefit = i => ({ 1: ['待使用', '2026-11-10'], 6: ['待使用', '2026-11-20'], 7: ['待使用', '2026-12-25'], 8: ['待使用', '2027-02-01'], 9: ['已使用', '2026-11-20'], 10: ['待使用', '2026-10-01'], 12: ['已使用', '2026-11-20'] }[i] ?? ['已使用', '2026-06-01'])
const VEHICLES = [['单号', '客户编号', '交付日期', '金额', '用途', '权益状态', '权益失效', '型号'],
  ...range(1, 40).map(i => [`V${i}`, `C${i}`, i <= 20 ? '2026-09-01' : '2025-05-01', '100.00', i >= 37 ? '试乘试驾' : '个人', ...benefit(i), 'X1']),
  // C12 的第二台：权益还没用，但离失效还远。两个条件不在同一台车上，不该算「快过期」。
  ['V41', 'C12', '2026-09-01', '100.00', '个人', '待使用', '2027-03-01', 'X2']]

const soon = () => ({ feature: 'asset_count', where: [{ field: 'status', op: '=', value: '待使用' }, { days_to: 'extra.benefit_end', op: 'between', value: [0, 60] }], op: '>=', value: 1 })
const spec = src => ({
  tables: [
    { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', phone: '手机' } },
      extra: [{ entity: 'customer', key: 'lines', name: '产品线', column: '产品线', type: 'tags' }],
      skipRows: [{ column: '标记', when: 'filled', why: '原表标了重复' }] },
    { name: '车辆', source: src.vehicles, mode: 'snapshot',
      entities: { transaction: { orderNo: '单号', customerId: '客户编号', date: '交付日期', amount: '金额' }, asset: { id: '单号', customerId: '客户编号', start: '交付日期', status: '权益状态', model: '型号' } },
      extra: [{ entity: 'asset', key: 'benefit_end', name: '权益失效日', column: '权益失效', type: 'date' }],
      skipRows: [{ column: '用途', when: 'in', values: ['试乘试驾'] }] },
  ],
  identity: [{ keys: ['customer.id'], strength: 'strong' }],
  segments: [
    { name: '新车主', all: [{ feature: 'days_since_last_txn', op: '<=', value: 90 }] },
    { name: '买了一阵', all: [{ feature: 'days_since_last_txn', op: '>', value: 90 }] },
  ],
  flags: [
    { name: '权益快过期', all: [soon()] },
    { name: '跨品类', all: [{ feature: 'tag_count', args: ['extra.lines'], op: '>=', value: 2 }] },
    { name: '有摩托艇', all: [{ feature: 'field', args: ['extra.lines'], op: 'has', value: '摩托艇' }] },
    { name: '没有摩托艇', all: [{ feature: 'field', args: ['extra.lines'], op: 'lacks', value: '摩托艇' }] },
    { name: '艇或雪', all: [{ feature: 'field', args: ['extra.lines'], op: 'in', value: ['摩托艇', '雪地车'] }] },
  ],
  lists: { purposes: ['回访'], outcomes: [{ code: 'done', name: '成了', kind: 'success' }] },
})
const FAKE = { customers: 'aaaaaaaa', vehicles: 'bbbbbbbb' }
const errorAt = (s, path) => checkSpec(s).errors.find(e => e.path === path)

describe('配置检查：新写法', () => {
  it('这份配置能过', () => assert.deepEqual(checkSpec(spec(FAKE)).errors, []))

  it('行过滤：when 写错、该写 values 没写', () => {
    const a = spec(FAKE); a.tables[0].skipRows = [{ column: '标记', when: 'is' }]
    assert.match(errorAt(a, 'tables[0].skipRows[0].when').message, /when 只能是：in/)
    const b = spec(FAKE); b.tables[1].skipRows = [{ column: '用途', when: 'in' }]
    assert.match(errorAt(b, 'tables[1].skipRows[0].values').message, /原表里的写法/)
    const c = spec(FAKE); c.tables[0].skipRows = [{ column: '标记', when: 'filled', values: ['重复'] }]
    assert.match(errorAt(c, 'tables[0].skipRows[0].values').message, /不用写 values/)
  })

  it('多值标签：只能问含有、不含、任一个、空不空', () => {
    const a = spec(FAKE); a.flags[2].all[0].op = '='
    assert.match(errorAt(a, 'flags[2].all[0].op').message, /多值标签字段只能写 has/)
    const b = spec(FAKE); b.flags[2].all[0] = { feature: 'field', args: ['city'], op: 'has', value: '北京' }
    assert.match(errorAt(b, 'flags[2].all[0].op').message, /只能用在多值标签字段上/)
    const c = spec(FAKE); c.flags[1].all[0].args = ['city']
    assert.match(errorAt(c, 'flags[1].all[0].args[0]').message, /多值标签字段只能是：extra\.lines/)
    const d = spec(FAKE); d.flags[2].all[0] = { feature: 'field', args: ['extra.lines'], op: '=', value: '' }
    assert.deepEqual(checkSpec(d).errors, [])
    // 有字典时，问的值要在字典里
    const e = spec(FAKE); e.dictionaries = { 'customer.extra.lines': { 摩托艇: ['PWC'], 全地形车: [], 雪地车: [] } }; e.flags[2].all[0].value = '游艇'
    assert.match(errorAt(e, 'flags[2].all[0].value').message, /不在这个字段的字典里/)
  })

  it('where：只有持有物的特征能写；字段、日期字段、取值都查', () => {
    const a = spec(FAKE); a.segments[0].all[0].where = [{ field: 'status', op: '=', value: '待使用' }]
    assert.match(errorAt(a, 'segments[0].all[0].where').message, /只有持有物的特征/)
    const b = spec(FAKE); b.flags[0].all[0].where[1] = { days_to: 'extra.nope', op: '<', value: 30 }
    assert.match(errorAt(b, 'flags[0].all[0].where[1].days_to').message, /持有物的日期字段只能是：start、end、extra\.benefit_end/)
    const c = spec(FAKE); c.flags[0].all[0].where[0] = { field: 'benefit', op: '=', value: 'x' }
    assert.match(errorAt(c, 'flags[0].all[0].where[0].field').message, /持有物字段只能是：/)
    const d = spec(FAKE); d.flags[0].all[0].where[0] = { field: 'status', days_to: 'end', op: '=', value: 1 }
    assert.match(errorAt(d, 'flags[0].all[0].where[0]').message, /每条写成/)
    const e = spec(FAKE); e.dictionaries = { 'asset.status': { 待使用: ['未使用'], 已使用: [] } }; e.flags[0].all[0].where[0].value = '没用'
    assert.match(errorAt(e, 'flags[0].all[0].where[0].value').message, /不在 asset\.status 的字典里，能用的是：待使用、已使用/)
  })

  it('kind 只能从固定的几种里选', () => {
    const a = spec(FAKE); a.segments[1].kind = 'stage'
    assert.match(errorAt(a, 'segments[1].kind').message, /kind 只能是：lifecycle/)
    const b = spec(FAKE); b.segments[1].kind = 'lifecycle'; b.flags[0].kind = 'plain'
    assert.deepEqual(checkSpec(b).errors, [])
  })

  it('规则用大白话说得出来', () => {
    const s = checkSpec(spec(FAKE)).spec
    const names = fieldNames(s)
    assert.equal(describeRule(s.flags[0], names), '持有物数量（只算：「状态」 = 待使用，并且 离「权益失效日」还有 0～60 天） ≥ 1')
    assert.equal(describeRule(s.flags[1], names), '「产品线」有几个值 ≥ 2')
    assert.equal(describeRule(s.flags[3], names), '「产品线」 不含 摩托艇')
  })
})

describe('比较和清洗', () => {
  it('一格几个值：切开、去重、过字典，不认识的留给人', () => {
    assert.deepEqual(cleanValue('tags', '摩托艇，全地形车;摩托艇').value, ['摩托艇', '全地形车'])
    assert.deepEqual(cleanValue('tags', '空号/停机').value, ['空号/停机'])
    assert.deepEqual(cleanValue('tags', 'A/B', { sep: '/' }).value, ['A', 'B'])
    assert.equal(cleanValue('tags', ' , ').empty, true)
    const dict = dictionaryIndex({ 摩托艇: ['PWC'], 全地形车: ['ATV', 'SSV'] })
    const r = cleanValue('tags', 'pwc, atv, SSV, 雪地车', { dict })
    assert.deepEqual(r.value, ['摩托艇', '全地形车'])
    assert.deepEqual(r.unknowns, ['雪地车'])
    const none = cleanValue('tags', '雪地车', { dict })
    assert.equal(none.ok, false)
    assert.equal(none.unknown, '雪地车')
  })

  it('集合的比较：空的不含任何值，别的比较遇到空值不命中', () => {
    assert.equal(compare(['a', 'b'], 'has', 'a'), true)
    assert.equal(compare(['a', 'b'], 'lacks', 'c'), true)
    assert.equal(compare(null, 'lacks', 'a'), true)
    assert.equal(compare(null, 'has', 'a'), false)
    assert.equal(compare(['a'], 'in', ['x', 'a']), true)
    assert.equal(compare([], '=', ''), true)
    assert.equal(compare(null, '>', 0), false)
    assert.equal(compare(5, 'between', [0, 60]), true)
  })
})

describe('在一份数据上跑', () => {
  let dir, ds, id, src, saved

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-engine-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '引擎测试', preset: 'blank' }))
    src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id
    src.vehicles = (await ds.importFile(id, '车辆.csv', csv(VEHICLES))).id
    await ds.setAsOf(id, AS_OF)
    await ds.markChecked(id)
    saved = await ds.saveSpecDraft(id, spec(src))
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('试跑：排除了多少行、为什么，每层每个标记多少人', () => {
    const t = saved.trial
    assert.deepEqual(t.excluded, [{ table: '客户', rows: 5, by: { 原表标了重复: 5 } }, { table: '车辆', rows: 4, by: { '「用途」是 试乘试驾': 4 } }])
    assert.equal(t.counts.customers, 35)
    assert.equal(t.counts.transactions, 37)
    assert.equal(t.counts.excluded, 9)
    assert.deepEqual(t.groups.segments.map(x => [x.name, x.count, x.kind]), [['新车主', 15, 'active'], ['买了一阵', 16, 'lapsed'], ['其他', 4, null]])
    assert.deepEqual(Object.fromEntries(t.groups.flags.map(x => [x.name, x.count])), { 权益快过期: 2, 跨品类: 15, 有摩托艇: 15, 没有摩托艇: 20, 艇或雪: 30 })
    assert.equal(t.groups.flags[0].kind, 'deadline')
    assert.deepEqual(saved.summary.tables.map(x => x.skip), [['原表标了重复'], ['「用途」是 试乘试驾']])
  })

  it('试跑的提醒：被排除的客户还有车指着；像生命周期的层被当成了流失', () => {
    const { hints, problems, links } = saved.trial
    assert.deepEqual(problems, [])
    assert.deepEqual(links.find(x => x.entity === 'transaction'), { table: '车辆', entity: 'transaction', total: 37, linked: 32, ratePct: 86.5 })
    assert.equal(hints.length, 2)
    assert.match(hints[0], /「车辆」有 5 行（.*）挂不上客户，因为它们指着的客户被行过滤排除了（原表标了重复）/)
    assert.match(hints[1], /「买了一阵」是按「多久没有交易」分的.*有交易的 31 位客户只有 0% 隔月又来过.*"kind": "lifecycle"/)
  })

  it('写了 lifecycle 就不再提醒，看板也不把它当流失', async () => {
    const s = spec(src); s.segments[1].kind = 'lifecycle'
    saved = await ds.saveSpecDraft(id, s)
    assert.equal(saved.trial.hints.length, 1)
    assert.equal(saved.trial.groups.segments[1].kind, 'lifecycle')
    assert.equal(saved.summary.segments[1].kind, 'lifecycle')
    assert.equal(kindOf({ kind: 'lifecycle', ...s.segments[1] }), 'lifecycle')
    assert.equal(kindOf({ ...s.segments[1], kind: 'plain' }), null)
    assert.equal(ruleKind(s.flags[0]), 'deadline')
  })

  it('清洗：每行有去处，钱对得上，对账过了', async () => {
    await ds.finalizeSpec(id, saved.revision)
    const built = await ds.build(id)
    assert.equal(built.gate, 'ok')
    const { recon } = await ds.reconciliation(id)
    const rows = t => recon.tables.find(x => x.table === t).sheets[0]
    assert.deepEqual(rows('客户').rows, { total: 40, loaded: 35, skipped: 0, excluded: 5, failed: 0, duplicate: 0, skippedBy: {}, excludedBy: { 原表标了重复: 5 }, failedBy: {} })
    const v = rows('车辆')
    assert.equal(v.rowsOk, true)
    assert.equal(v.money.ok, true)
    assert.deepEqual([v.money.loaded, v.money.excluded], [370000, 40000])
    assert.equal(recon.link.transaction.unlinkedBy.excluded, 5)
    const { result: q } = await ds.query(id, 'quality', {}, { log: false })
    assert.deepEqual(q.tables.map(t => [t.table, t.rows.loaded, t.rows.excluded]), [['客户', 35, 5], ['车辆', 37, 4]])
  })

  it('「权益快过期」是那两个人：两个条件要在同一台车上', async () => {
    const hit = await ds.customers(id, { flag: '权益快过期' })
    assert.deepEqual(hit.rows.map(r => r.id).sort(), ['C6', 'C7'])
  })

  it('按多值字段拆：一个人算进好几组，会说明加起来不等于总数', async () => {
    const { result } = await ds.query(id, 'breakdown', { metric: 'customers', by: 'customer.extra.lines' }, { log: false })
    assert.deepEqual(Object.fromEntries(result.rows.map(r => [r.key, r.value])), { 摩托艇: 15, 全地形车: 15, 雪地车: 15, '（空）': 5 })
    assert.equal(result.total, null)
    assert.match(result.note, /加起来不等于总数/)
  })

  it('看板：生命周期的层不出「掉进去」的提醒，流向也认这个性质', async () => {
    const ov = await ds.overview(id)
    assert.deepEqual(ov.kinds.segments, { 新车主: 'active', 买了一阵: 'lifecycle' })
    assert.equal(ov.insights.some(x => /掉进了|最大的一块存量/.test(x.title + x.suggest)), false)
    assert.ok(ov.insights.some(x => x.id === 'deadline:权益快过期'))
  })

  it('行过滤把表排空了：试跑说条件多半写反了', async () => {
    const s = spec(src); s.segments[1].kind = 'lifecycle'
    s.tables[1].skipRows = [{ column: '用途', when: 'not_in', values: ['试乘试驾'] }]
    const t = (await ds.saveSpecDraft(id, s)).trial
    assert.equal(t.ok, false)
    assert.match(t.problems.join('\n'), /「车辆」41 行里有 37 行被行过滤排除了（「用途」不是 试乘试驾）：几乎没剩下，多半是条件写反了/)
  })
})

describe('体检', () => {
  const sheet = rows => ({ name: '表', rows })

  it('只有到期这种日期才会让状态过期；一个状态列只对最近的那个到期日报一次', () => {
    const rows = [['单号', '建单日期', '生效日期', '失效日期', '权益状态', '交付日期', '保修到期日'],
      ...range(1, 30).map(i => [`A${i}`, '2026-01-05', '2026-01-10', i <= 4 ? '2026-06-30' : '2027-01-10', i <= 20 ? '待使用' : '已使用', '2026-01-08', i <= 10 ? '2026-09-01' : '2028-01-08'])]
    const p = profileSheet(sheet(rows), { asOf: AS_OF })
    assert.deepEqual(p.stale, [{ status: '权益状态', date: '失效日期', stale: 4, missing: 0, values: ['待使用'] }])
    const checks = p.warnings.filter(w => w.level === 'check').map(w => w.text)
    assert.deepEqual(checks, ['有 4 行「失效日期」已经过了，「权益状态」还停在「待使用」，状态可能没人更新'])
  })

  it('没有到期日的表不报状态过期', () => {
    const rows = [['编号', '建单日期', '状态', '最新跟进日期'], ...range(1, 30).map(i => [`L${i}`, '2026-03-01', i % 2 ? '待跟进' : '已转化', '2026-04-01'])]
    assert.deepEqual(profileSheet(sheet(rows), { asOf: AS_OF }).stale, [])
  })

  it('列名没写到期，但一多半日期在以后：也算到期日', () => {
    const rows = [['编号', '上课日', '状态'], ...range(1, 30).map(i => [`K${i}`, i <= 12 ? '2026-10-01' : '2026-12-01', i <= 6 ? '已预约' : i <= 12 ? '已完成' : '已预约'])]
    assert.deepEqual(profileSheet(sheet(rows), { asOf: AS_OF }).stale.map(x => [x.status, x.date, x.stale]), [['状态', '上课日', 6]])
  })

  it('一格几个值的列：切开以后是哪几种、各多少行；一格几个日期单说', () => {
    const cells = [...range(1, 30).map(i => (i % 3 === 0 ? '摩托艇,全地形车' : i % 3 === 1 ? '摩托艇' : '雪地车'))]
    const m = multiValues(cells)
    assert.deepEqual([m.cells, m.distinct], [10, 3])
    assert.deepEqual(Object.fromEntries(m.items.map(x => [x.value, x.count])), { 摩托艇: 20, 全地形车: 10, 雪地车: 10 })
    // 「姓, 名」这种带逗号的写法不是几个值
    assert.equal(multiValues(range(1, 30).map(i => (i % 2 ? 'EM0001 Zhang, Wei' : 'EM0002 Li, Na'))), null)
    assert.deepEqual(multiValues(range(1, 30).map(i => (i % 2 ? '2019-08,2022-08' : '2021-05'))), { cells: 15, sharePct: 50, dates: true })
    assert.equal(multiValues(range(1, 30).map(i => `备注${i}，客户说下周再来，电话${i}`)), null)
    assert.equal(multiValues(['a', 'b', 'c']), null)
  })

  it('空列合成一行说', () => {
    const rows = [['编号', '姓名', '手机', '地址', '备注', '邮箱'], ...range(1, 12).map(i => [`C${i}`, `客户${i}`, `138000002${String(i).padStart(2, '0')}`, '', '', ''])]
    const info = profileSheet(sheet(rows), { asOf: AS_OF }).warnings.filter(w => /整列是空的/.test(w.text))
    assert.deepEqual(info.map(w => w.text), ['有 3 列整列是空的：地址、备注、邮箱'])
  })
})
