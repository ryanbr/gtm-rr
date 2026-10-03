# googletagservices_gpt.js: uBlock Origin vs AdGuard

Two block-and-replace resources for the same file - Google Publisher Tag,
`securepubads.g.doubleclick.net/tag/js/gpt.js` and its
`pagead2.googlesyndication.com` twin - written to opposite philosophies.

**This repo ships neither, and should not.** GPT is not one of Google's tag
manager loaders, uBO already carries a built-in resource of that name, and a
third one would collide rather than help. The comparison is here because it
came out of chasing a real breakage, because it is the nearest relative of what
`googletagmanager_gtm.js` does, and because one row in it is a lesson this repo
has to apply to its own stubs.

Sources, and the versions everything below was measured against:

| | file | lines |
|---|---|---|
| uBO | [`src/web_accessible_resources/googletagservices_gpt.js`](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/googletagservices_gpt.js) @ `615a71a58` | 154 |
| AdGuard | [`src/redirects/googletagservices-gpt.js`](https://github.com/AdguardTeam/Scriptlets/blob/master/src/redirects/googletagservices-gpt.js) @ `31b68c9a4` | 455 |

uBO's is noops: every method returns `undefined`, `null`, `[]`, `''` or `this`.
AdGuard's is a working fake: slots have identity, targeting round-trips,
`display()` builds a sandboxed `google_ads_iframe_<id>`, and five slot events
are dispatched.

## What a page sees

Measured in headless Chrome, both resources evaluated into the same blank page
with one `<div id="adbox">`. The script that produces this table is at the
bottom; nothing here is read off the source.

| what publisher code does | uBO | AdGuard |
|---|---|---|
| `slot.getSlotElementId()` | `""` | `"adbox"` |
| `getElementById(` that `)` is findable | `false` | **`true`** |
| `slot.getResponseInformation().lineItemId` | **throws** - returns `null` | `undefined` |
| `setTargeting('pos','top')` then `getTargeting('pos')` | `[]` | `["top"]` |
| `defineSlot` twice for one div gives one slot | `false` | **`true`** |
| `pubads().getSlots().length` after `addService` | `0` | `0` |
| `slotRenderEnded` fires on `display()` | **never** | `isEmpty=true` |
| `display()` leaves a `google_ads_iframe_*` | `false` | **`true`** |
| `googletag.setConfig({…})` | **throws** - not a function | ok |
| `pubads().isInitialLoadDisabled()` | **throws** - not a function | `false` |

Identical in both: `cmd.push` runs its callback synchronously inside a
`try`/`catch`, returns `1`, and drains whatever the page queued before the
resource arrived. That is the one contract that matters most and neither gets
it wrong.

AdGuard's slot events fire through `requestAnimationFrame`, so they are
asynchronous - a page that calls `display()` and reads state on the next line
sees nothing yet, in either resource.

## The publisher-facing surface

Method counts per object, and what is missing from the smaller one. AdGuard's
is a strict superset: **uBO has no method AdGuard lacks, anywhere.**

| object | uBO | AdGuard | only in AdGuard |
|---|---|---|---|
| `googletag` | 15 | 17 | `getConfig`, `setConfig` |
| `pubads()` | 36 | 37 | `isInitialLoadDisabled` |
| `defineSlot(…)` | 20 | 38 | `getClickUrl`, `getCollapseEmptyDiv`, `getConfig`, `getContentUrl`, `getDivStartsCollapsed`, `getEscapedQemQueryId`, `getFirstLook`, `getHtml`, `getId`, `getName`, `getOutOfPage`, `getServices`, `getSizes`, `getTargetingMap`, `setConfig`, `setSafeFrameConfig`, `setTagForChildDirectedTreatment`, `toString` |
| `sizeMapping()` | 2 | 2 | - |
| `companionAds()` | 3 | 5 | `getSlots`, `removeEventListener` |
| `content()` | 2 | 3 | `removeEventListener` |

The slot is where the gap is: 20 methods against 38. That is also where
publisher code spends its time, because a slot is the handle a page keeps.

## Window variables

The same, which is worth saying because it is the part people assume differs:

| | uBO | AdGuard |
|---|---|---|
| globals defined | `googletag` | `googletag` |
| `googletag.apiReady` | `true` | `true` |
| `googletag.pubadsReady` | `true` | `true` |
| anything else on `window` | none | none |

Neither leaves a detectable second global, and both set the two readiness flags
a page polls. A page testing `window.googletag && googletag.apiReady` cannot
tell them apart.

## The three that throw, and why that is the real finding

Most of the surface gap is harmless: a method nobody calls, or one whose
`undefined` answer a page shrugs off. Three are not harmless, because the page
does not get a wrong answer - it gets an exception at its own call site, which
takes out whatever came after it in that function:

- `slot.getResponseInformation()` returns `null`, so the universal
  `.lineItemId` / `.advertiserId` read throws.
- `googletag.setConfig(…)` does not exist. GPT has moved publisher
  configuration here, so this one widens with time rather than narrowing.
- `pubads().isInitialLoadDisabled()` does not exist.

**A no-op stub degrades a page; a throwing stub breaks it.** Allowing the real
file and blocking it both leave the page coherent. A stub that throws is the
only option that does neither, and it is the one case where "minimal" is not a
defensible position.

Second in line is the event gap. A great deal of publisher code is shaped like

```js
googletag.pubads().addEventListener('slotRenderEnded', e => {
    if ( e.isEmpty ) { collapse(slotDiv); } else { show(slotDiv); } });
```

and with uBO's resource that listener is registered and never called, so
neither branch runs. The page is left mid-decision rather than told "empty".

## Benefits, honestly

**uBO's minimalism earns real things.** 154 lines against 455 is less to audit
and less to go wrong; there is no state to leak between pages, no slot registry
to grow, and no iframe created on the page's behalf. It cannot be fingerprinted
by the *behaviour* of a fake it does not perform, and it will never animate a
layout by filling a div. For the common case - a page that defines slots,
displays them, and does not look back - it is enough, and it is the resource
uBO's own lists have pointed at for years without widespread complaint.

**AdGuard's fidelity earns different things.** Pages that branch on what GPT
told them keep working: the empty-slot collapse above, code that walks
`slot.getSlotElementId()` to find its own container, anti-adblock checks
looking for `google_ads_iframe_*` with `data-load-complete`. It answers the
modern config API. And it cannot throw where uBO throws.

The costs mirror the benefits: more surface to keep in step with GPT, state
that persists for the page's life, and a `display()` with real DOM effects -
which is a behaviour a site can detect as readily as it can detect a noop.

Neither is wrong. The split is whether you would rather a page be under-served
or over-served, and the answer differs per page. The part that is not a
trade-off is the throwing.

## What this repo takes from it

One principle, which `googletagmanager_gtm.js` now follows deliberately:
**answer input you do not implement, rather than failing at the caller.** The
TCF stand-in added in gtm 1.7.0 answers an unrecognised command with
`callback(null, false)` - the API's own way of saying no - instead of letting
the call throw. The same applies to the `google_tag_manager` registry, where the
`probe` debug level exists to report a missing method and answer the call
rather than fail it.

The surface-size argument does not transfer. A container registry is not an ad
API: there is no page code branching on whether an ad filled, so the minimal
answer is usually the correct one there.

## What it does not explain

This started from nowtv.com.tr, where a video needs `gpt.js` allowed. Its
player is first-party `/js/app.js` and touches `googletag` 47 times, so a
surrogate gap was the obvious suspect. It is not the answer: AdGuard's resource
was swapped in behind that page and the player reached the same state as under
uBO's, with the same unrelated error. The page does not listen for
`slotRenderEnded` at all. That breakage is still open.

## Reproducing the table

Needs a checkout of each project and any puppeteer. AdGuard's file is an ES
module exporting a function, so its body has to be unwrapped with the handful
of helpers it imports (`noopFunc`, `noopThis`, `noopNull`, `noopArray`,
`noopStr`, `trueFunc`, `hit`) defined as the obvious one-liners.

```js
const probes = {
    'slot identity': `
        const s = googletag.defineSlot('/1/x', [[300,250]], 'adbox');
        return JSON.stringify(s.getSlotElementId());`,
    'getResponseInformation': `
        const s = googletag.defineSlot('/1/x', [[300,250]], 'adbox');
        return String(s.getResponseInformation().lineItemId);`,
    'targeting round-trips': `
        const s = googletag.defineSlot('/1/x', [[300,250]], 'adbox');
        s.setTargeting('pos', 'top');
        return JSON.stringify(s.getTargeting('pos'));`,
    'slotRenderEnded fires': `
        let got = 'never';
        googletag.pubads().addEventListener('slotRenderEnded',
            e => { got = 'isEmpty=' + e.isEmpty; });
        googletag.defineSlot('/1/x', [[1,1]], 'adbox')
            .addService(googletag.pubads());
        googletag.display('adbox');
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 20)));
        return got;`,
    'setConfig': `googletag.setConfig({ targeting: { a: 'b' } }); return 'ok';`,
};
```

Each probe is evaluated in a fresh page holding `<div id="adbox"></div>`, after
evaluating one resource, with the result and any thrown message recorded. The
surface counts come from walking the prototype chain of `googletag`,
`pubads()`, `defineSlot(…)`, `sizeMapping()`, `companionAds()` and `content()`
with `Object.getOwnPropertyNames`.
