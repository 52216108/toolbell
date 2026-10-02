# 更新记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
发布时 GitHub Release 的说明直接取自这里对应版本的内容。

## [未发布]

### 新增

- GitHub Actions：每次推送与 PR 在 macOS / Linux、Node 20 / 22 上跑类型检查、测试与构建
- 推送 `v*` tag 自动发布 Release（校验版本号、测试、打包、附 `toolbell.tgz`）
- `CONTRIBUTING.md`、`SECURITY.md`、Issue 与 PR 模板
- README 加入配置网页截图与徽章

## [0.3.0] - 2026-10-02

### 新增

- 不带参数运行 `toolbell`：首次使用直接打开网页配置，已配置时显示状态
- 网页新增首次使用引导：勾选工具 → 填通知渠道 → 保存并注册定时 → 发送测试消息，逐步打勾

### 变更

- README 快速开始改为「安装 + `toolbell`」两条命令；给 AI Agent 的安装提示词简化为安装并打开网页，webhook 与 API Key 由用户在网页填写
- 非交互命令移入 README「命令行参考」，供脚本与无浏览器环境使用
- 升级命令加 `--prefer-online`，避免 npm 按地址缓存装回旧版本

## [0.2.1] - 2026-10-02

### 修复

- `repo add` 与网页登记的仓库路径统一存为绝对路径（相对路径在定时任务中会失效）
- `ai set` 不再把已用 `ai off` 关闭的 AI 解读重新开启
- 源码直跑（`pnpm dev`）时版本号兜底，不再崩溃
- 网页配置服务：只有鉴权通过的请求才刷新空闲计时；Linux 默认只打印地址（`--open` 自动打开）；兼容 80 端口

### 变更

- README 全面修订：效果示例、系统要求、升级卸载、常见问题

## [0.2.0] - 2026-10-02

### 新增

- `toolbell ui`：本地网页可视化配置，按来源勾选要跟踪的工具、整组开关、搜索与「只看可更新」筛选；配置通知渠道、AI 解读、定时、本地仓库与 Release 工具；支持预览检测与发送测试消息
- 工具简介：常见工具内置中文简介，其余显示官方英文描述；配置 AI 后可一键补全中文简介（结果本地缓存）
- 非交互配置命令 `channel` / `ai` / `repo` / `release`
- 通过 GitHub Release 安装包一条命令安装

### 安全

- 网页服务只监听 127.0.0.1，随机 token 与 Host 校验防跨站请求与 DNS rebinding；已保存的 webhook、加签密钥、API Key 不回传网页
- API Key 只能由用户在终端（`toolbell ai key`）或网页里填写，不经过 AI Agent 对话

## [0.1.0] - 2026-10-02

首个版本。

### 新增

- 自动发现 10 类来源：Homebrew formula / cask、npm / pnpm 全局包、uv、pipx、cargo、本地 git 仓库、GitHub Release 二进制、Claude Code 插件
- 推送到飞书 / 企业微信 / 钉钉群机器人（支持飞书、钉钉加签）
- 可选 AI 解读 changelog（任意 OpenAI 兼容接口），拉取版本区间内全部 release notes
- macOS launchd / Linux crontab 每日定时检测；只检测、不自动升级
- 命令：`init`、`check`、`list`、`ignore`、`schedule`、`test-notify`、`status`

[未发布]: https://github.com/52216108/toolbell/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/52216108/toolbell/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/52216108/toolbell/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/52216108/toolbell/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/52216108/toolbell/releases/tag/v0.1.0
