// The cache must expire on read and never grow past its ceiling, in entries or
// in bytes. Both were previously unbounded.
import { TtlCache } from "../src/lib/cache.ts";
import { assert, assertEqual, suite, test } from "./harness.ts";

export async function run(): Promise<void> {
  suite("cache");

  await test("expires entries once the TTL passes", () => {
    const c = new TtlCache<string, number>({ ttlMs: 10, maxEntries: 10 });
    c.set("a", 1);
    assertEqual(c.get("a"), 1, "fresh entry should be readable");
    const start = Date.now();
    while (Date.now() - start < 15) {
      /* spin until the TTL has elapsed */
    }
    assertEqual(c.get("a"), undefined, "expired entry should be dropped");
    assertEqual(c.size, 0, "expired entry should be removed, not just hidden");
  });

  await test("evicts the least recently used entry past maxEntries", () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000, maxEntries: 3 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    // Touch "a" so "b" becomes the least recently used.
    c.get("a");
    c.set("d", 4);
    assertEqual(c.size, 3, "size should stay at the ceiling");
    assertEqual(c.get("b"), undefined, "LRU entry should be evicted");
    assertEqual(c.get("a"), 1, "recently read entry should survive");
    assertEqual(c.get("d"), 4, "new entry should be present");
  });

  await test("evicts by total bytes as well as entry count", () => {
    const c = new TtlCache<string, Uint8Array>({
      ttlMs: 1000,
      maxEntries: 100,
      maxBytes: 100,
      sizeOf: (v) => v.byteLength,
    });
    c.set("a", new Uint8Array(60));
    c.set("b", new Uint8Array(60));
    assertEqual(c.size, 1, "byte ceiling should drop the oldest value");
    assertEqual(c.get("b")?.byteLength, 60, "newest value should remain");
    assertEqual(c.get("a"), undefined, "oldest value should be evicted");
  });

  await test("re-setting a key does not double-count its size", () => {
    const c = new TtlCache<string, Uint8Array>({
      ttlMs: 1000,
      maxEntries: 10,
      maxBytes: 150,
      sizeOf: (v) => v.byteLength,
    });
    c.set("a", new Uint8Array(100));
    c.set("a", new Uint8Array(100));
    // If the replaced value were still counted the total would be 200 and the
    // entry would evict itself.
    assert(c.get("a") !== undefined, "replaced entry should still be present");
    assertEqual(c.size, 1, "only one entry should exist");
  });
}
