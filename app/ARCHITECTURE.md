# CC architecture

## Purpose

`app/` is the first working implementation of CC — Comment Collection. It turns the existing `blank/ui` reference into an interactive comment reader that can be opened directly from GitHub Pages.

The original reference remains unchanged in `blank/ui/`.

## Runtime layout

```text
AppShell
├── LeftPanel
│   ├── Brand
│   ├── MainNavigation
│   ├── Sources
│   └── Settings / Help
├── Workspace
│   ├── TopMenu
│   │   ├── Filters
│   │   ├── Search
│   │   └── Sorting
│   └── CentralContent
│       ├── Source header
│       ├── CommentList
│       └── Infinite-load sentinel
└── RightPanel
    ├── Comment identity
    ├── Info
    └── Notes
```

## Data flow

```text
URL
 ↓
adapterForUrl()
 ↓
Platform adapter
 ↓
unified Source / Comment model
 ↓
store.js
 ↓
UI
```

The UI does not contain YouTube-specific fetching logic.

## Platform adapters

`platforms/youtube.js`

- recognizes watch, youtu.be and Shorts URLs;
- loads video metadata with YouTube Data API v3;
- loads comment threads in pages of 50;
- maps YouTube data to the shared comment shape;
- exposes `nextCursor` / `hasMore`.

`platforms/instagram.js`

- recognizes post/reel URLs;
- creates a source record;
- defines the same adapter boundary;
- intentionally does not scrape Instagram from the browser. Loading comments requires an authenticated official API or a future browser/helper bridge.

## Local state

The GitHub Pages build uses `localStorage` so that it can run as a static application without a backend.

Stored state:

- sources;
- loaded comments;
- YouTube API key;
- read state and timestamp;
- saved state and timestamp;
- deleted state and timestamp;
- user notes;
- last visible comment for each source;
- pagination cursor.

Platform refresh merges network data with existing local user state. `read`, `saved`, `deleted` and `note` are preserved.

## Read detection

Comment cards are observed with `IntersectionObserver` whose effective root is a narrow band around the vertical center of the scroll container. When the user scrolls downward and a non-deleted comment crosses that band, the comment becomes read.

Simply loading a comment does not mark it read.

## Infinite loading

A sentinel is observed near the end of the list with a preload margin. When it approaches the viewport, the next platform page is requested. YouTube pages use 50 comments.

## Keyboard actions

- `J`: next rendered comment;
- `K`: previous rendered comment;
- `S`: save/unsave selected comment;
- `D`: delete selected comment;
- `O`: open original selected comment.

Shortcuts are ignored inside input and textarea elements.

## Current implementation boundary

This version is deliberately deployable as static GitHub Pages. It therefore uses browser local storage rather than SQLite/Electron.

A desktop version can keep the same platform/domain concepts and replace `store.js` with an IPC-backed SQLite repository. The UI and adapter model do not need to be rewritten for that migration.

For very large fully-loaded datasets, a later desktop build should add list virtualization (for example TanStack Virtual) rather than rendering every locally loaded comment.
