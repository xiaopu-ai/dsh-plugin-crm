// 名单成没成，看标记：
// 圈的是「没有某个标记的人」（没加企微的、没注册的），这份名单要的不是成交，是下次导入时这批人带上了那个标记。
// 1. 这样的名单自带目标；生成时记下对面那一组：同层、同样没有、没进名单的人；
// 2. 还没有新数据时照实说等下一期，不报 0%；
// 3. 新一期数据进来以后，两边各多少人带上了；名单里的人「结果」那一栏跟着数据走；
// 4. 也可以自己指定目标，或者指定只看交易。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { goalOf, goalText } from '../lib/core/lists.js'
import { Datasets } from '../lib/core/store.js'
import { assistantTools } from '../lib/host/assistant.js'

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'))
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// 40 位客户，甲店、乙店各 20 位；编号 1～8 已经加了企微，9～40 没加。编号是 4 的倍数的电话接通过。
const customers = added => [['客户编号', '姓名', '门店', '加微', '外呼'], ...range(1, 40).map(n => [`C${n}`, `客户${n}`, n % 2 ? '甲店' : '乙店', added.has(n) ? '已加' : '未加', n % 4 === 0 ? '接通' : ''])]
const FIRST = new Set(range(1, 8))
// 第二期：甲店名单里的 9、11、13、15 加上了；乙店（没进名单）里只有 10 加上了。
const SECOND = new Set([...FIRST, 9, 11, 13, 15, 10])
const ORDERS = [['单号', '客户编号', '日期', '金额'], ...range(1, 40).map(n => [`O${n}`, `C${n}`, '2026-09-15', '100.00'])]

const spec = src => ({
  labels: { owner: '门店' },
  tables: [
    { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', owner: '门店' } },
      extra: [{ entity: 'customer', key: 'wechat', name: '加微', column: '加微', type: 'category' }, { entity: 'customer', key: 'call', name: '外呼', column: '外呼', type: 'category' }] },
    { name: '订单', source: src.orders, mode: 'snapshot', entities: { transaction: { orderNo: '单号', customerId: '客户编号', date: '日期', amount: '金额' } } },
  ],
  identity: [{ keys: ['customer.id'], strength: 'strong' }],
  segments: [{ name: '买过', all: [{ feature: 'has_txn', op: '=', value: true }] }],
  flags: [
    { name: '已加微', kind: 'reach', all: [{ feature: 'field', args: ['extra.wechat'], op: '=', value: '已加' }] },
    { name: '接通过', kind: 'reach', all: [{ feature: 'field', args: ['extra.call'], op: '=', value: '接通' }] },
  ],
  lists: { purposes: ['加微', '回访'], outcomes: [{ code: 'visit', name: '到店', kind: 'success' }, { code: 'added', name: '加上了', kind: 'success' }, { code: 'booked', name: '约了', kind: 'booked' }, { code: 'no', name: '联系不上', kind: 'unreachable', cooldownDays: 30 }] },
})

describe('名单成没成，看标记', () => {
  let dir, ds, id, src, made

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-goal-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-10-10' })
    ;({ id } = await ds.create({ name: '目标测试', preset: 'blank' }))
    src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(customers(FIRST)))).id
    src.orders = (await ds.importFile(id, '订单.csv', csv(ORDERS))).id
    await ds.setAsOf(id, '2026-10-08')
    await ds.markChecked(id)
    const saved = await ds.saveSpecDraft(id, spec(src))
    await ds.finalizeSpec(id, saved.revision)
    assert.equal((await ds.build(id)).gate, 'ok')
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('目标是什么：圈「没有某个标记」的人，目标就是带上它；也可以指定，或者不要', () => {
    const s = spec({ customers: 'aaaaaaaa', orders: 'bbbbbbbb' })
    assert.deepEqual(goalOf(s, { without: ['已加微'] }, undefined), { flags: ['已加微'] })
    assert.equal(goalOf(s, { segment: '买过' }, undefined), null)
    assert.equal(goalOf(s, { without: ['已加微'] }, 'none'), null)
    assert.equal(goalOf(s, { without: ['已加微'] }, null), null)
    assert.deepEqual(goalOf(s, {}, '接通过'), { flags: ['接通过'] })
    assert.equal(goalText({ flags: ['已加微', '接通过'] }), '带上「已加微」或「接通过」')
    assert.throws(() => goalOf(s, {}, '乱写'), /名单的目标只能是配置里的标记：已加微、接通过。没有「乱写」/)
  })

  it('生成名单前就说清楚按什么算；生成时记下对面那一组', async () => {
    const pool = await ds.listPool(id, { owner: '甲店', without: ['已加微'] })
    assert.deepEqual([pool.kept, pool.goal, pool.flags], [16, { flags: ['已加微'], text: '带上「已加微」' }, ['已加微', '接通过']])
    assert.equal((await ds.listPool(id, { owner: '甲店', without: ['已加微'], goal: null })).goal, null)
    await assert.rejects(ds.listPool(id, { owner: '甲店', goal: '乱写' }), /名单的目标只能是配置里的标记/)
    made = await ds.createBatch(id, { pick: { owner: '甲店', without: ['已加微'] }, purpose: '加微' })
    // 甲店没加的 16 人进名单；乙店没加的 16 人是对面那一组
    assert.deepEqual([made.people, made.goal], [16, { flags: ['已加微'], text: '带上「已加微」', compare: 16 }])
  })

  it('还没有新数据：照实说等下一期，不报成 0%', async () => {
    const v = await ds.batch(id, made.id)
    assert.deepEqual([v.goal.fresh, v.goal.people, v.goal.reached, v.goal.base.people], [false, 16, 0, 16])
    assert.match(v.goal.note, /名单生成以后还没有导入新数据.*下次导入之后这里才有数/)
    assert.equal(v.outcomes.find(o => o.code === 'added').then, '以数据为准，下次导入带上「已加微」了才算')
    // 人先标了「加上了」：等数据确认
    await ds.setOutcome(id, made.id, v.members.find(m => m.name === '客户17').cid, 'added')
    const marked = (await ds.batch(id, made.id)).members.find(m => m.name === '客户17')
    assert.deepEqual([marked.shown, marked.note], ['booked', '等下次导入确认'])
    const q = (await ds.query(id, 'list_effect', { batch: made.id }, { log: false })).result
    assert.deepEqual([q.judgedBy, q.goal.fresh, q.goal.reached], ['goal', false, 0])
  })

  it('新一期数据进来：名单里多少人带上了，对面那一组多少人带上了', async () => {
    await ds.importFile(id, '客户.csv', csv(customers(SECOND)))
    assert.equal((await ds.build(id)).gate, 'ok')
    const v = await ds.batch(id, made.id)
    assert.deepEqual([v.goal.fresh, v.goal.people, v.goal.reached, v.goal.ratePct], [true, 16, 4, 25])
    assert.deepEqual(v.goal.base, { people: 16, reached: 1, ratePct: 6.3 })
    assert.match(v.goal.note, /看的是数据里的标记.*对面那一组是当时同层、同样没有这个标记、没进名单的人/)
    const of = name => v.members.find(m => m.name === name)
    // 没人标，数据显示带上了：算成，单独一格（配置里的「到店」说的不是这回事）
    assert.deepEqual([of('客户9').reached, of('客户9').shown, of('客户9').note], [true, 'goal', '没标，但数据显示带上了'])
    assert.deepEqual(v.outcomes.at(-1), { code: 'goal', name: '带上「已加微」了', kind: 'success', then: '数据里看到的：没人标结果，但新数据里已经带上了' })
    // 标了「加上了」，新数据里还没有：不算
    assert.deepEqual([of('客户17').reached, of('客户17').shown, of('客户17').note], [false, 'booked', '标了，但新数据里还没带上'])
    assert.deepEqual([v.counts.goal, v.counts.visit, v.counts.booked, v.counts.wait], [4, 0, 1, 11])
    // 名单页的那一行、查询，都是这几个数
    const row = (await ds.lists(id)).batches.find(b => b.id === made.id)
    assert.deepEqual([row.goal.reached, row.goal.base.reached, row.members], [4, 1, undefined])
    const q = (await ds.query(id, 'list_effect', { batch: made.id }, { log: false })).result
    assert.deepEqual([q.judgedBy, q.goal.text, q.goal.people, q.goal.reached, q.goal.ratePct, q.goal.base.ratePct], ['goal', '带上「已加微」', 16, 4, 25, 6.3])
    assert.deepEqual(q.outcomes.find(o => o.code === 'goal'), { code: 'goal', name: '带上「已加微」了（数据确认，没人标结果）', count: 4 })
  })

  it('标了「加上了」而且数据也带上了：按人标的那个结果算', async () => {
    const v = await ds.batch(id, made.id)
    await ds.setOutcome(id, made.id, v.members.find(m => m.name === '客户11').cid, 'added')
    const m = (await ds.batch(id, made.id)).members.find(x => x.name === '客户11')
    assert.deepEqual([m.shown, m.note], ['added', '数据确认：带上了'])
  })

  it('自己指定目标：生成时已经带着的人不算在内；指定只看交易的名单没有目标', async () => {
    // 乙店全部 20 人，目标是接通：其中 10 人（编号是 4 的倍数）已经接通过
    const b = await ds.createBatch(id, { pick: { owner: '乙店' }, purpose: '回访', goal: '接通过' })
    const v = await ds.batch(id, b.id)
    assert.deepEqual([v.people, v.goal.text, v.goal.people, v.goal.had, v.goal.reached, v.goal.fresh], [20, '带上「接通过」', 10, 10, 0, false])
    assert.equal(v.members.find(m => m.name === '客户4').reached, null)
    assert.equal(v.members.find(m => m.name === '客户2').reached, false)
    const plain = await ds.createBatch(id, { pick: { segment: '买过', without: ['接通过'], owner: '甲店' }, purpose: '回访', goal: 'none' })
    assert.equal(plain.goal, null)
    const pv = await ds.batch(id, plain.id)
    assert.equal(pv.goal, null)
    assert.equal(pv.outcomes.find(o => o.code === 'added').then, '以交易为准，下次导入对上了才算')
    // 刚生成的名单，马上查得到（改动途中读到的旧名单不会留在缓存里）
    assert.equal((await ds.query(id, 'list_effect', { batch: plain.id }, { log: false })).result.judgedBy, 'transactions')
  })

  it('助手放名单卡片：卡片上带着目标，提示里说要等下一期数据', async () => {
    const tool = assistantTools(ds).find(t => t.name === 'crm_propose_list')
    const r = await tool.execute({ dataset: id, owner: '乙店', without: '已加微', reason: '乙店还有人没加' })
    assert.equal(r.ok, true)
    assert.deepEqual(r.list.goal, { flags: ['已加微'], text: '带上「已加微」' })
    assert.match(r.note, /这份名单成没成看标记：下次导入新数据以后，这批人里有多少带上「已加微」了.*要等下一期数据进来才看得到/)
    assert.equal((await tool.execute({ dataset: id, owner: '乙店', without: '已加微', goal: 'none', reason: '只看交易' })).list.goal, null)
    assert.match((await tool.execute({ dataset: id, owner: '乙店', goal: '乱写', reason: 'x' })).error, /名单的目标只能是配置里的标记/)
  })
})
