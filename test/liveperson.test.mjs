/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    uAssets #33693. medibank.com.au's "Message us" button is a LivePerson
    engagement, and the only thing carrying LivePerson's bootstrap is the
    container. Their tag.js cannot start without it - it reads the account as
    site = a.site || b.site and calls b.defer() straight away - so naming the
    script is not enough on its own.

    This is gtm-tag's doing, from the url the filter already gives it, so
    every test here goes through the ordinary gtm-tag path and the ordinary
    gtm-tag timing: one task after the document has parsed.

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

const URL = 'https://www.medibank.com.au/contact-us/';
const SITE = '3178090';
const SRC = 'https://lptag.liveperson.net/tag/tag.js?site=' + SITE;
const OTHER = 'https://host.example/thing.js';

let tag;

before(async ( ) => {
    tag = (await loadResources()).get('gtm-tag.js');
});

const asScriptlet = (...args) => {
    const match = /^function\s+([^(\s]+)\s*\(/.exec(tag);
    return tag + '\n' + match[1] +
        '(' + JSON.stringify(args).slice(1, -1) + ');';
};

const page = ( ) => new JSDOM(
    '<!doctype html><html><head></head><body><p>x</p></body></html>',
    { runScripts: 'outside-only', url: URL, virtualConsole: new VirtualConsole() }
);

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(String(line)); };
    return out;
};

const injected = w => Array.from(w.document.querySelectorAll('script[src]'))
    .map(s => s.getAttribute('src'));

/******************************************************************************/

describe('gtm-tag, a loader that cannot start from its own url', ( ) => {
    it('builds the object their tag reads, off the url it was given', async ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval(asScriptlet(SRC));
        await settle(120);
        assert.equal(typeof w.lpTag, 'object', 'nothing built it');
        assert.equal(w.lpTag.site, SITE, 'the account comes out of the url');
        assert.deepEqual(injected(w), [ SRC ]);
        assert.ok(out.some(l => l.includes('built=lpTag site=' + SITE)),
            out.join(' | '));
    });

    it('leaves every other url exactly as it was', async ( ) => {
        const w = page().window;
        w.eval(asScriptlet(OTHER));
        await settle(120);
        assert.equal(w.lpTag, undefined, 'no object for a tag that needs none');
        assert.deepEqual(injected(w), [ OTHER ]);
    });

    it('wants their host and their path, not just a site parameter', async ( ) => {
        for ( const url of [
            'https://lptag.liveperson.net/tag/other.js?site=' + SITE,
            'https://host.example/tag/tag.js?site=' + SITE,
            'https://notliveperson.net/tag/tag.js?site=' + SITE,
        ] ) {
            const w = page().window;
            w.eval(asScriptlet(url));
            await settle(120);
            assert.equal(w.lpTag, undefined, url);
            assert.deepEqual(injected(w), [ url ], url);
        }
    });

    it('takes a subdomain of theirs, which their override can name', async ( ) => {
        const url = 'https://lptag-cdn.liveperson.net/tag/tag.js?site=' + SITE;
        const w = page().window;
        w.eval(asScriptlet(url));
        await settle(120);
        assert.equal(w.lpTag.site, SITE);
    });

    it('refuses their tag url with no account in it', async ( ) => {
        // The shorter line a filter author reaches for first. Appending it is
        // measured broken on their page: tag.js throws on the object it
        // expected, and the window.lpTag = window.lpTag || {} it opens with
        // is left behind, so "is lpTag there?" answers yes and the button is
        // still gone. So this says what is missing instead.
        for ( const site of [ '', 'medibank', '31780901234567', '31%3B' ] ) {
            const url = 'https://lptag.liveperson.net/tag/tag.js' +
                (site !== '' ? '?site=' + site : '');
            const w = page().window;
            const out = lines(w);
            w.eval(asScriptlet(url));
            await settle(120);
            assert.equal(w.lpTag, undefined, url);
            assert.deepEqual(injected(w), [], 'not appended bare: ' + url);
            assert.ok(
                out.some(l => l.includes('refused=site')),
                url + ' -> ' + out.join(' | ')
            );
        }
    });

    it('checks the account the page set, like any other', async ( ) => {
        // It ends up in a script src, and a page is not a trustworthy place
        // to read one from without looking. A mutation found this: every
        // test above seeded a valid id.
        for ( const site of [ 'medibank', '31780901234567', '31 90', '0' ] ) {
            const w = page().window;
            const out = lines(w);
            w.eval('window.lpTag = { site: ' + JSON.stringify(site) + ' };');
            w.eval(asScriptlet('https://lptag.liveperson.net/tag/tag.js'));
            await settle(120);
            assert.equal(
                typeof w.lpTag.defer, 'undefined',
                'nothing built on ' + site
            );
            assert.deepEqual(injected(w), [], site);
            assert.ok(out.some(l => l.includes('refused=site')), site);
        }
    });

    it('takes the account off an object the page set itself', async ( ) => {
        // The other documented way for it to arrive, and the one case where
        // the url alone is the right filter.
        const w = page().window;
        w.eval('window.lpTag = { site: "' + SITE + '" };');
        w.eval(asScriptlet('https://lptag.liveperson.net/tag/tag.js'));
        await settle(120);
        assert.equal(w.lpTag.site, SITE);
        assert.equal(typeof w.lpTag.defer, 'function', 'and gets the queues');
        assert.deepEqual(
            injected(w), [ 'https://lptag.liveperson.net/tag/tag.js' ]
        );
    });

    it('leaves their own opt-out alone', async ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval('window._lptStop = true;');
        w.eval(asScriptlet(SRC));
        await settle(120);
        assert.equal(w.lpTag, undefined);
        assert.deepEqual(injected(w), [], 'and does not append it either');
        assert.ok(out.some(l => l.includes('refused=_lptStop')), out.join(' | '));
    });

    it('stands aside where the real snippet already ran', async ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval('window.lpTag = { _tagCount: 1, site: "999", theirs: true };');
        w.eval(asScriptlet(SRC));
        await settle(120);
        assert.equal(w.lpTag.theirs, true, 'theirs is left in place');
        assert.equal(w.lpTag.site, '999');
        assert.equal(w.lpTag._tagCount, 2, 'counted, as theirs does');
        assert.deepEqual(injected(w), [], 'and nothing is loaded twice');
        assert.ok(out.some(l => l.includes('kept=theirs')), out.join(' | '));
    });

    it('keeps what the page seeded on the object', async ( ) => {
        // sdes and vars are the documented way for a page to hand LivePerson
        // a visitor's details, written before the tag builds the rest.
        const w = page().window;
        w.eval(
            'window.lpTag = { sdes: [ { type: "ctmrinfo" } ],' +
            ' vars: [ 1 ], section: "seeded", autoStart: false };'
        );
        w.eval(asScriptlet(SRC));
        await settle(120);
        assert.equal(w.lpTag.sdes.length, 1);
        assert.equal(w.lpTag.vars.length, 1);
        assert.equal(w.lpTag.vars[0], 1);
        assert.equal(w.lpTag.section, 'seeded');
        assert.equal(w.lpTag.autoStart, false, 'false only when they said so');
    });

    it('queues into the buckets their tag drains', async ( ) => {
        const w = page().window;
        w.eval(asScriptlet(SRC));
        await settle(120);
        // Their init() has already put DOM_READY in the trigger bucket, so
        // what matters is which bucket each one lands in, not how full it is.
        const was = name => (w.lpTag[name] || []).length;
        const before = [ was('_defB'), was('_defT'), was('_defL') ];
        const seen = [];
        w.lpTag.defer(( ) => seen.push('before'), 0);
        w.lpTag.defer(( ) => seen.push('trigger'), 1);
        w.lpTag.defer(( ) => seen.push('last'), 2);
        assert.deepEqual(
            [ was('_defB'), was('_defT'), was('_defL') ],
            [ before[0] + 1, before[1] + 1, before[2] + 1 ]
        );
        w.lpTag._defB[was('_defB') - 1]();
        assert.deepEqual(seen, [ 'before' ], 'a queue, not a call');
    });

    it('queues a bind and a trigger rather than dropping them', async ( ) => {
        const w = page().window;
        w.eval(asScriptlet(SRC));
        await settle(120);
        w.lpTag.events.bind('LPT', 'OFFER_CLICK', ( ) => undefined);
        assert.equal(w.lpTag._defB.length, 1);
        assert.equal(typeof w.lpTag._defB[0], 'function');
    });

    it('queues the DOM_READY their framework waits on', async ( ) => {
        // Their init() triggers it, and the trigger is queued for tag.js to
        // drain. Without it a page gets a widget that never opens.
        const w = page().window;
        w.eval(asScriptlet(SRC));
        await settle(120);
        assert.ok(w.lpTag._timing.start > 0, 'their timing is started');
        assert.equal(w.lpTag.isDom, true, 'the document had parsed by then');
        assert.ok(
            (w.lpTag._defT || []).length >= 1,
            'DOM_READY is queued: ' + JSON.stringify(Object.keys(w.lpTag))
        );
    });

    it('records both their milestones even when load has gone', async ( ) => {
        // This runs a task after the document parsed, and on a slow page that
        // can be after load as well - a listener registered then never fires,
        // and theirs, called from a container tag, always recorded both.
        const w = page().window;
        await settle(120);
        assert.equal(w.document.readyState, 'complete', 'load has been and gone');
        w.eval(asScriptlet(SRC));
        await settle(120);
        assert.ok(w.lpTag._timing.start > 0, 'start');
        assert.ok(w.lpTag._timing.contReady > 0, 'contReady');
        assert.ok(w.lpTag._timing.domReady > 0, 'domReady, with no load left');
        assert.equal(w.lpTag.isDom, true);
    });

    it('carries the arrays their taglets push into', async ( ) => {
        const w = page().window;
        w.eval(asScriptlet(SRC));
        await settle(120);
        for ( const field of [
            'vars', 'dbs', 'ctn', 'sdes', 'hooks', 'identities', 'ev',
        ] ) {
            assert.ok(Array.isArray(w.lpTag[field]), field);
        }
    });

    it('loads a taglet their framework asks for', async ( ) => {
        const w = page().window;
        w.eval(asScriptlet(SRC));
        await settle(120);
        w.lpTag.load(
            'https://lptag.liveperson.net/taglets/x.js', 'UTF-8', 'lpTaglet'
        );
        await settle();
        assert.ok(
            injected(w).includes('https://lptag.liveperson.net/taglets/x.js'),
            injected(w).join(' | ')
        );
        assert.equal(
            w.document.getElementById('lpTaglet').getAttribute('charset'),
            'UTF-8'
        );
    });

    it('does not throw where there is nothing to append to', async ( ) => {
        // Their framework calls load() whenever it likes, and theirs appends
        // to getElementsByTagName("head").item(0) with no guard at all.
        const w = page().window;
        w.eval(asScriptlet(SRC));
        await settle(120);
        const root = w.document.documentElement;
        const parent = root.parentNode;
        parent.removeChild(root);
        assert.equal(w.lpTag._load('https://lptag.liveperson.net/x.js'), false);
    });
});
