/**
 * 客户运营台 root plugin.
 *
 * Owns the dataset store and provides it to the 客户运营 · 配置 mode as the
 * `crmOps` service. Serves the Client on one exact, owner-only route,
 * `/api/crmOps/call`: importing files and Feishu bases, picking a header row,
 * confirming the cutoff date and removing sources are all person-only actions
 * that no tool can reach.
 *
 * Config (both required, set by the bundle patch):
 *   documentsDir: absolute folder that receives `客户运营/<数据集>` (default ~/Documents).
 *   stateDir: absolute folder for this plugin's own state; conversation workspaces live in `<stateDir>/会话`.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KINDS } from '../core/profile.js'
import { CrmError, Datasets, IMPORT_LIMIT } from '../core/store.js'
import { queryVocabulary } from '../core/analysis.js'
import { workshopBridge } from './workshop.js'

export const name = 'crm-ops'
export const inject = ['connection']
export const ROUTE = '/api/crmOps/call'
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
/** Bundled skills; each is `skills/<name>/SKILL.md`. The modes have no file tools, so each guide is self-contained. */
export const SKILLS = Object.freeze(['crm-config', 'crm-analyst'])
/** The agent preset behind the chat column: one assistant that configures the tables and reads the data. */
export const ASSISTANT_PRESET = 'crm-assistant'
const PROVIDER = 'dsh-crm-ops'
const BUNDLED_SKILL_RANK = 600
const skillDir = skill => fileURLToPath(new URL(`../../skills/${skill}/`, import.meta.url))
const skillFile = skill => join(skillDir(skill), 'SKILL.md')

/**
 * Split a SKILL.md into its frontmatter description and body.
 * @param {string} raw - file text.
 * @returns {{ description: string, body: string }}
 */
export function parseSkill(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (match === null) throw new Error(`${name}: SKILL.md has no YAML frontmatter`)
  const line = match[1].split(/\r?\n/).find(l => l.startsWith('description:'))
  const description = line?.slice('description:'.length).trim().replace(/^["']|["']$/g, '') ?? ''
  if (description === '') throw new Error(`${name}: SKILL.md frontmatter has no description`)
  return { description, body: raw.slice(match[0].length).trim() }
}

/**
 * Validate the row config.
 * @param {unknown} config - row config.
 * @returns {{ documentsDir: string, stateDir: string }}
 */
export function resolveConfig(config) {
  const out = {}
  for (const key of ['documentsDir', 'stateDir']) {
    const value = config?.[key]
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`${name}: config.${key} must be an absolute path, got ${JSON.stringify(value)}`)
    out[key] = value
  }
  return out
}

/** Static vocabulary the Client renders, with the presets on offer. */
export async function meta(datasets) {
  const { presets, problems } = await datasets.presets()
  return { version: VERSION, presets: presets.map(p => ({ id: p.id, name: p.name, pitch: p.pitch, origin: p.origin })), presetProblems: problems, kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.name])), importLimit: IMPORT_LIMIT }
}

/**
 * Everything the sidebar and the home page count, in one call: setup step, review,
 * transfers, rules waiting, report drafts and running lists.
 * @param {Datasets} datasets
 * @param {string} id
 */
export async function badges(datasets, id) {
  const status = await datasets.status(id)
  const quiet = (p, fallback) => p.catch(() => fallback)
  const [lists, pending, reports, campaigns, leads] = await Promise.all([
    status.data ? quiet(datasets.lists(id), null) : null,
    quiet(datasets.pending(id), { unknown: [], proposals: [] }),
    quiet(datasets.reports(id), []),
    status.data ? quiet(datasets.campaigns(id), null) : null,
    status.data ? quiet(datasets.leads(id, { state: ['首跟超时', '跟进断了'], limit: 1 }), null) : null,
  ])
  // How this dataset calls its six kinds (the nav names the 归属方 page after it).
  const labels = status.spec.current === null ? {} : (await quiet(datasets.currentSpec(id), null))?.labels ?? {}
  const effects = campaigns?.campaigns.map(c => c.effect).filter(e => e && !e.error) ?? []
  return {
    step: status.step,
    next: status.next,
    asOf: status.asOf,
    asOfConfirmed: status.asOfConfirmed,
    sources: status.sources.length,
    specCurrent: status.spec.current,
    specDraft: status.spec.draft,
    data: status.data,
    review: status.data?.review?.open ?? 0,
    reviewSkipped: status.data?.review?.skipped ?? false,
    transfers: lists?.transfers ?? 0,
    rules: pending.proposals.filter(p => p.status === 'open').length,
    unknown: pending.unknown.reduce((a, u) => a + u.values.length, 0),
    reportDrafts: reports.filter(r => r.draft).length,
    reports: reports.length,
    running: lists?.running ?? 0,
    runningPeople: lists?.runningPeople ?? 0,
    batches: lists?.batches?.length ?? 0,
    left: lists?.left ?? 0,
    streaks: lists?.streaks ?? 0,
    campaigns: effects.length,
    campaignsWatching: effects.filter(e => !e.complete).length,
    leadsAction: leads?.total ?? 0,
    labels,
  }
}

/**
 * Dispatch one Client call.
 * @param {{ datasets: Datasets, rev: () => number, workspace: (dir: string, title: string) => Promise<{ id: string }>, sessionsDir: string, workshopPush?: Function | null, workshopSync?: Function | null }} deps
 * @param {object} payload - `{ action, ...arguments }`.
 */
export async function dispatch({ datasets, rev, workspace, sessionsDir, workshopPush = null, workshopSync = null }, payload) {
  const p = payload !== null && typeof payload === 'object' ? payload : {}
  const str = key => (typeof p[key] === 'string' ? p[key] : '')
  // Tags the picked people carry none of: one name or a list.
  const without = () => (Array.isArray(p.without) ? p.without.filter(x => typeof x === 'string' && x) : typeof p.without === 'string' && p.without ? [p.without] : undefined)
  switch (p.action) {
    case 'rev':
      return { rev: rev() }
    case 'meta':
      return meta(datasets)
    case 'list':
      return { rev: rev(), datasets: await datasets.list() }
    case 'get':
      return datasets.get(str('id'))
    case 'create':
      return datasets.create({ name: str('name'), preset: str('preset') })
    case 'importFile': {
      const base64 = str('base64')
      if (base64.length > Math.ceil(IMPORT_LIMIT / 3) * 4) throw new CrmError('too-big', `文件最大 ${IMPORT_LIMIT / 1024 / 1024} MB`)
      return datasets.importFile(str('id'), str('name'), Buffer.from(base64, 'base64'))
    }
    case 'replaceFile': {
      const base64 = str('base64')
      if (base64.length > Math.ceil(IMPORT_LIMIT / 3) * 4) throw new CrmError('too-big', `文件最大 ${IMPORT_LIMIT / 1024 / 1024} MB`)
      return datasets.replaceFile(str('id'), str('source'), str('name'), Buffer.from(base64, 'base64'))
    }
    case 'importFeishu':
      return datasets.importFeishu(str('id'), str('link'))
    case 'profile':
      return datasets.profile(str('id'), str('source'))
    case 'setHeader':
      return datasets.setHeader(str('id'), str('source'), p.sheet, p.row)
    case 'useSheet':
      return datasets.useSheet(str('id'), str('source'), p.sheet, p.use === true)
    case 'setAsOf':
      return datasets.setAsOf(str('id'), str('asOf'))
    case 'removeSource':
      return datasets.removeSource(str('id'), str('source'))
    case 'status':
      return datasets.status(str('id'))
    case 'sheets':
      // Usable sheets with their column names: what the activity page looks through for sign-up sheets.
      return datasets.sheetsOf(str('id'))
    case 'links':
      return datasets.links(str('id'))
    case 'markChecked':
      return datasets.markChecked(str('id'))
    case 'spec.state':
      return datasets.specState(str('id'))
    case 'spec.fromPreset':
      return datasets.draftFromPreset(str('id'))
    case 'spec.finalize':
      return datasets.finalizeSpec(str('id'), p.revision)
    case 'spec.discard':
      return datasets.discardSpecDraft(str('id'))
    case 'spec.use':
      return datasets.useSpecVersion(str('id'), p.version)
    case 'build':
      return datasets.build(str('id'))
    case 'versions':
      return datasets.versions(str('id'))
    case 'reconciliation':
      return datasets.reconciliation(str('id'), p.version ?? undefined)
    case 'data.ack':
      return datasets.ackData(str('id'))
    case 'review':
      return datasets.review(str('id'))
    case 'review.decide':
      return datasets.decide(str('id'), p.decisions)
    case 'review.undo':
      return datasets.undoDecision(str('id'), str('item'))
    case 'review.skip':
      return datasets.skipReview(str('id'))
    case 'mergeLog':
      return datasets.mergeLog(str('id'))
    case 'bind':
      return datasets.bindSheet(str('id'), str('source'), p.sheet, str('table'))
    case 'unbind':
      return datasets.unbindSheet(str('id'), str('source'), p.sheet)
    case 'bindSuggestions':
      return datasets.bindSuggestions(str('id'))
    case 'query':
      return datasets.query(str('id'), str('kind'), p.params ?? {}, { log: false }).then(r => r.result)
    case 'overview':
      return datasets.overview(str('id'), p.version ?? undefined)
    case 'customers':
      return datasets.customers(str('id'), { segment: str('segment') || undefined, flag: str('flag') || undefined, without: without(), was: str('was') || undefined, owner: str('owner') || undefined, q: str('q'), sort: str('sort') || undefined, limit: p.limit, offset: p.offset, version: p.version ?? undefined })
    case 'customer':
      return datasets.customer(str('id'), str('cid'), p.version ?? undefined)
    case 'campaigns':
      return datasets.campaigns(str('id'), p.version ?? undefined)
    case 'leads.board':
      return datasets.leadBoard(str('id'), { window: p.window === 'all' ? 'all' : Number(p.window) || 90, by: str('by') || null, lead: p.lead ?? null, version: p.version ?? undefined })
    case 'leads':
      return datasets.leads(str('id'), { state: p.state ?? undefined, lead: p.lead ?? undefined, window: p.window ?? undefined, q: str('q'), limit: p.limit, offset: p.offset, version: p.version ?? undefined })
    case 'leads.export':
      return datasets.exportLeads(str('id'), { state: p.state ?? undefined, lead: p.lead ?? undefined, window: p.window ?? undefined, q: str('q'), split: ['none', 'files'].includes(str('split')) ? str('split') : 'owner', withName: p.withName === true })
    case 'owners.board':
      return datasets.ownerBoard(str('id'), { window: p.window === 'all' ? 'all' : Number(p.window) || 90, by: str('by') || null, version: p.version ?? undefined })
    case 'owners.detail':
      return datasets.ownerDetail(str('id'), str('owner'), { window: p.window === 'all' ? 'all' : Number(p.window) || 90, version: p.version ?? undefined })
    case 'owners.briefs':
      return datasets.exportOwnerBriefs(str('id'), { window: p.window === 'all' ? 'all' : Number(p.window) || 90, by: str('by') || null, owners: Array.isArray(p.owners) ? p.owners.filter(x => typeof x === 'string') : null, withLeads: p.withLeads === true, note: str('note') })
    case 'reach.board':
      return datasets.reachBoard(str('id'), { by: str('by') || null, version: p.version ?? undefined })
    case 'owners.export':
      return datasets.exportOwnerBoard(str('id'), { window: p.window === 'all' ? 'all' : Number(p.window) || 90, by: str('by') || null })
    case 'pending':
      return datasets.pending(str('id'))
    case 'proposal.adopt':
      return datasets.adoptProposal(str('id'), str('proposal'))
    case 'proposal.reject':
      return datasets.rejectProposal(str('id'), str('proposal'))
    case 'unknown.map':
      return datasets.mapUnknown(str('id'), str('key'), str('raw'), str('standard'))
    case 'reports':
      return datasets.reports(str('id'))
    case 'report':
      return datasets.report(str('id'), str('name'))
    case 'report.version':
      return datasets.reportVersion(str('id'), str('name'), p.version)
    case 'report.edit':
      return datasets.saveReportDraft(str('id'), { name: str('name'), title: str('title') || undefined, body: str('body') }, { by: 'person' })
    case 'report.finalize':
      return datasets.finalizeReport(str('id'), str('name'), p.revision)
    case 'report.discard':
      return datasets.discardReportDraft(str('id'), str('name'))
    case 'report.export':
      return datasets.exportReport(str('id'), str('name'), p.version, str('format'))
    case 'lists':
      return datasets.lists(str('id'))
    case 'batch':
      return datasets.batch(str('id'), str('batch'))
    case 'list.pool':
      return datasets.listPool(str('id'), { segment: str('segment') || undefined, flag: str('flag') || undefined, without: without(), was: str('was') || undefined, owner: str('owner') || undefined, cids: Array.isArray(p.cids) ? p.cids : undefined, purpose: str('purpose') || undefined, goal: Object.hasOwn(p, 'goal') ? p.goal : undefined })
    case 'list.create': {
      const pick = { segment: str('segment') || undefined, flag: str('flag') || undefined, without: without(), was: str('was') || undefined, owner: str('owner') || undefined, cids: Array.isArray(p.cids) ? p.cids : undefined }
      const to = str('to') === 'workshop' ? 'workshop' : 'excel'
      if (to === 'workshop' && !workshopPush) throw new CrmError('no-workshop', '这个 DSH 里没有装平台工坊，先导出 Excel，或者装好平台工坊再推')
      const made = await datasets.createBatch(str('id'), { pick, purpose: str('purpose'), dueDays: p.dueDays, to, withPhone: p.withPhone === true, source: str('source') || null, split: str('split') === 'owner' ? 'owner' : 'none', goal: Object.hasOwn(p, 'goal') ? p.goal : undefined })
      if (to === 'workshop') made.workshop = await workshopPush(str('id'), made.id, { withPhone: p.withPhone === true })
      return made
    }
    case 'list.push':
      if (!workshopPush) throw new CrmError('no-workshop', '这个 DSH 里没有装平台工坊')
      return workshopPush(str('id'), str('batch'), { withPhone: p.withPhone === true })
    case 'list.sync':
      if (!workshopSync) throw new CrmError('no-workshop', '这个 DSH 里没有装平台工坊')
      return workshopSync(str('id'), str('batch') || null)
    case 'list.outcome':
      return datasets.setOutcome(str('id'), str('batch'), str('cid'), p.outcome ?? null)
    case 'list.export':
      return datasets.exportBatch(str('id'), str('batch'), { withPhone: p.withPhone === true, split: str('split') === 'owner' ? 'owner' : 'none' })
    case 'list.close':
      return datasets.closeBatch(str('id'), str('batch'))
    case 'transfers':
      return datasets.transfers(str('id'))
    case 'transfer.decide':
      return datasets.decideTransfer(str('id'), str('transfer'), p.confirm === true)
    case 'leave':
      return datasets.leave(str('id'), str('cid'), str('why'))
    case 'unleave':
      return datasets.unleave(str('id'), str('cid'))
    case 'left':
      return datasets.leftList(str('id'))
    case 'customer.lists':
      return datasets.customerLists(str('id'), str('cid'))
    case 'badges':
      return badges(datasets, str('id'))
    case 'vocabulary': {
      const st = await datasets.specState(str('id'))
      return st.spec ? queryVocabulary(st.spec) : null
    }
    case 'download':
      return datasets.download(str('id'), str('file'))
    case 'advance': {
      // After a click on a card in the conversation (finalize, confirm the cutoff): once a configuration is
      // finalized and the cutoff confirmed, clean right away instead of sending the person to another page.
      const id = str('id')
      let st = await datasets.status(id)
      if (st.spec.current === null) return { built: null, step: st.step, waiting: 'spec' }
      if (!st.asOfConfirmed) return { built: null, step: st.step, waiting: 'asof' }
      if (st.step === 'check') { await datasets.markChecked(id); st = await datasets.status(id) }
      if (st.step !== 'build') return { built: null, step: st.step, waiting: null }
      const built = await datasets.build(id)
      return { built, step: (await datasets.status(id)).step, waiting: null }
    }
    case 'openSession': {
      const d = await datasets.get(str('id'))
      // The workspace is an empty folder outside the dataset, so file tools (if any) never reach the originals.
      // Its name starts with the dataset id: that is how the agent knows which dataset when nobody says.
      const dir = join(sessionsDir, `${d.id}-助手`)
      await mkdir(dir, { recursive: true })
      const ws = await workspace(dir, `客户运营 · ${d.name}`)
      const ask = str('ask').trim()
      const st = await datasets.status(d.id).catch(() => null)
      const fallback = st?.data && st.step !== 'config' ? '先看一下这批客户现在的情况，告诉我最值得注意的三件事，再建议先联系哪一层的人。' : '帮我把这批表准备好：先看体检结果，再问我拿不准的地方。'
      // A button's request is put in the box for the person to adjust and send, saying which data it is about.
      const batch = st?.data ? `数据第 ${st.data.version} 版（截至 ${st.data.asOf}）` : ''
      const prefix = `数据集 ${d.id}「${d.name}」${batch ? `，${batch}` : ''}。\n`
      return { workspaceId: ws.id, preset: ASSISTANT_PRESET, prefix, batch, prompt: `${prefix}${ask || fallback}`, fallback }
    }
    default:
      throw new CrmError('unknown-action', '不认识的操作')
  }
}

/**
 * Turn one Connection request envelope into its response envelope.
 * @param {Request} request - POST `{ type: 'client-request', rpcId, payload }`.
 * @param {(payload: object) => Promise<unknown>} handle - dispatcher.
 * @param {(level: string, message: string) => void} log - logger.
 */
export async function respond(request, handle, log) {
  let message
  try {
    message = await request.json()
  } catch {
    // A body that is not JSON cannot carry an rpcId to answer with.
    return new Response('bad request', { status: 400 })
  }
  if (message?.type !== 'client-request' || typeof message.rpcId !== 'string') return new Response('bad request', { status: 400 })
  let result
  try {
    result = { ok: true, value: (await handle(message.payload)) ?? null }
  } catch (error) {
    if (error instanceof CrmError) {
      result = { ok: false, error: { code: `crm-ops/${error.code}`, message: error.message, details: error.details ?? {} } }
    } else {
      log('warn', `call failed: ${error?.stack ?? error}`)
      result = { ok: false, error: { code: 'crm-ops/internal', message: `插件内部出错了，不是你操作的问题（${error?.message ?? error}）`, details: {} } }
    }
  }
  return new Response(JSON.stringify({ type: 'server-response', rpcId: message.rpcId, result }), { headers: { 'content-type': 'application/json' } })
}

/**
 * Plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - context with `connection`.
 * @param {{ documentsDir: string, stateDir: string }} config - row config.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const datasets = new Datasets({ documentsDir: resolved.documentsDir })
  const sessionsDir = join(resolved.stateDir, '会话')
  const log = (level, message) => ctx.logger?.[level]?.(`${name}: ${message}`)
  let counter = 0
  ctx.effect(() => datasets.onChange(() => { counter++ }), `${name}: change counter`)
  ctx.provide('crmOps', { datasets, config: resolved })
  const workspace = async (dir, title) => {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) throw new CrmError('no-workspace', '这个 DSH 没有工作区功能，没法开对话')
    return registry.create(dir, title)
  }
  const bridge = workshopBridge(datasets, () => ctx.get('platformWorkshop'), log)
  datasets.workshopAvailable = bridge.available
  const handle = payload => dispatch({ datasets, rev: () => counter, workspace, sessionsDir, workshopPush: bridge.available() ? bridge.push : null, workshopSync: bridge.available() ? bridge.sync : null }, payload)
  // Results picked in 平台工坊 come back on their own: a short while after it reports a change.
  ctx.inject(['platformWorkshop'], ctx => {
    let timer = null
    ctx.effect(() => {
      const off = ctx.platformWorkshop.workshop?.onChange?.(() => {
        clearTimeout(timer)
        timer = setTimeout(() => { bridge.syncAll().catch(error => log('warn', `workshop sync: ${error?.message ?? error}`)) }, 1500)
      }) ?? (() => {})
      return () => { clearTimeout(timer); off() }
    }, `${name}: workshop results`)
  })
  ctx.inject(['skills'], ctx => {
    ctx.effect(() => ctx.skills.registerProvider(() => ({
      name: PROVIDER,
      async list() {
        return Promise.all(SKILLS.map(async skill => {
          const { description } = parseSkill(await readFile(skillFile(skill), 'utf8'))
          return { ...skillSummary(skill, description), rank: BUNDLED_SKILL_RANK, locator: skill }
        }))
      },
      async get(candidate, options) {
        const skill = candidate.locator
        const { description, body } = parseSkill(await readFile(skillFile(skill), { encoding: 'utf8', signal: options?.signal }))
        return { ...skillSummary(skill, description), content: body }
      },
    })), `${name}: skill provider`)
  })
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => respond(request, handle, log),
  }), `${name}: client route`)
}

function skillSummary(skill, description) {
  return {
    name: skill,
    description,
    invocation: { modelInvocable: true, userInvocable: false },
    provider: PROVIDER,
    source: 'bundled',
    path: skillFile(skill),
    resourceBase: { kind: 'directory', path: skillDir(skill).replace(/\\/g, '/').replace(/\/$/, '') },
  }
}
