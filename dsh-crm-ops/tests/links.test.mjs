// 挂不上客户不能悄悄过：
// 1. 配置里按规则永远挂不上的表，交草案时就报错；
// 2. 草案存下时按真实的表试跑一遍，挂人率和问题随草案一起回来；
// 3. 清洗以后，行大半没挂上客户的表不算「准备好了」，要人看一眼才能继续；
// 4. 没挂上的互动算在次数里时要说出来。线索挂不上客户不算问题。
// 数据全是编的。跑法：npm test
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { checkSpec } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'

const AS_OF = '2026-10-31'
const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'))

// 30 位客户：编号、姓名、手机。前 10 位重名（都叫王伟），后 20 位名字各不相同。
const CUSTOMERS = [['客户编号', '姓名', '手机'], ...Array.from({ length: 30 }, (_, i) => [`C${i + 1}`, i < 10 ? '王伟' : `客户${i + 1}`, `138000000${String(i + 1).padStart(2, '0')}`])]
const DEALS = [['单号', '客户编号', '日期', '类型'], ...Array.from({ length: 12 }, (_, i) => [`D${i + 1}`, `C${i + 1}`, '2026-09-01', '购买'])]
// 跟进表：只有姓名。10 行叫王伟（重名，挂不上），5 行是客户表里不重名的人，25 行是客户表里没有的人。
const VISITS = [['姓名', '渠道', '日期'],
  ...Array.from({ length: 10 }, () => ['王伟', '电话', '2026-10-10']),
  ...Array.from({ length: 5 }, (_, i) => [`客户${i + 11}`, '电话', '2026-10-11']),
  ...Array.from({ length: 25 }, (_, i) => [`路人${i + 1}`, '到店', '2026-10-12'])]
// 回访表：按手机号，全都对得上。
const CALLS = [['手机', '渠道', '日期'], ...Array.from({ length: 15 }, (_, i) => [`138000000${String(i + 1).padStart(2, '0')}`, '电话', '2026-10-20'])]

const base = src => ({
  tables: [
    { name: '客户', source: src.customers, mode: 'snapshot', entities: { customer: { id: '客户编号', name: '姓名', phone: '手机' } } },
    { name: '成交', source: src.deals, mode: 'snapshot', entities: { transaction: { orderNo: '单号', customerId: '客户编号', date: '日期', type: '类型' } } },
  ],
  dictionaries: { 'transaction.type': { 购买: [] } },
  identity: [{ keys: ['customer.id'], strength: 'strong' }, { keys: ['customer.phone'], strength: 'strong', unless: 'shared' }],
  segments: [{ name: '买过', all: [{ feature: 'has_txn', op: '=', value: true }] }],
  flags: [],
  lists: { purposes: ['回访'], outcomes: [{ code: 'done', name: '成了', kind: 'success' }] },
})
const visits = src => ({ name: '跟进', source: src.visits, mode: 'append', entities: { touch: { customerName: '姓名', channel: '渠道', date: '日期' } } })
const calls = src => ({ name: '回访', source: src.calls, mode: 'append', entities: { touch: { customerPhone: '手机', channel: '渠道', date: '日期' } } })
const FAKE = { customers: 'aaaaaaaa', deals: 'bbbbbbbb', visits: 'cccccccc', calls: 'dddddddd' }

describe('配置：按规则永远挂不上的表，交草案就报错', () => {
  it('只给了姓名，认人规则里没有只按姓名的', () => {
    const spec = base(FAKE); spec.tables.push(visits(FAKE))
    const { ok, errors } = checkSpec(spec)
    assert.equal(ok, false)
    const e = errors.find(x => x.path === 'tables[2].entities.touch')
    assert.ok(e, '要指到那张表的互动上')
    assert.match(e.message, /只给了客户姓名/)
    assert.match(e.message, /"keys": \["customer.name"\]/)
    assert.match(e.message, /改喂给 lead/)
  })

  it('加一条只按姓名的弱键就过', () => {
    const spec = base(FAKE); spec.tables.push(visits(FAKE)); spec.identity.push({ keys: ['customer.name'], strength: 'weak' })
    assert.deepEqual(checkSpec(spec).errors, [])
  })

  it('靠手机找客户，客户表却没对手机', () => {
    const spec = base(FAKE); spec.tables.push(calls(FAKE)); delete spec.tables[0].entities.customer.phone
    const e = checkSpec(spec).errors.find(x => x.path === 'tables[2].entities.touch')
    assert.ok(e)
    assert.match(e.message, /没有哪张表给客户对上客户手机/)
  })

  it('自己建客户的表、同一行就是客户的表、线索，都不拦', () => {
    const own = base(FAKE); own.tables.push({ ...calls(FAKE), newCustomers: true }); delete own.tables[0].entities.customer.phone
    assert.deepEqual(checkSpec(own).errors, [])
    const sameRow = base(FAKE); sameRow.tables.push({ name: '登记', source: FAKE.visits, mode: 'snapshot', entities: { customer: { name: '姓名' }, touch: { channel: '渠道', date: '日期' } } })
    assert.deepEqual(checkSpec(sameRow).errors, [])
    const lead = base(FAKE); lead.tables.push({ name: '线索', source: FAKE.visits, mode: 'snapshot', entities: { lead: { customerName: '姓名', channel: '渠道', date: '日期' } } })
    assert.deepEqual(checkSpec(lead).errors, [])
  })
})

describe('试跑和门禁', () => {
  let dir, ds, id, src

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-ops-links-'))
    ds = new Datasets({ documentsDir: dir, today: () => '2026-11-02' })
    ;({ id } = await ds.create({ name: '挂人测试', preset: 'blank' }))
    src = {}
    src.customers = (await ds.importFile(id, '客户.csv', csv(CUSTOMERS))).id
    src.deals = (await ds.importFile(id, '成交.csv', csv(DEALS))).id
    src.visits = (await ds.importFile(id, '跟进.csv', csv(VISITS))).id
    src.calls = (await ds.importFile(id, '回访.csv', csv(CALLS))).id
    await ds.setAsOf(id, AS_OF)
    await ds.markChecked(id)
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('交草案时就试跑：按手机的回访全挂上，没有问题', async () => {
    const spec = base(src); spec.tables.push(calls(src))
    const saved = await ds.saveSpecDraft(id, spec)
    assert.equal(saved.trial.ok, true)
    assert.deepEqual(saved.trial.problems, [])
    const row = saved.trial.links.find(x => x.table === '回访')
    assert.deepEqual({ total: row.total, linked: row.linked, ratePct: row.ratePct }, { total: 15, linked: 15, ratePct: 100 })
    assert.equal(saved.trial.counts.customers, 30)
  })

  it('按姓名的跟进表：40 行只挂上 5 行，试跑把原因说出来', async () => {
    const spec = base(src); spec.tables.push(visits(src), calls(src)); spec.identity.push({ keys: ['customer.name'], strength: 'weak' })
    const saved = await ds.saveSpecDraft(id, spec)
    assert.equal(saved.trial.ok, false)
    const row = saved.trial.links.find(x => x.table === '跟进')
    assert.deepEqual({ total: row.total, linked: row.linked }, { total: 40, linked: 5 })
    assert.equal(saved.trial.problems.length, 1)
    assert.match(saved.trial.problems[0], /「跟进」的互动 40 行里只有 5 行挂上了客户（12.5%）/)
    assert.match(saved.trial.problems[0], /25 行的客户姓名在客户表里找不到，10 行对上了不止一个客户（重名）/)
    // 草案页也看得到
    assert.equal((await ds.specState(id)).draft.trial.problems.length, 1)
  })

  it('还是定稿并清洗：不算准备好，要人看过才继续', async () => {
    const { draft } = await ds.specState(id)
    await ds.finalizeSpec(id, draft.revision)
    const built = await ds.build(id)
    assert.equal(built.gate, 'ack')
    assert.deepEqual(built.weakLinks.map(x => [x.table, x.entity, x.total, x.linked]), [['跟进', 'touch', 40, 5]])
    const st = await ds.status(id)
    assert.equal(st.step, 'config')
    assert.equal(st.data.broken, true)
    assert.match(st.data.problems[0], /只有 5 行挂上了客户/)
    assert.match(st.next, /data\.problems/)
    // 回访那张表全挂上了，不在名单里
    assert.ok(!st.data.weakLinks.some(x => x.table === '回访'))
  })

  it('互动次数把没挂上的也数进去时，会说有多少不知道是谁', async () => {
    const { result } = await ds.query(id, 'metric', { metric: 'touches', window: 60 }, { log: false })
    assert.equal(result.value, 55)
    assert.equal(result.unlinked.count, 35)
    const { result: q } = await ds.query(id, 'quality', {}, { log: false })
    assert.deepEqual(q.weakLinks.map(x => [x.table, x.ratePct]), [['跟进', 12.5]])
  })

  it('点了「先这样用」以后才算准备好', async () => {
    await ds.ackData(id)
    const st = await ds.status(id)
    assert.equal(st.step, 'ready')
    assert.equal(st.data.broken, false)
    assert.deepEqual(st.data.problems, [])
    assert.equal(st.data.links.touch.linked, 20)
  })

  it('同一张表改成线索：挂不上也不拦', async () => {
    const spec = base(src)
    spec.tables.push({ name: '跟进', source: src.visits, mode: 'snapshot', entities: { lead: { customerName: '姓名', channel: '渠道', date: '日期' } } }, calls(src))
    const saved = await ds.saveSpecDraft(id, spec)
    assert.equal(saved.trial.ok, true)
    assert.equal(saved.trial.counts.leads, 40)
    await ds.finalizeSpec(id, saved.revision)
    const built = await ds.build(id)
    assert.equal(built.gate, 'ok')
    assert.deepEqual(built.weakLinks, [])
    assert.equal((await ds.status(id)).step, 'ready')
  })
})
