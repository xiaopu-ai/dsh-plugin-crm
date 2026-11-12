#!/usr/bin/env node
// 打一个发给别人的压缩包：插件文件夹 dsh-crm-ops/、一键启动、示例数据、使用说明。
// 用法：node tools/pack.mjs [输出目录]        默认放到桌面，文件名 客户运营台-v<版本>.zip
// 不带 node_modules（对方第一次启动时自己装），不带系统的隐藏文件。文件名按 UTF-8 写，Windows 上解压也是中文；
// 「启动客户运营台.command」留着可执行的那一位，解压后双击就能跑。
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zip } from '../lib/core/docx.js'

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..')
const top = join(plugin, '..')
const { version } = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8'))
const name = `客户运营台-v${version}`
const out = process.argv[2] ?? join(homedir(), 'Desktop')
const SKIP = new Set(['node_modules', '.DS_Store', '.git'])
// What goes with the plugin folder: the launcher, the samples and the notes for the person. Reports and
// working notes that sit next to them stay out.
const BESIDE = ['启动客户运营台.command', '使用说明.txt', '示例数据']

const files = {}
const walk = dir => {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else files[[name, ...relative(top, path).split(sep)].join('/')] = readFileSync(path)
  }
}
walk(plugin)
for (const entry of BESIDE) {
  const path = join(top, entry)
  if (statSync(path).isDirectory()) walk(path)
  else files[`${name}/${entry}`] = readFileSync(path)
}
const now = new Date()
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
mkdirSync(out, { recursive: true })
const target = join(out, `${name}.zip`)
writeFileSync(target, zip(files, { date, executable: n => n.endsWith('.command') || n.endsWith('.sh') }))
console.log(`${target}\n${Object.keys(files).length} 个文件，${(statSync(target).size / 1048576).toFixed(1)} MB`)
