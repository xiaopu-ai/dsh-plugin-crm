// Made-up tables for the dealer-network preset: a full customer list, deliveries, sales opportunities and the
// sign-up sheet of one event. Every person, dealer, brand and number is invented; phone numbers are in the
// 138-0000 test range. The column names are the ones the preset knows, so a dataset made from it is drafted in
// one step without a model.
// usage: node tools/make-dealer-samples.mjs <output dir>      (the shipped copy is 示例数据/经销商示例)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
if (!out) { console.error('usage: node tools/make-dealer-samples.mjs <output dir>'); process.exit(1) }
mkdirSync(out, { recursive: true })

let seed = 20261026
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = list => list[Math.floor(rnd() * list.length)]
const chance = p => rnd() < p
const AS_OF = Date.UTC(2026, 9, 26)
const DAY = 86400000
const day = ms => new Date(ms).toISOString().slice(0, 10)
const month = ms => new Date(ms).toISOString().slice(0, 7)
const stamp = ms => `${day(ms)} ${String(9 + Math.floor(rnd() * 9)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`
const addMonths = (ms, n) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime() }
const cell = c => (/[,"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)
const csv = rows => `﻿${rows.map(r => r.map(cell).join(',')).join('\n')}\n`
const pad = (n, w) => String(n).padStart(w, '0')
const CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'
const code = n => Array.from({ length: n }, () => CHARS[Math.floor(rnd() * CHARS.length)]).join('')

// Twelve dealers: code, short name, company name, region, regional manager, city, province.
// One has left the network and one has not opened yet; their customers are still in the list.
const DEALERS = [
  ['D001', '北京远途', '北京远途动力有限公司', '北区', '周经理', '北京', '北京'],
  ['D002', '天津海岸', '天津海岸动力有限公司', '北区', '周经理', '天津', '天津'],
  ['D003', '沈阳北原', '沈阳北原动力有限公司', '北区', '周经理', '沈阳', '辽宁'],
  ['D004', '哈尔滨雪岭', '哈尔滨雪岭动力有限公司', '北区', '周经理', '哈尔滨', '黑龙江'],
  ['D005', '上海澜途', '上海澜途动力有限公司', '中区', '吴经理', '上海', '上海'],
  ['D006', '苏州湖畔', '苏州湖畔动力有限公司', '中区', '吴经理', '苏州', '江苏'],
  ['D007', '成都西岭', '成都西岭动力有限公司', '中区', '吴经理', '成都', '四川'],
  ['D008', '广州南湾', '广州南湾动力有限公司', '南区', '郑经理', '广州', '广东'],
  ['D009', '深圳湾区', '深圳湾区动力有限公司', '南区', '郑经理', '深圳', '广东'],
  ['D010', '三亚海棠', '三亚海棠动力有限公司', '南区', '郑经理', '三亚', '海南'],
  ['D011', '青岛老港', '青岛老港动力有限公司', '退网', '', '青岛', '山东'],
  ['D012', '厦门新埠', '厦门新埠动力有限公司', '待开业', '郑经理', '厦门', '福建'],
]
const ACTIVE = DEALERS.filter(d => d[3] !== '退网' && d[3] !== '待开业')
const MODELS = [['远途 R1', '公路'], ['远途 T3', '公路'], ['远途 X 越野', '越野'], ['远途 探路者', '越野'], ['澜艇 S', '水上'], ['澜艇 巡航', '水上'], ['雪岭 登峰', '冰雪']]
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗'
const GIVEN = ['一诺', '子涵', '浩然', '雨桐', '思远', '佳怡', '俊杰', '欣然', '明轩', '梓萱', '宇航', '诗涵', '天佑', '可馨', '博文', '静怡', '志强', '晓彤', '建华', '丽娟']
const person = () => `${SURNAMES[Math.floor(rnd() * SURNAMES.length)]}${pick(GIVEN)}`

// ---- 全量客户表 ----------------------------------------------------------------------------------------------
// 360 rows. A quarter never bought (walk-ins and event guests filed as customers); a few are fleets or
// dealers' own accounts; ten people were filed twice, at two dealers, under the same phone number.
const customers = [['客户编号', '客户姓名', '联系电话', '省份', '城市', '经销商代码', '经销商简称', '大区', '客户类别', '最近交付年月', '购买产品线', '历史购买台数', '企微添加状态', '外呼结果', '小程序注册日期', '会员开通日期']]
const deliveries = [['交付单号', '交付日期', '产品线', '车型', '年款', '车架号', '终端客户', '经销商', '用途', '保修到期日', '首保权益状态', '首保生效日期', '首保失效日期']]
const people = []
let orderNo = 0
const deliver = (c, d, at, usage = '零售') => {
  const [model, line] = pick(MODELS)
  const warranty = addMonths(at, 24) - DAY
  const benefitEnd = addMonths(at, 6)
  // First-service benefit: used by two in three once a couple of months have passed; unused and past its date is "已过期".
  const used = AS_OF - at > 60 * DAY && chance(0.66)
  const status = usage !== '零售' ? '' : used ? '已使用' : benefitEnd < AS_OF ? '已过期' : '待使用'
  deliveries.push([`DN${pad(++orderNo, 5)}`, day(at), line, model, `${new Date(at).getUTCFullYear()} 款`, line === '水上' ? `TSH${code(9)}` : `TST${code(14)}`, `${c.id} ${c.name}`, `${d[0]} ${d[2]}`, usage, day(warranty), status, usage === '零售' ? day(at) : '', usage === '零售' ? day(benefitEnd) : ''])
  return line
}
for (let i = 1; i <= 350; i++) {
  const d = i % 29 === 0 ? DEALERS[10] : i % 97 === 0 ? DEALERS[11] : ACTIVE[i % ACTIVE.length]
  const kind = i % 41 === 0 ? '经销商' : i % 23 === 0 ? '运营户' : i % 37 === 0 ? '大客户' : '个人户'
  const name = kind === '个人户' ? person() : `${d[5]}${pick(['悦行', '乘风', '山海', '向野'])}${kind === '经销商' ? '商贸' : kind === '运营户' ? '俱乐部' : '文旅'}有限公司`
  const c = { id: `C${pad(i, 6)}`, name, phone: `138${pad(10000 + i, 8)}`, dealer: d, kind, lines: new Set(), units: 0, last: null }
  // Owners: bought between a month and four years ago. Fleets bought several. Deliveries older than two years
  // are not in the delivery table; the customer list still knows the month.
  const buyer = i % 4 !== 0 || kind !== '个人户'
  if (buyer) {
    const first = AS_OF - Math.floor(20 + ((i * 131) % 1400)) * DAY
    const count = kind === '运营户' ? 3 + (i % 3) : kind === '大客户' ? 2 : i % 9 === 0 ? 2 : 1
    for (let k = 0; k < count; k++) {
      const at = first - k * 75 * DAY
      c.units++
      c.last = Math.max(c.last ?? 0, at)
      if (AS_OF - at <= 730 * DAY) c.lines.add(deliver(c, d, at)); else c.lines.add(pick(MODELS)[1])
    }
  }
  people.push(c)
}
// Ten duplicates: the same person filed again at another dealer, with the same phone number.
for (let k = 0; k < 10; k++) {
  const src = people[k * 31 + 5]
  const d = ACTIVE[(k * 3 + 1) % ACTIVE.length]
  people.push({ ...src, id: `C${pad(351 + k, 6)}`, dealer: d, lines: new Set(), units: 0, last: null })
}
// Each dealer keeps two demo vehicles under its own account: not sales, the preset leaves them out.
for (const d of ACTIVE.slice(0, 6)) {
  const self = people.find(c => c.dealer === d && c.kind === '经销商') ?? people.find(c => c.dealer === d)
  deliver(self, d, AS_OF - Math.floor(40 + rnd() * 300) * DAY, '试乘试驾')
}
for (const c of people) {
  const owner = c.last !== null
  const recent = owner && AS_OF - c.last < 365 * DAY
  // New owners get added on chat and registered in the app at delivery; older ones were phoned instead.
  const added = owner ? chance(recent ? 0.62 : 0.2) : chance(0.05)
  const called = owner ? (chance(recent ? 0.1 : 0.34) ? (chance(0.5) ? '未接通,接通' : '接通') : chance(0.3) ? '未接通' : '') : ''
  // Nothing in the tables is dated after the cutoff.
  const app = owner && chance(recent ? 0.38 : 0.06) ? day(Math.min(AS_OF, c.last + Math.floor(rnd() * 30) * DAY)) : ''
  const member = app && chance(0.45) ? day(Math.min(AS_OF, Date.parse(app) + Math.floor(rnd() * 20) * DAY)) : ''
  const d = c.dealer
  customers.push([c.id, c.name, c.phone, d[6], d[5], d[0], d[1], d[3], c.kind, owner ? month(c.last) : '', [...c.lines].join(','), c.units || '', added ? '已建联' : owner ? '未建联' : '', called, app, member])
}

// ---- 销售机会 ------------------------------------------------------------------------------------------------
// 720 leads over the last twelve months, more in summer. One in four carries a phone number; some of those are
// people already in the customer list (owners looking at a second vehicle, or filed customers who never bought).
const CHANNELS = [['经销商线上', ['抖音直播', '抖音短视频', '小红书']], ['经销商线下', ['自然进店', '外展']], ['转介绍', ['朋友介绍', '车友介绍']], ['厂家线上', ['官网留资', '小程序留资']], ['厂家线下活动', ['试驾会', '车展']]]
const REPS = ['顾问甲', '顾问乙', '顾问丙', '顾问丁']
const opps = [['线索编号', '创建日期', '客户称呼', '手机号', '所属经销商', '区域经理', '销售顾问', '渠道来源', '来源明细', '市场活动', '意向产品', '机会级别', '是否试驾', '首次跟进日期', '最新跟进日期']]
const signups = [['线索编号', '留资日期', '客户称呼', '手机号', '所属经销商', '区域经理', '渠道来源', '来源明细', '意向产品', '机会级别', '是否试驾', '首次跟进日期', '最新跟进日期']]
const EVENT = '秋季试驾会'
const EVENT_DAY = Date.UTC(2026, 8, 19)
const nonBuyers = people.filter(c => c.last === null)
const owners = people.filter(c => c.last !== null && c.kind === '个人户')
for (let i = 1; i <= 720; i++) {
  const d = ACTIVE[(i * 7) % ACTIVE.length]
  // Created within the year, weighted to June through August.
  let at = AS_OF - Math.floor(rnd() * 365) * DAY
  if (chance(0.35)) at = Date.UTC(2026, 5, 1) + Math.floor(rnd() * 92) * DAY
  const fromEvent = i % 12 === 0
  if (fromEvent) at = EVENT_DAY + Math.floor(rnd() * 2) * DAY
  const [channel, sources] = fromEvent ? CHANNELS[4] : CHANNELS[i % 5 === 0 ? 2 : i % 5 === 1 ? 1 : i % 5 === 2 ? 3 : 0]
  const known = i % 9 === 0 ? pick(nonBuyers) : i % 14 === 0 ? pick(owners) : null
  const name = known ? known.name : person()
  const phone = known ? known.phone : chance(0.12) ? `138${pad(50000 + i, 8)}` : ''
  const age = (AS_OF - at) / DAY
  // Follow-up: two dealers are slow to start, one starts and then lets go. Referrals close far more often.
  const slow = d[0] === 'D010' || d[0] === 'D003'
  const lets = d[0] === 'D001'
  const followed = !(slow && chance(0.45)) && !chance(0.04)
  const first = followed ? at + (slow ? Math.floor(rnd() * 6) : chance(0.85) ? 0 : 1 + Math.floor(rnd() * 3)) * DAY : null
  const win = channel === '转介绍' ? 0.5 : channel === '经销商线下' ? 0.3 : channel === '厂家线下活动' ? 0.18 : 0.06
  let level
  if (!followed) level = pick(['不确定', '冷'])
  else if (age > 25 && chance(win)) level = '赢单'
  else if (age > 40 && chance(0.2)) level = '输单'
  else if (age > 120 && chance(0.35)) level = '休眠'
  else level = pick(['热', '温', '温', '冷', '不确定'])
  const open = !['赢单', '输单', '休眠'].includes(level)
  const last = first === null ? null : Math.min(AS_OF, open ? (lets && chance(0.75) ? first + Math.floor(rnd() * 3) * DAY : at + Math.floor(rnd() * Math.max(1, age)) * DAY) : first + Math.floor(rnd() * 30) * DAY)
  const trial = followed && (level === '赢单' ? chance(0.6) : chance(0.12))
  const row = [`LD${pad(i, 6)}`, stamp(at), name, phone, `${d[0]} ${d[2]}`, d[4], pick(REPS), channel, pick(sources), fromEvent ? EVENT : '', pick(MODELS)[0], level, trial ? 'Yes' : 'No', first === null ? '' : day(Math.min(first, AS_OF)), last === null ? '' : day(Math.max(last, first))]
  opps.push(row)
  if (fromEvent) signups.push([row[0], day(at), row[2], row[3], row[4], row[5], row[7], row[8], row[10], row[11], row[12] === 'Yes' ? '是' : '否', row[13], row[14]])
}

for (const [name, rows] of Object.entries({ 全量客户表: customers, 交付单: deliveries, 销售机会: opps, 活动报名: signups })) {
  writeFileSync(join(out, `${name}.csv`), csv(rows))
  console.log(name, rows.length - 1)
}
