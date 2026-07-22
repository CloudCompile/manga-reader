---
Task ID: 2
Agent: Main Agent
Task: Add full features to manga reader - chapters, history, offline, search, keyboard shortcuts, page jumper

Work Log:
- Added `/api/chapters` POST endpoint: scrapes /manga/ listing page, extracts all chapter links for the current series, returns sorted chapter list
- Added `/api/search` GET endpoint: scrapes /manga/ page, groups chapters by series slug (deduped), supports text filtering
- Rewrote entire `page.tsx` with all new features:
  - Chapter list sidebar (slides in from right, shows all available chapters, highlights current)
  - Reading history (localStorage, shows on landing page "Recent" section, full history panel)
  - Keyboard shortcuts: ←/→ for prev/next chapter, T for theme, L for chapter list, G for page jumper, Esc to close panels
  - Page jumper overlay (type page number, press Enter)
  - Live page counter in top bar and bottom nav
  - Offline save/load with IndexedDB (save chapter images for offline reading)
  - Search manga panel from landing page
  - Mobile menu (hamburger with all options)
  - Improved landing page with Recent history, Search/History/Offline buttons
  - Fixed page counter initialization (useEffect on data.images.length)
  - Fixed chapter sidebar toggle (was calling fetchChapterList instead of toggling showChapters)
  - Fixed SidePanel animation (replaced animate-in with inline style)
  - Fixed search dedup (normalize series slug before using as Map key)
- All verified working via agent-browser

Stage Summary:
- All 6 features implemented and tested
- Chapter 182 (22 pages) loads with all features accessible
- Chapter sidebar shows 10 chapters from the listing page
- Search, history, offline panels all open and function correctly
- Page counter tracks current page while scrolling