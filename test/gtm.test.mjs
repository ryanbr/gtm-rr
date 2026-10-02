/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import {
    fixture, filtersText, loadResources, runDom, settle, versions,
} from './helpers.mjs';

const URL = 'https://www.example.com/';
const ID = 'GTM-KJZD388';

let neutered;

before(async ( ) => {
    neutered = (await loadResources()).get('gtm-neutered.js');
});

const plain = value => JSON.parse(JSON.stringify(value));

// The page as GTM finds it: the snippet has run, so the array exists and
// carries its first push.
const snippet = (id = ID, layer = 'dataLayer') => w => {
    w.eval(
        'window.' + layer + ' = window.' + layer + ' || [];' +
        'window.' + layer + '.push({ "gtm.start": 1770372134000,' +
        ' event: "gtm.js" });'
    );
};

const boot = (options = {}) => {
    const dom = runDom(
        neutered, options.url || URL,
        options.html !== undefined ? options.html : fixture,
        w => {
            if ( typeof options.before === 'function' ) { options.before(w); }
        }
    );
    return dom.window;
};

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(line); };
    return out;
};

/******************************************************************************/

describe('gtm-neutered', ( ) => {
    it('ships as one resource, in the format uBO parses', ( ) => {
        assert.equal(typeof neutered, 'string');
        assert.ok(neutered.length > 0);
        // uBO would end the resource at a blank line and drop these.
        for ( const line of neutered.split('\n') ) {
            assert.notEqual(line.trim(), '');
            assert.equal(line.startsWith('#'), false);
        }
        assert.equal(/[^\x20-\x7e\t\n]/.test(neutered), false);
    });

    it('takes the container id and the data layer off its own tag', ( ) => {
        let out;
        const w = boot({ before: w_ => { out = lines(w_); snippet()(w_); } });
        assert.ok(w.google_tag_manager[ID], Object.keys(w.google_tag_manager));
        assert.ok(out[0].includes(' id=' + ID), out[0]);
        assert.ok(out[0].includes(' layer=dataLayer'), out[0]);
    });

    it('reads a renamed data layer out of the query', ( ) => {
        const html = '<!doctype html><html><head><script src=' +
            '"https://www.googletagmanager.com/gtm.js?id=GTM-NSXXFR&l=ourLayer">' +
            '</scr' + 'ipt></head><body><p>x</p></body></html>';
        const w = boot({
            html,
            before: w_ => { snippet('GTM-NSXXFR', 'ourLayer')(w_); },
        });
        assert.equal(w.google_tag_manager.ourLayer.subscribers, 1);
        assert.equal(w.google_tag_manager.dataLayer, undefined);
        assert.equal(
            w.google_tag_manager['GTM-NSXXFR'].dataLayer.name,
            'ourLayer'
        );
    });

    it('registers the container object theirs registers', ( ) => {
        const w = boot({ before: snippet() });
        const container = w.google_tag_manager[ID];
        // Theirs, from RU(): dataLayer, bootstrap, callback, onHtmlSuccess,
        // onHtmlFailure - and nothing else was in it.
        assert.deepEqual(Object.keys(container).sort(), [
            'bootstrap', 'callback', 'dataLayer', 'onHtmlFailure',
            'onHtmlSuccess',
        ]);
        // Theirs is 0 only until the container has booted - UU().bootstrap =
        // Xb() - so a page watching it for readiness would wait for ever on a
        // stub that left it at 0.
        assert.equal(typeof container.bootstrap, 'number');
        assert.ok(container.bootstrap > 1700000000000, String(container.bootstrap));
        for ( const name of [ 'callback', 'onHtmlSuccess', 'onHtmlFailure' ] ) {
            assert.equal(typeof container[name], 'function', name);
        }
        // Their macro-resolver map, which a tag's output refers to by name.
        assert.deepEqual(plain(w.google_tag_manager.rm), {});
    });

    it('answers their model, including a dotted path', ( ) => {
        const w = boot({ before: snippet() });
        const model = w.google_tag_manager[ID].dataLayer;
        assert.deepEqual(Object.keys(model).sort(),
            [ 'get', 'name', 'reset', 'set' ]);
        model.set('page', { title: 'Home', depth: 2 });
        assert.equal(model.get('page.title'), 'Home');
        assert.equal(model.get('page.depth'), 2);
        model.set('deep.a.b', 'c');
        assert.equal(model.get('deep.a.b'), 'c');
        model.reset();
        assert.equal(model.get('page.title'), undefined);
    });

    it('keeps what the page pushed before it arrived', ( ) => {
        const w = boot({ before: snippet() });
        // The snippet's own push is in the array and in the model.
        assert.equal(w.dataLayer.length, 1);
        assert.equal(w.google_tag_manager[ID].dataLayer.get('event'), 'gtm.js');
        assert.equal(
            w.google_tag_manager[ID].dataLayer.get('gtm.start'),
            1770372134000
        );
    });

    it('keeps the page own array and what push returns', ( ) => {
        const w = boot({ before: snippet() });
        const before_ = w.dataLayer;
        const length = w.dataLayer.push({ event: 'later' });
        // Theirs wraps the push on the array the page already holds, and
        // returns what the array's own push returned.
        assert.equal(w.dataLayer, before_);
        assert.equal(length, w.dataLayer.length);
        assert.equal(w.dataLayer[w.dataLayer.length - 1].event, 'later');
        assert.equal(w.google_tag_manager[ID].dataLayer.get('event'), 'later');
    });

    it('runs an eventCallback, which is what pages wait on', async ( ) => {
        const w = boot({ before: snippet() });
        const calls = [];
        const callback = function( ) {
            // Theirs applies it with the callback itself as this, and no
            // arguments: k.apply(k, [].slice.call(arguments, 0)).
            calls.push([ this === callback, arguments.length ]);
        };
        w.dataLayer.push({ event: 'submit', eventCallback: callback });
        assert.deepEqual(calls, []);
        await settle(10);
        assert.deepEqual(calls, [ [ true, 0 ] ]);
    });

    it('runs it once, however long the eventTimeout', async ( ) => {
        const w = boot({ before: snippet() });
        let calls = 0;
        w.dataLayer.push({
            event: 'submit',
            eventCallback: ( ) => { calls += 1; },
            eventTimeout: 2000,
        });
        await settle(30);
        // An eventTimeout is an upper bound in their own code, not a delay:
        // their Do only sets a timer at all when one was asked for, and the
        // callback runs when the event's tags are done. With no tags that is
        // now, and the timer must not run it a second time.
        assert.equal(calls, 1);
        await settle(60);
        assert.equal(calls, 1);
    });

    it('does not keep the eventCallback in the model', async ( ) => {
        const w = boot({ before: snippet() });
        w.dataLayer.push({
            event: 'x',
            eventCallback: ( ) => {},
            eventTimeout: 10,
        });
        const model = w.google_tag_manager[ID].dataLayer;
        // Checked before their own gtm.dom and gtm.load go in: a later event
        // overwrites event in the model, theirs as much as this one.
        assert.equal(model.get('event'), 'x');
        await settle(20);
        assert.equal(model.get('eventCallback'), undefined);
        assert.equal(model.get('eventTimeout'), undefined);
    });

    it('takes several arguments, and anything that is not an object',
    async ( ) => {
        const w = boot({ before: snippet() });
        let calls = 0;
        const before_ = w.dataLayer.length;
        const length = w.dataLayer.push(
            { event: 'one', eventCallback: ( ) => { calls += 1; } },
            { event: 'two' }
        );
        assert.equal(length, w.dataLayer.length);
        assert.equal(w.dataLayer.length, before_ + 2);
        // The last of them is what the model ends on.
        assert.equal(w.google_tag_manager[ID].dataLayer.get('event'), 'two');
        await settle(10);
        assert.equal(calls, 1);
        // gtag pushes an arguments object, and a page can push a string or
        // nothing at all - none of which may throw.
        const grown = w.dataLayer.length;
        w.eval('window.dataLayer.push(function(){ return arguments; }' +
            '("consent", "default", {}));');
        w.dataLayer.push('string');
        w.dataLayer.push(null);
        assert.equal(w.dataLayer.length, grown + 3);
    });

    it('pushes their gtm.dom and gtm.load, once each', async ( ) => {
        const dom = new JSDOM(fixture, {
            runScripts: 'outside-only', url: URL,
        });
        const w = dom.window;
        assert.equal(w.document.readyState, 'loading');
        snippet()(w);
        w.console.info = ( ) => {};
        w.eval(neutered);
        // Built in this realm: an array from the page's realm is not
        // reference-equal to one of ours, and strict deepEqual says so.
        const events = ( ) => Array.from(w.dataLayer)
            .filter(item => item && typeof item.event === 'string')
            .map(item => String(item.event));
        assert.deepEqual(events(), [ 'gtm.js' ]);
        await settle(60);
        // Their own two, in their order, and their flags on the entry named
        // after the data layer.
        assert.deepEqual(events(), [ 'gtm.js', 'gtm.dom', 'gtm.load' ]);
        assert.equal(w.google_tag_manager.dataLayer.gtmDom, true);
        assert.equal(w.google_tag_manager.dataLayer.gtmLoad, true);
        await settle(30);
        assert.deepEqual(events(), [ 'gtm.js', 'gtm.dom', 'gtm.load' ]);
    });

    it('pushes them on a page that had already loaded', async ( ) => {
        const dom = new JSDOM(fixture, {
            runScripts: 'outside-only', url: URL,
        });
        const w = dom.window;
        await settle(50);
        assert.equal(w.document.readyState, 'complete');
        snippet()(w);
        w.console.info = ( ) => {};
        w.eval(neutered);
        await settle(10);
        assert.deepEqual(
            Array.from(w.dataLayer)
                .filter(i => i && i.event).map(i => String(i.event)),
            [ 'gtm.js', 'gtm.dom', 'gtm.load' ]
        );
    });

    it('invents neither a consent state nor gtag', ( ) => {
        const w = boot({ before: snippet() });
        // Theirs builds google_tag_data only where a consent API is used, and
        // every reader in the field guards for it. A state here would tell a
        // consent manager that defaults had been set.
        assert.equal(w.google_tag_data, undefined);
        // gtm.js does not define gtag; that is gtag/js.
        assert.equal(w.gtag, undefined);
    });

    it('leaves a container that is already registered alone', ( ) => {
        // Their own lo() is get-or-keep - c.D[b] = c.D[b] || a - and the case
        // it covers is real: where the container loaded and this ran too, the
        // page's working container must not be replaced by a stub of it.
        let out;
        const w = boot({
            before: w_ => {
                out = lines(w_);
                snippet()(w_);
                w_.eval('window.google_tag_manager = { "' + ID + '":' +
                    ' { theirs: true } };');
            },
        });
        assert.deepEqual(plain(w.google_tag_manager[ID]), { theirs: true });
        assert.ok(out[0].includes(' container=kept'), out[0]);
        // The push contract is still answered, which is the part a page waits
        // on and the part a half-loaded container may have missed.
        assert.equal(typeof w.dataLayer.push, 'function');
    });

    it('does nothing the second time it is injected', async ( ) => {
        const w = boot({ before: snippet() });
        await settle(60);
        const container = w.google_tag_manager[ID];
        const push = w.dataLayer.push;
        const length = w.dataLayer.length;
        const subscribers = w.google_tag_manager.dataLayer.subscribers;
        w.eval(neutered);
        await settle(60);
        assert.equal(w.google_tag_manager[ID], container);
        assert.equal(w.dataLayer.push, push);
        assert.equal(w.dataLayer.length, length);
        assert.equal(w.google_tag_manager.dataLayer.subscribers, subscribers);
    });

    it('serves a second container on the same page', ( ) => {
        const html = '<!doctype html><html><head><script src=' +
            '"https://www.googletagmanager.com/gtm.js?id=GTM-NSXXFR">' +
            '</scr' + 'ipt></head><body><p>x</p></body></html>';
        const w = boot({ html, before: snippet('GTM-NSXXFR') });
        assert.ok(w.google_tag_manager['GTM-NSXXFR']);
        // A page with two containers has two entries and one data layer.
        assert.equal(w.google_tag_manager.dataLayer.subscribers, 1);
    });

    it('works with no tag to read, as a scriptlet has none', ( ) => {
        let out;
        const html = '<!doctype html><html><head></head><body>' +
            '<p id="content">x</p></body></html>';
        const w = boot({ html, before: w_ => { out = lines(w_); snippet()(w_); } });
        // No id to be had, so no container is registered under one - but the
        // push contract, which is what a page waits on, still works.
        assert.ok(out[0].includes(' id=unknown'), out[0]);
        assert.ok(out[0].includes(' container=noid'), out[0]);
        assert.equal(typeof w.dataLayer.push, 'function');
    });

    it('says on the console what it did', ( ) => {
        let out;
        boot({ before: w_ => { out = lines(w_); snippet()(w_); } });
        assert.equal(out.length, 1);
        assert.equal(
            out[0],
            '[gtm-rr] gtm-neutered ' + versions.gtm +
            ' id=' + ID + ' layer=dataLayer push=hooked container=installed'
        );
    });
});

/******************************************************************************/

describe('filters, gtm', ( ) => {
    it('redirects the container, by the name the resource ships under', ( ) => {
        assert.match(
            filtersText,
            /\|\|googletagmanager\.com\/gtm\.js\$script,redirect=gtm-neutered\.js/
        );
        // A redirect takes the full name; the scriptlet form takes none.
        assert.match(filtersText, /\+js\(gtm-neutered\)/);
        assert.equal(filtersText.includes('+js(gtm-neutered.js)'), false);
    });

    it('leaves gtag and the noscript frame alone', ( ) => {
        // Both are deliberate, and the list says so rather than carrying a
        // rule that would need a different contract answered.
        assert.equal(/redirect=[a-z-]*gtag/.test(filtersText), false);
        assert.match(filtersText, /gtag\/js\s+a different loader/);
    });
});
