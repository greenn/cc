# CC project instructions

## Application versioning

The CC application version uses the form `0.MINOR.PATCH`.

Current baseline version: `0.5.8`.

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

- current version: `0.5.8`;
- another change on the same day: `0.5.9`;
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
- Automatic/no-op Instagram loads must keep the source refreshable rather than permanently converting a new source into a finished `0/0` state.
- When a refresh returns zero candidates, zero permalinks, and zero timestamps, do not claim with certainty that the post was deleted. It may be deleted/unavailable or Instagram may not have exposed usable markup. Offer the user a confirmation to remove that source from CC.
- Instagram media downloads are explicit user actions only. Save requested video/photos to the local Chrome Downloads folder under `CC/Instagram/...`; do not mirror media to the PHP backend by default.
- Keep downloaded-media metadata in the CC source so the app can show downloaded items above Comments and reopen them through the Browser Helper.

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
- When enabled: `ArrowLeft` performs Delete, `ArrowRight` performs Save, `ArrowUp` selects the previous comment, and `ArrowDown` selects the next comment.
- Save/Delete target the selected comment first; if no comment is selected, target the top visible comment in the comments viewport.
- Up/Down navigation starts from the selected comment; if nothing is selected yet, the first Up/Down selects the top visible comment.
- Navigating with Up/Down scrolls the selected comment into view.
- Preserve the current comment index across Delete. If comment N is deleted and disappears from the rendered list, Down continues with the item that moved into position N, while Up goes to position N-1 instead of restarting from the top.
- Preserve that delete-position anchor for both keyboard Delete and a manual click on the comment's Delete action.
- Do not hijack arrow keys while the user is typing/editing in an input, textarea, select, contenteditable element, or an open dialog.
- Save via shortcut must not unsave an already-saved comment.

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
