---
name: yt-quick-filter-dev
description: Architecture and implementation notes for the YT Quick Filter Chrome extension (channel/title blocking with popup toggles). Use when extending, debugging, or adding features to this extension.
---

# YT Quick Filter — development notes

A Manifest V3 Chrome extension that blocks YouTube channels (by ID) and video
titles (by keyword/regex), with per-entry ON/OFF toggles manageable from the
popup, plus a management screen (options page) for adding/removing filters.

It was built as a lighter, popup-first alternative to existing YouTube
filtering extensions that manage everything through a single options page
text editor. The scope was deliberately kept narrow: **channel ID + title
keyword filtering only** — no video ID / comment / advanced JS blocking.

## File layout

```
manifest.json                 MV3 manifest
assets/icons/{16,48,128}.png  Toolbar icon
src/lib/filterStore.js        Shared data model + storage + resolvers (plain script, attaches to window/self.FilterStore)
src/scripts/background.js     Sets default storage on install. Nothing else.
src/scripts/content.js        Runs on youtube.com: DOM filtering + "block channel" button
src/scripts/content.css       Styles for the injected block button + toast
src/popup/                    Popup UI: master ON/OFF + per-filter toggle list + search
src/options/                  Options page: add/remove filters, backup import/export
```

`filterStore.js` is loaded as a plain (non-module) script in all three
contexts (content script, popup, options), so `FilterStore.*` is available as
a global everywhere. Content script load order in the manifest matters:
`filterStore.js` must precede `content.js`.

## Storage schema

Single `chrome.storage.local` key `ytQuickFilterData`:

```js
{
  enabled: true,           // global kill switch
  filters: [
    {
      id: "abc123",         // generated, not the channel id
      kind: "channelId",    // "channelId" | "title"
      value: "UCxxxxxxxxxxxxxxxxxxxxxx",  // canonical UC id (channelId) or keyword/regex text (title)
      enabled: true,
      createdAt: 1234567890,
      handle: "@somechannel",  // channelId only, optional — see "Handle matching" below
      name: "Some Channel",    // channelId only, optional — display label only, not used for matching
    },
  ],
}
```

Title filters support `/pattern/flags` regex syntax, else
fall back to a plain case-insensitive substring match (`FilterStore.buildTitleRegex`).

## Why channel filtering needs both an ID and a handle

YouTube's rendered channel links are inconsistent: a lot of surfaces (search
results, home feed, subscriptions) now render `href="/@handle"` instead of
`href="/channel/UC..."`. The UC id essentially never appears in that DOM at
all — it only lives in YouTube's internal JSON data model, which a plain
content script can't reach (page-context JS state isn't visible from an
isolated-world content script without deeper reverse engineering, which we
intentionally avoided — see "Rejected approach" below).

So every channelId filter is matched two ways (`FilterStore.compileMatchers`
→ `channelIds` Set + `channelHandles` Set; `content.js` → `isChannelBlocked`):

- if the card's link is `/channel/UC...` → compare the UC id directly
- if the card's link is `/@handle` → compare the lowercased handle directly

Whenever we only have one identifier (user blocked via a handle-rendered
card, or typed just an ID into the options form), we resolve the other one
by fetching the channel's public page and reading identifiers YouTube embeds
in the HTML — no login/cookies needed, it's public data:

- `<link rel="canonical" href="https://www.youtube.com/channel/UC...">` → UC id
- `"vanityChannelUrl":"https://www.youtube.com/@handle"` → handle
- `"channelMetadataRenderer":{"title":"..."}` → display name

All three come from a **single fetch**, done in `FilterStore.resolveChannelMetaFromHandle(handle)` /
`resolveChannelMetaFromId(id)` (`extractChannelMetaFromHtml` does the regex
extraction). Both the content script's block button and the options page's
manual-add form call these.

Manually-added filters where the user only typed a UC id (and resolution
failed/was skipped) won't match handle-rendered cards until re-resolved —
this is a known, accepted gap.

## Content script filtering (`src/scripts/content.js`)

Pure DOM approach, no page-context/MAIN-world injection, no interception of
YouTube's fetch/XHR responses:

- `ALL_SELECTOR` — a curated list of "card" custom elements representing one
  video or channel (`ytd-rich-item-renderer`, `ytd-video-renderer`,
  `ytd-compact-video-renderer`, `yt-lockup-view-model` for the newer Lit-based
  redesign, `ytd-channel-renderer`, etc.)
- A single `MutationObserver` on `document.documentElement` batches newly
  added nodes into a `requestAnimationFrame`-flushed queue (`schedule`/`flushPending`)
  and runs `processElement` on anything matching `ALL_SELECTOR`.
- `processElement` extracts the title text and channel link href from each
  card via a prioritized list of selectors with generic fallbacks
  (`TITLE_SELECTORS`, `CHANNEL_LINK_SELECTORS`), checks them against the
  compiled matchers, and hides matches with `display:none !important` +
  a `data-yqf-hidden` marker (so it can be un-hidden if filters change).
- Re-runs on `yt-navigate-finish` (YouTube's SPA navigation event) and on
  `chrome.storage.onChanged` for the filter data key.

### Rejected approach: injecting into YouTube's native "⋮" menu

The original ask was a "Block Channel" item inside YouTube's own three-dot
context menu, matching how some other blocking extensions do it. That
requires intercepting `ytInitialData`/XHR-JSON responses and injecting fake
menu-item entries into YouTube's internal Polymer data model (deep,
version-fragile reverse engineering — parsing `eventSink`/`polymerController`
internals, different renderer shapes per surface, etc.). We prototyped a
DOM-only variant (clone an existing menu item into the rendered dropdown)
but it was unreliable to detect/verify without live browser testing and was
abandoned per user request.

**Current approach instead:** a small button is injected directly into each
card, immediately before the channel-name block (`ensureBlockButton`,
inserted before the closest of `ytd-channel-name` / `ytd-video-owner-renderer`
/ `.yt-content-metadata-view-model` / `#channel-name` / `#byline`, not inside
it — inserting *inside* those risks the Polymer component wiping our node on
its own re-render). One button per card, guarded by a `data-yqf-btn-added`
flag. Click handler: `preventDefault`/`stopPropagation` (cards are often
wrapped in a navigation `<a>`), resolve the channel id (fetching only if the
DOM only gave us a handle), `FilterStore.addFilter(...)`, toast, `scanAll()`.

Icon: Google Material Symbols "block" glyph (Apache-2.0, free to use),
rasterized from its official SVG path — see `assets/icons/`. The same visual
language (gray circle+slash) is reused inline for the per-card block button
(`BLOCK_ICON_SVG` in `content.js`).

## UI display conventions

- Popup and options both render channel filters as **name (fallback: handle,
  fallback: raw ID)**. Options additionally shows the raw ID in a muted
  `.value-id` span next to the name when a name/handle is known (`"Some Channel (UC...)"`).
  Popup keeps it to a single label (space-constrained).
- Search boxes (popup + options) match against `value`, `name`, and `handle`
  all at once.
- `addFilter(kind, value, meta)` de-dupes by `kind` + lowercased `value`; a
  re-add just re-enables the existing entry and refreshes `meta.handle`/`meta.name`
  if newly provided.

## Repo hygiene: no real examples in comments/docs

This repo is **public** (`github.com/huro3h/yt-quick-filter`). While
implementing or debugging, it's normal to reference a real article, channel,
or other identifying source as a concrete example (e.g. testing handle
resolution against an actual channel). That's fine for in-conversation
discussion, but **never carry it into code comments, commit messages, or
this skill file** — anything that ends up in the public repo. Use an
obviously-fake placeholder instead (e.g. `@サンプルチャンネル名`, `Some Channel`,
`example-channel`). If a real example already leaked into a comment, replace
it before committing.

## Gotchas hit during development

- CSS specificity: a `html[dark] .selector` rule can silently out-rank a
  plain `.selector:hover` rule (more type/attribute selectors = higher
  specificity even without `!important`). Any dark-theme override needs a
  matching `html[dark] .selector:hover` companion or hover states break in
  dark mode only.
- Status message flicker: naive `setTimeout`-based "flash a message, clear
  after 2s" helpers race if called twice in quick succession (e.g. "resolving…"
  then "done" within 2s) — the first timer clears the second message early.
  Fix: track the timer per-element (WeakMap) and clear the previous one
  before scheduling a new one.
- Don't trust `curl`'s output as proof of what a *logged-in, JS-rendered*
  page looks like, but it's a fast and reliable way to check what's embedded
  in YouTube's server-rendered HTML/JSON (canonical links, `vanityChannelUrl`,
  `channelMetadataRenderer`) before writing extraction regexes.

## Testing

No automated test harness. Manual verification only:
`chrome://extensions` → Developer mode → Load unpacked → select the project
root → reload after each change → test on a real youtube.com page (grid,
search results, and a channel's live/videos tab are the layouts exercised so
far).

## Ideas for next time

- Let the options page edit an existing filter's value/handle instead of
  delete-and-re-add only.
- Cache resolved handle↔id lookups (a separate storage key) so re-blocking a
  channel encountered again elsewhere doesn't refetch.
- Title filter management could use the same "block button" pattern (a
  quick "block this title keyword" affordance) if that's ever wanted.
- Consider surfacing blocked-count stats (e.g. badge text on the toolbar icon).
