#!/usr/bin/env node
'use strict';
// CLI de revisão das edições acumuladas pelo hook snapshot.js.
//
//   node review.js list                        arquivos alterados (M/A/D, +N −M)
//   node review.js diff <arquivo|nº> [--context 3]
//   node review.js keep <arquivo|nº|all> [--hunk N]   aceita (atualiza a linha de base)
//   node review.js undo <arquivo|nº|all> [--hunk N]   restaura a linha de base (destrutivo)
//   node review.js status                      uma linha (statusline)
//   node review.js json                        saída para máquina
//   opção global: --cwd <pasta do projeto>   (padrão: pasta atual)
const path = require('path');
const lib = require('./lib');

const argv = process.argv.slice(2);
function takeOpt(name) {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v === undefined ? 1 : 2);
  return v;
}
const cwd = path.resolve(takeOpt('--cwd') || process.cwd());
const hunkOpt = takeOpt('--hunk');
const ctxOpt = takeOpt('--context');
const cmd = argv.shift();
const color = lib.useColor();
const out = (s) => process.stdout.write(s + '\n');
const fail = (m) => { process.stderr.write(m + '\n'); process.exit(1); };

function cmdList(entries) {
  if (!entries.length) return out('Nenhuma alteração pendente.');
  out(lib.summary(entries, color));
  const w = String(entries.length).length;
  for (const e of entries) {
    out(`${String(e.n).padStart(w)}. ${lib.paint(e.status === 'A' ? 'g' : e.status === 'D' ? 'r' : 'c', e.status, color)} ${e.rel}  ${lib.counts(e.add, e.del, color)}`);
  }
}

function cmdDiff(entries, sel) {
  if (!sel) fail('Uso: review.js diff <arquivo|nº> [--context 3]');
  const ctx = ctxOpt === undefined ? 3 : Math.max(0, parseInt(ctxOpt, 10) || 0);
  for (const e of lib.select(entries, sel, cwd)) {
    out(lib.paint('b', `${e.rel}  (${e.status})  ${lib.counts(e.add, e.del, false)}`, color));
    if (!e.hunks.length) out(lib.paint('d', '(somente a quebra de linha (EOL) mudou)', color));
    for (const h of lib.renderHunks(e, ctx)) {
      out(lib.paint('c', h.header, color));
      for (const l of h.lines) {
        const txt = `${l.t}${l.s}`;
        out(l.t === '+' ? lib.paint('g', txt, color) : l.t === '-' ? lib.paint('r', txt, color) : ` ${l.s}`);
      }
    }
  }
}

function cmdAct(entries, sel, kind) {
  if (!sel) fail(`Uso: review.js ${kind} <arquivo|nº|all> [--hunk N]`);
  const chosen = lib.select(entries, sel, cwd);
  const verbo = kind === 'keep' ? 'Mantido' : 'Desfeito';
  if (hunkOpt !== undefined) {
    if (chosen.length !== 1 || sel === 'all') fail('--hunk exige um único arquivo.');
    const n = parseInt(hunkOpt, 10);
    const e = chosen[0];
    (kind === 'keep' ? lib.keepHunk : lib.undoHunk)(cwd, e, n);
    return out(`${verbo} o trecho #${n} de ${e.rel}.`);
  }
  if (!chosen.length) return out('Nenhuma alteração pendente.');
  for (const e of chosen) {
    (kind === 'keep' ? lib.keepFile : lib.undoFile)(cwd, e);
    out(`${verbo}: ${e.rel}`);
  }
}

try {
  const entries = lib.compute(cwd);
  switch (cmd) {
    case 'list': cmdList(entries); break;
    case 'diff': cmdDiff(entries, argv[0]); break;
    case 'keep': cmdAct(entries, argv[0], 'keep'); break;
    case 'undo': cmdAct(entries, argv[0], 'undo'); break;
    case 'status':
      out(entries.length ? lib.summary(entries, false) : 'nenhuma alteração pendente');
      break;
    case 'json': {
      const files = entries.map((e) => ({
        n: e.n, path: e.rel, status: e.status, add: e.add, del: e.del,
        hunks: e.hunks.map((h, i) => ({ n: i + 1, ...h })),
      }));
      out(JSON.stringify({
        cwd, count: files.length,
        add: files.reduce((s, f) => s + f.add, 0), del: files.reduce((s, f) => s + f.del, 0), files,
      }, null, 2));
      break;
    }
    default:
      out('Uso: review.js <list|diff|keep|undo|status|json> [args] [--cwd pasta]');
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  fail(`Erro: ${e && e.message ? e.message : e}`);
}
