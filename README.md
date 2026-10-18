# Manga Reader

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

- Full vertical-scroll reader; page images load directly from the publishing
  host, with an automatic proxy fallback for hosts that block it
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
- Legal pages: `/terms`, `/privacy`, and `/disclaimer`, linked from the footer
- Mobile responsive
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

Scrape, chapter-list and search routes are rate limited per client
(30 requests/minute, 60 for chapter lists) and return `429` with `Retry-After`
when over budget. Image proxying is deliberately not limited, since one chapter
view legitimately fetches dozens of images.

### Images and the proxy

Page images are loaded by the browser **directly from the publishing host**.
Every supported image host was checked and serves its pages with no `Referer`
check and no CORS requirement, so a direct load works and avoids a double hop
through this server. That is also the honest architecture: the reader links to
material rather than retransmitting it.

`/api/proxy` still exists and is used automatically when a direct load fails —
a host that later adds a hotlink or CORS restriction. The `<img>` `onError`
handler retries that image through the proxy and remembers the host for the
rest of the session. The proxy fetches and forwards the image; it is not a
content store.

Set `DIRECT_IMAGES = false` in `src/app/page.tsx` to route every image through
the proxy instead, which is the previous behaviour.

## Legal

This is an unofficial reader. It hosts no manga; it indexes third-party sites
and loads the images those sites publish. See [`LICENSE`](LICENSE) (MIT, code
only), [`DISCLAIMER.md`](DISCLAIMER.md), and the `/terms`, `/privacy`, and
`/disclaimer` pages for the full statements. Takedown and other legal contact:
christopher.j.hauser2025@outlook.com.

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
npm test        # storage, sources, cache, rate limiter, OPDS, catalogue order
npm run typecheck
```

## Notes for contributors

See [AGENTS.md](./AGENTS.md) for the architecture, the site-specific scraper
quirks, and the release process.