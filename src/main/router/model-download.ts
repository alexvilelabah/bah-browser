// Download do modelo do roteador: retoma de onde parou (<arquivo>.part + Range), confere tamanho
// e sha256 e só então renomeia pro nome final. Sem Electron (fetch injetável) → testável em node.
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export interface ModelDownloadOpts {
  url: string;
  dest: string;
  sha256: string;
  size: number;
  fetchImpl?: typeof fetch;
  onProgress?: (bytes: number, total: number) => void;
  signal?: AbortSignal;
}

export async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

/** Baixa (ou termina de baixar) e verifica. Resolve com o caminho final; rejeita com o motivo. */
export async function downloadModel(o: ModelDownloadOpts): Promise<string> {
  const doFetch = o.fetchImpl ?? fetch;
  const part = o.dest + '.part';
  let start = 0;
  try { start = fs.statSync(part).size; } catch {}
  // .part maior que o esperado = lixo → recomeça.
  if (start > o.size) { fs.rmSync(part, { force: true }); start = 0; }

  if (start < o.size) {
    const res = await doFetch(o.url, { headers: start ? { Range: `bytes=${start}-` } : {}, redirect: 'follow', signal: o.signal });
    if (res.status === 416) {
      // O servidor diz que não há mais nada além do que temos → confere abaixo.
    } else if (res.status === 200 || res.status === 206) {
      // 200 com Range pedido = o servidor ignorou o Range → recomeça do zero.
      if (res.status === 200) start = 0;
      if (!res.body) throw new Error('empty response');
      let bytes = start;
      let last = 0;
      const body = Readable.fromWeb(res.body as any);
      body.on('data', (c: Buffer) => {
        bytes += c.length;
        const now = Date.now();
        if (now - last > 250) { last = now; o.onProgress?.(bytes, o.size); }
      });
      await pipeline(body, fs.createWriteStream(part, { flags: start ? 'a' : 'w' }), { signal: o.signal });
      o.onProgress?.(bytes, o.size);
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  const got = fs.statSync(part).size;
  if (got !== o.size) {
    // Curto = interrompido (fica o .part pra retomar); comprido = corrompido (apaga).
    if (got > o.size) fs.rmSync(part, { force: true });
    throw new Error(`size mismatch: ${got} of ${o.size} bytes`);
  }
  const sum = await sha256File(part);
  if (sum !== o.sha256.toLowerCase()) {
    fs.rmSync(part, { force: true });
    throw new Error('checksum mismatch');
  }
  fs.renameSync(part, o.dest);
  return o.dest;
}
