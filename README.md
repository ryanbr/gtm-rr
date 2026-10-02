# gtm-rr

Google Tag Manager resource replacements for uBlock Origin.

Two resources:

- **`googletagmanager_gtm.js`** stands in for both of Google's loaders -
  `gtm.js` and `gtag/js` - and ships under uBlock Origin's own resource name,
  which it replaces. Nothing is fetched, no tag fires, and the page keeps the
  API its own code was written against, which is the part a plain block takes
  away.
- **`ga-optout.js`** replaces nothing. It turns on the opt-out switches
  Google's own code reads before it sends, for the bundles a redirect cannot
  reach: a loader on the site's own domain, behind a proxied path, or inlined
  in the page. The page keeps a real, working Google bundle that declines to
  send.

Blocking `gtm.js` outright is easy and usually enough. It stops being enough
when a site puts its own functionality inside the container, because that code
is written against GTM's API and waits for GTM's callbacks:

- `dataLayer.push({ event: 'submit', eventCallback: fn })` is a page waiting to
  be told the event was processed. With nothing there to call `fn`, the form
  never submits - and nothing errors.
- `google_tag_manager['GTM-XXXX'].dataLayer.get('page.title')` throws with no
  container registered.
- `gtm.dom` and `gtm.load` are pushed by GTM itself, and a page's own triggers
  hang off them.

This resource answers all three, and nothing else.

## Install

uBlock Origin fetches user resources from the URLs in its hidden setting
`userResourcesLocation` (Settings > Advanced > click `advanced settings`):

```
https://raw.githubusercontent.com/ryanbr/gtm-rr/v1.0.0/dist/googletagmanager_gtm.js
https://raw.githubusercontent.com/ryanbr/gtm-rr/v1.0.0/dist/ga-optout.js
```

or

```
https://cdn.jsdelivr.net/npm/gtm-rr@1.0.0/dist/googletagmanager_gtm.js
https://cdn.jsdelivr.net/npm/gtm-rr@1.0.0/dist/ga-optout.js
```

The setting takes several whitespace-separated URLs.

**For the first one that is the whole install.** uBO's default lists already
send both loaders to `googletagmanager_gtm.js`:

```
||googletagmanager.com/gtag/js$script,xhr,redirect=googletagmanager_gtm.js:5
||googletagmanager.com/gtm.js$script,redirect=googletagmanager_gtm.js:5,domain=~nerc.com
```

and a user resource replaces a built-in of the same name - uBO awaits its own
`loadBuiltinResources`, then parses the `userResourcesLocation` text into the
same map. So no filter of yours is needed on the sites those rules cover.

[`filters/gtm.txt`](filters/gtm.txt) carries only what uBO's rules cannot
reach, which is server-side tagging on a site's own domain.
[`filters/ga.txt`](filters/ga.txt) is where `ga-optout` is used from, since
that one is a scriptlet and has to be asked for per site.

## What replacing uBO's resource takes on

Theirs is 1.5KB and does three things: a `ga` noop, `dataLayer.hide.end()`,
and an `eventCallback` on push. Standing in front of it means keeping all
three - and then answering the parts it has none for.

| | uBO's | this |
|---|---|---|
| `eventCallback` | called | called, and the page's array is kept, with `push` returning what the array's own `push` returned |
| `dataLayer.hide.end()` | ended unconditionally | ended the way their container does: own entry cleared, ended only when no other container is still expected |
| `window.ga` | noop | noop, and a better stub left alone |
| `window.google_tag_manager` | - | the container object their `RU()` builds, with the model and `bootstrap` |
| `gtm.dom` / `gtm.load` | - | pushed, once each, as theirs does |
| `gtag("get", …, callback)` | - | answered, with `undefined` |
| no data layer yet | returns early, does nothing | creates it, as their loader does |

## Why an opt-out as well as a stub

A redirect needs a URL to match. Where a site serves the loader from its own
domain, from a path behind a proxy, or inlines the bundle, there is nothing to
redirect - but Google's own code still asks, before every send, whether the
visitor opted out:

```js
vR = function(a) {
    var b = uR._gaUserPrefs;
    if (b && b.ioo && b.ioo()
        || sR.documentElement.hasAttribute("data-google-analytics-opt-out")
        || a && uR["ga-disable-" + a] === !0) return !0;
    ...
```

`ga-optout.js` answers that question. Nothing is emulated, no API is stood in
for, and the event is dropped by their own pipeline:
`if (vR(a.target.destinationId)) { a.isAborted = !0 }`.

## What it is not

- Not a consent manager. For those, see
  [consent-rr](https://github.com/ryanbr/consent-rr).
- Not a stub for `gtag/js`, which is a different loader with its own contract.
  `ga-optout.js` quietens a real one; it does not replace it.
- Not a way to let a container's tags run. Nothing is fetched or fired.

## Working on it

[AGENTS.md](AGENTS.md) is the single source for how to work in here.
