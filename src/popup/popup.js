(function () {
  'use strict';

  const { KIND, getData, setGlobalEnabled, setCategoryEnabled, setFilterEnabled, removeFilter, channelDisplayLabel } = FilterStore;

  const globalToggle = document.getElementById('global-toggle');
  const searchInput = document.getElementById('search-input');
  const channelList = document.getElementById('channel-list');
  const titleList = document.getElementById('title-list');
  const channelCount = document.getElementById('channel-count');
  const titleCount = document.getElementById('title-count');
  const channelEmpty = document.getElementById('channel-empty');
  const titleEmpty = document.getElementById('title-empty');
  const titleCategoryToggle = document.getElementById('title-category-toggle');
  const channelCategoryToggle = document.getElementById('channel-category-toggle');
  const openOptions = document.getElementById('open-options');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panels = {
    title: document.getElementById('panel-title'),
    channel: document.getElementById('panel-channel'),
  };

  let currentData = null;
  let currentQuery = '';

  function setActiveTab(tab) {
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    panels.title.hidden = tab !== 'title';
    panels.channel.hidden = tab !== 'channel';
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  function matchesQuery(filter) {
    if (!currentQuery) return true;
    const haystack = [filter.value, filter.name, filter.handle].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(currentQuery);
  }

  function makeRow(filter, categoryOn) {
    const li = document.createElement('li');
    li.className = 'filter-row' + (filter.enabled && categoryOn ? '' : ' disabled');

    const toggleId = `filter-toggle-${filter.id}`;

    const label = document.createElement('label');
    label.className = 'switch small';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = toggleId;
    input.checked = filter.enabled;
    input.addEventListener('change', async () => {
      await setFilterEnabled(filter.id, input.checked);
      li.classList.toggle('disabled', !(input.checked && categoryOn));
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    label.append(input, slider);

    li.appendChild(label);

    const value = document.createElement('label');
    value.className = 'value';
    value.htmlFor = toggleId;
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

    const categoryEnabled = currentData.categoryEnabled || {};
    const titleOn = categoryEnabled[KIND.TITLE] !== false;
    const channelOn = categoryEnabled[KIND.CHANNEL_ID] !== false;

    const channelFilters = currentData.filters.filter((f) => f.kind === KIND.CHANNEL_ID && matchesQuery(f));
    const titleFilters = currentData.filters.filter((f) => f.kind === KIND.TITLE && matchesQuery(f));

    channelList.replaceChildren(...channelFilters.map((f) => makeRow(f, channelOn)));
    titleList.replaceChildren(...titleFilters.map((f) => makeRow(f, titleOn)));

    channelCount.textContent = String(channelFilters.length);
    titleCount.textContent = String(titleFilters.length);

    channelEmpty.style.display = channelFilters.length ? 'none' : 'block';
    titleEmpty.style.display = titleFilters.length ? 'none' : 'block';

    titleCategoryToggle.checked = titleOn;
    channelCategoryToggle.checked = channelOn;
  }

  async function init() {
    setActiveTab('title');
    currentData = await getData();
    globalToggle.checked = !!currentData.enabled;
    render();
  }

  globalToggle.addEventListener('change', async () => {
    currentData = await setGlobalEnabled(globalToggle.checked);
  });

  titleCategoryToggle.addEventListener('change', async () => {
    currentData = await setCategoryEnabled(KIND.TITLE, titleCategoryToggle.checked);
    render();
  });

  channelCategoryToggle.addEventListener('change', async () => {
    currentData = await setCategoryEnabled(KIND.CHANNEL_ID, channelCategoryToggle.checked);
    render();
  });

  searchInput.addEventListener('input', () => {
    currentQuery = searchInput.value.trim().toLowerCase();
    render();
  });

  openOptions.addEventListener('click', () => {
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
