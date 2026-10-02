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

## Testing

`npm test` builds, then runs the suite **against `dist/`**, parsed with uBO's
own line rules. `npm run mutate` then breaks the source on purpose, one
mutation at a time, and checks the suite notices.

- **Every test here is meant to fail against broken code, and `npm run mutate`
  is how that is known.** Add a mutation to `test/mutations.mjs` for anything
  you add - `{ label, file, from, to }`, where `from` must match its file
  exactly once or the mutation is reported `stale` rather than skipped. CI runs
  it, so a test that proves nothing fails the build.
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
- Don't write a mutation that leaves a long timer pending: `node --test` waits
  for the event loop to drain and will hang instead of failing.

## Releasing

`package.json` carries the repo version and a per-family `resourceVersions`
map. Bump the family's entry when its resources change, the repo version when
releasing, and the pinned URLs in `README.md` - the build refuses to run if a
pinned URL names a different version. Most pushes are not releases.

The install URLs in `README.md` are pinned to a tag, and the build reads them:
it refuses to run if one names a version other than `package.json`'s. So a
release is three things in one commit - the version, the resource versions that
changed, and those URLs - and the tag goes on that commit.

Nothing is published to npm. A `cdn.jsdelivr.net/npm/...` URL would need that,
so none is offered.
