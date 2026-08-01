importScripts('../lib/filterStore.js');

const { STORAGE_KEY, KIND, defaultData, getData, setGlobalEnabled, setCategoryEnabled } = FilterStore;

const BADGE_BG_COLOR = '#5f6368';

// chrome.action.setIcon's `path` needs a fully-resolved extension URL here —
// a plain relative string intermittently fails with "Failed to fetch" when
// called from the service worker (resolved against the wrong base).
function iconSet(suffix) {
  return {
    16: chrome.runtime.getURL(`assets/icons/16${suffix}.png`),
    48: chrome.runtime.getURL(`assets/icons/48${suffix}.png`),
    128: chrome.runtime.getURL(`assets/icons/128${suffix}.png`),
  };
}

const ICON_OFF = iconSet('');
const ICON_ON = iconSet('-on');

// Encodes both category states in the toolbar badge as two letters, since
// the action API only supports one badge per icon: "T"/"C" when that
// category is actually filtering (global switch AND category switch both
// on), "-" when it isn't. Lets the user see both toggle states at a glance
// without opening the popup.
function badgeTextFor(data) {
  const globalOn = !!data.enabled;
  const categoryEnabled = data.categoryEnabled || {};
  const titleOn = globalOn && categoryEnabled[KIND.TITLE] !== false;
  const channelOn = globalOn && categoryEnabled[KIND.CHANNEL_ID] !== false;
  return `${titleOn ? 'T' : '-'}${channelOn ? 'C' : '-'}`;
}

async function refreshActionUi() {
  const data = await getData();
  chrome.action.setBadgeText({ text: badgeTextFor(data) });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_BG_COLOR });
  chrome.action.setIcon({ path: data.enabled ? ICON_ON : ICON_OFF });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (!result[STORAGE_KEY]) {
      chrome.storage.local.set({ [STORAGE_KEY]: defaultData() }, refreshActionUi);
    } else {
      refreshActionUi();
    }
  });
});

chrome.runtime.onStartup.addListener(refreshActionUi);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.hasOwn(changes, STORAGE_KEY)) {
    refreshActionUi();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const data = await getData();

  if (command === '01_toggle-global') {
    await setGlobalEnabled(!data.enabled);
  } else if (command === '02_toggle-title-filters') {
    const on = (data.categoryEnabled || {})[KIND.TITLE] !== false;
    await setCategoryEnabled(KIND.TITLE, !on);
  } else if (command === '03_toggle-channel-filters') {
    const on = (data.categoryEnabled || {})[KIND.CHANNEL_ID] !== false;
    await setCategoryEnabled(KIND.CHANNEL_ID, !on);
  }
});
