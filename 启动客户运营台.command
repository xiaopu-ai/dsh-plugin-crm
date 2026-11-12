#!/bin/sh
# 双击启动客户运营台。第一次会下载 DeepSeek Harness，之后直接打开。
cd "$(dirname "$0")/dsh-crm-ops" || exit 1
# Finder 打开的终端不一定带上 nvm、Homebrew 的路径，补上常见的几处。
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v node >/dev/null 2>&1; then
  echo "没找到 Node.js。请到 https://nodejs.org 下载 LTS 版（22 或更新）装上，再双击这个文件。"
  open "https://nodejs.org/zh-cn/download" 2>/dev/null
  printf '按回车关闭'; read -r _; exit 1
fi
node tools/start.mjs "$@"
code=$?
if [ "$code" -ne 0 ]; then printf '\n按回车关闭'; read -r _; fi
exit "$code"
