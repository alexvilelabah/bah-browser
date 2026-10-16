import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  faviconOrigin, sanitizeOrigins, isBlockedHost, isPrivateIp, isIpLiteral, isFetchableUrl,
  sniffImage, pickIcoEntry, shrinkIco, normalizeIcon, decodeDataUrl, parseIconLinks,
  isFresh, pruneOrder, letterTile, splitOverflow, TILE_COLORS,
  HIT_TTL_MS, MISS_TTL_MS, MAX_ICON_BYTES, MAX_ORIGINS_PER_ASK, type FaviconEntry,
} from '../../src/shared/favicons.ts';

// Ícones dos favoritos: origem, endereços proibidos, bytes de imagem, cache e a conta do "»".

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const DAY = 24 * 3_600_000;

test('origem: só http/https, porta padrão some, host minúsculo', () => {
  assert.equal(faviconOrigin('https://WWW.Site.com:443/a/b?c=1#d'), 'https://www.site.com');
  assert.equal(faviconOrigin('http://site.com:80/'), 'http://site.com');
  assert.equal(faviconOrigin('http://site.com:8080/x'), 'http://site.com:8080');
  assert.equal(faviconOrigin('ftp://site.com/'), null);
  assert.equal(faviconOrigin('javascript:alert(1)'), null);
  assert.equal(faviconOrigin('file:///C:/x'), null);
  assert.equal(faviconOrigin('https://user:pw@site.com/'), null);
  assert.equal(faviconOrigin('não é url'), null);
  assert.equal(faviconOrigin(42), null);
  assert.equal(faviconOrigin('https://' + 'a'.repeat(5000) + '.com'), null);
});

test('pedido do renderer: valida, junta repetidos, respeita o teto', () => {
  assert.deepEqual(sanitizeOrigins(['https://a.com/x', 'https://a.com/y', 'bad', 7, null, 'http://b.com']), ['https://a.com', 'http://b.com']);
  assert.deepEqual(sanitizeOrigins('https://a.com'), []);
  assert.deepEqual(sanitizeOrigins(undefined), []);
  const many = Array.from({ length: 2000 }, (_, i) => `https://s${i}.com`);
  assert.equal(sanitizeOrigins(many).length, MAX_ORIGINS_PER_ASK);
  assert.equal(sanitizeOrigins(many, 5).length, 5);
});

test('bloqueio: localhost, rede interna e nome sem ponto', () => {
  for (const h of ['localhost', 'LOCALHOST', 'app.localhost', 'impressora.local', 'nas.lan', 'x.internal', 'roteador', 'intranet', 'casa.home.arpa', 'dev.test', 'localhost.']) {
    assert.ok(isBlockedHost(h), h);
  }
  for (const h of ['google.com', 'www.uol.com.br', 'localhost.com', 'mylocal.com', 'a.b.c.example.org']) {
    assert.ok(!isBlockedHost(h), h);
  }
});

test('bloqueio: IPv4 privado/loopback/link-local/CGNAT; público passa', () => {
  for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
    assert.ok(isPrivateIp(ip), ip);
    assert.ok(isBlockedHost(ip), ip);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '100.128.0.1', '1.1.1.1']) {
    assert.ok(!isPrivateIp(ip), ip);
    assert.ok(!isBlockedHost(ip), ip);
  }
});

test('bloqueio: IPv6 loopback/ULA/link-local e IPv4 embutido', () => {
  for (const ip of ['::1', '[::1]', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:101', '64:ff9b::a00:1', '2002:c0a8:101::1']) {
    assert.ok(isPrivateIp(ip), ip);
  }
  for (const ip of ['2001:4860:4860::8888', '[2606:4700::1111]', '::ffff:8.8.8.8']) {
    assert.ok(!isPrivateIp(ip), ip);
  }
  assert.ok(isIpLiteral('[::1]'));
  assert.ok(isIpLiteral('10.0.0.1'));
  assert.ok(!isIpLiteral('site.com'));
  assert.ok(!isPrivateIp('1:2:3'));   // lixo não é IP (e não é "privado")
});

test('URL buscável: o parser do navegador normaliza truques de IP antes da checagem', () => {
  assert.ok(isFetchableUrl('https://site.com/favicon.ico'));
  assert.ok(!isFetchableUrl('http://127.0.0.1/favicon.ico'));
  assert.ok(!isFetchableUrl('http://2130706433/'));        // = 127.0.0.1 em decimal
  assert.ok(!isFetchableUrl('http://0x7f.1/'));            // = 127.0.0.1 em hexa
  assert.ok(!isFetchableUrl('http://[::ffff:127.0.0.1]/'));
  assert.ok(!isFetchableUrl('http://localhost:3000/'));
  assert.ok(!isFetchableUrl('https://user:pw@site.com/'));
  assert.ok(!isFetchableUrl('file:///etc/passwd'));
  assert.ok(!isFetchableUrl('data:image/png;base64,AAAA'));
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const bytes = (s: string) => new TextEncoder().encode(s);

test('tipo pelos bytes: imagens passam, HTML de erro não', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(bytes('GIF89a....')), 'image/gif');
  assert.equal(sniffImage(bytes('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(Uint8Array.from([0, 0, 1, 0, 1, 0])), 'image/x-icon');
  assert.equal(sniffImage(Uint8Array.from([0, 0, 1, 0, 0, 0])), null);   // ICO com 0 imagens
  assert.equal(sniffImage(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(sniffImage(bytes('\uFEFF  <svg viewBox="0 0 1 1"/>')), 'image/svg+xml');
  assert.equal(sniffImage(bytes('<!DOCTYPE html><html><body><svg></svg></body></html>')), null);
  assert.equal(sniffImage(bytes('Not Found')), null);
  assert.equal(sniffImage(new Uint8Array(0)), null);
});

// Monta um .ico de verdade com as entradas dadas (BMP falso ou PNG embutido).
function makeIco(list: Array<{ size: number; bpp: number; data: Uint8Array }>): Uint8Array {
  const head = 6 + list.length * 16;
  const total = head + list.reduce((s, e) => s + e.data.length, 0);
  const out = new Uint8Array(total);
  out.set([0, 0, 1, 0, list.length & 255, list.length >> 8], 0);
  let off = head;
  list.forEach((e, i) => {
    const d = 6 + i * 16;
    out[d] = e.size >= 256 ? 0 : e.size;
    out[d + 1] = e.size >= 256 ? 0 : e.size;
    out[d + 6] = e.bpp & 255; out[d + 7] = e.bpp >> 8;
    const len = e.data.length;
    out.set([len & 255, (len >> 8) & 255, (len >> 16) & 255, len >>> 24], d + 8);
    out.set([off & 255, (off >> 8) & 255, (off >> 16) & 255, off >>> 24], d + 12);
    out.set(e.data, off);
    off += len;
  });
  return out;
}

test('ICO: escolhe 32px; senão o maior até 64; senão o mais perto', () => {
  assert.equal(pickIcoEntry([{ size: 16, bpp: 32 }, { size: 32, bpp: 32 }, { size: 48, bpp: 32 }]), 1);
  assert.equal(pickIcoEntry([{ size: 16, bpp: 32 }, { size: 48, bpp: 32 }, { size: 256, bpp: 32 }]), 1);
  assert.equal(pickIcoEntry([{ size: 16, bpp: 8 }, { size: 24, bpp: 32 }]), 1);
  assert.equal(pickIcoEntry([{ size: 256, bpp: 32 }, { size: 128, bpp: 32 }]), 1);
  assert.equal(pickIcoEntry([{ size: 32, bpp: 8 }, { size: 32, bpp: 32 }]), 1);   // mesmo tamanho: mais cores
  assert.equal(pickIcoEntry([]), -1);
});

test('ICO enxuto: N imagens viram 1; PNG embutido sai como PNG; entrada quebrada some', () => {
  const bmp16 = new Uint8Array(40).fill(7), bmp32 = new Uint8Array(60).fill(9);
  const ico = makeIco([{ size: 16, bpp: 32, data: bmp16 }, { size: 32, bpp: 32, data: bmp32 }]);
  const r = shrinkIco(ico)!;
  assert.equal(r.mime, 'image/x-icon');
  assert.equal(r.bytes.length, 22 + 60);
  assert.deepEqual([...r.bytes.subarray(0, 6)], [0, 0, 1, 0, 1, 0]);
  assert.equal(r.bytes[6], 32);
  assert.deepEqual([...r.bytes.subarray(18, 22)], [22, 0, 0, 0]);
  assert.deepEqual([...r.bytes.subarray(22)], [...bmp32]);

  const withPng = makeIco([{ size: 16, bpp: 32, data: bmp16 }, { size: 32, bpp: 32, data: PNG }]);
  const p = shrinkIco(withPng)!;
  assert.equal(p.mime, 'image/png');
  assert.deepEqual([...p.bytes], [...PNG]);

  // Offset apontando pra fora do arquivo: ignora a entrada (e sem nenhuma boa, null).
  const broken = makeIco([{ size: 32, bpp: 32, data: bmp32 }]);
  broken[6 + 12] = 250; broken[6 + 13] = 250;
  assert.equal(shrinkIco(broken), null);
  assert.equal(shrinkIco(PNG), null);
  assert.equal(shrinkIco(Uint8Array.from([0, 0, 1, 0, 5, 0])), null);   // diz 5, não tem diretório
});

test('normalizeIcon: não-imagem e grande demais ficam de fora', () => {
  assert.equal(normalizeIcon(bytes('<html>404</html>')), null);
  assert.equal(normalizeIcon(new Uint8Array(0)), null);
  const big = new Uint8Array(MAX_ICON_BYTES + 1); big.set(PNG);
  assert.equal(normalizeIcon(big), null);
  assert.equal(normalizeIcon(PNG)?.mime, 'image/png');
});

test('data URL de ícone: base64 e texto; outro tipo não', () => {
  assert.deepEqual([...decodeDataUrl('data:image/png;base64,iVBORw==')!], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(new TextDecoder().decode(decodeDataUrl('data:image/svg+xml,%3Csvg%2F%3E')!), '<svg/>');
  assert.equal(decodeDataUrl('data:text/html,<script>1</script>'), null);
  assert.equal(decodeDataUrl('https://site.com/a.png'), null);
  assert.equal(decodeDataUrl('data:image/png;base64,@@@'), null);
});

test('<link rel=icon>: resolve relativo, prefere 16/32, apple-touch por último, ignora mask-icon', () => {
  const html = `<head>
    <link rel="apple-touch-icon" href="/apple.png">
    <link rel="mask-icon" href="/mask.svg">
    <link rel='icon' type="image/svg+xml" href="favicon.svg">
    <link href="/i32.png?a=1&amp;b=2" rel="icon" sizes="32x32">
    <link rel="stylesheet" href="/x.css">
    <link rel=icon href=javascript:alert(1)>
  </head>`;
  assert.deepEqual(parseIconLinks(html, 'https://site.com/pt/'), [
    'https://site.com/i32.png?a=1&b=2', 'https://site.com/pt/favicon.svg', 'https://site.com/apple.png',
  ]);
  assert.deepEqual(parseIconLinks('<link rel="shortcut icon" href="//cdn.site.com/f.ico">', 'https://site.com/'), ['https://cdn.site.com/f.ico']);
  assert.deepEqual(parseIconLinks('<p>nada</p>', 'https://site.com/'), []);
  assert.equal(parseIconLinks(html, 'https://site.com/', 1).length, 1);
});

const entry = (icon: string | null, checked: number, used = checked): FaviconEntry => ({ icon, checked, used });

test('cache: achado vale 30 dias, "sem ícone" vale 7, relógio pra trás = vencido', () => {
  assert.ok(isFresh(entry('data:image/png;base64,AA', NOW - 29 * DAY), NOW));
  assert.ok(!isFresh(entry('data:image/png;base64,AA', NOW - HIT_TTL_MS), NOW));
  assert.ok(isFresh(entry(null, NOW - 6 * DAY), NOW));
  assert.ok(!isFresh(entry(null, NOW - MISS_TTL_MS), NOW));
  assert.ok(!isFresh(entry(null, NOW + 2 * DAY), NOW));
});

test('cache: sai o menos usado até caber em quantidade e tamanho', () => {
  const e: Record<string, FaviconEntry> = {
    'https://a.com': entry('x'.repeat(100), 0, 3),
    'https://b.com': entry('x'.repeat(100), 0, 1),
    'https://c.com': entry(null, 0, 2),
  };
  assert.deepEqual(pruneOrder(e, 10, 1e9), []);
  assert.deepEqual(pruneOrder(e, 2, 1e9), ['https://b.com']);
  assert.deepEqual(pruneOrder(e, 1, 1e9), ['https://b.com', 'https://c.com']);
  // Tamanho (chave + ícone): 239 no total. Teto 140 → sai o b (fica 126); teto 120 → sai o c também (113).
  assert.deepEqual(pruneOrder(e, 10, 140), ['https://b.com']);
  assert.deepEqual(pruneOrder(e, 10, 120), ['https://b.com', 'https://c.com']);
});

test('letra do site sem ícone: 1ª letra do site (sem www), cor estável', () => {
  const a = letterTile('https://www.youtube.com/watch?v=1');
  assert.equal(a.letter, 'Y');
  assert.ok(TILE_COLORS.includes(a.color));
  assert.deepEqual(letterTile('https://youtube.com/'), a);
  assert.equal(letterTile('https://123milhas.com').letter, '1');
  assert.equal(letterTile('nada', 'Ótimo site').letter, 'Ó');
  assert.equal(letterTile('', '').letter, '?');
});

test('"»": tudo cabe → sem botão; senão só o que cabe antes dele', () => {
  // 3 de 100px, gap 2: total 304.
  assert.equal(splitOverflow([100, 100, 100], 304, 28, 2), 3);
  assert.equal(splitOverflow([100, 100, 100], 304.4, 28, 2), 3);   // subpixel
  // 303 não cabe tudo: sobra 303-28-2 = 273 → 2 (202) cabem.
  assert.equal(splitOverflow([100, 100, 100], 303, 28, 2), 2);
  // Borda exata do orçamento: 2 chips = 202; 202+2+28 = 232.
  assert.equal(splitOverflow([100, 100, 100], 232, 28, 2), 2);
  assert.equal(splitOverflow([100, 100, 100], 231, 28, 2), 1);
  // Nem um cabe ao lado do "»": tudo vai pro "»".
  assert.equal(splitOverflow([100, 100], 120, 28, 2), 0);
  // Vazio / largura zero (janela minimizada) / medida estranha.
  assert.equal(splitOverflow([], 500, 28, 2), 0);
  assert.equal(splitOverflow([50, 50], 0, 28, 2), 0);
  assert.equal(splitOverflow([50, NaN, 50], 200, 28, 2), 3);
  // Um longo no meio: para nele (a ordem da barra não muda — igual ao Chrome).
  assert.equal(splitOverflow([50, 160, 20], 200, 28, 2), 1);
});

test('"»": a soma do que fica visível + botão nunca passa da largura, e é o máximo que cabe', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let k = 0; k < 500; k++) {
    const widths = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => 20 + rnd() * 150);
    const avail = rnd() * 1600;
    const n = splitOverflow(widths, avail, 28, 2);
    const used = widths.slice(0, n).reduce((s, x) => s + x, 0) + 2 * Math.max(0, n - 1);
    if (n === widths.length) { assert.ok(used <= avail + 0.5); continue; }
    if (n > 0) assert.ok(used + 2 + 28 <= avail + 0.5, `${used} + botão > ${avail}`);
    const oneMore = used + (n ? 2 : 0) + widths[n];
    assert.ok(oneMore + 2 + 28 > avail + 0.5, 'cabia mais um');
  }
});
