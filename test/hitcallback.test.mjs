/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    A page's wait in its third spelling: ga('send', 'pageview', { hitCallback }).
    Found by measuring this resource against uBO's and AdGuard's - AdGuard
    answers it from their gtm stand-in, uBO's does not, and nor did this.

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

const ID = 'GTM-TESTGA1';
const LOADER = '<script src="https://www.googletagmanager.com/gtm.js?id=' +
    ID + '"></scr' + 'ipt>';

let gtm;

before(async ( ) => {
    gtm = (await loadResources()).get('googletagmanager_gtm.js');
});

const page = (head = LOADER) => new JSDOM(
    '<!doctype html><html><head>' + head + '</head><body><p>x</p></body></html>',
    { runScripts: 'outside-only', url: 'https://example.com/', virtualConsole: new VirtualConsole() }
);

/******************************************************************************/

describe('googletagmanager_gtm, the ga stub it puts up itself', ( ) => {
    it('answers a trailing options object', async ( ) => {
        const w = page().window;
        w.eval(gtm);
        let hit = 0;
        w.ga('send', 'pageview', { hitCallback: ( ) => { hit += 1; } });
        assert.equal(hit, 0, 'not inside the call, as theirs is not');
        await settle();
        assert.equal(hit, 1);
    });

    it('answers a trailing function, with a tracker that knows nothing', async ( ) => {
        const w = page().window;
        w.eval(gtm);
        let got = 'never';
        w.ga('send', 'pageview', tracker => {
            // Theirs hands over ga.create(). A page that reads an id off it
            // must not get one from here.
            got = String(tracker && typeof tracker.get === 'function' &&
                tracker.get('clientId'));
        });
        await settle();
        assert.equal(got, 'undefined', 'answered, with no id in it');
    });

    it('answers hitCallback given positionally', async ( ) => {
        // Something has to follow the function, or the trailing-function
        // branch above catches it and this one is never reached - which is
        // how the first version of this test passed against the branch being
        // deleted. A mutation said so.
        const w = page().window;
        w.eval(gtm);
        let hit = false;
        w.ga('send', 'event', 'cat', 'act', 'hitCallback',
            ( ) => { hit = true; }, 1);
        await settle();
        assert.equal(hit, true);
    });

    it('does not invent a callback where the page passed none', async ( ) => {
        const w = page().window;
        w.eval(gtm);
        assert.doesNotThrow(( ) => w.ga('send', 'pageview'));
        assert.doesNotThrow(( ) => w.ga());
        assert.doesNotThrow(( ) => w.ga('set', 'anonymizeIp', true));
        await settle();
    });

    it('leaves a real ga alone, and a surrogate that got there first', async ( ) => {
        // uBO's analytics surrogate answers hitCallback itself, and where it
        // applies it wins - this must not replace it.
        const w = page().window;
        w.eval('window.ga = function(){ window.theirs = (window.theirs|0) + 1; };');
        w.eval(gtm);
        let hit = false;
        w.ga('send', 'pageview', { hitCallback: ( ) => { hit = true; } });
        await settle();
        assert.equal(w.theirs, 1, 'theirs is still the one being called');
        assert.equal(hit, false, 'and this did not answer over the top of it');
    });

    it('grows no ga on a page it is not standing in for', ( ) => {
        const w = page('').window;
        w.eval(gtm);
        assert.equal(w.ga, undefined);
    });
});
