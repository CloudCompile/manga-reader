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
  `ANIME_API` (the anime service base) lives here too, so it is overridable the
  same way.
- API routes: `/api/scrape`, `/api/chapters`, `/api/search`, `/api/titles`,
  `/api/proxy`. The proxy route is what serves chapter images to the browser.
  Versioned aliases for the data routes live under `/api/v1/*` and must
  stay in step with their `/api` counterparts; they are the stable surface.
  A new route means a matching `src/app/api/v1/<same path>/route.ts` that just
  re-exports `GET`.
- `src/lib/net.ts` — the shared outbound-fetch guards: `okPublicUrl` /
  `isPrivateHost` (SSRF), `fetchFollowingSafe` (manual redirects, each hop
  re-checked), and `readCapped` (byte ceiling). `/api/proxy` and
  `/api/anime/hls` both use these; do not hand-roll a private-host check in a
  route, and do not use `redirect: "follow"`, which skips the per-hop check.
- `src/lib/ratelimit.ts` — in-memory fixed-window limiter (`withRateLimit`).
  Applied to scrape, chapters and search. `/api/proxy` is deliberately exempt:
  one chapter view fetches dozens of images, so a per-request cap there would
  break normal reading. `withRateLimit` is generic over the handler's own
  parameter list so the wrapped export still satisfies Next's route types.
  `/api/anime/hls` is exempt for the same reason — one episode pulls many
  segments.
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
the full catalogue and search. The shelf grid renders covers through
`/api/proxy` rather than hotlinking the CDN, so a blocked or dead cover degrades
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

## Anime integration

`src/lib/anime.ts` is the only place that talks to the anime API. Everything it
returns is parsed defensively (`parseSearchItem`, `parseAnimeInfo`,
`parseEpisodes`, `parseStream` are pure and tested) because the upstream JSON is
shallow and loosely typed — an unrecognised shape yields "no match", never a
throw.

- Matching a manga to an anime is `findAnimeMatch`, by normalised title overlap
  (`titleSimilarity`, with a whole-word prefix boost and a leading-article
  strip). It needs a score of 0.6+; below that `/api/anime/watch` returns
  `matched: false` plus the raw search hits so the picker can offer the closest
  entries. Passing `?id=` to `/api/anime/watch` skips matching entirely.
- Episode ids from the API already carry the `?ep=` suffix; pass them back
  verbatim, do not rebuild them.
- Streaming is HLS. The CDN sets `Access-Control-Allow-Origin` to the provider's
  own player, so the browser cannot fetch playlists or segments directly.
  `/api/anime/hls` relays them and rewrites every child URI (and any
  `EXT-X-KEY` URI) through itself, so the player stays on our origin. Playlists
  and segments are both labelled `image/jpeg`, so `isPlaylist` sniffs the body
  (`#EXTM3U`) instead of trusting the content type.
- The player (`src/components/anime-player.tsx`) prefers `hls.js` where native
  HLS is missing and falls back to the native `<video>` on Safari/iOS. When an
  episode has no playlist, the upstream iframe embed is the last resort.
- Manga details (`mangaDetails` in `sources.ts`) come from MangaDex through the
  same `findMangaDexMatch` gate the volume grouping uses. Note the single-manga
  endpoint returns `data` as an **object**, unlike the list endpoint's array.

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

## PWA / offline

`src/app/manifest.ts` and `public/sw.js` make the app installable. The service
worker caches the shell (network-first, so a new build is never masked by a
stale one) and proxied page images (cache-first, bounded to `MAX_IMAGES`). Only
`image/*` responses are cached, so a 502 error body is never pinned. The
reader's "Cache" button (`prefetchChapterPages`) deliberately pulls every page of
the open chapter through the proxy. `ServiceWorkerRegistrar` registers it
best-effort and swallows every failure, since a browser without service workers
must keep working.

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
