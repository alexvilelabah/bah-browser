// Controle do DOM × [id] da lista (texto + posição) e o modal "caseiro" sem ARIA (pontuação).
import { test } from 'node:test';
import assert from 'node:assert';
import { matchControl, overlayScore, pickOverlay, type OverlayCandidate } from '../../src/shared/page-controls.ts';

test('matchControl: same text, nearest position wins; far or different text is no match', () => {
  const list = [
    { id: 12, text: 'Install Steam', x: 763, y: 17 },     // menu → /about/
    { id: 15, text: 'INSTALL STEAM', x: 640, y: 420 },    // botão grande → .dmg
    { id: 20, text: 'Download', x: 300, y: 600 },         // página atrás
    { id: 31, text: 'Download', x: 640, y: 380 },         // dentro do modal
  ];
  assert.strictEqual(matchControl(list, { text: 'INSTALL STEAM', x: 642, y: 418 })?.id, 15);
  assert.strictEqual(matchControl(list, { text: 'Install Steam', x: 760, y: 18 })?.id, 12);
  assert.strictEqual(matchControl(list, { text: 'Download', x: 641, y: 381 })?.id, 31);
  assert.strictEqual(matchControl(list, { text: 'Download', x: 1200, y: 50 }), null);
  assert.strictEqual(matchControl(list, { text: 'Sign in', x: 640, y: 380 }), null);
  assert.strictEqual(matchControl(list, { text: '', x: 640, y: 380 }), null);
});

const base: OverlayCandidate = { z: 1000, area: 0.12, top: 200, height: 300, viewportH: 800, hitCenter: true, label: 'Select your Operating System', buttons: [{ text: 'Mac OS', x: 1, y: 1 }, { text: 'Close', x: 2, y: 2 }], legacy: false };

test('overlay scoring: an ARIA-less modal over the centre is picked; page furniture is not', () => {
  // Modal da HP: div fixa, z alto, cobre o meio, botões Download/Close.
  assert.ok(overlayScore(base, true) >= 4);
  assert.ok(overlayScore({ ...base, buttons: [{ text: 'Download', x: 0, y: 0 }] }, false) >= 4);
  // Sem botões (o próprio fundo escuro), cabeçalho fixo, barra fixa no rodapé: não.
  assert.strictEqual(overlayScore({ ...base, buttons: [] }, true), -1);
  assert.strictEqual(overlayScore({ ...base, top: 0, height: 80, hitCenter: false }, false), -1);
  assert.strictEqual(overlayScore({ ...base, top: 720, height: 80, hitCenter: false, buttons: [{ text: 'Download', x: 0, y: 0 }] }, false), -1);
  // Painel fixo de lado (chat), sem cobrir o meio nem fundo: não é "por cima".
  assert.strictEqual(overlayScore({ ...base, hitCenter: false }, false), -1);
  // Conteúdo absoluto de z baixo no meio (carrossel com "Next"): não.
  assert.strictEqual(overlayScore({ ...base, z: 2 }, false), -1);
  // A regra antiga (≥ 20%, z ≥ 10) continua valendo sozinha.
  assert.ok(overlayScore({ ...base, legacy: true, hitCenter: false, z: 10 }, false) >= 4);
});

test('pickOverlay: best score wins, ties go to the higher z-index; nothing above threshold → null', () => {
  const chat: OverlayCandidate = { ...base, z: 2000, hitCenter: false, label: 'Chat', buttons: [{ text: 'Chat with us', x: 0, y: 0 }] };
  assert.strictEqual(pickOverlay([chat, base], true)?.label, 'Select your Operating System');
  assert.strictEqual(pickOverlay([chat], false), null);
  const a = { ...base, z: 100, label: 'A' }, b = { ...base, z: 500, label: 'B' };
  assert.strictEqual(pickOverlay([a, b], true)?.label, 'B');
  assert.strictEqual(pickOverlay([], true), null);
});
