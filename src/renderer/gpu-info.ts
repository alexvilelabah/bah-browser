// gpu-info.ts - is there a GPU here, and can it carry a vision encoder?
// Asked once at startup, cached, read synchronously by the vision gate.

import { hasCapableGpu } from '../shared/vision';

let cached: unknown = null;
let loaded = false;

/** Fire-and-forget at app start; safe to call more than once. */
export function prefetchGpuInfo(): void {
  if (loaded) return;
  Promise.resolve(window.electronAPI?.gpuInfo?.())
    .then((info) => { cached = info ?? null; loaded = true; })
    .catch(() => { cached = null; loaded = true; });
}

export function gpuInfo(): unknown { return cached; }

/** True only when the probe answered and reported a real GPU. Unknown is NO. */
export function gpuIsCapable(): boolean { return hasCapableGpu(cached); }

export function gpuIsLoaded(): boolean { return loaded; }
