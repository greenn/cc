# VK comments in CC

CC supports VK video links, including direct video URLs and Messenger URLs whose `z=` parameter contains a video target.

Example input:

```text
https://vk.ru/im/convo/1282750?entrypoint=list_all&z=video-238724284_456239337%2F2bb447609d3a2803bf
```

The adapter extracts:

```text
owner_id = -238724284
video_id = 456239337
```

and loads comments using VK API `video.getComments`.

## Authentication model

VK API schema 5.199 marks `video.getComments` as a method requiring a **user access token**. VK ID access tokens are short-lived, so CC does not store them in browser settings anymore.

From CC 0.3.7 the flow is:

```text
CC browser
  → authenticated CC backend
  → one-time VK connection ticket
  → VK ID OAuth 2.1 + PKCE
  → access token + refresh token stored in backend SQLite
  → automatic access-token refresh
  → video.get / video.getComments
```

The browser never receives or displays the VK access token or refresh token.

## VK ID application

Create a **VK ID Web application** and register:

```text
Base domain:
backend83.nadube.ru

Trusted Redirect URL:
https://backend83.nadube.ru/cc/api/vk-auth.php
```

Put the numeric VK ID application ID into the private server `config.php`:

```php
'vk_client_id' => 'YOUR_VK_ID_APP_ID',
'vk_redirect_uri' => 'https://backend83.nadube.ru/cc/api/vk-auth.php',
'vk_oauth_scope' => '',
```

Do not commit the private `config.php`.

## Connect VK from CC

First configure the PHP backend URL and API token in CC Settings. Then use:

```text
Settings → VK → Connect VK
```

CC calls the protected `api/vk-connect.php` endpoint. The backend creates a one-time connection ticket valid for five minutes. The browser opens the ticket URL, VK ID performs OAuth 2.1 + PKCE, and `api/vk-auth.php` stores the resulting credentials in SQLite.

`api/vk-status.php` reports only non-secret connection metadata such as the VK user ID and whether automatic refresh is available.

## Automatic refresh

The initial VK access token normally expires quickly. CC stores the associated `refresh_token`, `device_id`, and expiry on the backend.

Before a VK API request, `api/vk.php` obtains a valid access token from the server-side OAuth store. If the token expires within two minutes, the backend refreshes it through VK ID and stores the rotated access/refresh token pair.

If VK rejects an access token unexpectedly with an authentication-related error, the proxy attempts one forced refresh and retries the read request once.

No manual hourly token copying is required.

## Backend storage

VK OAuth credentials are stored in the same SQLite database configured by `db_path`, in a separate `vk_oauth_tokens` table keyed by CC storage profile.

Keep the SQLite file inaccessible from the web. Prefer a path outside the public web root when the hosting allows it. If it remains under `/cc/data/`, the included `.htaccess` must stay in place.

## VK proxy

The browser does not call `api.vk.ru` directly. CC routes the supported methods through:

```text
https://backend83.nadube.ru/cc/api/vk.php
```

The proxy only allows:

```text
video.get
video.getComments
```

The browser authenticates to the CC backend using the private CC backend API token. VK credentials never travel back to the browser.

## API behavior

CC calls `video.getComments` with approximately:

```text
owner_id=<owner>
video_id=<video>
count=100
offset=0,100,200,...
sort=asc
extended=1
need_likes=1
thread_items_count=10
v=5.199
```

The returned VK user/group data is mapped into the common CC comment model so read/saved/highlighted/deleted/note behavior works the same as for other sources.
