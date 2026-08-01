(function () {
  'use strict';

  // Container-level renderers: each one represents a single video or channel "card".
  const VIDEO_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-radio-renderer',
    'yt-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
  ];

  const CHANNEL_SELECTORS = ['ytd-channel-renderer', 'ytd-grid-channel-renderer'];

  const ALL_SELECTOR = VIDEO_SELECTORS.concat(CHANNEL_SELECTORS).join(',');

  const TITLE_SELECTORS = [
    '#video-title',
    'a#video-title-link',
    'span#video-title',
    '.yt-lockup-metadata-view-model-wiz__title',
    'h3 a',
    '#title a',
    '#title',
  ];

  const CHANNEL_LINK_SELECTORS = [
    'ytd-channel-name a',
    '#channel-name a',
    '.yt-content-metadata-view-model a',
    'ytd-video-owner-renderer a',
    '#byline a',
  ];

  // Elements to insert the block button before, so it's not fighting with a
  // Polymer component's own re-rendering of its light-dom text content.
  const CHANNEL_NAME_BLOCK_SELECTORS = [
    'ytd-channel-name',
    'ytd-video-owner-renderer',
    '.yt-content-metadata-view-model',
    '#channel-name',
    '#byline',
  ];

  const BLOCK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><line x1="5.8" y1="18.2" x2="18.2" y2="5.8"></line></svg>';

  let matchers = { enabled: false, channelIds: new Set(), channelHandles: new Set(), titles: [] };

  function textOf(el) {
    if (!el) return '';
    return (el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').trim();
  }

  function firstMatch(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findChannelLink(root) {
    const el = firstMatch(root, CHANNEL_LINK_SELECTORS);
    if (el) return el;
    // Fallback: any link that looks like a channel/handle URL.
    const links = root.querySelectorAll('a[href^="/channel/"], a[href^="/@"]');
    return links.length ? links[0] : null;
  }

  function extractChannelId(href) {
    const m = /\/channel\/(UC[\w-]{20,})/.exec(href || '');
    return m ? m[1] : null;
  }

  function extractChannelHandle(href) {
    const m = /^\/(@[\w.-]+)/.exec(href || '');
    return m ? m[1].toLowerCase() : null;
  }

  // Newer YouTube layouts mostly render channel links as "/@handle" instead of
  // "/channel/UC...", so the UC id often isn't present in the DOM at all.
  async function resolveChannelId(href) {
    const directId = extractChannelId(href);
    if (directId) return directId;

    const handle = extractChannelHandle(href);
    if (!handle) return null;

    const meta = await FilterStore.resolveChannelMetaFromHandle(handle);
    return meta.id;
  }

  function isChannelBlocked(href) {
    const id = extractChannelId(href);
    if (id && matchers.channelIds.has(id)) return true;

    const handle = extractChannelHandle(href);
    if (handle && matchers.channelHandles.has(handle)) return true;

    return false;
  }

  function isTitleBlocked(title) {
    if (!title) return false;
    return matchers.titles.some((re) => re.test(title));
  }

  function evaluateVideoCard(el) {
    const titleEl = firstMatch(el, TITLE_SELECTORS);
    const title = textOf(titleEl);
    if (isTitleBlocked(title)) return true;

    const channelLink = findChannelLink(el);
    if (channelLink) {
      const href = channelLink.getAttribute('href') || '';
      if (isChannelBlocked(href)) return true;
    }
    return false;
  }

  function evaluateChannelCard(el) {
    const link = el.querySelector('a[href^="/channel/"], a[href^="/@"]');
    const href = link ? link.getAttribute('href') || '' : '';
    return isChannelBlocked(href);
  }

  // ---- Block button injected next to the channel name ----

  let toastEl = null;
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'yqf-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    requestAnimationFrame(() => toastEl.classList.add('yqf-toast-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('yqf-toast-visible');
    }, 2200);
  }

  async function handleBlockButtonClick(event, link) {
    event.preventDefault();
    event.stopPropagation();

    const href = link.getAttribute('href') || '';
    if (!href) {
      showToast('チャンネル情報を取得できませんでした');
      return;
    }

    showToast('チャンネルをブロック中...');
    const handle = extractChannelHandle(href);
    const name = textOf(link);
    const id = await resolveChannelId(href);
    if (!id) {
      showToast('チャンネルIDを取得できませんでした');
      return;
    }

    await FilterStore.addFilter(FilterStore.KIND.CHANNEL_ID, id, { handle, name });
    showToast('チャンネルをブロックしました');
    scanAll();
  }

  function ensureBlockButton(el) {
    if (el.dataset.yqfBtnAdded) return;

    const link = findChannelLink(el) || el.querySelector('a[href^="/channel/"], a[href^="/@"]');
    if (!link) return;

    const anchorPoint = link.closest(CHANNEL_NAME_BLOCK_SELECTORS.join(',')) || link;
    const parent = anchorPoint.parentElement;
    if (!parent) return;

    el.dataset.yqfBtnAdded = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yqf-block-btn';
    btn.title = 'このチャンネルをブロック';
    btn.setAttribute('aria-label', 'チャンネルをブロック');
    btn.innerHTML = BLOCK_ICON_SVG;
    btn.addEventListener('click', (event) => handleBlockButtonClick(event, link));

    parent.insertBefore(btn, anchorPoint);
  }

  function processElement(el) {
    if (!el.matches || !el.matches(ALL_SELECTOR)) return;

    ensureBlockButton(el);

    let blocked = false;
    if (matchers.enabled) {
      blocked = CHANNEL_SELECTORS.some((sel) => el.matches(sel))
        ? evaluateChannelCard(el)
        : evaluateVideoCard(el);
    }

    if (blocked) {
      el.style.setProperty('display', 'none', 'important');
      el.dataset.yqfHidden = '1';
    } else if (el.dataset.yqfHidden === '1') {
      el.style.removeProperty('display');
      delete el.dataset.yqfHidden;
    }
  }

  function scanAll() {
    document.querySelectorAll(ALL_SELECTOR).forEach(processElement);
  }

  // Batch mutation-triggered work into animation frames to avoid thrashing.
  const pending = new Set();
  let scheduled = false;

  function flushPending() {
    scheduled = false;
    pending.forEach((el) => {
      if (!el.isConnected) return;
      if (el.matches && el.matches(ALL_SELECTOR)) {
        processElement(el);
      } else if (el.querySelectorAll) {
        el.querySelectorAll(ALL_SELECTOR).forEach(processElement);
      }
    });
    pending.clear();
  }

  function schedule(el) {
    pending.add(el);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flushPending);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        schedule(node);
      });
    }
  });

  function startObserving() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function refreshMatchers(data) {
    matchers = FilterStore.compileMatchers(data);
    scanAll();
  }

  function init() {
    FilterStore.getData().then(refreshMatchers);

    if (document.documentElement) {
      startObserving();
    } else {
      new MutationObserver((_, obs) => {
        if (document.documentElement) {
          obs.disconnect();
          startObserving();
        }
      }).observe(document, { childList: true });
    }
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (Object.hasOwn(changes, FilterStore.STORAGE_KEY)) {
      refreshMatchers(changes[FilterStore.STORAGE_KEY].newValue);
    }
  });

  document.addEventListener('yt-navigate-finish', scanAll);
  document.addEventListener('DOMContentLoaded', scanAll);

  init();
})();
