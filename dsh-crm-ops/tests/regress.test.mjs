// 全流程回归里发现的几处，各留一条测试：
// 1. 交草案时插件自己比出「和上一份比改了什么」，AI 重写时悄悄丢掉的东西会被点出来；
// 2. 报告：百分号不重复、引用能用中文的键、「3～12 个月」「9、10 月」这样的写法不算没出处、正文自带的大标题不重复；
// 3. 「今天」按本地日期算，不按 UTC；
// 4. 待处理线索的导出文件名叫「待处理」；压缩包里的启动文件留着可执行位。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { zip } from '../lib/core/docx.js'
import { allowedNumbers, checkNumbers, render, renderMarked, resolveRefs } from '../lib/core/report.js'
import { checkSpec, diffSpec } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'
import { configTools } from '../lib/host/config.js'

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'))
const CUSTOMERS = [['客户编号', '姓名', '门店', '类别', '重复'], ['C1', '甲', '东店', '个人', ''], ['C2', '乙', '东店', '个人', '重复'], ['C3', '丙', '西店', '公司', ''], ['C4', '丁', '西店', '个人', '']]
const ORDERS = [['单号', '客户编号', '日期', '金额'], ['O1', 'C1', '2026-10-01', '100'], ['O2', 'C2', '2026-10-02', '100'], ['O3', 'C3', '2026-10-03', '100']]
const LEADS = [['线索号', '留资日期', '门店', '首次跟进', '最近跟进', '结果'], ['L1', '2026-10-20', '东店', '', '', ''], ['L2', '2026-10-01', '东店', '2026-10-01', '2026-10-02', ''], ['L3', '2026-10-10', '西店', '2026-10-10', '2026-10-28', '成交']]

const spec = src => ({
  labels: { owner: '门店' },
  tables: [
    { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', owner: '门店' } }, extra: [{ entity: 'customer', key: 'type', name: '类别', column: '类别', type: 'category' }] },
    { name: '订单', source: src.orders, mode: 'snapshot', entities: { transaction: { orderNo: '单号', customerId: '客户编号', date: '日期', amount: '金额' } } },
    { name: '线索', source: src.leads, mode: 'snapshot', entities: { lead: { id: '线索号', date: '留资日期', owner: '门店', firstFollow: '首次跟进', lastFollow: '最近跟进', result: '结果' } } },
  ],
  identity: [{ keys: ['customer.id'], strength: 'strong' }],
  segments: [{ name: '买过 3～12 个月', kind: 'lifecycle', any: [{ feature: 'days_since_last_txn', op: 'between', value: [91, 365] }] }, { name: '买过', all: [{ feature: 'has_txn', op: '=', value: true }] }],
  flags: [{ name: '公司客户', all: [{ feature: 'field', args: ['extra.type'], op: '=', value: '公司' }] }],
  lists: { purposes: ['回访'], outcomes: [{ code: 'done', name: '成了', kind: 'success' }] },
})

describe('草案和它要替换的配置比，改了什么', () => {
  let dir, ds, id, src

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-regress-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '回归', preset: 'blank' }))
    src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id
    src.orders = (await ds.importFile(id, '订单.csv', csv(ORDERS))).id
    src.leads = (await ds.importFile(id, '线索.csv', csv(LEADS))).id
    await ds.setAsOf(id, '2026-10-31')
    await ds.markChecked(id)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('写法换了顺序不算改；丢了一列、多了一条规则、多了一条行过滤都说得出来', () => {
    const a = checkSpec(spec(src)).spec
    const same = structuredClone(a)
    same.segments[0] = { any: [{ value: [91, 365], op: 'between', feature: 'days_since_last_txn', args: [] }], kind: 'lifecycle', name: '买过 3～12 个月' }
    assert.deepEqual(diffSpec(a, checkSpec(same).spec), [])
    const b = structuredClone(a)
    delete b.tables[2].entities.lead.result
    b.tables[0].skipRows = [{ column: '重复', when: 'in', values: ['重复'], why: '重复建档' }]
    b.flags.push({ name: '东店的', all: [{ feature: 'field', args: ['owner'], op: '=', value: '东店' }] })
    b.segments = [b.segments[1], b.segments[0]]
    b.notes = '只改了说明的不算'
    const lines = diffSpec(a, checkSpec(b).spec)
    // 去掉的排最前
    assert.deepEqual(lines.map(x => x.kind), ['drop', 'change', 'add', 'add'])
    assert.equal(lines[0].text, '「线索」表：线索的「结果」不再对任何列（原来对的是「结果」）')
    assert.match(lines[1].text, /分层的先后顺序变了/)
    assert.equal(lines[2].text, '「客户」表：这些行不读了：「重复」是 重复（重复建档）')
    assert.match(lines[3].text, /^新加标记「东店的」：/)
  })

  it('第一稿没有可比的；之后每一稿都带着和第一稿、和上一稿的差别，丢了东西会提醒', async () => {
    const tool = configTools(ds).find(t => t.name === 'crm_draft_spec')
    const first = await tool.execute({ dataset: id, spec: spec(src), changes: '第一稿' }, {})
    assert.equal(first.ok, true)
    assert.equal(first.diff, undefined)
    const s2 = spec(src)
    delete s2.tables[2].entities.lead.result
    s2.flags.push({ name: '东店的', all: [{ feature: 'field', args: ['owner'], op: '=', value: '东店' }] })
    const second = await tool.execute({ dataset: id, spec: s2, changes: '加了一个标记，其余不变' }, {})
    assert.equal(second.diff.against, '第 1 稿')
    // 结果那一列不对了，它的取值归类也跟着没了，两条都说
    assert.deepEqual(second.diff.dropped, ['「线索」表：线索的「结果」不再对任何列（原来对的是「结果」）', '去掉了「lead.result」的取值归类'])
    assert.equal(second.diff.added.length, 1)
    assert.match(second.check, /这一稿少了 2 处.*不是有意的，原样补回去再交一稿/)
    // 卡片上也是这几条，去掉的排最前
    assert.deepEqual(tool.output.presentationMeta({}, second).draft.diff.lines.map(x => x.kind), ['drop', 'drop', 'add'])
    // 补回去再交：和第一稿比只剩新加的；和上一稿比是「对上了」
    const s3 = spec(src)
    s3.flags.push({ name: '东店的', all: [{ feature: 'field', args: ['owner'], op: '=', value: '东店' }] })
    const third = await tool.execute({ dataset: id, spec: s3, changes: '补回去了' }, {})
    assert.deepEqual([third.diff.against, third.diff.dropped, third.diff.added.length, third.check], ['第 1 稿', [], 1, undefined])
    assert.equal(third.diff.sinceLastDraft.added[0], '「线索」表：线索的「结果」对上了「结果」')
    // 定稿以后再改：和现在用的配置比
    const state = await ds.specState(id)
    await ds.finalizeSpec(id, state.draft.revision)
    const s4 = spec(src)
    const fourth = await tool.execute({ dataset: id, spec: s4, changes: '去掉标记' }, {})
    assert.equal(fourth.diff.against, '现在用的配置（第 1 版）')
    assert.deepEqual(fourth.diff.dropped, ['去掉了标记「东店的」'])
    assert.equal((await ds.specState(id)).draft.diff.lines.length, 1)
  })

  it('待处理线索的导出：文件名叫「待处理」，说明里写清是哪两种', async () => {
    const draft = await ds.saveSpecDraft(id, spec(src))
    await ds.finalizeSpec(id, draft.revision)
    assert.equal((await ds.build(id)).gate, 'ok')
    const one = await ds.exportLeads(id, { state: ['首跟超时', '跟进断了'], split: 'files' })
    assert.equal(one.name, '线索-待处理-2026-10-31-每个门店一份.zip')
    assert.match((await ds.exportLeads(id, { state: ['成交'], split: 'none' })).name, /^线索-成交-2026-10-31/)
    assert.match((await ds.exportLeads(id, { split: 'none' })).name, /^线索-全部-2026-10-31/)
  })

  it('报告正文自带的大标题不重复：预览里没有它', async () => {
    const q = await ds.query(id, 'metric', { metric: 'customers' })
    const saved = await ds.saveReportDraft(id, { title: '十月报告', body: `# 十月报告（数据第 1 版）\n\n## 结论\n\n一共 {{${q.ref}.value}} 人。` })
    const view = await ds.report(id, saved.name)
    assert.equal(view.draft.preview.startsWith('## 结论'), true)
    assert.match(view.draft.preview, /一共 4 人。/)
  })
})

describe('报告里的数字', () => {
  const result = { rows: [{ key: '北区', 已加微Pct: 22.94, 已加微: 951 }], total: { followPct: 95.7, channels: { 已加微: { pct: 18.6 } }, seg: { '买过 3～12 个月': 1802 } } }
  const refs = { q1: { n: 1, kind: 'reach', params: {}, result } }

  it('百分号只出现一次；引用的键可以是中文，带空格的用 ["…"]', () => {
    const body = '跟进率 {{q1.total.followPct}}%，企微 {{q1.rows[0].已加微Pct}}，{{q1.rows[0].已加微}} 人，整体 {{q1.total.channels.已加微.pct}} ％，这层 {{q1.total.seg["买过 3～12 个月"]}} 人%'
    assert.equal(render(body, refs), '跟进率 95.7%，企微 22.9%，951 人，整体 18.6%，这层 1,802 人%')
    assert.equal(renderMarked('{{q1.total.followPct}}%。', refs), '\u0001q1 · reach\u000295.7%\u0003。')
    assert.deepEqual(resolveRefs(body, new Map([['q1', refs.q1]])).problems, [])
    assert.equal(resolveRefs('{{q1.rows[0].没有这个}}', new Map([['q1', refs.q1]])).problems[0].kind, 'bad-path')
  })

  it('时间范围和月份不算没出处；真的统计数还是要引用', () => {
    const spec = { segments: [{ name: 'a', any: [{ value: [91, 365] }] }, { name: 'b', any: [{ value: [366, 730] }] }], flags: [], leads: { staleDays: 14 } }
    const check = text => checkNumbers(text, { names: [], allowed: allowedNumbers(spec, {}) }).map(p => p.text)
    assert.deepEqual(check('3～12 个月这层、1～2 年这层，9-10 月变少，9、10 月的交付，超过 14 天没再联系，2 天内首跟。'), [])
    assert.deepEqual(check('5 月有 38 人，每月 800～1000 条'), ['38 人', '800', '1000'])
    assert.deepEqual(check('{{q1.total.followPct}}% 跟进过'), [])
  })
})

describe('日期和压缩包', () => {
  it('今天按这台电脑的日期：北京时间早上七点，UTC 还是昨天', async () => {
    const zone = process.env.TZ
    const RealDate = Date
    process.env.TZ = 'Asia/Shanghai'
    // 2026-11-13 07:30 北京时间 = 2026-11-12 23:30 UTC
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.UTC(2026, 10, 12, 23, 30)])) } static now() { return RealDate.UTC(2026, 10, 12, 23, 30) } }
    const dir = mkdtempSync(join(tmpdir(), 'crm-ops-day-'))
    try {
      const ds = new Datasets({ documentsDir: dir })
      assert.equal(ds.today(), '2026-11-13')
      const { id } = await ds.create({ name: '日期', preset: 'blank' })
      await ds.importFile(id, '客户.csv', csv(CUSTOMERS))
      // 截止日填今天不该被拒
      await ds.setAsOf(id, '2026-11-13')
      await assert.rejects(ds.setAsOf(id, '2026-11-14'), /不能晚于今天/)
    } finally { globalThis.Date = RealDate; if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; rmSync(dir, { recursive: true, force: true }) }
  })

  it('压缩包里要能双击运行的文件留着可执行位', () => {
    const bytes = zip({ '包/启动.command': '#!/bin/sh', '包/说明.txt': 'x' }, { executable: n => n.endsWith('.command') })
    const cen = bytes.readUInt32LE(bytes.length - 22 + 16)
    const mode = at => (bytes.readUInt32LE(at + 38) >>> 16).toString(8)
    const next = cen + 46 + bytes.readUInt16LE(cen + 28)
    assert.deepEqual([mode(cen), mode(next)], ['100755', '100644'])
  })
})
