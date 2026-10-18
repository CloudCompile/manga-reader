# Manga Reader — agent notes

## Project
Next.js 16 app (App Router) at `/workspace/project/manga-reader`. Reader UI is
`src/app/page.tsx`; all scraping lives in `src/lib/sources.ts`. Dev server runs
on port 12000.

## Commands
- Typecheck: `npx tsc --noEmit` (must stay at 0 errors)
- Build: `npx next build`
- Run: `npx next start -p 12000` (build first)

## Releases
Cut a GitHub release at least every 5 commits, so nothing lands without a
tagged, installable point. Tags are `v0.1.<n>` numbered in commit order; `v0.1.0`
through `v0.1.20` already cover the initial history back to the first commit.
Release name is `v0.1.<n> — <commit subject>` and the body is the commit message.
Publish a release (not a draft) so it is installable from GitHub immediately.

```sh
# next number = existing release count
n=$(gh api repos/CloudCompile/manga-reader/releases --paginate -q 'length')
tag="v0.1.$n"
sha=$(git rev-parse HEAD)
gh release create "$tag" --target "$sha" --title "$tag — $(git log -1 --format=%s)" \
  --notes "$(git log -1 --format=%B)"
```

If several commits are unreleased, tag the newest and note the range in the
body rather than skipping the release.

## Architecture
- `src/lib/sources.ts` — one `Source` object per site behind a single
  scrape/list/search/browse API. Fetches try direct first, then fall back to the
  `cors-proxy.christopher-j-hauser2025.workers.dev` worker (`PROXY_BASE`).
- API routes: `/api/scrape`, `/api/chapters`, `/api/search`, `/api/titles`,
  `/api/proxy`. Page images load **directly from the publishing host** by
  default; the proxy is the fallback, not the primary path (see "Images and the
  proxy" below).
  Versioned aliases for the four data routes live under `/api/v1/*` and must
  stay in step with their `/api` counterparts; they are the stable surface.
- `src/lib/legal.ts` + `src/app/{terms,privacy,disclaimer}` + `LICENSE` +
  `DISCLAIMER.md` — the legal surface. `legal.ts` holds the text for all three
  pages so they cannot drift apart, and `LEGAL_CONTACT` is the single contact
  address. The reader links them from the landing footer. If the app's actual
  behaviour changes (for example how images are fetched), the text here must be
  updated with it: a legal page that misdescribes the app is worse than none.
- `src/lib/ratelimit.ts` — in-memory fixed-window limiter (`withRateLimit`).
  Applied to scrape, chapters and search. `/api/proxy` is deliberately exempt:
  one chapter view fetches dozens of images, so a per-request cap there would
  break normal reading. `withRateLimit` is generic over the handler's own
  parameter list so the wrapped export still satisfies Next's route types.
- `src/lib/opds.ts` + `src/app/opds/{,all,shelf,search}` — OPDS catalogue for
  external reader apps. `acquisitionFeed` escapes every field; a raw `&` in a
  title silently breaks the XML, so titles/aliases go through the escaper.
- `src/lib/storage.ts` — persistence is **cookie-only** (`Secure; SameSite=Lax`)
  with an in-memory fallback. There is no localStorage/IndexedDB/sessionStorage
  and there must never be: the target is constrained Android WebViews where
  cookies are also unreliable, so the in-memory fallback has to keep working
  and nothing may throw. History, the reading list, preferences and the
  per-series read map live in one cookie; per-series reader defaults live in
  the prefs cookie. Every field is capped so no cookie exceeds ~4 KB.

## Site-specific quirks
- Eight supported sources. All except allmanga, specterscans and ffb host
  exactly one series per host, so their browse entry comes from
  `browseFromListing` (grouped from the listing page), not a catalogue
  endpoint.
- mangafragrant.com is the original source for The Fragrant Flower Blooms with
  Dignity, but from #183 up its pages resolve to its "return of" upload folder,
  which is a different series, and #195 has no images at all. The source is
  therefore capped at `MANGAFRAGRANT_LAST_GOOD` (182): `parseList` drops the
  broken range, `parseChapter` throws if the URL is past the cap or the images
  live under `return of/`, and the #182 "next" link is rewritten to the next
  chapter on ffb so the reader crosses over instead of landing on another manga.
  Its homepage (not `/manga/`, which lists only the newest ten) carries the full
  back catalogue, including side chapters (.5, .2) that ffb lacks.
- thefragrantflowerbloomswithdignity.com (`ffb`) replaces mangafragrant for the
  recent chapters. Its URLs are `/<slug>-chapter-<n>` at the site root rather
  than under `/manga/` or `/comic/`, so the generic slug/number helpers and
  `chapterLinks` do not apply and the patterns are built explicitly. The chapter
  list comes from the WordPress REST API (`/wp-json/wp/v2/posts`), because the
  homepage omits the published-but-unlinked #199. Page images are filtered to
  the `/wp-content/uploads/manga/<slug>/` path, since the logo and author
  avatar are served from the same host.
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
  returns the newest additions, which is a *recency feed*, not a catalogue: its
  contents change between sessions. There is no working popularity/browse
  endpoint (`queryPopular` needs a non-null `type`+`size`, returns `total: 500`
  but no edges, and introspection is disabled). Page images are gated behind a
  captcha, so `fetchChapter` records a `warning` instead of failing. Cover paths
  like `mcovers/...` are relative to `https://cdn.allanime.day/`.
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

`/api/titles` returns the shelf by default: the hand-picked Spectre titles
(`CURATED_TITLES` in `src/lib/sources.ts`) followed by the single-series sources
(Komi, Blue Box, Dandadan, Oshi No Ko), which are always kept.
AllManga and MangaFragrant are excluded from the shelf
(`SHELF_EXCLUDED_SOURCES`): AllManga's listing churns, and MangaFragrant's
recent chapters belong to another series, so the shelf would offer a broken
copy of a title that ffb already carries in full. Both stay reachable through
the full catalogue and search. The shelf grid loads covers directly from the
CDN, falling back to `/api/proxy` on error, so a blocked or dead cover degrades
to the placeholder icon instead of a broken image. Spectre Scans' sitemap lists
a few covers whose filenames contain a colon; the CDN does not serve those, so
they are dropped at listing time.

Pass `?all=1` for the full catalogue (~1200 titles), which pages server-side via
`offset` (60 per page) and filters by `source` and `q` on the server. The UI's
scope tabs pick between the two: the shelf filters in place, the catalogue
refetches (debounced 250 ms) so the search box searches all ~1200 titles rather
than only the fetched page.

`listTitlesWithHealth` returns `{ titles, sources }`; `sources` reports every
registered source with `ok`/`count`/`error` instead of silently dropping the
ones that threw, and the shelf surfaces the failures with a retry. A registered
source with `count: 0` (currently `chainsawman`) means its listing loaded but
yielded no titles — that is health, not an exception.

## Errors and reader interaction

Failures show as a `Banner` (`banner` state) layered over the current view
rather than replacing it, so a dead cover or a bad URL never costs the reader
their place. Errors auto-dismiss after 8 s, info after 4 s. There is no
full-page error screen.

Clicking the page area scrolls one screen down; only at the last page does it
move to the next chapter, and a click is ignored while text is selected. On
touch, a mostly-horizontal swipe (>60 px, 1.5× the vertical delta) changes
chapter. Both are documented in the shortcuts panel.

## Accessibility conventions

Icon-only buttons carry `aria-label` (not just `title`), toggles carry
`aria-pressed`, the scope tabs use `role="tablist"`/`aria-selected`, and
hand-rolled buttons carry `focus-visible:outline`. New icon buttons should
follow suit. Bars pad for notches with `env(safe-area-inset-*)`, and mobile
controls use `p-2.5` tap targets rather than `p-1.5`.

## Aliases and catalogue ordering

`listCuratedTitlesWithHealth` enriches each shelf entry with alternate titles
from MangaDex (`aliasesFor`), so a romaji or translated name finds the title in
search. The lookups are bounded two ways — concurrency (`ALIAS_CONCURRENCY`) and
an overall deadline (`ALIAS_BUDGET_MS`) — because MangaDex has a low per-IP
budget and the shelf must not wait on it. Entries that miss the deadline simply
carry no aliases. `sortTitles` and `titleMatches` live in `sources.ts` (not the
route) so the Node tests can exercise them without resolving the `@/` alias.

## Images and the proxy

Page images load **directly from the publishing host**. Every supported image
host was probed and serves pages with no `Referer` check and no CORS
requirement, so the browser can load them itself, which avoids a double hop and
means the app links to material instead of retransmitting it. `DIRECT_IMAGES`
in `src/app/page.tsx` flips the whole app back to proxy-only if a host starts
refusing direct loads.

`imageSrc` / `proxyFallback` / `handleImageError` implement the fallback: an
`<img>` starts on the direct URL, and on error is retried once through
`/api/proxy`, with the host recorded in `DIRECT_BLOCKED` for the session so
later images from it skip straight to the proxy. `handleImageError` refuses to
retry a URL that is already a proxy URL, which is what stops an infinite
`onError` loop when the proxy itself fails. `prefetchChapterPages` does the
same dance with `fetch` so the HTTP cache is filled directly where possible.

## PWA / offline

`src/app/manifest.ts` and `public/sw.js` make the app installable. The service
worker caches the shell (network-first, so a new build is never masked by a
stale one) and page images (cache-first, bounded to `MAX_IMAGES`). It caches
both the proxied responses and the direct cross-origin image responses
(`destination === "image"` and a foreign origin), so offline reading still works
now that images come straight from the host. Only `image/*` responses are
cached, so a 502 error body is never pinned. The reader's "Cache" button
(`prefetchChapterPages`) deliberately pulls every page of the open chapter.
`ServiceWorkerRegistrar` registers it best-effort and swallows every failure,
since a browser without service workers must keep working.

## Reader and theming

All reader and shelf state lives in `src/lib/storage.ts`, which writes a single
`Secure` cookie rather than using `localStorage` (some WebViews stub it out).
That covers theme, fit mode, two-page mode, history and the last page reached
in each chapter. Adding persisted state means extending `StoredState` and
`parseState` together, since a missing field silently falls back to its default.

Theme is applied per-element through the `isDark` ternaries in `page.tsx`
rather than a global dark-mode class, so any new surface needs both branches —
a hardcoded `text-white` disappears in light mode. `bg`, `textCol`, `subText`,
`barBg`, `panelBg` and `hoverBg` are the shared tokens to reuse.

Wide mode renders `pageGroups`, which pairs consecutive pages; the pairing is
why page lookup in the scroll handler indexes images rather than groups. Bars
hide on downward scroll via `chromeHidden` and reveal on any upward move.
