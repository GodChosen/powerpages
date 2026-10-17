(function (root) {
  'use strict';
  function abort() {
    return new DOMException('Cancelled', 'AbortError');
  }
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abort());
      const stop = () => {
        clearTimeout(timer);
        reject(abort());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', stop);
        resolve();
      }, ms);
      signal?.addEventListener('abort', stop, { once: true });
    });
  }
  function retryDelay(value, attempt, now = Date.now()) {
    if (value !== null && value !== undefined) {
      const s = String(value).trim();
      const parsed = /^\d+(\.\d+)?$/.test(s) ? Number(s) * 1000 : Date.parse(s) - now;
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return Math.min(8000, 500 * 2 ** attempt);
  }
  function client(base, signal, fetcher = fetch, sleep = delay) {
    const api = new URL('/api/data/v9.2/', base);
    async function get(path) {
      const url = new URL(path, api);
      if (
        url.origin !== api.origin ||
        !url.pathname.startsWith(api.pathname) ||
        url.username ||
        url.password ||
        url.hash
      )
        throw Error('Rejected paging URL outside this environment API');
      for (let attempt = 0; attempt < 4; attempt++) {
        if (signal?.aborted) throw abort();
        const r = await fetcher(url.href, {
          signal,
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'OData-MaxVersion': '4.0',
            'OData-Version': '4.0',
            Prefer:
              'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=500',
          },
        });
        if (r.ok) return r.json();
        if ([429, 502, 503, 504].includes(r.status) && attempt < 3) {
          const wait = retryDelay(r.headers?.get('Retry-After'), attempt);
          if (wait > 60000)
            throw Error(r.status + ': Retry-After exceeds 60 seconds; rescan later');
          await sleep(wait, signal);
          continue;
        }
        throw Error(`${r.status}: ${(await r.text()).slice(0, 400)}`);
      }
    }
    async function all(path) {
      const out = [],
        seen = new Set();
      while (path) {
        if (seen.has(path)) throw Error('Repeated paging link');
        seen.add(path);
        const d = await get(path);
        if (!Array.isArray(d.value)) throw Error('Unexpected collection response');
        out.push(...d.value);
        path = d['@odata.nextLink'];
      }
      return out;
    }
    return { get, all };
  }
  const api = { client, retryDelay, delay };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DETransport = api;
})(globalThis);
