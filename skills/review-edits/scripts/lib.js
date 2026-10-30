'use strict';
// Biblioteca compartilhada: armazenamento de linhas de base, cálculo de diffs, keep/undo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { diffLines } = require('./diff');

const MAX_BYTES = 1024 * 1024;

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

function storeRoot() {
  return process.env.CLAUDE_REVIEW_DIR || path.join(os.homedir(), '.claude-review');
}
function projDir(cwd) { return path.join(storeRoot(), sha1(path.resolve(cwd))); }

function loadIndex(cwd) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(projDir(cwd), 'index.json'), 'utf8'));
    if (j && typeof j.files === 'object' && j.files) return j;
  } catch (e) { /* ignore */ }
  return { cwd: path.resolve(cwd), files: {} };
}
function saveIndex(cwd, idx) {
  const dir = projDir(cwd);
  fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true });
  const f = path.join(dir, 'index.json');
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 1));
  fs.renameSync(tmp, f);
}
function blobPath(cwd, abs) { return path.join(projDir(cwd), 'blobs', sha1(abs)); }

/** Lê arquivo de texto. Retorna {text} | {missing:true} | {skip:true} (binário/grande). */
function readText(abs) {
  let st;
  try { st = fs.statSync(abs); } catch (e) { return { missing: true }; }
  if (!st.isFile()) return { skip: true };
  if (st.size > MAX_BYTES) return { skip: true };
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return { skip: true };
  return { text: buf.toString('utf8') };
}

const splitLines = (t) => String(t).split(/\r?\n/);
const eolOf = (t) => (String(t).includes('\r\n') ? '\r\n' : '\n');

// ---------- cores ----------
function useColor() {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return !!process.stdout.isTTY;
}
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[90m', c: '\x1b[36m', b: '\x1b[1m', x: '\x1b[0m' };
function paint(color, s, on) { return on ? C[color] + s + C.x : s; }
function counts(add, del, on) {
  return `${paint(add ? 'g' : 'd', '+' + add, on)} ${paint(del ? 'r' : 'd', '−' + del, on)}`;
}
function summary(entries, on) {
  const add = entries.reduce((s, e) => s + e.add, 0);
  const del = entries.reduce((s, e) => s + e.del, 0);
  const n = entries.length;
  return `${n} ${n === 1 ? 'arquivo alterado' : 'arquivos alterados'} ${counts(add, del, on)}`;
}

// ---------- cálculo ----------
/** Lista os arquivos cujo conteúdo atual difere da linha de base. */
function compute(cwd) {
  cwd = path.resolve(cwd);
  const idx = loadIndex(cwd);
  const out = [];
  let dirty = false;
  for (const abs of Object.keys(idx.files).sort()) {
    const meta = idx.files[abs];
    let baseText = '';
    if (meta.existed) {
      try { baseText = fs.readFileSync(blobPath(cwd, abs), 'utf8'); } catch (e) { continue; }
    }
    const r = readText(abs);
    if (r.skip) continue;
    if (r.missing && !meta.existed) { delete idx.files[abs]; dirty = true; continue; }
    const curText = r.missing ? null : r.text;
    const baseLines = splitLines(baseText);
    const curLines = splitLines(curText === null ? '' : curText);
    const hunks = diffLines(baseLines, curLines);
    if (!hunks.length && curText === baseText) continue;
    let add = 0;
    let del = 0;
    for (const h of hunks) { add += h.bEnd - h.bStart; del += h.aEnd - h.aStart; }
    out.push({
      abs,
      rel: path.relative(cwd, abs).split(path.sep).join('/'),
      status: curText === null ? 'D' : (meta.existed ? 'M' : 'A'),
      existed: !!meta.existed,
      baseText, curText, baseLines, curLines, hunks, add, del,
    });
  }
  if (dirty) { try { saveIndex(cwd, idx); } catch (e) { /* ignore */ } }
  out.forEach((e, i) => { e.n = i + 1; });
  return out;
}

/** Resolve "all", número (1..N) ou caminho. Retorna lista de entradas ou lança Error. */
function select(entries, sel, cwd) {
  if (sel === 'all') return entries;
  if (/^\d+$/.test(sel)) {
    const e = entries[Number(sel) - 1];
    if (!e) throw new Error(`Não há arquivo nº ${sel}.`);
    return [e];
  }
  const norm = String(sel).replace(/\\/g, '/');
  const abs = path.resolve(cwd, sel);
  let m = entries.filter((e) => e.abs === abs || e.rel === norm);
  if (!m.length) m = entries.filter((e) => e.rel.endsWith('/' + norm) || path.basename(e.rel) === norm);
  if (!m.length) throw new Error(`Nenhum arquivo alterado corresponde a "${sel}".`);
  if (m.length > 1) throw new Error(`"${sel}" é ambíguo: ${m.map((e) => e.rel).join(', ')}`);
  return m;
}

// ---------- keep / undo ----------
function keepFile(cwd, e) {
  cwd = path.resolve(cwd);
  const idx = loadIndex(cwd);
  if (e.curText === null) {
    delete idx.files[e.abs];
    try { fs.rmSync(blobPath(cwd, e.abs), { force: true }); } catch (x) { /* ignore */ }
  } else {
    fs.mkdirSync(path.join(projDir(cwd), 'blobs'), { recursive: true });
    fs.writeFileSync(blobPath(cwd, e.abs), e.curText);
    idx.files[e.abs] = { existed: true, ts: Date.now() };
  }
  saveIndex(cwd, idx);
}

function undoFile(cwd, e) {
  cwd = path.resolve(cwd);
  if (!e.existed) {
    fs.rmSync(e.abs, { force: true });
    const idx = loadIndex(cwd);
    delete idx.files[e.abs];
    saveIndex(cwd, idx);
    return;
  }
  fs.mkdirSync(path.dirname(e.abs), { recursive: true });
  fs.writeFileSync(e.abs, e.baseText);
}

function getHunk(e, n) {
  const h = e.hunks[n - 1];
  if (!h) throw new Error(`${e.rel} não tem o trecho #${n} (há ${e.hunks.length}).`);
  return h;
}

function keepHunk(cwd, e, n) {
  cwd = path.resolve(cwd);
  const h = getHunk(e, n);
  const eol = e.baseText.includes('\n') ? eolOf(e.baseText) : eolOf(e.curText || '');
  const lines = e.baseLines.slice(0, h.aStart).concat(e.curLines.slice(h.bStart, h.bEnd), e.baseLines.slice(h.aEnd));
  const idx = loadIndex(cwd);
  fs.mkdirSync(path.join(projDir(cwd), 'blobs'), { recursive: true });
  fs.writeFileSync(blobPath(cwd, e.abs), lines.join(eol));
  idx.files[e.abs] = { existed: true, ts: Date.now() };
  saveIndex(cwd, idx);
}

function undoHunk(cwd, e, n) {
  const h = getHunk(e, n);
  if (e.curText === null) return undoFile(cwd, e); // arquivo apagado: restaura o arquivo
  const eol = eolOf(e.curText);
  const lines = e.curLines.slice(0, h.bStart).concat(e.baseLines.slice(h.aStart, h.aEnd), e.curLines.slice(h.bEnd));
  fs.writeFileSync(e.abs, lines.join(eol));
}

// ---------- renderização de diff ----------
/** Retorna [{n, header, lines:[{t:' '|'+'|'-', s}]}] com contexto recortado entre trechos vizinhos. */
function renderHunks(e, ctx) {
  const res = [];
  const hs = e.hunks;
  let printedUpTo = 0;
  hs.forEach((h, i) => {
    const lines = [];
    const from = Math.max(h.aStart - ctx, printedUpTo);
    for (let k = from; k < h.aStart; k++) lines.push({ t: ' ', s: e.baseLines[k] });
    for (let k = h.aStart; k < h.aEnd; k++) lines.push({ t: '-', s: e.baseLines[k] });
    for (let k = h.bStart; k < h.bEnd; k++) lines.push({ t: '+', s: e.curLines[k] });
    const nextA = i + 1 < hs.length ? hs[i + 1].aStart : e.baseLines.length;
    const to = Math.min(h.aEnd + ctx, nextA, e.baseLines.length);
    for (let k = h.aEnd; k < to; k++) lines.push({ t: ' ', s: e.baseLines[k] });
    printedUpTo = Math.max(h.aEnd, to);
    res.push({
      n: i + 1,
      header: `#${i + 1} @@ -${h.aStart + 1},${h.aEnd - h.aStart} +${h.bStart + 1},${h.bEnd - h.bStart} @@`,
      lines,
    });
  });
  return res;
}

module.exports = {
  sha1, storeRoot, projDir, loadIndex, saveIndex, blobPath, readText, splitLines, eolOf,
  useColor, paint, counts, summary, compute, select, keepFile, undoFile, keepHunk, undoHunk,
  renderHunks, MAX_BYTES,
};
