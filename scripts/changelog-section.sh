#!/bin/sh
# 输出 CHANGELOG.md 中指定版本的内容（不含版本标题行），供发布时生成 Release 说明。
# 用法：sh scripts/changelog-section.sh 0.3.0
set -eu
version="$1"
awk -v v="$version" '
  /^## \[/ { if (found) exit; if (index($0, "## [" v "]") == 1) { found = 1; next } }
  /^\[[^]]+\]: / { if (found) exit }
  found { print }
' CHANGELOG.md | sed -e '/./,$!d'
