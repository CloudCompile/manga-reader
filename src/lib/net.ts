// Shared outbound-fetch safety helpers.
//
// Every server route that streams bytes from a third-party host (the image
// proxy, the HLS proxy) has to answer the same two questions: is this URL
// allowed to be fetched at all, and can the body be read without exhausting
// memory. Both are answered here so the checks cannot drift between routes.

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// Redirect chains are followed by hand so every hop can be re-checked; this is
// the ceiling on how many we follow.
export const MAX_REDIRECTS = 5;

// Blocks loopback, link-local and private ranges so a caller-supplied URL
// cannot be used to reach the deployment's own network or a metadata endpoint.
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// Parses a URL, rejecting non-http(s) schemes and private hosts. Returns null
// rather than throwing so callers can answer 400 with a clear message.
export function okPublicUrl(raw: string, base?: string): URL | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (isPrivateHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

async function fetchOnce(url: string, referer: string, accept: string, extra?: HeadersInit): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": UA, Referer: referer, Accept: accept, ...(extra as Record<string, string> | undefined) },
    cache: "no-store",
    redirect: "manual",
  });
}

// Follows redirects one hop at a time, refusing any hop that lands on a private
// address. `fetch` with the default redirect mode would follow a public URL to
// 127.0.0.1 (or a cloud metadata endpoint) without ever re-running the check.
export async function fetchFollowingSafe(
  url: URL,
  referer: string,
  accept = "image/avif,image/webp,image/*,*/*;q=0.8",
  extra?: HeadersInit
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const resp = await fetchOnce(current.href, referer, accept, extra);
    const isRedirect = resp.status >= 300 && resp.status < 400;
    if (!isRedirect) return resp;
    const location = resp.headers.get("location");
    if (!location) return resp;
    const next = okPublicUrl(location, current.href);
    if (!next) throw new Error("Redirect left the public internet");
    current = next;
  }
  throw new Error("Too many redirects");
}

// Reads the body while enforcing a byte ceiling, so an endless or oversized
// upstream cannot exhaust memory. Returns null when the limit is exceeded.
export async function readCapped(resp: Response, limit: number): Promise<ArrayBuffer | null> {
  const declared = Number(resp.headers.get("content-length") || "0");
  if (declared > limit) return null;
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    return buf.byteLength > limit ? null : buf;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
