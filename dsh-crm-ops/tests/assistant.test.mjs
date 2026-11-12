// 对话栏里的一个助手：配置和分析的工具都在，crm_status 只有一个；在对话里点完定稿、确认截止日，
// 页面接着清洗（advance）；助手能放「运行清洗」「先这样用」的卡片，但只在说得通的时候。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { Datasets } from '../lib/core/store.js'
import { assistantTools, SECTION } from '../lib/host/assistant.js'
import { checkAction } from '../lib/host/config.js'
import { ASSISTANT_PRESET, dispatch } from '../lib/host/index.js'

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'))
const CUSTOMERS = [['客户编号', '姓名', '手机'], ...Array.from({ length: 20 }, (_, i) => [`C${i + 1}`, `客户${i + 1}`, `138000000${String(i + 1).padStart(2, '0')}`])]
const DEALS = [['单号', '客户编号', '日期', '类型'], ...Array.from({ length: 12 }, (_, i) => [`D${i + 1}`, `C${i + 1}`, '2026-09-01', '购买'])]
const spec = src => ({
  tables: [
    { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', phone: '手机' } } },
    { name: '成交', source: src.deals, mode: 'append', entities: { transaction: { orderNo: '单号', customerId: '客户编号', date: '日期', type: '类型' } } },
  ],
  dictionaries: { 'transaction.type': { 购买: [] } },
  identity: [{ keys: ['customer.id'], strength: 'strong' }],
  segments: [{ name: '买过', all: [{ feature: 'has_txn', op: '=', value: true }] }],
  flags: [],
  lists: { purposes: ['回访'], outcomes: [{ code: 'done', name: '成了', kind: 'success' }] },
})

describe('对话栏里的助手', () => {
  let dir, ds, id, src, tools, call

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-assistant-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '助手测试', preset: 'blank' }))
    src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id
    src.deals = (await ds.importFile(id, '成交.csv', csv(DEALS))).id
    tools = assistantTools(ds)
    const workspaces = []
    const deps = { datasets: ds, rev: () => 0, workspace: async (path, title) => { workspaces.push({ path, title }); return { id: `ws${workspaces.length}` } }, sessionsDir: join(dir, '会话') }
    call = payload => dispatch(deps, payload)
    call.workspaces = workspaces
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('两边的工具都在，名字不重复，crm_status 只有一个', () => {
    const names = tools.map(t => t.name)
    assert.equal(new Set(names).size, names.length)
    for (const n of ['crm_status', 'crm_profile', 'crm_get_spec', 'crm_get_preset', 'crm_draft_spec', 'crm_propose_action', 'crm_query', 'crm_save_report_draft', 'crm_propose_list', 'crm_propose_rule']) assert.ok(names.includes(n), `少了 ${n}`)
    assert.match(SECTION, /crm-config/)
    assert.match(SECTION, /crm-analyst/)
  })

  it('数据还没准备好：crm_status 带表间关联，不带查询词表', async () => {
    const st = await tools[0].execute({ dataset: id })
    assert.equal(st.step, 'check')
    assert.ok(Array.isArray(st.links))
    assert.equal(st.query, undefined)
  })

  it('一个数据集一段对话：工作区的文件夹以数据集编号开头', async () => {
    const r = await call({ action: 'openSession', id, ask: '' })
    assert.equal(r.preset, ASSISTANT_PRESET)
    assert.equal(call.workspaces.at(-1).path.split('/').pop(), `${id}-助手`)
    assert.match(r.prompt, new RegExp(`^数据集 ${id}`))
    assert.match(r.fallback, /准备好/)
  })

  it('没定稿、没确认截止日时，助手放不出「运行清洗」的卡片', async () => {
    await assert.rejects(checkAction(ds, { dataset: id, kind: 'build', reason: '跑一遍' }), /配置还没定稿/)
    await assert.rejects(checkAction(ds, { dataset: id, kind: 'ack', reason: '先用' }), /没有等用户确认的数据问题/)
  })

  it('在对话里点完定稿和截止日，页面接着清洗：谁后点谁触发', async () => {
    assert.deepEqual(await call({ action: 'advance', id }), { built: null, step: 'check', waiting: 'spec' })
    const saved = await ds.saveSpecDraft(id, spec(src))
    await ds.finalizeSpec(id, saved.revision)
    const waiting = await call({ action: 'advance', id })
    assert.equal(waiting.built, null)
    assert.equal(waiting.waiting, 'asof')
    await assert.rejects(checkAction(ds, { dataset: id, kind: 'build', reason: '跑一遍' }), /截止日还没确认/)
    await ds.setAsOf(id, '2026-10-31')
    const done = await call({ action: 'advance', id })
    assert.equal(done.built.version, 1)
    assert.equal(done.built.counts.customers, 20)
    assert.equal(done.step, 'ready')
    // 再点一次不会重复清洗
    assert.equal((await call({ action: 'advance', id })).built, null)
  })

  it('准备好以后：crm_status 带查询词表，不再带表间关联；能放重新清洗的卡片', async () => {
    const st = await tools[0].execute({ dataset: id })
    assert.equal(st.step, 'ready')
    assert.equal(st.links, undefined)
    assert.ok(st.query.metrics.txn_count)
    assert.deepEqual(st.segments.map(s => s.name), ['买过'])
    const card = await checkAction(ds, { dataset: id, kind: 'build', reason: '配置改了' })
    assert.equal(card.version, 1)
    assert.equal(card.stale, false)
  })

  it('新一期的表拖进来：自己归到配置里的表，状态回到「该清洗了」，清洗后是新的一版', async () => {
    const more = [DEALS[0], ['D13', 'C13', '2026-10-20', '购买'], ['D14', 'C14', '2026-10-21', '购买']]
    const imported = await call({ action: 'importFile', id, name: '成交-10月.csv', base64: csv(more).toString('base64') })
    assert.equal(imported.asOfLater, undefined) // 都在截止日之内
    const st = await ds.status(id)
    assert.equal(st.step, 'build')
    const done = await call({ action: 'advance', id })
    assert.equal(done.built.version, 2)
    assert.equal(done.built.counts.transactions, 14)
  })

  it('新表的日期晚于确认过的截止日：导入时说出来，截止日不自己动', async () => {
    const next = [DEALS[0], ['D15', 'C15', '2026-11-01', '购买']]
    const imported = await call({ action: 'importFile', id, name: '成交-11月.csv', base64: csv(next).toString('base64') })
    assert.equal(imported.asOfLater, '2026-11-01')
    assert.equal((await ds.status(id)).asOf, '2026-10-31')
    // 不改截止日就清洗：新的一笔在截止日之后，不计入
    const stale = await call({ action: 'advance', id })
    const before = (await ds.query(id, 'metric', { metric: 'txn_count', window: 3650 }, { log: false })).result.value
    assert.equal(stale.built.version, 3)
    assert.equal(before, 14)
    await ds.setAsOf(id, imported.asOfLater)
    const moved = await call({ action: 'advance', id })
    assert.equal(moved.built.version, 4)
    assert.equal((await ds.query(id, 'metric', { metric: 'txn_count', window: 3650 }, { log: false })).result.value, 15)
  })
})

describe('对话带着看板走，导出也在对话里', () => {
  let dir, ds, id, tools
  const tool = name => tools.find(t => t.name === name)
  const LEADS = [['线索编号', '留资时间', '渠道', '门店', '级别', '首次跟进'],
    ...Array.from({ length: 12 }, (_, i) => [`L${i + 1}`, `2026-10-${String(10 + i).padStart(2, '0')}`, i % 2 ? '抖音' : '到店', i % 3 ? '甲店' : '乙店', i < 2 ? '赢单' : '冷', i < 6 ? `2026-10-${String(11 + i).padStart(2, '0')}` : ''])]

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-board-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '看板测试', preset: 'blank' }))
    const src = { customers: (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id, deals: (await ds.importFile(id, '成交.csv', csv(DEALS))).id }
    const leads = (await ds.importFile(id, '线索.csv', csv(LEADS))).id
    tools = assistantTools(ds)
    // 数据还没准备好：要数据的页打不开，数据源页可以
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'people' })).error, /数据还没准备好/)
    assert.equal((await tool('crm_show').execute({ dataset: id, page: 'sources' })).view.page, 'sources')
    const s = spec(src)
    s.tables.push({ name: '线索', source: leads, mode: 'snapshot', entities: { lead: { id: '线索编号', date: '留资时间', channel: '渠道', owner: '门店', result: '级别', level: '级别', firstFollow: '首次跟进' } } })
    s.flags = [{ name: '老客', all: [{ feature: 'txn_count', args: [3650], op: '>=', value: 1 }] }]
    await ds.setAsOf(id, '2026-10-31')
    await ds.markChecked(id)
    const saved = await ds.saveSpecDraft(id, s)
    await ds.finalizeSpec(id, saved.revision)
    await ds.build(id)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('把左边切到客户页的一批人：分层、标记要是配置里有的', async () => {
    const ok = await tool('crm_show').execute({ dataset: id, page: 'people', segment: '买过', flag: '老客' })
    assert.deepEqual(ok.view, { dataset: id, datasetName: '看板测试', page: 'people', arg: { segment: '买过', flag: '老客' }, label: '客户 · 买过 · 老客' })
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'people', segment: '高价值' })).error, /分层只能是：买过、其他/)
    assert.equal((await tool('crm_show').execute({ dataset: id, page: 'analysis' })).view.arg, null)
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'dashboard' })).error, /page 只能是/)
  })

  it('把左边切到线索页的一批线索：状态、筛选、时间段、按什么拆', async () => {
    const r = await tool('crm_show').execute({ dataset: id, page: 'leads', state: '待处理', lead: { owner: '甲店' }, window: 90, by: 'channel' })
    assert.deepEqual(r.view.arg, { state: '待处理', filter: { owner: ['甲店'] }, window: 90, by: 'channel' })
    assert.equal(r.view.label, '线索 · 待处理 · 归属方：甲店 · 近 90 天进来的')
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'leads', state: '很急' })).error, /state 只能是：待处理/)
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'leads', by: 'color' })).error, /by 只能是/)
    assert.match((await tool('crm_show').execute({ dataset: id, page: 'report', name: '没有的报告' })).error, /没有这份报告/)
  })

  it('导出卡片：说清多少条线索、几个归属方；筛不出来、报告没定稿都放不出卡片', async () => {
    const all = await tool('crm_propose_export').execute({ dataset: id, kind: 'leads', reason: '发给两家店' })
    assert.equal(all.export.total, 12)
    assert.equal(all.export.owners, 2)
    const todo = await tool('crm_propose_export').execute({ dataset: id, kind: 'leads', state: '待处理', lead: { owner: '甲店' } })
    assert.deepEqual(todo.export.state, ['首跟超时', '跟进断了'])
    assert.equal(todo.export.owners, 1)
    assert.ok(todo.export.total > 0 && todo.export.total < 12)
    // 卡片上圈定的这批，和真的导出来的是同一批
    const out = await ds.exportLeads(id, { state: todo.export.state, lead: todo.export.lead, split: 'owner' })
    assert.equal(out.rows, todo.export.total)
    assert.match((await tool('crm_propose_export').execute({ dataset: id, kind: 'leads', lead: { owner: '丙店' } })).error, /没有线索/)
    assert.match((await tool('crm_propose_export').execute({ dataset: id, kind: 'report', name: '周报' })).error, /没有这份报告/)
  })

  it('复核、飞书导入的卡片只在说得通的时候放得出来', async () => {
    await assert.rejects(checkAction(ds, { dataset: id, kind: 'review', reason: '看看' }), /没有等用户复核/)
    await assert.rejects(checkAction(ds, { dataset: id, kind: 'import-feishu', value: '我的表', reason: '导入' }), /链接/)
    const card = await checkAction(ds, { dataset: id, kind: 'import-feishu', value: 'https://example.feishu.cn/base/abc', reason: '用户贴了链接' })
    assert.equal(card.value, 'https://example.feishu.cn/base/abc')
  })
})
