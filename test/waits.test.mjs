/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

const URL = 'https://www.hokkaido-np.co.jp/';
const LOADER = '<script src="https://www.googletagmanager.com/gtm.js' +
    '?id=GTM-MZB2Z66"></scr' + 'ipt>';

let gtm;

before(async ( ) => {
    gtm = (await loadResources()).get('googletagmanager_gtm.js');
});

// hokkaido-np.co.jp's own shape: an overlay with a spinner, and the only
// thing that takes it away is a listener for an event three vendors deep
// inside their container.
const SPINNER = '<div class="ai-recommend-spinner-overlay">' +
    '<p>読み込み中...</p></div>' +
    '<div class="section_wrap" style="height:220px"></div>';

// Their listener, as the page registers it - and registered the way the page
// does it, which is AFTER the resource has run: their GTM snippet is in the
// head and this listener is in an inline script further down the body. A
// fixture that registers it first tests nothing, because the wrapper would
// not be there yet. That is how the negative cases here first passed.
const WAIT = 'window.addEventListener("aiRecommendGenerated", function(){' +
    ' const o = document.querySelector(".ai-recommend-spinner-overlay");' +
    ' o.style.display = "none";' +
    ' document.querySelector(".section_wrap").style.height = "100%"; });';

const page = (body, head = LOADER) => new JSDOM(
    '<!doctype html><html><head>' + head + '</head><body>' + body +
    '</body></html>',
    { runScripts: 'dangerously', url: URL, virtualConsole: new VirtualConsole() }
);

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(String(line)); };
    return out;
};

const spinning = w => {
    const o = w.document.querySelector('.ai-recommend-spinner-overlay');
    return o !== null && o.style.display !== 'none';
};

const said = (out, what) => out.filter(l => l.includes(what));

// The resource as the redirect delivers it: the file, and nothing else. No
// filter, no arguments - and then what the page registers afterwards.
const asRedirect = (w, registers = '') => {
    w.eval(gtm);
    if ( registers !== '' ) { w.eval(registers); }
};

/******************************************************************************/

describe('googletagmanager_gtm, a wait it has to find itself', ( ) => {
    it('ends the wait with no filter at all', async ( ) => {
        const dom = page(SPINNER);
        const w = dom.window;
        const out = lines(w);
        assert.equal(spinning(w), true);
        asRedirect(w, WAIT);
        await settle(150);
        assert.equal(spinning(w), false, 'the page took its own overlay away');
        assert.equal(w.document.querySelector('.section_wrap').style.height,
            '100%');
        assert.ok(said(out, ' told=1').length === 1, out.join(' | '));
    });

    it('will not fire a consent event, by name', async ( ) => {
        const dom = page('<div id="x"></div>');
        const w = dom.window;
        const out = lines(w);
        asRedirect(w, 'window.granted = 0;' +
            'window.addEventListener("optin", function(){' +
            ' document.body.style.display = "block"; window.granted += 1; });' +
            'window.addEventListener("cookieConsentGiven", function(){' +
            ' document.body.style.display = "block"; window.granted += 1; });');
        await settle(150);
        assert.equal(w.granted, 0, 'consent is not this resource to give');
        assert.equal(said(out, 'told=').length, 0, out.join(' | '));
    });

    it('will not fire one whose handler does more than reveal', async ( ) => {
        for ( const handler of [
            'fetch("/api/x"); window.did = 1;',
            'var s = document.createElement("script"); s.src = "//x/y.js";' +
                ' document.head.appendChild(s); window.did = 1;',
            'window.dataLayer.push({ event: "x" }); window.did = 1;',
            'location.href = "/elsewhere"; window.did = 1;',
        ] ) {
            const dom = page('<div id="x"></div>');
            const w = dom.window;
            lines(w);
            asRedirect(w, 'window.did = 0;' +
                'window.addEventListener("widgetReady", function(){' +
                ' document.body.style.display = "block"; ' + handler + ' });');
            await settle(150);
            assert.equal(w.did, 0, handler);
        }
    });

    it('will not fire one whose handler reveals nothing', async ( ) => {
        // Not a reveal, not obviously anything: a handler whose purpose this
        // cannot read is not one to trigger. The rule is narrow on purpose -
        // the page showing its own content is the case this exists for.
        const dom = page('<div id="x"></div>');
        const w = dom.window;
        const out = lines(w);
        asRedirect(w, 'window.plain = 0;' +
            'window.addEventListener("widgetReady", function(){' +
            ' window.plain += 1; });');
        await settle(150);
        assert.equal(w.plain, 0);
        assert.equal(said(out, 'told=').length, 0, out.join(' | '));
    });

    it('will not fire a standard event', async ( ) => {
        const dom = page('<div id="x"></div>');
        const w = dom.window;
        asRedirect(w, 'window.clicks = 0;' +
            'window.addEventListener("click", function(){' +
            ' document.body.style.display = "block"; window.clicks += 1; });');
        await settle(150);
        assert.equal(w.clicks, 0);
    });

    it('does none of this where it stood in for nothing', async ( ) => {
        // No loader on the page: no container went missing, so no wait of
        // the page's is this resource's to end.
        const dom = page(SPINNER, '');
        const w = dom.window;
        asRedirect(w, WAIT);
        await settle(150);
        assert.equal(spinning(w), true);
    });

    it('leaves it to a container that answered for itself', async ( ) => {
        const dom = page(SPINNER);
        const w = dom.window;
        w.eval('window.google_tag_manager = { "GTM-MZB2Z66": { theirs: 1 } };');
        asRedirect(w, WAIT);
        await settle(150);
        assert.equal(spinning(w), true, 'their container will fire it');
    });

    it('stops when a real container binds after it installed', async ( ) => {
        // Their bind is what triggers the yield, and it comes after the
        // install - so the check has to be at the moment of telling, not
        // before. Field-seen on hokkaido-np.co.jp with gtm.js allowlisted:
        // one copy of this reported yielded=live-container while another
        // told the page its wait was over.
        const dom = page(SPINNER);
        const w = dom.window;
        const out = lines(w);
        asRedirect(w, WAIT);
        // Theirs: count itself a subscriber, wrap the push, register the id.
        w.eval('(function(){var c=window.dataLayer,e=c.push;' +
            'window.google_tag_manager=window.google_tag_manager||{};' +
            "var d=window.google_tag_manager['dataLayer']=" +
            "  window.google_tag_manager['dataLayer']||{};" +
            'd.subscribers=(d.subscribers||0)+1;' +
            'c.push=function(){return e.apply(c,[].slice.call(arguments,0))};' +
            'window.google_tag_manager["GTM-MZB2Z66"]=' +
            '  window.google_tag_manager["GTM-MZB2Z66"]||{theirs:true}})();');
        // The next push is where this notices.
        w.eval('window.dataLayer.push({ event: "gtm.dom" });');
        await settle(150);
        assert.ok(said(out, ' yielded=live-container').length !== 0,
            out.join(' | '));
        assert.equal(spinning(w), true, 'their container will tell the page');
        assert.equal(said(out, 'told=').length, 0, out.join(' | '));
    });

    it('fires each wait once', async ( ) => {
        const dom = page('<div id="x"></div>');
        const w = dom.window;
        asRedirect(w, 'window.count = 0;' +
            'window.addEventListener("widgetReady", function(){' +
            ' document.body.style.display = "block"; window.count += 1; });');
        await settle(150);
        assert.equal(w.count, 1);
        // A filter naming the same event adds nothing.
        const match = /^function\s+([^(\s]+)\s*\(/.exec(gtm);
        w.eval(gtm + '\n' + match[1] + '("event=widgetReady");');
        await settle(150);
        assert.equal(w.count, 1);
    });

    it('leaves addEventListener working', async ( ) => {
        const dom = page('<div id="x"></div>');
        const w = dom.window;
        asRedirect(w);
        w.eval('window.ok = 0;' +
            'window.addEventListener("someThing", function(){ window.ok += 1; });' +
            'document.addEventListener("other", function(){ window.ok += 1; });' +
            'window.dispatchEvent(new Event("someThing"));' +
            'document.dispatchEvent(new Event("other"));');
        assert.equal(w.ok, 2, 'wrapped, not replaced');
    });
});
