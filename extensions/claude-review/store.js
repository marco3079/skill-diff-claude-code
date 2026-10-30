'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { diffLines } = require('./diff');

const STATE_KEY = 'claudeReview.pending';
const BATCH = 64;

function splitLines(text) {
  return text.split(/\r?\n/);
}

function sameHunk(a, b) {
  return a && b && a.aStart === b.aStart && a.aEnd === b.aEnd && a.bStart === b.bStart && a.bEnd === b.bEnd;
}

class Store {
  constructor(context) {
    this.context = context;
    this.map = new Map();
    this._emitter = new vscode.EventEmitter();
    this.onDidChange = this._emitter.event;
    this._watcher = null;
    this._timers = new Map(); // watcher debounce por uri
    this._fireTimer = null;
    this._fireUris = new Set();
    this._fireAll = false;
    this._persistTimer = null;
    this._hunkCache = new Map();
    this._disposed = false;
  }

  // ---------- config / helpers ----------

  _cfg() {
    const c = vscode.workspace.getConfiguration('claudeReview');
    return {
      excludeDirs: c.get('excludeDirs', ['node_modules', '.git', 'out', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', '.vscode-test', 'target', 'bin', 'obj']),
      maxFileSizeKB: c.get('maxFileSizeKB', 512),
      maxSnapshotFiles: c.get('maxSnapshotFiles', 20000),
    };
  }

  _eligible(uri) {
    try {
      if (!uri || uri.scheme !== 'file') return false;
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return false;
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
      const segs = rel.split(/[\\/]/);
      const ex = new Set(this._cfg().excludeDirs);
      for (let i = 0; i < segs.length - 1; i++) {
        if (ex.has(segs[i])) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // string = texto, null = não existe, undefined = ignorar (binário/grande/erro)
  async _readDisk(uri) {
    try {
      const st = await fs.promises.stat(uri.fsPath);
      if (!st.isFile()) return undefined;
      if (st.size > this._cfg().maxFileSizeKB * 1024) return undefined;
      const buf = await fs.promises.readFile(uri.fsPath);
      if (buf.includes(0)) return undefined;
      return buf.toString('utf8');
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
      return undefined;
    }
  }

  _gitShow(uri) {
    return new Promise((resolve) => {
      try {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) return resolve(null);
        const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
        execFile('git', ['show', 'HEAD:' + rel], { cwd: folder.uri.fsPath, maxBuffer: 16 * 1024 * 1024, timeout: 10000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
          if (err || typeof stdout !== 'string' || stdout.includes('\0')) return resolve(null);
          if (stdout.length > this._cfg().maxFileSizeKB * 1024) return resolve(null);
          resolve(stdout);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  _fire(uri) {
    if (this._disposed) return;
    if (uri) this._fireUris.add(uri.toString()); else this._fireAll = true;
    if (this._fireTimer) return;
    this._fireTimer = setTimeout(() => {
      this._fireTimer = null;
      const all = this._fireAll || this._fireUris.size !== 1;
      const only = this._fireUris.size === 1 ? [...this._fireUris][0] : null;
      this._fireAll = false;
      this._fireUris.clear();
      try {
        this._emitter.fire(all || !only ? undefined : vscode.Uri.parse(only));
      } catch (e) { /* ignore */ }
    }, 30);
  }

  _schedulePersist() {
    if (this._disposed) return;
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistNow();
    }, 500);
  }

  _persistNow() {
    try {
      const data = this.pendingEntries().map((e) => ({ uri: e.uri.toString(), base: e.base }));
      const p = this.context.workspaceState.update(STATE_KEY, data);
      if (p && p.then) p.then(undefined, () => {});
    } catch (e) { /* ignore */ }
  }

  _changed(uri) {
    this._schedulePersist();
    this._fire(uri);
  }

  // Aplica base/cur respeitando invariantes. Retorna true se algo mudou.
  _set(entry, base, cur) {
    // arquivo novo que foi apagado de novo: some da lista (checar ANTES de cur === base)
    if (base === null && cur === null) {
      entry.base = null;
      entry.cur = null;
      entry.v++;
      this.map.delete(entry.uri.toString());
      return true;
    }
    if (cur === base) cur = undefined;
    if (entry.base === base && entry.cur === cur) return false;
    entry.base = base;
    entry.cur = cur;
    entry.v++;
    return true;
  }

  // ---------- API pública de consulta ----------

  get(uri) {
    return this.map.get(uri.toString());
  }

  isPending(uri) {
    const e = this.get(uri);
    return !!e && e.cur !== undefined;
  }

  pendingEntries() {
    const out = [];
    for (const e of this.map.values()) if (e.cur !== undefined) out.push(e);
    out.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
    return out;
  }

  // ---------- init / watcher / scan ----------

  async init() {
    try {
      // restaura pendentes
      const saved = this.context.workspaceState.get(STATE_KEY, []);
      const restored = [];
      if (Array.isArray(saved)) {
        for (const s of saved) {
          try {
            if (!s || typeof s.uri !== 'string') continue;
            const uri = vscode.Uri.parse(s.uri);
            if (!this._eligible(uri)) continue;
            const base = typeof s.base === 'string' ? s.base : null;
            const entry = { uri, base, cur: undefined, v: 0 };
            this.map.set(uri.toString(), entry);
            restored.push(entry);
          } catch (e) { /* ignore */ }
        }
      }

      // watcher ANTES do scan
      try {
        this._watcher = vscode.workspace.createFileSystemWatcher('**/*');
        this._watcher.onDidCreate((u) => this._queue(u, 'create'));
        this._watcher.onDidChange((u) => this._queue(u, 'change'));
        this._watcher.onDidDelete((u) => this._queue(u, 'delete'));
      } catch (e) { /* ignore */ }

      // atualiza cur dos restaurados lendo o disco
      for (const entry of restored) {
        try {
          const text = await this._readDisk(entry.uri);
          if (text === undefined) continue;
          this._set(entry, entry.base, text);
        } catch (e) { /* ignore */ }
      }
      this._fire(undefined);

      await this._snapshot();
    } catch (e) { /* nunca derruba a extensão */ }
    this._changed(undefined);
  }

  async _snapshot() {
    try {
      const cfg = this._cfg();
      const dirs = cfg.excludeDirs.filter((d) => d && d.trim());
      const exclude = dirs.length ? `**/{${dirs.join(',')}}/**` : undefined;
      const files = await vscode.workspace.findFiles('**/*', exclude, cfg.maxSnapshotFiles);
      for (let i = 0; i < files.length; i += BATCH) {
        if (this._disposed) return;
        const batch = files.slice(i, i + BATCH);
        await Promise.all(batch.map(async (uri) => {
          try {
            if (!this._eligible(uri)) return;
            const key = uri.toString();
            if (this.map.has(key)) return;
            const text = await this._readDisk(uri);
            if (typeof text !== 'string') return;
            if (this.map.has(key)) return; // watcher pode ter criado no meio
            this.map.set(key, { uri, base: text, cur: undefined, v: 0 });
          } catch (e) { /* ignore */ }
        }));
      }
    } catch (e) { /* ignore */ }
  }

  _queue(uri, kind) {
    try {
      if (this._disposed || !this._eligible(uri)) return;
      const key = uri.toString();
      const prev = this._timers.get(key);
      if (prev) { clearTimeout(prev.t); if (prev.kind === 'create' && kind === 'change') kind = 'create'; }
      const t = setTimeout(() => {
        this._timers.delete(key);
        this._process(uri, kind).catch(() => {});
      }, 150);
      this._timers.set(key, { t, kind });
    } catch (e) { /* ignore */ }
  }

  async _process(uri, kind) {
    try {
      const text = await this._readDisk(uri);
      if (text === undefined) return;
      const key = uri.toString();
      let entry = this.map.get(key);
      if (entry) {
        if (this._set(entry, entry.base, text)) this._changed(uri);
        return;
      }
      if (text === null && kind !== 'delete') return;
      if (kind === 'create' && text !== null) {
        this.map.set(key, { uri, base: null, cur: text, v: 1 });
        this._changed(uri);
        return;
      }
      // change/delete sem entry: baseline via git
      const base = await this._gitShow(uri);
      if (base === null || base === undefined) return;
      entry = this.map.get(key);
      if (entry) {
        if (this._set(entry, entry.base, text)) this._changed(uri);
        return;
      }
      entry = { uri, base, cur: undefined, v: 0 };
      this.map.set(key, entry);
      if (text !== base) { entry.cur = text; entry.v++; }
      this._changed(uri);
    } catch (e) { /* ignore */ }
  }

  async _refresh(uri) {
    try {
      const entry = this.get(uri);
      if (!entry) return;
      const text = await this._readDisk(uri);
      if (text === undefined) return;
      if (this._set(entry, entry.base, text)) this._changed(uri);
    } catch (e) { /* ignore */ }
  }

  async rescan() {
    try {
      this.map.clear();
      this._hunkCache.clear();
      this._fire(undefined);
      await this._snapshot();
    } catch (e) { /* ignore */ }
    this._changed(undefined);
  }

  // ---------- keep / undo (arquivo) ----------

  _keepSync(entry) {
    if (entry.cur === undefined) return false;
    if (entry.cur === null) {
      this.map.delete(entry.uri.toString());
      entry.v++;
      return true;
    }
    return this._set(entry, entry.cur, undefined);
  }

  async keepFile(uri) {
    try {
      const entry = this.get(uri);
      if (!entry) return;
      if (this._keepSync(entry)) this._changed(uri);
    } catch (e) { /* ignore */ }
  }

  async _undoOne(entry) {
    const uri = entry.uri;
    try {
      if (entry.base === null) {
        try {
          await vscode.workspace.fs.delete(uri, { useTrash: true });
        } catch (e) {
          if (!(e && /FileNotFound|ENOENT/i.test(String(e.code || e.name || e.message)))) throw e;
        }
        this.map.delete(uri.toString());
        entry.v++;
        return;
      }
      const base = entry.base;
      const doc = entry.cur === null ? undefined : vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (doc) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), base);
        await vscode.workspace.applyEdit(edit);
        await doc.save();
      } else {
        await vscode.workspace.fs.createDirectory(uri.with({ path: path.posix.dirname(uri.path) }));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(base, 'utf8'));
      }
      const cur = this.map.get(uri.toString());
      if (cur) this._set(cur, base, undefined);
    } catch (e) {
      try { vscode.window.showErrorMessage('Claude Review: falha ao desfazer ' + path.basename(uri.fsPath) + ': ' + (e && e.message ? e.message : e)); } catch (e2) { /* ignore */ }
    }
  }

  async undoFile(uri) {
    try {
      const entry = this.get(uri);
      if (!entry || entry.cur === undefined) return;
      await this._undoOne(entry);
      this._changed(uri);
    } catch (e) { /* ignore */ }
  }

  async keepAll() {
    try {
      for (const entry of this.pendingEntries()) this._keepSync(entry);
    } catch (e) { /* ignore */ }
    this._changed(undefined);
  }

  async undoAll() {
    try {
      for (const entry of this.pendingEntries()) await this._undoOne(entry);
    } catch (e) { /* ignore */ }
    this._changed(undefined);
  }

  // ---------- hunks ----------

  hunksFor(doc) {
    try {
      const key = doc.uri.toString();
      const entry = this.map.get(key);
      if (!entry || entry.cur === undefined) return null;
      const c = this._hunkCache.get(key);
      if (c && c.dv === doc.version && c.ev === entry.v) return c.result;
      const baseLines = splitLines(entry.base === null || entry.base === undefined ? '' : entry.base);
      const curLines = splitLines(doc.getText());
      const hunks = diffLines(baseLines, curLines);
      const result = { hunks, baseLines, curLines };
      this._hunkCache.set(key, { dv: doc.version, ev: entry.v, result });
      return result;
    } catch (e) {
      return null;
    }
  }

  _findHunk(doc, hunk) {
    const r = this.hunksFor(doc);
    if (!r) return null;
    const h = r.hunks.find((x) => sameHunk(x, hunk));
    return h ? { r, h } : null;
  }

  async keepHunk(uri, hunk) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const found = this._findHunk(doc, hunk);
      if (!found) {
        vscode.window.showWarningMessage('Claude Review: o trecho mudou; atualize e tente novamente.');
        return;
      }
      const entry = this.get(uri);
      const { r, h } = found;
      const eol = entry.base && entry.base.includes('\r\n') ? '\r\n' : '\n';
      const lines = r.baseLines.slice(0, h.aStart).concat(r.curLines.slice(h.bStart, h.bEnd), r.baseLines.slice(h.aEnd));
      if (this._set(entry, lines.join(eol), entry.cur)) this._changed(uri);
    } catch (e) { /* ignore */ }
  }

  async undoHunk(uri, hunk) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const found = this._findHunk(doc, hunk);
      if (!found) {
        vscode.window.showWarningMessage('Claude Review: o trecho mudou; atualize e tente novamente.');
        return;
      }
      const { r, h } = found;
      const lines = r.baseLines.slice(h.aStart, h.aEnd);
      const edit = new vscode.WorkspaceEdit();
      this._replaceLines(edit, doc, h.bStart, h.bEnd, lines);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
      await this._refresh(uri);
      this._changed(uri);
    } catch (e) { /* ignore */ }
  }

  _replaceLines(edit, doc, bStart, bEnd, lines) {
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    if (bEnd < doc.lineCount) {
      edit.replace(doc.uri, new vscode.Range(bStart, 0, bEnd, 0), lines.map((l) => l + eol).join(''));
    } else if (bStart > 0) {
      const from = doc.lineAt(bStart - 1).range.end;
      const to = doc.lineAt(doc.lineCount - 1).range.end;
      edit.replace(doc.uri, new vscode.Range(from, to), lines.map((l) => eol + l).join(''));
    } else {
      const to = doc.lineAt(doc.lineCount - 1).range.end;
      edit.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), to), lines.join(eol));
    }
  }

  // ---------- ciclo de vida ----------

  dispose() {
    this._disposed = true;
    try {
      if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; this._persistNow(); }
      if (this._fireTimer) clearTimeout(this._fireTimer);
      for (const v of this._timers.values()) clearTimeout(v.t);
      this._timers.clear();
      if (this._watcher) this._watcher.dispose();
      this._emitter.dispose();
    } catch (e) { /* ignore */ }
  }
}

module.exports = { Store };
