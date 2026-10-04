/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    googletagservices_gpt.js, which ships under uBO's own resource name and so
    replaces their built-in. The surface it answers was enumerated from the
    real gpt.js in a browser rather than copied from anyone's resource - the
    counts asserted below are that enumeration, and a page can call every one
    of them.

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

let gpt;

before(async ( ) => {
    gpt = (await loadResources()).get('googletagservices_gpt.js');
});

const page = (pre = '') => {
    const dom = new JSDOM(
        '<!doctype html><html><body><div id="adbox"></div></body></html>',
        { runScripts: 'outside-only', url: 'https://example.com/',
            virtualConsole: new VirtualConsole() }
    );
    if ( pre !== '' ) { dom.window.eval(pre); }
    dom.window.eval(gpt);
    return dom.window;
};

// Walking the prototype chain, as the enumeration of the real file did.
const names = (w, expr) => w.eval(`(function(){
    const o = ${expr};
    const s = new Set();
    for ( let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p) ) {
        for ( const k of Object.getOwnPropertyNames(p) ) {
            if ( k !== 'constructor' ) { s.add(k); }
        }
    }
    return [ ...s ];
})()`);

/******************************************************************************/

describe('googletagservices_gpt', ( ) => {
    it('carries the surface the real file does', ( ) => {
        const w = page();
        // The real gpt.js, enumerated: googletag 29, pubads() 51,
        // defineSlot(...) 37, sizeMapping() 2, companionAds() 14, content() 6,
        // secureSignalProviders 4. These are at least that, and the extras
        // are uBO legacy a page may be written against.
        const counts = {
            'window.googletag': 29,
            'googletag.pubads()': 51,
            "googletag.defineSlot('/1/x', [[1,1]], 'adbox')": 37,
            'googletag.sizeMapping()': 2,
            'googletag.companionAds()': 14,
            'googletag.content()': 6,
            'googletag.secureSignalProviders': 4,
        };
        for ( const [ expr, least ] of Object.entries(counts) ) {
            const got = names(w, expr);
            assert.ok(got.length >= least,
                expr + ' has ' + got.length + ', the real file has ' + least);
        }
    });

    it('answers the calls uBO\'s resource throws on', ( ) => {
        const w = page();
        const slot = w.googletag.defineSlot('/1/x', [ [ 300, 250 ] ], 'adbox');
        assert.doesNotThrow(( ) => slot.getResponseInformation().lineItemId);
        assert.doesNotThrow(( ) => w.googletag.setConfig({ targeting: {} }));
        assert.doesNotThrow(( ) => w.googletag.pubads().isInitialLoadDisabled());
        assert.doesNotThrow(( ) => w.googletag.pubads().setTagForUnderAgeOfConsent(1));
        assert.doesNotThrow(( ) => slot.setForceSafeFrame(true));
        assert.doesNotThrow(( ) => slot.setConfig({}));
        assert.doesNotThrow(( ) => w.googletag.secureSignalProviders.clearAllCache());
        assert.doesNotThrow(( ) => w.googletag.companionAds().getSlots());
        assert.doesNotThrow(( ) => w.googletag.content().removeEventListener('x', ( ) => {}));
    });

    it('carries their enums, both directions', ( ) => {
        const w = page();
        const e = w.googletag.enums;
        assert.equal(e.OutOfPageFormat.REWARDED, 4);
        assert.equal(e.OutOfPageFormat[4], 'REWARDED');
        assert.equal(e.OutOfPageFormat.INTERSTITIAL, 5);
        assert.equal(e.TrafficSource.ORGANIC, 2);
        assert.equal(e.TagForAgeTreatment.CHILD, 1);
        assert.equal(e.TagForAgeTreatment[0], 'UNSPECIFIED');
    });

    it('mints no correlator, and no id of any kind', ( ) => {
        const w = page();
        const pub = w.googletag.pubads();
        assert.equal(pub.getCorrelator(), '');
        assert.equal(pub.getTagSessionCorrelator(), 0);
        assert.equal(pub.getVersion(), '');
        const slot = w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        assert.deepEqual(Object.keys(slot.getResponseInformation()), []);
    });

    it('never runs a secure signal collector', async ( ) => {
        const w = page();
        let collected = false;
        w.googletag.secureSignalProviders.push({
            id: 'vendor',
            collectorFunction: ( ) => { collected = true; return Promise.resolve('x'); },
        });
        w.googletag.encryptedSignalProviders.push({
            id: 'vendor',
            collectorFunction: ( ) => { collected = true; return Promise.resolve('x'); },
        });
        await settle();
        assert.equal(collected, false, 'nothing collected, so nothing to send');
    });

    it('answers the slot events a page branches on', async ( ) => {
        const w = page();
        const seen = [];
        let empty = null;
        for ( const name of [
            'slotRequested', 'slotResponseReceived', 'slotRenderEnded',
            'slotOnload', 'impressionViewable',
        ] ) {
            w.googletag.pubads().addEventListener(name, event => {
                seen.push(name);
                if ( name === 'slotRenderEnded' ) { empty = event.isEmpty; }
            });
        }
        const slot = w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        slot.addService(w.googletag.pubads());
        w.googletag.display('adbox');
        assert.deepEqual(seen, [], 'not inside display(), as theirs is not');
        await settle();
        assert.equal(seen.length, 5);
        assert.equal(empty, true, 'nothing filled it, which is the truth');
    });

    it('takes a listener off again', async ( ) => {
        const w = page();
        let hits = 0;
        const listener = ( ) => { hits += 1; };
        const pub = w.googletag.pubads();
        pub.addEventListener('slotRenderEnded', listener);
        assert.equal(pub.removeEventListener('slotRenderEnded', listener), true);
        w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        w.googletag.display('adbox');
        await settle();
        assert.equal(hits, 0);
    });

    it('builds no iframe in the slot', async ( ) => {
        // An event is a page's own question answered. An iframe carrying
        // data-load-complete is a prop for something checking whether an ad
        // rendered, which is a different business.
        const w = page();
        w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        w.googletag.display('adbox');
        await settle();
        assert.equal(
            w.document.querySelector('[id^="google_ads_iframe"]'), null
        );
        assert.equal(w.document.querySelector('#adbox').children.length, 0);
    });

    it('gives one slot per div, and knows which div', ( ) => {
        const w = page();
        const a = w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        const b = w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        assert.equal(a, b, 'the same div is the same slot, as theirs is');
        assert.equal(a.getSlotElementId(), 'adbox');
        assert.equal(a.getAdUnitPath(), '/1/x');
        assert.equal(w.googletag.defineUnit, w.googletag.defineSlot);
    });

    it('displays by element and by slot, not only by id', async ( ) => {
        for ( const how of [ 'adbox', 'element', 'slot' ] ) {
            const w = page();
            let fired = false;
            w.googletag.pubads().addEventListener('slotRenderEnded', ( ) => {
                fired = true;
            });
            const slot = w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
            const what = how === 'element'
                ? w.document.getElementById('adbox')
                : how === 'slot' ? slot : 'adbox';
            w.googletag.display(what);
            await settle();
            assert.equal(fired, true, 'display by ' + how);
        }
    });

    it('runs what the page queued before it arrived, in order', ( ) => {
        const w = page(
            'window.order = [];' +
            'window.googletag = { cmd: [' +
            ' function(){ window.order.push(1); },' +
            ' function(){ window.order.push(2); } ] };'
        );
        assert.deepEqual(Array.from(w.order), [ 1, 2 ]);
        // And a push after it arrived runs at once, answering 1 as theirs does.
        assert.equal(w.googletag.cmd.push(( ) => { w.order.push(3); }), 1);
        assert.deepEqual(Array.from(w.order), [ 1, 2, 3 ]);
    });

    it('swallows a throw from the page own queued function', ( ) => {
        const w = page(
            'window.googletag = { cmd: [ function(){ throw new Error("x"); } ] };'
        );
        assert.equal(typeof w.googletag.pubads, 'function', 'it carried on');
    });

    it('leaves the first copy in charge on a second evaluation', async ( ) => {
        // Served as a redirect and injected as a scriptlet both, this is
        // evaluated twice - and a second closure would put empty listener and
        // slot maps in front of the first copy's.
        const w = page();
        let hits = 0;
        w.googletag.pubads().addEventListener('slotRenderEnded', ( ) => {
            hits += 1;
        });
        w.eval(gpt);
        w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        w.googletag.display('adbox');
        await settle();
        assert.equal(hits, 1, 'the listener registered before still hears it');
    });

    it('destroys slots when asked', ( ) => {
        const w = page();
        const a = w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        assert.equal(w.googletag.destroySlots(), true);
        const b = w.googletag.defineSlot('/1/x', [ [ 1, 1 ] ], 'adbox');
        assert.notEqual(a, b, 'a fresh one after the registry was cleared');
    });

    it('is ready the moment it lands', ( ) => {
        const w = page();
        assert.equal(w.googletag.apiReady, true);
        assert.equal(w.googletag.pubadsReady, true);
        assert.equal(w.googletag._loaded_, true);
    });
});
