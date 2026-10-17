# Manga Reader

Ad-free manga reader. Paste a chapter URL from any supported site and read clean.

## Supported sources

| Site | Notes |
|------|-------|
| mangafragrant.com | |
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
- Chapter list sidebar (auto-fetched)
- Search across all sources
- Reading history
- Page jumper with keyboard shortcuts
- Mobile responsive
- Storage works on constrained browsers: state is kept in a `Secure` cookie
  with an in-memory fallback, so it never depends on `localStorage`,
  `IndexedDB`, or cookie support.

## Storage

Reading history, the last-read chapter, and the theme choice are persisted in a
single `Secure; SameSite=Lax` cookie. Browsers and Android WebView builds that
block cookies or lack `localStorage` / `IndexedDB` still work: the reader falls
back to in-memory state for the current session instead of throwing.

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
| `G` | Jump to page |
| `Esc` | Close panels |