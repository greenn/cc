const VK_API_VERSION = '5.199';

function parseVkVideoTarget(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru', 'vkvideo.ru'].includes(host)) return null;

  const candidates = [url.pathname, url.searchParams.get('z') || '', `${url.pathname}${url.search}${url.hash}`];
  for (const candidate of candidates) {
    let text = candidate;
    try { text = decodeURIComponent(text); } catch { /* keep original */ }
    const match = text.match(/video(-?\d+)_(\d+)(?:\/([A-Za-z0-9_-]+))?/i);
    if (match) {
      return {
        ownerId: Number(match[1]),
        videoId: Number(match[2]),
        accessKey: match[3] || null,
      };
    }
  }

  return null;
}

function requireToken(settings) {
  const token = String(settings?.vkAccessToken || '').trim();
  if (!token) throw new Error('Add a VK user access token in Settings first.');
  return token;
}

function requireBackend(settings) {
  const base = String(settings?.backendUrl || 'https://backend.nadube.ru/cc').trim().replace(/\/+$/, '');
  const backendToken = String(settings?.backendToken || '').trim();
  if (!backendToken) throw new Error('VK requests use the CC PHP backend because api.vk.com is blocked by browser CORS. Configure the backend URL and API token in Settings first.');
  return { base, backendToken };
}

async function vkApi(method, params, settings) {
  const accessToken = requireToken(settings);
  const { base, backendToken } = requireBackend(settings);
  const response = await fetch(`${base}/api/vk.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${backendToken}`,
    },
    body: JSON.stringify({
      method,
      params,
      accessToken,
      v: VK_API_VERSION,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `VK proxy request failed (${response.status}).`);
  return data.response;
}

function authorMaps(response) {
  const profiles = new Map((response.profiles || []).map((profile) => [Number(profile.id), {
    name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || `VK user ${profile.id}`,
    username: profile.screen_name ? `@${profile.screen_name}` : '',
    avatar: profile.photo_50 || profile.photo_100 || '',
  }]));

  const groups = new Map((response.groups || []).map((group) => [Number(group.id), {
    name: group.name || `VK group ${group.id}`,
    username: group.screen_name ? `@${group.screen_name}` : '',
    avatar: group.photo_50 || group.photo_100 || '',
  }]));

  return { profiles, groups };
}

function mapComment(comment, source, maps) {
  const fromId = Number(comment.from_id || 0);
  const author = fromId < 0 ? maps.groups.get(Math.abs(fromId)) : maps.profiles.get(fromId);
  const commentId = String(comment.id);

  return {
    id: `vk:${source.externalId}:${commentId}`,
    sourceId: source.id,
    platformCommentId: commentId,
    parentCommentId: comment.reply_to_comment ? String(comment.reply_to_comment) : null,
    authorName: author?.name || (fromId ? `VK ${fromId}` : 'VK user'),
    authorUsername: author?.username || '',
    authorAvatar: author?.avatar || '',
    text: comment.text || '',
    publishedAt: comment.date ? new Date(Number(comment.date) * 1000).toISOString() : null,
    likeCount: Number(comment.likes?.count || 0),
    replyCount: Number(comment.thread?.count || 0),
    originalUrl: `https://vk.ru/video${source.ownerId}_${source.videoId}?reply=${commentId}`,
  };
}

export const vkAdapter = {
  id: 'vk',
  label: 'VK',

  canHandle(url) {
    try { return Boolean(parseVkVideoTarget(url)); } catch { return false; }
  },

  async getPost(url, settings = {}) {
    const target = parseVkVideoTarget(url);
    if (!target) throw new Error('Unsupported VK video URL.');

    let title = `VK video ${target.ownerId}_${target.videoId}`;
    let author = 'VK';
    let thumbnail = '';
    let commentCount = null;
    const token = String(settings.vkAccessToken || '').trim();

    if (token && settings.backendToken) {
      try {
        const videos = `${target.ownerId}_${target.videoId}${target.accessKey ? `_${target.accessKey}` : ''}`;
        const info = await vkApi('video.get', { videos, extended: 1 }, settings);
        const video = info?.items?.[0];
        if (video) {
          title = video.title || title;
          author = video.owner_id < 0 ? `VK community ${Math.abs(video.owner_id)}` : `VK user ${video.owner_id}`;
          commentCount = video.comments ?? null;
          const image = Array.isArray(video.image) ? video.image.at(-1) : null;
          thumbnail = image?.url || '';
        }
      } catch {
        // Source creation should still succeed; Refresh will show configuration/access errors.
      }
    }

    return {
      id: `vk:${target.ownerId}_${target.videoId}`,
      platform: 'vk',
      externalId: `${target.ownerId}_${target.videoId}`,
      ownerId: target.ownerId,
      videoId: target.videoId,
      accessKey: target.accessKey,
      url,
      title,
      author,
      thumbnail,
      publishedAt: null,
      commentCount,
      loadedCount: 0,
      nextCursor: '0',
      hasMore: true,
      integrationStatus: token ? 'ready' : 'token-required',
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async getComments(source, cursor, _limit, settings = {}) {
    requireToken(settings);
    requireBackend(settings);
    const offset = Math.max(0, Number.parseInt(cursor || '0', 10) || 0);
    const response = await vkApi('video.getComments', {
      owner_id: source.ownerId,
      video_id: source.videoId,
      offset,
      count: 100,
      sort: 'asc',
      extended: 1,
      need_likes: 1,
      thread_items_count: 10,
    }, settings);

    const maps = authorMaps(response || {});
    const items = Array.isArray(response?.items) ? response.items : [];
    const comments = items.map((comment) => mapComment(comment, source, maps));
    const total = Number(response?.count || 0);
    const nextOffset = offset + items.length;

    return {
      comments,
      nextCursor: nextOffset < total ? String(nextOffset) : null,
      hasMore: nextOffset < total,
      totalResults: total,
    };
  },
};
