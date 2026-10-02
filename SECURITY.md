# 安全问题报告

toolbell 会在本机保存通知渠道 webhook、加签密钥和大模型 API Key，并运行一个本地配置网页。如果你发现可能导致这些凭证泄露、或能被他人利用的问题，请**不要**公开提 Issue，而是通过 GitHub 私密报告：

仓库页面 → Security → [Report a vulnerability](https://github.com/52216108/toolbell/security/advisories/new)

请尽量附上：影响的版本、复现步骤、可能的后果。我们会尽快确认并修复，修复发布后再公开细节。

## 范围

特别关注：

- 凭证（webhook、加签密钥、API Key）出现在日志、错误信息、推送内容、网页响应中
- `toolbell ui` 配置网页的鉴权绕过（跨站请求、DNS rebinding、token 泄露）
- 通过外部数据（包管理器返回值、release notes、AI 输出）实现命令注入或脚本注入
- 任何违背「只检测、不升级」的代码路径

## 提交 Issue 前请脱敏

普通问题提 Issue 时，粘贴配置或日志前请先删掉 webhook 地址、加签密钥和 API Key。`toolbell status` 与 `toolbell channel list` 的输出已经做过脱敏，可以直接贴。
