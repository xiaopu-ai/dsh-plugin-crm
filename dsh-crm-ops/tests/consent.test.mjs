// 营销同意过滤：名单只留「同意」的人；服务联系的用途不过滤；没有同意列不过滤；
// 一个人几条记录状态不一样时取最严；同意字典和 lists.servicePurposes 写错会报错。
//
// 数据来自 示例数据/动力运动示例（插件目录的上一层），在临时目录里加上「营销同意」列再导入，
// 不碰「文稿」里的数据集。跑法：npm test
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { poolOf } from '../lib/core/lists.js'
import { readFileBytes } from '../lib/core/read.js'
import { CONSENT, checkSpec, consentNeeded, tracksConsent } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'

const SAMPLES = fileURLToPath(new URL('../../示例数据/动力运动示例/', import.meta.url))
const AS_OF = '2026-10-26'
const TODAY = '2026-11-10'
const MARKETING = '活动邀约'
const SERVICE = '首保提醒'

// 原表里的写法 → 清洗后的标准值。第 i 辆车用第 i % 10 个；空着和看不懂的写法都读成没记录。
const WRITINGS = [
  ['同意', CONSENT.granted], ['已授权', CONSENT.granted], ['是', CONSENT.granted],
  ['拒绝', CONSENT.denied], ['否', CONSENT.denied],
  ['退订', CONSENT.withdrawn], ['已撤回', CONSENT.withdrawn],
  ['', null], ['再说吧', null],
  ['Y', CONSENT.granted],
]

// 第二张表（会员）里和车辆表不一样的状态：[车辆表第几行, 会员表的写法, 合并后应该是什么]
const CONFLICTS = [
  [0, '撤回', CONSENT.withdrawn], // 同意 + 撤回 → 撤回
  [1, '拒绝', CONSENT.denied], // 同意 + 拒绝 → 拒绝
  [3, '同意', CONSENT.denied], // 拒绝 + 同意 → 拒绝
  [5, '拒绝', CONSENT.withdrawn], // 撤回 + 拒绝 → 撤回
  [2, '同意', CONSENT.granted], // 两张表都同意 → 同意
  [7, '同意', CONSENT.granted], // 一张表空着、另一张同意 → 同意
]

const csv = rows => Buffer.from(rows.map(r => r.join(',')).join('\n'), 'utf8')

/** The sample workbook's sheets and the touch file, as row arrays with the header first. */
function samples() {
  assert.ok(existsSync(SAMPLES), `找不到示例数据：${SAMPLES}`)
  const book = readFileBytes('车辆和工单.xlsx', new Uint8Array(readFileSync(join(SAMPLES, '车辆和工单.xlsx'))))
  const sheet = name => book.sheets.find(s => s.name === name).rows
  return { vehicles: sheet('车辆'), orders: sheet('工单'), touches: readFileSync(join(SAMPLES, '互动.csv')) }
}

/** The powersports preset with the three sample tables mapped, as a person would finalize it. */
function specOf(starter, { consent, members, servicePurposes, dictionary }) {
  const spec = structuredClone(starter)
  spec.tables = [
    { name: '车辆', mode: 'snapshot', source: '车辆', entities: { customer: { name: '车主', phone: '手机', owner: '经销商', ...(consent ? { consent: '营销同意' } : {}) }, asset: { serial: { column: '车架号', as: 'vin' }, model: '车型', start: '交车日期', end: '保修到期', owner: '经销商' } } },
    { name: '工单', mode: 'append', source: '工单', entities: { transaction: { orderNo: '工单号', assetSerial: '车架号', date: '进厂日期', type: '工单类型', amount: '金额', status: '状态' } } },
    { name: '互动', mode: 'append', source: '互动', entities: { touch: { customerPhone: '手机', channel: '渠道', date: '日期', campaign: '活动' } } },
    ...(members ? [{ name: '会员', mode: 'snapshot', source: '会员', entities: { customer: { name: '车主', phone: '手机', consent: '营销同意' } } }] : []),
  ]
  spec.lists = { ...spec.lists, purposes: [MARKETING, SERVICE, '保修到期'], ...(servicePurposes ? { servicePurposes } : {}) }
  if (dictionary) spec.dictionaries = { ...spec.dictionaries, 'customer.consent': dictionary }
  return spec
}

/**
 * A dataset in a temporary 文稿 folder, built end to end from the sample tables.
 * @param {string} documentsDir - temporary directory standing in for 文稿.
 * @param {{ consent?: boolean, members?: boolean, servicePurposes?: string[] }} options -
 *   `consent` adds the 营销同意 column to the vehicle sheet; `members` adds a second customer
 *   sheet whose consent differs for some people.
 */
async function makeDataset(documentsDir, name, options = {}) {
  const ds = new Datasets({ documentsDir, today: () => TODAY })
  const { vehicles, orders, touches } = samples()
  const [header, ...rows] = vehicles
  const withConsent = options.consent ? [[...header, '营销同意'], ...rows.map((r, i) => [...r, WRITINGS[i % WRITINGS.length][0]])] : vehicles
  const { id } = await ds.create({ name, preset: 'powersports' })
  const sourceOf = {}
  const add = async (table, file, bytes) => { sourceOf[table] = (await ds.importFile(id, file, bytes)).id }
  await add('车辆', '车辆.csv', csv(withConsent))
  await add('工单', '工单.csv', csv(orders))
  await add('互动', '互动.csv', touches)
  if (options.members) await add('会员', '会员.csv', csv([['车主', '手机', '营销同意'], ...CONFLICTS.map(([i, writing]) => [rows[i][0], rows[i][1], writing])]))
  await ds.setAsOf(id, AS_OF)
  await ds.markChecked(id)
  const spec = specOf(await ds.starter(id), options)
  for (const t of spec.tables) t.source = sourceOf[t.source]
  const { revision } = await ds.saveSpecDraft(id, spec)
  await ds.finalizeSpec(id, revision)
  await ds.build(id)
  return { ds, id, owners: rows.map(r => r[0]) }
}

/** Everyone the pool of a purpose keeps and leaves out for consent, by name, with the pool itself. */
async function poolByName(ds, id, purpose) {
  const ctx = await ds.analysisContext(id)
  const pool = poolOf(ctx, { batches: [], left: {}, transfers: [], seq: 0 }, ctx.spec, { purpose, today: TODAY })
  const person = cid => ctx.index.get(cid).c
  return { ctx, pool, kept: pool.kept.map(person), noConsent: pool.excluded.consent.map(person) }
}

const names = people => people.map(c => c.name).sort()
const consentOf = async (ds, id, name) => {
  const { rows } = await ds.customers(id, { q: name })
  assert.equal(rows.length, 1, `「${name}」应该正好是一个客户`)
  return (await ds.customer(id, rows[0].cid)).customer.consent
}

describe('营销同意过滤', () => {
  let dir
  before(() => { dir = mkdtempSync(join(tmpdir(), 'crm-ops-consent-')) })
  after(() => rmSync(dir, { recursive: true, force: true }))

  describe('有同意列的数据集', () => {
    let ds, id, owners, expected
    before(async () => {
      ({ ds, id, owners } = await makeDataset(join(dir, 'a'), '带同意', { consent: true, servicePurposes: [SERVICE] }))
      expected = owners.filter((_, i) => WRITINGS[i % WRITINGS.length][1] === CONSENT.granted).sort()
    })

    it('原表的各种写法归到 同意 / 拒绝 / 撤回，空着和看不懂的算没记录', async () => {
      for (const [i, [writing, standard]] of WRITINGS.entries()) assert.equal(await consentOf(ds, id, owners[i]), standard, `「${writing}」应该读成 ${standard}`)
    })

    it('营销用途只留「同意」的人', async () => {
      const { pool, kept, noConsent } = await poolByName(ds, id, MARKETING)
      assert.deepEqual(pool.consent, { tracked: true, needed: true })
      assert.deepEqual(names(kept), expected)
      assert.ok(kept.every(c => c.consent === CONSENT.granted))
      assert.ok(noConsent.length > 0)
      assert.ok(noConsent.every(c => c.consent !== CONSENT.granted))
      // 车辆表里拒绝、撤回、空着、看不懂的车主都在被去掉的人里
      const out = new Set(names(noConsent))
      for (const [i, owner] of owners.entries()) if (WRITINGS[i % WRITINGS.length][1] !== CONSENT.granted) assert.ok(out.has(owner), `「${owner}」不该进营销名单`)
      assert.equal(pool.match, kept.length + noConsent.length)
    })

    it('生成名单的窗口和生成出来的名单数字一致', async () => {
      const shown = await ds.listPool(id, { purpose: MARKETING })
      assert.deepEqual(shown.consent, { tracked: true, needed: true })
      assert.equal(shown.kept, expected.length)
      assert.equal(shown.excluded.consent, shown.match - shown.kept)
      const made = await ds.createBatch(id, { pick: {}, purpose: MARKETING, to: 'excel' })
      assert.equal(made.people, expected.length)
      const batch = await ds.batch(id, made.id)
      assert.deepEqual(batch.members.map(m => m.name).sort(), expected)
    })

    it('服务用途不过滤', async () => {
      const { pool, kept, noConsent } = await poolByName(ds, id, SERVICE)
      assert.deepEqual(pool.consent, { tracked: true, needed: false })
      assert.equal(noConsent.length, 0)
      assert.equal(kept.length, pool.match)
      assert.ok(kept.some(c => c.consent === CONSENT.denied))
      assert.ok(kept.some(c => c.consent === CONSENT.withdrawn))
      assert.ok(kept.some(c => c.consent === null))
    })

    it('没列进 servicePurposes 的用途都按营销过滤', async () => {
      const { pool, kept } = await poolByName(ds, id, '保修到期')
      assert.deepEqual(pool.consent, { tracked: true, needed: true })
      assert.deepEqual(names(kept), expected)
    })

    it('客户详情带上「有没有同意列」', async () => {
      const { rows } = await ds.customers(id, { q: owners[0] })
      assert.equal((await ds.customer(id, rows[0].cid)).consentTracked, true)
    })
  })

  describe('没有同意列的数据集', () => {
    let ds, id
    before(async () => { ({ ds, id } = await makeDataset(join(dir, 'b'), '不带同意')) })

    it('不过滤，窗口说明没有这一列', async () => {
      const { pool, kept, noConsent, ctx } = await poolByName(ds, id, MARKETING)
      assert.equal(tracksConsent(ctx.spec), false)
      assert.deepEqual(pool.consent, { tracked: false, needed: false })
      assert.equal(noConsent.length, 0)
      assert.equal(kept.length, pool.match)
      assert.ok(kept.every(c => c.consent === null))
      const shown = await ds.listPool(id, { purpose: MARKETING })
      assert.deepEqual(shown.consent, { tracked: false, needed: false })
      assert.equal(shown.excluded.consent, 0)
      assert.equal(shown.kept, shown.match)
      const { rows } = await ds.customers(id, {})
      assert.equal((await ds.customer(id, rows[0].cid)).consentTracked, false)
    })

    it('没有同意列时配置里不会多出同意字典', async () => {
      assert.equal((await ds.currentSpec(id)).dictionaries['customer.consent'], undefined)
    })
  })

  describe('一个人在两张表里状态不一样', () => {
    let ds, id, owners
    before(async () => { ({ ds, id, owners } = await makeDataset(join(dir, 'c'), '两张表', { consent: true, members: true })) })

    it('取最严的：撤回 > 拒绝 > 同意', async () => {
      for (const [i, writing, standard] of CONFLICTS) {
        assert.equal(await consentOf(ds, id, owners[i]), standard, `车辆表「${WRITINGS[i][0] || '空'}」+ 会员表「${writing}」应该是 ${standard}`)
      }
    })

    it('名单按合并后的状态过滤', async () => {
      const { kept } = await poolByName(ds, id, MARKETING)
      const inList = new Set(names(kept))
      for (const [i, , standard] of CONFLICTS) assert.equal(inList.has(owners[i]), standard === CONSENT.granted, `「${owners[i]}」合并后是 ${standard}`)
    })
  })

  describe('配置写错会报错', () => {
    let ds, id, good
    before(async () => {
      ({ ds, id } = await makeDataset(join(dir, 'd'), '查错', { consent: true }))
      good = await ds.currentSpec(id)
    })
    const pathsOf = spec => checkSpec(structuredClone(spec)).errors.map(e => e.path)

    it('定稿的配置本身没有错，没写字典时补上一套常见写法', () => {
      assert.deepEqual(pathsOf(good), [])
      assert.deepEqual(Object.keys(good.dictionaries['customer.consent']).sort(), Object.values(CONSENT).sort())
    })

    it('同意字典的标准值写错会报错', async () => {
      const bad = { ...good, dictionaries: { ...good.dictionaries, 'customer.consent': { 同意: ['已授权'], 不确定: ['再说吧'] } } }
      const res = checkSpec(structuredClone(bad))
      assert.equal(res.ok, false)
      const hit = res.errors.find(e => e.path === 'dictionaries.customer.consent.不确定')
      assert.ok(hit, `应该指到写错的标准值，实际是：${res.errors.map(e => e.path).join('、')}`)
      assert.match(hit.message, /同意、拒绝、撤回/)
      await assert.rejects(ds.saveSpecDraft(id, structuredClone(bad)), e => e.code === 'bad-spec' && e.details.errors.some(x => x.path === 'dictionaries.customer.consent.不确定'))
    })

    it('同意字典只用三个标准值、换自己的写法是可以的', () => {
      const own = { ...good, dictionaries: { ...good.dictionaries, 'customer.consent': { 同意: ['OK'], 拒绝: ['不要'], 撤回: ['TD'] } } }
      assert.deepEqual(pathsOf(own), [])
    })

    it('lists.servicePurposes 里写了不存在的用途会报错', async () => {
      const bad = { ...good, lists: { ...good.lists, servicePurposes: [SERVICE, '保养提醒'] } }
      const res = checkSpec(structuredClone(bad))
      assert.equal(res.ok, false)
      assert.deepEqual(res.errors.map(e => e.path), ['lists.servicePurposes[1]'])
      assert.match(res.errors[0].message, /保养提醒/)
      await assert.rejects(ds.saveSpecDraft(id, structuredClone(bad)), e => e.code === 'bad-spec')
    })

    it('不写 servicePurposes 时默认一个都不算服务联系', () => {
      const res = checkSpec(structuredClone({ ...good, lists: { ...good.lists, servicePurposes: undefined } }))
      assert.equal(res.ok, true)
      assert.deepEqual(res.spec.lists.servicePurposes, [])
      for (const purpose of res.spec.lists.purposes) assert.equal(consentNeeded(res.spec, purpose), true)
    })
  })
})
