// 触达覆盖和每家一份的简报：
// 1. 标成触达渠道的标记，各覆盖多少客户、多少人一个渠道都没有；按分层、按门店、按大区摆开；
// 2. 缺口能直接圈人：某一层、某一家里「没有某个渠道」的人，客户页看得到，名单出得来；
// 3. 每家一份简报是拿看板上的数排出来的：这一家和整体、和同大区比，要先做什么；打成一包，可以附上各家待处理的线索。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { ownerBriefs } from '../lib/core/owners.js'
import { checkSpec } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'
import { assistantTools } from '../lib/host/assistant.js'

const AS_OF = '2026-10-31'
const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// 六家门店（第六家只有线索）。60 位客户，五家各 12 位；前 24 位加了企微，编号是 3 的倍数的电话接通过。
const SHOPS = [['D1', '甲店', '北区'], ['D2', '乙店', '北区'], ['D3', '丙店', '北区'], ['D4', '丁店', '南区'], ['D5', '戊店', '南区'], ['D6', '己店', '南区']]
const shopOf = n => SHOPS[(n - 1) % 5]
const CUSTOMERS = [['客户编号', '姓名', '门店代码', '门店', '大区', '加微', '外呼'], ...range(1, 60).map(n => [`C${n}`, `客户${n}`, shopOf(n)[0], shopOf(n)[1], shopOf(n)[2], n <= 24 ? '已加' : '未加', n % 3 === 0 ? '接通' : ''])]
// 前 20 位各有一笔订单。
const ORDERS = [['单号', '客户编号', '日期', '金额', '门店代码'], ...range(1, 20).map(n => [`O${n}`, `C${n}`, '2026-10-01', '100.00', shopOf(n)[0]])]
// 线索：甲店 12 条跟得及时、成交一半；乙店 12 条没人跟；丙丁戊各 6 条跟了一次就断了；己店 5 条在跟。
let li = 0
const lead = (shop, first, last, result, rep) => [`L${++li}`, '2026-10-10', shop[0], first, last, result, rep]
const LEADS = [['线索号', '留资日期', '门店代码', '首次跟进', '最近跟进', '结果', '顾问'],
  ...range(1, 12).map(k => lead(SHOPS[0], '2026-10-10', '2026-10-25', k <= 6 ? '成交' : '跟进中', k <= 8 ? '张三' : '李四')),
  ...range(1, 12).map(() => lead(SHOPS[1], '', '', '跟进中', '')),
  ...[2, 3, 4].flatMap(s => range(1, 6).map(() => lead(SHOPS[s], '2026-10-10', '2026-10-12', '跟进中', '王五'))),
  ...range(1, 5).map(() => lead(SHOPS[5], '2026-10-10', '2026-10-25', '跟进中', '赵六'))]

const spec = src => ({
  labels: { owner: '门店' },
  tables: [
    { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', owner: '门店代码' }, owner: { id: '门店代码', name: '门店' } },
      extra: [{ entity: 'customer', key: 'wechat', name: '加微', column: '加微', type: 'category' }, { entity: 'customer', key: 'call', name: '外呼', column: '外呼', type: 'category' }, { entity: 'owner', key: 'region', name: '大区', column: '大区', type: 'category' }] },
    { name: '订单', source: src.orders, mode: 'snapshot', entities: { transaction: { orderNo: '单号', customerId: '客户编号', date: '日期', amount: '金额', owner: '门店代码' } } },
    { name: '线索', source: src.leads, mode: 'snapshot', entities: { lead: { id: '线索号', date: '留资日期', owner: '门店代码', firstFollow: '首次跟进', lastFollow: '最近跟进', result: '结果', rep: '顾问' }, owner: { id: '门店代码' } } },
  ],
  identity: [{ keys: ['customer.id'], strength: 'strong' }],
  segments: [{ name: '买过', all: [{ feature: 'has_txn', op: '=', value: true }] }],
  flags: [
    { name: '已加微', kind: 'reach', all: [{ feature: 'field', args: ['extra.wechat'], op: '=', value: '已加' }] },
    { name: '接通过', kind: 'reach', all: [{ feature: 'field', args: ['extra.call'], op: '=', value: '接通' }] },
    { name: '买得多', all: [{ feature: 'txn_count', args: [365], op: '>=', value: 2 }] },
  ],
  leads: { minGroup: 5 },
  lists: { purposes: ['回访', '加微'], outcomes: [{ code: 'done', name: '成了', kind: 'success' }] },
})

describe('触达覆盖', () => {
  let dir, ds, id

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-reach-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '触达测试', preset: 'blank' }))
    const src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id
    src.orders = (await ds.importFile(id, '订单.csv', csv(ORDERS))).id
    src.leads = (await ds.importFile(id, '线索.csv', csv(LEADS))).id
    await ds.setAsOf(id, AS_OF)
    await ds.markChecked(id)
    const checked = checkSpec(spec(src))
    assert.deepEqual(checked.errors, [])
    const saved = await ds.saveSpecDraft(id, spec(src))
    assert.deepEqual(saved.trial.groups.flags.map(f => [f.name, f.count, f.kind]), [['已加微', 24, 'reach'], ['接通过', 20, 'reach'], ['买得多', 0, 'valuable']])
    await ds.finalizeSpec(id, saved.revision)
    assert.equal((await ds.build(id)).gate, 'ok')
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('整体：每个渠道多少人、多少人都没有、一个人有几个渠道', async () => {
    const r = await ds.reachBoard(id)
    assert.deepEqual(r.channels, ['已加微', '接通过'])
    assert.deepEqual(r.total.channels, { 已加微: { count: 24, pct: 40, missing: 36 }, 接通过: { count: 20, pct: 33.3, missing: 40 } })
    assert.deepEqual([r.total.any, r.total.none], [{ count: 36, pct: 60 }, { count: 24, pct: 40 }])
    assert.deepEqual(r.depth.map(d => [d.channels, d.count]), [[0, 24], [1, 28], [2, 8]])
  })

  it('按分层、按门店、按大区', async () => {
    const r = await ds.reachBoard(id, { by: 'extra.region' })
    const row = x => [x.key, x.customers, x.channels.已加微.pct, x.channels.接通过.pct, x.none.count]
    assert.deepEqual(r.segments.map(row), [['买过', 20, 100, 30, 0], ['其他', 40, 10, 35, 24]])
    assert.deepEqual(Object.fromEntries(r.owners.map(o => [o.key, [o.channels.已加微.count, o.channels.接通过.count, o.none.count]])), { 甲店: [5, 4, 5], 乙店: [5, 4, 4], 丙店: [5, 4, 5], 丁店: [5, 4, 5], 戊店: [4, 4, 5] })
    assert.deepEqual(r.groups.map(g => [g.key, g.owners, g.customers, g.channels.已加微.count, g.none.count]), [['北区', 3, 36, 15, 14], ['南区', 2, 24, 9, 10]])
    assert.equal(r.owners[0].attrs['extra.region'], '北区')
  })

  it('先看哪：都联系不上的人', async () => {
    const { highlights } = await ds.reachBoard(id)
    const none = highlights.find(x => x.id === 'none')
    assert.match(none.title, /24 位客户（40%）哪个渠道都联系不上/)
    assert.deepEqual(none.group, { without: ['已加微', '接通过'] })
  })

  it('缺口能圈人：客户页、名单、查询都认「没有某个标记」', async () => {
    assert.equal((await ds.customers(id, { without: ['已加微'] })).total, 36)
    assert.equal((await ds.customers(id, { without: ['已加微', '接通过'] })).total, 24)
    assert.equal((await ds.customers(id, { segment: '买过', without: '接通过' })).total, 14)
    await assert.rejects(ds.customers(id, { without: ['没有的标记'] }), /没有「没有的标记」这个标记。标记只能是：已加微、接通过、买得多/)
    const pool = await ds.listPool(id, { owner: '甲店', without: ['已加微'] })
    assert.deepEqual([pool.kept, pool.name, pool.purpose], [7, '加微 · 全部客户 · 没有已加微 · 甲店', '加微'])
    const q = async (kind, p) => (await ds.query(id, kind, p, { log: false })).result
    assert.equal((await q('metric', { metric: 'customers', without: ['已加微', '接通过'] })).value, 24)
    const rows = (await q('reach', { by: 'owner' })).rows
    assert.deepEqual([rows[0].已加微, rows[0].已加微Pct, rows[0].已加微Missing, rows[0].none, rows[0].small], [5, 41.7, 7, 5, true])
    assert.deepEqual((await q('reach', {})).rows.map(x => x.key), ['买过', '其他'])
    await assert.rejects(q('reach', { by: 'city' }), /by 只能是：segment（分层）、owner（归属方）、extra\.region（大区）/)
  })

  it('首页的发现里有一条：最广的渠道也没过半', async () => {
    const ov = await ds.overview(id)
    const hit = ov.insights.find(x => x.id === 'reach:已加微')
    assert.match(hit.title, /联系面最广的「已加微」也只覆盖了 40%，还差 36 人/)
    assert.deepEqual(hit.group, { without: ['已加微'] })
    assert.equal(ov.kinds.flags.已加微, 'reach')
  })

  it('没有标成触达渠道的标记：说怎么标', async () => {
    const other = (await ds.create({ name: '没标', preset: 'blank' })).id
    const src = {}
    src.customers = (await ds.importFile(other, '客户.csv', csv(CUSTOMERS))).id
    src.orders = (await ds.importFile(other, '订单.csv', csv(ORDERS))).id
    src.leads = (await ds.importFile(other, '线索.csv', csv(LEADS))).id
    await ds.setAsOf(other, AS_OF)
    await ds.markChecked(other)
    const s = spec(src)
    for (const f of s.flags) delete f.kind
    const saved = await ds.saveSpecDraft(other, s)
    await ds.finalizeSpec(other, saved.revision)
    await ds.build(other)
    const r = await ds.reachBoard(other)
    assert.deepEqual([r.on, r.candidates], [false, ['已加微', '接通过', '买得多']])
    await assert.rejects(ds.query(other, 'reach', {}, { log: false }), /就给它写 "kind": "reach".*现在的标记：已加微、接通过、买得多/)
  })

  it('每家一份简报：数是看板上的数，话是比出来的', async () => {
    const ctx = await ds.analysisContext(id)
    const made = ownerBriefs(ctx, { window: 90 })
    assert.deepEqual([made.label, made.by, made.briefs.length], ['门店', 'extra.region', 6])
    const of = name => made.briefs.find(b => b.owner === name).markdown
    const a = of('甲店')
    assert.match(a, /^# 甲店 · 经营简报\n\nD1 · 大区：北区\n/)
    assert.ok(a.includes('| 指标 | 这一家 | 全部门店 | 同大区（北区，3 家） |'))
    assert.ok(a.includes('| 客户数 | 12 | 60 | 36 |'))
    assert.ok(a.includes('| 成交率 | 50% | 12.8% | 20% |'))
    assert.ok(a.includes('成交率 50%，比全部门店的 12.8% 高 37.2 个点，在 6 家里排第 1。保持。'))
    assert.ok(a.includes('| 张三 | 8 | 100% | 75% | 0 |'))
    assert.ok(a.includes('## 联系得上多少人'))
    assert.ok(a.includes('| 已加微 | 5 | 41.7% | 40% | 7 |'))
    // 不是触达渠道的标记在「客户」那一节，触达渠道不重复列
    assert.ok(a.includes('| 买得多 | 0 | 0% | 0% |'))
    assert.equal(a.includes('客户1'), false)
    const b = of('乙店')
    assert.ok(b.includes('有 **12 条**线索等着跟：留资超过 2 天还没人跟的 12 条，超过 14 天没再联系的 0 条。先清这些。'))
    assert.ok(b.includes('首次跟进及时 **0%**，比全部门店的 74.5% 低 74.5 个点，在 6 家里排第 6。'))
    // 数一样的并列：五家成交率都是 0，不说谁排在谁前面
    assert.ok(b.includes('成交率 **0%**，比全部门店的 12.8% 低 12.8 个点，在 6 家里并列第 2。'))
    // 没写跟进人的那家不印「谁在跟」
    assert.equal(b.includes('## 谁在跟'), false)
    // 只有线索的那家：线索表里只写了代码，就按代码叫它；没有客户那几节
    assert.equal(of('D6').includes('## 客户'), false)
    assert.ok(of('D6').includes('| 赵六 | 5 | 100% | 0% | 0 |'))
  })

  it('打成一包：每家一个文件；要的话各附它待处理的线索；总部的话印在每一份上', async () => {
    const plain = await ds.exportOwnerBriefs(id, { window: 90 })
    assert.match(plain.name, /^经营简报-每个门店一份-2026-10-31-近90天\.zip$/)
    assert.deepEqual([plain.owners, plain.files, plain.leadFiles], [6, 6, 0])
    const full = await ds.exportOwnerBriefs(id, { window: 90, withLeads: true, note: '本周内把待处理的清完。', owners: ['甲店', '乙店', '丙店'] })
    // 甲店没有待处理的线索，只有简报
    assert.deepEqual([full.owners, full.files, full.leadFiles], [3, 5, 2])
    const bytes = readFileSync(full.file)
    assert.equal(bytes.readUInt16LE(bytes.length - 22 + 10), 5)
    for (const text of ['乙店/经营简报.docx', '乙店/待处理线索.xlsx', '本周内把待处理的清完。']) assert.ok(bytes.includes(Buffer.from(text)), text)
    assert.equal(bytes.includes(Buffer.from('甲店/待处理线索.xlsx')), false)
    await assert.rejects(ds.exportOwnerBriefs(id, { owners: ['不存在的店'] }), /没有可以出简报的门店/)
  })

  it('助手：切到触达页、看缺口里的人、按缺口出名单、放简报卡片', async () => {
    const tool = n => assistantTools(ds).find(t => t.name === n)
    assert.deepEqual((await tool('crm_show').execute({ dataset: id, page: 'reach', by: 'extra.region' })).view, { dataset: id, datasetName: '触达测试', page: 'reach', arg: { by: 'extra.region' }, label: '触达 · 按大区汇总' })
    const people = await tool('crm_show').execute({ dataset: id, page: 'people', segment: '买过', without: '接通过' })
    assert.deepEqual([people.view.arg, people.view.label], [{ segment: '买过', without: ['接通过'] }, '客户 · 买过 · 没有接通过'])
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'people', without: '乱写' })).error, /without 只能是：已加微、接通过、买得多/)
    const list = await tool('crm_propose_list').execute({ dataset: id, without: ['已加微'], owner: '甲店', perOwner: false, reason: '补企微' })
    assert.deepEqual([list.list.kept, list.list.without, list.list.purpose], [7, ['已加微'], '加微'])
    const card = await tool('crm_propose_export').execute({ dataset: id, kind: 'briefs', owners: ['甲店', '乙店'], withLeads: true })
    assert.deepEqual([card.export.total, card.export.owners, card.export.withLeads, card.export.label], [2, ['甲店', '乙店'], true, '门店经营简报 · 近 90 天 · 甲店、乙店'])
    assert.equal((await tool('crm_propose_export').execute({ dataset: id, kind: 'briefs' })).export.total, 6)
    assert.match((await tool('crm_propose_export').execute({ dataset: id, kind: 'briefs', owners: ['没有的店'] })).error, /没有这几家：没有的店/)
    const status = await tool('crm_status').execute({ dataset: id }, {})
    assert.deepEqual(status.query.reachChannels, ['已加微', '接通过'])
  })
})

describe('压缩包', () => {
  it('中文文件名：标成 UTF-8、按 Unix 写的，命令行解压也不会变成问号；日期是导出那天', async () => {
    const { zip } = await import('../lib/core/docx.js')
    const bytes = zip({ '甲店/经营简报.docx': 'a', '乙店.xlsx': Buffer.from('b') }, { date: '2026-11-02' })
    const end = bytes.length - 22
    assert.equal(bytes.readUInt16LE(end + 10), 2)
    const cen = bytes.readUInt32LE(end + 16)
    assert.equal(bytes.readUInt32LE(cen), 0x02014b50)
    // 写它的系统：高字节 3 = Unix；文件名用 UTF-8（第 11 位）；权限 rw-r--r--
    assert.deepEqual([bytes.readUInt16LE(cen + 4) >> 8, bytes.readUInt16LE(cen + 8) & 0x0800, (bytes.readUInt32LE(cen + 38) >>> 16).toString(8)], [3, 0x0800, '100644'])
    const date = bytes.readUInt16LE(cen + 14)
    assert.deepEqual([(date >> 9) + 1980, (date >> 5) & 15, date & 31, bytes.readUInt16LE(cen + 12) >> 11], [2026, 11, 2, 12])
    assert.equal(bytes.subarray(cen + 46, cen + 46 + bytes.readUInt16LE(cen + 28)).toString('utf8'), '甲店/经营简报.docx')
    // 不给日期的（Word、Excel 文件自己里面那一层）照旧
    const plain = zip({ 'a.txt': 'a' })
    assert.equal(plain.readUInt16LE(plain.readUInt32LE(plain.length - 22 + 16) + 14), 0x21)
  })
})
