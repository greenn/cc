# CC — Comment Collection

CC is a local-first comment reader for links from external platforms.

```text
blank/ui/   original visual reference
app/        working GitHub Pages application
```

## Open online

```text
https://greenn.github.io/cc/
```

The original UI reference:

```text
https://greenn.github.io/cc/blank/ui/
```

## Supported sources

### YouTube

Working integration through YouTube Data API v3.

Supported URL families include standard videos, `youtu.be`, Shorts, embeds and live URLs when a video ID is present.

Comments are loaded by API pages of 50.

### Instagram

Post/reel URLs are recognized, but comment loading still needs an authenticated official API or browser/local helper.

### Holywarsoo forum

Supported URL shape:

```text
https://holywarsoo.net/viewtopic.php?id=<topicId>&p=<page>
```

Forum loading follows a different rule from API sources:

- one real forum page is one loading batch;
- if the supplied URL starts at `p=31`, CC starts at page 31;
- every post from that page is imported;
- the next batch is `p=32`, then `p=33`, etc.;
- forum post IDs/permalinks are used for deduplication when available.

The browser first tries to read the public forum page directly. If cross-origin browser rules block that request, the adapter falls back to Jina Reader in HTML mode for the same public URL.

Forum rules for future adapters are documented in:

```text
app/platforms/FORUMS.md
```

## Reader features

- infinite loading;
- automatic Read when a comment crosses the center reading line while scrolling down;
- Comments / Unread / Saved / Deleted filters;
- global All / Saved / Read / Deleted views;
- search by text, author and username;
- sorting;
- Save;
- soft Delete and Restore;
- right-side comment details;
- per-comment notes;
- last reading position per source;
- keyboard actions J / K / S / D / O;
- local user states preserved when source data is refreshed.

## YouTube API key

CC uses YouTube Data API v3 for public video metadata and comments.

1. Open Google Cloud Console.
2. Create or select a project.
3. Open **APIs & Services → Library**.
4. Find and enable **YouTube Data API v3**.
5. Open **APIs & Services → Credentials**.
6. Choose **Create credentials → API key**.
7. Restrict the key to **YouTube Data API v3**.
8. Open CC → **Settings**.
9. Paste the key into **YouTube Data API key** and save.

The key is stored only in browser `localStorage`; it is not committed to this repository.

For the public GitHub Pages deployment, also restrict the key by HTTP referrer where practical.

## Storage

The GitHub Pages version stores state in browser `localStorage`.

A future Electron build can replace this with SQLite while keeping the same source/comment models.

## Main files

```text
app/
├── index.html
├── styles.css
├── app.js
├── store.js
├── ARCHITECTURE.md
└── platforms/
    ├── FORUMS.md
    ├── holywarsoo.js
    ├── youtube.js
    └── instagram.js
```

## Development

No build step is required for the current Pages version. Serve it over HTTP because ES modules should not be opened through `file://`.

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/app/
```
