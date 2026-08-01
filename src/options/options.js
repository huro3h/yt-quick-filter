(function () {
  'use strict';

  const {
    KIND,
    getData,
    setData,
    setGlobalEnabled,
    setFilterEnabled,
    removeFilter,
    addFilter,
    resolveChannelMetaFromHandle,
    resolveChannelMetaFromId,
  } = FilterStore;

  const $ = (id) => document.getElementById(id);

  const globalToggle = $('global-toggle');
  const globalStatus = $('global-status');
  const searchInput = $('search-input');
  const channelList = $('channel-list');
  const titleList = $('title-list');
  const channelCount = $('channel-count');
  const titleCount = $('title-count');
  const channelForm = $('channel-form');
  const channelValue = $('channel-value');
  const channelStatus = $('channel-status');
  const titleForm = $('title-form');
  const titleValue = $('title-value');
  const exportBtn = $('export-btn');
  const importBtn = $('import-btn');
  const importFile = $('import-file');
  const backupStatus = $('backup-status');

  let currentData = null;
  let currentQuery = '';

  function matchesQuery(filter) {
    if (!currentQuery) return true;
    const haystack = [filter.value, filter.name, filter.handle].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(currentQuery);
  }

  function makeRow(filter) {
    const li = document.createElement('li');
    li.className = 'filter-row' + (filter.enabled ? '' : ' disabled');

    const label = document.createElement('label');
    label.className = 'switch small';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = filter.enabled;
    input.addEventListener('change', async () => {
      await setFilterEnabled(filter.id, input.checked);
      filter.enabled = input.checked;
      li.classList.toggle('disabled', !input.checked);
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    label.append(input, slider);
    li.appendChild(label);

    const value = document.createElement('span');
    value.className = 'value';
    if (filter.kind === KIND.CHANNEL_ID) {
      value.title = [filter.name, filter.handle, filter.value].filter(Boolean).join(' · ');

      const label = filter.name || filter.handle;
      if (label) {
        const nameSpan = document.createElement('span');
        nameSpan.textContent = label;
        value.appendChild(nameSpan);

        const idSpan = document.createElement('span');
        idSpan.className = 'value-id';
        idSpan.textContent = ` (${filter.value})`;
        value.appendChild(idSpan);
      } else {
        value.textContent = filter.value;
      }
    } else {
      value.textContent = filter.value;
      value.title = filter.value;
    }
    li.appendChild(value);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = '削除';
    removeBtn.addEventListener('click', async () => {
      await removeFilter(filter.id);
      currentData.filters = currentData.filters.filter((f) => f.id !== filter.id);
      render();
    });
    li.appendChild(removeBtn);

    return li;
  }

  function render() {
    if (!currentData) return;

    const channelFilters = currentData.filters.filter((f) => f.kind === KIND.CHANNEL_ID && matchesQuery(f));
    const titleFilters = currentData.filters.filter((f) => f.kind === KIND.TITLE && matchesQuery(f));

    channelList.replaceChildren(...channelFilters.map(makeRow));
    titleList.replaceChildren(...titleFilters.map(makeRow));

    channelCount.textContent = String(channelFilters.length);
    titleCount.textContent = String(titleFilters.length);

    if (!channelFilters.length) {
      const p = document.createElement('li');
      p.className = 'empty-hint';
      p.textContent = '該当するチャンネルフィルターはありません';
      channelList.appendChild(p);
    }
    if (!titleFilters.length) {
      const p = document.createElement('li');
      p.className = 'empty-hint';
      p.textContent = '該当するタイトルフィルターはありません';
      titleList.appendChild(p);
    }
  }

  const statusTimers = new WeakMap();

  function flashStatus(el, text, autoHide = true) {
    el.textContent = text;
    const prevTimer = statusTimers.get(el);
    if (prevTimer) clearTimeout(prevTimer);
    if (!autoHide) return;
    const timer = setTimeout(() => {
      el.textContent = '';
      statusTimers.delete(el);
    }, 2000);
    statusTimers.set(el, timer);
  }

  // Accepts a channel id, an "@handle", or a full channel URL of either form.
  function classifyChannelInput(raw) {
    const value = raw.trim();
    const idInUrl = /\/channel\/(UC[\w-]{20,})/.exec(value);
    if (idInUrl) return { type: 'id', value: idInUrl[1] };

    const handleInUrl = /\/(@[\w.-]+)/.exec(value);
    if (handleInUrl) return { type: 'handle', value: handleInUrl[1].toLowerCase() };

    if (/^UC[\w-]{20,}$/.test(value)) return { type: 'id', value };
    if (/^@[\w.-]+$/.test(value)) return { type: 'handle', value: value.toLowerCase() };

    return null;
  }

  async function init() {
    currentData = await getData();
    globalToggle.checked = !!currentData.enabled;
    globalStatus.textContent = currentData.enabled ? '有効' : '無効';
    render();
  }

  globalToggle.addEventListener('change', async () => {
    currentData = await setGlobalEnabled(globalToggle.checked);
    globalStatus.textContent = currentData.enabled ? '有効' : '無効';
  });

  searchInput.addEventListener('input', () => {
    currentQuery = searchInput.value.trim().toLowerCase();
    render();
  });

  channelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = channelValue.value.trim();
    if (!raw) return;

    const parsed = classifyChannelInput(raw);
    if (!parsed) {
      flashStatus(channelStatus, 'チャンネルID・@ハンドル・チャンネルURLのいずれかで入力してください');
      return;
    }

    const submitBtn = channelForm.querySelector('button[type="submit"]');
    channelValue.disabled = true;
    submitBtn.disabled = true;
    flashStatus(channelStatus, 'チャンネル情報を解決中...', false);

    let id;
    let handle;
    let name;

    if (parsed.type === 'id') {
      id = parsed.value;
      const meta = await resolveChannelMetaFromId(id);
      handle = meta.handle;
      name = meta.name;
    } else {
      handle = parsed.value;
      const meta = await resolveChannelMetaFromHandle(handle);
      id = meta.id;
      name = meta.name;
    }

    channelValue.disabled = false;
    submitBtn.disabled = false;

    if (!id) {
      flashStatus(channelStatus, 'チャンネルIDを取得できませんでした');
      return;
    }

    currentData = await addFilter(KIND.CHANNEL_ID, id, { handle, name });
    channelValue.value = '';
    render();
    flashStatus(channelStatus, `追加しました (${name || handle || id})`);
  });

  titleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = titleValue.value.trim();
    if (!value) return;
    currentData = await addFilter(KIND.TITLE, value);
    titleValue.value = '';
    render();
  });

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'yt-quick-filter-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    flashStatus(backupStatus, 'エクスポートしました');
  });

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        if (!Array.isArray(json.filters)) throw new Error('invalid');
        await setData(json);
        currentData = json;
        globalToggle.checked = !!currentData.enabled;
        globalStatus.textContent = currentData.enabled ? '有効' : '無効';
        render();
        flashStatus(backupStatus, 'インポートしました');
      } catch (err) {
        flashStatus(backupStatus, '無効なバックアップファイルです');
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (Object.hasOwn(changes, FilterStore.STORAGE_KEY)) {
      currentData = changes[FilterStore.STORAGE_KEY].newValue;
      globalToggle.checked = !!currentData.enabled;
      globalStatus.textContent = currentData.enabled ? '有効' : '無効';
      render();
    }
  });

  document.addEventListener('DOMContentLoaded', init);
})();
