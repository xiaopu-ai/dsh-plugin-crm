/**
 * 客户运营 · 助手: the one agent behind the chat column that stays open beside the boards.
 *
 * People run their day from that column: they drop this month's exports on it, ask what changed and
 * who to call, ask for a list or a report. So one conversation has to do what used to be two modes:
 * getting the tables configured (the `crm-config` tools and skill) and reading the data (the
 * `crm-analyst` tools and skill). This plugin mounts both tool sets in one preset, with one
 * `crm_status` that carries what either side needs.
 *
 * The limits are the same as before. The agent has no file, shell or web tools and never sees names
 * or contact details. Whatever changes the dataset for good (finalize a configuration, confirm the
 * cutoff, clean, export or push a list, finalize a report) is a button the person clicks, on a card in
 * the conversation. Files are imported by the page when the person drops them, never by the agent.
 */
import { NEW_ARRIVAL, OTHER } from '../core/features.js'
import { LEAD_STATES, checkLeadFilter, leadDimensions } from '../core/leads.js'
import { capabilities, ownerAttributes } from '../core/spec.js'
import { lossless } from '../core/store.js'
import { analystTools } from './analyst.js'
import { configTools } from './config.js'
import { datasetParam, json } from './shared.js'

export const name = 'crm-ops-assistant'
export const inject = ['tools', 'systemPrompt', 'crmOps']

/** Model-facing rules; the two long guides are the `crm-config` and `crm-analyst` skills. */
export const SECTION = [
  '## 客户运营台 · 助手',
  '',
  '你是客户运营台右边常驻的助手。左边是看板（首页、客户、线索、名单、分析、活动、报告），用户平时不怎么点页面，事情都在你这里说：把新一期的表拖进来、问数据哪里变了、要一份名单或报告。你做的事会马上反映在左边的看板上。',
  '',
  '**每次先调 crm_status**（数据集编号是用户话里「数据集」后面那 8 位；没写就是工作目录最后一段的前 8 位，不用问）。看 `step` 决定做哪一类事：',
  '',
  '- `import`：还没有表。请用户把 Excel 或 CSV 直接拖到这一栏（或页面任何地方），插件会导入。',
  '- `check`、`cutoff`、`config`，或者 `fit.reshaped`、`data.broken` 为 true：数据还没准备好。**先用 skill 工具加载 `crm-config` 技能**，按它的流程做：读体检、问拿不准的、交配置草案、看试跑结果。',
  '- 上面这几步里 `presetFit.ready` 为 true（导入的表和预设里现成的表对应对得上）：**不用读体检、不用访谈、不用自己写配置**，直接调 crm_draft_from_preset，一步出草案（`presetFit.preset` 是认得这批表的那个预设，不一定是建数据集时选的）；同时放截止日的卡片（没确认的话）。然后用几句话说清楚预设定了什么、哪几处是假设要他确认，请他点定稿。`presetFit.unmatched` 里不是 optional 的表没对上时，告诉用户缺哪张、差哪几列。',
  '- `build`：配置定了但还没清洗（或者数据、配置变了）。用 crm_propose_action 放一张 `build` 卡片，请用户点「运行清洗和合并」。',
  '- `review`：有疑似同一人没确认。告诉用户有几组、去「复核」页点；不想管可以先跳过，人数会偏多。分析照样能做。',
  '- `ready`：数据准备好了。**先用 skill 工具加载 `crm-analyst` 技能**，按它的做法查数、回答、出名单卡片、写报告。',
  '- `ready` 时用户要**改配置**：只加或改一条分层、标记、字典，用 crm_propose_rule 提议就行。动到「表怎么读」的（哪些行不要、哪一列是什么、一格里几个值拆成标签、持有物上的字段和日期），或者一次要改好几处，就加载 `crm-config` 技能：crm_get_spec 读全文，在上面改，crm_draft_spec 交全文，看试跑结果（problems 要改，hints 要看）。',
  '',
  '用户一句话里常常两件事都有（「帮我上传和分析」）：先把数据准备好，准备好了接着分析，不要让用户再说一遍。中途要用户点卡片时，说清楚「点完告诉我一声，我接着看」。',
  '',
  '**文件**：用户把表拖进来时，插件已经替他导入了，消息里会写导入了哪些文件；新一期的表和配置对得上的，插件还会自动清洗好。你读不了对话里的附件，也没有读文件的工具。用户把表当附件发给你、或者只是说「我有个表」，就请他直接拖到这一栏。',
  '',
  '**左边的看板跟着你走**：用户说「给我看…」「打开…」「看看是谁」，或者你讲到某一批人、某一批线索、某份报告时，用 crm_show 把左边切到那一页（客户页带分层和标记，线索页带状态和筛选）。它只是换页，不改任何东西，不用问用户，切完用半句话说一声「左边已经是 XX 了」。别为了一个数字就切页；一次回答最多切一次，切到最后要他看的那一页。',
  '',
  '**只有用户能做的事**都是对话里卡片上的按钮，你放卡片、他点：',
  '- 配置草案（crm_draft_spec 交了就有卡片）：他点「定稿」，插件接着自动清洗。',
  '- 确认截止日、换表头行、重新导入某个文件、运行清洗、数据有问题但先这样用、去复核或先跳过复核、从飞书多维表格导入（用户贴了链接）：crm_propose_action。',
  '- 名单（crm_propose_list）、规则提议（crm_propose_rule）、报告草稿（crm_save_report_draft，卡片上能定稿，定稿后能导出）。',
  '- 导出：线索要发给各家去跟、定稿的报告要发出去，用 crm_propose_export 放一张导出卡片。你看不到姓名，也导不出文件；他点了才下载。',
  '永远不说「已经定稿」「已经生成名单」「已经导出」这类话；说「卡片放好了，你点一下」。',
  '',
  '两份技能里写着「请用户去某一页」的地方，能由你接着做或放一张卡片解决的，就别让用户跑页面。技能里说「用户第一句话里有数据集编号」，没有时按上面的办法取。',
  '',
  '- 所有数字只能来自工具结果，带上出处（q1、q2…）；查不到就说查不到。',
  '- 你看不到姓名、手机号和备注原文，客户只有编号。',
  '- 只说大白话，不出现 JSON、字段 id、文件路径、工具名和英文报错。回答先说结论，再说依据，最后说下一步。从第一句起就用用户的语言，包括调工具之前交代的那半句。',
].join('\n')

/**
 * The tools of both sides, with one `crm_status`.
 * @param {import('../core/store.js').Datasets} datasets - shared store.
 */
export function assistantTools(datasets) {
  const config = configTools(datasets)
  const analyst = analystTools(datasets)
  const byName = (list, n) => list.find(t => t.name === n)
  const configStatus = byName(config, 'crm_status')
  const analystStatus = byName(analyst, 'crm_status')
  const status = {
    ...configStatus,
    description: '读一个数据集现在的进度，每次开口前先调：step（走到哪一步）和 next（下一步该做什么）；数据源和工作表；配置定稿到第几版、有没有草案、和现在的表对不对得上（fit）；最新的数据版本、对账结果和问题（data.problems）；复核和待确认还剩多少。数据还没准备好时带 links（插件按值比对出来的表间关联，写配置时照着用）。数据准备好以后带 query（crm_query 能用的指标、维度、分层名、参数写法）、名单和报告。',
    async execute(args, exec) {
      const base = await configStatus.execute(args, exec)
      // What analysis needs only exists once a configuration is finalized; links only matter while configuring.
      const settled = base.step === 'ready' || base.step === 'review'
      const extra = base.spec?.current === null ? null : await analystStatus.execute(args, exec).catch(() => null)
      const { links, ...rest } = base
      return {
        ...rest,
        ...(settled && !base.data?.broken && !base.fit?.reshaped ? {} : { links }),
        ...(extra ? { pending: extra.pending, segments: extra.segments, flags: extra.flags, query: base.data ? extra.query : null, report: extra.report, lists: extra.lists, reports: extra.reports } : {}),
      }
    },
  }
  return [status, ...config.filter(t => t.name !== 'crm_status'), ...analyst.filter(t => t.name !== 'crm_status'), ...boardTools(datasets)]
}

/** Pages of the workbench the assistant may turn the left side to, and the ones that need a data version. */
export const PAGES = Object.freeze({ home: '首页', people: '客户', leads: '线索', owners: '归属方（门店、经销商）', reach: '触达', lists: '名单', analysis: '分析', campaign: '活动', report: '报告', sources: '数据源', review: '复核', config: '配置', pending: '待确认' })
const NEEDS_DATA = new Set(['home', 'people', 'leads', 'owners', 'reach', 'lists', 'analysis', 'campaign', 'report'])
const LEAD_TODO = '待处理'
const TODO_STATES = [LEAD_STATES.late, LEAD_STATES.stalled]
const WINDOWS = [30, 90, 365, 'all']
const no = error => ({ ok: false, error })

/** A lead pick from tool arguments, checked: `{ state, lead, window }` as the store takes them, with its words. */
function leadPick(spec, args) {
  if (!capabilities(spec).has('lead')) return { error: '这个数据集没有线索数据' }
  const words = []
  const state = args.state === undefined || args.state === null || args.state === '' ? null : String(args.state)
  if (state !== null && state !== LEAD_TODO && !Object.values(LEAD_STATES).includes(state)) return { error: `state 只能是：${LEAD_TODO}、${Object.values(LEAD_STATES).join('、')}` }
  if (state) words.push(state)
  const f = checkLeadFilter(spec, args.lead)
  if (!f.ok) return { error: f.message }
  const dims = leadDimensions(spec)
  for (const [k, v] of Object.entries(f.filter)) words.push(`${dims[k]}：${v.join('、')}`)
  let window = args.window === undefined || args.window === null || args.window === '' ? null : args.window === 'all' ? 'all' : Number(args.window)
  if (window !== null && !WINDOWS.includes(window)) return { error: 'window 只能是 30、90、365 或 "all"' }
  if (window !== null) words.push(window === 'all' ? '所有时间' : `近 ${window} 天进来的`)
  return { state, states: state === LEAD_TODO ? TODO_STATES : state ? [state] : undefined, lead: Object.keys(f.filter).length ? f.filter : null, window, words }
}

/**
 * What only the chat-first assistant has: turning the left board to a page, and offering an export.
 * Neither changes the dataset; an export only happens when the person clicks the card.
 * @param {import('../core/store.js').Datasets} datasets - shared store.
 */
export function boardTools(datasets) {
  return [{
    name: 'crm_show',
    description: `把左边的看板切到某一页，让用户马上看到你说的东西。只换页，不改任何数据。page：${Object.entries(PAGES).map(([k, v]) => `${k}（${v}）`).join('、')}。people 可以带 segment（分层名）、flag（标记名）、without（不带哪个标记，一个名字或几个）、was（30 天前在哪层）、owner（归属方）；reach 是触达覆盖（各渠道按分层、按归属方的覆盖率），可以带 by（按归属方的哪个属性汇总）；leads 可以带 state（待处理，或一个状态名）、lead（{ 维度: 值 }，维度见 crm_status 的 query.leadDimensions）、window（30、90、365、"all"）、by（「拆开看」按哪个维度）；owners 是每个归属方一行的对比，可以带 by（按归属方的哪个属性汇总，见 crm_status 的 query.ownerAttributes）、owner（打开某一家的明细）、window；report 带 name 打开那份报告；lists 带 batch 打开那批名单。`,
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        page: { type: 'string', enum: Object.keys(PAGES) },
        segment: { type: 'string' },
        flag: { type: 'string' },
        without: { description: 'people：不带哪个标记，一个名字或几个名字的列表' },
        was: { type: 'string' },
        owner: { type: 'string' },
        state: { type: 'string', description: 'leads：待处理，或一个状态名' },
        lead: { type: 'object', description: 'leads：只看某些线索，如 { "owner": "某经销商" }' },
        window: { description: 'leads：30、90、365 或 "all"' },
        by: { type: 'string', description: 'leads：按哪个维度拆开；owners：按归属方的哪个属性汇总' },
        name: { type: 'string', description: 'report：报告的 name，见 crm_status 的 reports' },
        batch: { type: 'string', description: 'lists：名单编号，见 crm_status 的 lists' },
      },
      required: ['dataset', 'page'],
    },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value.ok ? { ok: true, shown: value.view.label, note: value.note } : value), presentationMeta: (_args, value) => (value.ok ? { view: value.view } : {}) },
    async execute(args) {
      const d = await datasets.get(String(args.dataset ?? ''))
      let page = String(args.page ?? '')
      if (!Object.hasOwn(PAGES, page)) return no(`page 只能是：${Object.keys(PAGES).join('、')}`)
      const st = await datasets.status(d.id)
      if (NEEDS_DATA.has(page) && !st.data) return no(`数据还没准备好，「${PAGES[page]}」页打不开。先把数据准备好；想让用户看表和体检，切到 sources`)
      const words = [PAGES[page]]
      let arg = null
      if (page === 'people') {
        const spec = await datasets.currentSpec(d.id)
        const segments = [...spec.segments.map(s => s.name), OTHER]
        const pick = {}
        for (const [key, allowed, name] of [['segment', segments, '分层'], ['flag', spec.flags.map(f => f.name), '标记'], ['was', [...segments, NEW_ARRIVAL], 'was（30 天前在哪层）']]) {
          if (args[key] === undefined || args[key] === null || args[key] === '') continue
          if (!allowed.includes(String(args[key]))) return no(`${name}只能是：${allowed.join('、') || '（没有）'}`)
          pick[key] = String(args[key])
        }
        if (args.owner) pick.owner = String(args.owner)
        if (args.without !== undefined && args.without !== null && args.without !== '') {
          const list = [...new Set([].concat(args.without).map(String))]
          const names = spec.flags.map(f => f.name)
          if (list.some(x => !names.includes(x))) return no(`without 只能是：${names.join('、') || '（没有标记）'}`)
          pick.without = list
        }
        if (pick.was && pick.segment) words.push(`从「${pick.was}」到「${pick.segment}」`)
        else if (pick.segment) words.push(pick.segment)
        if (pick.flag) words.push(pick.flag)
        if (pick.without) words.push(`没有${pick.without.join('、')}`)
        if (pick.owner) words.push(pick.owner)
        if (Object.keys(pick).length) arg = pick
      } else if (page === 'leads') {
        const spec = await datasets.currentSpec(d.id)
        const p = leadPick(spec, args)
        if (p.error) return no(p.error)
        let by = null
        if (args.by) {
          const dims = leadDimensions(spec)
          if (!Object.hasOwn(dims, String(args.by))) return no(`by 只能是：${Object.entries(dims).map(([k, v]) => `${k}（${v}）`).join('、')}`)
          by = String(args.by)
        }
        // The page reads the state by its own name; 全部状态 is the empty string.
        arg = { ...(p.state !== null ? { state: p.state } : {}), ...(p.lead ? { filter: p.lead } : {}), ...(p.window !== null ? { window: p.window } : {}), ...(by ? { by } : {}) }
        if (Object.keys(arg).length === 0) arg = null
        words.push(...p.words)
      } else if (page === 'reach') {
        const spec = await datasets.currentSpec(d.id)
        if (args.by) {
          const attrs = ownerAttributes(spec)
          if (!Object.hasOwn(attrs, String(args.by))) return no(Object.keys(attrs).length ? `by 只能是：${Object.entries(attrs).map(([k, v]) => `${k}（${v}）`).join('、')}` : '配置里没有归属方的属性，不能汇总')
          arg = { by: String(args.by) }
          words.push(`按${attrs[arg.by]}汇总`)
        }
      } else if (page === 'owners') {
        const spec = await datasets.currentSpec(d.id)
        words[0] = spec.labels?.owner ?? '归属方'
        const view = {}
        if (args.by) {
          const attrs = ownerAttributes(spec)
          if (!Object.hasOwn(attrs, String(args.by))) return no(Object.keys(attrs).length ? `by 只能是：${Object.entries(attrs).map(([k, v]) => `${k}（${v}）`).join('、')}` : '配置里没有归属方的属性，不能汇总')
          view.by = String(args.by)
          words.push(`按${attrs[view.by]}汇总`)
        }
        if (args.window !== undefined && args.window !== null && args.window !== '') {
          const w = args.window === 'all' ? 'all' : Number(args.window)
          if (!WINDOWS.includes(w)) return no('window 只能是 30、90、365 或 "all"')
          view.window = w
          words.push(w === 'all' ? '所有时间' : `近 ${w} 天`)
        }
        if (args.owner) {
          const board = await datasets.ownerBoard(d.id, {})
          if (!board.on || !board.rows.some(r => r.key === String(args.owner))) return no(`没有叫「${args.owner}」的${words[0]}。名字要和 owner_board 的 rows 里的 key 一字不差`)
          view.owner = String(args.owner)
          words.push(view.owner)
        }
        if (Object.keys(view).length) arg = view
      } else if (page === 'report' && args.name) {
        const r = (await datasets.reports(d.id)).find(x => x.name === String(args.name))
        if (!r) return no(`没有这份报告。name 只能是：${(await datasets.reports(d.id)).map(x => x.name).join('、') || '（还没有报告）'}`)
        page = 'reportView'
        arg = r.name
        words.push(r.title)
      } else if (page === 'lists' && args.batch) {
        const b = (await datasets.lists(d.id)).batches.find(x => x.id === String(args.batch) || x.name === String(args.batch))
        if (!b) return no('没有这批名单。batch 见 crm_status 的 lists')
        page = 'batch'
        arg = b.id
        words.push(b.name)
      }
      return { ok: true, view: { dataset: d.id, datasetName: d.name, page, arg, label: words.join(' · ') }, note: '左边已经切过去了，用半句话告诉用户就行。' }
    },
  }, {
    name: 'crm_propose_export',
    description: '在对话里放一张导出卡片，用户点了才下载；你调用它不会导出任何东西。kind=leads：把一批线索导成 Excel，每个归属方一张表（姓名默认遮住，用户可以勾「带上姓名」）；要分别发给各家、每家只能看到自己的，带 perOwner: true，变成每个归属方一个文件、打成一个压缩包；用 state（待处理，或一个状态名）、lead（{ 维度: 值 }）、window（30、90、365、"all"）圈定哪些线索。kind=owners：把归属方对比表（每家一行的那张）导成 Excel，可带 window、by。kind=briefs：每个归属方一份经营简报（Word，一两页，打成一个压缩包），是插件拿看板上的数排出来的：这一家和整体、和同大区比，要先做什么，线索走到哪、谁在跟，客户分布和触达覆盖；不点名任何客户，可以直接发给各家。可带 window、owners（只出这几家，名字和 owner_board 里的一样）、withLeads（true 时每家再附一份它自己待处理的线索，姓名遮住）。kind=report：把一份已经定稿的报告导成 Word、Markdown 或数据表 Excel，name 见 crm_status 的 reports。reason 用一句大白话说为什么导这批。',
    parameters: {
      type: 'object',
      properties: {
        dataset: datasetParam,
        kind: { type: 'string', enum: ['leads', 'owners', 'briefs', 'report'] },
        owners: { type: 'array', items: { type: 'string' }, description: 'briefs：只出这几家；不写就是每一家' },
        withLeads: { type: 'boolean', description: 'briefs：每家再附一份它自己待处理的线索' },
        perOwner: { type: 'boolean', description: 'leads：每个归属方单独一个文件（打成压缩包），分别发给各家时用' },
        by: { type: 'string', description: 'owners：按归属方的哪个属性汇总，可选' },
        state: { type: 'string', description: 'leads：待处理，或一个状态名' },
        lead: { type: 'object', description: 'leads：只导某些线索，如 { "channel": "某渠道" }' },
        window: { description: 'leads：30、90、365 或 "all"；不写就不限时间' },
        name: { type: 'string', description: 'report：报告的 name' },
        reason: { type: 'string', description: '一句大白话：为什么导这批、发给谁' },
      },
      required: ['dataset', 'kind'],
    },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value.ok ? { ok: true, shown: true, note: value.note } : value), presentationMeta: (_args, value) => (value.ok ? { export: value.export } : {}) },
    async execute(args) {
      const d = await datasets.get(String(args.dataset ?? ''))
      const reason = String(args.reason ?? '').trim().slice(0, 160)
      const base = { dataset: d.id, datasetName: d.name, kind: String(args.kind ?? ''), reason }
      if (base.kind === 'report') {
        const all = await datasets.reports(d.id)
        const r = all.find(x => x.name === String(args.name ?? ''))
        if (!r) return no(`没有这份报告。name 只能是：${all.map(x => x.name).join('、') || '（还没有报告）'}`)
        if (r.versions.length === 0) return no('这份报告还没定稿，导不了。请用户先在报告草稿卡片上点定稿')
        return { ok: true, export: { ...base, name: r.name, title: r.title, version: r.versions.at(-1).version }, note: '导出卡片放好了，用户点了才下载。' }
      }
      if (!['leads', 'owners', 'briefs'].includes(base.kind)) return no('kind 只能是 leads、owners、briefs 或 report')
      if (!(await datasets.status(d.id)).data) return no('数据还没准备好，没有东西可导')
      if (base.kind === 'briefs') {
        const window = args.window === undefined || args.window === null || args.window === '' ? 90 : args.window === 'all' ? 'all' : Number(args.window)
        if (!WINDOWS.includes(window)) return no('window 只能是 30、90、365 或 "all"')
        const board = await datasets.ownerBoard(d.id, { window })
        if (!board.on) return no('这个数据集里没有归属方，出不了简报')
        const all = board.rows.filter(r => r.key !== '（没有归属）' && (r.customers > 0 || (r.leads ?? 0) > 0 || (r.todo ?? 0) > 0)).map(r => r.key)
        const asked = Array.isArray(args.owners) ? [...new Set(args.owners.map(String))] : null
        const bad = (asked ?? []).filter(x => !all.includes(x))
        if (bad.length) return no(`没有这几家：${bad.join('、')}。名字要和 owner_board 的 rows 里的 key 一字不差`)
        const list = asked?.length ? asked : all
        return { ok: true, export: { ...base, window, owners: asked?.length ? asked : null, withLeads: args.withLeads === true, total: list.length, label: `${board.label}经营简报 · ${window === 'all' ? '所有时间' : `近 ${window} 天`}${asked?.length ? ` · ${list.length <= 3 ? list.join('、') : `${list.length} 家`}` : ''}`, ownerLabel: board.label }, note: `导出卡片放好了：${list.length} 个${board.label}，每家一份 Word${args.withLeads === true ? '，各附一份它自己待处理的线索' : ''}，打成一个压缩包。简报里的话是插件按看板上的数排出来的，不是你写的；不点名任何客户。用户点了才下载。` }
      }
      if (base.kind === 'owners') {
        const spec = await datasets.currentSpec(d.id)
        const attrs = ownerAttributes(spec)
        const by = args.by ? String(args.by) : null
        if (by && !Object.hasOwn(attrs, by)) return no(Object.keys(attrs).length ? `by 只能是：${Object.keys(attrs).join('、')}` : '配置里没有归属方的属性，不能汇总')
        const window = args.window === undefined || args.window === null || args.window === '' ? 90 : args.window === 'all' ? 'all' : Number(args.window)
        if (!WINDOWS.includes(window)) return no('window 只能是 30、90、365 或 "all"')
        const board = await datasets.ownerBoard(d.id, { window, by })
        if (!board.on) return no('这个数据集里没有归属方，没有对比表可导')
        return { ok: true, export: { ...base, window, by, total: board.rows.length, label: `${board.label}对比 · ${window === 'all' ? '所有时间' : `近 ${window} 天`}${by ? ` · 按${attrs[by]}汇总` : ''}`, ownerLabel: board.label }, note: `导出卡片放好了：${board.rows.length} 个${board.label}，每家一行，只有数字。用户点了才下载。` }
      }
      const p = leadPick(await datasets.currentSpec(d.id), args)
      if (p.error) return no(p.error)
      const found = await datasets.leads(d.id, { state: p.states, lead: p.lead ?? undefined, window: p.window ?? undefined, limit: 1 })
      if (found.total === 0) return no('这样筛出来没有线索，换个条件')
      return { ok: true, export: { ...base, state: p.states ?? null, lead: p.lead, window: p.window, total: found.total, owners: found.owners, perOwner: args.perOwner === true, label: p.words.join(' · ') || '全部线索' }, note: `导出卡片放好了：${found.total} 条线索、${found.owners} 个归属方${args.perOwner === true ? '，默认每家一个文件（一个压缩包）' : '，默认一家一张表（同一个文件里）'}。用户点了才下载；不要说已经导出。` }
    },
  }]
}

/** Tool results go through lossless(): the tool channel rejects undefined, NaN and -0. */
const jsonSafe = tool => ({ ...tool, execute: async (args, exec) => lossless(await tool.execute(args, exec)) })

/**
 * Plugin entry: register both tool sets and the prompt section in this agent's scope.
 * @param {import('@deepseek-ai/cordis').Context} ctx - agent-scoped context.
 */
export function apply(ctx) {
  const { datasets } = ctx.crmOps
  for (const tool of assistantTools(datasets)) ctx.effect(() => ctx.tools.register(jsonSafe(tool)), `${name}: ${tool.name}`)
  ctx.effect(() => ctx.systemPrompt.section({ name: 'crm-ops:assistant', order: 9000, text: SECTION, interpolate: false }), `${name}: prompt section`)
}
