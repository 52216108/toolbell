// 网页配置的数据交换：页面拿到的是「脱敏视图」，提交回来的是「白名单补丁」。
// 凭证（webhook 全文、加签密钥、API Key）从不下发给页面；页面不改它们时，原值保持不变。

import { resolve } from 'node:path';
import { expandHome, parseTime } from '../config.js';
import { maskWebhook } from '../notifiers/shared.js';
import { AI_PRESETS, CHANNEL_LABEL, WEBHOOK_PATTERN } from '../presets.js';
import type { ChannelConfig, ChannelType, Config, GitRepoEntry, GithubReleaseEntry, SourceId } from '../types.js';

export interface PublicChannel {
  /** 在当前配置 channels 数组里的下标，提交时用来指认「沿用原 webhook / 密钥」 */
  ref: number;
  type: ChannelType;
  masked: string;
  hasSecret: boolean;
}

export interface PublicConfig {
  scanners: Partial<Record<SourceId, boolean>>;
  exclude: string[];
  channels: PublicChannel[];
  ai: { enabled: boolean; baseURL: string; model: string; profile: string; hasKey: boolean };
  schedule: { time: string };
  notifyWhenUpToDate: boolean;
  gitRepos: GitRepoEntry[];
  githubReleases: GithubReleaseEntry[];
}

export function publicConfig(c: Config): PublicConfig {
  return {
    scanners: c.scanners,
    exclude: c.exclude,
    channels: c.channels.map((ch, ref) => ({ ref, type: ch.type, masked: maskWebhook(ch.webhook), hasSecret: !!ch.secret })),
    ai: {
      enabled: !!c.ai?.enabled,
      baseURL: c.ai?.baseURL ?? '',
      model: c.ai?.model ?? '',
      profile: c.ai?.profile ?? '',
      hasKey: !!c.ai?.apiKey,
    },
    schedule: { time: c.schedule?.time ?? '09:30' },
    notifyWhenUpToDate: c.notifyWhenUpToDate,
    gitRepos: c.gitRepos,
    githubReleases: c.githubReleases,
  };
}

/** 页面提交的补丁。每个字段都可省略，省略即不改 */
export interface ConfigPatch {
  scanners?: Record<string, unknown>;
  exclude?: unknown[];
  /**
   * 渠道全量列表。ref 指向原渠道：webhook 省略则沿用原值；
   * secret 省略沿用、null 清除、字符串覆盖
   */
  channels?: { ref?: number; type?: string; webhook?: string; secret?: string | null }[];
  ai?: { enabled?: boolean; baseURL?: string; model?: string; profile?: string; apiKey?: string | null };
  schedule?: { time?: string };
  notifyWhenUpToDate?: boolean;
  gitRepos?: { path?: string; updateCommand?: string }[];
  githubReleases?: { name?: string; repo?: string; versionCommand?: string; updateCommand?: string }[];
}

export class PatchError extends Error {}

const SOURCE_IDS: SourceId[] = ['brew', 'brew-cask', 'npm', 'pnpm', 'uv', 'pipx', 'cargo', 'git', 'github-release', 'claude-plugin'];
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 把补丁合并进配置，返回新配置；校验失败抛 PatchError（信息直接展示给用户） */
export function applyPatch(current: Config, patch: ConfigPatch): Config {
  const next: Config = structuredClone(current);

  if (patch.scanners && typeof patch.scanners === 'object') {
    next.scanners = {};
    for (const id of SOURCE_IDS) {
      // 只记录关闭的来源，开启是默认值
      if (patch.scanners[id] === false) next.scanners[id] = false;
    }
  }

  if (Array.isArray(patch.exclude)) {
    next.exclude = [...new Set(patch.exclude.filter((k): k is string => typeof k === 'string' && k.includes(':')))];
  }

  if (Array.isArray(patch.channels)) {
    next.channels = patch.channels.map((p, i): ChannelConfig => {
      const prev = typeof p.ref === 'number' ? current.channels[p.ref] : undefined;
      const type = (prev?.type ?? str(p.type)) as ChannelType;
      if (!(type in CHANNEL_LABEL)) throw new PatchError(`第 ${i + 1} 个渠道类型无效`);
      const webhook = p.webhook !== undefined ? str(p.webhook) : prev?.webhook ?? '';
      if (!WEBHOOK_PATTERN[type].test(webhook)) throw new PatchError(`第 ${i + 1} 个渠道：这不像${CHANNEL_LABEL[type]}机器人的 webhook 地址`);
      let secret = prev?.type === type ? prev.secret : undefined;
      if (p.secret === null) secret = undefined;
      else if (typeof p.secret === 'string' && p.secret.trim()) secret = p.secret.trim();
      if (type === 'wecom') secret = undefined;
      return { type, webhook, ...(secret ? { secret } : {}) };
    });
  }

  if (patch.ai && typeof patch.ai === 'object') {
    const a = patch.ai;
    const prev = current.ai;
    const baseURL = (a.baseURL !== undefined ? str(a.baseURL) : prev?.baseURL ?? '').replace(/\/+$/, '');
    const model = a.model !== undefined ? str(a.model) : prev?.model ?? '';
    let apiKey = prev?.apiKey ?? '';
    if (a.apiKey === null) apiKey = '';
    else if (typeof a.apiKey === 'string' && a.apiKey.trim()) apiKey = a.apiKey.trim();
    const profile = a.profile !== undefined ? str(a.profile) : prev?.profile ?? '';
    const enabled = a.enabled ?? prev?.enabled ?? false;
    if (enabled) {
      if (!/^https?:\/\//.test(baseURL)) throw new PatchError('AI 解读：接口地址需要以 http(s):// 开头');
      if (!model) throw new PatchError('AI 解读：请填写模型名');
      if (!apiKey) throw new PatchError('AI 解读：请填写 API Key');
    }
    if (enabled || baseURL || model || apiKey) {
      next.ai = { enabled, baseURL, model, apiKey, ...(profile ? { profile } : {}) };
    } else {
      delete next.ai;
    }
  }

  if (patch.schedule && typeof patch.schedule === 'object') {
    const time = str(patch.schedule.time);
    if (!parseTime(time)) throw new PatchError('检测时间格式应为 HH:MM，例如 09:30');
    next.schedule = { time };
  }

  if (typeof patch.notifyWhenUpToDate === 'boolean') next.notifyWhenUpToDate = patch.notifyWhenUpToDate;

  if (Array.isArray(patch.gitRepos)) {
    next.gitRepos = patch.gitRepos
      .filter((r) => str(r.path))
      // 统一绝对路径：定时任务的工作目录与网页服务不同，相对路径会找不到
      .map((r) => ({ path: resolve(expandHome(str(r.path))), ...(str(r.updateCommand) ? { updateCommand: str(r.updateCommand) } : {}) }));
  }

  if (Array.isArray(patch.githubReleases)) {
    next.githubReleases = patch.githubReleases
      .filter((r) => str(r.name))
      .map((r, i) => {
        if (!/^[\w.-]+\/[\w.-]+$/.test(str(r.repo))) throw new PatchError(`第 ${i + 1} 个 Release 工具：仓库格式应为 owner/repo`);
        if (!str(r.versionCommand)) throw new PatchError(`第 ${i + 1} 个 Release 工具：请填写取版本的命令`);
        return {
          name: str(r.name),
          repo: str(r.repo),
          versionCommand: str(r.versionCommand),
          ...(str(r.updateCommand) ? { updateCommand: str(r.updateCommand) } : {}),
        };
      });
  }

  return next;
}

export const aiPresets = AI_PRESETS;
export const channelLabels = CHANNEL_LABEL;
