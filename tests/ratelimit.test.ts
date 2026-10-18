// The rate limiter guards the expensive scrape endpoints. These exercise the
// real window logic with a fake request, so an off-by-one in the ceiling or a
// missing Retry-After would fail here.
import { rateLimit, clientKey, withRateLimit } from "../src/lib/ratelimit.ts";
import { assert, assertEqual, suite, test } from "./harness.ts";
import type { NextRequest } from "next/server";

function fakeReq(ip: string): NextRequest {
  return { headers: new Headers({ "x-forwarded-for": ip }) } as unknown as NextRequest;
}

export async function run(): Promise<void> {
  suite("ratelimit");

  await test("allows up to the limit then refuses", () => {
    const req = fakeReq("10.0.0.1");
    for (let i = 0; i < 3; i++) {
      const r = rateLimit(req, 3, 60_000);
      assert(r.ok, `request ${i + 1} should be allowed`);
    }
    const over = rateLimit(req, 3, 60_000);
    assert(!over.ok, "the fourth request should be refused");
    assertEqual(over.remaining, 0, "no budget should remain");
    assert(over.retryAfter >= 1, "a Retry-After of at least a second is expected");
  });

  await test("tracks clients separately", () => {
    const a = fakeReq("10.0.0.2");
    const b = fakeReq("10.0.0.3");
    for (let i = 0; i < 2; i++) rateLimit(a, 2, 60_000);
    assert(!rateLimit(a, 2, 60_000).ok, "the first client should be over budget");
    assert(rateLimit(b, 2, 60_000).ok, "the second client should have its own budget");
  });

  await test("the window resets once it elapses", () => {
    const req = fakeReq("10.0.0.4");
    rateLimit(req, 1, 20);
    assert(!rateLimit(req, 1, 20).ok, "should be over budget inside the window");
    const start = Date.now();
    while (Date.now() - start < 25) {
      /* spin until the window has elapsed */
    }
    assert(rateLimit(req, 1, 20).ok, "should be allowed again after the window");
  });

  await test("clientKey prefers x-forwarded-for and falls back", () => {
    assertEqual(clientKey(fakeReq("1.2.3.4, 5.6.7.8")), "1.2.3.4", "the first forwarded hop should be used");
    const bare = { headers: new Headers() } as unknown as NextRequest;
    assertEqual(clientKey(bare), "unknown", "a request without forwarding headers should not throw");
  });

  await test("withRateLimit returns 429 with a Retry-After header", async () => {
    const wrapped = withRateLimit(async () => new Response("ok", { status: 200 }), 1, 60_000);
    const req = fakeReq("10.0.0.5");
    const first = await wrapped(req);
    assertEqual(first.status, 200, "the first call should pass through");
    assertEqual(first.headers.get("X-RateLimit-Remaining"), "0", "the remaining count should be reported");
    const second = await wrapped(req);
    assertEqual(second.status, 429, "the second call should be throttled");
    assert(!!second.headers.get("Retry-After"), "a Retry-After header is required on 429");
  });
}
