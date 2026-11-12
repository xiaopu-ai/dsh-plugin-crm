#!/usr/bin/env node
// One-click start for someone who got this plugin as a zip and has no DeepSeek Harness yet:
// installs DSH and pnpm next to the plugin on the first run, adds the plugin to a profile home of
// its own (DSH_HOME, default ~/.dsh-crm-ops, apart from any other DSH install), and opens the web
// app. Datasets go to ~/Documents/客户运营 unless CRM_OPS_DOCUMENTS says otherwise.
// Arguments go to the web app (e.g. --port 8793 --no-open).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const say = text => process.stdout.write(`${text}\n`)
const stop = text => {
  process.stderr.write(`\n${text}\n`)
  process.exit(1)
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) stop(`需要 Node.js 22.19 或更新，现在是 ${process.versions.node}。到 https://nodejs.org 下载 LTS 版装上，再双击启动。`)

const win = process.platform === 'win32'
const bin = join(root, 'node_modules', '.bin')
const dsh = join(bin, win ? 'dsh.cmd' : 'dsh')
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win, ...opts })

if (!existsSync(dsh) || !existsSync(join(bin, win ? 'pnpm.cmd' : 'pnpm'))) {
  say('第一次启动：下载 DeepSeek Harness（装好以后占约 1 GB，看网速要一到几分钟，只下这一次）…')
  const npm = win ? 'npm.cmd' : 'npm'
  const base = ['install', '--no-audit', '--no-fund', '--include=dev']
  if (run(npm, [...base, '--registry=https://registry.npmmirror.com']).status !== 0) {
    say('国内镜像没装上，换官方源再试一次…')
    if (run(npm, base).status !== 0) stop('下载没成功。检查一下网络，再双击启动一次。')
  }
}

const home = process.env.DSH_HOME || join(homedir(), '.dsh-crm-ops')
const docs = process.env.CRM_OPS_DOCUMENTS || join(homedir(), 'Documents')
// DSH looks pnpm up on PATH; the one installed next to the plugin comes first.
const env = { ...process.env, DSH_HOME: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` }

// 0.13.0 起包名带上了 npm 的前缀。DSH 把两个包名当成两个插件：以前用旧包名装过的，先摘掉旧的。
const OLD_NAME = 'dsh-crm-ops'
const profileManifest = join(home, 'profiles', 'web', 'package.json')
const hadOld = existsSync(profileManifest) && Object.hasOwn(JSON.parse(readFileSync(profileManifest, 'utf8')).dependencies ?? {}, OLD_NAME)
if (hadOld) run(dsh, ['plugin', '--profile', 'web', 'remove', OLD_NAME], { env, stdio: ['ignore', 'ignore', 'inherit'] })

say('把插件装进 DeepSeek Harness…')
if (run(dsh, ['plugin', '--profile', 'web', 'add', root], { env, stdio: ['ignore', 'ignore', 'inherit'] }).status !== 0) stop('插件没装上，上面是出错信息。')

// Where datasets live: written once, a person's own edits to the profile patch are kept.
const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
const NAME = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
const before = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
// The row a previous start wrote keeps its folders; only the package name in it is brought up to date.
const current = before.replace(/^(\s*name:\s*)dsh-crm-ops\s*$/m, `$1'${NAME}'`)
if (current !== before) writeFileSync(patch, current)
if (!/id: crm-ops\b/.test(current)) {
  mkdirSync(dirname(patch), { recursive: true })
  const kept = current.split('\n').filter(line => line.trim() !== '[]').join('\n').trimEnd()
  const q = s => JSON.stringify(s)
  writeFileSync(patch, `${kept ? `${kept}\n` : ''}- id: crm-ops\n  name: '${NAME}'\n  config:\n    documentsDir: ${q(docs)}\n    stateDir: ${q(join(home, 'crm-ops'))}\n`)
}

say(`启动中，浏览器会自己打开。数据放在 ${join(docs, '客户运营')}。用完关掉这个窗口就停了。\n`)
const app = spawn(dsh, ['--profile', 'web', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit', shell: win })
app.on('exit', code => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.kill(sig))
