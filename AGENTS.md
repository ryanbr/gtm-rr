# Working on gtm-rr

One resource per file under `src/<family>/`, shared code in that directory's
`lib/`, bundled by `tools/build.mjs` into a flat `dist/` in the format uBO's
`userResourcesLocation` fetches. `dist/` is committed, because that is what uBO
downloads.

## The resource format will bite you

uBO parses a resources file line by line (`RedirectEngine.resourcesFromString`):

- a **blank line ends the resource**, so built code carries none
- a line starting with `// ` or `#` is **dropped**
- a line starting with `/// ` is a directive

`tools/build.mjs` strips blank lines and whole-line comments, then asserts that
nothing in the result would be eaten. It also rejects non-ASCII, because uBO
serves a user resource as `data:text/javascript;base64,...` built with `btoa()`,
and rejects template literals, because the line-based stripping would change a
string that spanned lines.

**That `data:` URI has a consequence worth knowing before promising anything:**
a page whose CSP does not allow `data:` in `script-src` refuses it, so no user
resource runs there at all - seen on trademe.co.nz as
`<script> source URI is not allowed in this document`. uBO's own built-in
resources come from an extension URL and a page's CSP cannot refuse those, so
shadowing one of theirs with a user resource is a downgrade on those sites: the
request is still blocked, but the page gets no stub where theirs would have
run. The scriptlet form (`##+js(name)`) is the way round it, and it works because
uBO injects a scriptlet from a `blob:` URL belonging to the page: a blob URL is
same-origin, so a `script-src 'self'` permits it where it refuses a `data:`
one. Confirmed on trademe.co.nz, whose `script-src` lists neither. That is also
why the resource has a fallback that scans the page's own script tags for the
container id instead of reading `document.currentScript`.

**The full picture from the field, on trademe.co.nz** (CSP `script-src` with
neither `data:` nor `'unsafe-inline'`, and an EasyPrivacy allowlist entry for
its `gtm.js`), established over four loads:

| setup | result |
|---|---|
| redirect only, allowlist active | container loads for real; no stub |
| redirect + scriptlet, allowlist active | container loads **and** the stub installs first, so GTM's own `lo()` keeps ours and its internals read undefined - a run of `missing=google_tag_manager.*` with `from=` at `googletagmanager.com/gtm.js` |
| redirect + scriptlet, allowlist overridden | clean: one summary line, no `missing=` at all |
| redirect only, allowlist removed | `<script> source URI is not allowed in this document` - the redirect fires, its `data:` target is refused, nothing runs |

So the redirect and the scriptlet are not alternatives, they cover each other,
and the README says to install both.

**A consequence of that blob URL, learned the hard way:** this resource's own
stack frames carry a real source and page-like function names there -
`get@blob:https://site/<uuid>:528:39` is the watching proxy's own get trap - so
anything that walks a stack to find *the page's* frame has to drop frames by
**source**, never by function name. That was got wrong twice before the field
showed it.

`+js(gtm-neutered)` takes no `.js`; `redirect=gtm-neutered.js` takes the full
name. A wrong token injects nothing and says nothing.

## Fidelity comes from evidence, not from documentation

Every structure in `gtm-core.js` and `shared/lib/core.js` was read off three
real containers (`GTM-KJZD388`, `GTM-NSXXFR`, `GTM-W4F8P893` - 540, 537 and
402KB - fetched into a scratchpad and never committed) and a served `gtag/js`,
and they agreed on all of it.

**The minified names move between builds.** The container object is built by
`RU()` in two of those and `LU()` in the third; the data model is `fA` and then
`cA`; the callback gate is `Do` and then `Co`. The names in the comments are
there so a reader can find the code again in *those* samples - when checking a
new one, match the shape. Their own minified names are quoted in
the file's header so the next reader can find them again:

- `RU()` builds what goes into `google_tag_manager[<id>]`:
  `{ dataLayer, bootstrap: 0, callback, onHtmlSuccess, onHtmlFailure }`.
- the model is `dA.R`: `{ name, get, set, reset }`, and `get` walks a dotted
  path.
- a page's wait has two spellings, and the second is not on the pushed object
  at all: `gtag('event', name, { event_callback: fn, event_timeout: n })`
  reaches the layer as an arguments object, with the callback inside the
  command's params. Field-found on
  gamelog.apexlegends-leaksnews.com, where every article opens from one:
  `window.gtag ? gtag('event', 'article_click', { …, event_callback: () =>
  window.open(link) }) : window.open(link)` - and their own snippet defines
  `gtag`, so the page takes that branch whether a loader arrived or not.
- `Do`/`Co` are the `eventCallback` gate: the callback runs when the event's
  tags finish, and `eventTimeout` is only an upper bound - **with no timeout
  there is no timer at all**. A container with no tags has nothing to wait for,
  which is why the stub answers on the next tick.
- the push wrapper keeps the page's array and returns what the array's own
  `push` returned.
- `gtm.dom` and `gtm.load` are pushed by GTM itself, once each, guarded by
  `gtmDom`/`gtmLoad` on the registry entry named after the data layer.

Carried over from consent-rr, where each cost a release:

- **Read the thing's own code to its last call.** A replacement that produces
  the right state and skips the side effects around it leaves pages broken.
- **Dispatch and listen where it does.** An event fired at the wrong target
  reaches nobody, and a test listening somewhere permissive cannot tell.
- **A finding that makes a resource do _less_ is a behaviour change.** It needs
  field evidence, not just a reading of the source.
- **Don't invent what a tenant owns.** The container id and the data layer's
  name come off the script's `src`, which a redirected script still carries.
  Nothing else is guessed: no `google_tag_data`, no `gtag`.

  That `src` surviving the redirect is the assumption everything else rests on,
  and it is **confirmed in the field**: on nzherald.co.nz (Firefox 157, uBO
  serving this resource in place of its own) the line read
  `loader=/gtm.js id=GTM-KGJ3NMV`, and neither value exists anywhere but that
  attribute. uBO redirects at the network layer, so the element keeps what the
  page wrote; the `data:` URI it actually fetches never appears in the DOM.

## When the container is the loader

Some sites keep page functionality in a Custom HTML tag: a map, a player, a
store locator, or a consent manager that gates one of those. The stub cannot
bring those back - it answers the API and has no idea what was configured - and
`gtm-tag.js` is the way out that does not mean allowing the container: the
tag's url goes in the filter and only that one script loads.

- **Decide it with the container, not with a guess.** `npm run tags -- GTM-ID`
  reads the container, pulls the `<script src>` out of its `__html` tags, drops
  the known ad and analytics hosts, and prints a ready-made filter line for
  what is left. Of three real containers, two inject nothing but pixels. So
  the answer to "should we mirror GTM's tag injection" is no: there is usually
  nothing to inject, and when there is, it is one url that a person should
  look at before loading it.
- Reading a container by hand: the tags are double-escaped, so `\x3d` in a
  `vtp_html` string is a `=` and a naive extract truncates the url at the
  first one. `tools/tags.mjs` un-escapes before it matches.
- **A name the tag waits for can be a placeholder, and `typeof` cannot tell.**
  petzl.com's dealer page defines
  `window.initGmaps = window.initGmaps || function() { };` in the head so their
  other pages do not throw, and the real one is assigned inside
  `petzl.controllers.map` when the page constructs it. `typeof w[needs] ===
  'function'` was true for the empty one from the moment the head ran, so Maps
  loaded, called it, and drew nothing - with no error and no console line
  anywhere. The gate now wants a function **with a body**, and holds until the
  document has parsed as well. Field-found, not reviewed-found: the report was
  that allowing the container made the browser ask for the user's location and
  the map open, which is what the real callback does first.
- **A container's other job is writing into the page, and no resource can
  stand in for that** - the content is the container. But a site that has
  moved that work browser-side often leaves the same code in the page in an
  inert `<template>`, and running those scripts is something a resource can
  do: a script taken out of a template runs on insertion, because it was never
  parser-inserted. Only the scripts, never the surrounding markup.
- **That one runs with no filter, so the rule for when it runs is the whole
  safety argument.** A page may keep a consent-gated embed in a template, and
  running whatever is in one would un-gate it. So: only where this stood in
  for the container, only a template holding code and no other markup, only
  inline scripts, and only code that creates no script, iframe, object or
  embed and does not `document.write`. Those were checked against the live
  page before they were written down - all four of shonenjumpplus's templates
  pass - and each one has a mutation. A selector in a filter overrides them,
  which is a person deciding instead of a rule guessing.
- **A scriptlet filter cannot be scoped to a path, so the trigger has to come
  from somewhere.** A container holds its tags behind conditions, and petzl's
  Maps tag is behind `_cn` on the data layer variable `PageType` - which the
  page pushes itself, so the test is reproducible without the container.
  That is `gtm-tag`'s third argument. Without it a tag meant for one page
  loads on every page of the site.
- **The same script can be in a container twice, behind different triggers.**
  petzl's Maps tag is there for their sandbox hosts as well as live, and
  `tools/tags.mjs` deduplicated by url, kept the first and reported the
  sandbox trigger. It merges them now. A container's `rules` reference tags by
  **index into `tags`**, not by `tag_id`, and its config is a JavaScript
  object literal - the `\x3d` escapes make `JSON.parse` throw - so the arrays
  are split by a string-aware scanner rather than parsed.
- **Being first in the `DOMContentLoaded` queue is an artefact, not a
  position to rely on.** A scriptlet runs at document_start, so its listener is
  registered before the page's and fires before them - and petzl assigns the
  real `initGmaps` from `$(document).ready(...)`, which is one of the page's.
  Every listener for that event runs in the one task, so the fix is a timeout
  scheduled from ours: it runs after all of them. Looking in the listener
  itself finds a page that has not set itself up yet.
- A poll that can run for ten seconds runs on every page the filter covers,
  so it backs off: 50ms while the callback is still a race, 500ms afterwards.
  37 wakeups instead of 200, measured, for the same ten seconds - and the CPU
  of the whole wait against a 2000-entry data layer went from 41.7ms to 11.4ms.
  Both ends are mutation-tested, because a backoff that starts slow loses the
  race it exists for.
- Where a wait can time out, think about what to do with the time-out. Here the
  tag loads anyway, because the page's own code guards on the loader's global
  existing (`if (!window.google) return;`), so a later search still works. Not
  injecting would have left nothing at all.
- The once-marker is a name of its own (`consentRRGtmTagLoaded`), never the
  function's name: re-injected, the hoisted function declaration overwrites
  whatever was stored there and the guard is lost. That has been got wrong
  twice in this repo.

## One file, several resources

`dist/gtm-rr-all.js` is every resource in one file, for a single
`userResourcesLocation` URL. A resources file holds as many as it likes, each
starting at its own `/// name.js` and ending at a blank line - the same shape
uBO builds anyway when it joins several URLs with `'\n\n'`. **Nothing is
merged**: the resources keep their own names and versions, and a scriptlet asks
for one by name.

Merging the *code* instead - folding `gtm-tag` into `googletagmanager_gtm` - was
considered and is a trap: uBO names a resource after its **first** function, so
`+js(googletagmanager_gtm, <url>, ...)` would call `consentRRGtmCore(options)`
with a string where it wants its options object, and the two entry points would
have to tell themselves apart at runtime. See the next section for why that
class of thing is expensive.

## The entry function has to be first, and marks its own call

uBO names a resource after the **first** function declaration in it, so that
is the only function a filter's arguments can reach. `googletagmanager_gtm`
takes arguments now, which means two rules:

- `src/gtm/lib/gtm-core.js` defines `consentRRGtm(selector, needs, from)`
  **before** the `// @include` of the shared core. Declarations hoist, so the
  order is only about what uBO reads off the front of the built file. Put the
  include back at the top and the resource is named `consentRRGtmCore` again,
  arguments land in its `options` parameter, and a filter does nothing.
- The resource is injected **and** called once per filter, so the call it makes
  itself passes `'self'`, and only that one stands in for the container.
  Without the marker either nothing installs or it installs twice and says so
  twice. A second *delivery* - the redirect landing as well as the scriptlet -
  has its own copy of the file and so its own self call, which is what reports
  `push=already container=kept`; that diagnostic is the reason the guard is on
  the marker rather than on a window flag.

Both are mutation-tested. The second one fails 54 tests when it is wrong,
which is the right shape for a contract everything else rests on.

## Three shapes, and the one that was called unanswerable too early

A container that **loads** a tag - petzl's Maps - is `gtm-tag`. A container
that **writes** into the page - shonenjumpplus's carousel - is answerable
where the page kept the same code in a template. A container that
**orchestrates** looked like neither: b2c.voegol.com.br takes a device id from
one GTM-injected script, feature flags from another through container code
holding the vendor's deployment key in a container variable, caches them to
`localStorage.mapStorageExp`, and the rest of the site reads that cache.

This file said an exception was the honest answer there. It was wrong, and the
way it was wrong is worth keeping. Two shortcuts had been tried - stubbing the
flag client's global, and seeding the cache so the wait completes - and
neither made the login page navigate, so the conclusion drawn was "something
downstream reads the flag VALUES". Nothing downstream does. The flag cache is
not on the login path at all.

`/minhas-viagens/login` is a module-federation remote: the bot-check shell,
the host app and the sign-in screen are three separate bundles from three
different URLs, and the gate was in the third one, which had not been read:

```js
this.waitForWindowProp('amplitude').subscribe(a => {
    this.goToLoginSmiles(this.culture, {
        deviceId: a.getDeviceId(), sessionId: a.getSessionId() }); });
```

A poll for one global, every 1.2s, with no timeout in it. That is `stub=`, and
it is one argument. **Two failed shortcuts are not evidence that a page is
unanswerable - they are evidence that the gate has not been found yet.** The
tell was there: a seeded cache produced no timeout warning and no navigation,
which means nothing was waiting on the cache. Read every bundle the route
loads before calling a page's wait unanswerable, and when a manifest or a
remote entry is in the chain, that means fetching it.

The flag values are still not ours to invent - guessing a variant picks a side
of someone's A/B test for a visitor - so the orchestrator row is narrower
rather than gone. What a resource can do is answer the contract: a global's
shape, not a vendor's data.

## A writer whose code the page did not keep

The writer row said "where the page kept the code", and medibank.com.au is the
case where it kept none of it (uAssets #33693). The "Message us" button is a
LivePerson engagement, the only copy of LivePerson's bootstrap is a Custom
HTML tag in their container, and where it used to sit inline the page has a
bare `<!--Live person and standard tag -->`. Twenty clientlibs, no `lpTag`.

A `gtm-tag` line could not fix it either, and the reason is worth keeping
because it looks like it should: `tag.js` opens with
`window.lpTag = window.lpTag || {}`. That reads as self-starting. It is not -
the account comes from `site = a.site || b.site` off objects the snippet built,
and `b.defer(...)` is the next thing it touches. **Read a vendor's loader far
enough to see what it reads, not just far enough to see it guard.** The
measurement that settled it was one line in the console:
`TypeError: b.defer is not a function`, with `lpTag.site` null.

So gtm-tag builds the object, keyed on that host and path, with the account
read out of the url's own `site=`. Which is the shape to copy if another vendor
turns up: the filter stays a url, the resource gains a small builder behind a
host test, and nothing new has to be installed. The first draft of this was a
fifth resource, `gtm-liveperson.js`, and folding it into gtm-tag cost nothing
and removed a name from the install.

Two of the bugs in that first draft came out of its own tests rather than
review, and both are the same mistake:

- it waited for `DOMContentLoaded` where what it needed was a **head**. That
  event can arrive with none in the document, and it then appended to nothing,
  once, and printed its success line anyway. Folding it into gtm-tag retired
  the question - gtm-tag already appends a task after the document parsed.
- it dropped `lpTag.sdes` and `lpTag.vars` where a page had seeded them, which
  is the documented way to hand LivePerson a visitor's details. Their snippet
  reads every field back out of whatever is there (`section: lpTag.section ||
  ""`). **A stand-in for a snippet has to keep what the snippet kept.**

## The consent state, and why it is here at all

A container loads the site's consent manager; replacing the loader takes the
manager with it; and a page that reads the manager's state to show its own
content then shows nothing. globalblue.com's map wants `OptanonActiveGroups`
to hold C0001, C0002 and C0003. That breakage is this resource's doing, so
the argument that it belongs to consent-rr does not survive contact with a
visitor who installed only this one.

What it publishes is a judgement: necessary, performance, functional - never
targeting or social, which is what an ad is gated on. `consent=all` asks for
those too, `consent=off` asks for none, and off is the right answer for
anyone running consent-rr, which puts a stored and transmitted refusal behind
the page-side state instead of the minimum.

Three things made it work on a real page, and each has a mutation: the
variable itself, the page's own `OptanonWrapper()` callback, and
`OneTrustGroupsUpdated` - the event their app re-checks on. Two more that the
mutations found rather than review: a state anything else has set is left
alone (one name holding a value is a manager having spoken), and nothing is
published where this did not install, which only a `container=kept` page can
show - a page with no loader proves nothing, because nothing runs there.

**A filter's argument reaches this resource after its own call has run.** uBO
appends the per-filter call, so `consent=off` cannot prevent the state, only
remove what was put up a moment earlier. That is why there is an adjust step
rather than a decision point, and why the off and all branches inside the
assume step were dead code the harness caught.

## A page's wait, when the name is the page's own

Three of these are GTM's and this resource answers them all: `eventCallback`,
gtag's `event_callback`, `hide.end()`. The fourth is hand-rolled, and
hokkaido-np.co.jp is the worked example - an overlay removed only by a
`aiRecommendGenerated` listener, fired three vendors deep inside their
container.

Finding it means wrapping `addEventListener` on the window and the document
and reading the handlers, which is a lot of rope. The gates are the whole
argument, and each has a mutation: not a standard event, nothing
consent-shaped in the name, every handler mentions a reveal, no handler
fetches or builds an element or pushes to a data layer or navigates, and this
stood in for the container. `event=name` in a filter overrides the lot.

**The registration order is the thing to get right in a test.** The resource
runs where the loader was - in the head - and the page registers its listener
further down the body, so the wrapper is in place first. A fixture that
registers the listener during jsdom's own parse puts it in place *before* the
wrapper, and then every negative case passes for nothing. That happened here:
the positive case failing is what exposed four vacuous ones.

## How uBO delivers a scriptlet's arguments

**It calls your function with them.** `lookupScriptlet` reads a name off the
front of the resource and, if it finds one, the per-filter code becomes a call:

```js
const match = /^function\s+([^(\s]+)\s*\(/.exec(details.js);
const fname = match && match[1];
if ( fname ) { content = fname + '({{args}});'; }
else { for (...) content = content.replace('{{'+(i+1)+'}}', arglist[i]); }
```

So a resource that opens with a named function declaration - all three here do
- never has its `{{1}}` placeholders filled in. `gtm-tag` shipped for two
releases taking its url from `'{{1}}'`, which in a browser is the literal text
`{{1}}`: the first thing it does is see no url and return, and it has nothing
to say about that, so the console was empty and the tag never loaded.

Two things follow:

- The whole resource is injected **and** the call is appended, so the
  resource's own trailing call runs first, with no arguments. Write the
  function to do nothing when called that way: `consentRRGtmCore(options)`
  threw on `options.paths` and uBO swallowed it, leaving a real exception in
  the way of the next person debugging.
- **A test helper that fills in the placeholders itself tests a contract uBO
  does not use.** That is how this got through: 21 tests passed against a
  resource that does nothing in a browser. `test/tag.test.mjs` now takes the
  same branch uBO takes, by running uBO's own regex, and one test pins the
  contract itself - a named function at the front, and no `{{n}}` anywhere.

## Testing

`npm test` builds, then runs the suite **against `dist/`**, parsed with uBO's
own line rules. `npm run mutate` then breaks the source on purpose, one
mutation at a time, and checks the suite notices.

- **Every test here is meant to fail against broken code, and `npm run mutate`
  is how that is known.** Add a mutation to `test/mutations.mjs` for anything
  you add - `{ label, file, from, to }`, where `from` must match its file
  exactly once or the mutation is reported `stale` rather than skipped. CI runs
  it, so a test that proves nothing fails the build.
- **`npm run anchors` is the cheap half of the harness**: it checks that every
  mutation's `from` still matches its file exactly once, in about a second, and
  nothing else. A rename in the code a mutation watches leaves it matching
  nothing, so it tests nothing and says nothing - and that is precisely when
  the mutation mattered. CI runs it before the mutations for that reason. It
  reports an anchor as *unanswerable* rather than stale when the file has
  uncommitted changes, because a mutation run in progress keeps one line broken
  at a time and would otherwise make the check lie - which it did, twice, while
  being written.
- A surviving mutation is not automatically a missing test: check it really
  disabled the behaviour. One that cannot - an expression whose result is
  caught and discarded either way - belongs in the manifest as
  `{ equivalent: true }` with the reason, so it is not chased twice.
- The harness restores the sources on its way out, including on Ctrl-C, and
  reports `hung` rather than waiting on a mutation that leaves a timer pending
  - `node --test` will not exit while one is, and a 600-second timer once cost
  fifteen minutes of nothing happening.
- jsdom delivers `DOMContentLoaded` in the same turn as an insertion, so a test
  that wants to prove *when* something ran has to remove the other paths - run
  against an already-loaded document rather than trusting a timing assertion.
- A test that lets a resource poll must `close()` its jsdom window in a
  `finally`. The mutation that removes a give-up leaves that poll running for
  ever, and `node --test` waits for the event loop to drain: the mutation is
  reported `hung` instead of `caught`, and closing the window is what makes it
  fail properly.

## Releasing

`package.json` carries the repo version and a per-family `resourceVersions`
map. Bump the family's entry when its resources change, the repo version when
releasing, and the pinned URLs in `README.md` - the build refuses to run if a
pinned URL names a different version. Most pushes are not releases.

The install URLs in `README.md` are pinned to a tag, and the build reads them:
it refuses to run if one names a version other than `package.json`'s. So a
release is three things in one commit - the version, the resource versions that
changed, and those URLs - and the tag goes on that commit.

**Push the tag with the commit, not later.** v1.1.2 and v1.1.4 were pinned in
the README and never tagged, so every install URL the README gave for two
releases returned 404 - and uBO skips a user resource URL that fails without a
word, so the resource was simply missing with nothing to see anywhere. CI now
checks each pinned URL resolves (via the API, since the raw host caches a 404
for minutes), which means a bump pushed without its tag fails the build.

Nothing is published to npm. A `cdn.jsdelivr.net/npm/...` URL would need that,
so none is offered.

## Reference

[comparison-ubo-adguard.md](comparison-ubo-adguard.md) - uBO's GPT resource
against AdGuard's, measured rather than read. Kept because it is the nearest
relative of this resource and because of one transferable rule: **answer input
you do not implement, rather than throwing at the caller.** Three of uBO's
methods throw, and a throwing stub is worse than either a noop or the real
file, since allowing and blocking both leave a page coherent. The TCF
stand-in here answers an unknown command with `callback(null, false)` for that
reason.

## Working on it
