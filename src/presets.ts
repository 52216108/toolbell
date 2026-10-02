// 渠道与 AI 预设：交互式 init 与非交互命令（给 AI Agent 用）共用
import type { ChannelType } from './types.js';

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  feishu: '飞书',
  wecom: '企业微信',
  dingtalk: '钉钉',
};

export const WEBHOOK_PATTERN: Record<ChannelType, RegExp> = {
  feishu: /^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/\S+$/,
  wecom: /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=\S+$/,
  dingtalk: /^https:\/\/oapi\.dingtalk\.com\/robot\/send\?access_token=\S+$/,
};

// OpenAI 兼容接口预设；模型名变化快，只给常见默认值，用户可改
export const AI_PRESETS = [
  { value: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { value: 'ark', label: '火山方舟（豆包）', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { value: 'dashscope', label: '阿里云百炼（通义千问）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { value: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: '' },
  { value: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: '' },
  { value: 'custom', label: '其他 OpenAI 兼容接口', baseURL: '', model: '' },
] as const;
