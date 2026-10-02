# 参与贡献

感谢你愿意改进 toolbell！提 Issue、补充中文简介、新增一个检测来源，都非常欢迎。

## 开发环境

需要 Node.js ≥ 20 和 pnpm（版本见 `package.json` 的 `packageManager` 字段，用 `corepack enable` 可自动对齐）。

```bash
git clone https://github.com/52216108/toolbell.git && cd toolbell
pnpm install
pnpm dev check --dry-run -v   # 用源码直接跑一次检测（不推送、不刷新索引）
pnpm dev ui --no-open         # 用源码启动配置网页
pnpm test                     # 单元测试
pnpm typecheck                # 类型检查
pnpm build                    # 构建到 dist/
```

想在本机用自己改过的版本：`pnpm build && npm i -g .`（链接到源码目录，之后每次 `pnpm build` 即生效）。

> 调试时建议设置 `XDG_CONFIG_HOME=$(mktemp -d)` 使用临时配置目录，避免改动你自己的真实配置。注意：`toolbell schedule` 与网页里的「保存并更新定时任务」会改写本机真实的定时任务（launchd / crontab），与配置目录无关。

## 目录结构

| 路径 | 作用 |
|---|---|
| `src/scanners/` | 各来源的扫描器：发现本机工具、检测是否有新版 |
| `src/notifiers/` | 飞书 / 企业微信 / 钉钉推送（含加签、长度截断、脱敏） |
| `src/render.ts` | 把检测结果渲染成推送用的 Markdown |
| `src/changelog.ts`、`src/digest.ts` | 拉取版本区间内的 release notes，调用大模型做影响评估 |
| `src/describe/` | 工具简介：内置中文词典、本地英文描述、AI 补全 |
| `src/ui/` | `toolbell ui` 本地配置网页（服务端 + 单文件页面） |
| `src/check.ts` | 一次检测的主流程 |
| `src/schedule.ts` | launchd / crontab 定时任务 |
| `src/config.ts`、`src/config-commands.ts`、`src/init.ts` | 配置读写、非交互命令、终端向导 |
| `src/types.ts` | 核心类型约定，扫描器与通知渠道都只依赖它 |

## 常见贡献

### 补充中文简介

编辑 `src/describe/dict-zh.ts`，按分类加一行 `工具名: '一句话说明它是做什么的'`。请只写你确定的说明——宁可不收录，也不要给出错误描述（没收录的工具会显示官方英文描述）。

### 新增一个检测来源

1. 在 `src/types.ts` 的 `SourceId` 里登记新来源 id；
2. 在 `src/scanners/` 新建文件，实现 `Scanner` 接口：
   - `available()`：本机是否装了这个包管理器；
   - `discover()`：只列出**用户主动安装**的工具，不要把依赖库算进来；
   - `check()`：尽量一条命令批量查询；单个工具失败返回 `status: 'error'`，不要抛出让整批失败；
3. 在 `src/scanners/index.ts` 注册，在 `src/render.ts` 的 `SOURCE_LABELS` 加中文名；
4. 把命令输出的解析逻辑抽成纯函数，在 `test/scanners/` 用内联样例写单测。

### 必须遵守的原则

- **只检测，不升级**：任何代码路径都不能执行升级命令，也不能对用户的 git 仓库做 pull / merge / stash。升级命令只作为文字提示给用户。
- **`--dry-run` 不产生副作用**：不刷新包管理器索引、不 `git fetch`、不推送。
- **凭证不外泄**：webhook、加签密钥、API Key 不得出现在日志、错误信息、终端输出、推送内容和网页响应里。

## 提交 PR

- 一个 PR 只做一件事；改了行为请同步更新 `README.md`，并在 `CHANGELOG.md` 的「未发布」下记一笔。
- 提交前本地跑通 `pnpm typecheck && pnpm test && pnpm build`（CI 也会在 macOS / Linux 上跑一遍）。
- 提交信息、注释、文案使用中文。

## 发布新版本（维护者）

1. 把 `CHANGELOG.md` 的「未发布」改成新版本号与日期，并更新文末的对比链接；
2. 修改 `package.json` 的 `version`；
3. 提交并打 tag 推送：

   ```bash
   git commit -am "chore: 版本 x.y.z"
   git tag vx.y.z
   git push && git push origin vx.y.z
   ```

推送 tag 后，GitHub Actions 会自动校验 tag 与 `package.json` 版本一致、跑测试、构建打包，并以 CHANGELOG 中该版本的内容创建 Release（附 `toolbell.tgz`）。
