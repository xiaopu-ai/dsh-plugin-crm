/**
 * 客户运营 · 分析 mode plugin, mounted inside the `crm-analyst` agent preset.
 *
 * The agent answers questions about one dataset with the closed query list
 * (`crm_query`), writes report drafts whose numbers are references to logged
 * queries (`crm_save_report_draft`), and proposes dictionary entries or rules
 * into 待确认 (`crm_propose_rule`). It never sees names or contact details, and
 * it cannot finalize a report, adopt a rule, export or push a list: those are
 * the person's clicks. The preset gives this mode no file, shell or web tools.
 */
import { queryVocabulary } from '../core/analysis.js'
import { FEATURES, OPS, describeRule } from '../core/spec.js'
import { datasetParam, json, sessionOf } from './shared.js'
import { plainProposal, lossless } from '../core/store.js'
import { parseRefs, render, resolveRefs } from '../core/report.js'

export const name = 'crm-ops-analyst'
export const inject = ['tools', 'systemPrompt', 'crmOps']

export const SECTION = [
  '## 客户运营台 · 分析',
  '',
  '你帮运营同事看懂一批客户数据：现在各层有多少人、哪里在变、活动有没有用、下一步该找谁。开始前先用 skill 工具加载 `crm-analyst` 技能，按里面的做法来。',
  '',
  '- 用户的话里带着「数据集 xxxxxxxx」。先用 crm_status 看进度和能用的查询词表；没有数据版本就请用户先到「数据源」把流程走完。',
  '- 所有数字只能来自 crm_query 的结果。每次查询都有编号（q1、q2…），说数字时顺带说出处，例如「近 30 天收入 12.3 万（q4）」。查不到的就说查不到，不要估。',
  '- 「增长了多少」「比上个月多了多少」只能来自 compare 查询。',
  '- 你看不到姓名、手机号和备注，客户只有编号（K 开头）。要联系具体的人，请用户在「客户」或「名单」页看。',
  '- 想改字典或分层规则：用 crm_propose_rule 提议，进「待确认」，用户采纳才生效。你不能改配置。',
  '- 写报告：用 crm_save_report_draft 交全文，数字一律写成 {{q3.value}} 这样的引用。你不能定稿，用户在报告页点定稿。',
  '- 活动效果只说「参加的和没参加的差多少」，不要说成活动带来的增量；人数不够时只报数字不下结论。',
  '- 线索（有的话）是另一批人：线索数、跟进率、成交率都按留资时间取一段，看它们到截止日走到哪一步，最近进来的还没走完，成交率天然偏低，比较时说清楚。线索的活动、渠道效果用 lead_funnel 按 channel、source、campaign 拆，不要用 campaign_effect。',
  '- 只说大白话，不出现 JSON、字段 id 和英文报错。',
].join('\n')

/**
 * Tool definitions over one dataset store.
 * @param {import('../core/store.js').Datasets} datasets - shared store.
 */
/** A card's reason is read as is: report-style {{q1.value}} references become their numbers. */
async function plainReason(datasets, id, text) {
  const cited = parseRefs(text)
  if (cited.length === 0) return text
  const log = new Map((await datasets.queryLog(id, cited.map(r => r.ref))).map(q => [`q${q.n}`, q]))
  const { refs } = resolveRefs(text, log)
  return render(text, refs).replace(/\{\{[^}]*\}\}/g, '?')
}

export function analystTools(datasets) {
  return [{
    name: 'crm_status',
    description: '读一个数据集现在的进度和能用的查询词表：数据截止日、数据版本、对账结果、复核还剩多少、待确认有几条，以及 crm_query 能用的指标（metrics）、拆分维度（dimensions）、分层名、标记名、交易类型、互动渠道和每种查询的参数写法。',
    parameters: { type: 'object', properties: { dataset: datasetParam }, required: ['dataset'] },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value) },
    async execute(args) {
      const id = String(args.dataset ?? '')
      const status = await datasets.status(id)
      const spec = await datasets.currentSpec(id)
      const pending = await datasets.pending(id)
      return {
        name: status.name,
        asOf: status.asOf,
        step: status.step,
        next: status.next,
        data: status.data,
        pending: { unknownFields: pending.unknown.length, proposals: pending.proposals.filter(p => p.status === 'open').length },
        segments: spec ? spec.segments.map(s => ({ name: s.name, rule: s.desc || describeRule(s) })) : [],
        flags: spec ? spec.flags.map(s => ({ name: s.name, rule: s.desc || describeRule(s) })) : [],
        query: spec ? queryVocabulary(spec) : null,
        report: spec?.report?.sections?.length ? { sections: spec.report.sections } : { sections: [{ title: '一句话结论' }, { title: '各层变化' }, { title: '值得注意的地方' }, { title: '建议找谁' }] },
        lists: status.data ? (await datasets.lists(id)).batches.map(b => ({ batch: b.id, name: b.name, purpose: b.purpose, createdAt: b.createdAt, people: b.people, status: b.status, ratePct: b.ratePct, baseRatePct: b.base?.ratePct ?? null })) : [],
        reports: (await datasets.reports(id)).map(r => ({ name: r.name, title: r.title, draft: r.draft ? { revision: r.draft.revision, problems: r.draft.problems.length } : null, versions: r.versions.length })),
      }
    },
  }, {
    name: 'crm_query',
    description: '按封闭清单查数。kind：segments 各层人数（params.flows=true 带近 30 天流动）；metric 一个指标；breakdown 按维度拆；compare 两段时间对比（变化率只能从这里来）；cohort 按首次出现月份看复购；campaign_effect 活动效果；quality 数据质量；sample 遮过的样例行（≤ 20）；list_effect 一份名单的结果；lead_funnel 线索漏斗（跟进、体验、成交、首跟用时、各状态，可按渠道、归属方等拆）；owner_board 归属方（门店、经销商）横向对比：每家的客户数、交易、线索跟进和成交、待处理、各标记人数，可按大区这类属性汇总，带 owner 只看一家；reach 触达覆盖：标成触达渠道的标记各覆盖多少客户、多少人一个渠道都没有，按分层、归属方或大区拆。参数写法和可选值在 crm_status 的 query 里。每次结果有编号 ref（q1、q2…），报告里用 {{ref.路径}} 引用。',
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        kind: { type: 'string', enum: ['segments', 'metric', 'breakdown', 'compare', 'cohort', 'campaign_effect', 'quality', 'sample', 'list_effect', 'lead_funnel', 'owner_board', 'reach'] },
        params: { type: 'object', description: '这种查询的参数，见 crm_status 返回的 query.params' },
      },
      required: ['dataset', 'kind'],
    },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value) },
    async execute(args, exec) {
      const id = String(args.dataset ?? '')
      try {
        const { ref, result } = await datasets.query(id, String(args.kind ?? ''), args.params ?? {}, { session: sessionOf(exec) ?? null })
        return { ref, ...result, cite: `报告里引用：{{${ref}.value}}、{{${ref}.rows[0].count}} 这样写，路径对着上面的结果。` }
      } catch (error) {
        if (error.code === 'bad-query' || error.code === 'no-data') return { ok: false, error: error.message }
        throw error
      }
    },
  }, {
    name: 'crm_save_report_draft',
    description: '交一份报告草稿（每次交全文，Markdown）。统计数字一律写成引用：{{q3.value}}、{{q5.rows[0].count}}、{{q7.changePct}}，路径对着那次 crm_query 的结果。插件会检查引用和正文里每个数字，没有出处的数字会列在 problems 里（第几行、哪个数），改成引用或删掉再交。改已有的报告时带上 name。你不能定稿，用户在报告页点定稿。',
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        title: { type: 'string', description: '报告标题，例如「10 月客户周报」' },
        name: { type: 'string', description: '改已有报告时填上次返回的 name' },
        body: { type: 'string', description: 'Markdown 正文，数字用 {{q几.路径}} 引用' },
      },
      required: ['dataset', 'body'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => json(value),
      presentationMeta: (_args, value) => (value.ok ? { report: { dataset: value.dataset, datasetName: value.datasetName, name: value.name, title: value.title, revision: value.revision, problems: value.problems.length } } : {}),
    },
    async execute(args, exec) {
      const id = String(args.dataset ?? '')
      const d = await datasets.get(id)
      try {
        const saved = await datasets.saveReportDraft(id, { title: args.title, body: args.body, name: args.name }, { session: sessionOf(exec) ?? null, by: 'ai' })
        return {
          ok: true, dataset: d.id, datasetName: d.name, ...saved,
          problems: saved.problems.slice(0, 30).map(p => ({ line: p.line, text: p.text, message: p.message })),
          note: saved.problems.length ? '草稿存了，但有数字没有出处，用户定稿不了。按 problems 改好，带上 name 再交一次全文。' : '草稿已存，对话里有一张卡片。请用户在报告页看一眼，满意就点定稿。你不能定稿。回复用户时写真实的数字加出处（「2,396 条（q3）」），`{{…}}` 只在报告正文里才会被换成数，写在对话里用户看到的就是花括号。',
        }
      } catch (error) {
        if (!['bad-report', 'no-report', 'no-data'].includes(error.code)) throw error
        return { ok: false, error: error.message }
      }
    },
  }, {
    name: 'crm_propose_list',
    description: '在对话里放一张「生成名单」卡片，预先填好挑谁（分层、标记、归属方）和原因。你调用它不会生成任何名单：卡片上写着符合多少人、分在几个归属方、自动去掉多少人，用户点「生成名单并导出 Excel」才生成（姓名打码、不带手机号）；要换人、带手机号、推到平台工坊，他点「细调」。名单要分别发给各家（每家只拿到自己的人）时带 perOwner: true，卡片会默认勾上「每家单独一份」，导出来是一个压缩包、每家一个文件。用在用户说「帮我拉一份 XX 的名单」「这些人该联系了」时。',
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        segment: { type: 'string', description: '分层名，见 crm_status 的 segments' },
        flag: { type: 'string', description: '标记名，可选' },
        without: { description: '不带哪个标记：一个标记名，或几个名字的列表（一个都不带）。补触达缺口用：某一层里没加企微的人' },
        was: { type: 'string', description: '30 天前在哪一层，可选；和 segment 一起就是「从那层换到这层」的人，例如刚从活跃掉进沉睡的' },
        owner: { type: 'string', description: '归属方，可选' },
        perOwner: { type: 'boolean', description: '每个归属方单独一个文件（打成压缩包），要分别发给各家时用' },
        goal: { description: '这份名单成没成看什么。不写：有 without 时就是「下次导入时带上了那个标记」，没有 without 时看交易。也可以写一个标记名（或几个，带上任何一个都算）；写 "none" 是只看交易' },
        purpose: { type: 'string', description: '为什么联系，见 crm_status 里配置的名单用途' },
        reason: { type: 'string', description: '一句大白话：为什么建议联系这批人。直接写数字和出处，例如「沉睡 6 人（q1）」；这里不是报告，不用 {{}} 引用' },
      },
      required: ['dataset', 'reason'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => json(value),
      presentationMeta: (_args, value) => (value.ok ? { list: value.list } : {}),
    },
    async execute(args) {
      const id = String(args.dataset ?? '')
      const d = await datasets.get(id)
      try {
        const pool = await datasets.listPool(id, { segment: args.segment || undefined, flag: args.flag || undefined, without: args.without || undefined, was: args.was || undefined, owner: args.owner || undefined, purpose: args.purpose || undefined, goal: args.goal })
        const reason = await plainReason(datasets, id, String(args.reason ?? ''))
        return { ok: true, list: { dataset: d.id, datasetName: d.name, segment: args.segment ?? null, flag: args.flag ?? null, without: args.without ? [].concat(args.without).map(String) : null, was: args.was ?? null, owner: args.owner ?? null, purpose: pool.purpose, name: pool.name, kept: pool.kept, match: pool.match, excluded: pool.excluded, owners: (pool.byOwner ?? []).length, perOwner: args.perOwner === true, goal: pool.goal ?? null, reason: reason.slice(0, 200) }, note: `卡片已经放在对话里：符合条件 ${pool.match} 人，自动去掉 ${pool.match - pool.kept} 人，能进名单 ${pool.kept} 人，分在 ${(pool.byOwner ?? []).length} 个归属方。${args.perOwner === true ? '导出来是一个压缩包，每家一个文件。' : '导出来是一张表，带归属方那一列。'}用户点了才会生成。${pool.goal ? `这份名单成没成看标记：下次导入新数据以后，这批人里有多少${pool.goal.text}了，并和当时同样没有、没进名单的人比（用 list_effect 查）。告诉用户这一点：要等下一期数据进来才看得到。` : ''}` }
      } catch (error) {
        if (!['bad-pick', 'bad-goal', 'no-data'].includes(error.code)) throw error
        return { ok: false, error: error.message }
      }
    },
  }, {
    name: 'crm_propose_rule',
    description: '提议一条字典条目、分层规则或标记规则，放进「待确认」。用户采纳后变成配置草案，再由用户定稿才生效；你调用它不会改任何东西。kind=dictionary：dictionary（如 transaction.type）、value（标准值）、variants（要归到它下面的写法）；kind=segment 或 flag：rule（{ name, desc, all|any: [{ feature, args, op, value }] }），replaces（要替换的旧规则名，可选），position（分层插到第几位，从 0 数，可选）。reason 用一句大白话说为什么。',
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        kind: { type: 'string', enum: ['dictionary', 'segment', 'flag'] },
        dictionary: { type: 'string' },
        value: { type: 'string' },
        variants: { type: 'array', items: { type: 'string' } },
        rule: { type: 'object' },
        replaces: { type: 'string' },
        position: { type: 'integer' },
        reason: { type: 'string' },
      },
      required: ['dataset', 'kind', 'reason'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => json(value),
      presentationMeta: (_args, value) => (value.ok ? { proposal: value.proposal } : {}),
    },
    async execute(args, exec) {
      const id = String(args.dataset ?? '')
      const d = await datasets.get(id)
      try {
        const p = await datasets.propose(id, args, { session: sessionOf(exec) ?? null })
        return { ok: true, proposal: { ...p, dataset: d.id, datasetName: d.name, plain: plainProposal(p) }, note: '已经放进「待确认」，对话里有一张卡片。用户在卡片上点「采纳」，再点「定稿并清洗」才生效。不要说已经改好了。' }
      } catch (error) {
        if (error.code !== 'bad-proposal') throw error
        return { ok: false, error: error.message, features: Object.keys(FEATURES), ops: OPS }
      }
    },
  }]
}

/**
 * Plugin entry: registers the analyst tools and this mode's system prompt section.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
/** Tool results go through lossless(): the tool channel rejects undefined, NaN and -0. */
const jsonSafe = tool => ({ ...tool, execute: async (args, exec) => lossless(await tool.execute(args, exec)) })

export function apply(ctx) {
  const { datasets } = ctx.crmOps
  for (const tool of analystTools(datasets)) ctx.effect(() => ctx.tools.register(jsonSafe(tool)), `${name}: ${tool.name}`)
  ctx.effect(() => ctx.systemPrompt.section({ name: 'crm-ops:analyst', order: 9000, text: SECTION, interpolate: false }), `${name}: prompt section`)
}
