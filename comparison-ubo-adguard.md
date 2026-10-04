# Stand-ins for Google's tag scripts: uBO, AdGuard and this repo

Three projects replace the same scripts with their own, to different ends.
Everything below is measured - each resource served as the file a real page
asks for, then probed with what page code actually does - not read off the
source. The scripts that produce the tables are at the bottom.

Two files are compared, and only one of them is this repo's business:

- **`googletagmanager.com/gtm.js`**, where all three ship something.
- **`gpt.js`** (Google Publisher Tag), where this repo ships nothing and
  should not. It is not a tag manager loader, uBO already carries a resource
  of that name, and a third would collide. It is here because it came out of
  chasing a real breakage, it is the nearest relative of what this repo does,
  and one row in it is a lesson that applies here.

Versions everything was measured against:

| | file | lines |
|---|---|---|
| uBO gtm | [`googletagmanager_gtm.js`](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/googletagmanager_gtm.js) @ `615a71a58` | 43 |
| AdGuard gtm | [`src/redirects/google-analytics.js`](https://github.com/AdguardTeam/Scriptlets/blob/master/src/redirects/google-analytics.js) @ `31b68c9a4` | 158 |
| this repo | `dist/googletagmanager_gtm.js` | 1400 |
| uBO gpt | [`googletagservices_gpt.js`](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/googletagservices_gpt.js) @ `615a71a58` | 154 |
| AdGuard gpt | [`src/redirects/googletagservices-gpt.js`](https://github.com/AdguardTeam/Scriptlets/blob/master/src/redirects/googletagservices-gpt.js) @ `31b68c9a4` | 455 |

**AdGuard has no gtm.js resource of its own any more.** Their
`googletagmanager-gtm` redirect is [obsolete](https://github.com/AdguardTeam/Scriptlets/issues/127)
and the name is now an alias for `google-analytics` - so a container redirected
on their lists is answered by their Analytics mock. That is a position, not an
oversight: it treats gtm.js as an analytics script rather than as a tag
manager. uBO's is a 43-line stub of the same opinion.

## gtm.js: what a page sees

The fixture is Google's own snippet - a `dataLayer`, the anti-flicker block
with the container id listed, a `gtag()` shim, and a `<script src=…gtm.js?id=…>`
whose request each resource answers.

| what a page does | uBO | AdGuard | this repo |
|---|---|---|---|
| `dataLayer` is still an array | yes | yes | yes |
| a push made before it arrived survives | yes | yes | yes |
| `typeof dataLayer.push({…})` | `undefined` | `function` | **`number`** |
| anti-flicker: ends the hiding | yes | yes | yes |
| anti-flicker: **another container still expected** | **ends it anyway** | **ends it anyway** | defers |
| `window.ga` is callable | yes | yes | yes |
| `window.google_tag_manager` | absent | absent | **object** |
| `google_tag_manager[id]` | absent | absent | **present** |
| `google_tag_manager[id].dataLayer.get(…)` | absent | absent | **answers** |
| an unknown registry method | absent | absent | throws |
| `eventCallback` on a push is called | yes | yes | yes |
| gtag's `event_callback` is called | **no** | yes | yes |
| `ga(…, { hitCallback })` is called | **no** | yes | yes |
| a nested `event_callback` is found | no | yes | no |
| a plain `callback` in an array push | no | yes | no |
| `gtag('get', id, field, cb)` answers | never | never | **`undefined`, deferred** |
| a consent state is published | none | none | **`C0001,C0002,C0003`** |
| `__tcfapi` answers | absent | absent | **`tcloaded`** |

Four of those rows are worth more than a tick.

**`dataLayer.push`'s return.** The real one is `Array.prototype.push`, so it
answers with the new length. uBO's replacement returns `undefined`; AdGuard's
returns `noopFunc`, deliberately. This repo keeps the page's own array and
returns what its push returned, so code assigning the result sees a number, as
it would unblocked.

**The anti-flicker, with a second container expected.** Google's snippet lists
every container it waits for and the undo is only meant to run when the last
of them reports in - their own code clears its entry, scans for any other
still `true`, and only then calls `end()`. uBO's and AdGuard's call it
unconditionally, which un-hides a page that a second, unblocked container is
still loading for. This repo follows their logic and defers, reporting
`hide=waiting`. The cost of deferring is bounded: the snippet carries its own
four-second timer.

**gtag's `event_callback`.** A page's wait has two spellings -
`eventCallback` on a pushed object, and `event_callback` inside the params of
`gtag('event', name, {…})`, which reaches the layer as an arguments object
rather than as a field on anything. uBO answers the first and not the second,
so a page whose links open from a gtag event has no working links.

**`hitCallback`, which is a third spelling, and two more that are not taken.**
AdGuard answers all three; neither uBO's gtm stub nor this repo did. The one
that came back here is `ga('send', 'pageview', { hitCallback: fn })`, because
this resource puts up `window.ga` itself - so where analytics.js was blocked
with no surrogate of its own, that stub is the only `ga` on the page, and a
page navigating from the callback had a dead link. gtm 1.8.0 answers uBO's
three shapes for it: the trailing options object, a trailing function, and
`'hitCallback'` as a positional argument followed by one.

The other two are deliberately left alone. `dataLayer.push([ { callback } ])`
is the `_gaq` shape, and AdGuard answers it because one resource of theirs
serves both analytics.js and gtm.js; this repo's does not. A nested
`event_callback` - `{ event: 'x', params: { event_callback } }` - could not be
tied to anything a real page does, and copying surface on the strength of
another project having it is how a stand-in grows ways to be wrong.

One divergence from uBO inside the part that was taken: their surrogate hands
the trailing-function shape a tracker built with `ga.create()`. This hands
over one whose `get()` answers `undefined`, because a `get('clientId')`
returning something plausible would be this resource minting a tracking id -
the line `gtag('get', …)` already refuses to cross. A mutation pins it.

**The unknown registry method throws here, and that is deliberate.** Reading an
undocumented property off `google_tag_manager[id]` and calling it throws
against the real gtm.js too, and answering every unknown read with a function
would make `typeof r.anything === 'function'` true, which breaks feature
detection in the other direction. The `probe` debug level answers instead of
failing, for diagnosis. Contrast this with the gpt.js rows below, where the
calls that throw are *documented, publisher-facing* ones that the real file
answers - a different thing entirely.

## gtm.js: the globals each defines

| | globals |
|---|---|
| uBO | `ga` |
| AdGuard | `ga` (plus `google_optimize` where the page has one) |
| this repo | `ga`, `google_tag_manager`, `OptanonActiveGroups`, `OnetrustActiveGroups`, `OneTrust`, `__tcfapi`, `consentRRGtmGave`, `consentRRGtmTcf` |

This is the clearest statement of the difference in ambition, and of the cost.
uBO and AdGuard add one name and keep a tiny footprint. This repo adds eight,
two of which (`consentRRGtmGave`, `consentRRGtmTcf`) exist so a second copy of
itself can tell what the first already did, and five of which are there because
a container's absence took something a page reads. Every one of them is a
surface a site could detect, which is the trade accepted in exchange for the
breakages they fix - and `consent=off` removes the consent ones for anyone who
would rather not make that trade.

## gpt.js: what a page sees

uBO's is noops: every method returns `undefined`, `null`, `[]`, `''` or `this`.
AdGuard's is a working fake: slots have identity, targeting round-trips,
`display()` builds a sandboxed `google_ads_iframe_<id>`, and five slot events
are dispatched. Both evaluated into the same blank page holding one
`<div id="adbox">`.

| what publisher code does | uBO | AdGuard | this repo |
|---|---|---|---|
| `slot.getSlotElementId()` | `""` | `"adbox"` | n/a |
| `getElementById(` that `)` is findable | `false` | **`true`** | n/a |
| `slot.getResponseInformation().lineItemId` | **throws** - returns `null` | `undefined` | n/a |
| `setTargeting('pos','top')` then `getTargeting('pos')` | `[]` | `["top"]` | n/a |
| `defineSlot` twice for one div gives one slot | `false` | **`true`** | n/a |
| `pubads().getSlots().length` after `addService` | `0` | `0` | n/a |
| `slotRenderEnded` fires on `display()` | **never** | `isEmpty=true` | n/a |
| `display()` leaves a `google_ads_iframe_*` | `false` | **`true`** | n/a |
| `googletag.setConfig({…})` | **throws** - not a function | ok | n/a |
| `pubads().isInitialLoadDisabled()` | **throws** - not a function | `false` | n/a |

`n/a` throughout: this repo ships no GPT resource, so a page replacing gpt.js
is served uBO's. The column is here so the answer to "where is this repo in
this comparison" is stated rather than inferred.

Identical in both: `cmd.push` runs its callback synchronously inside a
`try`/`catch`, returns `1`, and drains whatever the page queued before the
resource arrived. That is the one contract that matters most and neither gets
it wrong.

AdGuard's slot events fire through `requestAnimationFrame`, so they are
asynchronous - a page that calls `display()` and reads state on the next line
sees nothing yet, in either resource.

## gpt.js: the publisher-facing surface

Method counts per object, and what is missing from the smaller one. AdGuard's
is a strict superset: **uBO has no method AdGuard lacks, anywhere.**

| object | uBO | AdGuard | this repo | only in AdGuard |
|---|---|---|---|---|
| `googletag` | 15 | 17 | n/a | `getConfig`, `setConfig` |
| `pubads()` | 36 | 37 | n/a | `isInitialLoadDisabled` |
| `defineSlot(…)` | 20 | 38 | n/a | `getClickUrl`, `getCollapseEmptyDiv`, `getConfig`, `getContentUrl`, `getDivStartsCollapsed`, `getEscapedQemQueryId`, `getFirstLook`, `getHtml`, `getId`, `getName`, `getOutOfPage`, `getServices`, `getSizes`, `getTargetingMap`, `setConfig`, `setSafeFrameConfig`, `setTagForChildDirectedTreatment`, `toString` |
| `sizeMapping()` | 2 | 2 | n/a | - |
| `companionAds()` | 3 | 5 | n/a | `getSlots`, `removeEventListener` |
| `content()` | 2 | 3 | n/a | `removeEventListener` |

The slot is where the gap is: 20 methods against 38. That is also where
publisher code spends its time, because a slot is the handle a page keeps.

## gpt.js: the globals each defines

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

## Privacy: there is nothing here to learn

Worth recording as a negative result, because it is the question that prompted
half this document. Neither project does anything privacy-*active* in its
Google resources. Searched across uBO's `googletagmanager_gtm.js`,
`google-analytics_analytics.js`, `google-analytics_ga.js` and
`googlesyndication_adsbygoogle.js`, and AdGuard's `google-analytics.js`, for

```
gaOptout   ga-disable   doNotTrack   google_tag_data
_gl   gclid   document.cookie   removeItem
```

the only hits in the whole set are `hitCallback` and AdGuard's
`google_optimize.get -> noopFunc`. No opt-out flag is set, no cookie is
cleared, no link decoration is stripped, and neither defines
`google_tag_data`. The philosophy on both sides is "do not let it run, keep
the page working", and the privacy comes entirely from the request never being
made.

By that measure this repo is the most privacy-active of the three, which is a
statement about scope rather than virtue:

| | uBO | AdGuard | this repo |
|---|---|---|---|
| turns on Google's own opt-out | no | no | yes - `ga-optout.js`, `window['ga-disable-<id>']` |
| answers the TCF API | no | no | yes, as a refusal: `gdprApplies: true`, zero consents |
| refuses to mint an id | n/a | n/a | `gtag('get', …)` answers `undefined`; the `ga` tracker's `get()` too |
| publishes a page-side consent state | no | no | yes, and `consent=off` removes it |

The one idea worth stealing is the direction of travel, not a mechanism:
**a stand-in that answers a page's wait removes the reason for an exception,
and an exception is what actually costs privacy.** Every row of the gtm.js
table above is that argument in miniature - the container exception a site
needs is the whole container, pixels included.

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

## Reproducing the tables

The gtm.js table serves each resource as the `gtm.js` a page requests, behind
Google's own snippet - including the anti-flicker block with the container id
listed, which is the part that decides whether ending the hiding is this
container's to do:

```html
<script>
window.dataLayer = window.dataLayer || [];
dataLayer.hide = { start: Date.now(), end: function(){ ended = true; },
    'GTM-TEST001': true };
dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
function gtag(){ dataLayer.push(arguments); }
</script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-TEST001"></script>
```

A second flavour of that fixture adds `'GTM-OTHER02': true` to the hide map,
which is the row the three answer differently. AdGuard's resource is an ES
module exporting a function, so its body is unwrapped with the helpers it
imports (`noopFunc`, `noopNull`, `noopArray`, `hit`) defined as one-liners.

## Reproducing the gpt.js table

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
