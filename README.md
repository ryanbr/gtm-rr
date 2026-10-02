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

## When a page half-works

The reporting is **on**, and says everything it has. Anything a site asks for
that this does not provide is named once, with what the page passed and which
script asked:

```
[gtm-rr] googletagmanager_gtm 1.0.0 missing=command.consent id=G-KQ9NC85WD9
         args=["update",{ad_storage:"granted"}] from=at https://site/app.js:12:9
[gtm-rr] googletagmanager_gtm 1.0.0 missing=container.SANDBOXED_JS_SEMAPHORE
         id=G-KQ9NC85WD9 from=at https://site/tag.js:4:1
```

On a page that works, that is nothing at all.

What it watches, which is everything this resource hands the page:

- `google_tag_manager` itself. Their own code fills it on demand -
  `ho("tcf")`, `ho("gth")`, `ho("mb")`, `ho("r")`, `ho("ads_pageview")`, the
  sandboxed-JS semaphore - and none of that is here.
- the container object under the id, and the data model on it.
- the entry named after the data layer, which theirs carries more fields on.
- every `gtag` command that went nowhere, and every `ga` call.

A key written into the registry *afterwards* - by a second container of
theirs that was not replaced, say - is not then reported as missing.

Two absences are deliberate and stay quiet, because they are documented
decisions rather than gaps: **`google_tag_data`**, which their code creates
only where a consent API is used, and **`gaGlobal`**, their visitor-id cache.
Reporting those would fire on every consent-managed site and tell you only
what this page already says.

A command's arguments are echoed because they *are* its value - the name alone
rarely says whether it mattered, and `args=["update",{ad_storage:"granted"}]`
is the difference between a site firing an event and a site waiting for tags
to start. A property's are not echoed: a missing property had no value to read,
and an `args=` there would be one this resource invented. What is echoed is
shallow and capped at 160 characters.

### Chasing an unknown call

A site calling something that is not here - `google_tag_manager[id]
.setConsentState('granted', {wait: 500})` - gets a reported read and then a
`TypeError`, and the arguments go with it. Those arguments are the part that
says what to build, so there is a level that catches the call instead:

```js
localStorage.setItem('gtm-rr-debug', 'probe')   // then reload
```

```
missing=container.setConsentState  id=GTM-W4F8P893
called=container.setConsentState   id=GTM-W4F8P893 args=["granted",{wait:500}]
```

and the page carries on, because the call was answered rather than failed.

**Use it to chase something, not to leave on.** A read of a name that is not
here answers with a function, so a page that asks whether something exists
before using it now gets yes and takes its other branch - which is a different
page from the one being debugged. Names that change what an object *is* rather
than what it does (`then`, `toJSON`, `valueOf`, …) are never answered with one,
so an `await` or a `JSON.stringify` still behaves, and a value that really is
there is given back rather than stood in for.

### Levels

```js
localStorage.setItem('gtm-rr-debug', 'probe')   // + answer missing calls
localStorage.setItem('gtm-rr-debug', 'quiet')   // names only, no page data
localStorage.setItem('gtm-rr-debug', 'off')     // nothing, nothing wrapped
```

`verbose` is the default. `quiet` drops the arguments and the commands that
went nowhere, which is what to use if you would rather a console you paste
somewhere did not carry a transaction id or a `user_data` payload. `off` stops
anything being wrapped at all: one storage read and no more.

Otherwise the objects handed to the page are watched through a get-only
`Proxy`, so their keys, their values and their behaviour are unchanged: a page
enumerating the container object sees exactly what Google's own would give it.

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
