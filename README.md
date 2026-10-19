# Manga Reader
ehehe
Ad-free manga reader. Paste a chapter URL from any supported site and read clean.

## Supported sources

| Site | Notes |
|------|-------|
| mangafragrant.com | The Fragrant Flower Blooms with Dignity, back catalogue only (#182 and below); its newer chapters belong to another series |
| thefragrantflowerbloomswithdignity.com | The Fragrant Flower Blooms with Dignity, full series (204 chapters + .5 extras) |
| komicantcommunicatechapters.website | |
| blue-box-manga.online | |
| dandadana.com | |
| readoshino.com | |
| onlinechainsawmanmanga.us | Origin is frequently offline (HTTP 522) |
| specterscans.com / specterscans.net | Multi-series catalogue; browse, search, and reader all work |
| allmanga.to | Chapter lists and search work; page images require solving the site's captcha |

## Features

- Full vertical-scroll reader with image proxying
- Dark / Light theme toggle
- Fit modes: Width, Height, Original
- Chapter list sidebar (auto-fetched) with a filter, jump-to-chapter, read
  ticks, and a "next unread" shortcut
- Per-series reader defaults: RTL, fit mode, layout and two-page spread are
  remembered for each title
- Reading-progress badges on the shelf, showing the last chapter and page
- Reading stats (chapters, pages, day streak, top sources) and one-tap clear
- Search across all sources, including alternate and romanised titles
- Catalogue sorting (title, chapter count, latest chapter) and a filter that
  hides empty placeholder entries
- Reading history
- Page jumper with keyboard shortcuts
- Whole-chapter prefetch ("Cache") for offline reading
- Installable PWA: manifest, home-screen icon, and a service worker that keeps
  an offline app shell and caches pages already read
- Mobile responsive
- Manga details panel: description, authors, genres, status and cover for the
  open series, resolved from MangaDex with a confidence gate
- Watch the anime: matches the open series to its anime, lists the episodes, and
  plays them in a built-in HLS player (sub and dub servers, server switching,
  episode list, previous/next)
- Storage works on constrained browsers: state is kept in a `Secure` cookie
  with an in-memory fallback, so it never depends on `localStorage`,
  `IndexedDB`, or cookie support.

## Storage

Reading history, the last-read chapter, the theme choice, per-series reader
defaults, and per-series read progress are persisted in `Secure; SameSite=Lax`
cookies. Browsers and Android WebView builds that block cookies or lack
`localStorage` / `IndexedDB` still work: the reader falls back to in-memory
state for the current session instead of throwing. Every cookie is capped so it
stays inside the ~4 KB browser limit.

## API

The current routes live under `/api`; versioned aliases live under `/api/v1`
and behave identically. The versioned paths are the stable surface to build
against.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/scrape` | POST | Scrape a chapter's pages (`{ url }`) |
| `/api/chapters` | POST | List a series' chapters (`{ url }`) |
| `/api/search` | GET | Search every source (`?q=`) |
| `/api/titles` | GET | Shelf by default; `?all=1` pages the full catalogue (`offset`, `source`, `q`, `sort`, `hideEmpty`) |
| `/api/proxy` | GET | Stream a page image (`?url=`); exempt from rate limiting |
| `/api/details` | GET | Series metadata from MangaDex (`?title=`) |
| `/api/anime/search` | GET | Search anime titles (`?q=`) |
| `/api/anime/info` | GET | Anime metadata (`?id=`) |
| `/api/anime/episodes` | GET | Episode list (`?id=`) |
| `/api/anime/stream` | GET | Resolve an episode to a playable stream (`?id=`, optional `server=`) |
| `/api/anime/hls` | GET | Relay an HLS playlist or segment (`?url=`); exempt from rate limiting |
| `/api/anime/watch` | GET | Match a manga title to its anime, with episodes (`?title=`, `aliases=`, or `id=`) |

Scrape, chapter-list and search routes are rate limited per client
(30 requests/minute, 60 for chapter lists) and return `429` with `Retry-After`
when over budget. Image proxying is deliberately not limited, since one chapter
view legitimately fetches dozens of images. The anime HLS relay is exempt for
the same reason: one episode pulls many segments.

## Anime

The "Watch the anime" action matches the open manga to an anime through an
external anime API (`ANIME_API`, default `https://animeapi.cjhauser.me`) and
plays it in the built-in player. Matching is by normalised title overlap, tried
against the scraped title and any MangaDex aliases; a match must clear a
confidence threshold, and anything weaker shows the closest search hits so the
reader can pick the right one.

Streams are HLS. The CDN pins `Access-Control-Allow-Origin` to the provider's
own player, so the browser cannot fetch a playlist or segment directly. The
`/api/anime/hls` route relays both, rewriting every child URI (and any
`EXT-X-KEY` URI) to point back through itself, so the player only ever talks to
our origin. `hls.js` drives playback where native HLS is missing (Chrome,
Firefox, Android WebView); Safari and iOS use the native player. When an episode
has no playlist the upstream iframe embed is used as a last resort.

## OPDS

An [OPDS](https://opds.io/) catalogue is served for external reader apps:

| Feed | URL |
|------|-----|
| Navigation | `/opds` |
| Shelf | `/opds/shelf` |
| Full catalogue | `/opds/all` (paged, 100 per page) |
| Search | `/opds/search?q=` |


## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/CloudCompile/manga-reader)

## Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` `→` | Previous / Next chapter |
| `T` | Toggle theme |
| `L` | Toggle chapter list |
| `S` | Save to reading list |
| `W` | Two-page spread |
| `F` | Fullscreen |
| `G` | Jump to page |
| `?` | Shortcut help |
| `Esc` | Close panels |

## Tests

```bash
npm test        # storage, sources, cache, rate limiter, OPDS, catalogue order, anime
npm run typecheck
```

## Notes for contributors

See [AGENTS.md](./AGENTS.md) for the architecture, the site-specific scraper
quirks, and the release process.
