#!/usr/bin/env node
'use strict';
// Hook PreToolUse: guarda a linha de base de um arquivo antes da primeira edição.
// Nunca falha nem bloqueia a ferramenta: qualquer erro => exit 0 silencioso.
const fs = require('fs');
const path = require('path');

function main() {
  const lib = require('./lib');
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { return; }
  const p = JSON.parse(raw);
  const cwd = path.resolve(p.cwd || process.cwd());
  const ti = p.tool_input || {};
  const target = ti.file_path || ti.notebook_path;
  if (!target || typeof target !== 'string') return;
  const abs = path.resolve(cwd, target);
  const rel = path.relative(cwd, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;

  const idx = lib.loadIndex(cwd);
  if (idx.files[abs]) return; // a baseline é o último estado aceito; só grava uma vez

  const r = lib.readText(abs);
  if (r.skip) return;
  if (r.missing) {
    idx.files[abs] = { existed: false, ts: Date.now() };
  } else {
    fs.mkdirSync(path.join(lib.projDir(cwd), 'blobs'), { recursive: true });
    fs.writeFileSync(lib.blobPath(cwd, abs), r.text);
    idx.files[abs] = { existed: true, ts: Date.now() };
  }
  lib.saveIndex(cwd, idx);
}

try { main(); } catch (e) { /* silencioso */ }
process.exit(0);
