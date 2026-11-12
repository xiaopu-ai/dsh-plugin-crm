# 开发者文档

[← 回到首页](../README.md)

换一种方式安装、改代码、加自己的预设、打包发给别人时看这里。

## 其他安装方式

普通用户按[首页](../README.md#三步开始)填包名 `@xiaopuai/dsh-crm-ops` 就行。另外几种方式：

| 方式 | 在「插件 → 添加插件」里填什么 | 说明 |
|---|---|---|
| GitHub | `github:xiaopu-ai/dsh-plugin-crm#path:/dsh-crm-ops` | 装的是仓库 `main` 当时的版本，不会自动提示更新；用同样的地址再装一次，或运行 `dsh plugin --profile desktop update @xiaopuai/dsh-crm-ops` 升级 |
| 压缩包 | [Releases](https://github.com/xiaopu-ai/dsh-plugin-crm/releases) 里 `xiaopuai-dsh-crm-ops-<版本>.tgz` 的绝对路径 | 同上，不会自动提示更新 |
| 本地文件夹 | 克隆仓库后 `dsh-crm-ops` 文件夹的绝对路径 | 改 `lib/client/index.js` 保存就生效，适合改页面。插件没有运行时依赖，不用先 `npm install` |

命令行一样能装：`dsh plugin --profile desktop add <上面任意一种>`（`desktop` 换成你的 profile）。

**电脑上还没有 DSH**：从 [Releases](https://github.com/xiaopu-ai/dsh-plugin-crm/releases) 下载 `dsh-crm-ops-launcher-v<版本>.zip`，解压后双击里面的「启动客户运营台.command」（Mac，需要 Node.js 22.19 或更新）。第一次会自己下载 DSH（装好约 1 GB），之后每次二十秒左右打开；它用独立的 `~/.dsh-crm-ops`，和电脑上别的 DSH 互不影响。细节见包里的 `使用说明.txt`。

0.13.0 起包名从 `dsh-crm-ops` 改成了 `@xiaopuai/dsh-crm-ops`（为了发到 npm）。DSH 把两个包名当成两个插件：以前用旧包名装过的，先在「插件」里删除旧的，再按新包名装。数据集在 `文稿/客户运营/`，不受影响；一键启动会自己把旧的换掉。

## 和 DSH 版本的关系

插件在 `dsh-crm-ops/package.json` 的 `engines.dsh` 里声明支持 `>=0.2.2-rc.1 <0.3.0-0`：0.2.2-rc.1 到所有 0.2.x，不含 0.3 的预览版（DSH 比较版本时把预览版也算进去，所以上限写成 `<0.3.0-0`）。DSH 安装和每次启动都会核对：

- 不在范围内时，安装会被拒绝并提示「不兼容」；已经装好的插件在启动时被跳过，DSH 自己正常启动，配置和数据不变。插件管理里可以对某个版本手动「豁免」，风险自负。
- 下限是插件用到的 DSH 接口出现的最早版本：对比过 0.2.2-rc.1 和 rc.2 的源码，插件用到的接口要么没变，要么 rc.2 只是多了东西。从头到尾跑过的是 0.2.2-rc.2。DSH 出 0.3 时要重新核对接口、发新版本。
- 一键启动装的 DSH 版本由 `package.json` 的 `devDependencies` 和 `package-lock.json` 定，现在是 0.2.2-rc.2；要换版本两处一起改，`npm install --package-lock-only` 重新生成锁文件。

## 仓库里有什么

```
dsh-crm-ops/                 插件本体（装进 DSH 的就是这个文件夹）
  lib/core/                  清洗、认人、分层、查询、名单、报告：纯逻辑，不认识任何行业词
  lib/host/                  给助手的工具和页面用的路由
  lib/client/index.js        界面（一个文件，React，不用打包）
  presets/                   预设：行业默认值，都是数据文件
  skills/                    助手的两份工作说明（配表、分析）
  tests/                     单测，npm test，不需要 key
  tools/                     一键启动、打包、生成示例数据
docs/                        功能详解、开发者文档、截图
示例数据/                    四套编的数据
启动客户运营台.command       给没有 DSH 的人：双击启动
使用说明.txt                 随压缩包发给使用的人的说明
```

插件是纯 JavaScript，没有运行时 npm 依赖，不用编译。它是一个**底座**：行业知识全在配置和预设里，核心代码不认识任何行业词。

## 开发

```sh
cd dsh-crm-ops
npm test                                   # 单测，不需要任何 key，也不需要装 DSH
node tools/start.mjs --no-open --port 8792 # 本地起 Web 版：第一次会装 DSH，独立的 DSH_HOME=~/.dsh-crm-ops
npm run pack                               # 打发给别人的压缩包（插件 + 一键启动 + 示例数据 + 使用说明）
node tools/make-dealer-samples.mjs ../示例数据/经销商示例          # 重新生成示例数据（另一个是 make-owner-system-samples.mjs）
```

已经装了 DSH 桌面版的话，不用另装一份：用它自带的命令行建一个测试 profile，把这个文件夹装进去，和日常用的 profile 互不影响。

```sh
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" crm-dev --from-default-profile web --dump-config >/dev/null   # 建 profile
"$DSH" plugin --profile crm-dev add "$PWD"                            # 装这个文件夹（改了代码直接生效）
"$DSH" crm-dev --no-open --port 8792                                  # 启动，终端里会打印带 token 的地址
```

- 新建的 profile 没有选模型，AI 一跑会报 `MISSING_CREDENTIAL`：在 `~/.dsh/profiles/crm-dev/cordis.patch.yml` 里加上 `agent-default-model`（`provider: deepseek-account`、`model: deepseek-flash`）这一条。
- 改了 Host（`lib/host/`、`lib/core/`）要重启才生效；改 Client（`lib/client/index.js`）会热更新，但会把面板切回对话首页，重开一下即可。
- 用安装包（`npm pack` 出来的 `.tgz`）装的话：同一个版本号、同一个路径的包再装一次，pnpm 会说 Already up to date，文件不会换。先升版本号，或者先 `plugin --profile … remove @xiaopuai/dsh-crm-ops` 再 `add`。
- AI 助手要本地配好 DeepSeek 账号或 key 才跑得起来；没有 key 也能把除「问 AI」以外的全部点一遍。
- 数据集默认放在 `文稿/客户运营/`。想换地方，在 profile 的 `cordis.patch.yml` 里给 `id: crm-ops` 那一行写 `config: { documentsDir: 绝对路径 }`。

`tests/` 和 `示例数据/` 里的数据全是编的（人名、公司、品牌、车架号、手机号都是造的，手机号在 138-0000 测试号段）。真实数据不要放进这个仓库。

## 加自己的预设

预设是一个 JSON 文件：这个行业的客户怎么分层、有哪些标记、名单有哪些用途和结果，固定格式的导出还可以带现成的表对应（列名对得上就不用和 AI 聊，一步出草案）。

- 复制 `dsh-crm-ops/presets/dealer-network.json` 到 `文稿/客户运营/预设/`，改 `id`、`name`，把每张表的列名换成自己的。同 id 的会盖过自带的，插件升级不动这个文件夹。
- 公司自己的预设（带着内部系统的列名）就放在这个文件夹里，不用进插件，也不用进任何公开仓库。
- 字段怎么写见[功能详解](FEATURES.md#预设可以带现成的表对应)。

## 界面代码的结构

`lib/client/index.js` 是一个文件，分六段：名字、外观、底座（这两段是通用的「DSH 插件底座」）、底座候选、页面、挂载。

- 色值只写在「外观」那一段，别处都用 `--crm-` 开头的变量（浅色深色自动跟着走）。
- 类名都通过 `cls()` 带上 `crm-` 前缀；没有品牌色和图片；弹窗只盖住插件自己的区域。
- 外框、首页、客户、名单、挑人跟进、数据源已经全用底座组件；名单详情、分析、活动、报告、复核、配置、待确认还是插件自己的排版，各页上方有注释。

## 发给别人

`npm run pack`（或 `node tools/pack.mjs 输出目录`）在桌面生成 `客户运营台-v<版本>.zip`（放到 Releases 时改成英文名 `dsh-crm-ops-launcher-v<版本>.zip`，GitHub 会把附件名里的中文去掉）：里面是插件文件夹 `dsh-crm-ops/`、一键启动 `启动客户运营台.command`、合成的 `示例数据/` 和 `使用说明.txt`。一键启动走 `tools/start.mjs`：第一次在插件旁边 `npm install`（先国内镜像、再官方源）装 DSH 和 pnpm，把插件装进独立的 `DSH_HOME`（默认 `~/.dsh-crm-ops`），数据集放 `~/Documents/客户运营`（`CRM_OPS_DOCUMENTS` 可改），再起 Web 版。对方只需要 Node.js 22.19+；要用 AI 还需要 DeepSeek 账号或 API Key。

## 规矩

- 有后果的动作（导入、换表头、确认截止日、移到回收站）只走 Client → Host 路由 `/api/crmOps/call`，不做成 AI 的工具。
- 不拦截 `/api`。
- 给模型的东西一律经过 `redactProfile`：敏感列只留统计，文字里的手机号、证件号、VIN、邮箱都遮掉。
- 右边的对话栏只放插件自己的助手（preset `crm-assistant`，没有文件、命令行、网页工具）。别的助手的对话不在这一栏显示。
- 删除只移到数据集的 `回收站/`。
- 核心层（`lib/core/`）不出现任何行业词或客户名。
