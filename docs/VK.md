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

## Token requirement

VK API schema 5.199 marks `video.getComments` as a method requiring a **user access token**. CC requests up to 100 comments at a time and continues with `offset` pagination.

Do not commit the token and do not put it into public JavaScript. Enter it only in **CC → Settings → VK user access token**.

## VK application for CC

Use a modern **Web** VK ID application.

Recommended values:

```text
Name: Comment Collection
Base domain: backend83.nadube.ru
Trusted Redirect URL: https://backend83.nadube.ru/cc/api/vk-auth.php
```

The public CC UI itself remains at `https://greenn.github.io/cc/`; the backend domain is used as the OAuth return endpoint.

In the VK application information page a short Russian description can be used:

```text
Веб-приложение для чтения, сохранения и организации комментариев из внешних источников, включая видео ВКонтакте. Авторизация VK ID используется только для получения пользовательского токена, необходимого для чтения доступных пользователю комментариев через VK API.
```

Short description:

```text
Чтение и организация комментариев из VK и других источников.
```

Official community is not required. Community launch and iOS options are not required for CC.

## OAuth helper

The PHP backend contains:

```text
https://backend83.nadube.ru/cc/api/vk-auth.php
```

It implements VK ID OAuth 2.1 Authorization Code + PKCE. The flow intentionally does not need the VK protected/client secret; the official VK ID web SDK also exchanges the authorization code using `code_verifier`.

Add the numeric application ID to the private server `config.php`:

```php
'vk_client_id' => 'YOUR_NUMERIC_APP_ID',
'vk_redirect_uri' => 'https://backend83.nadube.ru/cc/api/vk-auth.php',
'vk_oauth_scope' => '',
```

Then open:

```text
https://backend83.nadube.ru/cc/api/vk-auth.php
```

Press **Connect VK**, complete VK authorization, and copy the returned access token directly into **CC → Settings → VK user access token**.

The helper also performs a small `users.get` probe so we can immediately see whether the issued VK ID token is accepted by the classic VK API. This probe is useful because token compatibility can differ across newer VK ID and older VK API methods. `video.getComments` still needs to be tested with a real video after authorization.

Do not send the access token in chat and do not commit it to GitHub.

## Why the CC backend is also required

A normal GitHub Pages browser page cannot reliably call the VK API directly because of browser cross-origin restrictions. CC sends VK requests through its restricted PHP proxy:

```text
https://backend83.nadube.ru/cc/api/vk.php
```

The proxy only allows the read methods used by CC:

```text
video.get
video.getComments
```

So VK setup requires both:

```text
CC backend URL + backend API token
VK user access token
```

The VK token is sent over HTTPS to the user's own CC backend for the API request; it is not committed to GitHub.

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

The returned VK user/group data is mapped into the common CC comment model so read/saved/deleted/note behavior works the same as for YouTube and forums.
