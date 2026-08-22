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

VK API schema 5.199 marks `video.getComments` as a method requiring a **user access token**. The method supports up to 100 comments per request, so CC requests 100 at a time and continues with `offset` pagination.

Do not commit the token and do not put it into public JavaScript. Enter it only in **CC → Settings → VK user access token**.

## Getting a user token

Create a VK application first:

```text
https://vk.com/editapp?act=create
```

For a simple personal/direct authorization setup, choose a **Standalone** application if VK offers that application type. Keep the application ID; it is not a secret.

VK authorization flows change over time. After the app is created, use the user authorization flow offered by VK for that app to obtain a user access token. If the UI is unclear, provide the CC developer with the **application ID or a screenshot of the app settings, not the access token**, and the authorization URL/flow can be tailored to the current VK interface.

The access token itself is a secret and should be pasted directly into CC Settings.

## Why the CC backend is also required

A normal GitHub Pages browser page cannot reliably call `api.vk.com` directly because VK API responses are not intended as a general cross-origin browser endpoint. CC therefore sends the VK request through its own restricted PHP proxy:

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
