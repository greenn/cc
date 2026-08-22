function parseHolywarUrl(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'holywarsoo.net') return null;
  if (!url.pathname.endsWith('/viewtopic.php') && url.pathname !== '/viewtopic.php') return null;

  const topicId = url.searchParams.get('id');
  if (!topicId || !/^\d+$/.test(topicId)) return null;

  const page = Math.max(1, Number.parseInt(url.searchParams.get('p') || '1', 10) || 1);
  return { topicId, page };
}

function buildPageUrl(topicId, page) {
  const url = new URL('https://holywarsoo.net/viewtopic.php');
  url.searchParams.set('id', topicId);
  url.searchParams.set('p', String(Math.max(1, page)));
  return url.toString();
}

async function fetchHtml(targetUrl) {
  try {
    const direct = await fetch(targetUrl, { headers: { Accept: 'text/html' } });
    if (direct.ok) return await direct.text();
  } catch {
    // GitHub Pages normally cannot read arbitrary forum HTML because of CORS.
  }

  const readerUrl = `https://r.jina.ai/${targetUrl}`;
  const response = await fetch(readerUrl, {
    headers: {
      Accept: 'text/plain',
      'X-Return-Format': 'html',
      'X-Target-Selector': '#brdmain',
      'X-No-Cache': 'true',
    },
  });

  if (!response.ok) {
    throw new Error(`Forum page could not be loaded (${response.status}).`);
  }

  return await response.text();
}

function normalizeText(node) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll('script, style, .postsignature, .postedit').forEach((item) => item.remove());
  clone.querySelectorAll('br').forEach((item) => item.replaceWith('\n'));
  clone.querySelectorAll('p, blockquote, li').forEach((item) => item.append('\n'));
  return (clone.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function parseDate(text) {
  const match = String(text || '').match(/(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (!match) return null;
  return `${match[1]}T${match[2]}`;
}

function parsePageNumberFromHref(href) {
  try {
    const url = new URL(href, 'https://holywarsoo.net/');
    const page = Number.parseInt(url.searchParams.get('p') || '', 10);
    return Number.isFinite(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}

function parseForumPage(html, pageUrl, topicId, currentPage) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  let title = normalizeText(doc.querySelector('#brdmain h1 span, #brdmain h1, h1 span, h1'));
  if (!title) title = (doc.title || '').split(' / ')[0].replace(/\s*\(Страница\s+\d+\)\s*$/i, '').trim();
  if (!title) title = `Holywarsoo topic ${topicId}`;

  const pageLinks = [...doc.querySelectorAll('a[href*="viewtopic.php"][href*="p="]')]
    .map((link) => parsePageNumberFromHref(link.getAttribute('href') || ''))
    .filter(Boolean);
  const totalPages = Math.max(currentPage, ...pageLinks, 1);

  let postNodes = [...doc.querySelectorAll('.blockpost[id^="p"], div[id^="p"].blockpost, article[id^="p"]')];
  if (!postNodes.length) {
    postNodes = [...doc.querySelectorAll('[id^="p"]')].filter((node) =>
      node.querySelector('.postmsg, .postright, .postbody, .message')
    );
  }

  const comments = postNodes.map((post, index) => {
    const rawId = (post.id || '').replace(/^p/, '');
    const permalink = post.querySelector('a[href*="pid="], a[href*="#p"]');
    let postId = rawId;

    if (!postId && permalink) {
      try {
        const parsed = new URL(permalink.getAttribute('href'), pageUrl);
        postId = parsed.searchParams.get('pid') || parsed.hash.replace(/^#p?/, '');
      } catch {
        postId = '';
      }
    }

    if (!postId) postId = `${currentPage}-${index + 1}`;

    const authorNode = post.querySelector('.postleft dt strong, .postleft dt, .postauthor, .username, .author');
    const authorName = normalizeText(authorNode) || 'Анон';
    const messageNode = post.querySelector('.postright .postmsg, .postmsg, .postbody, .message, .postright');
    const text = normalizeText(messageNode);
    const headerText = normalizeText(post.querySelector('h2, .posthead, .post-header'));
    const date = parseDate(headerText);

    let originalUrl = `${pageUrl}#p${postId}`;
    if (permalink) {
      try {
        originalUrl = new URL(permalink.getAttribute('href'), pageUrl).toString();
      } catch {
        // keep fallback URL
      }
    }

    const avatar = post.querySelector('.postleft img, .postauthor img, img.avatar');
    let authorAvatar = '';
    if (avatar?.getAttribute('src')) {
      try {
        authorAvatar = new URL(avatar.getAttribute('src'), pageUrl).toString();
      } catch {
        authorAvatar = '';
      }
    }

    return {
      id: `holywarsoo:${postId}`,
      sourceId: `holywarsoo:${topicId}`,
      platformCommentId: String(postId),
      parentCommentId: null,
      authorName,
      authorUsername: 'holywarsoo.net',
      authorAvatar,
      text,
      publishedAt: date,
      likeCount: 0,
      replyCount: 0,
      originalUrl,
      forumPage: currentPage,
    };
  }).filter((comment) => comment.text);

  if (!comments.length) {
    throw new Error('The forum page was loaded, but no posts could be recognized. The forum layout may have changed.');
  }

  return { title, totalPages, comments };
}

async function loadPage(topicId, page) {
  const url = buildPageUrl(topicId, page);
  const html = await fetchHtml(url);
  return { url, ...parseForumPage(html, url, topicId, page) };
}

export const holywarsooAdapter = {
  id: 'holywarsoo',
  label: 'Holywarsoo',

  canHandle(url) {
    try {
      return Boolean(parseHolywarUrl(url));
    } catch {
      return false;
    }
  },

  async getPost(url) {
    const parsed = parseHolywarUrl(url);
    if (!parsed) throw new Error('Unsupported Holywarsoo topic URL.');

    const page = await loadPage(parsed.topicId, parsed.page);
    return {
      id: `holywarsoo:${parsed.topicId}`,
      platform: 'holywarsoo',
      externalId: parsed.topicId,
      url: buildPageUrl(parsed.topicId, parsed.page),
      title: page.title,
      author: 'Holywarsoo',
      thumbnail: '',
      publishedAt: null,
      commentCount: null,
      loadedCount: 0,
      startPage: parsed.page,
      currentPage: parsed.page,
      totalPages: page.totalPages,
      nextCursor: String(parsed.page),
      hasMore: true,
      integrationStatus: 'ready',
      lastVisibleCommentId: null,
      lastOpenedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async getComments(source, cursor) {
    const pageNumber = Math.max(1, Number.parseInt(cursor || source.startPage || '1', 10) || 1);
    const page = await loadPage(source.externalId, pageNumber);
    const hasMore = pageNumber < page.totalPages;

    return {
      comments: page.comments,
      nextCursor: hasMore ? String(pageNumber + 1) : null,
      hasMore,
      totalResults: null,
      currentPage: pageNumber,
      totalPages: page.totalPages,
    };
  },
};
