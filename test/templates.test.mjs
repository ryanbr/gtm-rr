/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { filtersText, loadResources, settle, versions } from './helpers.mjs';

const URL = 'https://shonenjumpplus.com/';
const SEL = 'template.js-browser-html-setting';

let gtm;

before(async ( ) => {
    gtm = (await loadResources()).get('googletagmanager_gtm.js');
});

// uBO injects the resource and appends one call per filter, with that
// filter's arguments - see test/tag.test.mjs for the branch it takes. The
// resource's own call, which stands in for the container, is inside it.
const withArgs = (...args) => {
    const match = /^function\s+([^(\s]+)\s*\(/.exec(gtm);
    assert.notEqual(match, null);
    return gtm + '\n' + match[1] +
        '(' + JSON.stringify(args).slice(1, -1) + ');';
};

// shonenjumpplus.com's shape: empty containers, and the script that fills
// them sitting inert in a template beside them.
const SHAPE = '<div class="top-banner">' +
    '<div class="html-setting-top-banner">' +
    '<div class="slide-item"></div><div class="slide-item"></div>' +
    '</div>' +
    '<template class="js-browser-html-setting"><scr' + 'ipt>' +
    'var items = document.querySelectorAll(".html-setting-top-banner > div");' +
    'items[0].innerHTML = "<a href=\\"/one\\">one</a>";' +
    'items[1].innerHTML = "<a href=\\"/two\\">two</a>";' +
    'window.bannerEvents = (window.bannerEvents || 0) + 1;' +
    '</scr' + 'ipt></template>' +
    '</div>';

const page = (body, url = URL) => new JSDOM(
    '<!doctype html><html><head></head><body>' + body + '</body></html>',
    { runScripts: 'dangerously', url, virtualConsole: new VirtualConsole() }
);

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(String(line)); };
    return out;
};

const filled = w => Array.from(
    w.document.querySelectorAll('.html-setting-top-banner > div')
).filter(d => d.innerHTML.trim() !== '').length;

const said = (out, what) => out.filter(l => l.includes(what));

// Run its clock fast: 50ms steps for the first second, 500ms after that, up
// to ten seconds. A window that is left polling has to be closed, or
// node --test waits for it.
const fast = w => {
    const real = w.setTimeout;
    w.setTimeout = (fn, ms) => real.call(w, fn, ms >= 50 && ms <= 500 ? 1 : ms);
};

/******************************************************************************/

describe('googletagmanager_gtm, the page\'s own templates', ( ) => {
    it('is the function uBO names and calls', ( ) => {
        // The arguments only arrive if this is the FIRST function declaration
        // in the resource. uBO reads the name off the front of the file.
        const match = /^function\s+([^(\s]+)\s*\(/.exec(gtm);
        assert.notEqual(match, null, 'uBO finds no function name here');
        assert.equal(match[1], 'consentRRGtm');
        assert.equal(/\{\{\d+\}\}/.test(gtm), false);
    });

    it('runs the scripts the page left inert, and nothing else', async ( ) => {
        const dom = page(SHAPE);
        const w = dom.window;
        const out = lines(w);
        assert.equal(filled(w), 0, 'inert to begin with');
        w.eval(withArgs(SEL));
        await settle(60);
        assert.equal(filled(w), 2, 'the page filled its own slides');
        assert.equal(w.bannerEvents, 1);
        assert.ok(said(out, ' ran=1 templates=1').length === 1, out.join(' | '));
        // Only the scripts were taken: the template stays where it was and
        // none of its markup is duplicated into the page.
        assert.equal(w.document.querySelectorAll('template').length, 1);
        assert.equal(w.document.querySelectorAll('.top-banner > div').length, 1);
    });

    it('runs each template once, however often it is called', async ( ) => {
        const dom = page(SHAPE);
        const w = dom.window;
        lines(w);
        w.eval(withArgs(SEL));
        w.eval(withArgs(SEL));
        await settle(60);
        w.eval(withArgs(SEL));
        await settle(120);
        assert.equal(w.bannerEvents, 1, 'the page script ran once');
    });

    it('leaves a script the page marked as not JavaScript', async ( ) => {
        const body = '<template class="js-browser-html-setting">' +
            '<scr' + 'ipt type="text/gtmscript">window.wrong = true;</scr' +
            'ipt></template>';
        const dom = page(body);
        const w = dom.window;
        const out = lines(w);
        w.eval(withArgs(SEL));
        await settle(60);
        assert.equal(w.wrong, undefined, 'text/gtmscript is theirs to run');
        assert.ok(said(out, ' ran=0 templates=1 left=1').length !== 0,
            out.join(' | '));
    });

    it('waits for a global the scripts need', async ( ) => {
        const body = '<template class="js-browser-html-setting"><scr' + 'ipt>' +
            'window.usedJq = typeof jQuery;</scr' + 'ipt></template>';
        const dom = page(body);
        const w = dom.window;
        lines(w);
        w.eval(withArgs(SEL, 'jQuery'));
        await settle(120);
        assert.equal(w.usedJq, undefined, 'nothing ran without it');
        // It arrives late, as a library loaded async does.
        w.eval('window.jQuery = function(){};');
        await settle(120);
        assert.equal(w.usedJq, 'function');
    });

    it('waits for a template added after the page is parsed', async ( ) => {
        const dom = page('<div class="html-setting-top-banner">' +
            '<div class="slide-item"></div><div class="slide-item"></div></div>');
        const w = dom.window;
        lines(w);
        w.eval(withArgs(SEL));
        await settle(120);
        assert.equal(filled(w), 0);
        w.document.body.insertAdjacentHTML('beforeend',
            '<template class="js-browser-html-setting"><scr' + 'ipt>' +
            'document.querySelectorAll(".html-setting-top-banner > div")' +
            '[0].innerHTML = "late";</scr' + 'ipt></template>');
        await settle(120);
        assert.equal(filled(w), 1);
    });

    it('says so when the selector matches no template', async ( ) => {
        const dom = page('<div></div>');
        const w = dom.window;
        try {
            const out = lines(w);
            fast(w);
            w.eval(withArgs(SEL));
            await settle(500);
            assert.ok(said(out, ' none=' + SEL).length !== 0, out.join(' | '));
        } finally {
            w.close();
        }
    });

    it('will not run a script outside a template again', async ( ) => {
        // The selector comes from a filter, so it can name anything. Only a
        // template's inert content is this resource's business: a script the
        // page already ran is not to be run a second time.
        const body = '<div class="js-browser-html-setting"><scr' + 'ipt>' +
            'window.loose = (window.loose || 0) + 1;</scr' + 'ipt></div>';
        const dom = page(body);
        const w = dom.window;
        try {
            const out = lines(w);
            fast(w);
            assert.equal(w.loose, 1, 'the page ran it itself, as pages do');
            w.eval(withArgs('.js-browser-html-setting'));
            await settle(500);
            assert.equal(w.loose, 1, 'and not again');
            assert.ok(said(out, ' none=.js-browser-html-setting').length !== 0,
                out.join(' | '));
        } finally {
            w.close();
        }
    });

    it('does nothing on a page it is not standing in for', async ( ) => {
        // No loader on the page, so no container went missing, so none of
        // this is any of its business.
        const dom = page(SHAPE);
        const w = dom.window;
        lines(w);
        w.eval(gtm);
        await settle(120);
        assert.equal(filled(w), 0);
        assert.equal(w.bannerEvents, undefined);
    });

    it('stands in for the container once, not twice', async ( ) => {
        // The resource is injected and then called again by uBO for each
        // filter. Only its own call installs, so one delivery says one line.
        const body = '<script src="https://www.googletagmanager.com/gtm.js' +
            '?id=GTM-MQT32T2"></scr' + 'ipt>' + SHAPE;
        const dom = page(body);
        const w = dom.window;
        const out = lines(w);
        w.eval(gtm);
        await settle(30);
        const installs = said(out, 'container=');
        assert.equal(installs.length, 1, out.join(' | '));
        assert.ok(installs[0].includes('id=GTM-MQT32T2'), installs[0]);
        // uBO's own call for a no-argument filter adds nothing.
        w.eval('consentRRGtm();');
        await settle(30);
        assert.equal(said(out, 'container=').length, 1, out.join(' | '));
    });

    it('says on the console what it did', async ( ) => {
        const dom = page(SHAPE);
        const w = dom.window;
        const out = lines(w);
        w.eval(withArgs(SEL));
        await settle(60);
        assert.equal(
            said(out, ' ran=')[0],
            '[gtm-rr] googletagmanager_gtm ' + versions.gtm +
            ' ran=1 templates=1 from=' + SEL
        );
    });
});

/******************************************************************************/

// A page it stood in for, with no filter naming anything: the deferred code a
// container used to run is the work that went missing, so it runs it.
describe('googletagmanager_gtm, templates with no filter at all', ( ) => {
    const LOADER = '<script src="https://www.googletagmanager.com/gtm.js' +
        '?id=GTM-MQT32T2"></scr' + 'ipt>';

    const stood = async body => {
        const dom = page(LOADER + body);
        const w = dom.window;
        const out = lines(w);
        w.eval(gtm);
        await settle(120);
        return [ w, out ];
    };

    it('runs the deferred code a page kept for itself', async ( ) => {
        const [ w, out ] = await stood(SHAPE);
        assert.equal(filled(w), 2);
        assert.equal(w.bannerEvents, 1);
        assert.ok(said(out, ' ran=1 templates=1 from=page').length === 1,
            out.join(' | '));
    });

    it('holds back a template carrying markup', async ( ) => {
        // Markup in a template is a payload someone clones when they are
        // ready, not work that went missing.
        const body = '<template><div class="row"></div><scr' + 'ipt>' +
            'window.ranMarkup = true;</scr' + 'ipt></template>';
        const [ w, out ] = await stood(body);
        assert.equal(w.ranMarkup, undefined);
        assert.equal(said(out, 'from=page').length, 0, out.join(' | '));
    });

    it('holds back a template that would load a third party', async ( ) => {
        for ( const inner of [
            // the shape of a consent-gated embed
            '<scr' + 'ipt src="https://third.example/embed.js"></scr' + 'ipt>',
            '<scr' + 'ipt>var s = document.createElement("script");' +
                's.src = "https://third.example/x.js";' +
                'document.head.appendChild(s); window.ranLoader = true;' +
                '</scr' + 'ipt>',
            '<scr' + 'ipt>document.write(' +
                '"<iframe src=\'https://third.example/f\'></iframe>");' +
                'window.ranWrite = true;</scr' + 'ipt>',
        ] ) {
            const [ w, out ] = await stood('<template>' + inner + '</template>');
            assert.equal(w.ranLoader, undefined, inner);
            assert.equal(w.ranWrite, undefined, inner);
            assert.equal(said(out, 'from=page').length, 0, out.join(' | '));
            assert.equal(
                w.document.querySelectorAll(
                    'script[src="https://third.example/embed.js"]'
                ).length,
                0,
                inner
            );
        }
    });

    it('leaves it to a container that answered for itself', async ( ) => {
        // container=kept: the page's own container loaded, so nothing of its
        // writing into the page went missing.
        const dom = page(LOADER + SHAPE);
        const w = dom.window;
        const out = lines(w);
        w.eval('window.google_tag_manager = { "GTM-MQT32T2": { theirs: 1 } };');
        w.eval(gtm);
        await settle(120);
        assert.ok(said(out, ' container=kept').length !== 0, out.join(' | '));
        assert.equal(filled(w), 0);
        assert.equal(said(out, 'from=page').length, 0, out.join(' | '));
    });

    it('runs each template once across both ways in', async ( ) => {
        const dom = page(LOADER + SHAPE);
        const w = dom.window;
        lines(w);
        w.eval(withArgs(SEL));
        await settle(200);
        assert.equal(w.bannerEvents, 1, 'the filter and the page agree on one');
    });
});

/******************************************************************************/

describe('filters, templates', ( ) => {
    it('is offered with the selector in the filter', ( ) => {
        assert.match(filtersText, /\+js\(googletagmanager_gtm, *template/);
    });
});

/******************************************************************************/

// A page that waits to be told the work is done, where the telling was a
// container's job and the name of the telling is the page's own.
// hokkaido-np.co.jp: an overlay with 読み込み中... and
//   window.addEventListener('aiRecommendGenerated', () => {
//       spinnerOverlay.style.display = 'none'; ... })
// where what fires it is three vendors deep inside their container.
describe('googletagmanager_gtm, telling a page the wait is over', ( ) => {
    const SPINNER = '<div class="ai-recommend-spinner-overlay">' +
        '<p>読み込み中...</p></div>' +
        '<div class="section_wrap" style="height:220px"></div>' +
        '<scr' + 'ipt>window.addEventListener("aiRecommendGenerated",' +
        ' function(){ document.querySelector(".ai-recommend-spinner-overlay")' +
        '.style.display = "none";' +
        ' document.querySelector(".section_wrap").style.height = "100%"; });' +
        '</scr' + 'ipt>';

    const spinning = w => {
        const overlay = w.document.querySelector('.ai-recommend-spinner-overlay');
        return overlay !== null && overlay.style.display !== 'none';
    };

    it('ends a wait a filter names, at the document so both hear it',
    async ( ) => {
        const dom = page(SPINNER);
        const w = dom.window;
        const out = lines(w);
        assert.equal(spinning(w), true, 'spinning to begin with');
        w.eval(withArgs('event=aiRecommendGenerated'));
        await settle(120);
        assert.equal(spinning(w), false);
        assert.equal(w.document.querySelector('.section_wrap').style.height,
            '100%');
        assert.ok(said(out, ' told=aiRecommendGenerated').length === 1,
            out.join(' | '));
    });

    it('is heard by a listener on the document too', async ( ) => {
        const dom = page('<div id="x"></div>');
        const w = dom.window;
        lines(w);
        w.eval('window.heard = [];' +
            'document.addEventListener("someEvent", e => {' +
            ' window.heard.push("document:" + (e.detail ? "detail" : "bare")); });' +
            'window.addEventListener("someEvent", () => {' +
            ' window.heard.push("window"); });');
        w.eval(withArgs('event=someEvent'));
        await settle(120);
        assert.deepEqual(Array.from(w.heard), [ 'document:detail', 'window' ]);
    });

    it('says nothing and does nothing unless a filter names one', async ( ) => {
        const dom = page(SPINNER);
        const w = dom.window;
        const out = lines(w);
        w.eval(gtm);
        await settle(120);
        assert.equal(spinning(w), true, 'not this resource to guess');
        assert.equal(said(out, 'told=').length, 0, out.join(' | '));
    });

    it('tells once, however many filters asked', async ( ) => {
        const dom = page('<div id="x"></div>');
        const w = dom.window;
        lines(w);
        w.eval('window.count = 0;' +
            'window.addEventListener("someEvent", () => { window.count += 1; });');
        w.eval(withArgs('event=someEvent'));
        await settle(150);
        assert.equal(w.count, 1);
    });

    it('takes its arguments named, in any order', async ( ) => {
        const dom = page(SHAPE + '<div id="x"></div>');
        const w = dom.window;
        lines(w);
        w.eval('window.count = 0;' +
            'window.addEventListener("someEvent", () => { window.count += 1; });');
        w.eval(withArgs('event=someEvent', 'template=' + SEL));
        await settle(150);
        assert.equal(w.count, 1, 'the event');
        assert.equal(filled(w), 2, 'and the template, from the same call');
    });
});
