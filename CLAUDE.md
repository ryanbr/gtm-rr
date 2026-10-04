# CLAUDE.md

**[AGENTS.md](AGENTS.md) is the single source for how to work in this repo.**

The ones that break things silently, with no error anywhere:

- A **blank line** in a built resource truncates it, and so do lines starting
  with `// ` or `#`, which uBO drops.
- Resources must stay **ASCII**: uBO encodes them with `btoa()`.
- `+js(gtm-tag)` takes **no `.js`**; `redirect=` takes the full
  `googletagmanager_gtm.js`. A wrong token injects nothing and says nothing.
- `dist/` is committed and is what uBO fetches. Rebuild and commit it.
- **A resource bump must come with its release.** The install URL is a pinned
  tag, so a bump nobody can fetch did not happen - and the only symptom is
  somebody's correct filter doing nothing. CI checks the pin is current, not
  just resolvable.
- **A page's wait has four spellings.** `eventCallback` on a pushed object;
  gtag's `event_callback` **inside the params of `gtag('event', name, {…})`**,
  which reaches the layer as an arguments object rather than a field on what
  was pushed; the anti-flicker `hide.end()`; and `hitCallback` on the `ga`
  this repo puts up itself. Miss one and a form never submits or a link never
  opens. It is the first thing to check when a page half-works.
- **Never mint an id.** `gtag('get', …)` answers `undefined`, the `ga`
  tracker's `get()` answers `undefined`, `getCorrelator()` answers `''`, and
  no device id, client id or consent string is invented. A guessed id is a
  tracking id this repo created and then put in a URL.
- **Answer input you do not implement; do not throw at the caller.** Allowing
  a file and blocking it both leave a page coherent. A stub that throws is the
  only outcome that does neither.
- **Measure against the real file, not another stand-in.** A superset of
  someone else's resource measures nothing. Enumerate the real one in a
  browser.

And the habit that matters most: **mutation-test every test you write** - and
read the baseline first. A red suite makes every mutation report "caught".
