(function () {
  'use strict';

  const { KIND, getData, setGlobalEnabled, setFilterEnabled, removeFilter, channelDisplayLabel } = FilterStore;

  const globalToggle = document.getElementById('global-toggle');
  const searchInput = document.getElementById('search-input');
  const channelList = document.getElementById('channel-list');
  const titleList = document.getElementById('title-list');
  const channelCount = document.getElementById('channel-count');
  const titleCount = document.getElementById('title-count');
  const channelEmpty = document.getElementById('channel-empty');
  const titleEmpty = document.getElementById('title-empty');
  const openOptions = document.getElementById('open-options');

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
      li.classList.toggle('disabled', !input.checked);
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    label.append(input, slider);

    li.appendChild(label);

    const value = document.createElement('span');
    value.className = 'value';
    if (filter.kind === KIND.CHANNEL_ID) {
      value.textContent = channelDisplayLabel(filter);
      value.title = [filter.name, filter.handle, filter.value].filter(Boolean).join(' · ');
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

    channelEmpty.style.display = channelFilters.length ? 'none' : 'block';
    titleEmpty.style.display = titleFilters.length ? 'none' : 'block';
  }

  async function init() {
    currentData = await getData();
    globalToggle.checked = !!currentData.enabled;
    render();
  }

  globalToggle.addEventListener('change', async () => {
    currentData = await setGlobalEnabled(globalToggle.checked);
  });

  searchInput.addEventListener('input', () => {
    currentQuery = searchInput.value.trim().toLowerCase();
    render();
  });

  openOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (Object.hasOwn(changes, FilterStore.STORAGE_KEY)) {
      currentData = changes[FilterStore.STORAGE_KEY].newValue;
      globalToggle.checked = !!currentData.enabled;
      render();
    }
  });

  document.addEventListener('DOMContentLoaded', init);
})();
