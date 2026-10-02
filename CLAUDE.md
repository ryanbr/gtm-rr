# CLAUDE.md

**[AGENTS.md](AGENTS.md) is the single source for how to work in this repo.**

The ones that break things silently, with no error anywhere:

- A **blank line** in a built resource truncates it, and so do lines starting
  with `// ` or `#`, which uBO drops.
- Resources must stay **ASCII**: uBO encodes them with `btoa()`.
- `+js(gtm-neutered)` takes **no `.js`**; `redirect=` takes the full
  `gtm-neutered.js`. A wrong token injects nothing and says nothing.
- `dist/` is committed and is what uBO fetches. Rebuild and commit it.
- **`eventCallback` is a page waiting for an answer.** Miss it and a form
  silently never submits. It is the first thing to check when a page half-works.

And the habit that matters most: **mutation-test every test you write.**
