// toolbell 本地配置页（单文件，无外部依赖）。token 从地址栏 ?t= 读取，所有请求带 X-Toolbell-Token。
export const PAGE_HTML = /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>toolbell 配置</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🔔</text></svg>">
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --text: #1f2328; --muted: #6b7280; --line: #e5e7eb;
    --accent: #2563eb; --accent-weak: #eff4ff; --warn: #b45309; --warn-weak: #fff7e6; --danger: #dc2626; --ok: #15803d;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1115; --card: #171a21; --text: #e6e8eb; --muted: #9aa3ae; --line: #2a2f3a;
      --accent: #5b8cff; --accent-weak: #1b2437; --warn: #f0a44b; --warn-weak: #2a2114; --danger: #f87171; --ok: #4ade80; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); }
  header { position: sticky; top: 0; z-index: 5; background: var(--card); border-bottom: 1px solid var(--line); }
  .bar { max-width: 960px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; gap: 12px; }
  .bar h1 { font-size: 17px; margin: 0; }
  .bar .meta { color: var(--muted); font-size: 12px; flex: 1; }
  main { max-width: 960px; margin: 0 auto; padding: 20px 20px 120px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
  section h2 { font-size: 15px; margin: 0 0 4px; }
  section .desc { color: var(--muted); font-size: 12px; margin: 0 0 14px; }
  button { font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 7px; padding: 6px 12px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.link { border: none; background: none; color: var(--accent); padding: 2px 6px; }
  button.danger { color: var(--danger); }
  button:disabled { opacity: .5; cursor: default; }
  input[type=text], input[type=password], input[type=time], select, textarea {
    font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 7px; padding: 6px 10px; width: 100%; }
  textarea { min-height: 64px; resize: vertical; }
  label.field { display: block; margin-bottom: 12px; }
  label.field > span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .row { display: flex; gap: 10px; align-items: center; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  .search { margin-bottom: 12px; }
  details.source { border: 1px solid var(--line); border-radius: 8px; margin-bottom: 10px; }
  details.source > summary { list-style: none; cursor: pointer; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
  details.source > summary::-webkit-details-marker { display: none; }
  details.source > summary .name { font-weight: 600; }
  details.source > summary .count { color: var(--muted); font-size: 12px; flex: 1; }
  details.source.off > summary .name { color: var(--muted); text-decoration: line-through; }
  .tools { border-top: 1px solid var(--line); padding: 6px 8px; max-height: 360px; overflow: auto; }
  .tool { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 6px; }
  .tool:hover { background: var(--accent-weak); }
  .tool .tinfo { flex: 1; min-width: 0; }
  .tool .tname { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool .tdesc { display: block; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool .tdesc.en { font-style: italic; }
  .hint { font-size: 12px; color: var(--muted); }
  .tool .ver { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .tool.excluded .tname { color: var(--muted); }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 10px; background: var(--warn-weak); color: var(--warn); white-space: nowrap; }
  .switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; }
  .item { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .item .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 600; }
  .empty { color: var(--muted); font-size: 13px; padding: 4px 0 10px; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; background: var(--card); border-top: 1px solid var(--line); }
  footer .bar { justify-content: flex-end; }
  footer .dirty { color: var(--warn); font-size: 12px; margin-right: auto; }
  #preview { white-space: pre-wrap; font: 12px/1.6 ui-monospace, Menlo, monospace; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; max-height: 420px; overflow: auto; }
  #toast { position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 8px 16px; border-radius: 8px; opacity: 0; transition: opacity .2s; pointer-events: none; max-width: 80vw; }
  #toast.show { opacity: .95; }
  #toast.error { background: var(--danger); color: #fff; }
  .loading { color: var(--muted); padding: 40px 0; text-align: center; }
  .guide { background: var(--accent-weak); border-color: var(--accent); }
  .guide ol { margin: 8px 0 0; padding-left: 0; list-style: none; }
  .guide li { padding: 3px 0; }
  .guide li.done { color: var(--muted); }
  .guide li .mark { display: inline-block; width: 22px; }
</style>
</head>
<body>
<header><div class="bar">
  <h1>🔔 toolbell 配置</h1>
  <div class="meta" id="meta"></div>
  <button id="done">完成</button>
</div></header>
<main id="app"><div class="loading">正在扫描本机工具…</div></main>
<footer><div class="bar">
  <span class="dirty" id="dirty"></span>
  <button id="btn-preview">预览检测结果</button>
  <button id="btn-test">发送测试消息</button>
  <button id="btn-save">保存</button>
  <button class="primary" id="btn-save-schedule">保存并更新定时任务</button>
</div></footer>
<div id="toast"></div>
<script>
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let S = null;        // 服务端状态
  let form = null;     // 页面编辑中的数据
  let dirty = false;

  async function api(path, body) {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Toolbell-Token': token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
    return data;
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), isError ? 5000 : 2500);
  }
  function markDirty() { dirty = true; $('#dirty').textContent = '有未保存的修改'; }

  function initForm(state) {
    const c = state.config;
    form = {
      scanners: { ...c.scanners },
      exclude: new Set(c.exclude),
      channels: c.channels.map((ch) => ({ ref: ch.ref, type: ch.type, masked: ch.masked, hasSecret: ch.hasSecret, webhook: '', secret: '', clearSecret: false })),
      ai: { ...c.ai, apiKey: '', clearKey: false },
      time: c.schedule.time,
      notifyWhenUpToDate: c.notifyWhenUpToDate,
      gitRepos: c.gitRepos.map((r) => ({ ...r })),
      githubReleases: c.githubReleases.map((r) => ({ ...r })),
      q: '',
      onlyOutdated: false,
    };
  }

  // ---------- 渲染 ----------
  function render() {
    const app = $('#app');
    app.innerHTML = [guideSection(), toolsSection(), channelsSection(), aiSection(), scheduleSection(), manualSection(), previewSection()].join('');
    $('#meta').textContent = S.schedule + (S.lastRunAt ? ' · 上次检测 ' + new Date(S.lastRunAt).toLocaleString('zh-CN') : '');
  }

  // 首次使用引导：没配置、没渠道或没注册定时任务时显示，全部完成后提示发测试消息
  let tested = false;
  function guideSection() {
    const hasChannel = S.config.channels.length > 0;
    const steps = [
      [S.configured, '在下方「跟踪的工具」里取消勾选不需要检测的工具（默认全部跟踪）'],
      [hasChannel, '在「通知渠道」添加飞书 / 企业微信 / 钉钉群机器人的 webhook'],
      [S.scheduleInstalled && S.configured, '点右下角「保存并更新定时任务」，之后每天按时自动检测'],
      [tested, '点「发送测试消息」，到群里确认能收到'],
    ];
    if (steps.every((s) => s[0])) return '';
    const allButTest = steps.slice(0, 3).every((s) => s[0]);
    return '<section class="guide"><h2>' + (S.configured ? '还差几步就配置好了' : '欢迎使用 toolbell 👋 跟着这几步完成配置') + '</h2>' +
      '<ol>' + steps.map((s, i) => '<li class="' + (s[0] ? 'done' : '') + '"><span class="mark">' + (s[0] ? '✅' : (i + 1) + '.') + '</span>' + s[1] + '</li>').join('') + '</ol>' +
      (allButTest ? '<p class="desc" style="margin:8px 0 0">AI 解读、本地仓库等都是可选项，不配也能用。</p>' : '') + '</section>';
  }

  function toolsSection() {
    const q = form.q.toLowerCase();
    const total = S.sources.reduce((n, s) => n + s.tools.length, 0);
    const tracked = S.sources.reduce((n, s) => n + (form.scanners[s.id] === false ? 0 : s.tools.filter((t) => !form.exclude.has(t.key)).length), 0);
    const filtering = !!q || form.onlyOutdated;
    // 有工具的来源排前面；空来源收到最后、默认折叠
    const sources = [...S.sources].sort((a, b) => (b.tools.length > 0) - (a.tools.length > 0));
    const groups = sources.map((s) => {
      const off = form.scanners[s.id] === false;
      const tools = s.tools.filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!form.onlyOutdated || t.latest));
      if (filtering && tools.length === 0) return '';
      const empty = s.tools.length === 0;
      const on = s.tools.filter((t) => !form.exclude.has(t.key)).length;
      const rows = tools.map((t) => {
        const ex = form.exclude.has(t.key);
        const badge = t.latest ? '<span class="badge">可更新 → ' + esc(t.latest) + '</span>' : '';
        return '<label class="tool' + (ex ? ' excluded' : '') + '">' +
          '<input type="checkbox" data-tool="' + esc(t.key) + '"' + (ex ? '' : ' checked') + (off ? ' disabled' : '') + '>' +
          '<span class="tinfo"><span class="tname" title="' + esc(t.key) + '">' + esc(t.name) + '</span>' +
          (t.zh ? '<span class="tdesc" title="' + esc(t.en || t.zh) + '">' + esc(t.zh) + '</span>'
            : t.en ? '<span class="tdesc en" title="' + esc(t.en) + '">' + esc(t.en) + '</span>' : '') +
          '</span>' + badge +
          '<span class="ver">' + esc(t.installed) + '</span></label>';
      }).join('') || '<div class="empty">没有发现工具</div>';
      return '<details class="source' + (off ? ' off' : '') + '"' + (empty ? '' : ' open') + '>' +
        '<summary><span class="name">' + esc(s.label) + '</span>' +
        '<span class="count">' + (off ? '已关闭此来源' : '跟踪 ' + on + ' / ' + s.tools.length) + '</span>' +
        (off || empty ? '' : '<button class="link" data-all="' + s.id + '">全选</button><button class="link" data-none="' + s.id + '">全不选</button>') +
        '<label class="switch" onclick="event.stopPropagation()"><input type="checkbox" data-source="' + s.id + '"' + (off ? '' : ' checked') + '>检测此来源</label>' +
        '</summary><div class="tools">' + rows + '</div></details>';
    }).join('');
    return '<section><h2>跟踪的工具</h2><p class="desc">取消勾选的工具不再检测更新；以后新装的工具会自动纳入。共 ' + total + ' 项，当前跟踪 ' + tracked + ' 项。「可更新」来自上一次检测结果。</p>' +
      describeBar() +
      '<div class="row search"><input type="text" id="q" placeholder="搜索工具名…" value="' + esc(form.q) + '">' +
      '<label class="switch" style="white-space:nowrap"><input type="checkbox" id="only-outdated"' + (form.onlyOutdated ? ' checked' : '') + '>只看可更新</label></div>' +
      (groups || '<div class="empty">没有匹配的工具</div>') + '</section>';
  }

  function describeBar() {
    const missing = S.sources.reduce((n, s) => n + s.tools.filter((t) => !t.zh).length, 0);
    if (missing === 0) return '';
    const ready = S.config.ai.hasKey && S.config.ai.baseURL && S.config.ai.model;
    return '<div class="row" style="margin-bottom:12px"><span class="hint">有 ' + missing + ' 个工具还没有中文简介（显示的是官方英文描述）。</span>' +
      (ready ? '<button id="btn-describe">用 AI 补全中文简介</button>' : '<span class="hint">在下方「AI 解读」配置好模型后，可一键补全。</span>') + '</div>';
  }

  function channelsSection() {
    const items = form.channels.map((ch, i) => {
      const saved = ch.ref !== undefined;
      const secretField = ch.type === 'wecom' ? '' :
        '<label class="field"><span>加签密钥（可选）</span><input type="password" data-ch="' + i + '" data-k="secret" value="' + esc(ch.secret) + '" placeholder="' +
        (ch.hasSecret && !ch.clearSecret ? '已设置，留空则沿用' : '没开加签就留空') + '"></label>' +
        (ch.hasSecret ? '<label class="switch"><input type="checkbox" data-ch="' + i + '" data-k="clearSecret"' + (ch.clearSecret ? ' checked' : '') + '>清除已保存的密钥</label>' : '');
      return '<div class="item"><div class="head"><span>' + esc(S.channelLabels[ch.type]) + '</span><button class="link danger" data-del-ch="' + i + '">删除</button></div>' +
        '<label class="field"><span>Webhook 地址</span><input type="text" data-ch="' + i + '" data-k="webhook" value="' + esc(ch.webhook) + '" placeholder="' +
        (saved ? '已保存 ' + esc(ch.masked) + '，留空则沿用' : '粘贴群机器人的 webhook 地址') + '"></label>' + secretField + '</div>';
    }).join('') || '<div class="empty">还没有通知渠道，检测结果只能在终端查看。</div>';
    const add = Object.keys(S.channelLabels).map((t) => '<button data-add-ch="' + t + '">+ ' + esc(S.channelLabels[t]) + '</button>').join(' ');
    return '<section><h2>通知渠道</h2><p class="desc">在群里添加「自定义机器人」，把 webhook 地址粘贴到这里。钉钉若使用「自定义关键词」，请设为 toolbell。</p>' + items + '<div class="row">' + add + '</div></section>';
  }

  function aiSection() {
    const a = form.ai;
    const opts = '<option value="">选择服务商快速填充…</option>' + S.presets.map((p) => '<option value="' + p.value + '">' + esc(p.label) + '</option>').join('');
    const body = !a.enabled ? '' :
      '<label class="field"><span>服务商</span><select id="preset">' + opts + '</select></label>' +
      '<div class="grid2"><label class="field"><span>接口地址（OpenAI 兼容，到 /v1 这一级）</span><input type="text" data-ai="baseURL" value="' + esc(a.baseURL) + '"></label>' +
      '<label class="field"><span>模型名（火山方舟可填 ep-… 接入点）</span><input type="text" data-ai="model" value="' + esc(a.model) + '"></label></div>' +
      '<label class="field"><span>API Key（只保存在本机配置文件）</span><input type="password" data-ai="apiKey" value="' + esc(a.apiKey) + '" placeholder="' + (a.hasKey ? '已保存，留空则沿用' : '粘贴 API Key') + '"></label>' +
      '<label class="field"><span>你的技术栈 / 在做的项目（让 AI 判断影响更准）</span><textarea data-ai="profile">' + esc(a.profile) + '</textarea></label>';
    return '<section><h2>AI 解读 changelog</h2><p class="desc">有更新时把各工具的 release notes 交给大模型，按「对你的影响」分档写进通知。需要你自己的 API Key。</p>' +
      '<label class="switch" style="margin-bottom:12px"><input type="checkbox" id="ai-on"' + (a.enabled ? ' checked' : '') + '>开启 AI 解读</label>' + body + '</section>';
  }

  function scheduleSection() {
    return '<section><h2>定时检测</h2><p class="desc">' + esc(S.schedule) + '。修改时间后点「保存并更新定时任务」生效。</p>' +
      '<div class="row"><label class="field" style="width:160px"><span>每天检测时间</span><input type="time" id="time" value="' + esc(form.time) + '"></label></div>' +
      '<label class="switch"><input type="checkbox" id="notify-latest"' + (form.notifyWhenUpToDate ? ' checked' : '') + '>全部最新时也发一条通知</label></section>';
  }

  function manualSection() {
    const repos = form.gitRepos.map((r, i) =>
      '<div class="item"><div class="grid2"><label class="field"><span>仓库路径</span><input type="text" data-repo="' + i + '" data-k="path" value="' + esc(r.path) + '" placeholder="~/some-repo"></label>' +
      '<label class="field"><span>更新命令（可选）</span><input type="text" data-repo="' + i + '" data-k="updateCommand" value="' + esc(r.updateCommand) + '" placeholder="git -C 路径 pull --ff-only"></label></div>' +
      '<button class="link danger" data-del-repo="' + i + '">删除</button></div>').join('') || '<div class="empty">没有登记本地仓库。</div>';
    const rels = form.githubReleases.map((r, i) =>
      '<div class="item"><div class="grid2">' +
      '<label class="field"><span>名称</span><input type="text" data-rel="' + i + '" data-k="name" value="' + esc(r.name) + '" placeholder="multica"></label>' +
      '<label class="field"><span>GitHub 仓库</span><input type="text" data-rel="' + i + '" data-k="repo" value="' + esc(r.repo) + '" placeholder="owner/repo"></label>' +
      '<label class="field"><span>取版本的命令</span><input type="text" data-rel="' + i + '" data-k="versionCommand" value="' + esc(r.versionCommand) + '" placeholder="multica --version"></label>' +
      '<label class="field"><span>更新命令（可选）</span><input type="text" data-rel="' + i + '" data-k="updateCommand" value="' + esc(r.updateCommand) + '" placeholder="multica update"></label>' +
      '</div><button class="link danger" data-del-rel="' + i + '">删除</button></div>').join('') || '<div class="empty">没有登记 Release 工具。</div>';
    return '<section><h2>本地 git 仓库</h2><p class="desc">自己 clone 的项目，只 fetch 比对是否落后，不会 pull。</p>' + repos +
      '<button data-add-repo>+ 添加仓库</button></section>' +
      '<section><h2>GitHub Release 工具</h2><p class="desc">直接下载 release 二进制的工具无法自动识别，在这里登记。</p>' + rels +
      '<button data-add-rel>+ 添加工具</button></section>';
  }

  function previewSection() {
    return '<section id="preview-wrap" style="display:none"><h2>检测结果预览</h2><p class="desc">按已保存的配置检测（不推送、不调用 AI）。</p><div id="preview"></div></section>';
  }

  // ---------- 事件 ----------
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'q') { form.q = el.value; const pos = el.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); return; }
    if (el.dataset.ch !== undefined && el.type !== 'checkbox') { form.channels[+el.dataset.ch][el.dataset.k] = el.value; return markDirty(); }
    if (el.dataset.ai) { form.ai[el.dataset.ai] = el.value; return markDirty(); }
    if (el.dataset.repo !== undefined) { form.gitRepos[+el.dataset.repo][el.dataset.k] = el.value; return markDirty(); }
    if (el.dataset.rel !== undefined) { form.githubReleases[+el.dataset.rel][el.dataset.k] = el.value; return markDirty(); }
    if (el.id === 'time') { form.time = el.value; return markDirty(); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.tool) { el.checked ? form.exclude.delete(el.dataset.tool) : form.exclude.add(el.dataset.tool); markDirty(); return render(); }
    if (el.dataset.source) { if (el.checked) delete form.scanners[el.dataset.source]; else form.scanners[el.dataset.source] = false; markDirty(); return render(); }
    if (el.dataset.ch !== undefined && el.dataset.k === 'clearSecret') { form.channels[+el.dataset.ch].clearSecret = el.checked; markDirty(); return render(); }
    if (el.id === 'ai-on') { form.ai.enabled = el.checked; markDirty(); return render(); }
    if (el.id === 'preset') {
      const p = S.presets.find((x) => x.value === el.value);
      if (p) { if (p.baseURL) form.ai.baseURL = p.baseURL; if (p.model) form.ai.model = p.model; markDirty(); render(); }
      return;
    }
    if (el.id === 'notify-latest') { form.notifyWhenUpToDate = el.checked; return markDirty(); }
    if (el.id === 'only-outdated') { form.onlyOutdated = el.checked; return render(); }
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    const setAll = (id, on) => {
      const src = S.sources.find((s) => s.id === id);
      src.tools.forEach((t) => (on ? form.exclude.delete(t.key) : form.exclude.add(t.key)));
      markDirty(); render();
    };
    if (d.all) { e.preventDefault(); return setAll(d.all, true); }
    if (d.none) { e.preventDefault(); return setAll(d.none, false); }
    if (d.addCh) { form.channels.push({ type: d.addCh, webhook: '', secret: '', hasSecret: false, clearSecret: false }); markDirty(); return render(); }
    if (d.delCh !== undefined) { form.channels.splice(+d.delCh, 1); markDirty(); return render(); }
    if (d.addRepo !== undefined) { form.gitRepos.push({ path: '', updateCommand: '' }); markDirty(); return render(); }
    if (d.delRepo !== undefined) { form.gitRepos.splice(+d.delRepo, 1); markDirty(); return render(); }
    if (d.addRel !== undefined) { form.githubReleases.push({ name: '', repo: '', versionCommand: '', updateCommand: '' }); markDirty(); return render(); }
    if (d.delRel !== undefined) { form.githubReleases.splice(+d.delRel, 1); markDirty(); return render(); }
    if (el.id === 'btn-describe') {
      return busy(el, async () => {
        const r = await api('/api/describe-ai', {});
        // 只刷新工具数据，不覆盖页面上未保存的编辑
        S.sources = r.state.sources;
        render();
        toast(r.filled > 0 ? '已补全 ' + r.filled + ' 条中文简介' : '没有可补全的（缺少官方描述的工具不会让 AI 凭名字猜）');
      });
    }
  });

  function buildPatch() {
    return {
      scanners: form.scanners,
      exclude: [...form.exclude],
      channels: form.channels.map((ch) => {
        const out = { type: ch.type };
        if (ch.ref !== undefined) out.ref = ch.ref;
        if (ch.webhook.trim() || ch.ref === undefined) out.webhook = ch.webhook.trim();
        if (ch.clearSecret) out.secret = null;
        else if (ch.secret.trim()) out.secret = ch.secret.trim();
        return out;
      }),
      ai: {
        enabled: form.ai.enabled, baseURL: form.ai.baseURL, model: form.ai.model, profile: form.ai.profile,
        ...(form.ai.apiKey.trim() ? { apiKey: form.ai.apiKey.trim() } : {}),
      },
      schedule: { time: form.time },
      notifyWhenUpToDate: form.notifyWhenUpToDate,
      gitRepos: form.gitRepos,
      githubReleases: form.githubReleases,
    };
  }

  async function busy(btn, fn) {
    const label = btn.textContent;
    document.querySelectorAll('footer button').forEach((b) => (b.disabled = true));
    btn.textContent = '处理中…';
    try { await fn(); } catch (err) { toast(err.message, true); }
    finally { btn.textContent = label; document.querySelectorAll('footer button').forEach((b) => (b.disabled = false)); }
  }

  async function save(installSchedule) {
    const r = await api('/api/config', { ...buildPatch(), installSchedule });
    S = r.state; initForm(S); dirty = false; $('#dirty').textContent = ''; render();
    toast(r.scheduleMsg ? '已保存。' + r.scheduleMsg : '已保存');
  }

  $('#btn-save').onclick = (e) => busy(e.target, () => save(false));
  $('#btn-save-schedule').onclick = (e) => busy(e.target, () => save(true));
  $('#btn-preview').onclick = (e) => busy(e.target, async () => {
    if (dirty) await save(false);
    const r = await api('/api/preview', {});
    $('#preview-wrap').style.display = '';
    $('#preview').textContent = r.markdown;
    $('#preview-wrap').scrollIntoView({ behavior: 'smooth' });
  });
  $('#btn-test').onclick = (e) => busy(e.target, async () => {
    if (dirty) await save(false);
    const r = await api('/api/test-notify', {});
    const failed = r.sent.filter((s) => !s.ok);
    if (failed.length === 0) { tested = true; render(); toast('已发送到 ' + r.sent.length + ' 个渠道，请到群里查看'); }
    else toast('发送失败：' + failed.map((s) => S.channelLabels[s.type] + '（' + s.error + '）').join('；'), true);
  });
  $('#done').onclick = async () => {
    if (dirty && !confirm('有未保存的修改，确定直接退出吗？')) return;
    await api('/api/shutdown', {}).catch(() => {});
    document.body.innerHTML = '<main><section><h2>配置页已关闭</h2><p class="desc">可以关闭这个标签页了。需要再改配置时运行 toolbell ui。</p></section></main>';
  };
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  api('/api/state').then((s) => { S = s; initForm(s); render(); })
    .catch((err) => { $('#app').innerHTML = '<section><h2>无法加载</h2><p class="desc">' + esc(err.message) + '</p></section>'; });
})();
</script>
</body>
</html>`;
