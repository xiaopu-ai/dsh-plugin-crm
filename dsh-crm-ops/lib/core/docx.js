/**
 * A finalized report as a .docx, written without dependencies: a stored
 * (uncompressed) ZIP holding the four parts Word needs. Markdown is mapped to
 * headings, paragraphs with bold runs, bullet and numbered lines, tables and
 * horizontal rules; that is all a report draft uses.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * A stored ZIP of `{ name: string|Buffer }`. Names are UTF-8 and flagged as such, and the entries say they
 * were written on Unix: a command-line unzip runs the names of a DOS-made archive through a DOS code page,
 * which turns every name that is not ASCII into question marks.
 * @param {{ date?: string|null, executable?: (name: string) => boolean }} [options] - 'YYYY-MM-DD' to date the
 *   entries (a pack people unpack should not show files from 1980); `executable` says which entries keep the
 *   bit that lets a double-click run them.
 */
export function zip(files, { date = null, executable = () => false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  const dosDate = m && Number(m[1]) >= 1980 ? ((Number(m[1]) - 1980) << 9) | (Number(m[2]) << 5) | Number(m[3]) : 0x21
  // Noon, so no time zone moves the file to the day before.
  const dosTime = m ? 12 << 11 : 0
  const UNIX = (3 << 8) | 20
  const FILE_MODE = 0o100644 * 65536
  const RUN_MODE = 0o100755 * 65536
  const parts = []
  const central = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const fname = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8)
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fname.length, 26); local.writeUInt16LE(0, 28)
    parts.push(local, fname, data)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(UNIX, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10)
    cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(fname.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32); cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(executable(name) ? RUN_MODE : FILE_MODE, 38); cen.writeUInt32LE(offset, 42)
    central.push(cen, fname)
    offset += local.length + fname.length + data.length
  }
  const cdir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cdir.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20)
  return Buffer.concat([...parts, cdir, end])
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Inline Markdown (**bold**) to runs. */
function runs(text, { bold = false, size } = {}) {
  const out = []
  const pieces = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  for (const p of pieces) {
    const b = bold || (p.startsWith('**') && p.endsWith('**'))
    const t = p.startsWith('**') && p.endsWith('**') ? p.slice(2, -2) : p
    const props = [b ? '<w:b/>' : '', size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''].join('')
    out.push(`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t.replace(/`/g, ''))}</w:t></w:r>`)
  }
  return out.join('')
}
const para = (inner, { style, indent } = {}) => `<w:p>${style || indent ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${indent ? `<w:ind w:left="${indent}"/>` : ''}</w:pPr>` : ''}${inner}</w:p>`

/** Markdown → WordprocessingML body. */
export function markdownToDocumentXml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const body = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*$/.test(line)) continue
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { body.push(para(runs(h[2]), { style: `Heading${Math.min(3, h[1].length)}` })); continue }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr></w:pPr></w:p>'); continue }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map(c => c.trim())); i++ }
      i--
      const cols = Math.max(...rows.map(r => r.length))
      const tr = (r, head) => `<w:tr>${Array.from({ length: cols }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / cols)}" w:type="dxa"/></w:tcPr>${para(runs(r[c] ?? '', { bold: head }))}</w:tc>`).join('')}</w:tr>`
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:color="BBBBBB"/>`).join('')}</w:tblBorders></w:tblPr>${rows.map((r, k) => tr(r, k === 0)).join('')}</w:tbl>`)
      body.push('<w:p/>')
      continue
    }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line)
    if (bullet) { body.push(para(runs(`• ${bullet[2]}`), { indent: 360 + bullet[1].length * 180 })); continue }
    const num = /^(\s*)(\d+)[.、]\s*(.*)$/.exec(line)
    if (num) { body.push(para(runs(`${num[2]}. ${num[3]}`), { indent: 360 + num[1].length * 180 })); continue }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) { body.push(para(runs(quote[1]), { indent: 540 })); continue }
    body.push(para(runs(line)))
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[1, 2, 3].map(n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${360 - n * 60}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - n * 4}"/><w:szCs w:val="${36 - n * 4}"/></w:rPr></w:style>`).join('')}</w:styles>`

/** A .docx file (Buffer) from Markdown. */
export function markdownToDocx(md) {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/document.xml': markdownToDocumentXml(md),
    'word/styles.xml': STYLES,
  })
}
