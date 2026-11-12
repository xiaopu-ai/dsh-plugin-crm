// Made-up analysis-export tables of an owner management system, for the owner-system preset.
// No names, no phone numbers; brands and models are invented.
// usage: node tools/make-owner-system-samples.mjs <output dir>      (the shipped copy is 示例数据/车主系统示例)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
mkdirSync(out, { recursive: true })
let seed = 20261026
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = list => list[Math.floor(rnd() * list.length)]
const AS_OF = Date.UTC(2026, 9, 26)
const day = ms => new Date(ms).toISOString().slice(0, 10)
const addDays = (ms, n) => ms + n * 86400000
const addMonths = (ms, n) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime() }
const csv = rows => `﻿${rows.map(r => r.join(',')).join('\n')}\n`

const STORES = [['上海浦东店', '上海'], ['三亚海棠湾店', '三亚'], ['成都高新店', '成都'], ['哈尔滨亚布力店', '哈尔滨']]
const MODELS = [
  ['远途 R1', '公路', '远途'], ['远途 T3', '公路', '远途'], ['远途 T3 旅行版', '公路', '远途'],
  ['远途 X 越野', '越野', '远途'], ['远途 探路者', '越野', '远途'], ['远途 工作者', '越野', '远途'],
  ['澜艇 S', '水上', '澜艇'], ['澜艇 巡航', '水上', '澜艇'], ['澜艇 竞速', '水上', '澜艇'],
  ['雪岭 登峰', '冰雪', '雪岭'], ['雪岭 疾驰', '冰雪', '雪岭'],
]
const CONSENT = ['同意', '同意', '同意', '同意', '同意', '拒绝', '撤回', '']
const CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
const code = n => Array.from({ length: n }, () => CHARS[Math.floor(rnd() * CHARS.length)]).join('')

const customers = [['客户编号', '客户类型', '城市', '服务门店', '营销同意', '建档日期', '售前阶段', '首保提醒', '保养提醒', '季前检查提醒', '季末封存提醒', '驾驶证到期']]
const LEAD_STAGE = ['新线索', '已联系', '已试驾', '商谈中', '战败', '', '新线索', '已联系']
const vehicles = [['客户编号', '车架号', '车型', '产品线', '品牌', '交车日期', '保修到期', '销售门店']]
const services = [['记录编号', '客户编号', '车架号', '服务日期', '服务类型', '门店']]
const touches = [['客户编号', '渠道', '日期', '活动']]
const campaigns = [['活动名称', '类型', '开始', '结束', '预算'], ['三亚摩托艇体验日', '体验', '2026-08-15', '2026-08-16', '60000'], ['秋季三轮试驾会', '试驾', '2026-09-19', '2026-09-20', '45000']]
const EVENT_DAY = { 三亚摩托艇体验日: Date.UTC(2026, 7, 15), 秋季三轮试驾会: Date.UTC(2026, 8, 19) }

let serviceNo = 0
for (let i = 0; i < 40; i++) {
  const id = 1001 + i
  const [store, city] = STORES[i % STORES.length]
  const isLead = i >= 32
  const type = isLead ? '个人' : i % 11 === 0 ? '运营' : i % 13 === 0 ? '机构' : '个人'
  // Owners were delivered between 30 and 1000 days before the cutoff; leads were filed within the last 150 days.
  const delivered = addDays(AS_OF, -Math.floor(isLead ? 0 : 30 + (i * 173) % 970))
  const count = type === '运营' ? 3 : i % 9 === 4 ? 2 : 1
  // Later vehicles of one customer were delivered earlier, 20 days apart, so none lands after the cutoff.
  const filed = isLead ? addDays(AS_OF, -Math.floor(5 + rnd() * 145)) : addDays(delivered, -(count - 1) * 20 - Math.floor(rnd() * 40))
  // The reminder columns are what the source system would have worked out on the cutoff day (late October: boats go into storage, snow vehicles get prepared).
  const row = [id, type, city, store, CONSENT[i % CONSENT.length], day(filed), isLead ? LEAD_STAGE[i % LEAD_STAGE.length] : i % 6 === 5 ? '' : '成交', '', '', '', '', '']
  customers.push(row)
  const lines = new Set()
  const done = new Set()
  let lastService = null
  const talk = () => pick(['电话', '微信', '到店', '售后'])
  if (isLead) {
    touches.push([id, pick(['电话', '微信', '到店', '试驾']), day(addDays(filed, Math.floor(rnd() * 5))), ''])
    if (i % 2 === 0) touches.push([id, '活动签到', day(EVENT_DAY.秋季三轮试驾会), '秋季三轮试驾会'])
    continue
  }
  for (let k = 0; k < count; k++) {
    const [model, line, brand] = type === '运营' ? MODELS[6 + (k % 3)] : MODELS[(i + k * 3) % MODELS.length]
    const serial = line === '水上' ? `TSH${code(9)}` : `TST${code(14)}`
    const start = addDays(delivered, -k * 20)
    vehicles.push([id, serial, model, line, brand, day(start), day(addDays(addMonths(start, 12), -1)), store])
    lines.add(line)
    // Two owners in five never came back; the others had a first service and then one a year.
    if (i % 5 === 2 || i % 5 === 3) { if (AS_OF - start > 75 * 86400000) row[7] = '是'; continue }
    const first = addDays(start, 60 + Math.floor(rnd() * 40))
    if (first <= AS_OF) { services.push([`S${String(++serviceNo).padStart(4, '0')}`, id, serial, day(first), '首保', store]); lastService = Math.max(lastService ?? 0, first) } else if (AS_OF - start > 75 * 86400000) row[7] = '是'
    for (let at = addMonths(first, 12); at <= AS_OF; at = addMonths(at, 12)) { services.push([`S${String(++serviceNo).padStart(4, '0')}`, id, serial, day(at), '定期保养', store]); lastService = Math.max(lastService, at) }
    if (i % 7 === 0) { const at = addDays(start, 200); if (at <= AS_OF) services.push([`S${String(++serviceNo).padStart(4, '0')}`, id, serial, day(at), pick(['维修', '保修维修']), store]) }
    if ((line === '水上' || line === '冰雪') && i % 3 === 0) { const at = addDays(AS_OF, -20 - (i % 10)); if (at > start) { services.push([`S${String(++serviceNo).padStart(4, '0')}`, id, serial, day(at), line === '水上' ? '季末封存' : '季前检查', store]); done.add(line) } }
  }
  // Periodic service is due a year after the last one; the reminder starts 30 days before.
  if (lastService !== null && AS_OF - lastService > 335 * 86400000) row[8] = '是'
  if (lines.has('冰雪') && !done.has('冰雪') && AS_OF - delivered > 90 * 86400000) row[9] = '是'
  if (lines.has('水上') && !done.has('水上')) row[10] = '是'
  if (lines.has('水上') || lines.has('公路')) row[11] = day(addDays(AS_OF, (i * 37) % 500 - 60))
  if (i % 3 !== 2) touches.push([id, talk(), day(addDays(AS_OF, -Math.floor(rnd() * 400))), ''])
  if (i % 4 === 1 && city === '三亚') touches.push([id, '活动签到', day(EVENT_DAY.三亚摩托艇体验日), '三亚摩托艇体验日'])
  if (i % 6 === 0 && delivered < EVENT_DAY.秋季三轮试驾会) touches.push([id, '活动签到', day(EVENT_DAY.秋季三轮试驾会), '秋季三轮试驾会'])
}
for (const [name, rows] of Object.entries({ 客户: customers, 车辆: vehicles, 服务记录: services, 互动: touches, 活动: campaigns })) {
  writeFileSync(join(out, `${name}.csv`), csv(rows))
  console.log(name, rows.length - 1)
}
