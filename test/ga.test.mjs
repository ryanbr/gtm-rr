/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { filtersText, loadResources, runDom, settle, versions } from './helpers.mjs';

const URL = 'https://www.example.com/';

let optout;

before(async ( ) => {
    optout = (await loadResources()).get('ga-optout.js');
});

// Their own check, transcribed from the served bundle, so the tests ask the
// question their code asks rather than a paraphrase of it.
const theirCheck = (w, id) => {
    const uR = w;
    const sR = w.document;
    const b = uR._gaUserPrefs;
    if (
        b && b.ioo && b.ioo() ||
        sR.documentElement.hasAttribute('data-google-analytics-opt-out') ||
        id && uR['ga-disable-' + id] === true
    ) { return true; }
    try {
        const c = uR.external;
        if ( c && c._gaUserPrefs && c._gaUserPrefs === 'oo' ) { return true; }
    } catch(ex) {
    }
    return sR.getElementById('__gaOptOutExtension') ? true : false;
};

const PAGE = '<!doctype html><html><head>' +
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-KQ9NC85WD9">' +
    '</scr' + 'ipt>' +
    '<script>window.dataLayer=window.dataLayer||[];function gtag(){' +
    'dataLayer.push(arguments)}gtag("js",new Date);' +
    'gtag("config","G-KQ9NC85WD9");gtag("config","AW-12345678");</scr' + 'ipt>' +
    '</head><body><p id="content">x</p></body></html>';

const boot = (html = PAGE, before_ = undefined) => {
    const dom = runDom(optout, URL, html, before_);
    return dom.window;
};

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(line); };
    return out;
};

/******************************************************************************/

describe('ga-optout', ( ) => {
    it('ships as one resource, in the format uBO parses', ( ) => {
        assert.equal(typeof optout, 'string');
        for ( const line of optout.split('\n') ) {
            assert.notEqual(line.trim(), '');
            assert.equal(line.startsWith('#'), false);
        }
        assert.equal(/[^\x20-\x7e\t\n]/.test(optout), false);
    });

    it('answers their own check, with an id and without one', ( ) => {
        const w = boot();
        // The question their send pipeline asks, per destination and with no
        // destination at all.
        assert.equal(theirCheck(w, 'G-KQ9NC85WD9'), true);
        assert.equal(theirCheck(w, 'G-NEVERSEEN1'), true);
        assert.equal(theirCheck(w, undefined), true);
    });

    it('sets the two switches that need no id', ( ) => {
        const w = boot();
        assert.equal(typeof w._gaUserPrefs.ioo, 'function');
        assert.equal(w._gaUserPrefs.ioo(), true);
        assert.equal(
            w.document.documentElement.hasAttribute(
                'data-google-analytics-opt-out'),
            true
        );
    });

    it('keeps what a page had already put on their prefs object', ( ) => {
        const w = boot(PAGE, w_ => {
            w_.eval('window._gaUserPrefs = { mine: 1, ioo: function(){' +
                ' return false; } };');
        });
        assert.equal(w._gaUserPrefs.mine, 1);
        assert.equal(w._gaUserPrefs.ioo(), true);
    });

    it('finds the ids on the page, in a url and in a snippet', ( ) => {
        let out;
        const w = boot(PAGE, w_ => { out = lines(w_); });
        assert.equal(w['ga-disable-G-KQ9NC85WD9'], true);
        assert.equal(w['ga-disable-AW-12345678'], true);
        assert.ok(out[0].includes('ids=G-KQ9NC85WD9,AW-12345678'), out[0]);
    });

    it('takes ids off a first-party loader too', ( ) => {
        // The case this resource exists for: no third-party url to match.
        const html = '<!doctype html><html><head>' +
            '<script src="/metrics/gtag/js?id=G-FIRSTPARTY1"></scr' + 'ipt>' +
            '<script src="https://sgtm.example.com/gtm.js?id=GTM-ABC1234">' +
            '</scr' + 'ipt>' +
            '</head><body><p>x</p></body></html>';
        const w = boot(html);
        assert.equal(w['ga-disable-G-FIRSTPARTY1'], true);
        assert.equal(w['ga-disable-GTM-ABC1234'], true);
    });

    it('does not invent a flag out of something that is not an id', ( ) => {
        const html = '<!doctype html><html><head>' +
            '<script>var notAnId = "G-"; var other = "SOMETHING-ELSE";' +
            ' var cls = "grid-3";</scr' + 'ipt>' +
            '</head><body><p>x</p></body></html>';
        let out;
        const w = boot(html, w_ => { out = lines(w_); });
        assert.equal(w['ga-disable-G-'], undefined);
        assert.equal(w['ga-disable-SOMETHING-ELSE'], undefined);
        assert.ok(out[0].includes(' ids=none'), out[0]);
        // And the id-independent switches are set regardless, which is what
        // makes the check answer for a destination that was never named.
        assert.equal(theirCheck(w, 'G-LATEONE123'), true);
    });

    it('does not take a malformed id out of a url', ( ) => {
        // The inline pattern needs a character after the dash, so a prefix on
        // its own can only arrive this way - and a flag named after it would
        // disable nothing while looking like it had.
        const html = '<!doctype html><html><head>' +
            '<script src="https://www.googletagmanager.com/gtag/js?id=G-">' +
            '</scr' + 'ipt>' +
            '<script src="https://www.googletagmanager.com/gtag/js?id=G-bad%20id">' +
            '</scr' + 'ipt>' +
            '<script src="https://www.googletagmanager.com/gtag/js?id=AW-ok12345">' +
            '</scr' + 'ipt>' +
            '</head><body><p>x</p></body></html>';
        let out;
        const w = boot(html, w_ => { out = lines(w_); });
        assert.equal(w['ga-disable-G-'], undefined);
        assert.equal(w['ga-disable-G-bad id'], undefined);
        assert.equal(w['ga-disable-AW-ok12345'], true);
        assert.ok(out[0].includes(' ids=AW-ok12345'), out[0]);
    });

    it('picks up an id that only appears once the page has parsed',
    async ( ) => {
        const dom = new JSDOM('<!doctype html><html><head></head><body>' +
            '</body></html>', { runScripts: 'outside-only', url: URL });
        const w = dom.window;
        assert.equal(w.document.readyState, 'loading');
        const out = lines(w);
        w.eval(optout);
        assert.ok(out[0].includes(' ids=none'), out[0]);
        w.document.body.insertAdjacentHTML('beforeend',
            '<script src="https://www.googletagmanager.com/gtag/js?id=G-LATER00001">' +
            '</scr' + 'ipt>');
        await settle(50);
        assert.equal(w['ga-disable-G-LATER00001'], true);
        assert.ok(out.some(l => l.includes('ids=G-LATER00001')),
            out.join(' | '));
    });

    it('leaves the three switches it decided against alone', ( ) => {
        const w = boot();
        // A cookie to announce a refusal to send, an element their add-on
        // leaves behind that any script can see, and a property no content
        // script can set.
        assert.equal(w.document.cookie, '');
        assert.equal(w.document.getElementById('__gaOptOutExtension'), null);
        assert.equal(w._gaUserPrefs.oo, undefined);
    });

    it('replaces nothing and stubs nothing', ( ) => {
        const w = boot();
        // This resource is not a stand-in: a real bundle is expected to load
        // and to disable itself.
        assert.equal(w.google_tag_manager, undefined);
        assert.equal(w.google_tag_data, undefined);
        assert.equal(typeof w.gtag, 'undefined');
    });

    it('does nothing the second time it is injected', ( ) => {
        const w = boot();
        const prefs = w._gaUserPrefs;
        let out;
        out = lines(w);
        w.eval(optout);
        assert.equal(w._gaUserPrefs, prefs);
        assert.deepEqual(out, []);
    });

    it('says on the console what it did', ( ) => {
        let out;
        boot(PAGE, w_ => { out = lines(w_); });
        assert.equal(out.length, 1);
        assert.equal(
            out[0],
            '[gtm-rr] ga-optout ' + versions.ga +
            ' ioo=set attribute=set ids=G-KQ9NC85WD9,AW-12345678'
        );
    });
});

/******************************************************************************/

describe('filters, ga', ( ) => {
    it('offers it as a scriptlet, because it replaces nothing', ( ) => {
        assert.match(filtersText, /example\.com##\+js\(ga-optout\)/);
        // A scriptlet token takes no .js, and this one is never a redirect:
        // it has to run alongside a real bundle.
        assert.equal(filtersText.includes('+js(ga-optout.js)'), false);
        assert.equal(/redirect=ga-optout/.test(filtersText), false);
    });

    it('leaves applying it everywhere as a decision', ( ) => {
        assert.match(filtersText, /Applying it everywhere is a decision/);
    });
});
