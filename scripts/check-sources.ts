// Live source-health check. Run by the scheduled workflow, and usable locally:
//
//   node --import ./tests/register.mjs scripts/check-sources.ts
//
// It opens one real chapter per source through the same scrape path the reader
// uses. Exits non-zero if any source returns no pages, so a rotted source fails
// the job instead of going unnoticed.

import { checkAllSources } from "../src/lib/sources.ts";

const results = await checkAllSources();

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  ok   ${r.id.padEnd(14)} ${r.images} pages`);
  } else {
    failed++;
    console.log(`  FAIL ${r.id.padEnd(14)} ${r.error}`);
    console.log(`       ${r.url}`);
  }
}

console.log(`\n${results.length - failed}/${results.length} sources healthy`);
process.exit(failed ? 1 : 0);
