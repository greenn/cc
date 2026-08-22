# CC PHP + SQLite backend

This folder is a small storage backend for **CC — Comment Collection**. It is designed for ordinary shared PHP hosting; Node.js and a VDS are not required.

## Deployment target

Recommended URL on the current hosting:

```text
https://cdn.nadube.ru/dv/cc/backend/
```

Copy the contents of `server/php/` to that directory.

Result:

```text
/dv/cc/backend/
├── api/
│   ├── health.php
│   └── state.php
├── data/
│   ├── .htaccess
│   └── .gitignore
├── lib/
│   └── bootstrap.php
├── .gitignore
├── check.php
├── config.example.php
└── config.php          # create on the server; do not commit
```

## 1. Check the hosting

Upload the files and open:

```text
https://cdn.nadube.ru/dv/cc/backend/check.php
```

The page checks:

- PHP version;
- PDO;
- PDO SQLite;
- JSON;
- whether the data directory is writable;
- whether SQLite can really create, write and read a database file.

The main status should be:

```text
READY
```

`SQLite3 extension` and `mbstring` are useful but are not required if `PDO SQLite` works.

After setup you may delete or rename `check.php` because it exposes basic hosting capability information.

## 2. Configure

On the server, copy:

```text
config.example.php
```

to:

```text
config.php
```

`config.php` is ignored by Git and must not be committed.

Set at least:

```php
'api_token' => 'A-LONG-RANDOM-SECRET-TOKEN',
```

For a personal installation use a long random value, preferably 32+ random bytes represented as hex/base64.

The default database location is:

```text
server/php/data/cc.sqlite
```

The `data/` directory contains `.htaccess` that blocks direct HTTP access on Apache hosting.

If the hosting allows files outside `public_html`, it is better to change `db_path` to an absolute path outside the public web directory.

Example:

```php
'db_path' => '/home/account/private/cc.sqlite',
```

## 3. Health check

After creating `config.php`, open:

```text
https://cdn.nadube.ru/dv/cc/backend/api/health.php
```

Expected response:

```json
{
  "ok": true,
  "service": "cc-backend",
  "php": "8.x.x",
  "pdo_sqlite": true,
  "sqlite": "3.x.x"
}
```

The first successful request creates the SQLite database/table automatically.

## 4. Storage API

Endpoint:

```text
https://cdn.nadube.ru/dv/cc/backend/api/state.php
```

Authorization header:

```text
Authorization: Bearer YOUR_TOKEN
```

The API stores one complete CC application state as JSON. This matches the current browser `localStorage` model and makes initial synchronization simple.

### Save state

```http
PUT /dv/cc/backend/api/state.php
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "state": {
    "version": 1,
    "settings": {},
    "sources": [],
    "comments": {}
  }
}
```

A plain state object without the outer `state` property is also accepted.

Response includes a monotonically increasing `revision`.

### Read state

```http
GET /dv/cc/backend/api/state.php
Authorization: Bearer YOUR_TOKEN
```

Response:

```json
{
  "ok": true,
  "profile": "default",
  "revision": 3,
  "updatedAt": "2026-08-22T14:00:00+00:00",
  "state": {
    "version": 1,
    "sources": [],
    "comments": {}
  }
}
```

If nothing has been saved yet, `revision` is `0` and `state` is `null`.

### Delete server state

```http
DELETE /dv/cc/backend/api/state.php
Authorization: Bearer YOUR_TOKEN
```

## 5. Profiles

The backend supports multiple independent state slots using `profile`:

```text
/api/state.php?profile=default
/api/state.php?profile=test
/api/state.php?profile=desktop
```

Profile names may contain letters, numbers, `.`, `_`, and `-` only.

For the current CC installation use `default`.

## 6. Browser request example

```js
const API = 'https://cdn.nadube.ru/dv/cc/backend/api/state.php';
const TOKEN = 'token entered by the user, never committed to GitHub';

async function saveState(state) {
  const response = await fetch(API, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function loadState() {
  const response = await fetch(API, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
    },
  });

  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
```

## 7. CORS

`config.example.php` currently permits requests from:

```text
https://greenn.github.io
https://cdn.nadube.ru
http://localhost:8000
http://127.0.0.1:8000
```

Add another exact origin to `allowed_origins` if CC is later hosted somewhere else.

Do not use `*` for this private storage API.

## 8. What is stored

For the first server-backed version the API stores the complete CC state JSON in SQLite as a single row per profile.

That includes:

- sources;
- downloaded comments;
- read state;
- saved state;
- soft-deleted state;
- notes;
- reading position;
- other local application state.

This deliberately mirrors the current `localStorage` structure. It avoids a large migration now.

Later, if needed, the same SQLite database can be normalized into separate tables such as `sources`, `comments`, and `source_state` without changing the public UI.

## 9. Security notes

- Never commit `config.php` or a real API token.
- Never put the real token directly into public JavaScript in GitHub.
- The CC browser app may keep the token in local browser settings for a personal installation; anyone with access to that browser profile can read it.
- Use HTTPS only.
- Keep `data/` inaccessible over HTTP.
- Prefer a database path outside the public web root when the hosting permits it.

## 10. Next CC step

After this backend is uploaded and `check.php` reports `READY`, integrate the current `app/store.js` with it:

```text
localStorage = fast local cache
PHP + SQLite = persistent canonical copy
```

The app can then load server state at startup and debounce-save changes back to the server.
