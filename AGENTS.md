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

`+js(gtm-neutered)` takes no `.js`; `redirect=gtm-neutered.js` takes the full
name. A wrong token injects nothing and says nothing.

## Fidelity comes from evidence, not from documentation

Every structure in `gtm-core.js` was read off two real containers
(`GTM-KJZD388`, `GTM-NSXXFR`, ~540KB each, fetched into a scratchpad and never
committed), and they agreed on all of it. Their own minified names are quoted in
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

## Testing

`npm test` builds, then runs the suite **against `dist/`**, parsed with uBO's
own line rules.

- **Mutation-test anything you add.** Break the code a test covers and watch it
  fail; if the suite stays green the test is pointed at the wrong thing.
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
