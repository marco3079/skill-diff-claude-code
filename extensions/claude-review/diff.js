'use strict';

const MAX_D = 3000;

/**
 * Diff de linhas (Myers) entre a (baseline) e b (atual).
 * Retorna hunks ordenados {aStart, aEnd, bStart, bEnd} (fim exclusivo).
 */
function diffLines(a, b) {
  const n0 = a.length;
  const m0 = b.length;
  let pre = 0;
  while (pre < n0 && pre < m0 && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n0 - pre && suf < m0 - pre && a[n0 - 1 - suf] === b[m0 - 1 - suf]) suf++;
  const N = n0 - pre - suf;
  const M = m0 - pre - suf;
  if (N === 0 && M === 0) return [];
  if (N === 0 || M === 0) return [{ aStart: pre, aEnd: pre + N, bStart: pre, bEnd: pre + M }];

  const fallback = () => [{ aStart: pre, aEnd: pre + N, bStart: pre, bEnd: pre + M }];
  const max = N + M;
  const limit = Math.min(max, MAX_D);
  const off = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace = []; // trace[d] = cópia da faixa [-d-1, d+1] antes do passo d (v após d-1)
  let found = -1;

  for (let d = 0; d <= limit; d++) {
    // salva a faixa [-d-1, d+1] do estado atual (resultado do passo d-1)
    const lo = Math.max(-d - 1, -limit - 1);
    const hi = Math.min(d + 1, limit + 1);
    trace.push(v.slice(lo + off, hi + off + 1));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off])) x = v[k + 1 + off];
      else x = v[k - 1 + off] + 1;
      let y = x - k;
      while (x < N && y < M && a[pre + x] === b[pre + y]) { x++; y++; }
      v[k + off] = x;
      if (x >= N && y >= M) { found = d; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return fallback();

  // backtrack: reconstrói edições (ins/del) de trás para frente
  const edits = []; // {type:'d'|'i', x, y} posição em a/b do passo
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]; // v após passo d-1, faixa [-d, d] (guardada como [-d-1, d+1] nominal)
    const lo = Math.max(-d - 1, -limit - 1);
    const get = (kk) => prev[kk - lo];
    const k = x - y;
    let pk;
    if (k === -d || (k !== d && get(k - 1) < get(k + 1))) pk = k + 1;
    else pk = k - 1;
    const px = get(pk);
    const py = px - pk;
    if (pk === k + 1) { // inserção em b: de (px,py) para (px,py+1)
      edits.push({ type: 'i', x: px, y: py });
    } else { // remoção em a: de (px,py) para (px+1,py)
      edits.push({ type: 'd', x: px, y: py });
    }
    x = px;
    y = py;
  }
  edits.reverse();

  // monta hunks agrupando edições contíguas
  const hunks = [];
  let cur = null;
  for (const e of edits) {
    const ax = e.x;
    const by = e.y;
    const aEndE = e.type === 'd' ? ax + 1 : ax;
    const bEndE = e.type === 'i' ? by + 1 : by;
    if (cur && cur.aEnd === ax && cur.bEnd === by) {
      cur.aEnd = aEndE;
      cur.bEnd = bEndE;
    } else {
      if (cur) hunks.push(cur);
      cur = { aStart: ax, aEnd: aEndE, bStart: by, bEnd: bEndE };
    }
  }
  if (cur) hunks.push(cur);
  return hunks.map((h) => ({
    aStart: h.aStart + pre,
    aEnd: h.aEnd + pre,
    bStart: h.bStart + pre,
    bEnd: h.bEnd + pre,
  }));
}

module.exports = { diffLines };
