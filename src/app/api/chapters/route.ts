import { NextRequest, NextResponse } from "next/server";
import { fetchChapterList, isSupported } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    if (!isSupported(url)) {
      return NextResponse.json({ error: "This site is not supported yet." }, { status: 400 });
    }

    const data = await fetchChapterList(url);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Chapter list error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch chapters";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
