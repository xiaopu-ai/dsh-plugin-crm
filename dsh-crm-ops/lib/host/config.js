/**
 * 客户运营 · 配置 mode plugin, mounted inside the `crm-config` agent preset.
 *
 * The agent reads the redacted health check of each source and the dataset's
 * preset, interviews the person, and hands in a configuration draft. It can
 * never finalize: `crm_draft_spec` only saves a draft that passed `checkSpec`
 * and matches the dataset's sheets; the person finalizes on the 配置 page or
 * from the card in the chat. `crm_propose_action` puts a button for a
 * person-only fix (cutoff date, header row, re-import) in the chat.
 * The preset gives this mode no file, shell or web tools.
 */
import { CrmError, lossless } from '../core/store.js'
import { ENTITIES, EXTRA_TYPES, FEATURES, IDENTITY_KEYS, LEAD_DEFAULTS, LEAD_RESULTS, LEAD_TRIAL, MODES, OPS, OUTCOME_KINDS, PERIODS, REFS, SEGMENT_KINDS, SERIAL_AS, SKIP_WHEN, WHERE_OPS, describeRule } from '../core/spec.js'
import { datasetParam, json, sessionOf, statusTool } from './shared.js'

export const name = 'crm-ops-config'
export const inject = ['tools', 'systemPrompt', 'crmOps']

/** Model-facing rules for this mode; the long guide is the `crm-config` skill. */
export const SECTION = [
  '## 客户运营台 · 配置',
  '',
  '你帮用户把导入的几张表配置成客户数据：哪一列是什么、类别值怎么统一、怎么认出同一个人、什么算一笔、怎么分层、名单的结果有哪些。开始前先用 skill 工具加载 `crm-config` 技能，按里面的流程做。',
  '',
  '- 用户的话里带着「数据集 xxxxxxxx」。先用 crm_status 看进度，再用 crm_profile 读每个数据源的体检结果，用 crm_get_preset 读这个数据集的起点预设。',
  '- 你看不到姓名、手机号和备注原文，也不需要看。数字只说工具结果里有的。',
  '- 提问用 ask_user_question，一批最多 3 题，以选项为主，每题都有「不确定，先按预设」。先问会改变结果的：哪一列是本人的手机、退款怎么算、交易靠哪一列找到客户、分层的门槛。',
  '- 已经有配置时（crm_status 里有定稿版本或草案），先用 crm_get_spec 读全文，在它上面改；用户没提到的部分原样保留。',
  '- 配置只能通过 crm_draft_spec 交。校验不过会返回带路径的报错，照着改了再交，直到通过。通过后用一两句话说定了什么、还有什么拿不准，请用户在卡片上或配置页点「定稿」。你不能定稿，也不要说已经定稿。',
  '- crm_status 的 links 是插件拿真实值比对出来的表间关联：交易、互动靠哪一列找客户，先照它写；fit.reshaped 为 true 说明用户换了一批形状不同的表，按新表重新起草配置（技能里有做法）。',
  '- 截止日没确认、表头读错、文件要重导：用 crm_propose_action 放按钮。',
  '- 只说大白话，不出现 JSON、字段 id、文件路径和英文报错。',
].join('\n')

/** The vocabulary a model needs to write a configuration, in one compact object. */
export function vocabulary() {
  return {
    entities: Object.fromEntries(Object.entries(ENTITIES).map(([k, e]) => [k, { name: e.name, required: Boolean(e.required), fields: Object.fromEntries(Object.entries(e.fields).map(([f, d]) => [f, `${d.name}（${d.type}${d.secret ? '，敏感' : ''}）`])), ...(e.refs ? { refs: Object.fromEntries(Object.entries(REFS).map(([f, d]) => [f, d.name])), refsRequired: e.refs === true } : {}) }])),
    leadResults: Object.values(LEAD_RESULTS),
    leadTrial: Object.values(LEAD_TRIAL),
    leadDefaults: LEAD_DEFAULTS,
    serialAs: SERIAL_AS,
    extraTypes: EXTRA_TYPES,
    modes: MODES,
    identityKeys: IDENTITY_KEYS,
    features: Object.fromEntries(Object.entries(FEATURES).map(([k, f]) => [k, { name: f.name, args: f.args.map(a => `${a.kind}${a.optional ? '?' : ''}`), needs: f.money ? `${f.needs}（要有金额列）` : f.needs, ...(f.where ? { where: '可以加 where，只算符合条件的持有物' } : {}) }])),
    periods: Object.keys(PERIODS),
    ops: OPS,
    whereOps: WHERE_OPS,
    skipWhen: SKIP_WHEN,
    segmentKinds: SEGMENT_KINDS,
    outcomeKinds: OUTCOME_KINDS,
    notes: [
      'amount 特征和规则里的金额都按元写；库里按分存。',
      '规则写法：{ "name": 层名, "all"|"any": [ { "feature", "args", "op", "value" } 或再嵌套一层 { "all"|"any": [...] } ] }；按顺序匹配，第一条命中就归这一层。',
      'txnType 可以写一个类型或几个类型的列表，必须是 dictionaries["transaction.type"] 里的标准值。',
      '第一次交配置时，每张表写 source（数据源 id）和 sheet（工作表名）；定稿后数据集会记住，之后可以不写。',
      '一格里塞了几样东西（如「C0001:K12 某机构 : 张三」）时，字段写 { "column": 列名, "split": 分隔符, "part": 第几段 }：part 1 是第一段，-1 是最后一段，空白段跳过。crm_status 的 links 里给了能对上的写法，照抄即可。自定义字段 extra 也能写 split、part。',
      '交易必须有时间列；没有金额列也可以（交付、登记这类只记一笔不记钱的表），这时金额类指标和 amount 特征自动停用，按笔数、人数分析。',
      '判断客户字段是不是空的：{ "feature": "field", "args": ["extra.x"], "op": "=", "value": "" } 是空的，"op": "!=" 是有值；别的比较遇到空值一律不命中。',
      '交易表只导出了最近一段、客户表里却有「最近购买日期」「交付年月」这类汇总列时：把它定成客户的 extra（type 写 date；一格写了几个日期会取最近的），分层用 days_since_field 看它，否则老客户会因为交易表里没有记录被当成没买过。先比一比体检里交易日期列的 range 和客户表的汇总列。',
      '每行是一条线索、商机、留资、咨询、报名（有线索编号、留资时间、状态或级别、渠道、跟进日期这类列）的表，喂给 lead，不要喂给 touch，也不要当第二张客户表：线索挂不上客户也照样能算漏斗。客户姓名/昵称写 customerName（只给本人看、遮过才给你），有手机、客户编号才写 customerPhone、customerId，能挂上客户就挂。',
      'lead.result 的标准值只有：成交、战败、休眠、跟进中（不写字典时插件用一套常见写法）；「热、温、冷」这类同时对到 lead.level。lead.trial 是有没有体验（试驾、试听、到店），标准值只有是、否。两列都能写同一个原表列。',
      '另一张表是线索表的子集（比如某个活动的报名表，和总表用同一个线索编号）：也喂给 lead、写同一个 id 列，插件按线索编号合成一条，不会算两遍；按「来自哪张表」能单独看这场活动的线索。',
'行过滤（不要的行）：表上写 "skipRows": [{ "column": 列名, "when": "in"|"not_in"|"contains"|"filled"|"empty", "values": [原表里的写法], "why": 一句话原因 }]，任一条命中这一行就不读。用在：原表自己标了「重复」「作废」「测试」的行、试乘试驾车和展车这类不是卖出去的、已经退网或关店的归属方。values 照体检里的取值一字不差地抄。排除客户表的行以前想一下：别的表（交付、工单）还指着这些客户的话，它们会挂不上，看试跑的 links。',
      '一格里写了几个值（体检里这一列带 multi：「全地形车,摩托艇」「未接通,接通」）：在 extra 里把 type 写成 "tags"，每个值各算一个标签；默认按逗号、顿号、分号、竖线切，别的分隔符写 "sep"。规则里用 { "feature": "field", "args": ["extra.x"], "op": "has", "value": "摩托艇" }（含有）、"lacks"（不含，空的也算不含）、"in"（含有其中任一个）；数有几个值用 tag_count。按这个字段拆指标时一个人会算进好几组。multi 里写着 dates 的列是一格几个日期，type 写 date。',
      '持有物上的字段进规则：asset_count、asset_age_days、asset_days_to_end 可以加 "where": [条件...]，只算全部条件都满足的那几件。条件三种：{ "field": "status"|"type"|"model"|"owner"|"extra.x", "op", "value" }；{ "days_to": "end"|"start"|"extra.某个日期", "op", "value" }（离这个日期还有多少天，负数是已经过了）；{ "days_since": 日期字段, "op", "value" }。例：有一件「权益还没用、60 天内失效」的 → { "feature": "asset_count", "where": [{ "field": "status", "op": "=", "value": "待使用" }, { "days_to": "extra.benefit_end", "op": "between", "value": [0, 60] }], "op": ">=", "value": 1 }。要用的日期先在这张表的 extra 里加成 entity 为 asset、type 为 date 的字段。',
      '分层和标记可以写 "kind" 说明它是什么（segmentKinds）。不写时看板按规则的样子猜：「很久没交易」的层会被当成流失，掉进去算变差。买一次用很多年的生意（车、房、设备）里，「买了多久」是生命周期阶段，写 "kind": "lifecycle"；要定期回来的（保养、续费、复购）才是流失，不用写。',
      '试跑结果（crm_draft_spec 返回的 trial）里：excluded 是每张表被行过滤排除了多少行、各是什么原因；groups 是按这份草案每一层、每个标记现在有多少人；hints 是值得再看一眼的地方（某一层一个人都没有、像生命周期的层被当成了流失）。hints 不拦定稿，但要看。',
'归属方（门店、经销商、校区）要按家对比，几类数据上的归属方就得是同一个写法。常见的坑：客户表写简称、线索表写公司全称、交付单写「代码 全称」。做法：这几张表都另外喂给 owner 这一类，{ "owner": { "id": 代码那一列（或 { column, split, part } 取代码那一段）, "name": 名称 } }；插件把同一个代码的认成一家，名字用配置里排在最前面的那张表给的，其余写法都算它的别名。之后 customer.owner、transaction.owner、lead.owner 不管写的是代码、简称还是全称，都会读成同一个名字。交易表、持有物表有归属方那一列也要对上 owner（没对上时按客户的归属方算）。',
      '归属方的属性（大区、负责人、类型）：写成 extra，entity 写 "owner"，如 { "entity": "owner", "key": "region", "name": "大区", "column": "所属大区", "type": "category" }，要写在喂了 owner 的那张表上。看板能按它汇总。一家在不同的行里属性不一样时取出现最多的那个。',
      '试跑的 hints 里说「……上写的归属方有 N 个，……上有 M 个，名字对得上的只有 K 个」：就是上面这个坑，照着把 owner 喂上再交一版。',
            'leads：{ followDays: 留资后几天内该首次跟进（默认 2）, staleDays: 多少天没再联系算跟进断了（默认 14）, activeDays: 留资多少天还没结果算放太久（默认 90）, trialName: 这一家怎么叫体验（如「试驾」）, minGroup: 少于多少条不比较（默认 30） }。这些默认是假设，问用户或标出待确认。',
    ],
  }
}

/**
 * Tool definitions over one dataset store.
 * @param {import('../core/store.js').Datasets} datasets - shared store.
 */
export function configTools(datasets) {
  // What the dataset's preset says about the tables it just drafted: its notes, and the hint of each table used.
  const presetDecisions = async (id, tables) => {
    const p = await datasets.starter(id)
    const used = new Set((tables ?? []).map(t => t.name))
    return { notes: p.notes ?? null, tables: (p.tableHints ?? []).filter(t => used.has(t.name) && t.hint).map(t => ({ table: t.name, says: t.hint })) }
  }
  return [statusTool(datasets, { links: true }), {
    name: 'crm_profile',
    description: '读一个数据源的体检结果（遮过敏感信息）：每张表的表头位置、跳过的行、每列认成什么类型、填了多少、能读出来的比例、取值分布、日期范围、金额合计，以及要先处理和要确认的问题。',
    parameters: { type: 'object', properties: { dataset: datasetParam, source: { type: 'string', description: 'crm_status 里数据源的 id' } }, required: ['dataset', 'source'] },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value) },
    async execute(args) {
      const source = String(args.source ?? '')
      if (!/^[a-f0-9]{8}$/.test(source)) throw new CrmError('no-source', '数据源 id 要从 crm_status 里取')
      const id = String(args.dataset ?? '')
      const spec = await datasets.currentSpec(id).catch(() => null)
      return datasets.redactedProfile(id, source, { summaryOnly: spec?.privacy?.summaryOnly === true })
    },
  }, {
    name: 'crm_get_spec',
    description: '读这个数据集现在的配置全文：定稿在用的那一版（current），和还没定稿的最新草案（draft，有的话）。用户要改配置时先读它，在它上面改，再用 crm_draft_spec 交全文；用户没提到的部分原样保留，别从预设重写。',
    parameters: { type: 'object', properties: { dataset: datasetParam }, required: ['dataset'] },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value) },
    async execute(args) {
      const st = await datasets.specState(String(args.dataset ?? ''))
      return {
        current: st.current === null ? null : { version: st.current, spec: st.spec },
        draft: st.draft ? { revision: st.draft.revision, basedOn: st.draft.base, spec: st.draft.spec } : null,
        note: st.current === null && !st.draft ? '还没有配置：按 crm_get_preset 的起点起草。' : '改的时候以最新的那份为底（有草案就用草案），只动用户要改的地方，交全文。',
      }
    },
  }, {
    name: 'crm_get_preset',
    description: '读这个数据集的起点预设（行业默认值）：每类表该有哪些列的提示、取值字典、认人规则、统计口径、分层规则、名单用途和结果、报告结构，以及写配置能用的全部词表（字段、特征、比较、结果类型）。起草配置前先读一次。',
    parameters: { type: 'object', properties: { dataset: datasetParam }, required: ['dataset'] },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value) },
    async execute(args) {
      const p = await datasets.starter(String(args.dataset ?? ''))
      return {
        preset: { name: p.name, pitch: p.pitch, labels: p.labels, tableHints: p.tableHints, columnHints: p.columnHints, dictionaries: p.dictionaries, identity: p.identity, measures: p.measures, segments: p.segments.map(s => ({ ...s, plain: describeRule(s) })), flags: p.flags, lists: p.lists, leads: p.leads, campaign: p.campaign, privacy: p.privacy, report: p.report, notes: p.notes },
        vocabulary: vocabulary(),
      }
    },
  }, {
    name: 'crm_draft_from_preset',
    description: '按这个数据集的预设直接起草配置，不用你写。有的预设带着现成的表对应（某个系统固定的导出格式）；crm_status 的 presetFit.ready 为 true 时，导入的表和它对得上，调这个工具就能得到完整的草案：表怎么读、字典、认人、分层、标记、名单都照预设来。结果和 crm_draft_spec 一样：存成草案、对话里出一张卡片、带试跑结果（trial）。presetFit.unmatched 里的表没对上（没导入，或者列名变了），草案里就没有它；要加进去再用 crm_get_spec 读草案、补上那张表、用 crm_draft_spec 交。',
    parameters: { type: 'object', properties: { dataset: datasetParam }, required: ['dataset'] },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => json(value),
      presentationMeta: (_args, value) => (value.ok ? { draft: { dataset: value.dataset, datasetName: value.datasetName, revision: value.revision, summary: value.summary, changes: value.changes, problems: value.trial?.problems ?? [], links: value.trial?.links ?? [], excluded: value.trial?.excluded ?? [], groups: value.trial?.groups ?? null, hints: value.trial?.hints ?? [], diff: diffForCard(value.diff) } } : {}),
    },
    async execute(args, exec) {
      const id = String(args.dataset ?? '')
      const d = await datasets.get(id)
      try {
        const saved = await datasets.draftFromPreset(id, { sessionId: sessionOf(exec) ?? null })
        const trial = saved.trial ?? null
        const left = saved.unmatched.filter(x => !x.optional)
        return {
          ok: true, dataset: d.id, datasetName: d.name, revision: saved.revision, summary: saved.summary,
          changes: `按预设「${saved.preset.name}」直接起草：${saved.tables.map(t => `「${t.name}」← ${t.sourceName}`).join('；')}`.slice(0, 200),
          preset: saved.preset,
          tables: saved.tables, unmatched: saved.unmatched, dropped: saved.dropped,
          // What whoever wrote the preset already settled for these very tables, and why: not to be asked again.
          decided: await presetDecisions(id, saved.tables),
          ...(saved.diff ? { diff: diffForModel(saved.diff) } : {}),
          trial: trial && { ok: trial.ok, counts: trial.counts, links: trial.links, problems: trial.problems, excluded: trial.excluded, groups: trial.groups, hints: trial.hints, note: trial.note },
          note: `草案按预设存好了，对话里有一张卡片。预设已经为这几张表定好的取舍在 decided 里（哪些行留、哪些列怎么读、为什么）：照着来，不要为它们再去翻体检、再问用户，更不要推荐和它相反的做法；其中写着「假设」「待确认」的几条，用一两句话告诉用户，他想改再改。只有 decided 没提到、又会明显改变数字的事才问。${left.length ? `预设里的${left.map(x => `「${x.name}」`).join('')}没对上表，草案里没有它，告诉用户缺什么。` : ''}${saved.dropped.length ? `这几列这次的表里没有或是空的，没对：${saved.dropped.map(x => `「${x.name}」的${x.columns.join('、')}`).join('；')}。` : ''}${trial?.problems?.length ? `试跑发现 ${trial.problems.length} 处不对（trial.problems），先改。` : trial?.hints?.length ? `试跑有 ${trial.hints.length} 处值得再看一眼（trial.hints），用一句大白话告诉用户。` : ''}预设里的门槛（天数、哪些行不算）是假设，用两三句话说清楚定了什么、哪几处待确认，请用户点「定稿」。你不能定稿。`,
        }
      } catch (error) {
        if (!['no-template', 'no-fit', 'bad-spec'].includes(error.code)) throw error
        return { ok: false, error: error.message, ...(error.details?.errors ? { errors: error.details.errors.slice(0, 20) } : {}), note: '按预设起草不了，照常读体检、访谈、用 crm_draft_spec 交。' }
      }
    },
  }, {
    name: 'crm_draft_spec',
    description: '交一份完整的配置草案（每次都交全文）。会先过规则检查，再对照数据集里的表检查列名；不通过就返回带路径的中文报错，照着改了再交。通过后存成草案，用户在卡片上或配置页点「定稿」才生效。写法：{ labels, tables: [{ name, source, sheet, mode, entities: { customer: { 字段: 列名 }, transaction: {...} }, extra: [...], fingerprint: [...] }], dictionaries, identity, measures, segments, flags, lists, campaign, privacy, report, notes }。',
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        spec: { type: 'object', description: '完整的配置' },
        changes: { type: 'string', description: '一两句大白话：这一版定了什么、和上一版比改了什么' },
      },
      required: ['dataset', 'spec'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => json(value),
      presentationMeta: (_args, value) => (value.ok ? { draft: { dataset: value.dataset, datasetName: value.datasetName, revision: value.revision, summary: value.summary, changes: value.changes, problems: value.trial?.problems ?? [], links: value.trial?.links ?? [], excluded: value.trial?.excluded ?? [], groups: value.trial?.groups ?? null, hints: value.trial?.hints ?? [], diff: diffForCard(value.diff) } } : {}),
    },
    async execute(args, exec) {
      const id = String(args.dataset ?? '')
      const d = await datasets.get(id)
      try {
        const saved = await datasets.saveSpecDraft(id, args.spec, { sessionId: sessionOf(exec) ?? null })
        const trial = saved.trial ?? null
        const bad = trial?.problems?.length > 0
        return {
          ok: true, dataset: d.id, datasetName: d.name, revision: saved.revision, summary: saved.summary, changes: String(args.changes ?? '').slice(0, 200),
          // What the plugin itself sees changed, so a rewrite cannot lose something without anyone noticing.
          ...(saved.diff ? { diff: diffForModel(saved.diff) } : {}),
          // The draft was run once over the real sheets: what loaded, and how many rows of each table found their customer.
          trial: trial && { ok: trial.ok, counts: trial.counts, links: trial.links, problems: trial.problems, excluded: trial.excluded, groups: trial.groups, hints: trial.hints, note: trial.note },
          note: bad
            ? `草案存好了，但试跑发现 ${trial.problems.length} 处不对（见 trial.problems）。先照着改一版再交，不要现在就请用户定稿。确实就该这样（比如这张表里的人本来就不在客户表里）才留着，并用大白话告诉用户：哪张表有多少行挂不上、为什么、会影响什么。`
            : trial?.hints?.length > 0
              ? `草案已存好，对话里有一张卡片。试跑没有拦路的问题，但有 ${trial.hints.length} 处值得再看一眼（trial.hints）：该改就改一版再交；不用改的，在回复里用一句大白话告诉用户为什么。然后请用户点「定稿」。你不能定稿。`
              : '草案已存好，对话里有一张卡片。请用户看一眼，满意就点「定稿」。你不能定稿。',
          ...(dropped(saved.diff).length ? { check: `和${saved.diff.against}比，这一稿少了 ${dropped(saved.diff).length} 处（diff.dropped）。逐条看：是你有意去掉的，在回复里告诉用户去掉了什么、为什么；不是有意的，原样补回去再交一稿。别说「其余不变」而不核对。` } : {}),
        }
      } catch (error) {
        if (error.code !== 'bad-spec') throw error
        return { ok: false, errors: error.details.errors.slice(0, 30), note: '没存。按 path 和说明逐条改好，再交一次全文。' }
      }
    },
  }, {
    name: 'crm_propose_action',
    description: '在对话里放一张带按钮的卡片，让用户一键做一件只有他能做的事。你调用它不会改任何东西，用户点了按钮才生效。kind：confirm-asof 确认数据截止日（value 写 YYYY-MM-DD）；set-header 换表头行（source、sheet 写工作表名、value 写行号）；reimport 重新导入某个文件（source）；build 运行清洗和合并（配置定稿、截止日确认以后才行）；ack 数据有问题（data.problems）但用户决定先这样用；review 有疑似同一人没确认（卡片上能去复核，也能先跳过）；import-feishu 用户贴了飞书多维表格的链接（value 写链接）。reason 用一句大白话说为什么要做。',
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        kind: { type: 'string', enum: Object.keys(ACTIONS) },
        source: { type: 'string', description: 'set-header、reimport 时填 crm_status 里数据源的 id' },
        sheet: { type: 'string', description: 'set-header 时填工作表名' },
        value: { type: 'string', description: 'confirm-asof 填日期；set-header 填行号；import-feishu 填链接' },
        reason: { type: 'string', description: '一句大白话：为什么要做这件事' },
      },
      required: ['dataset', 'kind', 'reason'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => json({ shown: true, note: value.note }),
      presentationMeta: (_args, value) => ({ action: value.action }),
    },
    async execute(args) {
      const action = await checkAction(datasets, args)
      return { action, note: '卡片已经放在对话里了，用户点按钮才会生效。不要说已经改好了。' }
    },
  }]
}

/** Actions the agent may propose; each maps to one person-only Host call. */
export const ACTIONS = Object.freeze({
  'confirm-asof': '确认数据截止日',
  'set-header': '换表头行',
  reimport: '重新导入文件',
  build: '运行清洗和合并',
  ack: '先这样用这一版数据',
  review: '复核疑似同一人',
  'import-feishu': '从飞书多维表格导入',
})

/** The plugin's own diff of a draft, cut to what a model needs: what is gone first, then what changed, then what is new. */
const dropped = diff => (diff?.lines ?? []).filter(x => x.kind === 'drop')
function diffForModel(diff) {
  const split = list => { const of = k => list.filter(x => x.kind === k).slice(0, 15).map(x => x.text); return { dropped: of('drop'), changed: of('change'), added: of('add') } }
  return { against: diff.against, ...split(diff.lines), ...(diff.lines.length ? {} : { same: true }), ...(diff.sinceLast ? { sinceLastDraft: diff.sinceLast.length ? split(diff.sinceLast) : { same: true } } : {}), note: '这是插件自己逐项比出来的，不是你写的 changes。dropped 是这一稿里没有了的东西。' }
}

/** The same lines back as `{ kind, text }` for the card (the tool result is what both the model and the card get). */
function diffForCard(diff) {
  if (!diff) return null
  const of = (k, list) => (list ?? []).map(text => ({ kind: k, text }))
  return { against: diff.against, lines: [...of('drop', diff.dropped), ...of('change', diff.changed), ...of('add', diff.added)] }
}

/** Validate a proposed action against the dataset, so the card only offers what is possible. */
export async function checkAction(datasets, args) {
  const d = await datasets.get(String(args.dataset ?? ''))
  const kind = String(args.kind ?? '')
  const reason = String(args.reason ?? '').trim().slice(0, 120)
  if (!Object.hasOwn(ACTIONS, kind)) throw new CrmError('bad-action', `kind 只能是：${Object.keys(ACTIONS).join('、')}`)
  if (reason === '') throw new CrmError('bad-action', 'reason 要写一句为什么')
  const base = { dataset: d.id, datasetName: d.name, kind, title: ACTIONS[kind], reason }
  if (kind === 'confirm-asof') {
    const value = String(args.value ?? d.asOf ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CrmError('bad-action', 'confirm-asof 的 value 要写成 YYYY-MM-DD')
    return { ...base, value }
  }
  if (kind === 'review') {
    const st = await datasets.status(d.id)
    const open = st.data?.review?.open ?? 0
    if (!st.data || open === 0 || st.data.review.skipped) throw new CrmError('bad-action', '现在没有等用户复核的合并，不用放这张卡片')
    return { ...base, open }
  }
  if (kind === 'import-feishu') {
    const value = String(args.value ?? '').trim()
    if (!/^https?:\/\/\S+$/.test(value)) throw new CrmError('bad-action', 'import-feishu 的 value 要写用户给的飞书多维表格链接（https:// 开头）')
    return { ...base, value }
  }
  if (kind === 'build' || kind === 'ack') {
    const st = await datasets.status(d.id)
    if (kind === 'build') {
      if (st.spec.current === null) throw new CrmError('bad-action', '配置还没定稿，清洗不了：先交配置草案，请用户在草案卡片上点「定稿」（定稿后插件会自动清洗）')
      if (!st.asOfConfirmed) throw new CrmError('bad-action', '截止日还没确认，清洗不了：先放一张 confirm-asof 卡片')
      return { ...base, version: st.data?.version ?? null, stale: st.data ? Boolean(st.data.stale) : true }
    }
    if (!st.data?.broken) throw new CrmError('bad-action', '现在没有等用户确认的数据问题，不用放这张卡片')
    return { ...base, version: st.data.version, problems: st.data.problems ?? [] }
  }
  const source = d.sources.find(s => s.id === String(args.source ?? ''))
  if (!source) throw new CrmError('bad-action', 'source 要从 crm_status 里取')
  if (kind === 'reimport') return { ...base, source: source.id, sourceName: source.name, sourceKind: source.kind }
  const sheet = source.sheets.find(x => x.name === String(args.sheet ?? '')) ?? (source.sheets.length === 1 ? source.sheets[0] : null)
  if (!sheet) throw new CrmError('bad-action', `sheet 要写工作表名：${source.sheets.map(x => x.name).join('、')}`)
  const row = Number(args.value)
  if (!Number.isInteger(row) || row < 1 || row > 20) throw new CrmError('bad-action', 'set-header 的 value 要写 1～20 的行号')
  return { ...base, source: source.id, sourceName: source.name, sheet: sheet.index, sheetName: sheet.name, value: String(row), current: sheet.headerRow }
}

/**
 * Plugin entry: register the tools and the prompt section in this agent's scope.
 * @param {import('@deepseek-ai/cordis').Context} ctx - agent-scoped context.
 */
/** Tool results go through lossless(): the tool channel rejects undefined, NaN and -0. */
const jsonSafe = tool => ({ ...tool, execute: async (args, exec) => lossless(await tool.execute(args, exec)) })

export function apply(ctx) {
  const { datasets } = ctx.crmOps
  for (const tool of configTools(datasets)) ctx.effect(() => ctx.tools.register(jsonSafe(tool)), `${name}: ${tool.name}`)
  ctx.effect(() => ctx.systemPrompt.section({ name: 'crm-ops:config', order: 9000, text: SECTION, interpolate: false }), `${name}: prompt section`)
}
