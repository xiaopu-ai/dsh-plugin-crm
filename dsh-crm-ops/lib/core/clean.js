/**
 * 清洗: one rule per value type. A value either parses into its standard form
 * or is left empty with a reason; nothing is guessed. Every result keeps the
 * raw text so the cleaned value can be traced back to its cell.
 *
 * Result: `{ value, empty, ok, reason?, unknown? }`
 *   empty  the cell was blank
 *   ok     the value parsed (an empty cell is ok with value null)
 *   reason why it did not parse, in plain words
 */
import { halfWidth, isScientific, parseDate, parseIdCard, parseMoney, parseNumber, parsePhone, parseVin } from './profile.js'
import { TAG_SEPARATORS, normValue } from './spec.js'

const LANDLINE = /^0\d{2,3}-?\d{7,8}$/
const CURRENCY = /(\$|USD|US\$|HK\$|HKD|€|EUR|£|GBP|美元|港币|欧元|日元|JPY)/i

/** Collapse spaces between CJK characters, half-width, trimmed: how names are compared. */
export const normName = raw => halfWidth(raw).replace(/\s+/g, '').trim()

/** A dictionary lookup table: normalized variant → standard value. */
export function dictionaryIndex(dict) {
  const out = new Map()
  for (const [std, variants] of Object.entries(dict ?? {})) for (const v of [std, ...variants]) out.set(normValue(v), std)
  return out
}

const ok = value => ({ value, empty: false, ok: true })
const bad = reason => ({ value: null, empty: false, ok: false, reason })

/**
 * Clean one cell.
 * @param {string} type - id | name | phone | idcard | serial | date | money | number | category | tags | text.
 * @param {string} raw - the cell text.
 * @param {{ as?: string, dict?: Map<string,string>, list?: boolean, sep?: string }} [opts] - `as` for serials;
 *   dictionary index for categories and tags; `list`: a date cell listing several dates reads as the latest;
 *   `sep`: what separates the values of a tags cell (default: commas, semicolons, 、 and |).
 */
export function cleanValue(type, raw, opts = {}) {
  const text = String(raw ?? '').trim()
  if (text === '' || text === '-' && type !== 'text') return { value: null, empty: true, ok: true }
  switch (type) {
    case 'phone': {
      if (isScientific(text)) return bad('原表已损坏（被 Excel 改成了科学计数法）')
      const p = parsePhone(text)
      if (p) return ok(p)
      return bad(LANDLINE.test(halfWidth(text).replace(/\s/g, '')) ? '是座机号' : '手机号格式不对')
    }
    case 'date': {
      const d = parseDate(text)
      if (d?.value) return ok(d.value)
      // A summary cell may list several dates ("2019-08,2022-08"); with `list` the latest one stands.
      if (opts.list) {
        const parts = text.split(/[,，;；、|\n]+/).map(s => s.trim()).filter(Boolean)
        const dates = parts.length > 1 ? parts.map(s => parseDate(s)?.value) : []
        if (dates.length && dates.every(Boolean)) return ok(dates.sort((a, b) => dayOf(b).localeCompare(dayOf(a)))[0])
      }
      return bad(d?.ambiguous ? '分不清月和日' : '认不出日期')
    }
    case 'datetime': {
      // A day, like `date`, plus the time of day when the cell has one (`at`, "YYYY-MM-DDTHH:MM"): the day
      // is what windows and segments compare; the time is only for how many hours a first follow-up took.
      const m = /^(.*?)[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(halfWidth(text).trim())
      const d = cleanValue('date', m ? m[1] : text, opts)
      if (!d.ok || d.empty) return d
      const at = m && d.value.length === 10 && +m[2] < 24 ? `${d.value}T${m[2].padStart(2, '0')}:${m[3]}` : null
      return { ...d, at }
    }
    case 'money': {
      if (CURRENCY.test(text)) return bad('不是人民币')
      const c = parseMoney(text)
      return c === null ? bad('认不出金额') : ok(c)
    }
    case 'number': {
      const n = parseNumber(text)
      return n === null ? bad('认不出数字') : ok(n)
    }
    case 'idcard': {
      if (isScientific(text)) return bad('原表已损坏（被 Excel 改成了科学计数法）')
      const v = parseIdCard(text)
      if (!v) return bad('不是 18 位证件号')
      return v.valid ? ok(v.value) : { value: v.value, empty: false, ok: false, reason: '校验位不对，可疑', suspicious: true }
    }
    case 'serial': {
      if (isScientific(text)) return bad('原表已损坏（被 Excel 改成了科学计数法）')
      if (opts.as === 'vin') {
        const v = parseVin(text)
        if (!v) return bad('不是 17 位车架号')
        return v.valid ? ok(v.value) : { value: v.value, empty: false, ok: false, reason: '校验位不对，可疑', suspicious: true }
      }
      if (opts.as === 'idcard') return cleanValue('idcard', text)
      return ok(halfWidth(text).replace(/\s/g, '').toUpperCase())
    }
    case 'id': {
      if (isScientific(text)) return bad('原表已损坏（被 Excel 改成了科学计数法）')
      return ok(halfWidth(text).replace(/\s/g, '').replace(/\.0+$/, ''))
    }
    case 'name':
      return ok(normName(text))
    case 'category': {
      const display = halfWidth(text).replace(/\s+/g, ' ').trim()
      if (!opts.dict) return ok(display)
      const std = opts.dict.get(normValue(text))
      return std === undefined ? { value: null, empty: false, ok: false, reason: '不在字典里', unknown: display } : ok(std)
    }
    case 'tags': {
      // One cell, several values ("全地形车,摩托艇"): a list of distinct values, each through the dictionary.
      // Values the dictionary does not know wait for the person; the known ones still count.
      const parts = text.split(opts.sep ? opts.sep : TAG_SEPARATORS).map(s => halfWidth(s).replace(/\s+/g, ' ').trim()).filter(Boolean)
      const values = []
      const unknowns = []
      for (const part of parts) {
        const std = opts.dict ? opts.dict.get(normValue(part)) : part
        if (std === undefined) { if (!unknowns.includes(part)) unknowns.push(part) } else if (!values.includes(std)) values.push(std)
      }
      if (values.length === 0 && unknowns.length === 0) return { value: null, empty: true, ok: true }
      if (values.length === 0) return { value: null, empty: false, ok: false, reason: '不在字典里', unknown: unknowns[0], unknowns }
      return { value: values, empty: false, ok: true, ...(unknowns.length ? { unknowns } : {}) }
    }
    case 'text':
      return ok(text)
    default:
      return ok(text)
  }
}

/** Days between two `YYYY-MM-DD` (or `YYYY-MM`, read as the 1st) dates: b − a. */
export function daysBetween(a, b) {
  const t = s => Date.parse(s.length === 7 ? `${s}-01` : s)
  return Math.round((t(b) - t(a)) / 86400000)
}

/** `YYYY-MM-DD` n days before a date. */
export function daysBefore(date, n) {
  return new Date(Date.parse(date) - n * 86400000).toISOString().slice(0, 10)
}

/** Compare dates that may be months (`YYYY-MM`): a month sorts as its first day. */
export const dayOf = s => (s && s.length === 7 ? `${s}-01` : s)
