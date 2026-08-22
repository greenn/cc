# CC — Comment Collection

CC is a local-first comment reader for links from external platforms.

The repository contains two layers:

```text
blank/ui/   original visual reference
app/        working GitHub Pages application
```

## Open online

When GitHub Pages is enabled for the `main` branch root:

```text
https://greenn.github.io/cc/
```

The root redirects to:

```text
https://greenn.github.io/cc/app/
```

The original UI reference remains available at:

```text
https://greenn.github.io/cc/blank/ui/
```

## What works in v0.1

- add YouTube links;
- parse standard YouTube, youtu.be and Shorts URLs;
- fetch video metadata;
- fetch comments by pages of 50;
- infinite loading;
- mark comments read when they cross the middle of the reading viewport while scrolling down;
- filters: Comments / Unread / Saved / Deleted;
- global All / Saved / Read / Deleted views;
- search by text, author and username;
- sort by source order, date, likes and replies;
- save comments;
- soft-delete and restore comments;
- select a comment and inspect it in the right panel;
- per-comment notes with automatic local persistence;
- remember the last visible comment per source;
- keyboard actions J / K / S / D / O;
- preserve local user state when refreshing source data;
- add Instagram post/reel links as prepared sources.

## YouTube setup

CC uses YouTube Data API v3.

1. Create a Google Cloud project.
2. Enable **YouTube Data API v3**.
3. Create an API key.
4. Open CC.
5. Open **Settings**.
6. Paste the key into **YouTube Data API key**.

The key is stored only in browser `localStorage`. Do not commit API keys to this repository.

For a public deployment, restrict the key by HTTP referrer and by API in Google Cloud Console.

## Instagram

The application recognizes Instagram post/reel URLs and already has a separate platform adapter.

Direct browser scraping is not used. Comment loading needs one of these future integrations:

- authenticated official API;
- browser extension/helper that can use an authenticated browser session;
- local desktop helper.

The rest of the UI does not need to change when that adapter is implemented.

## Storage

The GitHub Pages version is a static browser application and stores state in `localStorage`.

A future Electron build should replace this storage adapter with SQLite while keeping the same source/comment models.

## Files

```text
app/
├── index.html
├── styles.css
├── app.js
├── store.js
├── ARCHITECTURE.md
└── platforms/
    ├── youtube.js
    └── instagram.js
```

## Development

No build step is required for the current Pages version. Serve the repository through an HTTP server because ES modules should not be opened through `file://`.

Example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/app/
```

## Next technical step

For the desktop version:

- Electron + React + TypeScript;
- SQLite + Drizzle;
- IPC storage repository;
- virtualized list for very large local datasets;
- authenticated Instagram helper/adapter.

See `app/ARCHITECTURE.md` for the current boundaries.
