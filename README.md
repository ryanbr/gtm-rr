# gtm-rr

Google Tag Manager resource replacements for uBlock Origin.

Three resources:

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
- **`gtm-tag.js`** is for the sites where the container *is* the loader for
  something the page needs - a map, a player, a store locator. The tag's url
  goes in the filter, so that one script loads and the container still does
  not. Per site, by hand, and read [What it cannot
  do](#what-it-cannot-do) before using it.

Blocking `gtm.js` outright is easy and usually enough. It stops being enough
when a site puts its own functionality inside the container, because that code
is written against GTM's API and waits for GTM's callbacks:

- `dataLayer.push({ event: 'submit', eventCallback: fn })` is a page waiting to
  be told the event was processed. With nothing there to call `fn`, the form
  never submits - and nothing errors. gtag spells the same thing
  `gtag('event', name, { event_callback: fn })`, where it sits inside the
  command's params, and gamelog.apexlegends-leaksnews.com opens every article
  from one: with nothing to answer it, no link on the page works.
- `google_tag_manager['GTM-XXXX'].dataLayer.get('page.title')` throws with no
  container registered.
- `gtm.dom` and `gtm.load` are pushed by GTM itself, and a page's own triggers
  hang off them.

This resource answers all three, and nothing else.

## Install

uBlock Origin fetches user resources from the URLs in its hidden setting
`userResourcesLocation` (Settings > Advanced > click `advanced settings`). It
is one setting on **one line**: the name, then every URL you want, separated
by spaces.

```
userResourcesLocation https://raw.githubusercontent.com/ryanbr/gtm-rr/v1.10.0/dist/gtm-rr-all.js
```

**One URL carries all three.** A resources file holds as many resources as it
likes, each starting at its own `/// name.js`, so `dist/gtm-rr-all.js` delivers
`googletagmanager_gtm.js`, `ga-optout.js` and `gtm-tag.js` under their own
names - nothing is merged, and a filter asks for one by name as before. It is
built from the same files and the tests check it holds them unchanged.

To install only some of them, name those instead - still on the one line:

```
userResourcesLocation https://raw.githubusercontent.com/ryanbr/gtm-rr/v1.10.0/dist/googletagmanager_gtm.js https://raw.githubusercontent.com/ryanbr/gtm-rr/v1.10.0/dist/gtm-tag.js
```

**One URL per line does not work, and fails quietly.** uBO reads a hidden
setting as a name and then the rest of *that* line (`/^\s*(\S+)\s+(.+)$/`), and
a later line replaces an earlier one instead of adding to it - so repeating
`userResourcesLocation` on three lines leaves you with whichever came last,
and three bare URL lines leave the setting unset entirely. Either way the
resources that did not load say nothing at all. One fetch per URL, no limit on
how many, and a URL that 404s or comes back empty is skipped in the same
silence.

Changes to a file land after a filter-list update or _Purge all caches_, not
straight away: the parsed set is cached in a selfie, invalidated on
`after-assets-updated` while this setting is in use. The same mechanism means a
`main` URL can change under you at the next list update, which is the other
reason to pin a tag.

These are pinned to a release, so an install stays where it is until you move
it. `main` in place of `v1.10.0` follows the branch instead, which is useful for
testing a fix and not for leaving in place.

**Use the redirect and the scriptlet together.** `filters/gtm.txt` carries the
scriptlet globally, and it is not a fallback you add after something breaks:
whether a site's CSP will accept the redirect is not knowable in advance, and
the two cover each other. Field-verified on trademe.co.nz, whose `script-src`
lists neither `data:` nor `'unsafe-inline'`:

| redirect | scriptlet | what happens |
|---|---|---|
| yes | no | CSP refuses the `data:` target. No container **and no stub** |
| no | yes | scriptlet runs from a `blob:` URL, which is same-origin. Clean replacement |
| yes | yes | whichever lands first does the work; the other sees the container id already registered and no-ops, saying `push=already container=kept` |

On a site where the redirect does land, the scriptlet costs one storage read and
a `MutationObserver` that finds its work already done. Verified both ways round
- either delivery can get there first - and nothing is doubled: one container
object, one wrapped `push`, one subscriber, `gtm.dom` and `gtm.load` once each,
one watched registry, and an `eventCallback` answered once. The only visible
difference is the second console line.

uBO's default lists already send both loaders to `googletagmanager_gtm.js`:

```
||googletagmanager.com/gtag/js$script,xhr,redirect=googletagmanager_gtm.js:5
||googletagmanager.com/gtm.js$script,redirect=googletagmanager_gtm.js:5,domain=~nerc.com
```

and a user resource replaces a built-in of the same name - uBO awaits its own
`loadBuiltinResources`, then parses the `userResourcesLocation` text into the
same map. So no redirect rule of yours is needed on the sites those rules
cover.

One thing their lists do that is worth knowing about: **EasyPrivacy allowlists
`gtm.js` on several hundred domains** -
`@@||googletagmanager.com/gtm.js$domain=…|trademe.co.nz|jbhifi.co.nz|ticketmaster.*|…`
- because blocking the container broke those sites. On those, the container
loads for real. If the scriptlet is active as well, it installs first and the
container then runs against this resource's objects instead of its own, reading
undefined for its internals - which is visible in the console as a run of
`missing=google_tag_manager.*` lines with `from=` pointing at
`googletagmanager.com/gtm.js`. That is the signature of a site where their
carve-out and this resource are fighting, and the choice is to defer to their
carve-out (`#@#+js(googletagmanager_gtm)` for that domain) or to override it
(`$important` on a redirect rule) and check the site still works.

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

## What it answers

Everything a page can rely on, and where it came from in their own code:

| a page does | this answers with |
|---|---|
| `dataLayer.push(obj)` | the array's own `push` return value - the array is the page's and is never replaced |
| `dataLayer.push({…, eventCallback})` | the callback, on the next tick, applied with itself as `this` and no arguments, as their `k.apply(k, …)` does |
| `dataLayer.push({…, eventTimeout})` | the same; their timeout is an upper bound and nothing here takes time |
| `gtag('event', name, {…, event_callback})` | the same answer: gtag's spelling of it, inside the command's params rather than on what was pushed |
| `gtag('event', name, {…, event_timeout})` | the same; read only so it stays out of the model |
| `google_tag_manager[id]` | their `RU()` object: `dataLayer`, `bootstrap`, `callback`, and on `gtm.js` only, `onHtmlSuccess` and `onHtmlFailure` |
| `…[id].bootstrap` | a timestamp, as theirs is once the container has booted - not the `0` it starts at |
| `…[id].dataLayer.get('a.b')` | their model's dotted-path read, over what the page itself pushed |
| `…[id].dataLayer.set(k, v)` / `.reset()` | the same model, theirs field for field |
| `google_tag_manager[dataLayer]` | the entry theirs keeps `subscribers`, `gtmDom` and `gtmLoad` on |
| `google_tag_manager.rm` | their macro-resolver map, empty |
| a `gtm.dom` or `gtm.load` trigger | both pushed, once each, as theirs pushes them |
| `gtag('get', target, field, cb)` | `cb(undefined)`, deferred, as their `RD.get` defers it |
| `dataLayer.hide.end()` (anti-flicker) | ended their way: own entry cleared, and only ended when no other container is still expected |
| a page waiting on an event of its own | the event, dispatched at the document and bubbling - but only where the handler looks like the page revealing its own content. See below |
| `ga(…)` | a noop, which uBO's own resource also puts up - and a better stub is left alone |
| a renamed data layer (`&l=`) | read off the script's own `src`, with the container id |

## What it does not answer

Deliberately, and each one documented in the source with the reason:

| | why not |
|---|---|
| tags, requests, cookies | the point. Nothing is fetched and nothing is written |
| `google_tag_data` (consent mode state) | theirs builds it only where a consent API is used, and every reader in the field guards for it. A state here would tell a consent manager that defaults had been set when nothing set them |
| `gaGlobal` | their visitor-id cache. There is no visitor id, because nothing is measuring |
| `gtag` itself | neither loader defines it. The page's own snippet does, and defining one would replace the page's |
| every `gtag` command but `get` | `config`, `event`, `set`, `consent`, `policy` and the rest are about sending, which is what does not happen. They are taken without throwing |
| `gtm.init`, `gtm.init_consent` | theirs pushes them onto its own internal queue, never the data layer, so page code never sees them either |
| `gtm.uniqueEventId` | an id for their own queue |
| auto-event pushes (`gtm.click`, `gtm.formSubmit`, `gtm.historyChange`, …) | theirs only installs those listeners where the container has a trigger for them, and its own triggers are what consume them. If you find a page that waits on one, that is worth an issue |

Anything in the first table that misbehaves is a bug here. Anything in the
second is a decision - and if a site needs one of them, the reporting below
will name it.

## When a site's CSP refuses it

```
<script> source URI is not allowed in this document:
  "https://www.googletagmanager.com/gtag/js?id=G-JJTLVXMBWX&cx=c&gtm=4e69u2h1"
```

That is the one real limit of a *user* resource. uBO has no web-accessible URL
for one, so it serves it as `data:text/javascript;base64,...` - and a page
whose `Content-Security-Policy` does not allow `data:` in `script-src` refuses
it. Nothing of this runs there, and the console says nothing because nothing
ran.

**On such a site, replacing uBO's resource is a step backwards**, and that is
worth being blunt about: uBO's own copy is served from an extension URL, which
a page's CSP does not get to refuse, so theirs would have run where this
cannot. The request is still blocked - no tag loads either way - but the page
gets no stub at all.

The way round it is the scriptlet form, which is injected rather than fetched,
so there is no URI for a CSP to object to - and `filters/gtm.txt` carries it
globally, since a CSP is not something a list can enumerate:

```
*##+js(googletagmanager_gtm)
```

It works because uBO injects a scriptlet from a `blob:` URL belonging to the
page, and a blob URL is same-origin - so a `script-src 'self'` allows it where
it refuses a `data:` one. Confirmed on trademe.co.nz, whose `script-src` lists
neither `data:` nor `'unsafe-inline'`.

That is safe to apply everywhere because the resource does nothing until there
is something to stand in for. Injected at `document_start` the page has not
parsed its own tag yet, so it watches for one and starts when it appears; a
page that never loads a container comes away with no data layer, no registry,
no `ga()` and nothing in the console. Where the redirect already worked, the
scriptlet is a no-op - the container id is registered, and that is what makes a
second run do nothing.

The id is still found on a CSP-blocked page: the script element is in the
document even though its fetch was refused, and with no
`document.currentScript` to read, the resource scans the page's own tags for
it. On the example above that gives `id=G-JJTLVXMBWX`, the container object,
and an answered `gtag('get', …)`.

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

## What it cannot do

**It cannot restore code that only exists inside a container.** The API stub
answers `dataLayer`, `eventCallback`, the container object and the model; it
has no idea which tags were configured, because that lives in the container
this resource is standing in front of.

The worked example is petzl.com's dealer locator, where the chain is
**GTM → OneTrust → consent → GTM's Maps tag → `initGmaps` → map**, and *both*
middle links are Custom HTML tags inside `GTM-MWKBJV`:

```
"function":"__html","priority":999,
"vtp_html":"<script src=\"https://cdn.cookielaw.org/scripttemplates/otSDKStub.js\"
             data-domain-script=\"bb3af1ef-…\">"
"vtp_html":"… a.src=\"https://maps.googleapis.com/maps/api/js?v=3.31
             &key=AIzaSy…&callback=initGmaps\" …"
```

Neither the OneTrust tenant id nor the Maps key appears anywhere in the page,
so no stub can produce them without shipping a copy of someone's container
config, which would be stale the moment they edit it.

**What you can do is load that one tag and nothing else.** `gtm-tag` takes the
url in the filter, so the container never runs and none of the rest of it does
either:

```
petzl.com##+js(gtm-tag, https://maps.googleapis.com/maps/api/js?v=3.31&key=<their-key>&callback=initGmaps, initGmaps, PageType=DealerLocator)
```

The third argument is **the container's own trigger**, as `Key=substring`
tested against the page's data layer - the same test GTM makes. Their Maps tag
is held behind `_cn` on the data layer variable `PageType`, and the page pushes
`{'PageName':'Web_DealerLocator','PageType':'DealerLocator', ...}`, so
`PageType=DealerLocator` is that condition. It reads the last write of the key,
and a dotted `page.type` walks in, as their model does.

This is not decoration. **A scriptlet filter cannot be scoped to a path**, only
to a domain, so without it the line runs on every page of the site and loads a
tag meant for one of them everywhere. With it, a page the trigger does not
match gets nothing at all.

**A tag can need more than a url.** OneTrust's loader carries its tenant on
the element, and a container's consent manager is the tag a site's content is
most often gated on:

```html
<script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"
        data-domain-script="bb3af1ef-…">
```

So any attribute can be asked for, as many as needed, and they go on the
element rather than the url - a tenant id in a query string is not what a
loader reads:

```
example.com##+js(gtm-tag, https://cdn.cookielaw.org/scripttemplates/otSDKStub.js, attr:data-domain-script=bb3af1ef-…)
```

Nothing here is vendor-specific: `attr:` takes any name. The arguments can
also be named in any order - `url=`, `needs=`, `when=` - since position is a
poor way to ask for the fourth thing.

The second argument is a global the tag needs before it arrives: a loader asked
for with `&callback=initGmaps` throws if it lands first. It is a *name*, and a
name can hold a placeholder: petzl's head defines
`window.initGmaps = window.initGmaps || function() { };` so their other pages
do not throw, and the real `initGmaps` is assigned inside
`petzl.controllers.map`, their map controller, when the page constructs it. So
the wait is for a function **with a body**, not merely for the name - a Maps
loader answered by the empty one draws nothing and reports nothing. On that
page the sign it worked is the browser asking for your location, which is the
first thing the real one does.

The look happens one task after `DOMContentLoaded`, not in the listener
itself: a scriptlet runs at document_start, so its listener is registered
before any the page adds and would run before them - and petzl assigns the
real one from `$(document).ready(function(){ new petzl.controllers.DealerLocator; })`,
which is one of those. Every listener for that event runs in the one task, so
a timeout scheduled from ours runs after all of them.

A script that writes into the page is handled the way their own
`internal.injectHtml` does with `vtp_usePostscribe`: what it writes while it
runs is caught and inserted where the script sits, and each written `<script>`
is rebuilt so it actually runs. Without that the write is simply lost, because
a script appended async runs after parsing, when `document.write` would replace
the whole document - so browsers ignore it and the tag quietly does nothing.
hokkaido-np.co.jp's container switches that flag on for exactly this reason.

It waits up to ten seconds, looking every 50ms for the first second - where a
callback assigned from a ready handler turns up - and every 500ms after that,
which is 37 timer wakeups rather than 200 on a page the trigger excludes. If
the name still holds nothing but a placeholder by then, the tag is loaded anyway (`waited-out=`): their own code guards on the
global the loader creates - `onSearchDealer` opens with
`if (!window.google) return;` - so a search the page makes later works even
when the callback was spent.

Note what this is: a url in a filter, pinned by hand. It can go stale when the
site edits its container, and it loads a third-party script, so keep these in
your own filters where you can see what the url is.

`npm run tags -- GTM-XXXXXXX` finds the candidates without a browser: it reads
the container, lists the scripts its Custom HTML tags inject, drops the ones
that are plainly ad or analytics infrastructure, resolves each remaining tag's
trigger through the container's rules, predicates and macros, and prints the
ready-made line - callback, condition and all. Where the trigger is not a
single data layer test it prints what the container checks instead, for you to
read. Watch for a script that appears twice behind different triggers: petzl's
Maps tag is in there for their sandbox hosts as well as live.

A tag's `"metadata"` is **not** a label: it is a GTM key-value map serialised
as `["map", key, value, …]`, so the `["map"]` on petzl's tags is an *empty*
map and means nothing. Every tag in another container read for this carried
the same thing. The tool prints the pairs when there are any and stays quiet
otherwise.

**A container can also hold page functionality without loading anything.**
shonenjumpplus.com's container fills ten carousel slides with campaign HTML,
dates hardcoded, and then fires the event the page's carousel waits for.
Nothing can be put in a filter for *that*: the content is the container. The
tool reports those tags separately, with the elements they write into, because
the first useful question is whether the page still has them - a container
often keeps tags for markup the site has moved on from. Theirs target `.gtm-*`
classes the page no longer carries.

### A consent state the container took with it

A container often loads the site's consent manager, and a page reads that
manager's state to decide whether to show **its own** content.
globalblue.com's refund-points map:

```js
checkOptanonActiveGroups() {
    const i = window.OptanonActiveGroups ?? '';
    return i.includes('C0001') && i.includes('C0002') && i.includes('C0003');
}
openOTYTNotification() { window.OneTrust?.ToggleInfoDisplay() }
```

Replace the loader and the manager goes with it, so that variable is never
set, the map never renders, and the button that would reopen the banner
optional-chains into nothing. Blocking `gtm.js` did that, which makes it this
resource's to answer rather than someone else's.

**What it answers with is a judgement, stated plainly.** Where this stood in
for the container and nothing else has set a state, it publishes the
categories a page needs to show its own content:

```
OptanonActiveGroups = OnetrustActiveGroups = 'C0001,C0002,C0003'
```

necessary, performance and functional - and **not** `C0004` or `C0005`,
targeting and social, which is what an ad is gated on. It also puts up a
minimal `OneTrust` whose UI methods are no-ops, so a reopen button does not
sit dead, calls the page's own `OptanonWrapper()` if it defined one, and fires
`OneTrustGroupsUpdated`, which is how a page re-checks - globalblue does
`fromEvent(window, 'OneTrustGroupsUpdated')` and runs change detection off it.

Nothing is transmitted. This is a variable a page reads; every request that
follows is still your filter lists' business. A filter can change it:

```
example.com##+js(googletagmanager_gtm, consent=all)   targeting too
example.com##+js(googletagmanager_gtm, consent=off)   none of it
```

`consent=off` is the right answer if you run [consent-rr][consent-rr], which
does this properly for nineteen managers - a stored and transmitted refusal
behind the page-side state, rather than the minimum that keeps a page
working. The summary line says which happened: `consent=content`,
`consent=theirs` where something else had already spoken, or `consent=left`
where this never stood in for the container.

[consent-rr]: https://github.com/ryanbr/consent-rr

### A wait with a name only the page knows

GTM gives a page three ways to be told the work is done, and this answers all
three: `eventCallback`, gtag's `event_callback`, and the anti-flicker
`hide.end()`. A site can hand-roll a fourth, and then the name is the page's
own. hokkaido-np.co.jp spins a 読み込み中... overlay over its recommendation
slider and the only thing that takes it away is

```js
window.addEventListener('aiRecommendGenerated', () => {
    spinnerOverlay.style.display = 'none';
    aiRecommendArea.style.height = '100%';
});
```

What fires that is three vendors deep inside their container - a Custom HTML
tag `document.write`s b→dash's `btm.js`, which loads `ai_recommend.js` and
Edirium's `recommender.js` - so with the container replaced the overlay spins
for ever. The exception that was being used for it, `@@||googletagmanager.com/
gtm.js$domain=…`, lets the whole container back in: Facebook, TikTok, Twitter,
Yahoo, microad, SmartNews, Clarity.

**The redirect alone is enough now.** A page registers what it waits for, so
the registration is where this looks: it wraps `addEventListener` on the window
and the document, keeps the names nothing standard fires, and reads the
handlers. Then it fires only what looks like a page revealing its own content:

| | why |
|---|---|
| not a standard DOM event | `click` and `load` are not anyone's cue |
| the name says nothing about consent, login or payment | `optin` and `consent` are events too, and b→dash's own script on that page dispatches both |
| every handler mentions a reveal - `display`, `visibility`, `hidden`, `opacity`, `classList`, `.remove()` | the case this is for is a page showing content it already has |
| and none of them fetches, builds an element, pushes to a data layer, touches cookies or navigates | those are not this resource's to trigger |
| this stood in for the container | a page whose own container answered is not waiting |

Each one is mutation-tested, and each fires once per page however many copies
of this resource arrive. Where the rule refuses one it should not, a filter can
name it - `##+js(googletagmanager_gtm, event=theName)` - which is a person
deciding instead of a rule guessing.

It ends the wait; it cannot produce what the page was waiting **for**. On
hokkaido-np.co.jp the spinner goes and the slider is empty, because the
recommendations themselves come from the vendor chain. If you would rather not
see the empty area, hide it: `hokkaido-np.co.jp##.ai-recommend-spinner-overlay`
and the section around it.

**And sometimes the container is not loading a tag at all - it is running the
site's logic.** b2c.voegol.com.br's login page, where the redirect to their
SSO never happens with the container replaced:

```js
idDevice = amplitudeGTM.getDeviceId()            // from a GTM-injected wrapper
initializeExperiment(idDevice)                   // container code, whose key is
                                                 //   a container VARIABLE
mapStorageExpFull = { storage: featureExperiment.all(), deviceId: idDevice }
localStorage.setItem('mapStorageExp', JSON.stringify(mapStorageExpFull))
dataLayer.push({ event: 'experiment_ready_v2' })
```

Device id from one injected script, feature flags from another, the
orchestration and the vendor's deployment key in container tags, and a cache
the rest of the site reads. `gtm-tag` can fetch the two scripts; it cannot be
their tag manager, and inventing flag values would be guessing which side of
someone's A/B test a visitor belongs on.

But the login redirect is not waiting on any of that, which took reading their
app to establish. `/minhas-viagens/login` is a module-federation remote - the
page shell, the host app and the sign-in screen are three separate bundles -
and in the third one the whole gate is a global:

```js
ngAfterViewInit() {
    this.waitForWindowProp('amplitude').subscribe(a => {
        this.goToLoginSmiles(this.culture, {
            deviceId: a.getDeviceId(), sessionId: a.getSessionId() }); }); }
waitForWindowProp(name, every = 1200) {
    return timer(0, every).pipe(
        map(() => window[name]), filter(v => !!v), take(1)); }
```

No timeout, anywhere in it. `window.amplitude` is what their Amplitude tag's
injected wrapper creates, so with the container replaced the page polls every
1.2 seconds for ever and the sign-in screen never goes away - no error, no
warning, nothing in the console. One filter ends it:

```
b2c.voegol.com.br##+js(googletagmanager_gtm, stub=amplitude)
```

**That makes the shape, not the name.** The stub is a function that answers to
any property with itself and returns `undefined` however it is called, so a
page can walk whatever path through it that SDK's API has. The name has to come
from the filter: a container is JSON this resource never fetches - it is served
*instead* of it - so there is nothing at runtime to read a vendor's global off,
and a read of a property that is not there is not observable.

`undefined` is the answer and not a plausible id, because the page sends what
it gets straight on - `ids?.deviceId && params.set('ampDeviceId', …)` - and a
device id invented here would be this resource minting a tracking id and then
putting it in a URL bound for someone else. Falsy leaves the parameter out and
the sign-in carries on without it. A global that is already there is left
alone (`stub=none held=amplitude`), and the stub is a plain assignment, so a
real SDK arriving later replaces it exactly as it would have replaced nothing.
Several names need uBO's own escape, since it splits arguments on commas:
`stub=amplitude\,amplitudeGTM`.

So two of the three shapes answer, and the third is narrower than it looked:

| the container is a… | example | can a resource stand in? |
|---|---|---|
| loader | petzl.com: Maps, OneTrust | yes - `gtm-tag` with the url |
| writer | shonenjumpplus.com: carousel HTML | where the page kept the code |
| orchestrator | b2c.voegol.com.br: device id, flags, cache, event | not the flag values - but the global a page waits for is one argument |

**Sometimes the page kept the code itself.** A site that moves that work
browser-side often leaves the same code in the page, inside an inert
`<template>`, waiting for something to insert it. shonenjumpplus.com carries
four, one per banner area:

```html
<div class="html-setting-top-banner"><div class="slide-item"></div>…</div>
<template class="js-browser-html-setting"><script>
  var items = $('.html-setting-top-banner > div');
  if (today < starttime1) { items.eq(0).html('<a href="…"><img src="…"></a>'); … }
  $(document).trigger('sjp:bannerload')
</script></template>
```

**`googletagmanager_gtm` runs those on its own** - no filter, no selector, the
redirect on its own is enough. A template's content is inert, but a script
taken out of one runs as soon as it lands in the document: it was never
parser-inserted, so nothing marks it as already started. Only the scripts are
taken, so none of the template's other markup is duplicated into the page, and
each template is run once.

Running whatever a page holds back in a template would be a way to un-gate a
consent-gated embed, so it is deliberately narrow. All four of these have to
hold:

| | why |
|---|---|
| this stood in for the container (`container=installed`) | a page whose own container answered is not missing anything |
| the template holds script(s) and **no other markup** | markup in a template is a payload someone clones when they are ready, not deferred work |
| every script is **inline**, no `src` | a third-party script is the page's own to load, and a gated embed looks exactly like one |
| the code creates no `script`, `iframe`, `object` or `embed`, and does not `document.write` | code can load a third party itself, which is the same objection |

shonenjumpplus.com's four pass all of them: one inline script each, nothing
else inside, and not a mention of `script` or `iframe` in 27 KB of banner
HTML. The line it prints is `ran=4 templates=4 from=page`.

Where that is too strict - and some tags a container injected really are
third-party scripts - a filter can name the selector instead, which is a
person deciding rather than a rule guessing:

```
shonenjumpplus.com##+js(googletagmanager_gtm, template.js-browser-html-setting)
```

That path also keeps the waiting: a second argument names a global the scripts
need first (`…, template.js-x, jQuery`), and it goes on looking for ten
seconds, so a template added after the page parsed is still picked up.

Most containers need none of this. Of three real ones: `GTM-MWKBJV` injects
two scripts that are page functionality, `GTM-KJZD388` injects eight and every
one is ad or analytics, and
`GTM-W4F8P893` injects no script at all.

**Where you do let a container through, this resource stays out of its way.**
Both wrap `dataLayer.push`, so a page's `eventCallback` used to be answered
twice - once here on the next tick, once by their tags finishing - which on a
submit callback is a double submit. The callback is now replaced with a
once-guard, which is their own contract (`Go()` runs the list once and empties
it), and where a real container has bound itself this does not answer at all:
their `bind()` does `d.subscribers = (d.subscribers || 0) + 1`, so one more
subscriber than this accounted for means something live is answering.

**And once a real container binds, this stands aside.** Their `bind()` does
`d.subscribers = (d.subscribers || 0) + 1`, so one more subscriber than this
resource accounted for means something live is answering: the watching `Proxy`
comes off the registry so their reads are direct and stop being narrated, the
anti-flicker check stops, and the page's callbacks are left to them. One line
says so: `yielded=live-container`.

What it does *not* do is hand the container object back - it does not have
theirs. Their `lo()` is get-or-keep and adopted this one when they booted, and
nothing re-reads it for a swap to take. Their own features are unaffected by
that, though: `ho()` is get-or-create, so a read through the watcher returned
undefined and they created the feature as normal. The run of
`missing=google_tag_manager.*` lines you see before the yield is this resource
narrating their boot, not breaking it.

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
