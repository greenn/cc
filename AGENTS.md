# CC project instructions

## Application versioning

The CC application version uses the form `0.MINOR.PATCH`.

Current baseline version: `0.4.9`.

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

- current version: `0.4.9`;
- another change on the same day: `0.4.10`;
- the first change on the next active development day: `0.5.1`;
- the next change that same new day: `0.5.2`.

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

## Navigation conventions

These are default product conventions for applications we build:

- The application logo/brand is always a Home link and returns to the title/home screen.
- Navigable application state must be represented in the URL so refresh, copy-link, Back, and Forward preserve where the user is.
- Prefer explicit URL state such as `view`, `source`, `filter`, and selected item identifiers rather than invisible navigation-only state.
- Archive is a separate source view; archived sources should not clutter the normal Sources list.
- On initial load, do not render an arbitrary first source before applying the URL route. The Home/Sources route must boot directly into the lightweight source overview without creating comment cards or starting avatar/network requests for a source the user did not open.

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
