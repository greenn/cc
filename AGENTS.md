# CC project instructions

## Application versioning

The CC application version uses the form `0.MINOR.PATCH`.

Current baseline version: `0.5.25`.

Rules:

- Keep the first component at `0` until the user explicitly decides to change it.
- The second component is the active development-day counter. On the first repository change made on a new calendar day, increment the second component by `1`.
- The third component counts change sets within the current development day.
- On the first repository change of a new calendar day, reset the third component to `1`.
- Every additional user-requested repository change set on that same day increments the third component by `1`.
- Multiple files or implementation commits that belong to one user-requested change set count as one PATCH increment, not one increment per file.
- Pure discussion, explanation, inspection, or troubleshooting that does not change repository files does not increment the application version.
- Use the user's/project local calendar day when deciding whether the second component must be incremented; do not silently use UTC when the local date is known.

Example from the current development day:

- current version: `0.5.25`;
- another change on the same day: `0.5.26`;
- the first change on the next active development day: `0.6.1`;
- the next change that same new day: `0.6.2`.

For every version bump:

1. Update `VERSION.json`:
   - `version` to the new version;
   - `lastChangeDate` to the local date of that change in `YYYY-MM-DD` form.
2. Update the visible version in `app/index.html` to the same version. Do not rely only on JavaScript to replace a stale fallback version.
3. Update the `?v=<version>` cache-busting token on the app CSS and top-level runtime loader references in `app/index.html`. This is required so GitHub Pages/browser caches do not keep an older UI after a deployment.
4. Keep extension/helper versions independent from the CC application version.

Do not use the Chrome helper extension version as the CC application version. `helper/chrome/manifest.json` has its own independent extension version.

## Runtime loading

- `app/index.html` must not depend on many independent top-level module tags. Start the application through `app/app-boot.js`.
- `app/app-boot.js` loads application modules in a controlled order and records completed modules so a fallback can safely resume rather than double-initialize them.
- If GitHub Pages returns a transient error for a JavaScript module, the HTML bootstrap may fall back to the same runtime from the public GitHub raw source.
- If both primary and fallback runtimes fail, show a visible startup error in the page. Never leave a dead-looking UI with no explanation.
- A JavaScript startup failure must not clear or reset localStorage. The static empty-state text is not proof that user data has been deleted.
- Do not fetch `VERSION.json` during normal page runtime just to update the visible version. The deployed HTML/runtime version is already explicit and cache-busted; an extra version fetch can remain pending and keep the browser page in a loading state.
- Avoid global `MutationObserver` hooks that observe attributes/character data and then mutate the same observed DOM in their callbacks. This can create a self-triggering microtask loop and pin a renderer at 100% CPU without throwing a JavaScript error.
- Prefer direct render hooks, narrowly scoped observers, and idempotent DOM writes that first check whether the value actually needs to change.

## Navigation conventions

These are default product conventions for applications we build:

- The application logo/brand is always a Home link and returns to the title/home screen.
- Navigable application state must be represented in the URL so refresh, copy-link, Back, and Forward preserve where the user is.
- Prefer explicit URL state such as `view`, `source`, `filter`, and selected item identifiers rather than invisible navigation-only state.
- Archive is a separate source view; archived sources should not clutter the normal Sources list.
- On initial load, do not render an arbitrary first source before applying the URL route. The Home/Sources route must boot directly into the lightweight source overview without creating comment cards or starting avatar/network requests for a source the user did not open.
- When a source is open, show its original URL next to the platform/author metadata as a clickable link. Long source URLs should remain one line and be horizontally scrollable without a visible scrollbar.
- The primary navigation block `Sources / Archive / All comments / Saved / Read / Deleted` lives in one horizontal yellow top bar at the same level as the application brand.
- The left yellow column remains below that top bar and contains Add link, the source list, Help, and Settings; it must not reserve empty space for the moved primary navigation.
- The left source list has no extra `Sources` section heading. Platform groups such as YouTube and Instagram can be collapsed/expanded, and that state is remembered locally in the browser.
- The main workspace and Details panel begin below the global yellow top bar.
- Up to 2200px viewport width the application fills the full browser viewport with no blue outer gutter. Blue outer background/gutters are allowed only above 2200px.

## Instagram Browser Helper behavior

- Adding an Instagram source must never open or focus Instagram.
- Clicking/opening an Instagram source inside CC must never open or focus Instagram merely because the source currently has zero downloaded comments.
- Only an explicit Refresh should request a new Instagram scrape.
- The helper should perform that scrape in a dedicated inactive/background temporary tab and must not steal focus from CC.
- Do not navigate or reuse the user's existing Instagram tabs for a scrape.
- A helper-created temporary Instagram tab should be closed after the scrape completes.
- If the user manually activates the helper-created Instagram worker tab, allow that manual interaction. Do not yank focus back to CC while the user is helping the worker by scrolling.
- Manual user scrolling in the worker tab is valid input: the collector keeps rescanning the currently rendered comment DOM and incorporates comments revealed by the user's movement.
- While Refresh or Load more is running for the current Instagram source, expose an `Open worker` action beside the source controls. It focuses the already-created temporary worker tab for that source; it must never create an additional Instagram tab. If the worker is still opening, the helper may wait briefly for it to register. Once the user focuses the worker this way, treat it as manual focus and let the user stay on that tab until the worker finishes or is closed.
- Instagram Helper diagnostics and worker controls (`Helper · found/saved/...`, `Refresh`, `Load more`, `Open worker`) live in their own dedicated row directly below the main source-action row. Content/data actions such as Accounts, Attachments, Video, Photos, and Delete source remain in the main row.
- Automatic/no-op Instagram loads must keep the source refreshable rather than permanently converting a new source into a finished `0/0` state.
- A zero-comment scrape is not proof that the Instagram source was deleted. Keep the source and leave Refresh available; do not offer destructive deletion based only on missing rendered comment markup.
- For `/reels/<id>/` sources, use the canonical `/reel/<id>/` route in the temporary worker tab because the plural route behaves like a feed and is less stable for automated comment loading.
- Reel comment collection should open the Comments panel if necessary, then accumulate parsed comments while clicking load/reply controls and scrolling the comments panel. Do not return only the final currently-rendered DOM viewport because Instagram can virtualize the list.
- Mix targeted comment-container scrolling with occasional PageDown-style movement, but do not expose a PageDown-only setting. Synthetic PageDown does not reliably make Instagram advance in an unfocused worker tab; when deeper loading depends on real browser focus, manual use of the temporary worker tab is an accepted workflow.
- During Instagram Refresh/Load more, stream live helper progress back to CC. Show the number of unique comments found in the current helper pass, how many have already been streamed and persisted by CC, the current phase, and crawl step.
- Stream discovered comments to CC immediately in small batches instead of keeping the entire result only inside the worker tab until the end. CC must upsert each incoming batch synchronously into local storage.
- If the user closes the temporary worker tab early, all batches that were already streamed to CC remain saved. Losing the worker must not roll back already persisted comments; the operation should end with an explicit interrupted/worker-closed message.
- The final scrape result is still merged once more at normal completion as a safety net. Duplicate platform comment IDs must not create duplicate comments or erase local read/saved/highlight/deleted/note state.
- Live progress is diagnostic activity, not a promise that every displayed found comment is newly added to local storage. A pass may rediscover comments CC already has; expose the distinction between found/streamed comments and comments that were actually new to the local source.
- After at least one Instagram comment batch has been loaded, expose a `Load more` action beside Refresh. Each successive deep-load pass uses a larger crawl budget, reopens the temporary worker page, searches farther down the comment panel, and merges only newly discovered comments into the existing local source without deleting previous results.
- `Refresh` is for the newest/current Instagram state; `Load more` is for progressively deeper older comments. Running either operation for a source must not stop when the user navigates to another CC source.
- Instagram media downloads are explicit user actions only. Save requested video/photos to the local Chrome Downloads folder under `CC/Instagram/...`; do not mirror media to the PHP backend by default.
- Keep downloaded-media metadata in the CC source so the app can show downloaded items above Comments and reopen them through the Browser Helper.
- After an Instagram Refresh/media probe, retain detected `videoCount` and `photoCount` in the source. Media action buttons show `?` until the count is known, then show the detected count; a known zero disables that media action instead of silently hiding the information.
- Reel media counts represent logical media in that Reel, not every media/resource request made by the Instagram page. A normal single-video Reel should report one video and zero photos; never count CDN/resource-timing requests as separate Reel videos.
- Instagram operations are tracked per source, not globally. Different Instagram sources may run Refresh/media operations concurrently, with one independent temporary Browser Helper worker tab per request. Prevent duplicate execution of the same operation on the same source while it is already running.
- While an Instagram Refresh/Load more/Video/Photos operation is active, show only a compact animated 3px diagonal black/white bar along the bottom of the initiating action and the corresponding source item in the left list. Navigating to another source must not stop the background operation or lose its processing marker.
- The open Instagram source has an explicit `Delete source` action. It deletes only the CC source and its locally stored comments, never the Instagram post itself; disable the action while a Helper operation for that source is still running.

## Comment media

- A collected comment may contain an `attachments` array with image/GIF/sticker or video items in addition to text.
- Instagram attachment detection must parse the DOM of the nearest verified comment container itself. Do not climb to the Reel/post container merely because a media-only comment has no `<time>` or comment permalink.
- Media-only comments are valid even when Instagram provides no timestamp/permalink. A nearby author profile plus comment engagement UI such as `Reply`, likes, or `View all N replies` is enough structural evidence to identify the comment container.
- Instagram attachment detection should inspect normal images, `srcset`/`picture` media, CSS/`role=img` backgrounds, video/source elements, and direct media links found inside that verified comment container.
- Exclude the comment author's avatar from attachment detection. Prefer media that belongs to the comment container itself; do not treat the Reel/post media or unrelated Instagram UI assets as comment attachments.
- Direct media URLs such as Instagram/Facebook CDN `.gif`, `.webp`, `.jpg`, `.png`, `.mp4`, etc. count as attachments even when the media element has no `alt` text and dimensions are not yet available.
- Empty/missing media attributes are not URLs. Never call URL resolution on an empty attachment value with the Reel/post page as the base; otherwise an empty CSS background/image value becomes the Reel URL itself.
- The Helper must read raw media attributes (`getAttribute('src')`, `getAttribute('poster')`) where appropriate instead of relying on DOM properties that may synthesize the current document URL for missing values.
- CC performs a second validation before persistence/rendering: an Instagram attachment must resolve to a direct media file URL of the expected image/video type. Instagram Reel/post page URLs are rejected and removed from existing local state on reload.
- Normalize attachment identity using the media URL origin + pathname, without temporary query parameters, so expiring CDN signatures do not create a new comment ID on every refresh.
- If Instagram does not expose a true permalink for a comment, leave `originalUrl` empty. Never substitute the Reel/post URL and label it as the original comment.
- New verified Instagram comments mark their attachment set with `attachmentScope: 'comment'`. CC only renders/counts Instagram attachments carrying this verified scope, so older false Reel/post attachments disappear from the inline list and `Attachments` gallery until the actual comment is refreshed.
- For a verified Instagram comment, the incoming attachment set is authoritative and replaces older stored attachments for that comment. This allows a corrected refresh to remove previously misclassified Reel/post media.
- A comment with no meaningful text is still valid when it contains a detected attachment.
- Render collected comment attachments directly under the comment text. Images/GIFs are lazy-loaded and open their actual media URL; video attachments use native controls when a direct HTTP media URL is available. If Instagram exposes only a video poster/preview, show that preview and link back to the original comment only when a true comment permalink exists.
- The DOM renderer must not expose its internal attachment render-cache signature as a `data-signature` attribute. Keep render signatures in JavaScript memory (for example a `WeakMap`) so inspected comment HTML contains only meaningful attachment markup.
- When a source is open, expose an `Attachments · N` action in the source header. It opens a gallery containing every verified collected comment attachment for that source, with author, comment snippet, and true original-comment link when available.
- When the selected comment has attachments, the Details/Info panel shows attachment metadata: direct media link, detected format, and pixel dimensions when the browser can load the media metadata.
- The Details/Info panel also shows `Related attachments` from other comments by the same normalized author in the same source/post. Each related item links to the media and can jump to the corresponding local CC comment.
- Attachment dimensions are display metadata resolved lazily in the browser; do not require a Helper re-scrape merely to show width/height.
- Store attachment URLs/previews with the comment in CC local data. Do not mirror comment attachments to the PHP backend unless that storage policy is explicitly changed later.
- Instagram CDN attachment URLs may expire; if that becomes a practical problem, add an explicit local/helper caching layer rather than silently duplicating all media by default.

## Comment author accounts

- When a source is open, expose an `Accounts · N` action in the source header, where `N` is the number of distinct commenter accounts already present in local CC data for that source.
- The Accounts view is derived locally from all collected comments for the source, including comments that are currently Saved or Deleted; changing a reading filter must not change the author totals.
- Group primarily by normalized `authorUsername`; fall back to `authorName` when a username is unavailable.
- Sort accounts by comment count descending, then by name.
- Show a compact table with `Name`, `Account`, and `Comments` columns. For Instagram usernames, the account value may link to the public Instagram profile in a new tab.

## Saved/highlighted comment flow

- Saving a comment marks it as Saved and removes it from the normal working feeds.
- Highlighting a comment implies Saved, so highlighted comments are also removed from the normal working feeds.
- Normal working feeds are `Comments`, global `All comments`, `Unread`, and `Read`; they show only non-deleted comments that are not Saved.
- Saved comments remain available through the per-source `Saved` filter and the global `Saved` view.
- Deleted comments remain available through `Deleted` and are excluded from Saved views while deleted.
- If Save/Highlight/Delete removes the current card from the rendered feed, preserve its list-position anchor so keyboard navigation continues from that position instead of jumping back to the top.

## Comment gestures

- Horizontal gesture on a comment: drag/swipe right to Save, left to Delete.
- Keep vertical scrolling natural and preserve mouse text selection inside comment text; mouse drag can start from the rest of the card.
- A Save gesture must not toggle an already-saved comment back to unsaved.
- Gesture click suppression must only suppress the browser's follow-up click after `pointerup`; never set the suppression flag before invoking the intended Save/Delete action, or the gesture will animate without changing state.

## Comment keyboard shortcuts

- A `Shortcuts` toggle lives directly below Settings in the left panel.
- The Shortcuts control is present in static HTML from first paint. Until its settings state is known, keep it visible but disabled rather than hiding it.
- The toggle state is stored locally in CC settings and survives reloads.
- Its tooltip shows the keyboard legend and target-selection rule.
- When enabled: `ArrowLeft` performs Delete, `ArrowRight` performs Save, `Enter` performs Highlight, `ArrowUp` selects the previous comment, and `ArrowDown` selects the next comment.
- Save/Delete/Highlight target the selected comment first; if no comment is selected, target the top visible comment in the comments viewport.
- After `ArrowLeft` deletes the selected comment, automatically select the comment that followed it in source order. Because that card moves into the deleted card's array position, keep the same index. If the deleted card was the final item and there is no next card, fall back to the previous remaining card.
- Up/Down navigation starts from the selected comment; if nothing is selected yet, the first Up/Down selects the top visible comment.
- Navigating with Up/Down scrolls the selected comment into view.
- Preserve the current comment index across Delete/Save/Highlight when the action removes that card from the current rendered feed. Down continues with the item that moved into the same position, while Up goes to the previous position instead of restarting from the top.
- Preserve that position anchor for keyboard actions and manual clicks on the relevant comment actions.
- Do not hijack shortcuts while the user is typing/editing in an input, textarea, select, contenteditable element, or an open dialog. `Enter` also keeps its normal behavior when focus is on a button or link.
- Save via shortcut must not unsave an already-saved comment. Highlight via shortcut must not remove an existing highlight.

## Comment translation

- Each comment has a `Translate` action directly after `Highlight`.
- Translation target is Russian.
- Use Chrome's built-in Language Detector + Translator APIs when available so comment text is translated locally in the desktop browser.
- The first translation for a language pair may download the required local language pack; expose progress through the Translate button while it is preparing.
- Cache the Russian translation in the comment's local CC state. Do not translate the same comment again on every toggle.
- When translation is active, underline the `Translate` button and show the Russian text. Pressing it again restores the original text without deleting the cached translation.

## Avatar loading policy

- Do not start avatar requests on Sources/Home.
- Comment cards render initials first; external avatar URLs are loaded only near the visible comment viewport.
- Limit avatar network work to a small concurrent queue (currently 5 requests).
- Avatar requests must time out (currently 5 seconds) and fall back to initials without blocking the app.
- Reuse the original avatar URL so normal browser HTTP/image caching can keep successful avatars temporarily.
- Do not create a permanent backend avatar mirror unless the user explicitly decides it is needed later.

## UI reference

Do not modify the original reference UI files unless the user explicitly asks for it:

- `blank/ui/index.html`
- `blank/ui/styles.css`
- `blank/ui/ui.md`
