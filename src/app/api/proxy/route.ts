import { NextRequest, NextResponse } from "next/server";

const IMAGE_CACHE = new Map<string, { buf: ArrayBuffer; ct: string; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

export async function GET(req: NextRequest) {
  const imgUrl = req.nextUrl.searchParams.get("url");
  if (!imgUrl) return NextResponse.json({ error: "url param required" }, { status: 400 });

  // Validate it looks like an image URL
  if (!/\.(jpe?g|png|webp|gif|avif)/i.test(imgUrl)) {
    return NextResponse.json({ error: "not an image URL" }, { status: 400 });
  }

  const cached = IMAGE_CACHE.get(imgUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return new NextResponse(cached.buf, {
      headers: {
        "Content-Type": cached.ct,
        "Cache-Control": "public, max-age=1800",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  try {
    const resp = await fetch(imgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: "https://www.mangafragrant.com/",
      },
    });

    if (!resp.ok) return new NextResponse("Image fetch failed", { status: resp.status });

    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("content-type") || "image/jpeg";

    IMAGE_CACHE.set(imgUrl, { buf, ct, ts: Date.now() });

    return new NextResponse(buf, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=1800",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 500 });
  }
}