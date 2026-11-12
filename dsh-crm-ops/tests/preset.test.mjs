// 预设带现成的表对应：
// 1. 导入的表列名对得上，不用模型就能起草完整的配置；可选的列（手机号）没有或是空的就不对，别的照常；
// 2. 少了哪张表、哪一列改了名，说得清楚；必需的表没有就不起草；
// 3. 自带的「经销商网络运营」预设，拿它认识的列名（内容是编的）从头跑通。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { getPreset, loadPresets } from '../lib/core/presets.js'
import { checkPresetTables, presetTables } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'
import { assistantTools } from '../lib/host/assistant.js'

const csv = rows => Buffer.from(rows.map(r => r.map(c => (/[,"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n'))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const pad = n => String(n).padStart(2, '0')

// 六家经销商：代码、简称、全称、大区。
const DEALERS = range(1, 6).map(i => ({ code: `D0${pad(i)}`, short: `经销商${'甲乙丙丁戊己'[i - 1]}`, full: `${'甲乙丙丁戊己'[i - 1]}动力运动有限公司`, region: ['北区', '北区', '中区', '南区', '退网', '退网'][i - 1] }))
const dealerOf = n => DEALERS[(n - 1) % 6]
const lines = n => (n % 4 === 0 ? '越野,水上' : n % 4 === 1 ? '水上' : n % 4 === 2 ? '公路' : '')
/** 全量客户表：36 位客户，列名是预设认识的那一套。 */
const customers = ({ phones = false } = {}) => [
  ['内部ID', '客户编号', '经销商代码', '客户姓名', '联系电话', '客户类别', '经销商简称', '重复标记', '历史购买台数', '购买产品线', '外呼结果', '最近交付年月', '省份', '城市', '大区', '企微添加状态', '小程序注册日期', '会员开通日期'],
  ...range(1, 36).map(n => { const d = dealerOf(n); return [1000 + n, `${d.code}-C${n}`, d.code, `客户${n}`, phones ? `139000010${pad(n)}` : '', n % 9 === 0 ? '运营户' : '个人户', d.short, '', n % 4 === 0 ? 2 : 1, lines(n), n % 3 === 0 ? '未接通,接通' : n % 3 === 1 ? '未接通' : '', lines(n) ? (n % 2 ? '2023-05' : '2019-08,2022-08') : '', '某省', `城市${n % 5}`, d.region, n <= 12 ? '已建联' : '未建联', n <= 6 ? '2026-05-01' : '', n <= 3 ? '2026-06-01' : ''] }),
]
/** 交付单：客户 1～12 各一台，客户 1 再加一台试乘试驾车。客户 2、3 的首保快失效还没用。 */
const DELIVERIES = [
  ['内部 ID', '交付单号', '经销商', '终端客户', '车架号', '产品线', '车型', '年款', '首保生效日期', '首保失效日期', '首保权益状态', '交付日期', '保修开始日', '保修到期日', '用途'],
  ...range(1, 12).map(n => { const d = dealerOf(n); const soon = n === 2 || n === 3; return [5000 + n, `DO${1000 + n}`, `${d.code} ${d.full}`, `${d.code}-C${n} ${d.full} : 客户${n}`, '', n % 2 ? '水上' : '越野', `型号 ${n}`, 'MY26', '2025-12-01', soon ? '2026-11-30' : '2027-06-01', soon || n === 4 ? '待使用' : '已使用', n <= 6 ? '2026-10-01' : '2026-01-15', n <= 6 ? '2026-10-01' : '2026-01-15', n === 5 ? '2026-12-01' : '2028-01-15', '01 - 个人'] }),
  [5099, 'DO1099', `${DEALERS[0].code} ${DEALERS[0].full}`, `${DEALERS[0].code}:CO1 ${DEALERS[0].full} : 客户1`, '', '水上', '试驾车', 'MY26', '', '', '', '2026-09-01', '2026-09-01', '2028-09-01', '试乘试驾'],
]
/** 销售机会：24 条，级别里带结果。 */
const LEVELS = ['赢单', '热', '冷', '输单', '休眠', '不确定']
const OPPS = [
  ['Internal ID', '线索编号', '创建日期', '状态', '客户称呼', '手机号', '所属经销商', '销售顾问', '区域经理', '渠道来源', '来源明细', '市场活动', '机会级别', '意向产品', '是否试驾', '首次跟进日期', '最新跟进日期'],
  ...range(1, 24).map(n => { const d = dealerOf(n); return [7000 + n, `OP${2000 + n}`, '2026-10-05', '未转化', `线索人${n}`, '', `${d.code} ${d.full}`, `顾问${n % 3}`, `区域经理${n % 2 ? '甲' : '乙'}`, n % 2 ? '展厅进店' : '厂家线下活动', '朋友介绍', n % 2 ? '' : '秋季试驾会', LEVELS[n % 6], '水上', n % 4 === 0 ? 'Yes' : 'No', n % 5 === 0 ? '' : '2026-10-05', n % 5 === 0 ? '' : '2026-10-28'] }),
]
/** 活动报名：销售机会里的前 4 条，同一套编号，日期列叫「留资日期」。 */
const SIGNUPS = [
  ['内部 ID', '线索编号', '留资日期', '客户称呼', '手机号', '所属经销商', '区域经理', '渠道来源', '来源明细', '机会级别', '意向产品', '是否试驾', '首次跟进日期', '最新跟进日期'],
  ...range(1, 4).map(n => { const d = dealerOf(n); return [7000 + n, `OP${2000 + n}`, '2026-10-05', `线索人${n}`, '', `${d.code} ${d.full}`, '区域经理甲', '厂家线下活动', '秋季试驾会', LEVELS[n % 6], '水上', n % 4 === 0 ? '是' : '否', '2026-10-05', '2026-10-28'] }),
]

describe('自带的经销商预设', () => {
  it('读得进来，现成的四张表自己就是一份能过的配置', async () => {
    const { presets, problems } = await loadPresets()
    assert.deepEqual(problems, [])
    assert.deepEqual(presets.map(p => p.id), ['education', 'powersports', 'dealer-network', 'owner-system', 'blank'])
    const p = await getPreset('dealer-network')
    assert.deepEqual(presetTables(p).map(t => [t.name, t.sheetOptional, t.optional]), [['客户', false, ['联系电话']], ['交付单', false, ['车架号']], ['销售机会', false, ['手机号']], ['活动报名', true, ['手机号']]])
    assert.deepEqual(checkPresetTables(p), [])
  })

  it('现成的表前后对不上的预设，读的时候就报出来', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crm-ops-presets-'))
    const p = structuredClone(await getPreset('dealer-network'))
    for (const k of ['origin', 'file']) delete p[k]
    p.id = 'broken'
    p.tableHints[1].table.extra = p.tableHints[1].table.extra.filter(x => x.key !== 'benefit_end')
    writeFileSync(join(dir, 'broken.json'), JSON.stringify(p))
    const { presets, problems } = await loadPresets(dir)
    assert.equal(presets.some(x => x.id === 'broken'), false)
    assert.match(problems.find(x => x.file === 'broken.json').message, /flags\[0\].*持有物的日期字段只能是：start、end、extra\.benefit_start/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('按预设直接起草', () => {
  let dir, ds, id, src

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-preset-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '预设测试', preset: 'dealer-network' }))
    src = {}
    src.customers = (await ds.importFile(id, '全量客户表.csv', csv(customers()))).id
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('只有客户表：说清楚还缺哪张，不起草', async () => {
    const st = await ds.status(id)
    assert.equal(st.presetFit.ready, false)
    assert.deepEqual(st.presetFit.tables.map(t => t.name), ['客户'])
    assert.deepEqual(st.presetFit.unmatched.map(x => [x.name, x.optional]), [['交付单', false], ['销售机会', false], ['活动报名', true]])
    assert.deepEqual(st.presetFit.lacks, ['交易'])
    await assert.rejects(ds.draftFromPreset(id), /找不到「交易」那张（预设里的「交付单」没有对应的表；「销售机会」没有对应的表）/)
  })

  it('交付单有一列改了名：指出是哪张表差哪一列', async () => {
    const renamed = DELIVERIES.map((r, i) => (i === 0 ? r.map(c => (c === '保修到期日' ? '保修截止' : c)) : r))
    const wrong = await ds.importFile(id, '交付单-改过列名.csv', csv(renamed))
    const hit = (await ds.status(id)).presetFit.unmatched.find(x => x.name === '交付单')
    assert.deepEqual(hit.missing, ['保修到期日'])
    assert.match(hit.nearest, /交付单-改过列名/)
    await ds.removeSource(id, wrong.id)
  })

  it('四张表都在：一步出草案，可选的空列不对，试跑通过', async () => {
    src.deliveries = (await ds.importFile(id, '交付单.csv', csv(DELIVERIES))).id
    src.opps = (await ds.importFile(id, '销售机会.csv', csv(OPPS))).id
    src.signups = (await ds.importFile(id, '活动报名.csv', csv(SIGNUPS))).id
    const st = await ds.status(id)
    assert.equal(st.presetFit.ready, true)
    assert.match(st.next, /直接按预设起草/)
    assert.deepEqual(st.presetFit.dropped, [{ name: '客户', columns: ['联系电话'] }, { name: '交付单', columns: ['车架号'] }, { name: '销售机会', columns: ['手机号'] }, { name: '活动报名', columns: ['手机号'] }])
    await ds.setAsOf(id, '2026-10-31')
    await ds.markChecked(id)
    const saved = await ds.draftFromPreset(id)
    assert.deepEqual(saved.tables.map(t => [t.name, t.sourceName]), [['客户', '全量客户表.csv'], ['交付单', '交付单.csv'], ['销售机会', '销售机会.csv'], ['活动报名', '活动报名.csv']])
    const t = saved.trial
    assert.deepEqual(t.problems, [])
    assert.deepEqual({ customers: t.counts.customers, transactions: t.counts.transactions, leads: t.counts.leads, leadsMerged: t.counts.leadsMerged, owners: t.counts.owners, excluded: t.counts.excluded }, { customers: 36, transactions: 12, leads: 24, leadsMerged: 4, owners: 6, excluded: 1 })
    assert.deepEqual(t.excluded, [{ table: '交付单', rows: 1, by: { '试乘试驾车，不是卖出去的': 1 } }])
    assert.deepEqual(t.links.filter(l => l.entity !== 'lead').map(l => [l.entity, l.linked, l.total]), [['asset', 12, 12], ['transaction', 12, 12]])
    const flags = Object.fromEntries(t.groups.flags.map(f => [f.name, f.count]))
    assert.deepEqual(flags, { 首保将失效: 2, 保修将到期: 1, 多产品线车主: 9, 多台车主: 9, 已加企微: 12, 外呼接通过: 12, 小程序注册: 6, 会员: 3 })
    assert.deepEqual(t.groups.flags.filter(f => f.kind === 'reach').map(f => f.name), ['已加企微', '外呼接通过', '小程序注册', '会员'])
    assert.deepEqual(t.groups.segments.map(s => [s.name, s.kind]).slice(0, 4), [['购车 3 个月内', 'lifecycle'], ['购车 3～12 个月', 'lifecycle'], ['购车 1～2 年', 'lifecycle'], ['购车 2 年以上', 'lifecycle']])
    // 草案里没有可选的那几列
    const draft = (await ds.specState(id)).draft.spec
    assert.equal(draft.tables[0].entities.customer.phone, undefined)
    assert.equal(draft.tables[1].entities.asset.serial, undefined)
    assert.equal(draft.tables[2].entities.lead.customerPhone, undefined)
    assert.equal(draft.tables[0].optional, undefined)
  })

  it('定稿、清洗：经销商按代码认成一家，按大区汇总', async () => {
    const { draft } = await ds.specState(id)
    await ds.finalizeSpec(id, draft.revision)
    const built = await ds.build(id)
    assert.equal(built.gate, 'ok')
    assert.equal((await ds.status(id)).step, 'ready')
    const b = await ds.ownerBoard(id, { window: 90, by: 'extra.region' })
    assert.deepEqual(b.apart, [])
    assert.deepEqual(b.rows.map(r => r.key).sort(), DEALERS.map(d => d.short).sort())
    // 每组：几家、客户数、近 90 天交付（10 月那 6 台，1 月的不在窗口里）、新线索
    assert.deepEqual(Object.fromEntries(b.groups.map(g => [g.key, [g.owners, g.customers, g.txns, g.leads]])), { 北区: [2, 12, 2, 8], 中区: [1, 6, 1, 4], 南区: [1, 6, 1, 4], 退网: [2, 12, 2, 8] })
    assert.deepEqual((await ds.pending(id)).unknown, [])
    const { result } = await ds.query(id, 'breakdown', { metric: 'txn_count', by: 'transaction.type', window: 365 }, { log: false })
    assert.deepEqual(Object.fromEntries(result.rows.map(r => [r.key, r.value])), { 水上: 6, 越野: 6 })
  })

  it('助手有这个工具：一步出草案，卡片和试跑结果都带着', async () => {
    const other = (await ds.create({ name: '预设测试二', preset: 'dealer-network' })).id
    await ds.importFile(other, '全量客户表.csv', csv(customers({ phones: true })))
    await ds.importFile(other, '交付单.csv', csv(DELIVERIES))
    await ds.importFile(other, '销售机会.csv', csv(OPPS))
    const tool = assistantTools(ds).find(t => t.name === 'crm_draft_from_preset')
    const r = await tool.execute({ dataset: other }, {})
    assert.equal(r.ok, true)
    assert.equal(r.trial.ok, true)
    assert.deepEqual(r.unmatched.map(x => [x.name, x.optional]), [['活动报名', true]])
    // 有手机号的时候，手机号那一列就对上了
    assert.deepEqual(r.dropped.map(x => x.name), ['交付单', '销售机会'])
    assert.equal((await ds.specState(other)).draft.spec.tables[0].entities.customer.phone, '联系电话')
    assert.match(r.note, /草案按预设存好了/)
    assert.equal(tool.output.presentationMeta({}, r).draft.revision, r.revision)
    // 没有现成对应的预设：说照常聊
    const plain = (await ds.create({ name: '空白', preset: 'blank' })).id
    await ds.importFile(plain, '全量客户表.csv', csv(customers()))
    const no = await tool.execute({ dataset: plain }, {})
    assert.equal(no.ok, false)
    assert.match(no.error, /这个预设没有现成的表对应/)
    assert.equal((await ds.status(plain)).presetFit, undefined)
    // 从零开始的数据集把另外两张表也导进来：认得这批表的那个预设自己冒出来，起草以后它就是这个数据集的预设
    await ds.importFile(plain, '交付单.csv', csv(DELIVERIES))
    await ds.importFile(plain, '销售机会.csv', csv(OPPS))
    const found = (await ds.status(plain)).presetFit
    assert.deepEqual([found.ready, found.own, found.preset], [true, false, { id: 'dealer-network', name: '经销商网络运营（客户表 + 交付单 + 销售机会）' }])
    const yes = await tool.execute({ dataset: plain }, {})
    assert.equal(yes.ok, true)
    assert.match(yes.changes, /^按预设「经销商网络运营（客户表 \+ 交付单 \+ 销售机会）」直接起草/)
    assert.equal((await ds.status(plain)).preset, 'dealer-network')
    assert.equal((await ds.starter(plain)).id, 'dealer-network')
  })
})
