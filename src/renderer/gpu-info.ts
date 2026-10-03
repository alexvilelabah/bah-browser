// gpu-info.ts — is there a GPU here, and can it carry a vision encoder?
//
// Asked once at startup, cached, read synchronously by the vision gate. The alternative
// (awaiting the probe at the first step) made every run pay the round trip, and skipping
// the probe entirely left vision ON by default on machines where it turns a 2s step into
// a 30s one - which reads to the user as the agent being broken.
import { hasCapableGpu } from '../shared/vision';

let cached: unknown = null;
let loaded = false;

/** Fire-and-forget at app start; safe to call more than once. */
export function prefetchGpuInfo(): void {
  if (loaded) return;
  Promise.resolve(window.electronAPI?.gpuInfo?.())
    .then((info) => { cached = info ?? null; loaded = true; })
    .catch(() => { cached = null; loaded = true; });   // unknown -> treated as "no GPU"
}

/** Cached GPU info, or null while unknown. */
export function gpuInfo(): unknown { return cached; }

/** True only when the probe answered and reported a real GPU. Unknown is NO. */
export function gpuIsCapable(): boolean { return hasCapableGpu(cached); }

/** The probe has answered (as opposed to "still pending"). */
export function gpuIsLoaded(): boolean { return loaded; }
