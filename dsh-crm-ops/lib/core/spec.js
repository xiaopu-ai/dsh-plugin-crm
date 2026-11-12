/**
 * 配置: the closed vocabulary of the standard data model, and `checkSpec`,
 * the one gate every preset and every configuration passes.
 *
 * Nothing in this file names an industry. A configuration says which columns
 * of which tables feed which standard fields, how category values map to
 * standard values, how people are recognized, what counts (refunds, statuses,
 * duplicates), how people fall into segments, and what a follow-up list can
 * end in. Presets are configurations without tables.
 *
 * `checkSpec` returns plain-Chinese errors with a path and a fix, because the
 * model repairs its own drafts from them.
 */

export const SPEC_SCHEMA = 1

const F = (name, type, role, extra = {}) => Object.freeze({ name, type, role, ...extra })

/**
 * The six entities. `type` decides how a value is cleaned; `role` decides how
 * profiling, merging and metrics use it; `secret` fields never reach a model.
 */
export const ENTITIES = Object.freeze({
  customer: Object.freeze({
    name: '客户', required: true,
    fields: Object.freeze({
      id: F('编号', 'id', 'key'),
      name: F('姓名', 'name', 'name', { secret: true }),
      phone: F('手机', 'phone', 'key', { secret: true }),
      wechat: F('企微 ID', 'id', 'key', { secret: true }),
      idcard: F('证件号', 'idcard', 'key', { secret: true }),
      city: F('城市', 'category', 'category'),
      gender: F('性别', 'category', 'category'),
      birthday: F('生日', 'date', 'time'),
      channel: F('来源渠道', 'category', 'category'),
      consent: F('营销同意', 'category', 'category'),
      firstSeen: F('首次出现', 'date', 'time'),
      owner: F('归属方', 'category', 'relation'),
    }),
  }),
  transaction: Object.freeze({
    name: '交易', required: true, refs: true,
    fields: Object.freeze({
      orderNo: F('来源单号', 'id', 'key'),
      payerName: F('付款人', 'name', 'name', { secret: true }),
      payerPhone: F('付款人手机', 'phone', 'contact', { secret: true }),
      type: F('类型', 'category', 'category'),
      amount: F('金额', 'money', 'amount'),
      date: F('时间', 'date', 'time'),
      status: F('状态', 'category', 'status'),
      channel: F('渠道', 'category', 'category'),
      owner: F('归属方', 'category', 'relation'),
    }),
  }),
  asset: Object.freeze({
    name: '持有物', refs: true,
    fields: Object.freeze({
      id: F('编号', 'id', 'key'),
      serial: F('识别号', 'serial', 'key', { secret: true }),
      type: F('类型', 'category', 'category'),
      model: F('型号', 'category', 'category'),
      start: F('开始时间', 'date', 'time'),
      end: F('结束时间', 'date', 'time'),
      status: F('状态', 'category', 'status'),
      owner: F('归属方', 'category', 'relation'),
    }),
  }),
  touch: Object.freeze({
    name: '互动', refs: true,
    fields: Object.freeze({
      channel: F('渠道', 'category', 'category'),
      action: F('动作', 'category', 'category'),
      date: F('时间', 'date', 'time'),
      campaign: F('活动', 'category', 'relation'),
    }),
  }),
  // A lead (线索、商机、留资、报名、咨询): one row per expressed interest, with its own funnel. It finds its
  // customer when a strong key is there (phone, code) and stands on its own when none is: an export without
  // contact details still answers how many came in, from where, how fast they were followed and how many won.
  lead: Object.freeze({
    name: '线索', refs: 'optional',
    fields: Object.freeze({
      id: F('线索编号', 'id', 'key'),
      date: F('留资时间', 'datetime', 'time'),
      result: F('结果', 'category', 'status'),
      level: F('级别', 'category', 'category'),
      channel: F('来源渠道', 'category', 'category'),
      source: F('来源明细', 'category', 'category'),
      campaign: F('活动', 'category', 'relation'),
      product: F('意向产品', 'category', 'category'),
      trial: F('体验', 'category', 'category'),
      owner: F('归属方', 'category', 'relation'),
      rep: F('跟进人', 'category', 'category'),
      firstFollow: F('首次跟进', 'datetime', 'time'),
      lastFollow: F('最近跟进', 'datetime', 'time'),
      wonDate: F('成交时间', 'datetime', 'time'),
    }),
  }),
  campaign: Object.freeze({
    name: '活动',
    fields: Object.freeze({
      name: F('名称', 'category', 'key'),
      type: F('类型', 'category', 'category'),
      start: F('开始', 'date', 'time'),
      end: F('结束', 'date', 'time'),
      budget: F('预算', 'money', 'amount'),
      channel: F('渠道', 'category', 'category'),
    }),
  }),
  // 归属方 (a store, a dealer, a campus): who a customer, a deal or a lead belongs to. Tables often write the
  // same one differently (a code, a short name, the registered company name); rows that share an `id` are one
  // 归属方, and every `owner` value elsewhere that equals its id or any of its names reads as its first name.
  owner: Object.freeze({
    name: '归属方',
    fields: Object.freeze({
      id: F('编号', 'id', 'key'),
      name: F('名称', 'category', 'key'),
      type: F('类型', 'category', 'category'),
      city: F('城市', 'category', 'category'),
    }),
  }),
})

/** Fields that point a transaction, asset or touch at its customer. */
export const REFS = Object.freeze({
  customerId: F('客户编号', 'id', 'ref', { target: 'customer.id' }),
  customerName: F('客户姓名', 'name', 'ref', { target: 'customer.name', secret: true }),
  customerPhone: F('客户手机', 'phone', 'ref', { target: 'customer.phone', secret: true }),
  customerIdcard: F('客户证件号', 'idcard', 'ref', { target: 'customer.idcard', secret: true }),
  customerWechat: F('客户企微 ID', 'id', 'ref', { target: 'customer.wechat', secret: true }),
  assetSerial: F('持有物识别号', 'serial', 'ref', { target: 'asset.serial', secret: true }),
  assetId: F('持有物编号', 'id', 'ref', { target: 'asset.id' }),
})

/** Types a custom field may have. Text fields are hidden from the model unless the person opens them. */
export const EXTRA_TYPES = Object.freeze({ category: '类别', tags: '多值标签：一格里用逗号、顿号隔开的几个值，每个值各算一个标签', number: '数字', money: '金额', date: '日期', text: '文字', id: '编号' })
/** Extra types whose values go through a dictionary. */
export const DICT_TYPES = Object.freeze(['category', 'tags'])
/** How a `serial` column is checked. */
export const SERIAL_AS = Object.freeze({ vin: 'VIN（17 位，校验第 9 位）', idcard: '身份证号（校验最后一位）', id: '普通编号' })
/** Keys identity rules may combine. */
export const IDENTITY_KEYS = Object.freeze(['customer.id', 'customer.phone', 'customer.idcard', 'customer.wechat', 'customer.name', 'customer.city', 'customer.birthday', 'asset.serial', 'asset.id'])
const STRONG_KEYS = new Set(['customer.id', 'customer.phone', 'customer.idcard', 'customer.wechat', 'asset.serial', 'asset.id'])

/** Import mode of a table: a full snapshot replaces the last one; append keeps the old rows and adds new ones. */
export const MODES = Object.freeze({ snapshot: '快照：每次导出全部历史，新的整体替换旧的', append: '追加：每次只导出最近一段，只加新的' })

/**
 * Derived features (closed list). Every "days" counts back from the dataset's cutoff.
 * Args: window = days (1～3650); period = year | quarter | month; txnType = one or several
 * values of the `transaction.type` dictionary; touchChannel = values of `touch.channel`;
 * customerField = a customer category field or custom field key.
 */
export const FEATURES = Object.freeze({
  days_since_last_txn: { name: '距最近一次交易多少天', needs: 'transaction', args: [{ kind: 'txnType', optional: true }], value: 'number' },
  txn_count: { name: '窗口内交易次数', needs: 'transaction', args: [{ kind: 'window' }, { kind: 'txnType', optional: true }], value: 'number' },
  amount: { name: '窗口内交易金额（元）', needs: 'transaction', money: true, args: [{ kind: 'window' }, { kind: 'txnType', optional: true }], value: 'number' },
  active_periods: { name: '窗口内有交易的周期数', needs: 'transaction', args: [{ kind: 'window' }, { kind: 'period' }, { kind: 'txnType', optional: true }], value: 'number' },
  days_since_first_seen: { name: '距首次出现多少天', needs: 'customer', args: [], value: 'number' },
  asset_count: { name: '持有物数量', needs: 'asset', args: [], value: 'number', where: true },
  asset_age_days: { name: '最早一件持有物持有了多少天', needs: 'asset', args: [], value: 'number', where: true },
  asset_days_to_end: { name: '最近一件持有物还有多少天结束（负数表示已结束）', needs: 'asset', args: [], value: 'number', where: true },
  days_since_last_touch: { name: '距最近一次互动多少天', needs: 'touch', args: [{ kind: 'touchChannel', optional: true }], value: 'number' },
  touch_count: { name: '窗口内互动次数', needs: 'touch', args: [{ kind: 'window' }, { kind: 'touchChannel', optional: true }], value: 'number' },
  campaign_count: { name: '窗口内参加过几次活动', needs: 'touch', args: [{ kind: 'window' }], value: 'number' },
  has_txn: { name: '有没有过某类交易', needs: 'transaction', args: [{ kind: 'txnType', optional: true }], value: 'boolean' },
  field: { name: '客户的某个字段', needs: 'customer', args: [{ kind: 'customerField' }], value: 'any' },
  tag_count: { name: '客户某个多值标签字段里有几个值', needs: 'customer', args: [{ kind: 'customerTagField' }], value: 'number' },
  days_since_field: { name: '距客户某个日期字段多少天（一格写了几个日期就看最近的）', needs: 'customer', args: [{ kind: 'customerDateField' }], value: 'number' },
  lead_count: { name: '窗口内的线索数（可只数某种结果）', needs: 'lead', args: [{ kind: 'window' }, { kind: 'leadResult', optional: true }], value: 'number' },
  days_since_last_lead: { name: '距最近一条线索多少天', needs: 'lead', args: [], value: 'number' },
  has_lead: { name: '有没有某种结果的线索', needs: 'lead', args: [{ kind: 'leadResult', optional: true }], value: 'boolean' },
})
export const OPS = Object.freeze(['=', '!=', '>', '>=', '<', '<=', 'between', 'in', 'has', 'lacks'])
/** Comparisons a `where` condition on one holding may use. */
export const WHERE_OPS = Object.freeze(['=', '!=', '>', '>=', '<', '<=', 'between', 'in'])
/** Comparisons that only make sense on a multi-value (tags) field. */
const TAG_OPS = Object.freeze(['has', 'lacks'])

/**
 * What a segment or a tag is, when its rule alone does not say. The board reads a rule's shape to tell a
 * lapsing group from an active one; "more than a year since the last deal" is a loss where people come back
 * every few months and just a stage of ownership where they buy once in years. `kind` settles it.
 */
export const SEGMENT_KINDS = Object.freeze({
  lifecycle: '生命周期阶段：时间到了自然走到下一层，不算变好也不算变差',
  active: '活跃：到这一层算变好',
  lapsed: '流失或沉睡：掉进这一层算变差，要去拉回来',
  new: '新来的',
  valuable: '高价值：最值得维护',
  never: '有过接触，还没成交',
  deadline: '有明确的到期时间点',
  gap: '缺了某样东西（联系方式、建联）',
  reach: '触达渠道（只用在标记上）：带这个标记 = 能通过这个渠道联系上这个人（加了企微、电话接通过、注册了小程序）。看板按它算覆盖率，没带的人是缺口',
  plain: '只是分组，不分好坏',
})

/**
 * 行过滤: when a row of a table is left out before anything is read from it. A row is left out when any
 * filter matches. `in` / `not_in` compare the whole cell, `contains` looks inside it.
 */
export const SKIP_WHEN = Object.freeze({
  in: '这一列的值是 values 里的某一个',
  not_in: '这一列的值不是 values 里的任何一个（空着的也排除）：只留这几种',
  contains: '这一列的值里含有 values 里的某一段文字',
  filled: '这一列有值（比如「重复」标记列）',
  empty: '这一列是空的',
})
export const PERIODS = Object.freeze({ year: 365, quarter: 91, month: 30 })

/** What a follow-up result does to the person. The names come from the preset. */
export const OUTCOME_KINDS = Object.freeze({
  success: '成了：以交易为准，下次导入对上了才算',
  booked: '约好了：等交易确认，约定后 7 天还没有交易就算没来',
  decline: '不感兴趣：冷静期内不再因为这个原因进名单',
  unreachable: '联系不上：冷静期内不进新名单',
  transfer: '疑似转手：进复核，你确认后移到「已离开」',
  leave: '不要再联系：直接移到「已离开」',
})

/**
 * 营销同意: the three standard values of `customer.consent`. Only `granted` lets a person into a
 * list made for marketing; a refusal, a withdrawal, an unreadable value and an empty cell all keep
 * the person out, as the strictest reading does.
 */
export const CONSENT = Object.freeze({ granted: '同意', denied: '拒绝', withdrawn: '撤回' })
/** How source systems usually write the three values; used when a configuration maps the column and gives no dictionary. */
const CONSENT_WRITINGS = Object.freeze({
  同意: ['同意', '已同意', '已授权', '授权', '允许', '是', '有效', 'Y', 'YES', 'TRUE', '1', 'granted'],
  拒绝: ['拒绝', '不同意', '未同意', '未授权', '否', 'N', 'NO', 'FALSE', '0', 'denied'],
  撤回: ['撤回', '已撤回', '取消', '已取消', '退订', 'withdrawn'],
})

/**
 * 线索结果: the four standard values of `lead.result`. A lead with no result, or one the dictionary does not
 * know, counts as still being followed. A `wonDate` on or before the cutoff also makes it 成交.
 */
export const LEAD_RESULTS = Object.freeze({ won: '成交', lost: '战败', dormant: '休眠', open: '跟进中' })
const LEAD_RESULT_WRITINGS = Object.freeze({
  成交: ['成交', '已成交', '赢单', '已赢单', '转化', '已转化', '成单', '签约', '已签约', '下定', '已下定', 'won', 'win'],
  战败: ['战败', '已战败', '输单', '丢单', '失败', '无效', '流失', 'lost', 'lose'],
  休眠: ['休眠', '搁置', '暂停', '沉睡', 'dormant'],
  跟进中: ['跟进中', '跟进', '进行中', '意向', '热', '温', '冷', '新线索', '新建', '待跟进', '未转化', '不确定', 'open'],
})
/** 体验 (a test drive, a trial class, a visit): yes or no. */
export const LEAD_TRIAL = Object.freeze({ yes: '是', no: '否' })
const LEAD_TRIAL_WRITINGS = Object.freeze({
  是: ['是', '有', 'yes', 'y', 'true', '1', '已体验', '体验', '已试驾', '试驾', '已试听', '试听', '已到店', '到店'],
  否: ['否', '无', '没有', 'no', 'n', 'false', '0', '未体验', '未试驾', '未试听', '未到店'],
})
/** Fixed standard values of a dictionary, by key; a configuration may only regroup its own writings under them. */
const FIXED_VALUES = Object.freeze({ 'lead.result': Object.values(LEAD_RESULTS), 'lead.trial': Object.values(LEAD_TRIAL) })
/** How fast a lead should be picked up and kept warm; the defaults are assumptions to confirm with the business. */
export const LEAD_DEFAULTS = Object.freeze({ followDays: 2, staleDays: 14, activeDays: 90, trialName: '体验', minGroup: 30 })

/** Whether some table of the configuration feeds `customer.consent`. */
export const tracksConsent = spec => (spec?.tables ?? []).some(t => t.entities?.customer?.consent)

/**
 * Whether a list made for this purpose may only hold people who agreed to marketing. True for every
 * purpose once the configuration reads consent, except the purposes it names as service contact
 * (`lists.servicePurposes`: a maintenance or warranty reminder, a complaint follow-up).
 */
export const consentNeeded = (spec, purpose) => tracksConsent(spec) && !(spec.lists?.servicePurposes ?? []).includes(purpose)

export const LIMITS = Object.freeze({ tables: 20, segments: 12, flags: 10, conditions: 8, dictValues: 60, variants: 40, identity: 8, purposes: 12, outcomes: 10, sections: 12, extras: 30, text: 400, skipRows: 6, skipValues: 30, where: 4 })

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = v => typeof v === 'string' && v.trim() !== ''
const trimStr = v => (typeof v === 'string' ? v.trim() : v)
const RULE_KEYS = ['all', 'any']

/** Normalize a category value for dictionary matching: half width, trimmed, single spaces, lower case. */
export function normValue(v) {
  return String(v ?? '').replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * A column mapping is a column name, or an object: `{ column, as }` for a serial column, and
 * `{ column, split, part }` to read one part of a cell that packs several things together
 * (`"C0001:K12 某机构 : 张三"` split by `" : "`, part -1 is the name; part 1 is the first).
 * @returns {{ column: string, as?: string, split?: string, part?: number } | null}
 */
export function columnOf(mapping) {
  if (typeof mapping === 'string') return mapping.trim() ? { column: mapping.trim() } : null
  if (!isObj(mapping) || !isStr(mapping.column)) return null
  const out = { column: mapping.column.trim() }
  if (isStr(mapping.as)) out.as = mapping.as.trim()
  if (typeof mapping.split === 'string' && mapping.split !== '') {
    out.split = mapping.split
    out.part = mapping.part ?? 1
  }
  return out
}

/** The part of a cell a mapping reads: the whole cell, or one part of it split by `split` (blank parts skipped). */
export function pickPart(raw, col) {
  if (!col?.split) return raw
  const parts = String(raw ?? '').split(col.split).map(s => s.trim()).filter(Boolean)
  const i = col.part > 0 ? col.part - 1 : parts.length + col.part
  return parts[i] ?? ''
}

/** How a tags cell is cut into values when the field names no separator of its own. */
export const TAG_SEPARATORS = /[,，;；、|\n]+/

/** Whether a row is left out by one `skipRows` filter, given the raw cell of its column. */
export function skipMatch(filter, raw) {
  const text = String(raw ?? '').trim()
  if (filter.when === 'filled') return text !== ''
  if (filter.when === 'empty') return text === ''
  const v = normValue(text)
  const values = (filter.values ?? []).map(normValue)
  if (filter.when === 'in') return values.includes(v)
  if (filter.when === 'not_in') return !values.includes(v)
  if (filter.when === 'contains') return values.some(x => x !== '' && v.includes(x))
  return false
}

/** A row filter in words: what it leaves out. */
export function describeSkip(filter) {
  if (isStr(filter.why)) return filter.why.trim()
  const col = `「${filter.column}」`
  const values = (filter.values ?? []).join('、')
  return { in: `${col}是 ${values}`, not_in: `${col}不是 ${values}`, contains: `${col}里有 ${values}`, filled: `${col}有值`, empty: `${col}是空的` }[filter.when] ?? col
}

/** Check `split` and `part` of a mapping object; returns error messages. */
function splitErrors(m) {
  if (!isObj(m) || (m.split === undefined && m.part === undefined)) return []
  const out = []
  if (typeof m.split !== 'string' || m.split === '' || [...m.split].length > 5) out.push('split 要写 1～5 个字的分隔符，比如 " "、" : "、"/"')
  if (m.part !== undefined && (!Number.isInteger(m.part) || m.part === 0 || Math.abs(m.part) > 10)) out.push('part 要写第几段：1 是第一段，-1 是最后一段（不超过 10）')
  return out
}

/** Plain description of a mapping, for the config page and cards. */
export function describeMapping(m) {
  const col = columnOf(m)
  if (!col) return ''
  if (!col.split) return `「${col.column}」`
  const sep = col.split.trim() === '' ? '空格' : `「${col.split.trim()}」`
  return `「${col.column}」按${sep}切开的${col.part === -1 ? '最后一段' : col.part > 0 ? `第 ${col.part} 段` : `倒数第 ${-col.part} 段`}`
}

/**
 * What a configuration can compute: the entities it feeds, plus `amount` when some
 * transaction table maps an amount column.
 */
export function capabilities(spec) {
  const out = entitiesOf(spec)
  if ((spec.tables ?? []).some(t => t.entities?.transaction?.amount)) out.add('amount')
  return out
}
/** Person-facing name of an entity or capability. */
export const needName = k => (k === 'amount' ? '交易金额' : ENTITIES[k]?.name ?? k)

/** Entities a configuration actually feeds, from its tables. */
export function entitiesOf(spec) {
  const out = new Set()
  for (const t of spec.tables ?? []) for (const e of Object.keys(t.entities ?? {})) if (Object.hasOwn(ENTITIES, e)) out.add(e)
  return out
}

/** Values of one dictionary (standard values), or null when the field has no dictionary. */
export const dictValues = (spec, key) => (isObj(spec.dictionaries?.[key]) ? Object.keys(spec.dictionaries[key]) : null)

/** Custom customer date fields usable as `days_since_field` arguments. */
export function customerDateFieldKeys(spec) {
  const keys = []
  for (const t of spec.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'customer' && x.type === 'date') keys.push(`extra.${x.key}`)
  return [...new Set(keys)]
}

/** Custom customer fields that hold several values per cell (`type: "tags"`). */
export function customerTagFieldKeys(spec) {
  const keys = []
  for (const t of spec.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'customer' && x.type === 'tags') keys.push(`extra.${x.key}`)
  return [...new Set(keys)]
}

/** Fields of one holding a `where` condition may compare: its categories and its custom fields. */
export function assetFieldKeys(spec) {
  const keys = Object.entries(ENTITIES.asset.fields).filter(([, f]) => f.type === 'category').map(([k]) => k)
  for (const t of spec.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'asset' && x.type !== 'date' && x.type !== 'text') keys.push(`extra.${x.key}`)
  return [...new Set(keys)]
}

/** Date fields of one holding: start, end and its custom dates. */
export function assetDateFieldKeys(spec) {
  const keys = ['start', 'end']
  for (const t of spec.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'asset' && x.type === 'date') keys.push(`extra.${x.key}`)
  return [...new Set(keys)]
}

/**
 * Attributes of a 归属方 the board can roll up by (a region, a manager, a type): the `type` and `city` some
 * table maps, and its custom category fields. `{ key: name }`.
 */
export function ownerAttributes(spec) {
  const out = {}
  for (const t of spec?.tables ?? []) {
    for (const k of ['type', 'city']) if (t.entities?.owner?.[k]) out[k] = ENTITIES.owner.fields[k].name
    for (const x of t.extra ?? []) if (x.entity === 'owner' && x.type === 'category' && isStr(x.name)) out[`extra.${x.key}`] = x.name
  }
  return out
}

/** Custom customer fields usable as `field` feature arguments. */
export function customerFieldKeys(spec) {
  const keys = Object.entries(ENTITIES.customer.fields).filter(([, f]) => f.type === 'category').map(([k]) => k)
  for (const t of spec.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'customer') keys.push(`extra.${x.key}`)
  return keys
}

/**
 * Check a configuration or a preset.
 * @param {unknown} input - the spec.
 * @param {{ preset?: boolean }} [options] - presets have no tables and need none.
 * @returns {{ ok: boolean, errors: { path: string, message: string }[], spec: object | null }}
 */
export function checkSpec(input, { preset = false } = {}) {
  const errors = []
  const err = (path, message) => errors.push({ path, message })
  if (!isObj(input)) return { ok: false, errors: [{ path: '', message: '配置要是一个对象' }], spec: null }
  const spec = structuredClone(input)
  spec.schema ??= SPEC_SCHEMA
  if (spec.schema !== SPEC_SCHEMA) err('schema', `schema 只能是 ${SPEC_SCHEMA}`)

  // labels
  spec.labels = isObj(spec.labels) ? spec.labels : {}
  for (const [k, v] of Object.entries(spec.labels)) {
    if (!Object.hasOwn(ENTITIES, k)) err(`labels.${k}`, `labels 只能给这几类起名：${Object.keys(ENTITIES).join('、')}`)
    else if (!isStr(v) || [...v].length > 8) err(`labels.${k}`, '叫法要有 1～8 个字')
  }

  // tables
  spec.tables = Array.isArray(spec.tables) ? spec.tables : []
  if (spec.tables.length > LIMITS.tables) err('tables', `最多 ${LIMITS.tables} 张表`)
  const tableNames = new Set()
  const extraKeys = new Map()
  spec.tables.forEach((t, i) => {
    const p = `tables[${i}]`
    if (!isObj(t)) return err(p, '每张表要是一个对象')
    t.name = trimStr(t.name)
    if (!isStr(t.name) || [...t.name].length > 30) err(`${p}.name`, '表名要有 1～30 个字')
    else if (tableNames.has(t.name)) err(`${p}.name`, `表名「${t.name}」重复了`)
    else tableNames.add(t.name)
    t.mode ??= 'snapshot'
    if (!Object.hasOwn(MODES, t.mode)) err(`${p}.mode`, 'mode 只能是 snapshot（快照）或 append（追加）')
    if (t.source !== undefined && !/^[a-f0-9]{8}$/.test(String(t.source))) err(`${p}.source`, 'source 要写 crm_status 里数据源的 8 位 id')
    if (t.sheet !== undefined && !isStr(t.sheet)) err(`${p}.sheet`, 'sheet 要写工作表名')
    if (t.newCustomers !== undefined && typeof t.newCustomers !== 'boolean') err(`${p}.newCustomers`, 'newCustomers 只能是 true 或 false')
    if (!isObj(t.entities) || Object.keys(t.entities).length === 0) return err(`${p}.entities`, `这张表至少要喂给一类：${Object.keys(ENTITIES).join('、')}`)
    for (const [e, fields] of Object.entries(t.entities)) {
      const ep = `${p}.entities.${e}`
      const def = ENTITIES[e]
      if (!def) { err(ep, `没有「${e}」这一类，只能是：${Object.keys(ENTITIES).join('、')}`); continue }
      if (!isObj(fields) || Object.keys(fields).length === 0) { err(ep, '要写这一类的字段对应哪一列，例如 { "phone": "家长手机" }'); continue }
      for (const [f, m] of Object.entries(fields)) {
        const fp = `${ep}.${f}`
        const fd = def.fields[f] ?? (def.refs ? REFS[f] : undefined)
        if (!fd) { err(fp, `「${def.name}」没有「${f}」这个字段，能用的是：${[...Object.keys(def.fields), ...(def.refs ? Object.keys(REFS) : [])].join('、')}`); continue }
        const col = columnOf(m)
        if (!col) { err(fp, '要写列名（字符串），或 { "column": 列名, "as": "vin" }，或 { "column": 列名, "split": " ", "part": 1 }'); continue }
        if (col.as !== undefined && (fd.type !== 'serial' || !Object.hasOwn(SERIAL_AS, col.as))) err(`${fp}.as`, fd.type === 'serial' ? `as 只能是：${Object.keys(SERIAL_AS).join('、')}` : '只有识别号字段能写 as')
        for (const message of splitErrors(m)) err(fp, message)
        fields[f] = col.as || col.split ? col : col.column
      }
      // A transaction needs a date. Amount is optional: some exports (deliveries, registrations) carry no price;
      // then money metrics and the `amount` feature are off for the dataset.
      if (e === 'transaction' && !fields.date) err(`${ep}.date`, '交易一定要有时间列')
      if (e === 'lead' && !fields.date) err(`${ep}.date`, '线索一定要有留资时间（线索建档、报名、咨询的日期）')
      // A lead may name its customer (refs) but needs not: without contact details it still has a funnel.
      if (def.refs === true && !Object.keys(fields).some(f => REFS[f]) && !t.entities.customer) {
        err(ep, `「${def.name}」要能找到客户：写一个 customerId / customerName / customerPhone / customerIdcard / customerWechat / assetSerial / assetId，或者同一张表也喂给 customer`)
      }
      if (e === 'customer' && !Object.keys(fields).some(f => ['id', 'name', 'phone', 'idcard', 'wechat'].includes(f))) err(ep, '客户至少要有编号、姓名、手机、证件号、企微 ID 中的一列')
    }
    if (t.skipRows !== undefined) {
      if (!Array.isArray(t.skipRows) || t.skipRows.length > LIMITS.skipRows) err(`${p}.skipRows`, `skipRows 写成列表，最多 ${LIMITS.skipRows} 条：[{ "column": 列名, "when": "in", "values": [...] }]`)
      else t.skipRows.forEach((f, j) => {
        const sp = `${p}.skipRows[${j}]`
        if (!isObj(f) || !isStr(f.column)) return err(sp, '每条写成 { "column": 列名, "when": 怎么判断, "values": [...] }')
        f.column = f.column.trim()
        if (!Object.hasOwn(SKIP_WHEN, f.when)) return err(`${sp}.when`, `when 只能是：${Object.entries(SKIP_WHEN).map(([k, v]) => `${k}（${v}）`).join('；')}`)
        const needs = ['in', 'not_in', 'contains'].includes(f.when)
        if (needs) {
          if (!Array.isArray(f.values) || f.values.length === 0 || f.values.length > LIMITS.skipValues || f.values.some(v => !isStr(String(v ?? '')))) err(`${sp}.values`, `values 写 1～${LIMITS.skipValues} 个原表里的写法（照体检里的取值抄）`)
          else f.values = f.values.map(v => String(v).trim())
        } else if (f.values !== undefined) err(`${sp}.values`, `when 是 ${f.when} 时不用写 values`)
        if (f.why !== undefined && (!isStr(f.why) || [...f.why].length > 30)) err(`${sp}.why`, 'why 用一句话说为什么不要这些行，最多 30 字')
      })
    } else t.skipRows = []
    t.extra = Array.isArray(t.extra) ? t.extra : []
    if (t.extra.length > LIMITS.extras) err(`${p}.extra`, `自定义字段最多 ${LIMITS.extras} 个`)
    t.extra.forEach((x, j) => {
      const xp = `${p}.extra[${j}]`
      if (!isObj(x)) return err(xp, '自定义字段要是 { entity, key, name, column, type }')
      if (!t.entities?.[x.entity]) err(`${xp}.entity`, `entity 要是这张表喂给的一类：${Object.keys(t.entities ?? {}).join('、')}`)
      if (!/^[a-z][a-z0-9_]{0,23}$/.test(String(x.key ?? ''))) err(`${xp}.key`, 'key 用小写英文字母、数字和下划线，字母开头，最多 24 位')
      else {
        const seen = extraKeys.get(`${x.entity}.${x.key}`)
        if (seen && seen.type !== x.type) err(`${xp}.key`, `「${x.key}」在别的表里是另一种类型`)
        extraKeys.set(`${x.entity}.${x.key}`, x)
      }
      if (!isStr(x.name) || [...x.name].length > 16) err(`${xp}.name`, '字段名要有 1～16 个字')
      if (!isStr(x.column)) err(`${xp}.column`, '要写列名')
      for (const message of splitErrors(x)) err(`${xp}`, message)
      if (!Object.hasOwn(EXTRA_TYPES, x.type)) err(`${xp}.type`, `type 只能是：${Object.keys(EXTRA_TYPES).join('、')}`)
      if (x.sep !== undefined && (x.type !== 'tags' || typeof x.sep !== 'string' || x.sep === '' || [...x.sep].length > 3)) err(`${xp}.sep`, x.type === 'tags' ? 'sep 写 1～3 个字的分隔符；不写就按逗号、顿号、分号、竖线切' : '只有 type 是 tags 的字段能写 sep')
    })
    t.fingerprint = Array.isArray(t.fingerprint) ? t.fingerprint : []
    const fpOk = ['date', 'amount', 'type', 'status', 'channel', 'customerId', 'customerName', 'customerPhone', 'customerIdcard', 'customerWechat', 'assetSerial', 'assetId', 'payerName', 'payerPhone', 'action', 'campaign']
    t.fingerprint.forEach((f, j) => { if (!fpOk.includes(f)) err(`${p}.fingerprint[${j}]`, `指纹只能用这些字段组合：${fpOk.join('、')}`) })
  })
  if (!preset) {
    const fed = entitiesOf(spec)
    for (const [e, def] of Object.entries(ENTITIES)) if (def.required && !fed.has(e)) err('tables', `至少要有一张表喂给「${def.name}」（${e}）`)
  }

  // dictionaries
  spec.dictionaries = isObj(spec.dictionaries) ? spec.dictionaries : {}
  if (tracksConsent(spec) && !isObj(spec.dictionaries['customer.consent'])) spec.dictionaries['customer.consent'] = Object.fromEntries(Object.entries(CONSENT_WRITINGS).map(([v, w]) => [v, [...w]]))
  // A lead result or trial column without a dictionary gets the common writings, like consent.
  for (const [key, writings] of [['lead.result', LEAD_RESULT_WRITINGS], ['lead.trial', LEAD_TRIAL_WRITINGS]]) {
    const field = key.split('.')[1]
    if (spec.tables.some(t => isObj(t?.entities?.lead) && t.entities.lead[field]) && !isObj(spec.dictionaries[key])) spec.dictionaries[key] = Object.fromEntries(Object.entries(writings).map(([v, w]) => [v, [...w]]))
  }
  for (const [key, dict] of Object.entries(spec.dictionaries)) {
    const p = `dictionaries.${key}`
    const [e, f, x] = key.split('.')
    const fd = f === 'extra' ? extraKeys.get(`${e}.${x}`) : ENTITIES[e]?.fields[f]
    const isCategory = f === 'extra' ? (DICT_TYPES.includes(fd?.type) || preset) : fd?.type === 'category'
    if (!isCategory) { err(p, '字典只能给类别字段：写成 "transaction.type" 这样的「类.字段」'); continue }
    if (!isObj(dict)) { err(p, '字典写成 { "标准值": ["原表里的写法", ...] }'); continue }
    const values = Object.keys(dict)
    if (values.length === 0 || values.length > LIMITS.dictValues) err(p, `标准值要有 1～${LIMITS.dictValues} 个`)
    if (key === 'customer.consent') for (const v of values) if (!Object.values(CONSENT).includes(v)) err(`${p}.${v}`, `营销同意的标准值只能是：${Object.values(CONSENT).join('、')}。把原表里的写法（如「已授权」「退订」）归到这三个里`)
    if (key === 'lead.result') for (const v of values) if (!FIXED_VALUES[key].includes(v)) err(`${p}.${v}`, `线索结果的标准值只能是：${FIXED_VALUES[key].join('、')}。把原表里的写法（如「赢单」「输单」「热」「冷」）归到这四个里；级别（热、温、冷）另外对到 lead.level`)
    if (key === 'lead.trial') for (const v of values) if (!FIXED_VALUES[key].includes(v)) err(`${p}.${v}`, `体验的标准值只能是：是、否。把原表里的写法（如「Yes」「已试驾」）归到这两个里`)
    const owner = new Map()
    for (const [v, variants] of Object.entries(dict)) {
      if (!isStr(v) || [...v].length > 20) err(`${p}.${v}`, '标准值要有 1～20 个字')
      if (!Array.isArray(variants) || variants.length > LIMITS.variants) { err(`${p}.${v}`, `写法要是列表，最多 ${LIMITS.variants} 个`); continue }
      dict[v] = [...new Set([v, ...variants.map(s => String(s).trim()).filter(Boolean)])]
      for (const w of dict[v]) {
        const n = normValue(w)
        if (owner.has(n) && owner.get(n) !== v) err(`${p}.${v}`, `写法「${w}」同时出现在「${owner.get(n)}」和「${v}」里，一种写法只能对应一个标准值`)
        owner.set(n, v)
      }
    }
  }

  // identity
  spec.identity = Array.isArray(spec.identity) ? spec.identity : []
  if (spec.identity.length === 0 && !preset) err('identity', '要写认人的规则，例如 [{ "keys": ["customer.phone"], "strength": "strong", "unless": "shared" }]')
  if (spec.identity.length > LIMITS.identity) err('identity', `最多 ${LIMITS.identity} 条规则`)
  spec.identity.forEach((r, i) => {
    const p = `identity[${i}]`
    if (!isObj(r) || !Array.isArray(r.keys) || r.keys.length === 0 || r.keys.length > 3) return err(p, '每条规则写成 { "keys": [1～3 个键], "strength": "strong" 或 "weak" }')
    r.keys.forEach((k, j) => { if (!IDENTITY_KEYS.includes(k)) err(`${p}.keys[${j}]`, `键只能是：${IDENTITY_KEYS.join('、')}`) })
    if (!['strong', 'weak'].includes(r.strength)) err(`${p}.strength`, 'strength 只能是 strong（自动合并）或 weak（只进复核）')
    if (r.strength === 'strong' && !r.keys.some(k => STRONG_KEYS.has(k))) err(`${p}.strength`, '只有姓名、城市、生日这类键不能当强键，要改成 weak')
    if (r.unless !== undefined && r.unless !== 'shared') err(`${p}.unless`, 'unless 只能是 "shared"（一个号码对应几个姓名时降为弱键）')
  })
  if (!preset && spec.identity.length > 0 && !spec.identity.some(r => r.strength === 'strong')) err('identity', '至少要有一条强键规则')
  if (!preset) for (const e of unlinkable(spec)) err(e.path, e.message)

  // measures
  const m = (spec.measures = isObj(spec.measures) ? spec.measures : {})
  m.refunds ??= 'net'
  if (!['net', 'exclude'].includes(m.refunds)) err('measures.refunds', 'refunds 只能是 net（退款冲减金额）或 exclude（退款不算）')
  m.sameDayDuplicates ??= 'each'
  if (!['each', 'one'].includes(m.sameDayDuplicates)) err('measures.sameDayDuplicates', 'sameDayDuplicates 只能是 each（各算一笔）或 one（算一笔）')
  m.staleStatus ??= 'unknown'
  if (!['ended', 'unknown'].includes(m.staleStatus)) err('measures.staleStatus', 'staleStatus 只能是 ended（当成已结束）或 unknown（当成未知，不计入）')
  const types = dictValues(spec, 'transaction.type')
  const statuses = dictValues(spec, 'transaction.status')
  for (const key of ['refundTypes', 'excludeStatuses', 'openStatuses']) {
    m[key] = Array.isArray(m[key]) ? m[key] : []
    const allowed = key === 'refundTypes' ? types : statuses
    m[key].forEach((v, j) => {
      if (allowed === null) err(`measures.${key}`, key === 'refundTypes' ? '先在 dictionaries 里给 transaction.type 建字典' : '先在 dictionaries 里给 transaction.status 建字典')
      else if (!allowed.includes(v)) err(`measures.${key}[${j}]`, `「${v}」不在字典里，能用的是：${allowed.join('、')}`)
    })
  }
  if (m.note !== undefined && (typeof m.note !== 'string' || [...m.note].length > LIMITS.text)) err('measures.note', `口径说明最多 ${LIMITS.text} 字`)

  // segments and flags
  const ctx = { spec, err, preset }
  spec.segments = Array.isArray(spec.segments) ? spec.segments : []
  if (spec.segments.length > LIMITS.segments) err('segments', `最多 ${LIMITS.segments} 层`)
  const segNames = new Set()
  spec.segments.forEach((s, i) => {
    const p = `segments[${i}]`
    if (!isObj(s)) return err(p, '每一层写成 { "name": 层名, "all": [条件...] }')
    if (!isStr(s.name) || [...s.name].length > 10) err(`${p}.name`, '层名要有 1～10 个字')
    else if (s.name === '其他' || s.name === '已离开') err(`${p}.name`, `「${s.name}」是保留的名字`)
    else if (segNames.has(s.name)) err(`${p}.name`, `层名「${s.name}」重复了`)
    segNames.add(s.name)
    if (s.desc !== undefined && (typeof s.desc !== 'string' || [...s.desc].length > 80)) err(`${p}.desc`, '说明最多 80 字')
    checkKind(s, p, err)
    checkRule(s, p, 1, ctx)
  })
  spec.flags = Array.isArray(spec.flags) ? spec.flags : []
  if (spec.flags.length > LIMITS.flags) err('flags', `最多 ${LIMITS.flags} 个标记`)
  spec.flags.forEach((f, i) => {
    const p = `flags[${i}]`
    if (!isObj(f) || !isStr(f.name) || [...f.name].length > 8) return err(p, '标记写成 { "name": 1～8 个字, "all": [条件...] }')
    checkKind(f, p, err)
    checkRule(f, p, 1, ctx)
  })

  // lists
  const l = (spec.lists = isObj(spec.lists) ? spec.lists : {})
  l.purposes = Array.isArray(l.purposes) ? l.purposes.map(trimStr) : []
  if (l.purposes.length > LIMITS.purposes) err('lists.purposes', `名单用途最多 ${LIMITS.purposes} 个`)
  l.purposes.forEach((v, i) => { if (!isStr(v) || [...v].length > 8) err(`lists.purposes[${i}]`, '用途要有 1～8 个字') })
  l.servicePurposes = Array.isArray(l.servicePurposes) ? l.servicePurposes.map(trimStr) : []
  l.servicePurposes.forEach((v, i) => { if (!l.purposes.includes(v)) err(`lists.servicePurposes[${i}]`, `「${v}」不在 lists.purposes 里。这里只列属于服务联系、不需要营销同意的用途`) })
  l.followDays ??= 14
  if (!Number.isInteger(l.followDays) || l.followDays < 1 || l.followDays > 90) err('lists.followDays', 'followDays 是名单跟进几天，1～90')
  l.outcomes = Array.isArray(l.outcomes) ? l.outcomes : []
  if (l.outcomes.length > LIMITS.outcomes) err('lists.outcomes', `结果最多 ${LIMITS.outcomes} 种`)
  const codes = new Set()
  l.outcomes.forEach((o, i) => {
    const p = `lists.outcomes[${i}]`
    if (!isObj(o)) return err(p, '结果写成 { "code", "name", "kind" }')
    if (!/^[a-z][a-z0-9]{0,15}$/.test(String(o.code ?? '')) || o.code === 'wait') err(`${p}.code`, 'code 用小写英文字母和数字，不能是 wait')
    else if (codes.has(o.code)) err(`${p}.code`, `code「${o.code}」重复了`)
    codes.add(o.code)
    if (!isStr(o.name) || [...o.name].length > 8) err(`${p}.name`, '结果名要有 1～8 个字')
    if (!Object.hasOwn(OUTCOME_KINDS, o.kind)) err(`${p}.kind`, `kind 只能是：${Object.keys(OUTCOME_KINDS).join('、')}`)
    if (o.cooldownDays !== undefined && (!Number.isInteger(o.cooldownDays) || o.cooldownDays < 0 || o.cooldownDays > 365)) err(`${p}.cooldownDays`, '冷静期是 0～365 天')
  })

  // leads: how fast a lead should be picked up and kept warm
  const ld = (spec.leads = isObj(spec.leads) ? spec.leads : {})
  for (const [k, v] of Object.entries(LEAD_DEFAULTS)) ld[k] ??= v
  const intIn = (k, lo, hi, text) => { if (!Number.isInteger(ld[k]) || ld[k] < lo || ld[k] > hi) err(`leads.${k}`, text) }
  intIn('followDays', 1, 30, 'followDays 是留资后几天内该有第一次跟进，1～30')
  intIn('staleDays', 1, 180, 'staleDays 是跟进中的线索多少天没再联系算「跟进断了」，1～180')
  intIn('activeDays', 7, 730, 'activeDays 是留资满多少天还没结果算「放太久」（不再算待处理），7～730')
  intIn('minGroup', 1, 1000, 'minGroup 是一组线索少于多少条不比较成交率，1～1000')
  if (Number.isInteger(ld.activeDays) && Number.isInteger(ld.staleDays) && ld.activeDays < ld.staleDays) err('leads.activeDays', 'activeDays 不能比 staleDays 小')
  if (!isStr(ld.trialName) || [...ld.trialName].length > 6) err('leads.trialName', 'trialName 是这一家怎么叫「体验」（如试驾、试听），1～6 个字')

  // campaign, privacy, report
  const c = (spec.campaign = isObj(spec.campaign) ? spec.campaign : {})
  c.effectDays ??= 30
  c.minGroup ??= 30
  if (!Number.isInteger(c.effectDays) || c.effectDays < 1 || c.effectDays > 365) err('campaign.effectDays', '活动后看几天，1～365')
  if (!Number.isInteger(c.minGroup) || c.minGroup < 1 || c.minGroup > 1000) err('campaign.minGroup', '下结论的最少人数，1～1000')
  const pv = (spec.privacy = isObj(spec.privacy) ? spec.privacy : {})
  pv.summaryOnly = pv.summaryOnly === true
  pv.showText = Array.isArray(pv.showText) ? pv.showText.filter(isStr) : []
  const r = (spec.report = isObj(spec.report) ? spec.report : {})
  r.sections = Array.isArray(r.sections) ? r.sections : []
  if (r.sections.length > LIMITS.sections) err('report.sections', `报告最多 ${LIMITS.sections} 节`)
  r.sections.forEach((s, i) => {
    if (!isObj(s) || !isStr(s.title) || [...s.title].length > 20) err(`report.sections[${i}]`, '每节写成 { "title": 1～20 个字, "hint": 写什么 }')
    else if (s.hint !== undefined && (typeof s.hint !== 'string' || [...s.hint].length > 200)) err(`report.sections[${i}].hint`, '提示最多 200 字')
  })
  if (spec.notes !== undefined && (typeof spec.notes !== 'string' || [...spec.notes].length > 2000)) err('notes', '访谈记录最多 2000 字')
  if (spec.tableHints !== undefined && !Array.isArray(spec.tableHints)) err('tableHints', 'tableHints 要是列表')

  return { ok: errors.length === 0, errors, spec: errors.length === 0 ? spec : null }
}

/** The reference field that carries each identity key on a row of transactions, holdings, touches or leads. */
export const REF_OF_KEY = Object.freeze({ 'customer.id': 'customerId', 'customer.phone': 'customerPhone', 'customer.idcard': 'customerIdcard', 'customer.wechat': 'customerWechat', 'customer.name': 'customerName', 'asset.serial': 'assetSerial', 'asset.id': 'assetId' })
const STRONG_REFS = ['customerId', 'customerPhone', 'customerIdcard', 'customerWechat']

/**
 * Tables whose rows can never find their customer, whatever the data: the references they give fit no
 * identity rule, or point at a key no table feeds. Such a configuration runs and silently links nothing,
 * so it is refused. Leads are left alone: a lead needs no customer.
 * @returns {{ path: string, message: string }[]}
 */
export function unlinkable(spec) {
  const out = []
  const tables = (spec.tables ?? []).filter(t => isObj(t) && isObj(t.entities))
  const rules = (spec.identity ?? []).filter(r => isObj(r) && Array.isArray(r.keys) && r.keys.length > 0)
  if (rules.length === 0) return out
  const fed = new Set()
  for (const t of tables) {
    for (const f of Object.keys(isObj(t.entities.customer) ? t.entities.customer : {})) fed.add(`customer.${f}`)
    for (const f of ['serial', 'id']) if (isObj(t.entities.asset) && t.entities.asset[f]) fed.add(`asset.${f}`)
    // A table that makes customers out of its own rows feeds the keys its references carry.
    if (t.newCustomers === true) for (const fields of Object.values(t.entities)) for (const [k, ref] of Object.entries(REF_OF_KEY)) if (isObj(fields) && fields[ref]) fed.add(k)
  }
  const words = k => keyName(k, spec.labels)
  const ruleWords = rules.map(r => r.keys.map(words).join(' + ')).join('；')
  ;(spec.tables ?? []).forEach((t, i) => {
    if (!isObj(t) || !isObj(t.entities) || t.entities.customer) return
    for (const [e, fields] of Object.entries(t.entities)) {
      if (ENTITIES[e]?.refs !== true || !isObj(fields)) continue
      const refs = Object.keys(fields).filter(f => REFS[f])
      if (refs.length === 0) continue
      if (t.newCustomers === true && refs.some(f => STRONG_REFS.includes(f))) continue
      const given = refs.map(f => REFS[f].name).join('、')
      const usable = rules.filter(r => r.keys.every(k => REF_OF_KEY[k] && fields[REF_OF_KEY[k]]))
      const path = `tables[${i}].entities.${e}`
      if (usable.length === 0) {
        const nameOnly = refs.length === 1 && refs[0] === 'customerName'
        out.push({ path, message: `「${t.name}」的${ENTITIES[e].name}只给了${given}，而认人的规则是「${ruleWords}」，没有一条只靠${given}就能认人：这张表会一行都挂不上客户。改法：给它对上一个编号或手机列；${nameOnly ? '或者在 identity 里加一条 { "keys": ["customer.name"], "strength": "weak" }（只有不重名的才挂得上）' : '或者在 identity 里加一条只用这个键的规则'}${e === 'touch' ? '；这张表每行是一条线索、商机、报名的话，改喂给 lead（线索不用挂客户）' : ''}` })
        continue
      }
      if (!usable.some(r => r.keys.every(k => fed.has(k)))) {
        const missing = [...new Set(usable.flatMap(r => r.keys.filter(k => !fed.has(k))))]
        out.push({ path, message: `「${t.name}」靠${given}找客户，但没有哪张表给客户对上${missing.map(words).join('、')}，这张表会一行都挂不上。在客户表里把这一列对上，或者换一个两边都有的键` })
      }
    }
  })
  return out
}

/**
 * Check one rule group: `{ all: [...] }` or `{ any: [...] }`, nested at most two levels.
 * A condition is `{ feature, args?, op, value }`.
 */
function checkRule(node, path, depth, ctx) {
  const key = RULE_KEYS.find(k => Array.isArray(node[k]))
  if (!key) return ctx.err(path, '要写 "all": [...]（全部满足）或 "any": [...]（任一满足）')
  if (RULE_KEYS.every(k => Array.isArray(node[k]))) return ctx.err(path, 'all 和 any 只能写一个；要组合就嵌套一层')
  const items = node[key]
  if (items.length === 0 || items.length > LIMITS.conditions) return ctx.err(`${path}.${key}`, `条件要有 1～${LIMITS.conditions} 条`)
  items.forEach((c, i) => {
    const p = `${path}.${key}[${i}]`
    if (!isObj(c)) return ctx.err(p, '条件要是对象')
    if (RULE_KEYS.some(k => Array.isArray(c[k]))) {
      if (depth >= 2) return ctx.err(p, '最多嵌套两层')
      return checkRule(c, p, depth + 1, ctx)
    }
    checkCondition(c, p, ctx)
  })
}

function checkKind(node, p, err) {
  if (node.kind !== undefined && !Object.hasOwn(SEGMENT_KINDS, node.kind)) err(`${p}.kind`, `kind 只能是：${Object.entries(SEGMENT_KINDS).map(([k, v]) => `${k}（${v}）`).join('；')}。不写就按规则自己判断`)
}

function checkCondition(c, p, { spec, err, preset }) {
  const f = FEATURES[c.feature]
  if (!f) return err(`${p}.feature`, `特征只能是：${Object.keys(FEATURES).join('、')}`)
  c.args = c.args === undefined ? [] : c.args
  if (!Array.isArray(c.args)) return err(`${p}.args`, 'args 要是列表')
  const need = f.args.filter(a => !a.optional).length
  if (c.args.length < need || c.args.length > f.args.length) return err(`${p}.args`, `${c.feature} 要 ${need === f.args.length ? need : `${need}～${f.args.length}`} 个参数：${f.args.map(a => argName(a)).join('、') || '不要参数'}`)
  c.args.forEach((a, i) => checkArg(f.args[i], a, `${p}.args[${i}]`, spec, err, preset))
  if (c.where !== undefined) checkWhere(c, f, p, { spec, err, preset })
  if (!OPS.includes(c.op)) return err(`${p}.op`, `比较只能是：${OPS.join(' ')}`)
  const v = c.value
  // A multi-value field holds a set: it has a value or lacks it, or holds any of several (`in`).
  const tagField = c.feature === 'field' && (customerTagFieldKeys(spec).includes(c.args[0]) || (presetExtra(preset, c.args[0]) && TAG_OPS.includes(c.op)))
  const blank = v === '' && (c.op === '=' || c.op === '!=')
  if (TAG_OPS.includes(c.op)) {
    if (!tagField) return err(`${p}.op`, 'has（含有）、lacks（不含）只能用在多值标签字段上：feature 写 field，args 写一个 type 是 tags 的自定义字段')
    if (typeof v !== 'string' || v === '') return err(`${p}.value`, 'value 写一个标签值')
    const allowed = dictValues(spec, `customer.${c.args[0]}`)
    if (allowed && !allowed.includes(v)) err(`${p}.value`, `「${v}」不在这个字段的字典里，能用的是：${allowed.join('、')}`)
    return
  }
  if (tagField && !blank && c.op !== 'in') return err(`${p}.op`, '多值标签字段只能写 has（含有某个值）、lacks（不含）、in（含有其中任一个），或者用 = "" 判断是不是空的；数有几个值用 tag_count')
  if (c.op === 'between') {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(x => typeof x === 'number') || v[0] > v[1]) err(`${p}.value`, 'between 的 value 写成 [小, 大] 两个数字')
  } else if (c.op === 'in') {
    if (!Array.isArray(v) || v.length === 0 || v.length > 30) err(`${p}.value`, 'in 的 value 写成 1～30 个值的列表')
  } else if (f.value === 'boolean') {
    if (typeof v !== 'boolean' || !['=', '!='].includes(c.op)) err(`${p}`, `${c.feature} 只能写 = true 或 = false`)
  } else if (f.value === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) err(`${p}.value`, 'value 要是数字')
  } else if (typeof v !== 'string' && typeof v !== 'number') err(`${p}.value`, 'value 要是文字或数字')
  if (f.value === 'boolean' && ['between', 'in'].includes(c.op)) err(`${p}.op`, `${c.feature} 只能写 = true 或 = false`)
}

/**
 * `where` narrows a holding feature to the holdings that pass every condition: each one compares a field of
 * the holding (`field`), or the days until (`days_to`) or since (`days_since`) one of its dates.
 */
function checkWhere(c, f, p, { spec, err, preset }) {
  if (!f.where) return err(`${p}.where`, `只有持有物的特征（${Object.keys(FEATURES).filter(k => FEATURES[k].where).join('、')}）能写 where`)
  if (!Array.isArray(c.where) || c.where.length === 0 || c.where.length > LIMITS.where) return err(`${p}.where`, `where 写成 1～${LIMITS.where} 条条件的列表，全部满足的持有物才算`)
  const fields = assetFieldKeys(spec)
  const dates = assetDateFieldKeys(spec)
  c.where.forEach((w, i) => {
    const wp = `${p}.where[${i}]`
    const kinds = isObj(w) ? ['field', 'days_to', 'days_since'].filter(k => w[k] !== undefined) : []
    if (kinds.length !== 1) return err(wp, '每条写成 { "field": 持有物字段, "op", "value" }，或 { "days_to": 日期字段, "op", "value" }（还有多少天到这个日期，负数是已经过了），或 { "days_since": 日期字段, "op", "value" }')
    const kind = kinds[0]
    const allowed = kind === 'field' ? fields : dates
    if (!allowed.includes(w[kind]) && !presetExtra(preset, w[kind])) return err(`${wp}.${kind}`, `${kind === 'field' ? '持有物字段' : '持有物的日期字段'}只能是：${allowed.join('、')}${kind === 'field' ? '' : '（别的日期先在这张表的 extra 里加成 entity 为 asset、type 为 date 的字段）'}`)
    if (!WHERE_OPS.includes(w.op)) return err(`${wp}.op`, `比较只能是：${WHERE_OPS.join(' ')}`)
    const v = w.value
    if (w.op === 'between') {
      if (!Array.isArray(v) || v.length !== 2 || !v.every(x => typeof x === 'number') || v[0] > v[1]) err(`${wp}.value`, 'between 的 value 写成 [小, 大] 两个数字')
    } else if (w.op === 'in') {
      if (!Array.isArray(v) || v.length === 0 || v.length > 30) err(`${wp}.value`, 'in 的 value 写成 1～30 个值的列表')
    } else if (kind !== 'field') {
      if (typeof v !== 'number' || !Number.isFinite(v)) err(`${wp}.value`, '天数要是数字')
    } else if (typeof v !== 'string' && typeof v !== 'number') err(`${wp}.value`, 'value 要是文字或数字')
    // A value outside the field's dictionary can never match: say so now, not as an empty list later.
    if (kind === 'field' && v !== '') {
      const key = w.field.startsWith('extra.') ? `asset.extra.${w.field.slice(6)}` : `asset.${w.field}`
      const known = dictValues(spec, key)
      const given = (Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string')
      if (known) for (const x of given) if (!known.includes(x)) err(`${wp}.value`, `「${x}」不在 ${key} 的字典里，能用的是：${known.join('、')}`)
    }
  })
}

const argName = a => ({ window: '天数窗口', period: '周期 year/quarter/month', txnType: '交易类型', touchChannel: '互动渠道', customerField: '客户字段', customerDateField: '客户的日期字段（type 为 date 的自定义字段）', customerTagField: '客户的多值标签字段（type 为 tags 的自定义字段）', leadResult: `线索结果（${Object.values(LEAD_RESULTS).join('、')}）` }[a.kind] + (a.optional ? '（可不填）' : ''))

/** A preset has no tables yet: its rules may name the custom fields its tables are meant to get (`extra.<key>`). */
const presetExtra = (preset, a) => preset && typeof a === 'string' && /^extra\.[a-z][a-z0-9_]{0,23}$/.test(a)

function checkArg(def, a, p, spec, err, preset = false) {
  if (def.kind === 'window') {
    if (!Number.isInteger(a) || a < 1 || a > 3650) err(p, '天数窗口要是 1～3650 的整数')
  } else if (def.kind === 'period') {
    if (!Object.hasOwn(PERIODS, a)) err(p, '周期只能是 year、quarter、month')
  } else if (def.kind === 'txnType' || def.kind === 'touchChannel') {
    const key = def.kind === 'txnType' ? 'transaction.type' : 'touch.channel'
    const allowed = dictValues(spec, key)
    const list = Array.isArray(a) ? a : [a]
    if (list.length === 0 || list.some(x => typeof x !== 'string')) return err(p, '写一个值，或几个值的列表')
    if (allowed === null) return err(p, `用到了类型名，要先在 dictionaries 里给 ${key} 建字典`)
    list.forEach(x => { if (!allowed.includes(x)) err(p, `「${x}」不在 ${key} 的字典里，能用的是：${allowed.join('、')}`) })
  } else if (def.kind === 'leadResult') {
    const list = Array.isArray(a) ? a : [a]
    const allowed = Object.values(LEAD_RESULTS)
    if (list.length === 0 || list.some(x => !allowed.includes(x))) err(p, `线索结果只能是：${allowed.join('、')}（写一个，或几个的列表）`)
  } else if (def.kind === 'customerField') {
    const keys = customerFieldKeys(spec)
    if (!keys.includes(a) && !presetExtra(preset, a)) err(p, `客户字段只能是：${keys.join('、')}`)
  } else if (def.kind === 'customerTagField') {
    const keys = customerTagFieldKeys(spec)
    if (!keys.includes(a) && !presetExtra(preset, a)) err(p, keys.length ? `多值标签字段只能是：${keys.join('、')}` : '先在客户表的 extra 里加一个 type 为 tags 的字段，再用它')
  } else if (def.kind === 'customerDateField') {
    const keys = customerDateFieldKeys(spec)
    if (!keys.includes(a) && !presetExtra(preset, a)) err(p, keys.length ? `日期字段只能是：${keys.join('、')}` : '先在客户表的 extra 里加一个 type 为 date 的字段（比如最近购买日期），再用它')
  }
}

/**
 * The ready-made tables of a preset. A table hint may carry `table`: the whole mapping of one export whose
 * column names are known (`{ mode, entities, extra, skipRows, … }`), so a dataset whose sheets have those
 * columns gets its configuration without anyone writing it. `optional` names columns the export may leave
 * out or leave empty (a phone column removed for privacy): what maps them is dropped, the table still fits.
 * @returns {{ name: string, hint: string, optional: string[], sheetOptional: boolean, table: object }[]}
 */
export function presetTables(preset) {
  return (preset?.tableHints ?? []).filter(h => isObj(h) && isObj(h.table) && isStr(h.name)).map(h => {
    const { optional, ...table } = structuredClone(h.table)
    return { name: h.name.trim(), hint: typeof h.hint === 'string' ? h.hint : '', optional: Array.isArray(optional) ? optional.filter(isStr) : [], sheetOptional: h.optional === true, table: { name: h.name.trim(), ...table } }
  })
}

/** A table without what maps the given columns (entity fields, references, custom fields, row filters). */
export function withoutColumns(table, columns) {
  const gone = new Set(columns)
  if (gone.size === 0) return table
  const t = structuredClone(table)
  for (const fields of Object.values(t.entities ?? {})) for (const [f, m] of Object.entries(fields)) if (gone.has(columnOf(m)?.column)) delete fields[f]
  for (const e of Object.keys(t.entities ?? {})) if (Object.keys(t.entities[e]).length === 0) delete t.entities[e]
  if (Array.isArray(t.extra)) t.extra = t.extra.filter(x => !gone.has(x.column) && t.entities[x.entity])
  if (Array.isArray(t.skipRows)) t.skipRows = t.skipRows.filter(f => !gone.has(f.column))
  return t
}

/**
 * Check a preset's ready-made tables as the configuration they would become: with every optional column
 * there, and with every optional column gone. Returns errors; empty when the preset has no such tables.
 */
export function checkPresetTables(preset) {
  const templates = presetTables(preset)
  if (templates.length === 0) return []
  const errors = []
  const { tableHints, columnHints, id, name, pitch, ...rest } = preset
  for (const [label, tables] of [['', templates.map(x => x.table)], ['（可选的列都没有时）', templates.map(x => withoutColumns(x.table, x.optional))]]) {
    const checked = checkSpec({ ...structuredClone(rest), tables: structuredClone(tables) })
    for (const e of checked.errors) errors.push({ path: `tableHints → ${e.path}`, message: `${e.message}${label}` })
    if (errors.length) break
  }
  return errors
}

/** Every column a table's mapping reads, with the path that names it. */
export function mappedColumns(table) {
  const out = []
  for (const [e, fields] of Object.entries(table.entities ?? {})) {
    for (const [f, m] of Object.entries(fields ?? {})) {
      const col = columnOf(m)
      if (col) out.push({ path: `entities.${e}.${f}`, column: col.column })
    }
  }
  ;(table.extra ?? []).forEach((x, j) => { if (isStr(x.column)) out.push({ path: `extra[${j}].column`, column: x.column }) })
  ;(table.skipRows ?? []).forEach((f, j) => { if (isStr(f?.column)) out.push({ path: `skipRows[${j}].column`, column: f.column }) })
  return out
}

/**
 * Check a configuration's tables against the dataset's sheets.
 * A table names its sheet with `source` + `sheet` the first time; after that the
 * dataset remembers which sheets feed it. Mapped columns must exist in the newest
 * sheet of each table.
 * @param {object} spec - checked spec.
 * @param {{ source: string, sheet: number, sheetName: string, sourceName: string, columns: string[], importedAt: string }[]} sheets - usable sheets of the dataset.
 * @param {{ source: string, sheet: number, table: string }[]} bindings - sheets already feeding tables.
 * @returns {{ errors: { path: string, message: string }[], bindings: { source: string, sheet: number, table: string }[] }}
 */
export function checkTables(spec, sheets, bindings = []) {
  const errors = []
  const next = bindings.filter(b => spec.tables.some(t => t.name === b.table) && sheets.some(s => s.source === b.source && s.sheet === b.sheet))
  spec.tables.forEach((t, i) => {
    const p = `tables[${i}]`
    if (t.source !== undefined || t.sheet !== undefined) {
      const fromSource = sheets.filter(s => s.source === t.source)
      if (fromSource.length === 0) { errors.push({ path: `${p}.source`, message: `没有 id 是「${t.source}」的数据源，从 crm_status 里取` }); return }
      const hit = fromSource.find(s => s.sheetName === t.sheet) ?? (t.sheet === undefined && fromSource.length === 1 ? fromSource[0] : null)
      if (!hit) { errors.push({ path: `${p}.sheet`, message: `这个数据源里的工作表是：${fromSource.map(s => s.sheetName).join('、')}` }); return }
      const other = next.find(b => b.source === hit.source && b.sheet === hit.sheet && b.table !== t.name)
      if (other) { errors.push({ path: `${p}.sheet`, message: `工作表「${hit.sheetName}」已经喂给了「${other.table}」，一张工作表只能对一张表` }); return }
      if (!next.some(b => b.source === hit.source && b.sheet === hit.sheet)) next.push({ source: hit.source, sheet: hit.sheet, table: t.name })
    }
    const fed = next.filter(b => b.table === t.name).map(b => sheets.find(s => s.source === b.source && s.sheet === b.sheet)).filter(Boolean)
    if (fed.length === 0) { errors.push({ path: `${p}.source`, message: '这张表还没对上数据源：写 source（crm_status 里数据源的 id）和 sheet（工作表名）' }); return }
    const newest = fed.sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))[0]
    for (const { path, column } of mappedColumns(t)) {
      if (!newest.columns.includes(column)) errors.push({ path: `${p}.${path}`, message: `「${newest.sourceName} · ${newest.sheetName}」里没有「${column}」这一列。这张表的列是：${newest.columns.join('、')}` })
      // An empty column would read as missing on every row: a transaction without its amount, for one, is dropped.
      else if (path.startsWith('entities.') && (newest.empty ?? []).includes(column)) errors.push({ path: `${p}.${path}`, message: `「${column}」这一列整列是空的，对上它每一行都读不出来（交易会因为没有金额整行丢掉）。这张表没有这个字段就别写` })
    }
  })
  return { errors, bindings: next }
}

/** Features a rule uses, flattened. */
export function ruleFeatures(rule) {
  const out = []
  const walk = n => { for (const k of RULE_KEYS) for (const c of n[k] ?? []) (RULE_KEYS.some(x => Array.isArray(c[x])) ? walk(c) : out.push(c)) }
  walk(rule)
  return out
}

/** Entities (and `amount`) a rule needs that this configuration does not have. Such a rule is switched off. */
export function missingEntities(rule, fed) {
  const needs = ruleFeatures(rule).flatMap(c => { const f = FEATURES[c.feature]; return f ? [f.needs, ...(f.money ? ['amount'] : [])] : [] })
  return [...new Set(needs.filter(e => e && !fed.has(e)))]
}

/** Person-facing names of the customer fields rules mention: `city` → 城市, `extra.level` → 会员等级. */
export function fieldNames(spec) {
  const out = {}
  for (const [k, f] of Object.entries(ENTITIES.customer.fields)) out[k] = f.name
  for (const t of spec?.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'customer' && isStr(x.name)) out[`extra.${x.key}`] = x.name
  // Fields of a holding, for `where` conditions: `asset.status`, `asset.extra.benefit_end`.
  for (const [k, f] of Object.entries(ENTITIES.asset.fields)) out[`asset.${k}`] = f.name
  for (const t of spec?.tables ?? []) for (const x of t.extra ?? []) if (x.entity === 'asset' && isStr(x.name)) out[`asset.extra.${x.key}`] = x.name
  return out
}

/** An identity key such as `customer.id` in words: 客户编号 (with the dataset's own label for the entity). */
export function keyName(key, labels = {}) {
  const [e, f] = String(key).split('.')
  const field = ENTITIES[e]?.fields?.[f]?.name
  return field ? `${labels[e] ?? ENTITIES[e].name}${field}` : String(key)
}

const OP_WORDS = { '=': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' }

/** One `where` condition on a holding, in words. */
function describeWhere(w, names = {}) {
  const key = w.field ?? w.days_to ?? w.days_since
  const name = `「${names[`asset.${key}`] ?? String(key ?? '').replace(/^extra\./, '')}」`
  const v = w.value
  if (w.field !== undefined) {
    if (v === '' && (w.op === '=' || w.op === '!=')) return `${name}${w.op === '=' ? '是空的' : '有值'}`
    return w.op === 'in' ? `${name}是 ${v.join(' 或 ')}` : w.op === 'between' ? `${name}在 ${v[0]}～${v[1]}` : `${name} ${OP_WORDS[w.op]} ${v}`
  }
  if (w.days_to !== undefined) {
    if (w.op === 'between') return v[1] < 0 ? `${name}已经过了 ${-v[1]}～${-v[0]} 天` : `离${name}还有 ${v[0]}～${v[1]} 天`
    if (v === 0 && w.op === '<') return `${name}已经过了`
    if (v === 0 && w.op === '>=') return `${name}还没到`
    return `离${name}的天数 ${OP_WORDS[w.op]} ${v}`
  }
  return w.op === 'between' ? `${name}过去了 ${v[0]}～${v[1]} 天` : `${name}过去的天数 ${OP_WORDS[w.op]} ${v}`
}

/** A one-line plain description of a condition, for cards and the config page. `names` from fieldNames. */
export function describeCondition(c, names = {}) {
  const f = FEATURES[c.feature]
  const args = (c.args ?? []).map(a => (Array.isArray(a) ? a.join('/') : a === 'year' ? '年' : a === 'quarter' ? '季度' : a === 'month' ? '月' : typeof a === 'number' ? `${a} 天` : a))
  const field = k => names[k] ?? String(k ?? '').replace(/^extra\./, '')
  const where = Array.isArray(c.where) && c.where.length ? `（只算：${c.where.map(w => describeWhere(w, names)).join('，并且 ')}）` : ''
  const head = c.feature === 'field' ? `「${field(args[0])}」` : c.feature === 'days_since_field' ? `距「${field(args[0])}」多少天` : c.feature === 'tag_count' ? `「${field(args[0])}」有几个值` : `${f?.name ?? c.feature}${args.length ? `（${args.join('，')}）` : ''}${where}`
  if (c.value === '' && (c.op === '=' || c.op === '!=')) return `${head} ${c.op === '=' ? '是空的' : '有值'}`
  if (c.op === 'has' || c.op === 'lacks') return `${head} ${c.op === 'has' ? '含有' : '不含'} ${c.value}`
  const v = c.op === 'between' ? `在 ${c.value[0]}～${c.value[1]}` : c.op === 'in' ? `是 ${c.value.join(' 或 ')}` : `${OP_WORDS[c.op]} ${c.value === true ? '是' : c.value === false ? '否' : c.value}`
  return `${head} ${v}`
}

/** Plain description of a whole rule, nested groups in brackets. */
export function describeRule(rule, names = {}) {
  const key = RULE_KEYS.find(k => Array.isArray(rule[k]))
  if (!key) return ''
  const parts = rule[key].map(c => (RULE_KEYS.some(k => Array.isArray(c[k])) ? `（${describeRule(c, names)}）` : describeCondition(c, names)))
  return parts.join(key === 'all' ? '，并且 ' : '，或者 ')
}

/**
 * The short, model-friendly summary of a configuration: tables, entities fed,
 * segments and the gaps.
 */
export function summarizeSpec(spec) {
  const fed = capabilities(spec)
  const names = fieldNames(spec)
  return {
    tables: spec.tables.map(t => ({ name: t.name, mode: t.mode, entities: Object.keys(t.entities), columns: Object.values(t.entities).flatMap(f => Object.values(f).map(m => columnOf(m)?.column)).filter(Boolean).length + t.extra.length, ...((t.skipRows ?? []).length ? { skip: t.skipRows.map(describeSkip) } : {}) })),
    entities: [...fed],
    segments: spec.segments.map(s => ({ name: s.name, rule: describeRule(s, names), off: missingEntities(s, fed).map(needName), ...(s.kind ? { kind: s.kind } : {}) })),
    flags: spec.flags.map(f => ({ name: f.name, rule: describeRule(f, names), ...(f.kind ? { kind: f.kind } : {}) })),
    dictionaries: Object.fromEntries(Object.entries(spec.dictionaries).map(([k, d]) => [k, Object.keys(d)])),
    identity: spec.identity.map(r => `${r.keys.map(k => keyName(k, spec.labels)).join(' + ')}${r.strength === 'strong' ? '对上就算同一个人' : '对上了只进复核，不自动合并'}${r.strength === 'strong' && r.unless === 'shared' ? '（一个号码对应几个姓名时只进复核）' : ''}`),
    ...(fed.has('lead') ? { leads: leadSettingsText(spec) } : {}),
  }
}

/** The text of a value whatever order its keys were written in; conditions of a rule in any order. */
function stable(v) {
  const norm = (x, key) => {
    if (Array.isArray(x)) { const list = x.map(y => norm(y)); return ['all', 'any', 'where'].includes(key) ? list.map(y => JSON.stringify(y)).sort().map(y => JSON.parse(y)) : list }
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, norm(x[k], k)]))
    return x
  }
  return JSON.stringify(norm(v))
}

/**
 * What a configuration changes against the one it replaces, in plain lines.
 *
 * A model that rewrites the whole configuration to change one thing can drop another without saying so (a column
 * that fed a field, a rule, a row filter). This is the plugin's own account, worked out from the two texts, for
 * the model to check its work against and for the person to read before finalizing. Wording-only parts (notes,
 * descriptions, reasons) are left out.
 * @returns {{ kind: 'drop'|'change'|'add', text: string }[]} what was dropped first, then changed, then added.
 */
export function diffSpec(before, after) {
  const out = []
  const add = (kind, text) => out.push({ kind, text })
  const label = (spec, e) => spec.labels?.[e] ?? ENTITIES[e]?.name ?? e
  const fieldName = (e, f) => ENTITIES[e]?.fields?.[f]?.name ?? f
  const show = m => { const c = columnOf(m); return c ? `「${c.column}」${c.split !== undefined ? '（拆开取一段）' : ''}` : '（空）' }
  const skipText = r => { const { why, ...rest } = r; return `${describeSkip(rest)}${isStr(why) ? `（${why.trim()}）` : ''}` }
  const bt = new Map((before.tables ?? []).map(t => [t.name, t]))
  const at = new Map((after.tables ?? []).map(t => [t.name, t]))
  for (const [name] of bt) if (!at.has(name)) add('drop', `去掉了表「${name}」`)
  for (const [name, t] of at) {
    const b = bt.get(name)
    if (!b) { add('add', `新加了表「${name}」，喂给${Object.keys(t.entities ?? {}).map(e => label(after, e)).join('、')}`); continue }
    const who = `「${name}」表`
    if ((b.mode ?? '') !== (t.mode ?? '')) add('change', `${who}的读法从 ${b.mode} 改成 ${t.mode}`)
    for (const e of new Set([...Object.keys(b.entities ?? {}), ...Object.keys(t.entities ?? {})])) {
      const be = b.entities?.[e]
      const te = t.entities?.[e]
      if (be && !te) { add('drop', `${who}不再喂给「${label(before, e)}」`); continue }
      if (!be && te) { add('add', `${who}新喂给「${label(after, e)}」`); continue }
      for (const f of new Set([...Object.keys(be), ...Object.keys(te)])) {
        const x = be[f]
        const y = te[f]
        if (stable(x ?? null) === stable(y ?? null)) continue
        const what = `${who}：${label(after, e)}的「${fieldName(e, f)}」`
        if (x !== undefined && y === undefined) add('drop', `${what}不再对任何列（原来对的是${show(x)}）`)
        else if (x === undefined) add('add', `${what}对上了${show(y)}`)
        else add('change', `${what}从${show(x)}改成${show(y)}`)
      }
    }
    const key = x => `${x.entity}.${x.key}`
    const bx = new Map((b.extra ?? []).map(x => [key(x), x]))
    const tx = new Map((t.extra ?? []).map(x => [key(x), x]))
    for (const [k, x] of bx) if (!tx.has(k)) add('drop', `${who}：去掉了自定义字段「${x.name}」（列「${x.column}」）`)
    for (const [k, y] of tx) {
      const x = bx.get(k)
      if (!x) add('add', `${who}：新加自定义字段「${y.name}」，读列「${y.column}」`)
      else if (stable({ ...x, name: 0 }) !== stable({ ...y, name: 0 })) add('change', `${who}：自定义字段「${y.name}」改了${x.column !== y.column ? `，列从「${x.column}」改成「${y.column}」` : ''}${x.type !== y.type ? `，类型从 ${x.type} 改成 ${y.type}` : ''}`)
    }
    const sk = r => stable({ column: r.column, when: r.when, values: r.values ?? [] })
    const bs = new Map((b.skipRows ?? []).map(r => [sk(r), r]))
    const ts = new Map((t.skipRows ?? []).map(r => [sk(r), r]))
    for (const [k, r] of bs) if (!ts.has(k)) add('drop', `${who}：这些行又读进来了：${skipText(r)}`)
    for (const [k, r] of ts) if (!bs.has(k)) add('add', `${who}：这些行不读了：${skipText(r)}`)
  }
  for (const k of new Set([...Object.keys(before.dictionaries ?? {}), ...Object.keys(after.dictionaries ?? {})])) {
    const x = before.dictionaries?.[k]
    const y = after.dictionaries?.[k]
    if (stable(x ?? null) === stable(y ?? null)) continue
    if (x && !y) add('drop', `去掉了「${k}」的取值归类`)
    else if (!x) add('add', `新加「${k}」的取值归类（${Object.keys(y).join('、')}）`)
    else {
      const gone = Object.keys(x).filter(v => !Object.hasOwn(y, v))
      const came = Object.keys(y).filter(v => !Object.hasOwn(x, v))
      add(gone.length ? 'drop' : 'change', `「${k}」的取值归类改了${gone.length ? `，去掉 ${gone.join('、')}` : ''}${came.length ? `，新加 ${came.join('、')}` : ''}${!gone.length && !came.length ? '（哪些写法归到哪一类）' : ''}`)
    }
  }
  if (stable(before.identity ?? []) !== stable(after.identity ?? [])) add('change', `认人规则改了：${summarizeSpec(after).identity.join('；')}`)
  const rules = (word, bl, al) => {
    const names = fieldNames(after)
    const bare = r => { const { desc, name, ...rest } = r; return rest }
    const bm = new Map(bl.map(r => [r.name, r]))
    const am = new Map(al.map(r => [r.name, r]))
    for (const [n] of bm) if (!am.has(n)) add('drop', `去掉了${word}「${n}」`)
    for (const [n, r] of am) {
      const b = bm.get(n)
      if (!b) add('add', `新加${word}「${n}」：${describeRule(r, names)}`)
      else if (stable(bare(b)) !== stable(bare(r))) add('change', `${word}「${n}」改了：${describeRule(r, names)}${(b.kind ?? '') !== (r.kind ?? '') ? `；性质从 ${b.kind ?? '没标'} 改成 ${r.kind ?? '没标'}` : ''}`)
    }
    const both = list => list.map(r => r.name).filter(n => bm.has(n) && am.has(n))
    if (word === '分层' && both(bl).join('|') !== both(al).join('|')) add('change', '分层的先后顺序变了（一个人落进第一个命中的层）')
  }
  rules('分层', before.segments ?? [], after.segments ?? [])
  rules('标记', before.flags ?? [], after.flags ?? [])
  const { note: _n1, ...m1 } = before.measures ?? {}
  const { note: _n2, ...m2 } = after.measures ?? {}
  const plain = [[before.labels, after.labels, '几类东西的叫法'], [before.lists, after.lists, '名单的设置（用途、结果、冷静期）'], [before.leads, after.leads, '线索的天数门槛'], [m1, m2, '统计口径'], [before.privacy, after.privacy, '哪些列不给 AI 看'], [before.campaign, after.campaign, '活动效果的算法'], [(before.report?.sections ?? []).map(x => x.title), (after.report?.sections ?? []).map(x => x.title), '报告的章节']]
  for (const [x, y, word] of plain) if (stable(x ?? null) !== stable(y ?? null)) add('change', `${word}改了`)
  const order = { drop: 0, change: 1, add: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind])
}

/** The lead timing settings in words, for the config page and the draft card. */
export function leadSettingsText(spec) {
  const l = { ...LEAD_DEFAULTS, ...(spec.leads ?? {}) }
  return `留资后 ${l.followDays} 天内该有第一次跟进；跟进中的 ${l.staleDays} 天没再联系算「跟进断了」；留资满 ${l.activeDays} 天还没结果算「放太久」，不再算待处理；${l.trialName}看「体验」那一列。`
}
