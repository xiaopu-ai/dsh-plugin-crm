/**
 * Reading source files into plain sheets of text cells.
 *
 * Every cell comes back as the text a person sees in the source, never as a
 * type Excel guessed. The one exception is a date cell, whose serial number is
 * converted here (1900 and 1904 date systems, Excel's phantom 1900-02-29), so
 * later steps get `YYYY-MM-DD`. Merged cells are filled from their top-left
 * value and flagged. CSV bytes are decoded as UTF-8, GBK or GB18030, whichever
 * yields the fewest replacement characters.
 *
 * A number cell of 16 or more digits has already lost its last digits inside
 * Excel (doubles keep 15 significant digits); such cells are listed in
 * `damaged` so the profile can say so instead of trusting the value.
 *
 * Output shape, shared with the Feishu reader:
 *   { sheets: [{ name, rows: string[][], filled: Set<string> "r,c", damaged?: Set<string>, formulaColumns }], encoding? }
 */
import * as XLSX from '../vendor/xlsx.mjs'

/** Error whose message is safe to show to the person using the plugin. */
export class CrmError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - plain Chinese explanation.
   */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const ENCODINGS = ['utf-8', 'gbk', 'gb18030']
const REPLACEMENT = /�/g

/**
 * Decode CSV bytes, picking the encoding with the fewest replacement characters.
 * @param {Uint8Array} bytes - raw file.
 * @returns {{ text: string, encoding: string }}
 */
export function decodeText(bytes) {
  let best = null
  for (const encoding of ENCODINGS) {
    const text = new TextDecoder(encoding, { fatal: false, ignoreBOM: false }).decode(bytes)
    const bad = (text.match(REPLACEMENT) ?? []).length
    if (best === null || bad < best.bad) best = { text, encoding, bad }
    if (bad === 0) break
  }
  return { text: best.text.replace(/^﻿/, ''), encoding: best.encoding }
}

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, newlines inside quotes).
 * The delimiter is the one among `,` `\t` `;` that appears most in the first line.
 * @param {string} text - decoded file.
 * @returns {string[][]} rows of cells.
 */
export function parseCsv(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const delimiter = [',', '\t', ';'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell); cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

const pad = n => String(n).padStart(2, '0')

/**
 * Convert an Excel date serial to `YYYY-MM-DD` (and ` HH:MM[:SS]` when it has a time part).
 * @param {number} serial - Excel serial number.
 * @param {boolean} date1904 - workbook uses the 1904 date system.
 * @returns {string}
 */
export function excelSerialToText(serial, date1904 = false) {
  let days = Math.floor(serial)
  const fraction = serial - days
  // Serial 60 is Excel's phantom 1900-02-29; serials after it are one day ahead.
  if (!date1904 && days === 60) return '1900-02-29'
  if (!date1904 && days > 60) days -= 1
  const ms = (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)) + days * 86400000
  const d = new Date(ms)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const seconds = Math.round(fraction * 86400)
  if (seconds === 0 || seconds === 86400) return date
  const hh = Math.floor(seconds / 3600)
  const mm = Math.floor((seconds % 3600) / 60)
  const ss = seconds % 60
  return `${date} ${pad(hh)}:${pad(mm)}${ss ? `:${pad(ss)}` : ''}`
}

const isDateFormat = fmt => {
  if (typeof fmt !== 'string') return false
  const stripped = fmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
  return /[ymdhs]/i.test(stripped) && !/^[#0.,%\s]+$/.test(stripped)
}

/**
 * The text of one worksheet cell, as a person sees it.
 * Numbers use the formatted text unless that text lost digits (scientific
 * notation, `#####`); then the raw number is written out in full, so a long
 * ID stays as precise as the file holds it.
 */
function cellText(cell, date1904) {
  if (cell === undefined || cell === null) return ''
  if (cell.t === 'n' && (isDateFormat(cell.z) || cell.t === 'd')) return excelSerialToText(cell.v, date1904)
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = cell.v
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE'
  if (cell.t === 'e') return ''
  if (cell.t === 'n') {
    const shown = typeof cell.w === 'string' ? cell.w : ''
    if (shown === '' || /E[+-]?\d/i.test(shown) || /^#+$/.test(shown)) {
      return Number.isInteger(cell.v) ? BigInt(cell.v).toString() : String(cell.v)
    }
    return shown
  }
  return typeof cell.w === 'string' ? cell.w : String(cell.v ?? '')
}

/**
 * Read an xlsx/xls workbook into text sheets.
 * @param {Uint8Array} bytes - file bytes.
 * @returns {{ sheets: object[] }}
 */
export function readWorkbook(bytes) {
  let wb
  try {
    wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: true, cellFormula: true, dense: false })
  } catch (error) {
    throw new CrmError('unreadable', `这个表格文件读不了，可能已损坏或加了密码：${error.message}`)
  }
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904)
  const sheets = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) { sheets.push({ name, rows: [], filled: new Set(), formulaColumns: [] }); continue }
    const range = XLSX.utils.decode_range(ws['!ref'])
    const rows = []
    const formulaCount = new Map()
    const damaged = new Set()
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (cell?.f) formulaCount.set(c - range.s.c, (formulaCount.get(c - range.s.c) ?? 0) + 1)
        if (cell?.t === 'n' && !isDateFormat(cell.z) && Number.isInteger(cell.v) && Math.abs(cell.v) >= 1e15) damaged.add(`${r - range.s.r},${c - range.s.c}`)
        row.push(cellText(cell, date1904).trim())
      }
      rows.push(row)
    }
    const filled = new Set()
    for (const m of ws['!merges'] ?? []) {
      const top = rows[m.s.r - range.s.r]?.[m.s.c - range.s.c] ?? ''
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue
          const rr = r - range.s.r
          const cc = c - range.s.c
          if (rows[rr] && rows[rr][cc] === '') { rows[rr][cc] = top; filled.add(`${rr},${cc}`) }
        }
      }
    }
    // A column counts as computed when most of its non-empty cells hold formulas.
    const formulaColumns = [...formulaCount].filter(([c, n]) => n >= Math.max(2, rows.filter(r => r[c] !== '').length * 0.5)).map(([c]) => c)
    sheets.push({ name, rows: trimEmpty(rows), filled, damaged, formulaColumns })
  }
  return { sheets }
}

/** Drop trailing empty rows and trailing empty columns. */
function trimEmpty(rows) {
  let end = rows.length
  while (end > 0 && rows[end - 1].every(v => v === '')) end--
  const kept = rows.slice(0, end)
  let width = 0
  for (const r of kept) for (let c = r.length - 1; c >= 0; c--) if (r[c] !== '') { width = Math.max(width, c + 1); break }
  return kept.map(r => r.slice(0, width))
}

/**
 * Read a source file by its extension.
 * @param {string} name - file name, used for the extension.
 * @param {Uint8Array} bytes - file bytes.
 * @returns {{ sheets: object[], encoding?: string }}
 */
export function readFileBytes(name, bytes) {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    const { text, encoding } = decodeText(bytes)
    return { sheets: [{ name: name.replace(/\.[^.]+$/, ''), rows: trimEmpty(parseCsv(text).map(r => r.map(v => v.trim()))), filled: new Set(), formulaColumns: [] }], encoding }
  }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return readWorkbook(bytes)
  throw new CrmError('bad-type', `只支持 xlsx、xls、csv 文件，「${name}」不是`)
}
