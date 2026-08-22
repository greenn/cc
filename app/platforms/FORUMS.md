# Forum source rules

These rules are part of the CC project architecture and should be kept when new forums are added.

## Core rule

For classic paginated forums, **one forum page is one loading batch**.

Do not arbitrarily split a forum page into 10 or 50 posts.

If a topic URL is:

```text
viewtopic.php?id=123&p=31
```

then CC starts from forum page `31`, loads every post visible on that page, and the next cursor is forum page `32`.

## Generic forum behavior

1. A source represents one topic/thread, not one individual page.
2. Keep the topic/thread ID as the stable external source ID.
3. Preserve the page number from the URL supplied by the user as `startPage`.
4. Load all posts from `startPage` as one batch.
5. Continue with the next real forum page when the user reaches the end.
6. Store the real forum page number on each imported comment/post when possible.
7. Use the forum post ID/permalink as `platformCommentId` whenever available.
8. Refresh must update source data without resetting CC user state: `read`, `saved`, `deleted`, `note`.
9. Never physically delete a forum post from the local collection when the user chooses Delete; use the existing soft-delete behavior.
10. Keep forum-specific parsing inside a platform adapter. Do not put forum selectors/parsing into the general UI.

## Forum adapters

Add adapters gradually per domain or forum engine.

Preferred approach:

```text
URL
 -> forum/domain adapter
 -> fetch one real forum page
 -> parse all posts on that page
 -> Unified Comment model
 -> existing CC UI/storage
```

If several sites use the same engine (for example FluxBB), common parsing code can later be extracted into a shared engine adapter, while each domain keeps its own URL rules and selectors when needed.

## Browser/CORS rule

CC currently runs on GitHub Pages. A browser may be blocked from fetching another site's HTML directly because of CORS.

Forum adapters may therefore use a read-only fetch proxy/reader as a fallback for public pages. This must not be used to bypass authentication or access controls.

For authenticated/private forums, use a browser helper/extension or local desktop helper that operates with the user's own session.

## Holywarsoo

Current adapter:

```text
app/platforms/holywarsoo.js
```

Supported URL shape:

```text
https://holywarsoo.net/viewtopic.php?id=<topicId>&p=<page>
```

Rules:

- source ID: topic ID;
- starting cursor: `p` from the supplied URL;
- one `p=N` page = one CC loading batch;
- then `p=N+1`, `p=N+2`, etc.;
- parser targets FluxBB-style post blocks;
- direct browser fetch is tried first;
- when CORS blocks it, the adapter falls back to Jina Reader in HTML mode for public pages.
