import { store } from './store.js';

async function request(endpoint, params, key) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [name, value] of Object.entries({ ...params, key })) {
    if (value) url.searchParams.set(name, String(value));
  }
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `YouTube API error (${response.status})`);
  return data;
}

function download(source, comments, complete, error) {
  const result = {
    source: { id: source.externalId, title: source.title, url: source.url },
    exportedAt: new Date().toISOString(),
    complete,
    error: error || null,
    count: comments.length,
    comments,
  };
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `youtube-${source.externalId}-comments${complete ? '' : '-partial'}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

export async function exportYouTubeComments(source, onProgress) {
  const key = store.getSettings().youtubeApiKey?.trim();
  if (!key) throw new Error('Add a YouTube Data API key in Settings first.');
  const comments = [];
  const ids = new Set();
  const seenPages = new Set();
  let cursor = '';
  let count = 0;
  const add = (item, reply) => {
    if (!item?.id || ids.has(item.id)) return;
    ids.add(item.id);
    const snippet = item.snippet || {};
    comments.push({ id: item.id, parentId: reply ? (snippet.parentId || null) : null, url: `https://www.youtube.com/watch?v=${encodeURIComponent(source.externalId)}&lc=${encodeURIComponent(item.id)}`, ...snippet });
    count += 1;
    onProgress(count);
  };
  try {
    do {
      if (cursor && seenPages.has(cursor)) throw new Error('YouTube repeated a page token.');
      if (cursor) seenPages.add(cursor);
      const page = await request('commentThreads', { part: 'snippet', videoId: source.externalId, maxResults: 100, textFormat: 'plainText', order: 'time', pageToken: cursor }, key);
      for (const thread of page.items || []) {
        const top = thread.snippet?.topLevelComment;
        if (!top?.id) continue;
        add(top, false);
        if (Number(thread.snippet?.totalReplyCount || 0) > 0) {
          let replyCursor = '';
          const replyPages = new Set();
          do {
            if (replyCursor && replyPages.has(replyCursor)) throw new Error('YouTube repeated a reply page token.');
            if (replyCursor) replyPages.add(replyCursor);
            const replies = await request('comments', { part: 'snippet', parentId: top.id, maxResults: 100, textFormat: 'plainText', pageToken: replyCursor }, key);
            for (const reply of replies.items || []) add(reply, true);
            replyCursor = replies.nextPageToken || '';
          } while (replyCursor);
        }
      }
      cursor = page.nextPageToken || '';
    } while (cursor);
    download(source, comments, true, '');
    return count;
  } catch (error) {
    if (count) download(source, comments, false, error.message || 'API error');
    throw new Error(`${error.message || 'Could not collect comments.'}${count ? ` Partial JSON downloaded (${count} comments).` : ''}`);
  }
}
