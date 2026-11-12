// 「车主管理系统导出」预设：能被读出来；和原系统分析导出的示例表对得上；表里没有姓名和手机号；
// 从导入到名单能跑通；名单按营销同意过滤；导出的名单带原系统的客户编号，能拿回原系统。
//
// 数据是 示例数据/车主系统示例（插件目录的上一层）里的五张表，全是编出来的。跑法：npm test
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadPresets } from '../lib/core/presets.js'
import { readFileBytes } from '../lib/core/read.js'
import { CONSENT, ENTITIES, REFS } from '../lib/core/spec.js'
import { Datasets } from '../lib/core/store.js'

const SAMPLES = fileURLToPath(new URL('../../示例数据/车主系统示例/', import.meta.url))
const AS_OF = '2026-10-26'
const TODAY = '2026-11-10'

// 预设里的五张表各用哪些列：就是原系统的分析导出要给的列。
const TABLES = [
  {
    name: '客户', mode: 'snapshot',
    entities: { customer: { id: '客户编号', city: '城市', consent: '营销同意', firstSeen: '建档日期', owner: '服务门店' } },
    // 自定义字段的 key 是预设里分层和标记要用的，写在预设「客户」表的说明里
    extra: [
      { entity: 'customer', key: 'ctype', name: '客户类型', column: '客户类型', type: 'category' },
      { entity: 'customer', key: 'stage', name: '售前阶段', column: '售前阶段', type: 'category' },
      { entity: 'customer', key: 'remind_first', name: '首保提醒', column: '首保提醒', type: 'category' },
      { entity: 'customer', key: 'remind_periodic', name: '保养提醒', column: '保养提醒', type: 'category' },
      { entity: 'customer', key: 'remind_preseason', name: '季前检查提醒', column: '季前检查提醒', type: 'category' },
      { entity: 'customer', key: 'remind_storage', name: '季末封存提醒', column: '季末封存提醒', type: 'category' },
      { entity: 'customer', key: 'licence_end', name: '驾驶证到期', column: '驾驶证到期', type: 'date' },
    ],
  },
  { name: '车辆', mode: 'snapshot', entities: { asset: { customerId: '客户编号', serial: { column: '车架号', as: 'id' }, model: '车型', type: '产品线', start: '交车日期', end: '保修到期', owner: '销售门店' } } },
  { name: '服务记录', mode: 'append', entities: { transaction: { orderNo: '记录编号', customerId: '客户编号', assetSerial: '车架号', date: '服务日期', type: '服务类型', owner: '门店' } } },
  { name: '互动', mode: 'append', entities: { touch: { customerId: '客户编号', channel: '渠道', date: '日期', campaign: '活动' } } },
  { name: '活动', mode: 'snapshot', entities: { campaign: { name: '活动名称', type: '类型', start: '开始', end: '结束', budget: '预算' } } },
]

const sample = name => {
  const file = join(SAMPLES, `${name}.csv`)
  assert.ok(existsSync(file), `找不到示例表：${file}`)
  const bytes = readFileSync(file)
  const [header, ...rows] = readFileBytes(`${name}.csv`, new Uint8Array(bytes)).sheets[0].rows
  return { bytes, header, rows, column: title => rows.map(r => r[header.indexOf(title)]) }
}

describe('车主管理系统导出的预设', () => {
  let preset
  before(async () => {
    const { presets, problems } = await loadPresets()
    assert.deepEqual(problems, [])
    preset = presets.find(p => p.id === 'owner-system')
  })

  it('能读出来，排在动力运动后面', async () => {
    assert.ok(preset)
    const ids = (await loadPresets()).presets.map(p => p.id)
    assert.deepEqual(ids, ['education', 'powersports', 'dealer-network', 'owner-system', 'blank'])
  })

  it('认人只按客户编号和车架号，不靠姓名手机号', () => {
    assert.deepEqual(preset.identity.map(r => r.keys), [['customer.id'], ['asset.serial']])
    const secret = Object.entries(ENTITIES.customer.fields).filter(([, f]) => f.secret).map(([k]) => `customer.${k}`)
    for (const key of secret) assert.equal(preset.columnHints[key], undefined, `${key} 不该出现在预设里`)
  })

  it('分层和标记用到的自定义字段，都是「客户」表说明里写了的', () => {
    const used = new Set()
    const walk = node => { for (const k of ['all', 'any']) for (const c of node[k] ?? []) (c.all || c.any ? walk(c) : (c.args ?? []).forEach(a => typeof a === 'string' && a.startsWith('extra.') && used.add(a.slice(6)))) }
    for (const rule of [...preset.segments, ...preset.flags]) walk(rule)
    const declared = TABLES[0].extra.map(x => x.key)
    assert.deepEqual([...used].sort(), declared.filter(k => k !== 'ctype').sort())
  })

  it('六种售后提醒各有一个标记和一个名单用途', () => {
    assert.deepEqual(preset.flags.map(f => f.name), ['该做首保', '该做保养', '保修将到期', '该季前检查', '该季末封存', '驾驶证将到期'])
    for (const purpose of ['首保提醒', '保养提醒', '保修到期', '季前检查', '季末封存', '驾驶证到期']) assert.ok(preset.lists.purposes.includes(purpose), `少了用途「${purpose}」`)
    assert.ok(preset.flags.every(f => f.desc.includes('待确认')), '借原系统的规则都要标待确认')
  })

  it('哪些用途算服务联系留空，等业务定', () => {
    assert.deepEqual(preset.lists.servicePurposes, [])
  })

  it('每张表要用的列，示例导出里都有，预设也都认得', () => {
    assert.deepEqual(preset.tableHints.map(t => t.name), TABLES.map(t => t.name))
    for (const table of TABLES) {
      const { header } = sample(table.name)
      for (const [entity, fields] of Object.entries(table.entities)) {
        for (const [field, value] of Object.entries(fields)) {
          const column = typeof value === 'string' ? value : value.column
          assert.ok(header.includes(column), `示例表「${table.name}」里没有「${column}」这一列`)
          // 指向客户、车辆的列（客户编号、车架号）按被指的那个字段认
          const key = REFS[field] ? REFS[field].target : `${entity}.${field}`
          assert.ok(preset.columnHints[key]?.includes(column), `预设的 ${key} 不认「${column}」`)
        }
      }
      const hint = preset.tableHints.find(t => t.name === table.name).hint
      for (const x of table.extra ?? []) {
        assert.ok(header.includes(x.column), `示例表「${table.name}」里没有「${x.column}」这一列`)
        assert.ok(hint.includes(x.column) && hint.includes(x.key), `预设「${table.name}」的说明里要写明「${x.column}」对成 ${x.key}`)
      }
    }
  })

  it('示例导出里没有姓名和手机号', () => {
    for (const { name } of TABLES) {
      const { header, rows } = sample(name)
      for (const title of header) assert.doesNotMatch(title, /姓名|称呼|车主|手机|电话|微信|证件/, `「${name}」不该有「${title}」这一列`)
      for (const row of rows) for (const cell of row) assert.doesNotMatch(cell, /^1\d{10}$/, `「${name}」里有像手机号的内容`)
    }
  })

  it('示例导出里的取值，预设的字典都认得', () => {
    const known = key => new Set(Object.entries(preset.dictionaries[key]).flatMap(([standard, writings]) => [standard, ...writings]))
    const check = (table, column, key) => {
      for (const v of new Set(sample(table).column(column))) if (v !== '') assert.ok(known(key).has(v), `「${table}」的「${column}」里有预设不认得的「${v}」`)
    }
    check('客户', '营销同意', 'customer.consent')
    check('客户', '售前阶段', 'customer.extra.stage')
    check('车辆', '产品线', 'asset.type')
    check('服务记录', '服务类型', 'transaction.type')
    check('互动', '渠道', 'touch.channel')
  })

  describe('用示例导出从头跑一遍', () => {
    let dir, ds, id, built, customers
    before(async () => {
      dir = mkdtempSync(join(tmpdir(), 'crm-ops-ums-'))
      ds = new Datasets({ documentsDir: dir, today: () => TODAY })
      ;({ id } = await ds.create({ name: '车主系统示例', preset: 'owner-system' }))
      const spec = await ds.starter(id)
      spec.tables = []
      for (const table of TABLES) {
        const source = await ds.importFile(id, `${table.name}.csv`, sample(table.name).bytes)
        spec.tables.push({ ...structuredClone(table), source: source.id })
      }
      await ds.setAsOf(id, AS_OF)
      await ds.markChecked(id)
      const { revision } = await ds.saveSpecDraft(id, spec)
      await ds.finalizeSpec(id, revision)
      built = await ds.build(id)
      customers = sample('客户')
    })
    after(() => rmSync(dir, { recursive: true, force: true }))

    it('每一行都读进来了，没有要人工复核的', async () => {
      assert.equal(built.rowsOk, true)
      assert.equal(built.parseProblems, 0)
      assert.equal(built.counts.customers, customers.rows.length)
      assert.equal(built.counts.assets, sample('车辆').rows.length)
      assert.equal(built.counts.transactions, sample('服务记录').rows.length)
      assert.equal(built.counts.touches, sample('互动').rows.length)
      assert.equal((await ds.review(id)).open, 0)
    })

    it('客户按编号认，没有姓名和手机号', async () => {
      const { rows, total } = await ds.customers(id, { limit: 1000 })
      assert.equal(total, customers.rows.length)
      assert.deepEqual(rows.map(r => r.id).sort(), customers.column('客户编号').sort())
      assert.ok(rows.every(r => r.name === null && r.phone === null))
    })

    it('分层把每个人都分到了：没买车的按售前阶段分，买了车的按车主分', async () => {
      const { segments } = await ds.overview(id)
      const count = Object.fromEntries(segments.rows.map(r => [r.name, r.count]))
      const owners = new Set(sample('车辆').column('客户编号'))
      const stageOf = new Map(customers.rows.map(r => [r[0], r[customers.header.indexOf('售前阶段')]]))
      const leads = [...stageOf].filter(([cid]) => !owners.has(cid)).map(([, stage]) => stage)
      for (const stage of ['新线索', '已联系', '已试驾', '商谈中', '战败']) assert.equal(count[stage], leads.filter(x => x === stage).length, `「${stage}」人数不对`)
      assert.equal(count.潜客, leads.filter(x => x === '').length)
      assert.equal(count.其他, 0)
      assert.equal(count.新车主 + count.活跃车主 + count.沉睡车主, owners.size) // 成交的客户有车，算在车主各层里
      assert.ok(count.新线索 > 0 && count.新车主 > 0 && count.活跃车主 > 0 && count.沉睡车主 > 0)
    })

    it('提醒标记的人数和原系统导出里的「是」对得上', async () => {
      const { segments } = await ds.overview(id)
      const count = Object.fromEntries(segments.flags.map(f => [f.name, f.count]))
      const yes = column => customers.column(column).filter(v => v === '是').length
      assert.equal(count.该做首保, yes('首保提醒'))
      assert.equal(count.该做保养, yes('保养提醒'))
      assert.equal(count.该季前检查, yes('季前检查提醒'))
      assert.equal(count.该季末封存, yes('季末封存提醒'))
      // 驾驶证：60 天内到期，或过期不到一年
      const days = d => Math.round((Date.parse(AS_OF) - Date.parse(d)) / 86400000)
      assert.equal(count.驾驶证将到期, customers.column('驾驶证到期').filter(d => d !== '' && days(d) >= -60 && days(d) <= 365).length)
      assert.ok(count.该做首保 > 0 && count.该季末封存 > 0 && count.驾驶证将到期 > 0)
      assert.ok(count.保修将到期 >= 0)
    })

    it('按提醒标记挑人，默认用途就是对应的提醒', async () => {
      for (const [flag, purpose] of [['该做首保', '首保提醒'], ['该做保养', '保养提醒'], ['保修将到期', '保修到期'], ['该季前检查', '季前检查'], ['该季末封存', '季末封存'], ['驾驶证将到期', '驾驶证到期']]) {
        assert.equal((await ds.listPool(id, { flag })).purpose, purpose)
      }
      assert.equal((await ds.listPool(id, { segment: '新线索' })).purpose, '线索跟进')
    })

    it('配置里没对上这些自定义字段时会报错，不会悄悄不生效', async () => {
      const spec = await ds.currentSpec(id)
      spec.tables[0].extra = spec.tables[0].extra.filter(x => x.key !== 'stage')
      delete spec.dictionaries['customer.extra.stage']
      await assert.rejects(ds.saveSpecDraft(id, spec), e => e.code === 'bad-spec' && e.details.errors.some(x => /segments\[0\]/.test(x.path)))
    })

    it('营销名单只留原系统里「同意」的客户', async () => {
      const agreed = customers.rows.filter(r => r[customers.header.indexOf('营销同意')] === CONSENT.granted).map(r => r[0]).sort()
      const pool = await ds.listPool(id, { purpose: '活动邀约' })
      assert.deepEqual(pool.consent, { tracked: true, needed: true })
      assert.equal(pool.kept, agreed.length)
      assert.equal(pool.excluded.consent, customers.rows.length - agreed.length)
      assert.ok(pool.preview.every(p => p.name === null && agreed.includes(p.id)))
    })

    it('导出的名单带原系统的客户编号，没有姓名手机号可带', async () => {
      const agreed = customers.rows.filter(r => r[customers.header.indexOf('营销同意')] === CONSENT.granted).map(r => r[0]).sort()
      const made = await ds.createBatch(id, { pick: {}, purpose: '活动邀约', to: 'excel', withPhone: true })
      const book = readFileBytes('名单.xlsx', new Uint8Array(readFileSync(made.exported.file)))
      const [header, ...rows] = book.sheets[0].rows
      assert.deepEqual(rows.map(r => r[header.indexOf('原系统编号')]).sort(), agreed)
      assert.ok(rows.every(r => r[header.indexOf('姓名')] === '' && r[header.indexOf('手机')] === ''))
      assert.ok(book.sheets[1].rows.some(r => r[0] === '原系统编号'))
      const members = (await ds.batch(id, made.id)).members
      assert.deepEqual(members.map(m => m.id).sort(), agreed)
    })
  })
})

describe('名单导出的原系统编号', () => {
  let dir
  before(() => { dir = mkdtempSync(join(tmpdir(), 'crm-ops-srcid-')) })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('配置里没有客户编号这一列时，导出不多出这一列', async () => {
    const samples = fileURLToPath(new URL('../../示例数据/动力运动示例/', import.meta.url))
    const book = readFileBytes('车辆和工单.xlsx', new Uint8Array(readFileSync(join(samples, '车辆和工单.xlsx'))))
    const csv = name => Buffer.from(book.sheets.find(s => s.name === name).rows.map(r => r.join(',')).join('\n'), 'utf8')
    const ds = new Datasets({ documentsDir: dir, today: () => TODAY })
    const { id } = await ds.create({ name: '没有编号', preset: 'powersports' })
    const vehicles = await ds.importFile(id, '车辆.csv', csv('车辆'))
    const orders = await ds.importFile(id, '工单.csv', csv('工单'))
    await ds.setAsOf(id, AS_OF)
    await ds.markChecked(id)
    const spec = await ds.starter(id)
    spec.tables = [
      { name: '车辆', mode: 'snapshot', source: vehicles.id, entities: { customer: { name: '车主', phone: '手机', owner: '经销商' }, asset: { serial: { column: '车架号', as: 'vin' }, model: '车型', start: '交车日期', end: '保修到期' } } },
      { name: '工单', mode: 'append', source: orders.id, entities: { transaction: { orderNo: '工单号', assetSerial: '车架号', date: '进厂日期', type: '工单类型', amount: '金额', status: '状态' } } },
    ]
    const { revision } = await ds.saveSpecDraft(id, spec)
    await ds.finalizeSpec(id, revision)
    await ds.build(id)
    const made = await ds.createBatch(id, { pick: {}, purpose: '活动邀约', to: 'excel' })
    const sheets = readFileBytes('名单.xlsx', new Uint8Array(readFileSync(made.exported.file))).sheets
    assert.deepEqual(sheets[0].rows[0], ['客户编号', '姓名', '现在在哪一层', '经销商', '原因', '联系完', '结果（联系后填）'])
    assert.ok(!sheets[1].rows.some(r => r[0] === '原系统编号'))
  })
})
