const STORAGE_KEY = 'ytQuickFilterData';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (!result[STORAGE_KEY]) {
      chrome.storage.local.set({
        [STORAGE_KEY]: { enabled: true, filters: [] },
      });
    }
  });
});
