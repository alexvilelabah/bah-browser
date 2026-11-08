// Qual arquivo o main aceita abrir como teste do binário do node-llama-cpp (src/main/router/binding-test-path.ts):
// só o do próprio app, comparando caminhos reais — node_modules em link simbólico (worktree, pnpm) passa.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bindingTestFileToFork, BINDING_TEST_FILE } from '../../src/main/router/binding-test-path.ts';

// <root>/store/node_modules/node-llama-cpp/… de verdade; <root>/app/node_modules → link pra store/node_modules.
function layout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bah-bt-')));
  const store = path.join(root, 'store');
  const testFile = path.join(store, BINDING_TEST_FILE);
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, '');
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  fs.symlinkSync(path.join(store, 'node_modules'), path.join(app, 'node_modules'));
  return { root, store, app, realTestFile: testFile };
}

test('symlinked node_modules: the resolved test file is accepted and the real path is forked', () => {
  const { app, realTestFile } = layout();
  assert.strictEqual(bindingTestFileToFork(realTestFile, app), realTestFile);
  // Pelo caminho do link também (como o node mostraria sem resolver).
  assert.strictEqual(bindingTestFileToFork(path.join(app, BINDING_TEST_FILE), app), realTestFile);
});

test('plain node_modules inside the app still works', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bah-bt-')));
  const f = path.join(root, BINDING_TEST_FILE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '');
  assert.strictEqual(bindingTestFileToFork(f, root), f);
});

test('another node-llama-cpp copy (same file name) is refused', () => {
  const { root, app } = layout();
  const other = path.join(root, 'other', BINDING_TEST_FILE);
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, '');
  assert.strictEqual(bindingTestFileToFork(other, app), null);
  // Aninhado dentro do app (antes passava pelo "começa com appPath"): recusado.
  const nested = path.join(app, 'node_modules', 'foo', BINDING_TEST_FILE);
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, '');
  assert.strictEqual(bindingTestFileToFork(nested, app), null);
});

test('a symlink named like the test file but pointing elsewhere is refused', () => {
  const { root, app } = layout();
  const evil = path.join(root, 'evil.js');
  fs.writeFileSync(evil, '');
  const fake = path.join(root, 'fake', BINDING_TEST_FILE);
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.symlinkSync(evil, fake);
  assert.strictEqual(bindingTestFileToFork(fake, app), null);
});

test('other files and empty input are refused', () => {
  const { app, store } = layout();
  assert.strictEqual(bindingTestFileToFork('', app), null);
  assert.strictEqual(bindingTestFileToFork(path.join(store, 'node_modules', 'node-llama-cpp', 'dist', 'index.js'), app), null);
  assert.strictEqual(bindingTestFileToFork(path.join(app, 'node_modules', '..', 'evil.js'), app), null);
});

test('realpath failing (fake paths, e.g. inside an asar): exact match on the resolved path only', () => {
  const boom = () => { throw new Error('ENOENT'); };
  const appPath = path.join(path.sep, 'opt', 'Bah', 'resources', 'app.asar');
  const inAsar = path.join(appPath, BINDING_TEST_FILE);
  assert.strictEqual(bindingTestFileToFork(inAsar, appPath, boom), inAsar);
  // app.asar.unpacked começa com "app.asar" — o prefixo de antes aceitava; a igualdade não.
  assert.strictEqual(bindingTestFileToFork(path.join(appPath + '.unpacked', BINDING_TEST_FILE), appPath, boom), null);
});

test('asar-style realpath (archive realpath + inner path) matches on both sides', () => {
  // O fs do Electron resolve <link>/app.asar/x como <real>/app.asar/x; simula com um mapa de prefixo.
  const linked = path.join(path.sep, 'Applications', 'Bah.app', 'Contents', 'Resources', 'app.asar');
  const realAsar = path.join(path.sep, 'Volumes', 'disk', 'Bah.app', 'Contents', 'Resources', 'app.asar');
  const realpath = (p: string) => (p === linked || p.startsWith(linked + path.sep) ? realAsar + p.slice(linked.length) : p);
  const want = path.join(realAsar, BINDING_TEST_FILE);
  assert.strictEqual(bindingTestFileToFork(path.join(linked, BINDING_TEST_FILE), linked, realpath), want);
  assert.strictEqual(bindingTestFileToFork(want, linked, realpath), want);
});
