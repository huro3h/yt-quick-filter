/**
 * Shared storage/data-model module for YT Quick Filter.
 * Loaded as a plain script in popup, options, and content-script contexts
 * (attaches itself to `self.FilterStore`).
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'ytQuickFilterData';

  const KIND = {
    CHANNEL_ID: 'channelId',
    TITLE: 'title',
  };

  function defaultData() {
    return {
      enabled: true,
      filters: [],
    };
  }

  function genId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const data = result[STORAGE_KEY];
        if (!data || !Array.isArray(data.filters)) {
          resolve(defaultData());
          return;
        }
        resolve(data);
      });
    });
  }

  function setData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
    });
  }

  // `meta.handle` (e.g. "@somechannel") is an optional extra matching key for
  // channelId filters, since YouTube frequently renders channel links as
  // "/@handle" in the DOM without the underlying UC id anywhere visible.
  // `meta.name` is the channel's display name, kept purely so the UI can show
  // something more recognizable than a raw UC id.
  async function addFilter(kind, value, meta = {}) {
    const trimmed = value.trim();
    if (!trimmed) return getData();

    const data = await getData();
    const existing = data.filters.find(
      (f) => f.kind === kind && f.value.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      existing.enabled = true;
      if (meta.handle) existing.handle = meta.handle.toLowerCase();
      if (meta.name) existing.name = meta.name;
    } else {
      const filter = {
        id: genId(),
        kind,
        value: trimmed,
        enabled: true,
        createdAt: Date.now(),
      };
      if (meta.handle) filter.handle = meta.handle.toLowerCase();
      if (meta.name) filter.name = meta.name;
      data.filters.push(filter);
    }
    await setData(data);
    return data;
  }

  // Best label to show a channelId filter as: prefer the human-readable name,
  // fall back to the handle, and finally the raw UC id.
  function channelDisplayLabel(filter) {
    return filter.name || filter.handle || filter.value;
  }

  async function removeFilter(id) {
    const data = await getData();
    data.filters = data.filters.filter((f) => f.id !== id);
    await setData(data);
    return data;
  }

  async function setFilterEnabled(id, enabled) {
    const data = await getData();
    const filter = data.filters.find((f) => f.id === id);
    if (filter) filter.enabled = enabled;
    await setData(data);
    return data;
  }

  async function setGlobalEnabled(enabled) {
    const data = await getData();
    data.enabled = enabled;
    await setData(data);
    return data;
  }

  // Parse a title filter value into a RegExp.
  // Supports raw `/pattern/flags` syntax (like BlockTube) or falls back to a
  // plain case-insensitive substring/word match.
  function buildTitleRegex(value) {
    const explicit = /^\/(.*)\/([a-z]*)$/.exec(value);
    if (explicit) {
      try {
        return new RegExp(explicit[1], explicit[2]);
      } catch (e) {
        return null;
      }
    }
    try {
      const escaped = value.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
      return new RegExp(escaped, 'i');
    } catch (e) {
      return null;
    }
  }

  // Resolve a channel's id / handle / display name from its public page HTML.
  // Used both by the content script's "block channel" button (for the id it
  // can't read from a "/@handle" link) and the options page's manual add
  // form, so a value typed/discovered in either form can be stored alongside
  // its counterparts for more reliable DOM matching and a readable label.
  function extractChannelMetaFromHtml(html) {
    const idMatch = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/.exec(html);
    const handleMatch = /"vanityChannelUrl":"https?:\/\/(?:www\.)?youtube\.com\/(@[^"\\]+)"/.exec(html);
    const nameMatch = /"channelMetadataRenderer":\{"title":"((?:[^"\\]|\\.)*)"/.exec(html);

    let name = null;
    if (nameMatch) {
      try {
        name = JSON.parse(`"${nameMatch[1]}"`);
      } catch (e) {
        name = null;
      }
    }

    return {
      id: idMatch ? idMatch[1] : null,
      handle: handleMatch ? handleMatch[1].toLowerCase() : null,
      name,
    };
  }

  async function fetchChannelMeta(url) {
    try {
      const res = await fetch(url);
      const html = await res.text();
      return extractChannelMetaFromHtml(html);
    } catch (e) {
      return { id: null, handle: null, name: null };
    }
  }

  function resolveChannelMetaFromHandle(handle) {
    return fetchChannelMeta(`https://www.youtube.com/${handle}`);
  }

  function resolveChannelMetaFromId(id) {
    return fetchChannelMeta(`https://www.youtube.com/channel/${id}`);
  }

  // Build fast lookup structures for the content script from raw storage data.
  function compileMatchers(data) {
    const matchers = {
      enabled: !!data.enabled,
      channelIds: new Set(),
      channelHandles: new Set(),
      titles: [],
    };

    if (!matchers.enabled) return matchers;

    for (const f of data.filters) {
      if (!f.enabled) continue;
      if (f.kind === KIND.CHANNEL_ID) {
        matchers.channelIds.add(f.value.trim());
        if (f.handle) matchers.channelHandles.add(f.handle.toLowerCase());
      } else if (f.kind === KIND.TITLE) {
        const re = buildTitleRegex(f.value);
        if (re) matchers.titles.push(re);
      }
    }

    return matchers;
  }

  root.FilterStore = {
    KIND,
    STORAGE_KEY,
    defaultData,
    getData,
    setData,
    addFilter,
    removeFilter,
    setFilterEnabled,
    setGlobalEnabled,
    buildTitleRegex,
    compileMatchers,
    channelDisplayLabel,
    resolveChannelMetaFromHandle,
    resolveChannelMetaFromId,
  };
})(typeof window !== 'undefined' ? window : self);
