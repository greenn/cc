# CC Browser Helper (Chrome / Chromium)

This unpacked Manifest V3 extension connects **CC — Comment Collection** with websites that require the user's existing browser session. The first supported helper source is Instagram.

## Install locally

1. Pull the repository locally.
2. Open Chrome/Chromium extensions page:

```text
chrome://extensions/
```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select:

```text
helper/chrome/
```

6. Open CC and go to **Settings → Browser helper → Check helper**.

The status should report the helper version and the `instagram` capability.

The browser toolbar badge shows that the extension is alive:

```text
ON = helper extension is running
CC = helper bridge is connected to the current CC tab
```

CC Settings also shows a live `Connected v…` / `Not connected` badge next to **CC Browser Helper**.

If the helper was installed or updated while CC was already open, reload the extension on `chrome://extensions/` and refresh the CC tab. Version 0.2+ also attempts to inject the bridge into already-open CC tabs automatically when the extension is reloaded.

## Instagram flow

When CC needs Instagram comments:

1. the helper opens (or focuses) the Instagram post/reel in the same Chrome profile;
2. Instagram uses the user's normal signed-in session;
3. the content script clicks visible "load/view more comments" controls and reads comments rendered in the page;
4. the comments are returned to CC and stored using CC's normal local/server storage model.

No Instagram password is stored by CC or the extension.

## Limits

Instagram's web DOM is not a public API and can change. The collector intentionally avoids undocumented private API endpoints and only reads content that the current signed-in browser session can already display. If Instagram changes its markup or labels, `instagram-scraper.js` may need selector/text updates.

The helper does not bypass private-account access, login requirements, or other access controls.
