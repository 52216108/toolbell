# toolbell 🔔

> 你的开发工具有新版了，它会告诉你。

toolbell 会自动扫描你电脑上**主动安装**的开发工具（Homebrew、npm / pnpm 全局包、uv、pipx、cargo、GitHub Release 二进制、本地 git 克隆、Claude Code 插件……），每天定时检测有没有新版本，推送到**飞书 / 企业微信 / 钉钉**群机器人。可选接入大模型，把一堆 changelog 读成「哪些对你真正有影响」。

- **只提醒，不自动升级**：升级可能连带改动运行时（例如 brew 升级某个包时顺带升级 ruby，导致项目里的原生扩展失效），什么时候升由你决定。消息里会直接给出升级命令。
- **装完自动发现**：不用手写清单。只看你主动装的（`brew leaves`），不把依赖库算进来刷屏；以后新装的工具自动纳入。
- **国内办公 IM 原生支持**：飞书、企业微信、钉钉，含飞书/钉钉加签。
- **AI 解读 changelog（可选）**：自带 Key，支持任何 OpenAI 兼容接口（DeepSeek、火山方舟/豆包、通义千问、OpenAI、OpenRouter…）。一次跨好几个版本时，会拉取区间内**全部** release notes，而不是只看首尾两版。

## 安装

```bash
npm i -g toolbell
toolbell init
```

> 需要 Node.js ≥ 20。定时任务会指向全局安装的 toolbell，用 `npx toolbell` 临时运行时只能手动检测。

> ⚠️ 尚未发布到 npm，目前请从源码安装：
>
> ```bash
> git clone https://github.com/52216108/toolbell.git && cd toolbell
> pnpm install && pnpm build && npm i -g .
> toolbell init
> ```

`init` 会依次：扫描本机工具并让你勾选 → 选择是否跟踪本地 git 仓库 → 配置通知渠道 → 配置 AI 解读（可跳过）→ 设定每天检测时间并注册定时任务。

## 常用命令

| 命令 | 作用 |
|---|---|
| `toolbell check` | 立即检测一次，有更新就推送 |
| `toolbell check --dry-run` | 只在终端预览，不刷新索引、不推送 |
| `toolbell list` | 列出发现的工具及是否被跟踪 |
| `toolbell ignore brew:cocoapods` | 不再跟踪某个工具（key 见 `list`） |
| `toolbell unignore brew:cocoapods` | 恢复跟踪 |
| `toolbell schedule 08:45` | 修改每天检测时间；`--off` 取消 |
| `toolbell test-notify` | 真实检测一次并强制推送，确认渠道可用 |
| `toolbell status` | 查看定时任务与最近一次结果 |

## 支持的来源

| 来源 | 如何发现 | 如何判断新版 |
|---|---|---|
| Homebrew formula | `brew leaves --installed-on-request` | 先 `brew update` 刷新索引再比对（处理 `_N` 修订号） |
| Homebrew cask | `brew list --cask` | 跳过 `auto_updates` 的 App（它们自己会更新） |
| npm 全局包 | `npm ls -g` | `npm outdated -g` |
| pnpm 全局包 | `pnpm ls -g` | npm registry |
| uv tool | `uv tool list` | `uv tool list --outdated` |
| pipx | `pipx list --json` | PyPI |
| cargo | `cargo install --list` | crates.io |
| Git 仓库 | `init` 时从家目录挑选 | `git fetch` 后比较上游，**从不 pull** |
| GitHub Release 二进制 | 在配置里登记 | GitHub latest release |
| Claude Code 插件 | `~/.claude/plugins` | 按声明版本号判断（未发版的提交不提醒） |

### 登记 GitHub Release 二进制

直接下载 release 的工具没法自动识别，在 `~/.config/toolbell/config.json` 里加：

```json
"githubReleases": [
  { "name": "multica", "repo": "multica-ai/multica", "versionCommand": "multica --version", "updateCommand": "multica update" }
]
```

`versionCommand` 输出里的第一个 `x.y.z` 会被当成本机版本。

## 通知渠道配置

在群里添加「自定义机器人」，复制 webhook 地址填进 `toolbell init`：

- **飞书**：群设置 → 群机器人 → 添加机器人 → 自定义机器人。建议开启「签名校验」，把密钥填进 init。
- **企业微信**：群聊 → 添加群机器人 → 新创建机器人。
- **钉钉**：群设置 → 机器人 → 自定义。安全设置选「加签」并把密钥填进 init；若选「自定义关键词」，请把关键词设为 `toolbell`（每条消息标题都带这个词）。

> 企业微信单条 markdown 上限 4096 字节，开启 AI 解读时评估内容会被截断，完整内容建议用飞书或钉钉接收。

## 隐私与安全

- 配置保存在 `~/.config/toolbell/config.json`（权限 600），webhook、加签密钥、API Key 只存在本机。
- 发往通知渠道的只有工具名和版本号；开启 AI 解读时，工具名、版本号、changelog 原文和你填写的自我介绍会发给你配置的模型服务。
- 访问 GitHub 时优先用 `GITHUB_TOKEN` / `GH_TOKEN` 或 `gh auth token`，没有就匿名访问（每小时 60 次）。

## 开发

```bash
pnpm install
pnpm dev check --dry-run -v   # 用源码直接跑
pnpm test
pnpm build
```

新增一个来源：在 `src/scanners/` 实现 `Scanner` 接口（见 `src/types.ts`），并在 `src/scanners/index.ts` 注册。

## License

MIT
