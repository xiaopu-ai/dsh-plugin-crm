// 线索：一条线索一行的表能单独成立（挂不上客户也能算漏斗），按线索编号跨表合并，按截止日算出每条现在的状态，
// 漏斗、拆分、对比、待处理名单和导出都对得上手算的数。数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { checkSpec } from '../lib/core/spec.js'
import { followHours } from '../lib/core/leads.js'
import { Datasets } from '../lib/core/store.js'
import * as XLSX from '../lib/vendor/xlsx.mjs'

const AS_OF = '2026-10-31'
const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'))

const CUSTOMERS = [
  ['客户编号', '姓名', '手机', '城市'],
  ['C1', '张一', '13800000001', '杭州'],
  ['C2', '李二', '13800000002', '杭州'],
  ['C3', '王三', '13800000003', '宁波'],
]
const DEALS = [
  ['单号', '手机', '日期', '类型'],
  ['D1', '13800000002', '2026-05-01', '购车'],
  ['D2', '13800000003', '2026-10-01', '购车'],
]
// 线索编号, 留资时间, 姓名, 手机, 渠道, 活动, 归属, 顾问, 级别, 试驾, 首次跟进, 最近跟进
const LEAD_HEAD = ['线索编号', '留资时间', '客户姓名', '手机', '渠道', '活动', '归属', '顾问', '级别', '试驾', '首次跟进', '最近跟进']
const LEADS = [
  ['L1', '2026-10-30 09:00', '甲', '', '抖音', '', '甲店', '小王', '热', 'No', '', ''],                           // 待首跟
  ['L2', '2026-10-20 10:00', '乙', '', '抖音', '', '甲店', '小王', '冷', 'No', '', ''],                           // 首跟超时
  ['L3', '2026-10-01 10:00', '丙', '', '活动', '秋季试驾', '乙店', '小李', '温', 'Yes', '2026-10-01 14:00', '2026-10-05'], // 跟进断了，4 小时首跟
  ['L4', '2026-10-25 08:00', '丁', '', '转介绍', '', '乙店', '小李', '热', 'No', '2026-10-25 20:00', '2026-10-28'],  // 跟进中，12 小时
  ['L5', '2026-06-01', '戊', '', '抖音', '', '甲店', '小王', '冷', 'No', '', ''],                                 // 放太久
  ['L6', '2026-09-15', '己', '', '活动', '秋季试驾', '乙店', '小李', '赢单', 'Yes', '2026-09-16', '2026-09-20'],    // 成交
  ['L7', '2026-09-10', '庚', '', '转介绍', '', '甲店', '小王', '输单', 'No', '2026-09-11', '2026-09-12'],          // 战败
  ['L8', '2026-08-01', '辛', '', '抖音', '', '甲店', '小王', '休眠', 'No', '2026-08-02', '2026-08-02'],            // 休眠
  ['L9', '2026-10-10', '张一', '13800000001', '转介绍', '', '乙店', '小李', '热', 'Yes', '2026-10-10', '2026-10-25'], // 跟进中，挂上 C1
  ['', '2026-10-15', '癸', '', '抖音', '', '甲店', '小王', '', 'No', '', ''],                                      // 没编号，首跟超时
  ...[12, 13, 14, 15].map(n => [`L${n}`, `2026-10-0${n - 10}`, `子${n}`, '', '抖音', '', '甲店', '小王', '冷', 'No', '', '']), // 首跟超时 ×4
]
// 报名表是线索表的子集（同一个线索编号），先导入、比较旧：L6 那时还是「冷」；L11 只在报名表里
const SIGNUP = [
  ['线索编号', '留资时间', '客户姓名', '渠道', '活动', '归属', '级别'],
  ['L3', '2026-10-01 10:00', '丙', '活动', '秋季试驾', '乙店', '温'],
  ['L6', '2026-09-15', '己', '活动', '秋季试驾', '乙店', '冷'],
  ['L11', '2026-10-12', '寅', '活动', '秋季试驾', '乙店', '温'],
]

function spec(src) {
  return {
    labels: { lead: '销售机会', owner: '门店' },
    tables: [
      { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', phone: '手机', city: '城市' } } },
      { name: '成交', source: src.deals, mode: 'snapshot', entities: { transaction: { orderNo: '单号', customerPhone: '手机', date: '日期', type: '类型' } } },
      { name: '销售机会', source: src.leads, mode: 'snapshot', entities: { lead: { id: '线索编号', date: '留资时间', customerName: '客户姓名', customerPhone: '手机', channel: '渠道', campaign: '活动', owner: '归属', rep: '顾问', level: '级别', result: '级别', trial: '试驾', firstFollow: '首次跟进', lastFollow: '最近跟进' } } },
      { name: '活动报名', source: src.signup, mode: 'snapshot', entities: { lead: { id: '线索编号', date: '留资时间', customerName: '客户姓名', channel: '渠道', campaign: '活动', owner: '归属', level: '级别', result: '级别' } } },
    ],
    dictionaries: { 'transaction.type': { 购车: [] } },
    identity: [{ keys: ['customer.id'], strength: 'strong' }, { keys: ['customer.phone'], strength: 'strong', unless: 'shared' }],
    segments: [
      { name: '车主', all: [{ feature: 'has_txn', op: '=', value: true }] },
      { name: '在谈', all: [{ feature: 'has_lead', args: ['跟进中'], op: '=', value: true }] },
    ],
    flags: [],
    lists: { purposes: ['线索跟进'], outcomes: [{ code: 'visit', name: '到店', kind: 'success' }] },
    leads: { trialName: '试驾' },
  }
}

describe('线索', () => {
  let dir, ds, id, built

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-leads-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '线索测试', preset: 'blank' }))
    const src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id
    src.deals = (await ds.importFile(id, '成交.csv', csv(DEALS))).id
    src.signup = (await ds.importFile(id, '报名.csv', csv(SIGNUP))).id
    await new Promise(r => setTimeout(r, 5))
    src.leads = (await ds.importFile(id, '线索.csv', csv([LEAD_HEAD, ...LEADS]))).id
    await ds.setAsOf(id, AS_OF)
    await ds.markChecked(id)
    const { revision } = await ds.saveSpecDraft(id, spec(src))
    await ds.finalizeSpec(id, revision)
    built = await ds.build(id)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('配置：线索不必挂客户；结果和体验用常见写法补字典；时间设置有默认值', () => {
    const { ok, errors, spec: s } = checkSpec(spec({ customers: 'aaaaaaaa', deals: 'bbbbbbbb', leads: 'cccccccc', signup: 'dddddddd' }))
    assert.deepEqual(errors, [])
    assert.ok(ok)
    assert.equal(s.dictionaries['lead.result'].成交.includes('赢单'), true)
    assert.equal(s.dictionaries['lead.trial'].是.includes('yes'), true) // 匹配时不分大小写
    assert.deepEqual({ followDays: s.leads.followDays, staleDays: s.leads.staleDays, activeDays: s.leads.activeDays, trialName: s.leads.trialName }, { followDays: 2, staleDays: 14, activeDays: 90, trialName: '试驾' })
  })

  it('配置写错会报错：没有留资时间、结果的标准值、时间设置、规则参数', () => {
    const base = spec({ customers: 'aaaaaaaa', deals: 'bbbbbbbb', leads: 'cccccccc', signup: 'dddddddd' })
    const paths = s => checkSpec(s).errors.map(e => e.path)
    const noDate = structuredClone(base); delete noDate.tables[2].entities.lead.date
    assert.ok(paths(noDate).includes('tables[2].entities.lead.date'))
    const badDict = structuredClone(base); badDict.dictionaries['lead.result'] = { 赢了: ['赢单'] }
    assert.ok(paths(badDict).some(p => p.startsWith('dictionaries.lead.result')))
    const badDays = structuredClone(base); badDays.leads = { followDays: 0, staleDays: 30, activeDays: 20 }
    assert.ok(paths(badDays).includes('leads.followDays'))
    assert.ok(paths(badDays).includes('leads.activeDays'))
    const badArg = structuredClone(base); badArg.segments[1].all[0].args = ['热']
    assert.ok(paths(badArg).some(p => p.startsWith('segments[1]')))
  })

  it('清洗：线索按编号合并，报名表不重复算；挂不上的线索不挡路', async () => {
    assert.equal(built.gate, 'ok')
    assert.equal(built.counts.leads, 15)
    assert.equal(built.counts.leadsMerged, 2)
    assert.equal((await ds.review(id)).open, 0)
    const rec = await ds.reconciliation(id)
    assert.equal(rec.recon.link.lead.linked, 1)
  })

  it('首次跟进用时：两边都有时间按小时，只有日期按整天', () => {
    assert.equal(followHours({ date: '2026-10-01', at: '2026-10-01T10:00', firstFollow: '2026-10-01', firstFollowAt: '2026-10-01T14:00' }), 4)
    assert.equal(followHours({ date: '2026-09-15', at: null, firstFollow: '2026-09-16', firstFollowAt: null }), 24)
    assert.equal(followHours({ date: '2026-09-15', at: null, firstFollow: '2026-09-14', firstFollowAt: null }), null)
  })

  it('漏斗：每条线索现在的状态、跟进率、成交率、首跟中位数', async () => {
    const { result: f } = await ds.query(id, 'lead_funnel', { window: 365 }, { log: false })
    const states = Object.fromEntries(f.states.map(s => [s.name, s.count]))
    assert.deepEqual(states, { 待首跟: 1, 首跟超时: 7, 跟进中: 2, 跟进断了: 1, 放太久: 1, 成交: 1, 战败: 1, 休眠: 1 })
    assert.equal(f.total.leads, 15)
    assert.equal(f.total.action, 8)
    assert.equal(f.total.won, 1) // L6：新导入的「赢单」盖过报名表里旧的「冷」
    assert.equal(f.total.winPct, 6.7)
    assert.equal(f.total.trial, 3)
    assert.equal(f.total.medianHours, 18) // 4、12、24、24、24、0
    assert.deepEqual(f.steps.map(s => s.name), ['线索', '跟进过', '试驾', '成交'])
  })

  it('拆分：按渠道、按来自哪张表（一条线索可以在几张表里）', async () => {
    const { result: byChannel } = await ds.query(id, 'lead_funnel', { window: 365, by: 'channel' }, { log: false })
    const n = Object.fromEntries(byChannel.rows.map(r => [r.key, r.leads]))
    assert.deepEqual(n, { 抖音: 9, 活动: 3, 转介绍: 3 })
    const { result: byTable } = await ds.query(id, 'lead_funnel', { window: 365, by: 'table' }, { log: false })
    const t = Object.fromEntries(byTable.rows.map(r => [r.key, r.leads]))
    assert.deepEqual(t, { 销售机会: 14, 活动报名: 3 })
    const { result: bd } = await ds.query(id, 'breakdown', { metric: 'lead_win_rate', by: 'lead.campaign', window: 365 }, { log: false })
    assert.equal(bd.rows.find(r => r.key === '秋季试驾').value, 33.3)
  })

  it('指标和对比：线索数、按筛选的线索', async () => {
    const { result: m } = await ds.query(id, 'metric', { metric: 'leads', window: 30, lead: { owner: '甲店' } }, { log: false })
    assert.equal(m.value, 7) // L1、L2、没编号那条（10-15）、L12～L15
    const { result: c } = await ds.query(id, 'compare', { metric: 'leads', window: 30 }, { log: false })
    assert.equal(c.b.value + c.a.value, 13)
    await assert.rejects(ds.query(id, 'metric', { metric: 'leads', lead: { 颜色: '红' } }, { log: false }), /线索只能按这些筛/)
  })

  it('客户这边：挂上的线索进分层和时间线', async () => {
    const { segments } = await ds.overview(id)
    const count = Object.fromEntries(segments.rows.map(r => [r.name, r.count]))
    assert.equal(count.车主, 2)
    assert.equal(count.在谈, 1)
    const { rows } = await ds.customers(id, { q: 'C1' })
    const one = await ds.customer(id, rows[0].cid)
    assert.ok(one.timeline.some(x => x.kind === 'lead' && x.channel === '转介绍'))
  })

  it('线索页：总览、待处理名单（刚留资的在前）、样例不带姓名', async () => {
    const board = await ds.leadBoard(id, { window: 90, by: 'owner' })
    assert.equal(board.on, true)
    assert.ok(board.funnel.rows.some(r => r.key === '甲店'))
    assert.equal(board.monthly.length, 12)
    assert.ok(board.insights.some(x => x.id === 'lead:late'))
    const todo = await ds.leads(id, { state: ['首跟超时', '跟进断了'] })
    assert.equal(todo.total, 8)
    assert.equal(todo.rows[0].date >= todo.rows[1].date, true)
    assert.equal(todo.rows.find(r => r.extId === 'L2').name, '乙')
    const { result: sample } = await ds.query(id, 'sample', { entity: 'lead', limit: 20 }, { log: false })
    assert.ok(sample.rows.length > 0 && sample.rows.every(r => !('name' in r) && !('refs' in r) && !/子1\d|寅|张一|13800000001/.test(JSON.stringify(r))))
  })

  it('导出：按归属方一店一张表，姓名默认遮住', async () => {
    const out = await ds.exportLeads(id, { state: ['首跟超时'], split: 'owner' })
    assert.ok(existsSync(out.file))
    const wb = XLSX.read(await import('node:fs').then(fs => fs.readFileSync(out.file)), { type: 'buffer' })
    assert.deepEqual(wb.SheetNames.sort(), ['乙店', '甲店', '说明'].sort())
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.甲店, { header: 1 })
    assert.equal(rows.length - 1, 6)
    assert.ok(rows.slice(1).every(r => !String(r[2]).startsWith('乙') || String(r[2]).includes('*')))
  })
})
