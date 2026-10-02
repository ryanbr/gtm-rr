/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { filtersText, loadResources, settle, versions } from './helpers.mjs';

const URL = 'https://www.petzl.com/INT/en/Sport/Dealers';
const MAPS = 'https://maps.googleapis.com/maps/api/js?v=3.31' +
    '&key=AIzaSyTESTKEY&callback=initGmaps';

let tag;

before(async ( ) => {
    tag = (await loadResources()).get('gtm-tag.js');
});

// What uBO does with a user resource used as a scriptlet: fill in the
// positional placeholders from the filter's arguments.
//   patchScriptlet: content.replace("{{" + (i+1) + "}}", arglist[i])
const asScriptlet = (...args) => {
    let out = tag;
    for ( let i = 0; i < args.length; i += 1 ) {
        out = out.replace('{{' + (i + 1) + '}}', args[i]);
    }
    return out;
};

const page = (html, url = URL) => new JSDOM(
    html || '<!doctype html><html><head></head><body><p>x</p></body></html>',
    { runScripts: 'outside-only', url }
);

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(String(line)); };
    return out;
};

const injected = w => Array.from(w.document.querySelectorAll('script[src]'))
    .map(s => s.getAttribute('src'));

/******************************************************************************/

describe('gtm-tag', ( ) => {
    it('ships as one resource, in the format uBO parses', ( ) => {
        for ( const line of tag.split('\n') ) {
            assert.notEqual(line.trim(), '');
            assert.equal(line.startsWith('#'), false);
        }
        assert.equal(/[^\x20-\x7e\t\n]/.test(tag), false);
    });

    it('loads the one tag the filter names', ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        w.eval(asScriptlet(MAPS));
        assert.deepEqual(injected(w), [ MAPS ]);
        assert.ok(out[0].includes(' injected=' + MAPS), out[0]);
        // Nothing else: no container, no tag manager.
        assert.equal(w.google_tag_manager, undefined);
        assert.equal(w.dataLayer, undefined);
    });

    it('waits for a global the tag needs, then loads it', async ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        // A loader asked for with &callback=initGmaps throws if it arrives
        // before the page has defined it. petzl.com defines theirs in an
        // inline script on the dealer page.
        w.eval(asScriptlet(MAPS, 'initGmaps'));
        assert.deepEqual(injected(w), [], 'nothing until the name exists');
        w.eval('window.initGmaps = function(){ window.mapped = true; };');
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
        assert.ok(out.some(l => l.includes(' waited=initGmaps')),
            out.join(' | '));
    });

    it('will not take an empty placeholder for the real thing', async ( ) => {
        // petzl.com's dealer page, in order: an inline script in the head
        // defines initGmaps as an empty function so that their other pages do
        // not throw, and DealerLocatorAdv.js - a plain script at the foot of
        // the page - assigns the real one. A Maps loader let in between the
        // two is answered by the empty one and no map is drawn.
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        assert.equal(w.document.readyState, 'loading');
        w.eval('window.initGmaps = window.initGmaps || function() { };');
        w.eval(asScriptlet(MAPS, 'initGmaps'));
        assert.deepEqual(injected(w), [],
            'the name is there, but the page has not parsed');
        w.eval('window.initGmaps = function(){ window.mapped = true; };');
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
        assert.ok(out.some(l => l.includes(' waited=initGmaps')),
            out.join(' | '));
        w.initGmaps();
        assert.equal(w.mapped, true, 'the one it waited for is the real one');
    });

    it('gives up rather than waiting for ever', async ( ) => {
        const dom = page();
        const w = dom.window;
        try {
            const out = lines(w);
            const real = w.setTimeout;
            // Run its clock fast: the wait is 50ms steps up to ten seconds.
            w.setTimeout = (fn, ms) => real.call(w, fn, ms === 50 ? 1 : ms);
            w.eval(asScriptlet(MAPS, 'neverDefined'));
            await settle(500);
            assert.deepEqual(injected(w), []);
            assert.ok(out.some(l => l.includes(' gave-up=neverDefined')),
                out.join(' | '));
        } finally {
            // Whatever happened: a build that never gives up leaves this
            // window polling, and node --test would not exit.
            w.close();
        }
    });

    it('loads the tag once, however often it runs', ( ) => {
        const dom = page();
        const w = dom.window;
        lines(w);
        w.eval(asScriptlet(MAPS));
        w.eval(asScriptlet(MAPS));
        w.eval(asScriptlet(MAPS));
        assert.deepEqual(injected(w), [ MAPS ]);
    });

    it('refuses anything but https', ( ) => {
        for ( const bad of [
            'http://maps.googleapis.com/maps/api/js',
            'javascript:alert(1)',
            'data:text/javascript,alert(1)',
        ] ) {
            const dom = page();
            const w = dom.window;
            const out = lines(w);
            w.eval(asScriptlet(bad));
            assert.deepEqual(injected(w), [], bad);
            assert.ok(out.some(l => l.includes(' refused=')), bad + ': ' + out);
        }
    });

    it('does nothing with no arguments, or served as a redirect', ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        // Used as a redirect the placeholders are never filled in, and a
        // literal {{1}} is not a url to load.
        w.eval(tag);
        assert.deepEqual(injected(w), []);
        assert.deepEqual(out, []);
    });

    it('puts the tag in a document that has no head yet', ( ) => {
        const dom = page('<!doctype html><html><body><p>x</p></body></html>');
        const w = dom.window;
        lines(w);
        w.eval(asScriptlet(MAPS));
        assert.deepEqual(injected(w), [ MAPS ]);
    });

    it('says on the console what it did', ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        w.eval(asScriptlet(MAPS));
        assert.equal(out.length, 1);
        assert.equal(
            out[0],
            '[gtm-rr] gtm-tag ' + versions.tag + ' injected=' + MAPS
        );
    });
});

/******************************************************************************/

describe('filters, tag', ( ) => {
    it('is offered as a scriptlet with the url in the filter', ( ) => {
        assert.match(filtersText, /\+js\(gtm-tag,/);
        // Never a redirect: the placeholders would never be filled in.
        assert.equal(/redirect=gtm-tag/.test(filtersText), false);
    });
});
