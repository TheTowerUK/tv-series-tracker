# TV Series Tracker v1.2 — Artwork & Show Detail

A standalone, static TV-series tracker designed for GitHub Pages. It runs without a backend and stores device-specific edits in LocalStorage while retaining JSON import/export for backups.

## v1.2 additions

- Dedicated **Show Detail** view with larger artwork, synopsis, platform, air date, overall viewing state and season progress.
- Optional **poster URL** support with automatic fallback to a title placeholder if artwork is missing or fails to load.
- Live artwork preview in the Add/Edit dialog.
- Cards now offer **View details** and **Edit** actions; clicking the poster or show title also opens the detail view.
- Season-by-season status is presented more clearly in the detail screen.
- Existing Cards and Compact layouts, filtering, dashboard counts, progressive loading, LocalStorage persistence and JSON backup/import remain intact.

## Running locally

Open `index.html` directly in a modern browser. The baseline catalogue is loaded from `data/shows.js`, so no local web server is required for review.

## GitHub Pages

The project remains fully static and can be published directly from a GitHub repository using GitHub Pages.

## Artwork

Artwork is intentionally optional. Add a direct poster image URL through Edit Show. The tracker never relies on artwork being available and falls back cleanly when an image cannot be loaded.

Automatic artwork/metadata lookup is not included in v1.2; that can be added later without changing the core viewing-progress data.


## v1.3 local TMDB artwork test

The app can optionally search TMDB for TV artwork during local development. Create `config/tmdb.local.js` with:

```js
window.TMDB_CONFIG = { token: "YOUR_TMDB_API_READ_ACCESS_TOKEN" };
```

That file is intentionally excluded from Git. The public GitHub Pages build remains usable without a token; TMDB search is a local test feature until cloud persistence/server-side proxying is introduced.
