# gtm-rr

Google Tag Manager resource replacements for uBlock Origin.

Two resources:

- **`gtm-neutered.js`** stands in for `googletagmanager.com/gtm.js`. The
  container loads nothing, fires no tag and asks for nothing - and the page
  keeps the API its own code was written against, which is the part a plain
  block takes away.
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
https://raw.githubusercontent.com/ryanbr/gtm-rr/v1.0.0/dist/gtm-neutered.js
https://raw.githubusercontent.com/ryanbr/gtm-rr/v1.0.0/dist/ga-optout.js
```

or

```
https://cdn.jsdelivr.net/npm/gtm-rr@1.0.0/dist/gtm-neutered.js
https://cdn.jsdelivr.net/npm/gtm-rr@1.0.0/dist/ga-optout.js
```

The setting takes several whitespace-separated URLs.

Then add the filters from [`filters/gtm.txt`](filters/gtm.txt) and
[`filters/ga.txt`](filters/ga.txt), or the lists themselves as custom filter
lists. The filters do nothing until the resource is
installed: uBO has no such resource by its own name, and a `redirect=` to a
name it does not know silently does nothing.

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
