function parseYouTubeVideoId(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
  if (!host.endsWith('youtube.com')) return null;

  if (parsed.pathname === '/watch') return parsed.searchParams.get('v');

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] || null;
  return null;
}

async function requestJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `YouTube API request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function requireKey(settings) {
  const key = settings?.youtubeApiKey?.trim();
  if (!key) throw new Error('Add a YouTube Data API key in Settings first.');
  return key;
}

export const youtubeAdapter = {
  id: 'youtube',
  label: 'YouTube',

  canHandle(url) {
    try {
      return Boolean(parseYouTubeVideoId(url));
    } catch {
      return false;
    }
  },

  async getPost(url, settings) {
    const videoId = parseYouTubeVideoId(url);
    if (!videoId) throw new Error('Unsupported YouTube URL.');
    const key = requireKey(settings);
    const api = new URL('https://www.googleapis.com/youtube/v3/videos');
    api.searchParams.set('part', 'snippet,statistics');
    api.searchParams.set('id', videoId);
    api.searchParams.set('key', key);

    const data = await requestJson(api);
    const item = data.items?.[0];
    if (!item) throw new Error('YouTube video not found or unavailable to this API key.');

    return {
      id: `youtube:${videoId}`,
      platform: 'youtube',
      externalId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: item.snippet?.title || 'YouTube video',
      author: item.snippet?.channelTitle || 'YouTube',
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
      publishedAt: item.snippet?.publishedAt || null,
      commentCount: Number(item.statistics?.commentCount || 0),
      loadedCount: 0,
      nextCursor: null,
      hasMore: true,
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async getComments(source, cursor, limit, settings) {
    const key = requireKey(settings);
    const api = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
    api.searchParams.set('part', 'snippet,replies');
    api.searchParams.set('videoId', source.externalId);
    api.searchParams.set('maxResults', String(Math.min(limit || 50, 100)));
    api.searchParams.set('textFormat', 'plainText');
    api.searchParams.set('order', 'time');
    api.searchParams.set('key', key);
    if (cursor) api.searchParams.set('pageToken', cursor);

    const data = await requestJson(api);
    const comments = (data.items || []).map((thread) => {
      const top = thread.snippet?.topLevelComment;
      const snippet = top?.snippet || {};
      const id = top?.id || thread.id;
      return {
        id: `youtube:${id}`,
        sourceId: source.id,
        platformCommentId: id,
        parentCommentId: null,
        authorName: snippet.authorDisplayName || 'Unknown author',
        authorUsername: snippet.authorChannelUrl || '',
        authorAvatar: snippet.authorProfileImageUrl || '',
        text: snippet.textDisplay || snippet.textOriginal || '',
        publishedAt: snippet.publishedAt || null,
        likeCount: Number(snippet.likeCount || 0),
        replyCount: Number(thread.snippet?.totalReplyCount || 0),
        originalUrl: `https://www.youtube.com/watch?v=${source.externalId}&lc=${encodeURIComponent(id)}`,
      };
    });

    return {
      comments,
      nextCursor: data.nextPageToken || null,
      hasMore: Boolean(data.nextPageToken),
      totalResults: Number(data.pageInfo?.totalResults || comments.length),
    };
  },
};
