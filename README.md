# gtm-rr

Google Tag Manager resource replacements for uBlock Origin.

One resource so far: **`gtm-neutered.js`**, which stands in for
`googletagmanager.com/gtm.js`. The container loads nothing, fires no tag and
asks for nothing - and the page keeps the API its own code was written
against, which is the part a plain block takes away.

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
```

or

```
https://cdn.jsdelivr.net/npm/gtm-rr@1.0.0/dist/gtm-neutered.js
```

Then add the filter from [`filters/gtm.txt`](filters/gtm.txt), or the list
itself as a custom filter list. The filters do nothing until the resource is
installed: uBO has no such resource by its own name, and a `redirect=` to a
name it does not know silently does nothing.

## What it is not

- Not a consent manager. For those, see
  [consent-rr](https://github.com/ryanbr/consent-rr).
- Not `gtag/js`, which is a different URL and would be a different resource.
- Not a way to let a container's tags run. Nothing is fetched or fired.

## Working on it

[AGENTS.md](AGENTS.md) is the single source for how to work in here.
