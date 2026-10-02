# toolbell 🔔

[![CI](https://github.com/52216108/toolbell/actions/workflows/ci.yml/badge.svg)](https://github.com/52216108/toolbell/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/52216108/toolbell)](https://github.com/52216108/toolbell/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[简体中文](README.md) | **English**

> Your dev tools have new versions. toolbell rings the bell.

toolbell scans the developer tools you **explicitly installed** on your machine (Homebrew, npm / pnpm globals, uv, pipx, cargo, GitHub Release binaries, local git clones, Claude Code plugins…), checks for new versions on a daily schedule, and pushes a summary to your **Feishu (Lark) / WeCom / DingTalk** group bot. Optionally, an LLM reads the pile of changelogs for you and tells you which updates actually matter.

- **Notify only, never auto-upgrade**: upgrades can drag runtimes along (e.g. a brew upgrade silently bumping ruby and breaking your project's native extensions). You decide when to upgrade — each message includes the exact upgrade command.
- **Auto-discovery**: no manifest to maintain. Only tools you installed yourself (`brew leaves`) are tracked — dependency libraries are left out to avoid noise. Newly installed tools are picked up automatically.
- **Built for Chinese workplace chat apps**: Feishu, WeCom and DingTalk, including Feishu / DingTalk signature verification.
- **Web-based configuration**: `toolbell ui` opens a local page where you tick the tools to track (each with a short description) and set up channels and AI.
- **AI changelog digest (optional)**: bring your own key for any OpenAI-compatible API (DeepSeek, Volcengine Ark / Doubao, Qwen, OpenAI, OpenRouter…). When a tool jumps several versions, **all** release notes in between are fetched, not just the first and last.

> The configuration page and notifications are currently in Chinese — toolbell is built primarily for teams using Chinese workplace chat apps. Contributions for English UI are welcome.

## Configuration page

Run `toolbell` to open the local configuration page: tick the tools you want to track, then set up channels, AI and the schedule on the same page.

![Configuration page: tracked tools](docs/images/ui-tools.png)

![Configuration page: notification channels and AI digest](docs/images/ui-settings.png)

## What a notification looks like

toolbell checks daily and posts a message to your group when something can be upgraded (it stays quiet when everything is up to date by default). Messages are in Chinese, for example:

```text
🔔 toolbell 更新提醒 · my-mac · 2026-10-03 09:30        ← toolbell update alert

⚠️ 有 3 项可更新                                          ← 3 tools can be upgraded

Homebrew
- gh 2.96.0 → 2.102.0
  brew upgrade gh
- asc 5.1.0 → 5.9.1
  brew upgrade asc

npm 全局包                                                ← npm globals
- eas-cli 20.3.0 → 24.8.0
  npm i -g eas-cli@latest

✅ 其余 45 项已是最新                                     ← 45 others are up to date

AI 影响评估                                               ← AI impact digest (when enabled)
一句话总结：asc 跨 8 个版本，含命令输出字段变化……
```

## Requirements

- macOS (scheduled via launchd) or Linux (scheduled via crontab); Windows is not supported yet
- Node.js ≥ 20

## Quick start

```bash
npm i -g https://github.com/52216108/toolbell/releases/latest/download/toolbell.tgz
toolbell
```

The first run opens the local configuration page. Follow the guide at the top:

1. Under 「跟踪的工具」 (tracked tools), untick anything you don't want checked (everything is tracked by default);
2. Under 「通知渠道」 (channels), paste the webhook of your Feishu / WeCom / DingTalk group bot;
3. Click 「保存并更新定时任务」 (save & update schedule) — toolbell will then check every day at the configured time;
4. Click 「发送测试消息」 (send test message) and confirm it arrives in your group.

To change settings later, run `toolbell ui` again.

### Let your AI agent install it

Or paste this into your AI coding assistant (Claude Code, Codex, Cursor…):

```text
Please install toolbell (https://github.com/52216108/toolbell), a tool that checks my local dev tools for updates and notifies a Feishu/WeCom/DingTalk group:
1. Run node -v and make sure Node.js ≥ 20 (macOS and Linux only). If not, stop and tell me.
2. Run npm i -g https://github.com/52216108/toolbell/releases/latest/download/toolbell.tgz, then confirm with toolbell --version.
3. Run toolbell ui in the background (it keeps running until I click 「完成」 (Done) on the page). On macOS it opens the browser automatically; otherwise send me the URL from its output. Tell me to finish the setup by following the guide at the top of the page.
4. When I say I'm done, run toolbell status and summarize the result for me.
Note: do not ask me for webhooks or API keys in the chat — I'll enter them on the page myself. Do not run any upgrade commands for me.
```

> No browser available (e.g. a remote server)? Use the terminal wizard `toolbell init`, or the non-interactive commands in the CLI reference below.

### Upgrade and uninstall

```bash
# Upgrade: just reinstall; your config is kept (--prefer-online avoids npm serving a cached old tarball)
npm i -g --prefer-online https://github.com/52216108/toolbell/releases/latest/download/toolbell.tgz

# Uninstall: remove the schedule first, then the package (config lives in ~/.config/toolbell — delete it if you like)
toolbell schedule --off
npm rm -g toolbell
```

## CLI reference

The web page covers day-to-day use; these commands are for scripts, remote servers, or if you prefer the terminal.

| Command | What it does |
|---|---|
| `toolbell` | Opens the configuration page if not configured yet; otherwise shows status |
| `toolbell ui` | Opens the local configuration page; on Linux it only prints the URL by default — add `--open` to launch the browser |
| `toolbell init` | Interactive terminal wizard |
| `toolbell check` | Check now and notify if anything can be upgraded |
| `toolbell check --dry-run` | Preview in the terminal only: no index refresh, no git fetch, no notification (still calls the model once if AI digest is enabled) |
| `toolbell list` | List discovered tools and whether they are tracked |
| `toolbell ignore brew:cocoapods` | Stop tracking a tool (keys are shown by `list`) |
| `toolbell unignore brew:cocoapods` | Track it again |
| `toolbell schedule 08:45` | Change the daily check time; `--off` removes the schedule |
| `toolbell test-notify` | Run a real check and always notify, to verify your channels |
| `toolbell status` | Show the schedule and the latest result |
| `toolbell channel add feishu <webhook> [--secret …]` | Add a notification channel (`channel list` / `channel remove` to manage) |
| `toolbell ai set --provider deepseek --model …` | Set the AI endpoint and model; `toolbell ai key` enters the key in the terminal; `ai off` disables it |
| `toolbell repo add ~/some-repo` | Track a local clone (checked only, never pulled) |
| `toolbell release add <name> --repo owner/repo --version-cmd "…"` | Track a tool installed from GitHub Release binaries |

## Supported sources

| Source | Discovery | How new versions are detected |
|---|---|---|
| Homebrew formula | `brew leaves --installed-on-request` | `brew update` first, then compare (handles `_N` revisions) |
| Homebrew cask | `brew info --installed` | Apps with `auto_updates` are skipped (they update themselves) |
| npm globals | `npm ls -g` | `npm outdated -g` |
| pnpm globals | `pnpm ls -g` | npm registry |
| uv tool | `uv tool list` | `uv tool list --outdated` |
| pipx | `pipx list --json` | PyPI |
| cargo | `cargo install --list` | crates.io |
| Git repositories | Registered manually (`repo add`, the web page, or `init`) | `git fetch`, then compare with upstream — **never pulls** |
| GitHub Release binaries | Registered manually (`release add` or the web page) | GitHub latest release |
| Claude Code plugins | `~/.claude/plugins` | Declared plugin version (unreleased commits don't trigger alerts) |

### Registering a GitHub Release binary

Tools installed by downloading release binaries can't be detected automatically, so register them (or add them on the `toolbell ui` page):

```bash
toolbell release add multica --repo multica-ai/multica --version-cmd "multica --version" --update-cmd "multica update"
```

Equivalent to adding this to `~/.config/toolbell/config.json`:

```json
"githubReleases": [
  { "name": "multica", "repo": "multica-ai/multica", "versionCommand": "multica --version", "updateCommand": "multica update" }
]
```

The first `x.y.z` in the output of `versionCommand` is taken as the installed version.

## Setting up channels

Add a "custom bot" to your group, then paste its webhook into the `toolbell ui` page, or run `toolbell channel add <feishu|wecom|dingtalk> <webhook> [--secret <secret>]`:

- **Feishu (Lark)**: Group settings → Bots → Add bot → Custom bot. Enabling signature verification is recommended — enter the secret as well.
- **WeCom**: Group chat → Add group bot → Create new bot.
- **DingTalk**: Group settings → Bots → Custom. Choose "signature" as the security setting and enter the secret. If you use "custom keywords", set the keyword to `toolbell` (every message title contains it).

> WeCom limits a markdown message to 4096 bytes, so the AI digest gets truncated there. Use Feishu or DingTalk if you want the full digest.

## Tool descriptions

Every tool in the list comes with a one-line description to help you decide whether to track it:

1. Common tools have built-in Chinese descriptions (works offline);
2. Others show the official English description from their package manager;
3. With AI configured, you can click 「用 AI 补全中文简介」 on the page to generate Chinese descriptions. Results are cached locally and are based only on the official descriptions — the model is never asked to guess from a name.

PRs adding descriptions to `src/describe/dict-zh.ts` are welcome.

## Privacy and security

- Config is stored in `~/.config/toolbell/config.json` (mode 600). Webhooks, signing secrets and API keys never leave your machine except to their own services.
- `toolbell ui` listens on 127.0.0.1 only, uses a random token generated on every launch, and validates the Host header. Saved webhooks, secrets and keys are never sent back to the page.
- Sent to your notification channels: hostname, tool names, versions, upgrade commands, check failure reasons, and the AI digest when enabled.
- With the AI digest enabled, names, versions and changelogs of upgradable tools, plus the profile you wrote, are sent to the model service you configured. "Generate Chinese descriptions" sends tool names and their official English descriptions.
- GitHub requests use `GITHUB_TOKEN` / `GH_TOKEN` or `gh auth token` when available, and fall back to anonymous access (60 requests per hour).

## FAQ

**The scheduled check didn't notify me.** Run `toolbell status` to see whether the schedule is registered and what the latest result was. Detailed logs are in `~/.config/toolbell/toolbell.log`.

**I installed a new package manager (e.g. cargo, pipx) but the scheduled check doesn't see it.** The scheduled job records PATH, proxy and similar variables from your terminal when it is registered. Run `toolbell schedule` again after installing new tools.

**I use a proxy / mirror.** Registering the schedule also records `HTTP(S)_PROXY`, `HOMEBREW_*` mirror variables and the like (anything whose name looks like a secret, such as TOKEN / KEY, is skipped). Run `toolbell schedule` again after changing them.

**I don't want alerts for a tool anymore.** `toolbell ignore <key>`, or untick it on the `toolbell ui` page. To drop a whole source, turn off 「检测此来源」 (check this source) on the page.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (in Chinese) for the development setup, project layout, how to add a new source, and the release process. Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
