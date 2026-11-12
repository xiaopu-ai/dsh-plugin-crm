/**
 * 预设: industry defaults as data files.
 *
 * Built-in presets ship as `presets/*.json` in the plugin package. A person's
 * own edited copies live in `<documentsDir>/客户运营/预设/*.json`; a copy with
 * the same id wins, and plugin upgrades never touch that folder. Every preset,
 * built-in or edited, passes `checkSpec` before it is offered; an edited copy
 * that fails is reported and the built-in one is used.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPresetTables, checkSpec } from './spec.js'

export const BUILTIN_DIR = fileURLToPath(new URL('../../presets/', import.meta.url))
export const USER_DIR_NAME = '预设'
const ORDER = ['education', 'powersports', 'dealer-network', 'owner-system', 'blank']

async function readDir(dir, origin) {
  let names = []
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json'))
  } catch {
    // No such folder: nothing to read from it.
    return { presets: [], problems: [] }
  }
  const presets = []
  const problems = []
  for (const file of names.sort()) {
    try {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8'))
      const id = typeof raw.id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(raw.id) ? raw.id : null
      if (!id) { problems.push({ file, message: 'id 要用小写英文字母、数字和连字符' }); continue }
      const checked = checkSpec(raw, { preset: true })
      if (!checked.ok) { problems.push({ file, message: checked.errors.slice(0, 3).map(e => `${e.path}：${e.message}`).join('；') }); continue }
      // Ready-made tables must add up to a configuration that passes on its own.
      const tableErrors = checkPresetTables(raw)
      if (tableErrors.length) { problems.push({ file, message: tableErrors.slice(0, 3).map(e => `${e.path}：${e.message}`).join('；') }); continue }
      presets.push({ ...checked.spec, id, name: String(raw.name ?? id), pitch: String(raw.pitch ?? ''), origin, file })
    } catch (error) {
      problems.push({ file, message: `读不了：${error.message}` })
    }
  }
  return { presets, problems }
}

/**
 * Every preset on offer, built-in first, a person's edited copy replacing the built-in one with the same id.
 * @param {string} [userDir] - `<documentsDir>/客户运营/预设`.
 * @returns {Promise<{ presets: object[], problems: { file: string, message: string }[] }>}
 */
export async function loadPresets(userDir) {
  const builtin = await readDir(BUILTIN_DIR, 'builtin')
  const user = userDir ? await readDir(userDir, 'user') : { presets: [], problems: [] }
  const byId = new Map(builtin.presets.map(p => [p.id, p]))
  for (const p of user.presets) byId.set(p.id, p)
  const presets = [...byId.values()].sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99) || a.id.localeCompare(b.id))
  return { presets, problems: [...builtin.problems.map(p => ({ ...p, origin: 'builtin' })), ...user.problems.map(p => ({ ...p, origin: 'user' }))] }
}

/** One preset by id, or null. */
export async function getPreset(id, userDir) {
  const { presets } = await loadPresets(userDir)
  return presets.find(p => p.id === id) ?? null
}
