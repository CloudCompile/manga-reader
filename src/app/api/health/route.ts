// Live source health. Unlike the fixture tests this hits the real sites, so it
// is meant to run on a schedule rather than on every request: it reports which
// sources still return page images and which have rotted.

import { NextResponse } from "next/server";
import { checkAllSources } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await checkAllSources();
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json(
    { checkedAt: new Date().toISOString(), ok: failed.length === 0, results },
    // 503 makes a failing check visible to uptime tooling without a body parse.
    { status: failed.length === 0 ? 200 : 503 }
  );
}
