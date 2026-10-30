'use strict';
const assert = require('node:assert');
const { diffLines } = require('../diff');

function apply(a, b, hunks) {
  const out = [];
  let ai = 0;
  for (const h of hunks) {
    for (; ai < h.aStart; ai++) out.push(a[ai]);
    for (let j = h.bStart; j < h.bEnd; j++) out.push(b[j]);
    ai = h.aEnd;
  }
  for (; ai < a.length; ai++) out.push(a[ai]);
  return out;
}
function check(a, b) {
  const hs = diffLines(a, b);
  let pa = 0, pb = 0;
  for (const h of hs) {
    assert.ok(h.aStart >= pa && h.bStart >= pb && h.aEnd >= h.aStart && h.bEnd >= h.bStart, 'ordem');
    assert.ok(h.aEnd > h.aStart || h.bEnd > h.bStart, 'hunk vazio');
    pa = h.aEnd; pb = h.bEnd;
  }
  assert.deepStrictEqual(apply(a, b, hs), b);
  return hs;
}
const H = (aStart, aEnd, bStart, bEnd) => ({ aStart, aEnd, bStart, bEnd });

assert.deepStrictEqual(diffLines([], []), []);
assert.deepStrictEqual(diffLines(['a', 'b'], ['a', 'b']), []);
assert.deepStrictEqual(diffLines(['a', 'c'], ['a', 'b', 'c']), [H(1, 1, 1, 2)]);
assert.deepStrictEqual(diffLines(['a', 'b', 'c'], ['a', 'c']), [H(1, 2, 1, 1)]);
assert.deepStrictEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'c']), [H(1, 2, 1, 2)]);
assert.deepStrictEqual(diffLines(['b'], ['a', 'b']), [H(0, 0, 0, 1)]);
assert.deepStrictEqual(diffLines(['a'], ['a', 'b']), [H(1, 1, 1, 2)]);
assert.deepStrictEqual(diffLines([], ['x', 'y']), [H(0, 0, 0, 2)]);
assert.deepStrictEqual(diffLines(['x', 'y'], []), [H(0, 2, 0, 0)]);
assert.strictEqual(check('a b c d e f g'.split(' '), 'a X c d e Y g'.split(' ')).length, 2);
check(['a', 'a', 'a'], ['a', 'a']);
check(['a'], ['b']);

// grande, acima do limite -> hunk único
const big1 = Array.from({ length: 4000 }, (_, i) => 'a' + i);
const big2 = Array.from({ length: 4000 }, (_, i) => 'b' + i);
assert.deepStrictEqual(diffLines(big1, big2), [H(0, 4000, 0, 4000)]);

// aleatório
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let t = 0; t < 3000; t++) {
  const alpha = 1 + Math.floor(rnd() * 5);
  const gen = () => Array.from({ length: Math.floor(rnd() * 25) }, () => String.fromCharCode(97 + Math.floor(rnd() * alpha)));
  const a = gen();
  let b = rnd() < 0.5 ? gen() : a.filter(() => rnd() > 0.2).concat(rnd() < 0.5 ? ['z'] : []);
  check(a, b);
}
console.log('diff.test.js OK');
