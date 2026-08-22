# CC PHP + SQLite backend

This folder is a small storage backend for **CC — Comment Collection**. It is designed for ordinary shared PHP hosting; Node.js and a VDS are not required.

## Deployment target

Recommended URL:

```text
https://backend83.nadube.ru/cc/
```

Copy the contents of `server/php/` to the `/cc/` directory of the `backend83.nadube.ru` subdomain.

Result:

```text
/cc/
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
https://backend83.nadube.ru/cc/check.php
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
/cc/data/cc.sqlite
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
https://backend83.nadube.ru/cc/api/health.php
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
https://backend83.nadube.ru/cc/api/state.php
```

Authorization header:

```text
Authorization: Bearer YOUR_TOKEN
```

The API stores one complete CC application state as JSON. This matches the current browser `localStorage` model and makes initial synchronization simple.

### Save state

```http
PUT /cc/api/state.php
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
GET /cc/api/state.php
Authorization: Bearer YOUR_TOKEN
```

If nothing has been saved yet, `revision` is `0` and `state` is `null`.

### Delete server state

```http
DELETE /cc/api/state.php
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
const API = 'https://backend83.nadube.ru/cc/api/state.php';
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

`config.example.php` permits requests from:

```text
https://greenn.github.io
https://backend83.nadube.ru
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

This deliberately mirrors the current `localStorage` structure. Later the same SQLite database can be normalized into separate tables without changing the public UI.

## 9. Security notes

- Never commit `config.php` or a real API token.
- Never put the real token directly into public JavaScript in GitHub.
- The CC browser app may keep the token in local browser settings for a personal installation; anyone with access to that browser profile can read it.
- Use HTTPS only.
- Keep `data/` inaccessible over HTTP.
- Prefer a database path outside the public web root when the hosting permits it.

## 10. CC integration

The application settings use this default backend URL:

```text
https://backend83.nadube.ru/cc
```

The **Check connection** button first calls `api/health.php`, then checks authenticated access to `api/state.php` when an API token is present.

Current architecture target:

```text
localStorage = fast local cache
PHP + SQLite = persistent canonical copy
```
