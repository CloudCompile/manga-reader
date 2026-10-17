// Bounded, TTL'd cache used by the scrape pipeline and the image proxy.
//
// A plain Map with a timestamp only forgets an entry when that same key is read
// again after expiry, so on a long-lived server it grows without limit. This
// keeps a hard ceiling on entry count (and, when a size is supplied, on total
// bytes) while still expiring entries on read.

export interface TtlCacheOptions<V> {
  ttlMs: number;
  maxEntries: number;
  // When set, the cache also caps the summed size of its values.
  maxBytes?: number;
  sizeOf?: (value: V) => number;
}

export class TtlCache<K, V> {
  private map = new Map<K, { value: V; expires: number }>();
  private bytes = 0;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (value: V) => number;

  constructor(opts: TtlCacheOptions<V>) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries;
    this.maxBytes = opts.maxBytes ?? Infinity;
    this.sizeOf = opts.sizeOf ?? (() => 0);
  }

  get(key: K): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.drop(key, hit.value);
      return undefined;
    }
    // Re-insert so Map order tracks recency and the oldest key is the LRU.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) this.drop(key, existing.value);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    this.bytes += this.sizeOf(value);
    this.evict();
  }

  get size(): number {
    return this.map.size;
  }

  private drop(key: K, value: V): void {
    this.map.delete(key);
    this.bytes -= this.sizeOf(value);
    if (this.bytes < 0) this.bytes = 0;
  }

  private evict(): void {
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const key = oldest.value;
      const entry = this.map.get(key)!;
      this.drop(key, entry.value);
    }
  }
}
