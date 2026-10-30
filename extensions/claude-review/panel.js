'use strict';

const vscode = require('vscode');

// Painel em webview no formato do cartão de edições do Copilot Chat:
// "N arquivos alterados +A −D"  [Manter] [Desfazer]  + lista de arquivos com +N −M.
class PanelProvider {
  constructor(getState) {
    this.getState = getState;
    this.view = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    view.webview.html = html(view.webview.cspSource, nonce);
    view.webview.onDidReceiveMessage((m) => {
      try {
        if (!m) return;
        const uri = m.uri ? vscode.Uri.parse(m.uri) : undefined;
        switch (m.cmd) {
          case 'open': vscode.commands.executeCommand('claudeReview.openDiff', uri); break;
          case 'keep': vscode.commands.executeCommand('claudeReview.keepFile', uri); break;
          case 'undo': vscode.commands.executeCommand('claudeReview.undoFile', uri); break;
          case 'keepAll': vscode.commands.executeCommand('claudeReview.keepAll'); break;
          case 'undoAll': vscode.commands.executeCommand('claudeReview.undoAll'); break;
          case 'rescan': vscode.commands.executeCommand('claudeReview.rescan'); break;
          case 'ready': this.refresh(); break;
          default: break;
        }
      } catch (e) {
        console.error('[claudeReview] panel message', e);
      }
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
    this.refresh();
  }

  refresh() {
    try {
      if (this.view) this.view.webview.postMessage({ type: 'state', ...this.getState() });
    } catch (e) {
      console.error('[claudeReview] panel refresh', e);
    }
  }

  setBadge(n) {
    if (!this.view) return;
    this.view.badge = n > 0 ? { value: n, tooltip: `${n} edições pendentes` } : undefined;
  }
}

function html(csp, nonce) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { padding: 8px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  .empty { color: var(--vscode-descriptionForeground); padding: 8px 4px; line-height: 1.5; }
  .empty a { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .card { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-editorWidget-background, transparent); overflow: hidden; }
  .head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; user-select: none; }
  .head .chev { width: 14px; text-align: center; opacity: .8; transition: transform .1s; }
  .collapsed .chev { transform: rotate(-90deg); }
  .head .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .add { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
  .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
  .btns { display: flex; gap: 6px; }
  button { font: inherit; border-radius: 2px; padding: 2px 10px; cursor: pointer; border: 1px solid transparent; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .files { border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding: 2px 0; }
  .collapsed .files { display: none; }
  .row { display: flex; align-items: center; gap: 6px; padding: 2px 8px; cursor: pointer; min-height: 22px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .ico { flex: none; width: 16px; height: 16px; border-radius: 3px; font-size: 9px; font-weight: 700; line-height: 16px; text-align: center; color: #fff; }
  .name { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dir { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: .92em; }
  .stat { flex: none; font-variant-numeric: tabular-nums; }
  .rowbtns { display: none; flex: none; gap: 2px; }
  .row:hover .rowbtns { display: flex; }
  .row:hover .stat { display: none; }
  .rowbtns button { padding: 0 6px; background: transparent; color: var(--vscode-foreground); }
  .rowbtns button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .tag { font-size: .85em; color: var(--vscode-descriptionForeground); margin-left: 2px; }
</style></head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let collapsed = false;
  let state = { files: [], add: 0, del: 0 };
  const COLORS = { html: '#e44d26', htm: '#e44d26', js: '#cba900', mjs: '#cba900', ts: '#3178c6', tsx: '#3178c6', jsx: '#00a7c4', css: '#42a5f5', scss: '#cd6799', json: '#cbcb41', md: '#519aba', py: '#3776ab', cs: '#68217a', java: '#e76f00', php: '#777bb3', sql: '#e38c00', yml: '#cb171e', yaml: '#cb171e', xml: '#e37933', vue: '#41b883' };
  const LABEL = { md: 'M↓', html: '<>', htm: '<>', json: '{}', css: '#', scss: '#', yml: 'Y', yaml: 'Y', py: 'Py', cs: 'C#', java: 'J', php: 'P', sql: 'DB', xml: '</>', vue: 'V', ts: 'TS', tsx: 'TS', jsx: 'JS', js: 'JS', mjs: 'JS' };
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function render() {
    const n = state.files.length;
    if (!n) {
      root.innerHTML = '<div class="empty">Nenhuma edição pendente.<br>As alterações feitas em disco (Claude Code, etc.) aparecem aqui para você revisar.<br><a id="rescan">Reescanear workspace</a></div>';
      const r = document.getElementById('rescan'); if (r) r.onclick = () => vscode.postMessage({ cmd: 'rescan' });
      return;
    }
    const rows = state.files.map((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const color = COLORS[ext] || '#858585';
      const label = LABEL[ext] || ext.slice(0, 2).toUpperCase() || '·';
      const stat = f.status === 'D' ? '<span class="del">−' + f.del + '</span>' : f.status === 'A' ? '<span class="add">+' + f.add + '</span>' : '<span class="add">+' + f.add + '</span> <span class="del">−' + f.del + '</span>';
      const tag = f.status === 'A' ? '<span class="tag">novo</span>' : f.status === 'D' ? '<span class="tag">apagado</span>' : '';
      return '<div class="row" data-uri="' + esc(f.uri) + '" title="' + esc(f.fsPath) + '">' +
        '<span class="ico" style="background:' + color + '">' + esc(label) + '</span>' +
        '<span class="name">' + esc(f.name) + '</span>' + tag +
        '<span class="dir">' + esc(f.dir) + '</span>' +
        '<span class="stat">' + stat + '</span>' +
        '<span class="rowbtns"><button data-act="keep" title="Manter">✓</button><button data-act="undo" title="Desfazer">↺</button></span></div>';
    }).join('');
    root.innerHTML = '<div class="card' + (collapsed ? ' collapsed' : '') + '">' +
      '<div class="head" id="head"><span class="chev">▾</span>' +
      '<span class="title">' + n + (n === 1 ? ' arquivo alterado' : ' arquivos alterados') + ' <span class="add">+' + state.add + '</span> <span class="del">−' + state.del + '</span></span>' +
      '<span class="btns"><button class="primary" data-all="keepAll">Manter</button><button class="secondary" data-all="undoAll">Desfazer</button></span></div>' +
      '<div class="files">' + rows + '</div></div>';
  }
  root.addEventListener('click', (e) => {
    const all = e.target.closest('[data-all]');
    if (all) { e.stopPropagation(); vscode.postMessage({ cmd: all.dataset.all }); return; }
    const act = e.target.closest('[data-act]');
    const row = e.target.closest('.row');
    if (act && row) { e.stopPropagation(); vscode.postMessage({ cmd: act.dataset.act, uri: row.dataset.uri }); return; }
    if (row) { vscode.postMessage({ cmd: 'open', uri: row.dataset.uri }); return; }
    if (e.target.closest('#head')) { collapsed = !collapsed; render(); }
  });
  window.addEventListener('message', (e) => { if (e.data && e.data.type === 'state') { state = e.data; render(); } });
  render();
  vscode.postMessage({ cmd: 'ready' });
</script></body></html>`;
}

module.exports = { PanelProvider };
