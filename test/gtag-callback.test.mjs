/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

const URL = 'https://gamelog.apexlegends-leaksnews.com/';
const ID = 'G-49GN7LBR24';

let gtm;

before(async ( ) => {
    gtm = (await loadResources()).get('googletagmanager_gtm.js');
});

// Their page, as served: the loader, then their own gtag, which pushes an
// arguments object onto the layer.
const SNIPPET = 'window.dataLayer = window.dataLayer || [];' +
    'function gtag(){ dataLayer.push(arguments); }' +
    'gtag("js", new Date());' +
    'gtag("config", "' + ID + '");';

// What the page opened. Copied out of jsdom's realm, where an Array is not
// this realm's Array and deepStrictEqual compares prototypes as well.
const opened = w => Array.from(w.opened);

const page = ( ) => {
    const html = '<!doctype html><html><head><script async src=' +
        '"https://www.googletagmanager.com/gtag/js?id=' + ID + '">' +
        '</scr' + 'ipt></head><body><a href="/x" id="post">title</a></body></html>';
    const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: URL,
        virtualConsole: new VirtualConsole(),
    });
    dom.window.eval(SNIPPET);
    return dom.window;
};

// gamelog.apexlegends-leaksnews.com's click handler, as built:
//   ? window.gtag('event', 'article_click', { …, event_callback: () => {
//       window.open(link, '_blank', 'noopener,noreferrer') }, event_timeout: 1e3 })
//   : window.open(link, '_blank', 'noopener,noreferrer')
const CLICK = 'window.opened = [];' +
    'window.open = function(u){ window.opened.push(u); };' +
    'window.clickArticle = function(link){' +
    '  if ( typeof window.gtag === "function" ) {' +
    '    window.gtag("event", "article_click", {' +
    '      article_id: 1, destination_url: link,' +
    '      event_callback: function(){' +
    '        window.open(link, "_blank", "noopener,noreferrer"); },' +
    '      event_timeout: 1000 });' +
    '  } else { window.open(link, "_blank", "noopener,noreferrer"); }' +
    '};';

/******************************************************************************/

describe('googletagmanager_gtm, gtag event_callback', ( ) => {
    it('answers the callback a gtag event is waiting on', async ( ) => {
        const w = page();
        w.eval(gtm);
        w.eval(CLICK);
        w.eval('window.clickArticle("https://example.com/article")');
        assert.deepEqual(opened(w), [], 'not synchronously, as theirs is not');
        await settle(10);
        assert.deepEqual(opened(w), [ 'https://example.com/article' ]);
    });

    it('answers it once, whoever else answers', async ( ) => {
        const w = page();
        w.eval(gtm);
        w.eval(CLICK);
        w.eval('window.clickArticle("https://example.com/a")');
        await settle(10);
        // A real gtag arriving later works through the same queued arguments
        // object: one more call to the field it finds there must not open a
        // second tab.
        w.eval('for ( const item of window.dataLayer ) {' +
            ' if ( item && item[2] && typeof item[2].event_callback === "function" ) {' +
            '   item[2].event_callback(); } }');
        await settle(10);
        assert.deepEqual(opened(w), [ 'https://example.com/a' ]);
    });

    it('leaves a command with no callback alone', async ( ) => {
        const w = page();
        w.eval(gtm);
        w.eval('window.ok = false;' +
            'window.gtag("event", "page_view");' +
            'window.gtag("event", "scroll", { percent_scrolled: 90 });' +
            'window.gtag("set", { currency: "JPY" });' +
            'window.ok = true;');
        await settle(10);
        assert.equal(w.ok, true, 'a command with nothing to answer must not throw');
        // And an arguments object is still not a model update: a command is
        // for their own table, which theirs does not merge either.
        const container = w.google_tag_manager[ID];
        assert.equal(container.dataLayer.get('currency'), undefined);
        assert.equal(container.dataLayer.get('percent_scrolled'), undefined);
    });

    it('keeps their event fields out of the model', async ( ) => {
        const w = page();
        w.eval(gtm);
        w.eval(CLICK);
        w.eval('window.clickArticle("https://example.com/b")');
        await settle(10);
        const model = w.google_tag_manager[ID].dataLayer;
        for ( const key of [
            'event_callback', 'event_timeout', 'article_id', 'destination_url',
        ] ) {
            assert.equal(model.get(key), undefined, key);
        }
    });

    it('still answers GTM own eventCallback on the same page', async ( ) => {
        const w = page();
        w.eval(gtm);
        w.eval('window.answered = 0;' +
            'window.dataLayer.push({ event: "submit",' +
            ' eventCallback: function(){ window.answered += 1; } });');
        await settle(10);
        assert.equal(w.answered, 1);
    });

    it('does not take a callback off any other command shape', async ( ) => {
        const w = page();
        w.eval(gtm);
        w.eval('window.ran = 0;' +
            'const fn = function(){ window.ran += 1; };' +
            // not an event
            'window.gtag("config", "' + ID + '", { event_callback: fn });' +
            // no name
            'window.gtag("event", { event_callback: fn });' +
            // their get command, which has its own answer
            'window.gtag("get", "' + ID + '", "client_id", fn);');
        await settle(20);
        // The get is answered - with undefined - and nothing else is.
        assert.equal(w.ran, 1);
    });
});
