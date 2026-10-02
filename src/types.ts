// toolbell 核心类型约定：扫描器（scanners/）、通知渠道（notifiers/）、主流程（check.ts）都只依赖这里。

/** 工具来源。新增扫描器时在这里登记 id。 */
export type SourceId =
  | 'brew' // Homebrew formula（只看主动安装的 leaves）
  | 'brew-cask' // Homebrew cask
  | 'npm' // npm 全局包
  | 'pnpm' // pnpm 全局包
  | 'uv' // uv tool
  | 'pipx' // pipx
  | 'cargo' // cargo install
  | 'git' // 本地 git 克隆（只 fetch 比对，不 pull）
  | 'github-release' // 直接下载 GitHub release 的二进制（需手动登记）
  | 'claude-plugin'; // Claude Code 插件

/** 一个被跟踪的工具。key = `${source}:${name}`，用于 exclude 配置。 */
export interface Tool {
  source: SourceId;
  /** 在同一来源内唯一，例如 brew 第三方 tap 写全名 `cameroncooke/axe/axe` */
  name: string;
  /** 本机版本；git 类为短 SHA */
  installed: string;
  /** 来源私有数据（仓库路径、取版本命令等），扫描器自己读写 */
  meta?: Record<string, string>;
}

export type CheckStatus = 'latest' | 'outdated' | 'error';

export interface CheckResult {
  tool: Tool;
  status: CheckStatus;
  /** 最新版本；git 类为远端短 SHA */
  latest?: string;
  /** 给用户的升级命令，例如 `brew upgrade asc`。只提示，toolbell 从不自动执行 */
  updateCommand?: string;
  /** GitHub `owner/repo`，用于拉 release notes；拿不到就留空 */
  repo?: string;
  /** git 类：落后的提交数 */
  commitsBehind?: number;
  /** 附加说明，例如「工作区有未提交改动，更新前先 commit/stash」 */
  note?: string;
  /** status=error 时的原因 */
  error?: string;
}

export interface CheckContext {
  /** dry-run：不刷新包管理器索引、不做有副作用的网络操作（只读查询可以做） */
  dryRun: boolean;
  log: (msg: string) => void;
  config: Config;
}

export interface Scanner {
  id: SourceId;
  /** 展示名，例如「Homebrew」 */
  label: string;
  /** 本机是否装了这个包管理器 / 是否存在该来源 */
  available(ctx: CheckContext): Promise<boolean>;
  /** 列出本机该来源下「用户主动安装」的工具（不含依赖） */
  discover(ctx: CheckContext): Promise<Tool[]>;
  /** 检测这批工具是否落后。单个工具失败返回 status=error，不能抛出让整批失败 */
  check(tools: Tool[], ctx: CheckContext): Promise<CheckResult[]>;
}

// ---------- 配置（~/.config/toolbell/config.json，权限 600：含 webhook 与 API Key） ----------

export type ChannelType = 'feishu' | 'wecom' | 'dingtalk';

export interface ChannelConfig {
  type: ChannelType;
  webhook: string;
  /** 飞书 / 钉钉的「加签」密钥；企业微信不需要 */
  secret?: string;
}

export interface GithubReleaseEntry {
  /** 展示名，也是 Tool.name */
  name: string;
  /** owner/repo */
  repo: string;
  /** 取本机版本的命令，输出里第一个 x.y.z 视为版本 */
  versionCommand: string;
  /** 给用户的升级命令（可选） */
  updateCommand?: string;
}

export interface GitRepoEntry {
  /** 仓库绝对路径（支持 ~ 开头） */
  path: string;
  /** 给用户的升级命令（可选），默认 `git -C <path> pull` */
  updateCommand?: string;
}

export interface AiConfig {
  enabled: boolean;
  /** OpenAI 兼容接口地址，例如 https://api.openai.com/v1 、https://ark.cn-beijing.volces.com/api/v3 */
  baseURL: string;
  apiKey: string;
  model: string;
  /** 用户自我介绍（技术栈 / 在做的项目），让 AI 判断「对你有没有影响」 */
  profile?: string;
}

export interface Config {
  version: 1;
  /** 每天检测时间，HH:MM（本地时区） */
  schedule?: { time: string };
  /** 各来源开关；未出现的来源默认开启 */
  scanners: Partial<Record<SourceId, boolean>>;
  /** 排除的工具 key（`source:name`），init 时取消勾选的进这里 */
  exclude: string[];
  githubReleases: GithubReleaseEntry[];
  gitRepos: GitRepoEntry[];
  channels: ChannelConfig[];
  ai?: AiConfig;
  /** 全部最新时是否也发通知，默认 false（避免每天无动作消息） */
  notifyWhenUpToDate: boolean;
}

// ---------- 报告与通知 ----------

export interface Report {
  hostname: string;
  startedAt: Date;
  durationMs: number;
  results: CheckResult[];
  /** AI 生成的 Markdown 影响评估；未开启或失败时为空 */
  digest?: string;
}

export interface Notifier {
  type: ChannelType;
  /** 发送失败抛出 Error（主流程会捕获并记录，不影响其他渠道） */
  send(report: Report, channel: ChannelConfig): Promise<void>;
}

export const toolKey = (t: Pick<Tool, 'source' | 'name'>) => `${t.source}:${t.name}`;
