/**
 * Reading a Feishu Base (多维表格) through the local `lark-cli`, read-only.
 *
 * The person's own lark-cli login is used (`--as user`), so the plugin sees
 * exactly what that person can see and holds no Feishu credentials itself.
 * Every call passes its arguments as an argv array, never through a shell.
 *
 * Output matches read.js: one sheet per table, first row is the field names,
 * and each column carries its Feishu field type in `columns[i]`, so profiling
 * can trust the type instead of guessing and can skip computed columns.
 */
import { execFile } from 'node:child_process'
import { CrmError } from './read.js'

/** Feishu field type codes this plugin distinguishes. */
export const FEISHU_TYPES = Object.freeze({
  1: 'text', 2: 'number', 3: 'select', 4: 'multiselect', 5: 'datetime', 7: 'checkbox',
  11: 'user', 13: 'phone', 15: 'url', 17: 'attachment', 18: 'link', 19: 'lookup', 20: 'formula',
  21: 'link', 22: 'location', 23: 'group', 1001: 'created_time', 1002: 'modified_time',
  1003: 'created_user', 1004: 'modified_user', 1005: 'auto_number',
})
/** Column kinds whose values Feishu computes; they are skipped by default (they can go stale). */
export const COMPUTED_KINDS = Object.freeze(['formula', 'lookup', 'created_time', 'modified_time', 'created_user', 'modified_user', 'auto_number'])

const TOKEN = /^[A-Za-z0-9]{10,64}$/
const PAGE = 200
const MAX_ROWS = 50000

/**
 * Pull the wiki or base token out of a Feishu link.
 * @param {string} link - a `/wiki/<token>` or `/base/<token>` URL.
 * @returns {{ kind: 'wiki' | 'base', token: string }}
 */
export function parseFeishuLink(link) {
  let url
  try {
    url = new URL(String(link).trim())
  } catch {
    throw new CrmError('bad-link', '这不是一个链接。请从飞书复制多维表格的链接')
  }
  if (!/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(url.hostname)) {
    throw new CrmError('bad-link', '只支持飞书的多维表格链接')
  }
  const m = /^\/(wiki|base)\/([^/?#]+)/.exec(url.pathname)
  if (!m || !TOKEN.test(m[2])) throw new CrmError('bad-link', '链接里找不到多维表格。请打开多维表格后复制浏览器地址栏的链接')
  return { kind: m[1], token: m[2] }
}

/**
 * Default runner: `lark-cli <args>` with JSON output.
 * @param {string[]} args - argv after the command.
 * @returns {Promise<object>} parsed JSON envelope.
 */
export function larkCli(args) {
  return new Promise((resolve, reject) => {
    execFile('lark-cli', args, { maxBuffer: 1 << 28, timeout: 120000 }, (error, stdout, stderr) => {
      const text = String(stdout || stderr || '')
      let parsed = null
      try { parsed = JSON.parse(text) } catch { /* not JSON: handled below */ }
      if (parsed) return resolve(parsed)
      if (error?.code === 'ENOENT') return reject(new CrmError('no-lark-cli', '这台电脑没有装飞书命令行工具 lark-cli。装好并登录后再试，或者在飞书里把表导出成 Excel 再导入'))
      reject(new CrmError('lark-cli', `飞书命令行工具出错了：${(error?.message ?? text).slice(0, 200)}`))
    })
  })
}

function check(envelope, what) {
  if (envelope?.ok) return envelope.data
  const e = envelope?.error ?? {}
  if (e.type === 'authorization' || e.subtype === 'missing_scope') {
    throw new CrmError('feishu-auth', `飞书没有授权读取${what}。在终端运行 lark-cli auth login 重新登录后再试${e.missing_scopes ? `（缺少权限：${e.missing_scopes.join('、')}）` : ''}`)
  }
  throw new CrmError('feishu', `读取${what}失败：${String(e.message ?? '未知错误').slice(0, 200)}`)
}

/** The text a person sees in one Feishu cell, from `+record-list` JSON. */
export function feishuCellText(value, kind) {
  if (value === null || value === undefined) return ''
  if (kind === 'attachment') return Array.isArray(value) && value.length > 0 ? `[附件 ${value.length} 个]` : ''
  if (Array.isArray(value)) return value.map(v => feishuCellText(v, kind === 'multiselect' || kind === 'select' ? 'text' : kind)).filter(Boolean).join('、')
  if (typeof value === 'object') {
    if (typeof value.name === 'string') return value.name
    if (typeof value.text === 'string') return value.text
    if (typeof value.link === 'string') return value.link
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const s = String(value)
  if (kind === 'datetime' || kind === 'created_time' || kind === 'modified_time') {
    // Keep the Base's own local wall time; drop seconds and the offset.
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s)
    if (m) return m[2] && m[2] !== '00:00' ? `${m[1]} ${m[2]}` : m[1]
  }
  if (kind === 'url') {
    const md = /^\[[^\]]*\]\(([^)]+)\)$/.exec(s)
    if (md) return md[1]
  }
  return s.trim()
}

/**
 * Read every table of a Feishu Base.
 * @param {string} link - wiki or base link.
 * @param {{ run?: (args: string[]) => Promise<object> }} [options] - command runner (tests pass a fake).
 * @returns {Promise<{ title: string, baseToken: string, sheets: object[] }>}
 */
export async function readFeishuBase(link, { run = larkCli } = {}) {
  const parsed = parseFeishuLink(link)
  let baseToken = parsed.token
  let title = ''
  if (parsed.kind === 'wiki') {
    const node = check(await run(['api', 'GET', '/open-apis/wiki/v2/spaces/get_node', '--params', JSON.stringify({ token: parsed.token }), '--as', 'user']), '知识库页面').node
    if (node?.obj_type !== 'bitable') throw new CrmError('not-base', `这个知识库页面是「${node?.obj_type ?? '未知'}」，不是多维表格`)
    baseToken = node.obj_token
    title = node.title ?? ''
  }
  if (!TOKEN.test(baseToken)) throw new CrmError('bad-link', '链接里找不到多维表格')
  const tables = check(await run(['api', 'GET', `/open-apis/bitable/v1/apps/${baseToken}/tables`, '--params', JSON.stringify({ page_size: 100 }), '--as', 'user']), '多维表格').items ?? []
  const sheets = []
  for (const table of tables) {
    if (!/^tbl[A-Za-z0-9]+$/.test(table.table_id)) continue
    const fields = check(await run(['api', 'GET', `/open-apis/bitable/v1/apps/${baseToken}/tables/${table.table_id}/fields`, '--params', JSON.stringify({ page_size: 100 }), '--as', 'user']), `「${table.name}」的字段`).items ?? []
    const columns = fields.map(f => ({ name: f.field_name, kind: FEISHU_TYPES[f.type] ?? 'text', feishuType: f.type }))
    const kindOf = new Map(columns.map(c => [c.name, c.kind]))
    const rows = [columns.map(c => c.name)]
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const page = check(await run(['base', '+record-list', '--base-token', baseToken, '--table-id', table.table_id, '--limit', String(PAGE), '--offset', String(offset), '--format', 'json', '--as', 'user']), `「${table.name}」的记录`)
      const names = page.fields ?? []
      for (const values of page.data ?? []) {
        const byName = new Map(names.map((n, i) => [n, values[i]]))
        rows.push(columns.map(c => feishuCellText(byName.get(c.name), kindOf.get(c.name))))
      }
      if (!page.has_more) break
    }
    sheets.push({ name: table.name, rows, filled: new Set(), formulaColumns: columns.map((c, i) => (COMPUTED_KINDS.includes(c.kind) ? i : -1)).filter(i => i >= 0), columns, headerRow: 0 })
  }
  if (sheets.length === 0) throw new CrmError('empty-base', '这个多维表格里没有能读的表')
  return { title, baseToken, sheets }
}
