/** HTTP helper with rate limit, retry, and secret redaction for exchange/RPC calls. */

export type FetchFn = typeof globalThis.fetch;

export type HttpClientOptions = {
  fetchFn?: FetchFn;
  minIntervalMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
};

const SECRET_PATTERNS = [
  /api[_-]?key[=:]\s*[\w-]+/gi,
  /api[_-]?secret[=:]\s*[\w+/=]+/gi,
  /signature[=:]\s*[\w+/=]+/gi,
  /nonce[=:]\s*\d+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat, (m) => m.split(/[=:]/)[0]! + "=[REDACTED]");
  }
  return out;
}

export class HttpClient {
  private lastRequestAt = 0;
  private readonly fetchFn: FetchFn;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(opts: HttpClientOptions = {}) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.minIntervalMs = opts.minIntervalMs ?? 200;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.throttle();
      try {
        const res = await this.fetchFn(url, init);
        if (res.status === 429 || res.status >= 500) {
          if (attempt < this.maxRetries) {
            await new Promise((r) => setTimeout(r, this.retryDelayMs * (attempt + 1)));
            continue;
          }
        }
        return res;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs * (attempt + 1)));
        }
      }
    }
    throw lastErr ?? new Error("HTTP request failed");
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(url, init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${redactSecrets(text.slice(0, 500))}`);
    }
    return JSON.parse(text) as T;
  }
}
