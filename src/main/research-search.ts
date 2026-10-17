import type { ResearchSnippet } from '../shared/research.ts';

export const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';
export const RESEARCH_USER_AGENT = 'Bah (+https://github.com/alexvilelabah/bah-browser)';

/** Only safe, bounded source data crosses back into the renderer/model. */
export function parseSearchResults(raw: unknown): ResearchSnippet[] {
  if (!raw || typeof raw !== 'object') throw new Error('Parallel returned an invalid search response.');
  const result = raw as { isError?: boolean; structuredContent?: unknown; content?: unknown };
  if (result.isError) throw new Error('Parallel could not complete this search. Try again later or change Quick Research provider in settings.');
  let data = result.structuredContent;
  if (!data && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue;
      try { data = JSON.parse(block.text); break; } catch { /* other content is not a search response */ }
    }
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).results)) {
    throw new Error('Parallel returned an invalid search response.');
  }
  const found: ResearchSnippet[] = [];
  const seen = new Set<string>();
  for (const item of (data as any).results) {
    if (!item || typeof item.url !== 'string') continue;
    let url: URL;
    try { url = new URL(item.url); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || item.url.length > 2048 || seen.has(url.href)) continue;
    if (!Array.isArray(item.excerpts)) continue;
    seen.add(url.href);
    found.push({
      url: url.href,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 300) : url.hostname,
      snippet: item.excerpts.filter((x: unknown) => typeof x === 'string').join('\n').slice(0, 3000),
    });
    if (found.length === 6) break;
  }
  return found;
}

/** Streamable HTTP through the official MCP client. No cookies, keys or OAuth. */
export async function searchParallel(query: string, sessionId: string, options: {
  signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number;
} = {}): Promise<ResearchSnippet[]> {
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new Error('Invalid research question.');
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{32,100}$/.test(sessionId)) throw new Error('Invalid research session.');
  // The default browser research path never loads the MCP SDK.
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  const timeout = new AbortController();
  const clock = setTimeout(() => timeout.abort(new Error('Parallel search timed out.')), options.timeoutMs ?? 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  const fetchImpl = options.fetch ?? fetch;
  const client = new Client({ name: 'bah-browser', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(PARALLEL_MCP_URL), {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('User-Agent', RESEARCH_USER_AGENT);
      const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
      return fetchImpl(input, { ...init, headers, signal: requestSignal, credentials: 'omit', redirect: 'error' });
    },
  });
  const closeOnAbort = () => { void client.close().catch(() => {}); };
  signal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    signal.throwIfAborted();
    await client.connect(transport);
    const tools = await client.listTools({}, { signal });
    if (!tools.tools.some(tool => tool.name === 'web_search')) throw new Error('Parallel web search is unavailable.');
    const result = await client.callTool({ name: 'web_search', arguments: {
      objective: query.trim(), search_queries: [query.trim()], session_id: sessionId,
    } }, undefined, { signal });
    signal.throwIfAborted();
    return parseSearchResults(result);
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Search cancelled.');
    if (timeout.signal.aborted) throw new Error('Parallel search timed out.');
    throw error;
  } finally {
    clearTimeout(clock);
    signal.removeEventListener('abort', closeOnAbort);
    await client.close();
  }
}

// Kept Electron-free to exercise the actual IPC registration in unit tests.
interface ResearchEvent { sender: unknown; senderFrame?: unknown }
interface ResearchIpc { handle(channel: string, handler: (event: ResearchEvent, ...args: any[]) => any): void }
export function setupResearchSearch(ipc: ResearchIpc, trusted: (event: ResearchEvent) => boolean, search = searchParallel): void {
  const pending = new Map<string, AbortController>();
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{32,100}$/.test(id);
  ipc.handle('research:cancel', (event, id: unknown) => {
    if (!trusted(event) || !validId(id)) return false;
    pending.get(id)?.abort();
    return true;
  });
  ipc.handle('research:search', async (event, query: unknown, id: unknown, sessionId: unknown) => {
    if (!trusted(event)) return { error: 'Research is only available to the browser interface.' };
    if (typeof query !== 'string' || !query.trim() || query.length > 2000 || !validId(id) || !validId(sessionId)) return { error: 'Invalid research request.' };
    if (pending.has(id) || pending.size >= 4) return { error: 'Another research request is still running.' };
    const controller = new AbortController();
    pending.set(id, controller);
    try { return { results: await search(query, sessionId, { signal: controller.signal }) }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Parallel search failed.' }; }
    finally { pending.delete(id); }
  });
}
