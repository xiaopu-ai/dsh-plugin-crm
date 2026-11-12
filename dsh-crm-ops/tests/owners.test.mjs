// 归属方（门店、经销商）：
// 1. 同一家在几张表里写法不一样（简称、全称、「代码 全称」）时，按代码认成一家；没对上时试跑和看板会说；
// 2. 看板每家一行：客户数、这段时间的交易和线索、跟进和成交、待处理、每个标记多少人；能按大区汇总，能只看一家；
// 3. 发下去：线索和名单都能每家一个文件（压缩包），每家只拿到自己的。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { mergeOwners } from '../lib/core/pipeline.js'
import { readFileBytes } from '../lib/core/read.js'
import { checkSpec, ownerAttributes } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'
import { assistantTools } from '../lib/host/assistant.js'

const AS_OF = '2026-10-31'
const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// 六家门店：代码、简称、公司全称、大区。第六家只有线索，客户表里没有它。
const SHOPS = [['D1', '甲店', '甲店贸易有限公司', '北区'], ['D2', '乙店', '乙店贸易有限公司', '北区'], ['D3', '丙店', '丙店贸易有限公司', '北区'], ['D4', '丁店', '丁店贸易有限公司', '南区'], ['D5', '戊店', '戊店贸易有限公司', '南区'], ['D6', '己店', '己店贸易有限公司', '南区']]
const shopOf = n => SHOPS[(n - 1) % 5]
// 60 位客户，五家各 12 位；客户表写简称。前 30 位加了企微。
const CUSTOMERS = [['客户编号', '姓名', '门店代码', '门店', '大区', '加微'], ...range(1, 60).map(n => [`C${n}`, `客户${n}`, shopOf(n)[0], shopOf(n)[1], shopOf(n)[3], n <= 30 ? '已加' : '未加'])]
// 20 笔订单，五家各 4 笔；订单表写「代码 全称」。
const ORDERS = [['单号', '客户编号', '日期', '金额', '门店'], ...range(1, 20).map(n => [`O${n}`, `C${n}`, '2026-10-01', '100.00', `${shopOf(n)[0]} ${shopOf(n)[2]}`])]
// 线索表也写「代码 全称」。甲店 12 条跟得及时、成交一半；乙店 12 条没人跟；丙丁戊各 6 条跟了一次就断了；己店 5 条在跟。
const lead = (i, shop, first, last, result) => [`L${i}`, '2026-10-10', `${shop[0]} ${shop[2]}`, first, last, result]
let li = 0
const LEADS = [['线索号', '留资日期', '所属门店', '首次跟进', '最近跟进', '结果'],
  ...range(1, 12).map(k => lead(++li, SHOPS[0], '2026-10-10', '2026-10-25', k <= 6 ? '成交' : '跟进中')),
  ...range(1, 12).map(() => lead(++li, SHOPS[1], '', '', '跟进中')),
  ...[2, 3, 4].flatMap(s => range(1, 6).map(() => lead(++li, SHOPS[s], '2026-10-10', '2026-10-12', '跟进中'))),
  ...range(1, 5).map(() => lead(++li, SHOPS[5], '2026-10-10', '2026-10-25', '跟进中'))]

const part = (column, n) => ({ column, split: ' ', part: n })
// 没对上的写法：客户写简称，订单和线索写全称。
const apart = src => ({
  labels: { owner: '门店' },
  tables: [
    { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', owner: '门店' } }, extra: [{ entity: 'customer', key: 'wechat', name: '加微', column: '加微', type: 'category' }] },
    { name: '订单', source: src.orders, mode: 'snapshot', entities: { transaction: { orderNo: '单号', customerId: '客户编号', date: '日期', amount: '金额', owner: part('门店', -1) } } },
    { name: '线索', source: src.leads, mode: 'snapshot', entities: { lead: { id: '线索号', date: '留资日期', owner: part('所属门店', -1), firstFollow: '首次跟进', lastFollow: '最近跟进', result: '结果' } } },
  ],
  identity: [{ keys: ['customer.id'], strength: 'strong' }],
  segments: [{ name: '买过', all: [{ feature: 'has_txn', op: '=', value: true }] }],
  flags: [{ name: '已加微', all: [{ feature: 'field', args: ['extra.wechat'], op: '=', value: '已加' }] }],
  leads: { minGroup: 5 },
  lists: { purposes: ['回访'], outcomes: [{ code: 'done', name: '成了', kind: 'success' }] },
})
// 对上的写法：三张表都把门店的代码和名称喂给 owner，客户表带上大区。
const joined = src => {
  const s = apart(src)
  s.tables[0].entities.owner = { id: '门店代码', name: '门店' }
  s.tables[0].extra.push({ entity: 'owner', key: 'region', name: '大区', column: '大区', type: 'category' })
  s.tables[1].entities.transaction.owner = part('门店', 1)
  s.tables[2].entities.owner = { id: part('所属门店', 1), name: part('所属门店', -1) }
  return s
}
/** How many files a stored zip holds (end-of-central-directory record). */
const zipEntries = buf => buf.readUInt16LE(buf.length - 22 + 10)

describe('认成同一家', () => {
  it('同一个代码是一家；名字用最前面那张表的，别的写法是别名；属性取出现最多的', () => {
    const { owners, resolve } = mergeOwners([
      { id: 'D1', name: '甲店贸易有限公司', type: null, city: null, extra: { dsm: '张' }, table: 2 },
      { id: 'D1', name: '甲店', type: null, city: null, extra: { region: '北区' }, table: 0 },
      { id: 'D1', name: '甲店', type: null, city: null, extra: { region: '北区' }, table: 0 },
      { id: 'd1', name: '甲店', type: null, city: null, extra: { region: '南区' }, table: 0 },
      { id: null, name: '甲店贸易有限公司', type: '直营', city: null, extra: {}, table: 3 },
      { id: null, name: '路边摊', type: null, city: null, extra: {}, table: 3 },
      // 有的表只有代码那一列，被写成了名称：还是那一家，代码不当名字用
      { id: null, name: 'D1', type: null, city: null, extra: {}, table: 1 },
    ])
    assert.deepEqual(owners.map(o => o.name), ['甲店', '路边摊'])
    const a = owners[0]
    assert.deepEqual([a.id, a.type, a.extra.region, a.extra.dsm], ['D1', '直营', '北区', '张'])
    assert.deepEqual(a.aliases, ['甲店贸易有限公司', 'D1'])
    assert.deepEqual(['D1', ' 甲店贸易有限公司 ', '甲店', '路边摊', '不认识', null].map(resolve), ['甲店', '甲店', '甲店', '路边摊', '不认识', null])
  })

  it('配置：owner 可以只给编号；属性写成 entity 为 owner 的自定义字段', () => {
    const s = joined({ customers: 'aaaaaaaa', orders: 'bbbbbbbb', leads: 'cccccccc' })
    const checked = checkSpec(s)
    assert.deepEqual(checked.errors, [])
    assert.deepEqual(ownerAttributes(checked.spec), { 'extra.region': '大区' })
    s.tables[1].entities.owner = { id: part('门店', 1) }
    assert.deepEqual(checkSpec(s).errors, [])
  })
})

describe('在一份数据上跑', () => {
  let dir, ds, id, src

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-owners-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '门店测试', preset: 'blank' }))
    src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id
    src.orders = (await ds.importFile(id, '订单.csv', csv(ORDERS))).id
    src.leads = (await ds.importFile(id, '线索.csv', csv(LEADS))).id
    await ds.setAsOf(id, AS_OF)
    await ds.markChecked(id)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('写法没对上：试跑提醒，看板也说，每家的数是散的', async () => {
    const saved = await ds.saveSpecDraft(id, apart(src))
    const hint = saved.trial.hints.find(x => /名字对得上的只有 0 个/.test(x))
    assert.match(hint, /客户上写的门店有 5 个，交易上有 5 个.*给这几张表都喂上 owner/)
    await ds.finalizeSpec(id, saved.revision)
    await ds.build(id)
    const b = await ds.ownerBoard(id, {})
    assert.equal(b.rows.length, 11)
    assert.deepEqual(b.apart.map(x => [x.a, x.b, x.shared]), [['customer', 'transaction', 0], ['customer', 'lead', 0]])
    const short = b.rows.find(r => r.key === '甲店')
    assert.deepEqual([short.customers, short.txns, short.leads], [12, 0, 0])
  })

  it('对上以后：六家各一行，客户、订单、线索都在自己那一行', async () => {
    const saved = await ds.saveSpecDraft(id, joined(src))
    assert.equal(saved.trial.hints.some(x => /名字对得上/.test(x)), false)
    assert.equal(saved.trial.counts.owners, 6)
    await ds.finalizeSpec(id, saved.revision)
    assert.equal((await ds.build(id)).gate, 'ok')
    const b = await ds.ownerBoard(id, { window: 90 })
    assert.deepEqual(b.apart, [])
    assert.equal(b.label, '门店')
    assert.deepEqual(b.attributes, { 'extra.region': '大区' })
    const pick = r => [r.key, r.attrs['extra.region'], r.customers, r.txns, r.amount, r.leads, r.followPct, r.winPct, r.todo, r.flags.已加微.count, r.flags.已加微.pct]
    assert.deepEqual(b.rows.map(pick).sort((x, y) => SHOPS.findIndex(sh => x[0].startsWith(sh[1])) - SHOPS.findIndex(sh => y[0].startsWith(sh[1]))), [
      ['甲店', '北区', 12, 4, 400, 12, 100, 50, 0, 6, 50],
      ['乙店', '北区', 12, 4, 400, 12, 0, 0, 12, 6, 50],
      ['丙店', '北区', 12, 4, 400, 6, 100, 0, 6, 6, 50],
      ['丁店', '南区', 12, 4, 400, 6, 100, 0, 6, 6, 50],
      ['戊店', '南区', 12, 4, 400, 6, 100, 0, 6, 6, 50],
      // 客户表里没有它：名字只能用线索表里的全称，大区也没处来
      ['己店贸易有限公司', '（没填）', 0, 0, 0, 5, 100, 0, 0, 0, null],
    ])
    // 客户多的在前；客户表里没有的那家排最后
    assert.equal(b.rows.at(-1).key, '己店贸易有限公司')
    assert.deepEqual([b.total.customers, b.total.txns, b.total.leads, b.total.todo, b.total.flags.已加微.count], [60, 20, 47, 30, 30])
    assert.deepEqual(b.columns.map(c => c.key), ['customers', 'newCustomers', 'txns', 'buyers', 'amount', 'leads', 'followPct', 'onTimePct', 'medianHours', 'winPct', 'todo', 'flag:已加微'])
  })

  it('先看哪几家：压得最多的、成交高低', async () => {
    const b = await ds.ownerBoard(id, { window: 90 })
    const todo = b.highlights.find(x => x.id === 'todo')
    assert.deepEqual(todo.owners, ['乙店', '丙店', '丁店'])
    assert.match(todo.title, /待处理的线索最多的：乙店 12 条/)
    assert.match(todo.detail, /占全部 30 条的 80%/)
    const win = b.highlights.find(x => x.id === 'win')
    assert.match(win.title, /成交率高的：甲店 50%/)
  })

  it('按大区汇总；只看一家', async () => {
    const b = await ds.ownerBoard(id, { window: 90, by: 'extra.region' })
    assert.deepEqual(b.groups.map(g => [g.key, g.owners, g.customers, g.txns, g.leads, g.todo, g.winPct]), [['北区', 3, 36, 12, 30, 18, 20], ['南区', 2, 24, 8, 12, 12, 0], ['（没填）', 1, 0, 0, 5, 0, 0]])
    const d = await ds.ownerDetail(id, '甲店', { window: 90 })
    assert.deepEqual([d.id, d.aliases], ['D1', ['甲店贸易有限公司', 'D1']])
    assert.deepEqual(d.attrs, [{ key: 'extra.region', name: '大区', value: '北区' }])
    assert.deepEqual(d.states.filter(x => x.count).map(x => [x.name, x.count]), [['跟进中', 6], ['成交', 6]])
    await assert.rejects(ds.ownerDetail(id, '不存在的店'), /没有叫「不存在的店」的门店/)
  })

  it('助手查得到：排序、汇总、单家；参数不对有说法', async () => {
    const q = async p => (await ds.query(id, 'owner_board', p, { log: false })).result
    const worst = await q({ sort: 'todo', limit: 2 })
    assert.deepEqual(worst.rows.map(r => [r.key, r.todo, r.已加微, r.已加微Pct]), [['乙店', 12, 6, 50], ['丙店', 6, 6, 50]])
    assert.deepEqual(worst.rest, { groups: 4 })
    assert.equal(worst.owners, 6)
    assert.deepEqual((await q({ by: 'extra.region' })).rows.map(r => r.key), ['北区', '南区', '（没填）'])
    assert.equal((await q({ owner: '乙店' })).row.todo, 12)
    await assert.rejects(q({ by: 'city' }), /by 只能是：extra\.region（大区）/)
    await assert.rejects(q({ sort: 'profit' }), /sort 只能是/)
    await assert.rejects(q({ owner: '乙店贸易' }), /没有叫「乙店贸易」的归属方/)
  })

  it('助手能把左边切到这一页，也能放导出卡片', async () => {
    const tool = n => assistantTools(ds).find(t => t.name === n)
    const shown = await tool('crm_show').execute({ dataset: id, page: 'owners', by: 'extra.region', owner: '乙店', window: 30 })
    assert.deepEqual(shown.view, { dataset: id, datasetName: '门店测试', page: 'owners', arg: { by: 'extra.region', window: 30, owner: '乙店' }, label: '门店 · 按大区汇总 · 近 30 天 · 乙店' })
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'owners', owner: '没有的店' })).error, /没有叫「没有的店」的门店/)
    const card = await tool('crm_propose_export').execute({ dataset: id, kind: 'owners', by: 'extra.region' })
    assert.deepEqual([card.export.total, card.export.label], [6, '门店对比 · 近 90 天 · 按大区汇总'])
    const leads = await tool('crm_propose_export').execute({ dataset: id, kind: 'leads', state: '待处理', perOwner: true })
    assert.deepEqual([leads.export.total, leads.export.owners, leads.export.perOwner], [30, 4, true])
    assert.match(leads.note, /每家一个文件/)
    const list = await tool('crm_propose_list').execute({ dataset: id, flag: '已加微', perOwner: true, reason: '回访' })
    assert.deepEqual([list.list.kept, list.list.owners, list.list.perOwner], [30, 5, true])
  })

  it('发下去：对比表一张；线索和名单每家一个文件', async () => {
    const board = await ds.exportOwnerBoard(id, { window: 90, by: 'extra.region' })
    const book = readFileBytes('对比.xlsx', new Uint8Array(readFileSync(board.file)))
    assert.deepEqual(book.sheets.map(s => s.name), ['门店', '按大区', '说明'])
    assert.deepEqual(book.sheets[0].rows[0].slice(0, 5), ['门店', '编号', '大区', '客户数', '新客户'])
    assert.deepEqual(book.sheets[0].rows[1].slice(0, 4), ['甲店', 'D1', '北区', '12'])
    assert.equal(book.sheets[0].rows.at(-1)[0], '合计')
    assert.deepEqual(book.sheets[1].rows[1].slice(0, 3), ['北区', '3', '36'])

    const todo = await ds.exportLeads(id, { state: ['首跟超时', '跟进断了'], split: 'files' })
    assert.match(todo.name, /每个门店一份\.zip$/)
    assert.deepEqual([todo.rows, todo.files], [30, 4])
    assert.equal(zipEntries(readFileSync(todo.file)), 4)
    // 同一个文件里一家一张表的老办法还在
    const one = await ds.exportLeads(id, { state: ['首跟超时', '跟进断了'] })
    assert.deepEqual(readFileBytes('线索.xlsx', new Uint8Array(readFileSync(one.file))).sheets.map(s => s.name), ['乙店', '丙店', '丁店', '戊店', '说明'])

    const made = await ds.createBatch(id, { pick: { flag: '已加微' }, purpose: '回访', to: 'excel', split: 'owner' })
    assert.match(made.exported.name, /每个门店一份\.zip$/)
    assert.equal(made.exported.files, 5)
    assert.equal(zipEntries(readFileSync(made.exported.file)), 5)
    const again = await ds.exportBatch(id, made.id, {})
    assert.match(again.name, /\.xlsx$/)
    const rows = readFileBytes('名单.xlsx', new Uint8Array(readFileSync(again.file))).sheets[0].rows
    assert.equal(rows.length, 31)
    assert.equal(rows[0].includes('门店'), true)
  })

  it('把代码当成了名字：试跑提醒该写到 id', async () => {
    const s = joined(src)
    s.tables[0].entities.owner = { name: '门店代码' }
    s.tables[0].entities.customer.owner = '门店代码'
    s.tables[2].entities.owner = { name: part('所属门店', 1) }
    s.tables[2].entities.lead.owner = part('所属门店', 1)
    const { hints } = (await ds.saveSpecDraft(id, s)).trial
    assert.match(hints.find(x => /拿代码当名字/.test(x)), /「D1」这样.*代码写到 "id"，名称（简称）写到 "name"/)
  })
})
