#!/usr/bin/env node
'use strict';
// Revisão interativa das edições do Claude (rode num segundo terminal).
//   node tui.js [--cwd pasta]
// Lista: ↑/↓ navega, Enter/d abre o diff, k mantém arquivo, u desfaz arquivo (y/n),
//        a mantém tudo, x desfaz tudo (y/n), r recarrega, q sai.
// Diff:  ↑/↓/PgUp/PgDn rola, n/p próximo/anterior trecho, k/u mantém/desfaz o trecho, q volta.
const path = require('path');
const lib = require('./lib');

const argv = process.argv.slice(2);
const ci = argv.indexOf('--cwd');
const cwd = path.resolve(ci >= 0 && argv[ci + 1] ? argv[ci + 1] : process.cwd());

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  const entries = lib.compute(cwd);
  if (!entries.length) console.log('Nenhuma alteração pendente.');
  else {
    console.log(lib.summary(entries, false));
    for (const e of entries) console.log(`${e.n}. ${e.status} ${e.rel}  ${lib.counts(e.add, e.del, false)}`);
  }
  process.exit(0);
}

const P = (c, s) => lib.paint(c, s, true);
let entries = lib.compute(cwd);
let mode = 'list';
let sel = 0;
let top = 0; // topo da rolagem (lista ou diff)
let curPath = null; // arquivo aberto no diff
let confirm = null; // {text, fn}
let msg = '';
let diffLinesCache = { rows: [], starts: [] };

const rows = () => process.stdout.rows || 24;
const cols = () => process.stdout.columns || 80;
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s);
const header = () => P('b', `${entries.length} ${entries.length === 1 ? 'arquivo alterado' : 'arquivos alterados'}`) + ' ' + lib.counts(
  entries.reduce((s, e) => s + e.add, 0), entries.reduce((s, e) => s + e.del, 0), true);

function buildDiff(e) {
  const rs = [];
  const starts = [];
  if (!e.hunks.length) rs.push(P('d', '(somente a quebra de linha (EOL) mudou)'));
  for (const h of lib.renderHunks(e, 3)) {
    starts.push(rs.length);
    rs.push(P('c', h.header));
    for (const l of h.lines) {
      const t = clip(`${l.t}${l.s}`, cols() - 1);
      rs.push(l.t === '+' ? P('g', t) : l.t === '-' ? P('r', t) : ` ${t.slice(1)}`);
    }
  }
  return { rows: rs, starts };
}

function curEntry() { return entries.find((e) => e.abs === curPath); }
function curHunkIdx() {
  let k = 0;
  diffLinesCache.starts.forEach((s, i) => { if (s <= top) k = i; });
  return k;
}

function draw() {
  const R = rows();
  const body = [];
  if (mode === 'list') {
    body.push(entries.length ? header() : P('d', 'Nenhuma alteração pendente.'));
    body.push('');
    const view = R - 5;
    if (sel < top) top = sel;
    if (sel >= top + view) top = sel - view + 1;
    entries.slice(top, top + view).forEach((e, i) => {
      const idx = top + i;
      const st = P(e.status === 'A' ? 'g' : e.status === 'D' ? 'r' : 'c', e.status);
      const line = `${idx === sel ? '>' : ' '} ${st} ${clip(e.rel, cols() - 24)}  ${lib.counts(e.add, e.del, true)}`;
      body.push(idx === sel ? P('b', line) : line);
    });
  } else {
    const e = curEntry();
    body.push(P('b', `${e ? e.rel : ''}`) + '  ' + (e ? lib.counts(e.add, e.del, true) : ''));
    const view = R - 4;
    const max = Math.max(0, diffLinesCache.rows.length - view);
    if (top > max) top = max;
    if (top < 0) top = 0;
    body.push(...diffLinesCache.rows.slice(top, top + view));
  }
  while (body.length < R - 2) body.push('');
  const help = mode === 'list'
    ? '↑/↓ mover  Enter/d diff  k manter  u desfazer  a manter tudo  x desfazer tudo  r recarregar  q sair'
    : '↑/↓ PgUp/PgDn rolar  n/p trecho  k manter trecho  u desfazer trecho  q voltar';
  const last = confirm ? P('b', confirm.text + ' (y/n)') : (msg ? P('d', msg) : '');
  process.stdout.write('\x1b[H\x1b[2J' + body.slice(0, R - 2).join('\n') + '\n' + P('d', clip(help, cols() - 1)) + '\n' + last);
}

function reload() {
  entries = lib.compute(cwd);
  if (sel >= entries.length) sel = Math.max(0, entries.length - 1);
  if (mode === 'diff') {
    const e = curEntry();
    if (!e) { mode = 'list'; top = 0; } else diffLinesCache = buildDiff(e);
  }
}

function safe(fn) {
  try { fn(); } catch (e) { msg = 'Erro: ' + (e && e.message ? e.message : e); }
  reload();
}

function openDiff() {
  const e = entries[sel];
  if (!e) return;
  curPath = e.abs;
  mode = 'diff';
  top = 0;
  diffLinesCache = buildDiff(e);
}

function onKey(k) {
  msg = '';
  if (confirm) {
    const c = confirm;
    confirm = null;
    if (k === 'y' || k === 'Y') safe(c.fn);
    return draw();
  }
  if (k === '\x03') return quit();
  if (mode === 'list') {
    const e = entries[sel];
    if (k === 'q') return quit();
    else if (k === '\x1b[A') sel = Math.max(0, sel - 1);
    else if (k === '\x1b[B') sel = Math.min(entries.length - 1, sel + 1);
    else if (k === '\r' || k === 'd') openDiff();
    else if (k === 'k' && e) safe(() => lib.keepFile(cwd, e));
    else if (k === 'u' && e) confirm = { text: `Desfazer ${e.rel}?`, fn: () => lib.undoFile(cwd, e) };
    else if (k === 'a' && entries.length) safe(() => entries.forEach((x) => lib.keepFile(cwd, x)));
    else if (k === 'x' && entries.length) {
      const all = entries.slice();
      confirm = { text: `Desfazer TODOS os ${all.length} arquivos?`, fn: () => all.forEach((x) => lib.undoFile(cwd, x)) };
    } else if (k === 'r') reload();
  } else {
    const e = curEntry();
    const view = rows() - 4;
    const starts = diffLinesCache.starts;
    if (k === 'q' || k === '\x1b') { mode = 'list'; top = 0; reload(); }
    else if (k === '\x1b[A') top = Math.max(0, top - 1);
    else if (k === '\x1b[B') top += 1;
    else if (k === '\x1b[5~') top = Math.max(0, top - view);
    else if (k === '\x1b[6~') top += view;
    else if (k === 'n') { const nx = starts.find((s) => s > top); if (nx !== undefined) top = nx; }
    else if (k === 'p') { const pv = starts.filter((s) => s < top).pop(); if (pv !== undefined) top = pv; }
    else if ((k === 'k' || k === 'u') && e && e.hunks.length) {
      const n = curHunkIdx() + 1;
      const rel = e.rel;
      safe(() => (k === 'k' ? lib.keepHunk : lib.undoHunk)(cwd, e, n));
      msg = `${k === 'k' ? 'Mantido' : 'Desfeito'} o trecho #${n} de ${rel}.`;
      if (mode === 'diff') top = Math.min(top, Math.max(0, diffLinesCache.rows.length - 1));
    }
  }
  draw();
}

let timer = null;
function quit() {
  if (timer) clearInterval(timer);
  try { process.stdin.setRawMode(false); } catch (e) { /* ignore */ }
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  process.exit(0);
}

process.stdout.write('\x1b[?1049h\x1b[?25l');
process.on('exit', () => process.stdout.write('\x1b[?25h\x1b[?1049l'));
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.stdout.on('resize', draw);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  // separa sequências de escape coladas (ex.: PgDn repetido)
  const keys = chunk.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1b|[\s\S]/g) || [];
  keys.forEach(onKey);
});
timer = setInterval(() => { if (!confirm) { reload(); draw(); } }, 1000);
draw();
