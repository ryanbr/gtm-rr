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

// What uBO does with a user resource used as a scriptlet, from its own
// lookupScriptlet/patchScriptlet (scriptlet-filtering-core.js):
//
//   const match = /^function\s+([^(\s]+)\s*\(/.exec(details.js);
//   const fname = match && match[1];
//   if ( fname ) { content = fname + '({{args}});' }
//   else { for (...) content = content.replace('{{'+(i+1)+'}}', arglist[i]) }
//   content.replace('{{args}}', JSON.stringify(arglist).slice(1,-1)...)
//
// and the resource itself is injected too, so its own trailing call runs
// first, with no arguments. Both branches are here because which one uBO
// takes depends on how the resource starts - and a helper that guesses that
// wrong tests a contract uBO does not use. This one did, and every argument
// test in this file passed against a resource that does nothing in a
// browser.
const asScriptlet = (...args) => {
    const match = /^function\s+([^(\s]+)\s*\(/.exec(tag);
    if ( match === null ) {
        let out = tag;
        for ( let i = 0; i < args.length; i += 1 ) {
            out = out.replace('{{' + (i + 1) + '}}', args[i]);
        }
        return out;
    }
    return tag + '\n' + match[1] +
        '(' + JSON.stringify(args).slice(1, -1) + ');';
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
    it('is delivered the way uBO delivers it', ( ) => {
        // The contract this resource lives or dies by: uBO reads the name off
        // the front of the resource and CALLS it with the filter's arguments.
        // A resource that instead expects {{1}} to have been substituted sees
        // the placeholder as literal text and does nothing, silently.
        const match = /^function\s+([^(\s]+)\s*\(/.exec(tag);
        assert.notEqual(match, null, 'uBO finds no function name here');
        assert.equal(match[1], 'consentRRGtmTag');
        assert.equal(/\{\{\d+\}\}/.test(tag), false,
            'a placeholder left in a resource uBO calls is dead text');
    });

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
        // not throw, and the real one is assigned inside their map
        // controller, petzl.controllers.map, when the page constructs it -
        // after the document has parsed. A Maps loader answered by the empty
        // one draws nothing, and says nothing either.
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        assert.equal(w.document.readyState, 'loading');
        w.eval('window.initGmaps = window.initGmaps || function() { };');
        w.eval(asScriptlet(MAPS, 'initGmaps'));
        assert.deepEqual(injected(w), [],
            'the name is there, but it holds the placeholder');
        await settle(120);
        assert.deepEqual(injected(w), [],
            'still only the placeholder, parsed or not');
        w.eval('window.initGmaps = function(){ window.mapped = true; };');
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
        assert.ok(out.some(l => l.includes(' waited=initGmaps')),
            out.join(' | '));
        w.initGmaps();
        assert.equal(w.mapped, true, 'the one it waited for is the real one');
    });

    it('holds a real callback until the document has parsed', async ( ) => {
        // Their own tags fire at the end of a page's life - the one this
        // stands in for fires on a consent event, later still - and a page
        // that has not finished parsing has not run the code the tag is for.
        const dom = page();
        const w = dom.window;
        lines(w);
        assert.equal(w.document.readyState, 'loading');
        w.eval('window.initGmaps = function(){ window.mapped = true; };');
        w.eval(asScriptlet(MAPS, 'initGmaps'));
        assert.deepEqual(injected(w), [],
            'a real callback, but the page is still parsing');
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
    });

    it('looks after the page\'s own ready handlers have run', async ( ) => {
        // A scriptlet runs at document_start, so its DOMContentLoaded listener
        // is registered before any the page adds and fires before them.
        // petzl.com assigns the real initGmaps from a jQuery ready handler -
        //   $(document).ready(function(){ new petzl.controllers.DealerLocator; });
        // - so looking in our own listener finds the placeholder. This has to
        // load the tag without falling back on the 50ms retry.
        const dom = page();
        const w = dom.window;
        lines(w);
        assert.equal(w.document.readyState, 'loading');
        w.eval('window.initGmaps = window.initGmaps || function() { };');
        w.eval(asScriptlet(MAPS, 'initGmaps'));
        // Registered after the scriptlet's, the way the page's own is.
        w.eval('document.addEventListener("DOMContentLoaded", function(){' +
            ' window.initGmaps = function(){ window.mapped = true; }; });');
        await settle(10);
        assert.deepEqual(injected(w), [ MAPS ], 'without waiting for a retry');
        w.initGmaps();
        assert.equal(w.mapped, true);
    });

    it('takes the placeholder in the end rather than nothing', async ( ) => {
        // A page that never replaces it still gets the loader, because its
        // own code guards on the global the loader creates: petzl's
        // onSearchDealer opens with if (!window.google) return;, so a search
        // the page makes later works even though the callback was spent.
        const dom = page();
        const w = dom.window;
        try {
            const out = lines(w);
            const real = w.setTimeout;
            w.setTimeout = (fn, ms) =>
                real.call(w, fn, ms >= 50 && ms <= 500 ? 1 : ms);
            w.eval('window.initGmaps = function() { };');
            w.eval(asScriptlet(MAPS, 'initGmaps'));
            await settle(500);
            assert.deepEqual(injected(w), [ MAPS ]);
            assert.ok(out.some(l => l.includes(' waited-out=initGmaps')),
                out.join(' | '));
        } finally {
            w.close();
        }
    });

    it('an arrow placeholder is a placeholder too', async ( ) => {
        const dom = page();
        const w = dom.window;
        try {
            lines(w);
            w.eval('window.initGmaps = ( ) => {};');
            w.eval(asScriptlet(MAPS, 'initGmaps'));
            await settle(150);
            assert.deepEqual(injected(w), [], 'empty body, whatever the form');
        } finally {
            w.close();
        }
    });

    it('gives up rather than waiting for ever', async ( ) => {
        const dom = page();
        const w = dom.window;
        try {
            const out = lines(w);
            const real = w.setTimeout;
            // Run its clock fast: 50ms steps for the first second, 500ms
            // after that, up to ten seconds.
            w.setTimeout = (fn, ms) =>
                real.call(w, fn, ms >= 50 && ms <= 500 ? 1 : ms);
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

    it('backs off instead of waking 200 times', async ( ) => {
        const dom = page();
        const w = dom.window;
        try {
            const out = lines(w);
            const real = w.setTimeout;
            const steps = [];
            w.setTimeout = (fn, ms) => {
                if ( ms >= 50 ) { steps.push(ms); ms = 1; }
                return real.call(w, fn, ms);
            };
            w.eval(asScriptlet(MAPS, 'neverDefined'));
            await settle(600);
            assert.ok(out.some(l => l.includes(' gave-up=neverDefined')),
                out.join(' | '));
            // 50ms for the first second, where a callback assigned from a
            // ready handler turns up, then 500ms: 20 + 17 wakeups to reach
            // ten seconds, against 200 at a flat 50ms.
            assert.deepEqual(steps.slice(0, 20), new Array(20).fill(50));
            assert.deepEqual(steps.slice(20), new Array(17).fill(500));
            assert.equal(steps.length, 37);
        } finally {
            w.close();
        }
    });

    // A tag whose script writes into the page, which GTM handles with
    // vtp_usePostscribe. jsdom will not fetch and run the injected script, so
    // the browser's side of the contract is played here: currentScript is the
    // injected script while it runs, and load fires when it is done.
    const running = (w, script) => {
        Object.defineProperty(w.document, 'currentScript', {
            value: script,
            configurable: true,
        });
    };
    const finished = (w, script) => {
        Object.defineProperty(w.document, 'currentScript', {
            value: null,
            configurable: true,
        });
        script.dispatchEvent(new w.Event('load'));
    };
    const theScript = w => w.document.querySelector('script[src^="https://maps"]');

    it('puts what the script writes where the script is', async ( ) => {
        const dom = page('<!doctype html><html><head></head><body>' +
            '<div id="slot"></div></body></html>');
        const w = dom.window;
        const out = lines(w);
        w.eval(asScriptlet(MAPS));
        const script = theScript(w);
        assert.notEqual(script, null);
        running(w, script);
        w.document.write('<b id="written">x</b>');
        w.document.writeln('<i id="also">y</i>');
        finished(w, script);
        await settle(20);
        assert.notEqual(w.document.getElementById('written'), null);
        assert.notEqual(w.document.getElementById('also'), null);
        // Where the script is, not at the end of the document.
        assert.equal(script.nextSibling.id, 'written');
        assert.ok(out.some(l => l.includes(' wrote=')), out.join(' | '));
    });

    it('runs a script that was written, in order', async ( ) => {
        // This one needs a document that runs what is put into it: the rest
        // of this file uses outside-only, where an inserted script never
        // executes and the assertion would pass for the wrong reason.
        const dom = new JSDOM(
            '<!doctype html><html><head></head><body><p id="x"></p></body></html>',
            { runScripts: 'dangerously', url: URL }
        );
        const w = dom.window;
        lines(w);
        w.eval('window.order = [];');
        w.eval(asScriptlet(MAPS));
        const script = theScript(w);
        running(w, script);
        w.document.write('<scr' + 'ipt>window.order.push("one");</scr' + 'ipt>' +
            '<scr' + 'ipt>window.order.push("two");</scr' + 'ipt>');
        finished(w, script);
        await settle(20);
        // A script out of innerHTML never runs: each one is rebuilt.
        assert.deepEqual(Array.from(w.order), [ 'one', 'two' ]);
    });

    it('leaves a write by anything else alone', async ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        // Stood in BEFORE the resource, so the shim wraps this rather than
        // the other way round. Replacing document.write afterwards would
        // bypass the shim entirely and the assertion would pass for nothing
        // - which is how this test first passed while the check it is for
        // was removable.
        w.eval('window.realWrites = 0;' +
            'document.write = function(){ window.realWrites += 1; };');
        w.eval(asScriptlet(MAPS));
        const script = theScript(w);
        // currentScript is somebody else's: the page is writing, and that is
        // the real document.write's business.
        running(w, w.document.createElement('script'));
        w.eval('document.write("<b>not ours</b>");');
        assert.equal(w.realWrites, 1, 'passed through');
        finished(w, script);
        await settle(20);
        assert.equal(out.filter(l => l.includes(' wrote=')).length, 0,
            out.join(' | '));
    });

    it('gives document.write back when the script is done', async ( ) => {
        const dom = page();
        const w = dom.window;
        lines(w);
        const before = w.document.write;
        w.eval(asScriptlet(MAPS));
        const script = theScript(w);
        assert.notEqual(w.document.write, before, 'shimmed while it runs');
        finished(w, script);
        await settle(20);
        assert.equal(w.document.write, before, 'and given back after');
    });

    // OneTrust's loader carries its tenant on the element, and so do the
    // tags petzl.com and globalblue.com gate their content on.
    const OT = 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js';
    const TENANT = 'bb3af1ef-b16c-41df-8541-c0ffeec0ffee';

    it('puts an attribute a filter asks for on the element', ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        w.eval(asScriptlet(OT, 'attr:data-domain-script=' + TENANT));
        const script = w.document.querySelector('script[src="' + OT + '"]');
        assert.notEqual(script, null);
        assert.equal(script.getAttribute('data-domain-script'), TENANT);
        // On the element, not on the url.
        assert.equal(script.src, OT);
        assert.ok(out[0].includes(' with=data-domain-script'), out[0]);
    });

    it('takes more than one attribute', ( ) => {
        const dom = page();
        const w = dom.window;
        lines(w);
        w.eval(asScriptlet(OT,
            'attr:data-domain-script=' + TENANT,
            'attr:data-document-language=true',
            'attr:charset=UTF-8'));
        const script = w.document.querySelector('script[src="' + OT + '"]');
        assert.equal(script.getAttribute('data-domain-script'), TENANT);
        assert.equal(script.getAttribute('data-document-language'), 'true');
        assert.equal(script.getAttribute('charset'), 'UTF-8');
    });

    it('takes its arguments named, in any order', async ( ) => {
        const dom = page();
        const w = dom.window;
        lines(w);
        w.eval("window.dataLayer = [{ PageType: 'Shop' }];" +
            'window.initGmaps = function(){ window.mapped = true; };');
        w.eval(asScriptlet('when=PageType=Shop', 'url=' + MAPS,
            'needs=initGmaps'));
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
    });

    it('ignores an attr: with nothing to set', ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        w.eval(asScriptlet(MAPS, 'attr:', 'attr:no-equals'));
        assert.deepEqual(injected(w), [ MAPS ]);
        assert.equal(out[0].includes(' with='), false, out[0]);
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

    // petzl.com's own push, which is what their container's trigger reads:
    //   {'PageName':'Web_DealerLocator','PageType':'DealerLocator', ...}
    // ... followed by the pushes any page makes after it, which do not carry
    // the key: a container pushes gtm.js, gtm.dom and gtm.load of its own.
    const PUSH = "window.dataLayer = window.dataLayer || []; " +
        "window.dataLayer.push({'PageName':'Web_DealerLocator'," +
        "'PageType':'DealerLocator','Template':'Desktop'}); " +
        "window.dataLayer.push({'event':'gtm.dom'}); " +
        "window.dataLayer.push({'event':'gtm.load'});";

    it('loads only where the container\'s trigger matches', async ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        w.eval(PUSH);
        w.eval(asScriptlet(MAPS, '', 'PageType=DealerLocator'));
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
        assert.ok(out[0].includes(' when=PageType=DealerLocator'), out[0]);
    });

    it('stays off a page the trigger excludes', async ( ) => {
        // The reason this exists: a scriptlet filter cannot be scoped to a
        // path, so without the trigger this would load the tag on every page
        // of the site.
        const dom = page();
        const w = dom.window;
        try {
            const out = lines(w);
            const real = w.setTimeout;
            w.setTimeout = (fn, ms) =>
                real.call(w, fn, ms >= 50 && ms <= 500 ? 1 : ms);
            w.eval("window.dataLayer = [{'PageType':'Home'}];");
            w.eval(asScriptlet(MAPS, '', 'PageType=DealerLocator'));
            await settle(500);
            assert.deepEqual(injected(w), []);
            assert.ok(out.some(l => l.includes(' gave-up=PageType=DealerLocator')),
                out.join(' | '));
        } finally {
            w.close();
        }
    });

    it('waits for the push the trigger reads', async ( ) => {
        const dom = page();
        const w = dom.window;
        lines(w);
        w.eval(asScriptlet(MAPS, '', 'PageType=DealerLocator'));
        await settle(120);
        assert.deepEqual(injected(w), [], 'no data layer yet');
        w.eval(PUSH);
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
    });

    it('reads the last write, and a dotted key', async ( ) => {
        const dom = page();
        const w = dom.window;
        lines(w);
        w.eval("window.dataLayer = [{'page':{'type':'Home'}}," +
            "{'page':{'type':'DealerLocator'}},{'event':'gtm.load'}];");
        w.eval(asScriptlet(MAPS, '', 'page.type=DealerLocator'));
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
    });

    it('wants both the trigger and the callback', async ( ) => {
        const dom = page();
        const w = dom.window;
        lines(w);
        w.eval('window.initGmaps = window.initGmaps || function() { };');
        w.eval(asScriptlet(MAPS, 'initGmaps', 'PageType=DealerLocator'));
        await settle(120);
        assert.deepEqual(injected(w), [], 'trigger unmatched, callback empty');
        w.eval(PUSH);
        await settle(120);
        assert.deepEqual(injected(w), [], 'trigger matched, callback still empty');
        w.eval('window.initGmaps = function(){ window.mapped = true; };');
        await settle(120);
        assert.deepEqual(injected(w), [ MAPS ]);
    });

    it('refuses a condition that is not Key=value', ( ) => {
        const dom = page();
        const w = dom.window;
        const out = lines(w);
        w.eval(asScriptlet(MAPS, '', 'PageType'));
        assert.deepEqual(injected(w), []);
        assert.ok(out.some(l => l.includes(' refused=condition')),
            out.join(' | '));
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

/******************************************************************************/

// shop.moen.com/pages/faucet-finder-quiz: the page carries the mount,
// <div id="zoovu-assistant">, and GTM-5M3PDQZ8 carries the launcher behind
//   _eq macro 56 /pages/faucet-finder-quiz
//   macro 56: {"function":"__u","vtp_component":"PATH"}
// A data layer condition cannot say that, and a scriptlet filter cannot be
// scoped to a path, so without this the line loads a vendor meant for one
// page on every page of a shop.
const QUIZ = 'https://api-barracuda.zoovu.com/api/v1/launchers/mznpQl/x';
const SHOP = 'https://shop.moen.com/pages/faucet-finder-quiz';

describe('gtm-tag, a trigger on the path', ( ) => {
    const at = url => page(undefined, url);

    it('loads it on the page the container held it for', async ( ) => {
        const w = at(SHOP).window;
        w.eval(asScriptlet(QUIZ, 'path=/pages/faucet-finder-quiz'));
        await settle(120);
        assert.deepEqual(injected(w), [ QUIZ ]);
    });

    it('loads it nowhere else, and says which page it wanted', async ( ) => {
        const w = at('https://shop.moen.com/').window;
        const out = lines(w);
        w.eval(asScriptlet(QUIZ, 'path=/pages/faucet-finder-quiz'));
        await settle(120);
        assert.deepEqual(injected(w), []);
        assert.ok(
            out.some(l => l.includes('skipped=path want=/pages/faucet-finder-quiz')),
            out.join(' | ')
        );
    });

    it('takes their four shapes of path test', async ( ) => {
        const cases = [
            [ '/pages/faucet-finder-quiz', true, 'their _eq' ],
            [ '/pages/other', false, 'their _eq, elsewhere' ],
            [ '/pages/*', true, 'their _sw' ],
            [ '/products/*', false, 'their _sw, elsewhere' ],
            [ '*-quiz', true, 'their _ew' ],
            [ '*-finder', false, 'their _ew, elsewhere' ],
            [ '*finder*', true, 'their _cn' ],
            [ '*basket*', false, 'their _cn, elsewhere' ],
            [ '*', true, 'a wildcard on its own' ],
        ];
        for ( const [ want, hit, why ] of cases ) {
            const w = at(SHOP).window;
            lines(w);
            w.eval(asScriptlet(QUIZ, 'path=' + want));
            await settle(120);
            assert.deepEqual(injected(w), hit ? [ QUIZ ] : [], why + ': ' + want);
        }
    });

    it('matches a path holding a star of its own literally', async ( ) => {
        // Only the ends are wildcards, so this one is compared as text - and
        // the first version of this test asserted the opposite of its own
        // comment, which is what the run said.
        const w = at('https://shop.moen.com/a*b').window;
        w.eval(asScriptlet(QUIZ, 'path=/a*b'));
        await settle(120);
        assert.deepEqual(injected(w), [ QUIZ ], 'a star in the middle is text');
        const other = at('https://shop.moen.com/ab').window;
        other.console.info = ( ) => undefined;
        other.eval(asScriptlet(QUIZ, 'path=/a*b'));
        await settle(120);
        assert.deepEqual(
            injected(other), [],
            'and it is not standing in for anything either'
        );
    });

    it('is read before the url is, so a typo reports the path', async ( ) => {
        // Both are wrong here. The useful line is the one naming the page,
        // since a tag for another page is not a tag with a broken url.
        const w = at('https://shop.moen.com/').window;
        const out = lines(w);
        w.eval(asScriptlet('not-a-url', 'path=/pages/faucet-finder-quiz'));
        await settle(120);
        assert.ok(out.some(l => l.includes('skipped=path')), out.join(' | '));
        assert.ok(
            out.every(l => l.includes('refused=') === false),
            'and nothing about the url: ' + out.join(' | ')
        );
    });
});
