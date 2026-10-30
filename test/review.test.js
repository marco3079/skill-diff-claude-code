'use strict';
// Testes sem frameworks: node test/review.test.js
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const scripts = path.join(root, 'skills', 'review-edits', 'scripts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-'));
const store = path.join(tmp, 'store');
const home = path.join(tmp, 'home');
fs.mkdirSync(home, { recursive: true });
const env = { ...process.env, CLAUDE_REVIEW_DIR: store, HOME: home, USERPROFILE: home, NO_COLOR: '1' };
delete env.FORCE_COLOR;

let n = 0;
function test(name, fn) {
  const proj = fs.mkdtempSync(path.join(tmp, 'proj-'));
  fs.rmSync(store, { recursive: true, force: true });
  try { fn(proj); n++; console.log(`ok   ${name}`); } catch (e) {
    console.error(`FALHOU ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
}
const run = (script, args, opts = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...env, ...(opts.env || {}) }, input: opts.input, cwd: opts.cwd });
const review = (proj, ...args) => run(path.join(scripts, 'review.js'), [...args, '--cwd', proj]);
const hook = (proj, tool, file, key = 'file_path') => run(path.join(scripts, 'snapshot.js'), [], {
  input: JSON.stringify({ cwd: proj, tool_name: tool, tool_input: { [key]: file } }),
});
const w = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const r = (f) => fs.readFileSync(f, 'utf8');

test('snapshot nunca falha e list mostra resumo, status e contagens', (p) => {
  const a = path.join(p, 'a.txt');
  w(a, 'um\ndois\ntres\n');
  assert.strictEqual(hook(p, 'Edit', a).status, 0);
  w(a, 'um\nDOIS\ntres\nquatro\n');
  const nova = path.join(p, 'sub', 'nova.txt');
  assert.strictEqual(hook(p, 'Write', nova).status, 0);
  w(nova, 'x\ny\n');
  const out = review(p, 'list').stdout;
  assert.match(out, /2 arquivos alterados \+4 −1/);
  assert.match(out, /M a\.txt\s+\+2 −1/);
  assert.match(out, /A sub\/nova\.txt\s+\+2 −0/);
  assert.match(review(p, 'status').stdout, /^2 arquivos alterados \+4 −1\s*$/);
  const j = JSON.parse(review(p, 'json').stdout);
  assert.strictEqual(j.count, 2);
  assert.strictEqual(j.files[0].hunks.length, 2);
  // entrada inválida: sem erro
  assert.strictEqual(run(path.join(scripts, 'snapshot.js'), [], { input: 'lixo' }).status, 0);
  assert.strictEqual(run(path.join(scripts, 'snapshot.js'), [], { input: '' }).status, 0);
});

test('diff mostra trechos numerados e cores com FORCE_COLOR', (p) => {
  const a = path.join(p, 'a.txt');
  w(a, '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n');
  hook(p, 'Edit', a);
  w(a, '1\nDOIS\n3\n4\n5\n6\n7\n8\nNOVE\n10\n');
  const out = review(p, 'diff', '1', '--context', '1').stdout;
  assert.match(out, /#1 @@/);
  assert.match(out, /#2 @@/);
  assert.match(out, /^-2$/m);
  assert.match(out, /^\+DOIS$/m);
  const col = run(path.join(scripts, 'review.js'), ['diff', 'a.txt', '--cwd', p], { env: { NO_COLOR: '', FORCE_COLOR: '1' } }).stdout;
  assert.ok(col.includes('\x1b[32m+DOIS'), 'verde para adicionado');
  assert.ok(col.includes('\x1b[31m-2'), 'vermelho para removido');
});

test('keep e undo por arquivo; keep atualiza a baseline', (p) => {
  const a = path.join(p, 'a.txt');
  const b = path.join(p, 'b.txt');
  w(a, 'a1\na2\n'); w(b, 'b1\n');
  hook(p, 'Edit', a); hook(p, 'Edit', b);
  w(a, 'a1\nA2\n'); w(b, 'b1\nb2\n');
  review(p, 'undo', 'a.txt');
  assert.strictEqual(r(a), 'a1\na2\n');
  review(p, 'keep', '1'); // agora a lista só tem b.txt (nº 1)
  assert.match(review(p, 'list').stdout, /Nenhuma alteração pendente/);
  assert.strictEqual(r(b), 'b1\nb2\n');
  // nova edição depois do keep: baseline = estado aceito
  hook(p, 'Edit', b);
  w(b, 'b1\nb2\nb3\n');
  assert.match(review(p, 'list').stdout, /M b\.txt\s+\+1 −0/);
  review(p, 'undo', 'b.txt');
  assert.strictEqual(r(b), 'b1\nb2\n');
});

test('trecho (--hunk): keep e undo agem só naquele trecho', (p) => {
  const a = path.join(p, 'a.txt');
  w(a, '1\n2\n3\n4\n5\n6\n7\n8\n');
  hook(p, 'Edit', a);
  w(a, '1\nDOIS\n3\n4\n5\n6\nSETE\n8\n');
  review(p, 'undo', 'a.txt', '--hunk', '1');
  assert.strictEqual(r(a), '1\n2\n3\n4\n5\n6\nSETE\n8\n');
  assert.match(review(p, 'list').stdout, /a\.txt\s+\+1 −1/);
  review(p, 'keep', 'a.txt', '--hunk', '1'); // mantém SETE
  assert.match(review(p, 'list').stdout, /Nenhuma alteração pendente/);
  // baseline atualizada: undo-all não mexe mais
  review(p, 'undo', 'all');
  assert.strictEqual(r(a), '1\n2\n3\n4\n5\n6\nSETE\n8\n');
  // trecho inexistente
  w(a, 'X\n2\n3\n4\n5\n6\nSETE\n8\n');
  const bad = review(p, 'keep', 'a.txt', '--hunk', '9');
  assert.notStrictEqual(bad.status, 0);
});

test('all, arquivo novo (undo apaga) e arquivo apagado (undo restaura)', (p) => {
  const a = path.join(p, 'a.txt');
  const nova = path.join(p, 'n', 'nova.txt');
  const del = path.join(p, 'del.txt');
  w(a, 'a\n'); w(del, 'd1\nd2\n');
  hook(p, 'Edit', a); hook(p, 'Write', nova); hook(p, 'Edit', del);
  w(a, 'b\n'); w(nova, 'n\n'); fs.rmSync(del);
  const list = review(p, 'list').stdout;
  assert.match(list, /D del\.txt\s+\+0 −2/);
  review(p, 'undo', 'all');
  assert.strictEqual(r(a), 'a\n');
  assert.ok(!fs.existsSync(nova), 'arquivo novo apagado');
  assert.strictEqual(r(del), 'd1\nd2\n');
  assert.match(review(p, 'list').stdout, /Nenhuma alteração pendente/);
  // keep all
  w(a, 'c\n');
  hook(p, 'Edit', a);
  review(p, 'keep', 'all');
  assert.match(review(p, 'list').stdout, /Nenhuma alteração pendente/);
  assert.strictEqual(r(a), 'c\n');
});

test('CRLF preservado (undo, undo de trecho, keep de trecho) e só-EOL aparece como ±0', (p) => {
  const a = path.join(p, 'a.txt');
  w(a, 'l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\r\nl7\r\n');
  hook(p, 'Edit', a);
  w(a, 'l1\r\nL2\r\nl3\r\nl4\r\nl5\r\nl6\r\nL7\r\n');
  review(p, 'undo', 'a.txt', '--hunk', '1');
  assert.strictEqual(r(a), 'l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\r\nL7\r\n');
  review(p, 'keep', 'a.txt', '--hunk', '1');
  review(p, 'undo', 'all');
  assert.strictEqual(r(a), 'l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\r\nL7\r\n');
  // só EOL
  const b = path.join(p, 'b.txt');
  w(b, 'x\r\ny\r\n');
  hook(p, 'Edit', b);
  w(b, 'x\ny\n');
  assert.match(review(p, 'list').stdout, /b\.txt\s+\+0 −0/);
  review(p, 'undo', 'b.txt');
  assert.strictEqual(r(b), 'x\r\ny\r\n');
});

test('binário e arquivo grande são ignorados; fora do cwd também', (p) => {
  const bin = path.join(p, 'x.bin');
  const big = path.join(p, 'big.txt');
  fs.writeFileSync(bin, Buffer.from([1, 2, 0, 3]));
  w(big, 'a'.repeat(1024 * 1024 + 10));
  hook(p, 'Edit', bin); hook(p, 'Edit', big);
  fs.writeFileSync(bin, Buffer.from([1, 2, 0, 4]));
  w(big, 'b'.repeat(1024 * 1024 + 10));
  const outside = path.join(tmp, 'fora.txt');
  w(outside, 'o\n');
  hook(p, 'Edit', outside);
  w(outside, 'p\n');
  assert.match(review(p, 'list').stdout, /Nenhuma alteração pendente/);
  const idx = path.join(store, require('crypto').createHash('sha1').update(path.resolve(p)).digest('hex'), 'index.json');
  assert.ok(!fs.existsSync(idx), 'nada gravado');
});

test('baseline só é gravada uma vez; NotebookEdit usa notebook_path', (p) => {
  const a = path.join(p, 'a.txt');
  w(a, 'orig\n');
  hook(p, 'Edit', a);
  w(a, 'meio\n');
  hook(p, 'Edit', a); // não deve sobrescrever
  w(a, 'fim\n');
  review(p, 'undo', 'a.txt');
  assert.strictEqual(r(a), 'orig\n');
  const nb = path.join(p, 'n.ipynb');
  w(nb, '{"cells":[]}\n');
  hook(p, 'NotebookEdit', nb, 'notebook_path');
  w(nb, '{"cells":[1]}\n');
  assert.match(review(p, 'list').stdout, /n\.ipynb/);
});

test('tui.js sem TTY imprime a lista e sai', (p) => {
  const a = path.join(p, 'a.txt');
  w(a, 'a\n'); hook(p, 'Edit', a); w(a, 'b\n');
  const out = run(path.join(scripts, 'tui.js'), ['--cwd', p]);
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, /1 arquivo alterado \+1 −1/);
  assert.match(out.stdout, /a\.txt/);
});

// ---------- install.js --hooks ----------
const install = (...args) => run(path.join(root, 'install.js'), args);
const settingsFile = path.join(home, '.claude', 'settings.json');
const baks = () => fs.existsSync(path.dirname(settingsFile)) ? fs.readdirSync(path.dirname(settingsFile)).filter((f) => f.startsWith('settings.json.bak-')) : [];
const reset = () => fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });

test('install --hooks --dry-run não altera nada', () => {
  reset();
  const o = install('--hooks', '--dry-run');
  assert.strictEqual(o.status, 0, o.stdout + o.stderr);
  assert.ok(!fs.existsSync(settingsFile));
  w(settingsFile, '{"a":1}');
  install('--hooks', '--dry-run');
  assert.strictEqual(r(settingsFile), '{"a":1}');
  assert.strictEqual(baks().length, 0);
});

test('install --hooks: cria, preserva o resto, é idempotente e faz backup', () => {
  reset();
  w(settingsFile, JSON.stringify({ model: 'x', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo oi' }] }], Stop: [] } }));
  let o = install('--hooks');
  assert.strictEqual(o.status, 0, o.stdout + o.stderr);
  const s = JSON.parse(r(settingsFile));
  assert.strictEqual(s.model, 'x');
  assert.deepStrictEqual(s.hooks.Stop, []);
  assert.strictEqual(s.hooks.PreToolUse.length, 2);
  const g = s.hooks.PreToolUse[1];
  assert.strictEqual(g.matcher, 'Edit|Write|MultiEdit|NotebookEdit');
  const expected = path.join(home, '.claude', 'skills', 'review-edits', 'scripts', 'snapshot.js');
  assert.strictEqual(g.hooks[0].command, `node "${expected}"`);
  assert.strictEqual(baks().length, 1);
  const before = r(settingsFile);
  o = install('--hooks');
  assert.strictEqual(o.status, 0);
  assert.strictEqual(r(settingsFile), before, 'idempotente');
  assert.strictEqual(baks().length, 1, 'sem novo backup quando nada muda');
});

test('install --hooks sem settings.json cria o arquivo', () => {
  reset();
  assert.strictEqual(install('--hooks').status, 0);
  assert.strictEqual(JSON.parse(r(settingsFile)).hooks.PreToolUse.length, 1);
});

test('install --hooks aborta com JSON inválido sem alterar', () => {
  reset();
  w(settingsFile, '{ quebrado');
  const o = install('--hooks');
  assert.notStrictEqual(o.status, 0);
  assert.strictEqual(r(settingsFile), '{ quebrado');
  assert.strictEqual(baks().length, 0);
});

test('install --remove-hooks remove só a nossa entrada', () => {
  reset();
  w(settingsFile, JSON.stringify({ k: 1, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo oi' }] }] } }));
  install('--hooks');
  const o = install('--remove-hooks');
  assert.strictEqual(o.status, 0, o.stdout + o.stderr);
  const s = JSON.parse(r(settingsFile));
  assert.deepStrictEqual(s, { k: 1, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo oi' }] }] } });
  assert.ok(baks().length >= 1);
  // remover de novo: nada a fazer
  assert.strictEqual(install('--remove-hooks').status, 0);
  // sem outras entradas: limpa hooks
  reset();
  install('--hooks');
  install('--remove-hooks');
  assert.deepStrictEqual(JSON.parse(r(settingsFile)), {});
});

test('install --skill continua copiando skills/review-edits para ~/.claude/skills', () => {
  reset();
  const o = install('--skill');
  assert.strictEqual(o.status, 0, o.stdout + o.stderr);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'review-edits', 'scripts', 'snapshot.js')));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'review-edits', 'SKILL.md')));
  assert.ok(!fs.existsSync(settingsFile), '--skill não mexe no settings.json');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} testes ok${process.exitCode ? ' (com falhas)' : ''}`);
