// Entry point: `node tests/all.ts`. Each module exports run().
import { summary } from "./harness.ts";
import * as cache from "./cache.test.ts";
import * as storage from "./storage.test.ts";
import * as sources from "./sources.test.ts";
import * as ratelimit from "./ratelimit.test.ts";
import * as opds from "./opds.test.ts";
import * as titles from "./titles.test.ts";
import * as anime from "./anime.test.ts";

async function main(): Promise<void> {
  for (const mod of [cache, storage, sources, ratelimit, opds, titles, anime]) {
    await mod.run();
  }
  process.exit(summary());
}

main();
