'use strict';

const vscode = require('vscode');
const path = require('path');
const { diffLines } = require('./diff');
const { PanelProvider } = require('./panel');

const BASE_SCHEME = 'claude-base';
const EMPTY_SCHEME = 'claude-empty';

function splitLines(text) {
  if (text === null || text === undefined || text === '') return [];
  return text.split(/\r?\n/);
}

function toFileUri(uri) {
  return uri.scheme === 'file' ? uri : uri.with({ scheme: 'file' });
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function activateUI(context, store) {
  const disposables = [];
  const push = (d) => { disposables.push(d); context.subscriptions.push(d); return d; };

  // ---------------------------------------------------------------- stats
  const statsCache = new Map(); // key -> { v, add, del }
  function statsFor(entry) {
    const key = entry.uri.toString();
    const cached = statsCache.get(key);
    if (cached && cached.v === entry.v) return cached;
    let add = 0;
    let del = 0;
    try {
      const a = splitLines(entry.base);
      const b = entry.cur === null || entry.cur === undefined ? [] : splitLines(entry.cur);
      for (const h of diffLines(a, b)) {
        add += h.bEnd - h.bStart;
        del += h.aEnd - h.aStart;
      }
    } catch (e) {
      console.error('[claudeReview] stats', e);
    }
    const s = { v: entry.v, add, del };
    statsCache.set(key, s);
    return s;
  }

  // ---------------------------------------------------------------- panel
  function buildState() {
    let entries = [];
    try { entries = store.pendingEntries(); } catch (e) { entries = []; }
    let add = 0;
    let del = 0;
    const files = entries.map((entry) => {
      const s = statsFor(entry);
      add += s.add;
      del += s.del;
      let dir = '';
      try {
        dir = path.posix.dirname(vscode.workspace.asRelativePath(entry.uri, false).replace(/\\/g, '/'));
        if (dir === '.' || dir === '/') dir = '';
      } catch (e) { dir = ''; }
      return {
        uri: entry.uri.toString(),
        fsPath: entry.uri.fsPath,
        name: path.posix.basename(entry.uri.path),
        dir,
        add: s.add,
        del: s.del,
        status: entry.cur === null ? 'D' : entry.base === null ? 'A' : 'M'
      };
    });
    return { files, add, del };
  }

  const panel = new PanelProvider(buildState);
  push(vscode.window.registerWebviewViewProvider('claudeReview.files', panel));
  const provider = { refresh() { panel.refresh(); } };

  // ------------------------------------------------------------ status bar
  const statusItem = push(vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100));
  statusItem.command = 'claudeReview.files.focus';
  statusItem.tooltip = 'Claude Review: edições pendentes';

  // ------------------------------------------------- content providers
  const requestedBase = new Set(); // file uri strings served via claude-base
  const baseEmitter = push(new vscode.EventEmitter());
  push(vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, {
    onDidChange: baseEmitter.event,
    provideTextDocumentContent(uri) {
      try {
        const fileUri = toFileUri(uri);
        requestedBase.add(fileUri.toString());
        const entry = store.get(fileUri);
        return (entry && entry.base) || '';
      } catch (e) {
        console.error('[claudeReview] base content', e);
        return '';
      }
    }
  }));
  push(vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, {
    provideTextDocumentContent() { return ''; }
  }));

  // ------------------------------------------------------------- helpers
  function resolveUri(arg) {
    try {
      if (arg && arg.entry && arg.entry.uri) return arg.entry.uri;
      if (arg instanceof vscode.Uri) {
        return arg.scheme === BASE_SCHEME || arg.scheme === EMPTY_SCHEME ? toFileUri(arg) : arg;
      }
      const ed = vscode.window.activeTextEditor;
      if (ed) {
        const u = ed.document.uri;
        return u.scheme === BASE_SCHEME || u.scheme === EMPTY_SCHEME ? toFileUri(u) : u;
      }
      // Diff aberto com foco em editor sem activeTextEditor: tenta a aba ativa.
      const tab = vscode.window.tabGroups.activeTabGroup && vscode.window.tabGroups.activeTabGroup.activeTab;
      if (tab && tab.input instanceof vscode.TabInputTextDiff) return toFileUri(tab.input.modified);
    } catch (e) {
      console.error('[claudeReview] resolveUri', e);
    }
    return undefined;
  }

  function diffModifiedUris() {
    const set = new Set();
    try {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputTextDiff) set.add(tab.input.modified.toString());
        }
      }
    } catch (e) { /* ignore */ }
    return set;
  }

  // ----------------------------------------------------------- CodeLens
  const lensEmitter = push(new vscode.EventEmitter());
  push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
    onDidChangeCodeLenses: lensEmitter.event,
    provideCodeLenses(doc) {
      try {
        if (!store.isPending(doc.uri)) return [];
        const res = store.hunksFor(doc);
        if (!res) return [];
        const lenses = [];
        const top = new vscode.Range(0, 0, 0, 0);
        const n = res.hunks.length;
        lenses.push(new vscode.CodeLens(top, { title: `$(diff) ${n} ${plural(n, 'alteração', 'alterações')}`, command: '' }));
        lenses.push(new vscode.CodeLens(top, { title: 'Manter arquivo', command: 'claudeReview.keepFile', arguments: [doc.uri] }));
        lenses.push(new vscode.CodeLens(top, { title: 'Desfazer arquivo', command: 'claudeReview.undoFile', arguments: [doc.uri] }));
        lenses.push(new vscode.CodeLens(top, { title: 'Próxima', command: 'claudeReview.nextChange' }));
        const last = Math.max(0, doc.lineCount - 1);
        for (const h of res.hunks) {
          const line = Math.min(h.bStart, last);
          const r = new vscode.Range(line, 0, line, 0);
          lenses.push(new vscode.CodeLens(r, { title: 'Manter', command: 'claudeReview.keepHunk', arguments: [doc.uri, h] }));
          lenses.push(new vscode.CodeLens(r, { title: 'Desfazer', command: 'claudeReview.undoHunk', arguments: [doc.uri, h] }));
        }
        return lenses;
      } catch (e) {
        console.error('[claudeReview] codelens', e);
        return [];
      }
    }
  }));

  // --------------------------------------------------------- decorations
  const addedType = push(vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorGutter.addedBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left
  }));
  const removedType = push(vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderStyle: 'solid none none none',
    borderWidth: '1px 0 0 0',
    borderColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left
  }));

  const ghostType = push(vscode.window.createTextEditorDecorationType({}));

  function hoverFor(res, h, languageId) {
    if (h.aEnd <= h.aStart) return undefined;
    const md = new vscode.MarkdownString();
    md.appendMarkdown('**Original**');
    md.appendCodeblock(res.baseLines.slice(h.aStart, h.aEnd).join('\n'), languageId);
    return md;
  }

  // Texto original (removido) em vermelho ao fim da linha; limitação: o VS Code não deixa
  // inserir linhas inteiras no editor, então mostramos a primeira linha removida + contagem.
  function ghostFor(res, h) {
    if (h.aEnd <= h.aStart) return undefined;
    const first = res.baseLines[h.aStart].trim().slice(0, 90) || '(linha vazia)';
    const more = h.aEnd - h.aStart > 1 ? ` (+${h.aEnd - h.aStart - 1} linhas)` : '';
    return {
      after: {
        contentText: `   − ${first}${more}`,
        color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
        fontStyle: 'italic'
      }
    };
  }

  function decorateEditor(editor, skipSet) {
    try {
      const doc = editor.document;
      let added = [];
      let removed = [];
      const ghosts = [];
      if (doc.uri.scheme === 'file' && !skipSet.has(doc.uri.toString()) && store.isPending(doc.uri)) {
        const res = store.hunksFor(doc);
        if (res) {
          const last = Math.max(0, doc.lineCount - 1);
          for (const h of res.hunks) {
            const hover = hoverFor(res, h, doc.languageId);
            if (h.bEnd > h.bStart) {
              const s = Math.min(h.bStart, last);
              const e = Math.min(h.bEnd - 1, last);
              added.push({ range: new vscode.Range(s, 0, e, 0), hoverMessage: hover });
              const ghost = ghostFor(res, h);
              if (ghost) {
                const endLine = doc.lineAt(s).range.end;
                ghosts.push({ range: new vscode.Range(s, endLine.character, s, endLine.character), renderOptions: ghost });
              }
            } else {
              const line = Math.min(h.bStart, last);
              removed.push({ range: new vscode.Range(line, 0, line, 0), hoverMessage: hover });
              const ghost = ghostFor(res, h);
              if (ghost) {
                const endLine = doc.lineAt(line).range.end;
                ghosts.push({ range: new vscode.Range(line, endLine.character, line, endLine.character), renderOptions: ghost });
              }
            }
          }
        }
      }
      editor.setDecorations(addedType, added);
      editor.setDecorations(removedType, removed);
      editor.setDecorations(ghostType, ghosts);
    } catch (e) {
      console.error('[claudeReview] decorate', e);
    }
  }

  function decorateAll() {
    const skip = diffModifiedUris();
    for (const ed of vscode.window.visibleTextEditors) decorateEditor(ed, skip);
  }

  let decoTimer;
  function scheduleDecorate() {
    clearTimeout(decoTimer);
    decoTimer = setTimeout(decorateAll, 100);
  }
  push({ dispose() { clearTimeout(decoTimer); } });

  // ------------------------------------------------------- context keys
  function updateContextKeys() {
    try {
      const ed = vscode.window.activeTextEditor;
      let activePending = false;
      if (ed && ed.document.uri.scheme === 'file') activePending = store.isPending(ed.document.uri);
      vscode.commands.executeCommand('setContext', 'claudeReview.activeFilePending', activePending);
      vscode.commands.executeCommand('setContext', 'claudeReview.hasPending', store.pendingEntries().length > 0);
    } catch (e) {
      console.error('[claudeReview] context keys', e);
    }
  }

  // --------------------------------------------------------- refresh all
  let prevCount = 0;
  try { prevCount = store.pendingEntries().length; } catch (e) { prevCount = 0; }

  function refreshSummary() {
    let entries = [];
    try { entries = store.pendingEntries(); } catch (e) { entries = []; }
    const n = entries.length;
    statusItem.text = `$(diff) ${n} ${plural(n, 'edição', 'edições')}`;
    if (n > 0) statusItem.show(); else statusItem.hide();
    panel.setBadge(n);
    return entries;
  }

  function onStoreChange(uri) {
    try {
      const entries = refreshSummary();
      provider.refresh();
      // Invalida conteúdo base.
      if (uri) {
        baseEmitter.fire(uri.with({ scheme: BASE_SCHEME }));
      } else {
        for (const k of requestedBase) baseEmitter.fire(vscode.Uri.parse(k).with({ scheme: BASE_SCHEME }));
        const live = new Set(entries.map((e) => e.uri.toString()));
        for (const k of statsCache.keys()) if (!live.has(k)) statsCache.delete(k);
      }
      lensEmitter.fire();
      updateContextKeys();
      scheduleDecorate();

      const n = entries.length;
      if (prevCount === 0 && n >= 1
        && vscode.workspace.getConfiguration('claudeReview').get('openDiffOnFirstChange', false)) {
        vscode.commands.executeCommand('claudeReview.openDiff', entries[0].uri);
      }
      prevCount = n;
    } catch (e) {
      console.error('[claudeReview] onStoreChange', e);
    }
  }

  push(store.onDidChange(onStoreChange));
  push(vscode.window.onDidChangeActiveTextEditor(() => { updateContextKeys(); scheduleDecorate(); }));
  push(vscode.window.onDidChangeVisibleTextEditors(scheduleDecorate));
  push(vscode.window.tabGroups.onDidChangeTabs(scheduleDecorate));
  push(vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.scheme === 'file' && store.isPending(e.document.uri)) { scheduleDecorate(); lensEmitter.fire(); }
  }));

  // ------------------------------------------------------------ commands
  function register(id, fn) {
    push(vscode.commands.registerCommand(id, async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        console.error('[claudeReview] ' + id, e);
        vscode.window.showErrorMessage(`Claude Review: ${e && e.message ? e.message : e}`);
      }
    }));
  }

  async function openDiff(arg) {
    const uri = resolveUri(arg);
    if (!uri) return;
    const entry = store.get(uri);
    if (!entry) {
      vscode.window.showInformationMessage('Claude Review: este arquivo não tem edições pendentes.');
      return;
    }
    const left = uri.with({ scheme: BASE_SCHEME });
    const right = entry.cur === null ? uri.with({ scheme: EMPTY_SCHEME }) : uri;
    const title = `${path.posix.basename(uri.path)} (edições do Claude)`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  register('claudeReview.openDiff', openDiff);

  register('claudeReview.keepFile', async (arg) => {
    const uri = resolveUri(arg);
    if (uri) await store.keepFile(uri);
  });
  register('claudeReview.undoFile', async (arg) => {
    const uri = resolveUri(arg);
    if (uri) await store.undoFile(uri);
  });
  register('claudeReview.keepAll', async () => {
    if (store.pendingEntries().length === 0) return;
    await store.keepAll();
  });
  register('claudeReview.undoAll', async () => {
    const n = store.pendingEntries().length;
    if (n === 0) return;
    const ok = await vscode.window.showWarningMessage(
      `Desfazer ${n === 1 ? 'a edição pendente' : `todas as ${n} edições pendentes`}?`,
      { modal: true, detail: 'Os arquivos serão restaurados ao estado aceito anteriormente.' },
      'Desfazer tudo'
    );
    if (ok !== 'Desfazer tudo') return;
    await store.undoAll();
  });
  register('claudeReview.rescan', async () => { await store.rescan(); });

  register('claudeReview.keepHunk', async (uri, hunk) => {
    const u = resolveUri(uri);
    if (u && hunk) await store.keepHunk(u, hunk);
  });
  register('claudeReview.undoHunk', async (uri, hunk) => {
    const u = resolveUri(uri);
    if (u && hunk) await store.undoHunk(u, hunk);
  });

  async function revealHunk(entry, pick) {
    const doc = await vscode.workspace.openTextDocument(entry.uri);
    const res = store.hunksFor(doc);
    if (!res || res.hunks.length === 0) return false;
    const h = pick(res.hunks);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const line = Math.min(h.bStart, Math.max(0, doc.lineCount - 1));
    const range = new vscode.Range(line, 0, line, 0);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return true;
  }

  async function navigate(forward) {
    const files = store.pendingEntries().filter((e) => e.cur !== null);
    if (files.length === 0) return;
    const ed = vscode.window.activeTextEditor;
    let curIdx = -1;
    if (ed && ed.document.uri.scheme === 'file') {
      const key = ed.document.uri.toString();
      curIdx = files.findIndex((e) => e.uri.toString() === key);
    }
    if (curIdx >= 0) {
      const res = store.hunksFor(ed.document);
      if (res && res.hunks.length) {
        const cursor = ed.selection.active.line;
        const next = forward
          ? res.hunks.find((h) => h.bStart > cursor)
          : [...res.hunks].reverse().find((h) => h.bStart < cursor);
        if (next) {
          const line = Math.min(next.bStart, Math.max(0, ed.document.lineCount - 1));
          const r = new vscode.Range(line, 0, line, 0);
          ed.selection = new vscode.Selection(r.start, r.start);
          ed.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          return;
        }
      }
    }
    // Próximo/anterior arquivo (com wrap); o arquivo atual por último.
    const n = files.length;
    const order = [];
    if (curIdx < 0) {
      for (let i = 0; i < n; i++) order.push(files[forward ? i : n - 1 - i]);
    } else {
      for (let i = 1; i <= n; i++) {
        order.push(files[(curIdx + (forward ? i : -i) + n * 2) % n]);
      }
    }
    for (const entry of order) {
      try {
        const ok = await revealHunk(entry, (hunks) => (forward ? hunks[0] : hunks[hunks.length - 1]));
        if (ok) return;
      } catch (e) {
        console.error('[claudeReview] navigate', e);
      }
    }
  }

  register('claudeReview.nextChange', () => navigate(true));
  register('claudeReview.prevChange', () => navigate(false));

  // ---------------------------------------------------------------- init
  refreshSummary();
  provider.refresh();
  updateContextKeys();
  scheduleDecorate();

  return { dispose() { for (const d of disposables.splice(0)) { try { d.dispose(); } catch (e) { /* ignore */ } } } };
}

module.exports = { activateUI };
