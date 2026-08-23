# CC project instructions

## Application versioning

The CC application version uses the form `0.MINOR.PATCH`.

Current baseline version: `0.3.3`.

Rules:

- Keep the first component at `0` until the user explicitly decides to change it.
- The second component is the active development-day counter. On the first repository change made on a new calendar day, increment the second component by `1`.
- Every user-requested repository change set must also increment the third component by `1`.
- The third component is a continuous change counter and does **not** reset when the second component changes unless the user explicitly changes this policy.
- Multiple files or implementation commits that belong to one user-requested change set count as one PATCH increment, not one increment per file.
- Pure discussion, explanation, inspection, or troubleshooting that does not change repository files does not increment the application version.
- Use the user's/project local calendar day when deciding whether the second component must be incremented; do not silently use UTC when the local date is known.

Example from the current baseline:

- another change on the same day: `0.3.4`;
- if that is followed by another same-day change: `0.3.5`;
- the first change on the next active development day: `0.4.6`.

For every version bump:

1. Update `VERSION.json`:
   - `version` to the new version;
   - `lastChangeDate` to the local date of that change in `YYYY-MM-DD` form.
2. Update the visible version in `app/index.html` in the CC brand area. The version is shown under `Comment Collection` instead of the old word `Reader`.
3. Keep both values synchronized in the same change set.

Do not use the Chrome helper extension version as the CC application version. `helper/chrome/manifest.json` has its own independent extension version.

## UI reference

Do not modify the original reference UI files unless the user explicitly asks for it:

- `blank/ui/index.html`
- `blank/ui/styles.css`
- `blank/ui/ui.md`
