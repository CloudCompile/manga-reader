# Manga Reader — agent notes

## Project
Next.js 16 app (App Router) at `/workspace/project/manga-reader`. Reader UI is
`src/app/page.tsx`; all scraping lives in `src/lib/sources.ts`. Dev server runs
on port 12000.

## Commands
- Typecheck: `npx tsc --noEmit` (must stay at 0 errors)
- Build: `npx next build`
- Run: `npx next start -p 12000` (build first)

## Architecture
- `src/lib/sources.ts` — one `Source` object per site behind a single
  scrape/list/search/browse API. Fetches try direct first, then fall back to the
  `cors-proxy.christopher-j-hauser2025.workers.dev` worker (`PROXY_BASE`).
- API routes: `/api/scrape`, `/api/chapters`, `/api/search`, `/api/titles`,
  `/api/proxy`. The proxy route is what serves chapter images to the browser.
- `src/lib/storage.ts` — persistence is **cookie-only** (`Secure; SameSite=Lax`)
  with an in-memory fallback. There is no localStorage/IndexedDB/sessionStorage
  and there must never be: the target is constrained Android WebViews where
  cookies are also unreliable, so the in-memory fallback has to keep working
  and nothing may throw.

## Site-specific quirks
- Seven supported sources plus mangafragrant. All except allmanga and
  specterscans host exactly one series per host, so their browse entry comes
  from `browseFromListing` (grouped from the listing page), not a catalogue
  endpoint.
- specterscans.com is the first multi-series catalogue. `fetchList` reads the
  series page (`/series/<slug>`); `fetchChapter` accepts either a chapter URL
  or a bare series URL (which it resolves to the newest readable chapter).
  Page images come from the RSC payload (`"imageUrl"` entries) rather than the
  `<img>` markup, because lazy pages are not always rendered. Search uses
  `/api/search?q=`; browse reads `sitemap.xml` (series + covers) joined with
  `/a-z` for display titles. specterscans.net is the same app under a second
  host with a different slug set (and images under `cdn.specterscans.net/i/`),
  so the source matches both hosts and search returns `.net` hits as well.
- allmanga.to is GraphQL (`api.allanime.day`). A **blank search** (`search: {}`)
  enumerates the catalogue and backs the browse grid. Page images are gated
  behind a captcha, so `fetchChapter` records a `warning` instead of failing.
  Cover paths like `mcovers/...` are relative to `https://cdn.allanime.day/`.
- Several sites leave the *newest* chapter as an empty placeholder ("coming
  soon"). Opening a title therefore probes the top few chapters for images
  before settling — do not assume chapter #1/newest is readable.

## Volumes
No supported site publishes volume numbers (the "vol" strings in their meta
tags are SEO spam). Volume grouping is derived from a title-matched MangaDex
chapter->volume aggregate with a confidence gate (score >= 0.6, >= 4 matched
chapters, >= 25% coverage, >= 2 volumes); reprints/doujinshi are excluded.
When the gate fails, `volumes` is `undefined` and the UI hides the toggle
rather than showing invented groupings. MangaDex coverage is patchy, so the UI
states that not every chapter gets a volume.

## Home shelf

`/api/titles` returns only the hand-picked shelf (`CURATED_TITLES` in
`src/lib/sources.ts`); pass `?all=1` for the full catalogue. The shelf grid
renders covers through `/api/proxy` rather than hotlinking the CDN, so a
blocked or dead cover degrades to the placeholder icon instead of a broken
image. Spectre Scans' sitemap lists a few covers whose filenames contain a
colon; the CDN does not serve those, so they are dropped at listing time.
