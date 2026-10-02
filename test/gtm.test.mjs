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
    neutered = (await loadResources()).get('googletagmanager_gtm.js');
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

// The one line written as the resource starts. At the default level a
// command the page already pushed can be reported before it, so it is found
// rather than assumed to be first.
const summary = out => out.find(line => line.includes(' push=')) || '';

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(line); };
    return out;
};

/******************************************************************************/

describe('googletagmanager_gtm', ( ) => {
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
        // The marker that makes a second run a no-op is kept off the key set
        // above, because theirs carries no such field.
        assert.equal(Object.keys(container).includes('consentRRGtm'), false);
        assert.equal(container.consentRRGtm, versions.gtm);
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

    // A real container, in miniature: it wraps the same push, counts itself
    // a subscriber the way their bind() does, and answers a callback when its
    // own tags would have finished.
    const realContainer = id => '(function(){var c=window.dataLayer,e=c.push;' +
        'window.google_tag_manager=window.google_tag_manager||{};' +
        "var d=window.google_tag_manager['dataLayer']=" +
        "  window.google_tag_manager['dataLayer']||{};" +
        // Theirs counts itself a subscriber, then wraps the push, then reads
        // the array it found - bind() maps what is already there into its own
        // queue, so a callback pushed before it arrived is answered too.
        'd.subscribers=(d.subscribers||0)+1;' +
        'var answer=function(o){' +
        "  if(o&&typeof o.eventCallback==='function'){" +
        '    setTimeout(o.eventCallback,1) } };' +
        'c.push=function(){var i=[].slice.call(arguments,0);' +
        '  i.forEach(answer); return e.apply(c,i)};' +
        'c.slice(0).forEach(answer);' +
        'window.google_tag_manager["' + id + '"]=' +
        '  window.google_tag_manager["' + id + '"]||{theirs:true}})();';

    for ( const oursFirst of [ true, false ] ) {
        const order = oursFirst ? 'before' : 'after';
        it('answers a callback once with a real container ' + order + ' it',
        async ( ) => {
            // An allowlisted site - EasyPrivacy allowlists gtm.js on several
            // hundred - runs the real container as well as this. Both wrap
            // the push, so the page's callback was answered twice: on the
            // next tick by this, and again when their tags finished. A form
            // that submits on it submitted twice.
            const dom = new JSDOM(fixture, {
                runScripts: 'outside-only', url: URL,
            });
            const w = dom.window;
            w.console.info = ( ) => {};
            snippet()(w);
            if ( oursFirst ) {
                w.eval(neutered);
                w.eval(realContainer(ID));
            } else {
                w.eval(realContainer(ID));
                w.eval(neutered);
            }
            let fired = 0;
            w.dataLayer.push({
                event: 'formSubmit',
                eventCallback: ( ) => { fired += 1; },
            });
            await settle(40);
            assert.equal(fired, 1, 'fired ' + fired + ' times');
        });
    }

    it('stands aside once a real container binds', async ( ) => {
        let out;
        const dom = new JSDOM(fixture, {
            runScripts: 'outside-only', url: URL,
        });
        const w = dom.window;
        out = lines(w);
        snippet()(w);
        w.eval(neutered);
        const watched = w.google_tag_manager;
        // Before: the registry is watched, so a read of something this does
        // not provide is named.
        w.google_tag_manager.tcf;
        assert.ok(out.some(l => l.includes(' missing=google_tag_manager.tcf')),
            out.join(' | '));
        w.eval(realContainer(ID));
        // The next push is where it notices their bind.
        w.dataLayer.push({ event: 'anything' });
        await settle(10);
        assert.ok(out.some(l => l.includes(' yielded=live-container')),
            out.join(' | '));
        // The proxy is off: the registry is the object itself again, and
        // their get-or-create reads are no longer narrated.
        assert.notEqual(w.google_tag_manager, watched);
        const before_ = out.length;
        w.google_tag_manager.somethingElseOfTheirs;
        assert.equal(out.length, before_, out.slice(before_).join(' | '));
        // What the page relies on is untouched: their container object, the
        // data layer, and the id this registered.
        assert.ok(w.google_tag_manager[ID]);
        assert.equal(typeof w.dataLayer.push, 'function');
    });

    it('does not stand aside with no container but its own', async ( ) => {
        let out;
        const w = boot({ before: w_ => { out = lines(w_); snippet()(w_); } });
        w.dataLayer.push({ event: 'anything' });
        await settle(10);
        assert.equal(out.some(l => l.includes(' yielded=')), false,
            out.join(' | '));
        // Still watching, still answering.
        w.google_tag_manager.tcf;
        assert.ok(out.some(l => l.includes(' missing=google_tag_manager.tcf')),
            out.join(' | '));
    });

    it('leaves a callback alone if a container binds before the tick',
    async ( ) => {
        // The window the yield cannot cover: the page pushes, and a real
        // container boots and binds before the next tick, when this would
        // have answered. Their bind() counts itself a subscriber first and
        // wraps the push second, so by the time they could answer twice the
        // count has already moved - which is what the check in the callback
        // path reads.
        const dom = new JSDOM(fixture, {
            runScripts: 'outside-only', url: URL,
        });
        const w = dom.window;
        w.console.info = ( ) => {};
        snippet()(w);
        w.eval(neutered);
        let fired = 0;
        w.dataLayer.push({
            event: 'formSubmit',
            eventCallback: ( ) => { fired += 1; },
        });
        // Still the same turn: nothing has answered yet.
        assert.equal(fired, 0);
        w.eval(realContainer(ID));
        await settle(40);
        // Theirs answered it - the item was in the array before they wrapped,
        // so they pick it up from the backlog - and this did not answer it
        // again.
        assert.equal(fired, 1, 'fired ' + fired + ' times');
    });

    it('answers a callback once when anything else answers it too',
    async ( ) => {
        // Not every other caller is a container. The guard is their own
        // contract - Go() runs the list once and empties it - so whoever gets
        // there first wins, whatever the other caller is.
        const w = boot({ before: snippet() });
        let fired = 0;
        const item = { event: 'x', eventCallback: ( ) => { fired += 1; } };
        w.dataLayer.push(item);
        // Something else on the page calls the same callback - a debug
        // wrapper, a second tag manager, the page itself.
        item.eventCallback();
        await settle(20);
        assert.equal(fired, 1, 'fired ' + fired + ' times');
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

    it('stands in for the other loader off the same name', async ( ) => {
        // uBO's own lists send gtag/js to googletagmanager_gtm.js as well, so
        // this resource has to answer that contract too - and which one it is
        // standing in for comes off the script's own src.
        let out;
        const html = '<!doctype html><html><head><script async src=' +
            '"https://www.googletagmanager.com/gtag/js?id=G-KQ9NC85WD9">' +
            '</scr' + 'ipt></head><body><p>x</p></body></html>';
        const w = boot({
            html,
            before: w_ => {
                out = lines(w_);
                w_.eval('window.dataLayer = window.dataLayer || [];' +
                    'window.gtag = function gtag(){' +
                    ' window.dataLayer.push(arguments); };' +
                    'window.gtag("js", new Date());' +
                    'window.gtag("config", "G-KQ9NC85WD9");');
            },
        });
        assert.ok(summary(out).includes(' loader=/gtag/js'), out.join(' | '));
        const container = w.google_tag_manager['G-KQ9NC85WD9'];
        // Their gtag/js build of RU() has neither of the container's two
        // html handlers.
        assert.deepEqual(Object.keys(container).sort(),
            [ 'bootstrap', 'callback', 'dataLayer' ]);
        // And the command only that loader has, which a page waits on.
        const seen = [];
        w.gtag('get', 'G-KQ9NC85WD9', 'client_id', v => { seen.push(v); });
        assert.deepEqual(seen, []);
        await settle(10);
        // Answered, and with nothing: there is no client id, and inventing
        // one would be creating a tracking id here.
        assert.deepEqual(seen, [ undefined ]);
        assert.ok(out.some(l => l.includes(' get=client_id answered=undefined')),
            out.join(' | '));
        // The page's own gtag is left alone: neither loader defines one.
        assert.equal(w.gtag.name, 'gtag');
    });

    // The other loader's page: their snippet defines gtag itself, and the
    // resource is serving /gtag/js.
    const GTAG_PAGE = '<!doctype html><html><head><script async src=' +
        '"https://www.googletagmanager.com/gtag/js?id=G-KQ9NC85WD9">' +
        '</scr' + 'ipt></head><body><p id="content">x</p></body></html>';

    const bootGtag = (before_ = undefined) => boot({
        html: GTAG_PAGE,
        before: w_ => {
            if ( typeof before_ === 'function' ) { before_(w_); }
            w_.eval('window.dataLayer = window.dataLayer || [];' +
                'window.gtag = function gtag(){' +
                ' window.dataLayer.push(arguments); };' +
                'window.gtag("js", new Date());' +
                'window.gtag("config", "G-KQ9NC85WD9");');
        },
    });

    it('answers their get command and no other', async ( ) => {
        const w = bootGtag();
        const seen = [];
        const cb = v => { seen.push(v); };
        // Their RD table routes on the first argument, so a command carrying
        // the same four-argument shape is not a get, and its function is not
        // a callback to be called.
        w.gtag('set', 'page_title', 'Home', cb);
        w.gtag('config', 'G-OTHER12345', 'x', cb);
        await settle(10);
        assert.deepEqual(seen, []);
        w.gtag('get', 'G-KQ9NC85WD9', 'client_id', cb);
        await settle(10);
        assert.deepEqual(seen, [ undefined ]);
    });

    it('reads commands only out of an arguments object, as theirs does',
    async ( ) => {
        const w = bootGtag();
        const seen = [];
        // A plain object is data for the model, never a command: theirs takes
        // its commands from what the page's gtag() pushes, which is always an
        // arguments object.
        w.dataLayer.push({
            0: 'get', 1: 'G-KQ9NC85WD9', 2: 'client_id',
            3: v => { seen.push(v); }, length: 4,
        });
        await settle(10);
        assert.deepEqual(seen, []);
    });

    it('takes their whole command table without putting it in the model',
    async ( ) => {
        const w = bootGtag();
        for ( const args of [
            [ 'config', 'G-KQ9NC85WD9', { send_page_view: false } ],
            [ 'event', 'purchase', { value: 1 } ],
            [ 'set', { currency: 'GBP' } ],
            [ 'consent', 'default', { ad_storage: 'denied' } ],
            [ 'consent', 'update', { ad_storage: 'granted' } ],
            [ 'policy', 'ads_data_redaction' ],
        ] ) {
            w.gtag.apply(null, args);
        }
        await settle(10);
        const model = w.google_tag_manager['G-KQ9NC85WD9'].dataLayer;
        // A command is not model data, and theirs does not merge one: the
        // numeric keys of an arguments object have no business in there, and
        // neither has what a set carried.
        assert.equal(model.get('0'), undefined);
        assert.equal(model.get('1'), undefined);
        assert.equal(model.get('currency'), undefined);
        // Nor is any consent state invented from a consent command.
        assert.equal(w.google_tag_data, undefined);
    });

    it('puts the container two fields on the container loader only', ( ) => {
        const w = boot({ before: snippet() });
        assert.equal(typeof w.google_tag_manager[ID].onHtmlSuccess, 'function');
        assert.equal(typeof w.google_tag_manager[ID].onHtmlFailure, 'function');
    });

    it('serves both loaders on one page, each with its own surface',
    async ( ) => {
        const html = '<!doctype html><html><head>' +
            '<script src="https://www.googletagmanager.com/gtm.js?id=' + ID +
            '"></scr' + 'ipt></head><body><p>x</p></body></html>';
        const w = boot({ html, before: snippet() });
        // The second script is the other loader, and the resource runs again
        // for it - the id it has not seen before is what makes that run do
        // something, which is their own get-or-create.
        w.document.head.insertAdjacentHTML('beforeend',
            '<script src="https://www.googletagmanager.com/gtag/js?id=G-SECOND0001">' +
            '</scr' + 'ipt>');
        w.eval(neutered);
        await settle(10);
        assert.equal(typeof w.google_tag_manager[ID].onHtmlSuccess, 'function');
        assert.ok(w.google_tag_manager['G-SECOND0001'] === undefined ||
            w.google_tag_manager['G-SECOND0001'].onHtmlSuccess === undefined);
        // One data layer, and a subscriber for each run that registered.
        assert.ok(w.google_tag_manager.dataLayer.subscribers >= 1);
    });

    it('ends the anti-flicker hiding their snippet parks on the layer',
    async ( ) => {
        let out;
        const w = boot({
            before: w_ => {
                out = lines(w_);
                // Google's own anti-flicker snippet, as it ships: a class on
                // the document element and the undo parked on the data layer.
                w_.eval(
                    'document.documentElement.className += " async-hide";' +
                    'window.dataLayer = window.dataLayer || [];' +
                    'window.dataLayer.hide = { start: 1, timeout: 4000,' +
                    ' "' + ID + '": true,' +
                    ' end: function(){ document.documentElement.className =' +
                    '  document.documentElement.className' +
                    '    .replace(/ ?async-hide/, ""); } };'
                );
                snippet()(w_);
            },
        });
        // Their own code clears its entry and, where no other container is
        // still expected, ends the hiding and drops the function.
        assert.equal(w.dataLayer.hide[ID], false);
        assert.equal(w.dataLayer.hide.end, null);
        assert.equal(w.document.documentElement.className.includes('async-hide'),
            false);
        assert.ok(summary(out).includes(' hide=ended'), summary(out));
    });

    it('ends a hiding whose snippet turns up after it does', async ( ) => {
        // Their snippet is documented to go above the container tag, but a
        // page can put it below - and this runs before either. So while the
        // document is still being built, a hide that was not there yet is
        // still looked for.
        const dom = new JSDOM(fixture, { runScripts: 'outside-only', url: URL });
        const w = dom.window;
        assert.equal(w.document.readyState, 'loading');
        w.console.info = ( ) => {};
        snippet()(w);
        w.eval(neutered);
        // The snippet, after the resource.
        w.eval('document.documentElement.className += " async-hide";' +
            'window.dataLayer.hide = { "' + ID + '": true,' +
            ' end: function(){ document.documentElement.className =' +
            '  document.documentElement.className' +
            '    .replace(/ ?async-hide/, ""); } };');
        w.dataLayer.push({ event: 'anything' });
        assert.equal(w.dataLayer.hide.end, null);
        assert.equal(
            w.document.documentElement.className.includes('async-hide'),
            false
        );
    });

    it('stops looking for a hiding once the page is built', async ( ) => {
        const w = boot({ before: snippet() });
        await settle(50);
        assert.equal(w.document.readyState, 'complete');
        // One that appears now has nothing to undo - theirs hides a page
        // while it loads, and their own timer would have given up - so this
        // is not still reading three properties on every push for it.
        w.dataLayer.hide = { [ID]: true, end: ( ) => { w.ended = true; } };
        w.dataLayer.push({ event: 'anything' });
        assert.equal(w.ended, undefined);
    });

    it('leaves the hiding to a container that is still expected', ( ) => {
        let out;
        const w = boot({
            before: w_ => {
                out = lines(w_);
                w_.eval(
                    'document.documentElement.className += " async-hide";' +
                    'window.dataLayer = window.dataLayer || [];' +
                    'window.dataLayer.hide = { start: 1, timeout: 4000,' +
                    ' "' + ID + '": true, "GTM-OTHER11": true,' +
                    ' end: function(){ window.ended = true; } };'
                );
                snippet()(w_);
            },
        });
        // Theirs only ends it when nothing else in the map is still true.
        assert.equal(w.dataLayer.hide[ID], false);
        assert.equal(w.ended, undefined);
        assert.equal(typeof w.dataLayer.hide.end, 'function');
        assert.ok(summary(out).includes(' hide=waiting'), summary(out));
    });

    it('does not touch a hiding that is not this container own', ( ) => {
        let out;
        const w = boot({
            before: w_ => {
                out = lines(w_);
                w_.eval('window.dataLayer = window.dataLayer || [];' +
                    'window.dataLayer.hide = { "GTM-SOMEONEELSE": true,' +
                    ' end: function(){ window.ended = true; } };');
                snippet()(w_);
            },
        });
        assert.equal(w.ended, undefined);
        assert.equal(w.dataLayer.hide['GTM-SOMEONEELSE'], true);
        assert.ok(summary(out).includes(' hide=theirs'), summary(out));
    });

    it('keeps the ga noop uBO own resource puts up', ( ) => {
        const w = boot({ before: snippet() });
        // Standing in front of theirs means not losing what theirs did: a
        // page calling ga() where analytics.js was blocked without a stub
        // would throw.
        assert.equal(typeof w.ga, 'function');
        assert.equal(w.ga('send', 'pageview'), undefined);
    });

    it('leaves a better ga stub alone', ( ) => {
        const w = boot({
            before: w_ => {
                w_.eval('window.ga = function(){ window.gaCalls =' +
                    ' (window.gaCalls || 0) + 1; };');
                snippet()(w_);
            },
        });
        // uBO's analytics surrogate installs one that honours hitCallback,
        // and it is the better of the two.
        w.ga('send');
        assert.equal(w.gaCalls, 1);
    });

    it('keeps a data layer the page made itself, whatever it is', ( ) => {
        // Their $c only creates what is not there and then wraps whatever
        // push that object has, so a page with its own object keeps it - and
        // keeps what it had put in it.
        let out;
        const w = boot({
            before: w_ => {
                out = lines(w_);
                w_.eval('window.dataLayer = { mine: true, items: [],' +
                    ' push: function(o){ this.items.push(o); return 7; } };');
            },
        });
        assert.equal(w.dataLayer.mine, true);
        assert.ok(summary(out).includes(' push=hooked'), summary(out));
        // Wrapped, not replaced: their own push still runs and its return
        // value still comes back.
        const calls = [];
        const returned = w.dataLayer.push({
            event: 'x',
            eventCallback: ( ) => { calls.push(1); },
        });
        assert.equal(returned, 7);
        assert.equal(w.dataLayer.items.length, 1);
        assert.equal(w.google_tag_manager[ID].dataLayer.get('event'), 'x');
    });

    it('leaves a data layer with no push alone', ( ) => {
        let out;
        const w = boot({
            before: w_ => {
                out = lines(w_);
                w_.eval('window.dataLayer = { mine: true };');
            },
        });
        // Nothing to wrap, and inventing one would mean a page's own object
        // growing a method it never had.
        assert.equal(w.dataLayer.mine, true);
        assert.equal(w.dataLayer.push, undefined);
        assert.ok(summary(out).includes(' push=nopush'), summary(out));
        // The container still goes up, which is the other half of the job.
        assert.ok(w.google_tag_manager[ID]);
    });

    // On by default; the flag either silences it or asks for more.
    const debugLevel = (w_, level) => {
        try {
            w_.localStorage.setItem('gtm-rr-debug', level);
        } catch(ex) {
        }
    };
    const debugOff = w_ => debugLevel(w_, 'off');
    const debugProbe = w_ => debugLevel(w_, 'probe');
    const debugQuiet = w_ => debugLevel(w_, 'quiet');
    // The default, so asking for it is asking for nothing.
    const debugVerbose = ( ) => undefined;

    it('says nothing once a visitor has silenced it', ( ) => {
        let out;
        const w = boot({
            before: w_ => { debugOff(w_); out = lines(w_); snippet()(w_); },
        });
        // Nothing is wrapped when it is off, so nothing can be reported.
        w.google_tag_manager[ID].somethingWeDoNotHave;
        w.google_tag_manager[ID].dataLayer.alsoNot;
        assert.equal(out.length, 1);
        assert.ok(summary(out).includes(' debug=off'), summary(out));
    });

    it('names what a page reads without being asked to', ( ) => {
        let out;
        const w = boot({ before: w_ => { out = lines(w_); snippet()(w_); } });
        // The default: the part of their API a site wanted and did not get.
        assert.ok(summary(out).includes(' debug=verbose'), summary(out));
        w.google_tag_manager[ID].SANDBOXED_JS_SEMAPHORE;
        assert.ok(
            out.some(l => l.includes(' missing=container.SANDBOXED_JS_SEMAPHORE')),
            out.join(' | ')
        );
    });

    it('keeps the page own data out of the console when asked to quieten',
    async ( ) => {
        let out;
        const w = bootGtag(w_ => { debugQuiet(w_); out = lines(w_); });
        w.gtag('set', 'user_data', { email: 'someone@example.com' });
        w.gtag('event', 'purchase', { transaction_id: 'T-12345' });
        // ga is reported by default - a page calling it means analytics.js
        // was blocked without a stub - so what it was called with has to be
        // held back here too.
        w.ga('send', 'pageview', '/account/orders/T-12345');
        await settle(10);
        const said = out.join(' | ');
        // A console is pasted into bug reports. What the page passed is the
        // page's data, and a command going nowhere is this resource working.
        assert.equal(said.includes('someone@example.com'), false);
        assert.equal(said.includes('T-12345'), false);
        assert.equal(said.includes(' missing=command.'), false);
        // The name of the thing it asked for is still said.
        assert.ok(said.includes(' missing=ga.send'), said);
        assert.equal(said.includes(' args='), false);
    });

    it('names what a page reads that is not here', ( ) => {
        let out;
        const w = boot({
            before: w_ => { out = lines(w_); snippet()(w_); },
        });
        assert.ok(summary(out).includes(' debug=verbose'), summary(out));
        const container = w.google_tag_manager[ID];
        // Their own registry carries more than this provides - the sandboxed
        // JS semaphore, their tag queue, their macro cache - and a page or a
        // tag template reading one of them is the thing worth knowing.
        container.SANDBOXED_JS_SEMAPHORE;
        container.dataLayer.getUntrusted;
        assert.ok(
            out.some(l => l.includes(' missing=container.SANDBOXED_JS_SEMAPHORE')),
            out.join(' | ')
        );
        assert.ok(out.some(l => l.includes(' missing=dataLayer.getUntrusted')),
            out.join(' | '));
        // Each name once, however often it is read.
        const before_ = out.length;
        container.SANDBOXED_JS_SEMAPHORE;
        container.SANDBOXED_JS_SEMAPHORE;
        assert.equal(out.length, before_);
    });

    it('names what a page reads off the registry and the layer entry', ( ) => {
        let out;
        const w = boot({ before: w_ => { out = lines(w_); snippet()(w_); } });
        // Their own registry is filled on demand by their features -
        // ho("tcf"), ho("gth"), ho("mb"), ho("r"), ho("ads_pageview") - and
        // the entry named after the data layer carries more than three
        // fields. None of it is here, and a page reading one gets nothing.
        w.google_tag_manager.tcf;
        w.google_tag_manager.SANDBOXED_JS_SEMAPHORE;
        w.google_tag_manager.dataLayer.pruned;
        const said = out.join(' | ');
        assert.ok(said.includes(' missing=google_tag_manager.tcf'), said);
        assert.ok(
            said.includes(' missing=google_tag_manager.SANDBOXED_JS_SEMAPHORE'),
            said
        );
        assert.ok(said.includes(' missing=layer.pruned'), said);
    });

    it('says nothing about what this put in the registry, or what else did',
    ( ) => {
        let out;
        const w = boot({ before: w_ => { out = lines(w_); snippet()(w_); } });
        const before_ = out.length;
        // Everything this registered is a name it knows.
        w.google_tag_manager[ID];
        w.google_tag_manager.dataLayer;
        w.google_tag_manager.rm;
        assert.equal(out.length, before_, out.slice(before_).join(' | '));
        // And a key written afterwards - by a second container of theirs that
        // was not replaced, say - is not then reported as missing.
        w.eval('window.google_tag_manager.somethingElse = { theirs: 1 };');
        w.google_tag_manager.somethingElse;
        assert.equal(out.length, before_, out.slice(before_).join(' | '));
        // Watched or not, the registry is still theirs to read and write.
        assert.deepEqual(
            Object.keys(w.google_tag_manager).sort(),
            [ ID, 'dataLayer', 'rm', 'somethingElse' ].sort()
        );
    });

    it('answers a call to a method that is not here, and says what it carried',
    ( ) => {
        let out;
        const w = boot({
            before: w_ => { debugProbe(w_); out = lines(w_); snippet()(w_); },
        });
        // What a page was about to do with the thing it could not find is the
        // part that says what to build. At the default level this throws in
        // the page and the arguments are lost with it.
        w.google_tag_manager[ID].setConsentState('granted', { wait: 500 });
        const said = out.join(' | ');
        assert.ok(said.includes(' missing=container.setConsentState'), said);
        assert.ok(
            said.includes(' called=container.setConsentState' +
                ' id=' + ID + ' args=["granted",{wait:500}]'),
            said
        );
    });

    it('hands back the same function for a name, and keeps structure alone',
    async ( ) => {
        const w = boot({
            before: w_ => { debugProbe(w_); snippet()(w_); },
        });
        const container = w.google_tag_manager[ID];
        // A page may compare what it was given across reads.
        assert.equal(container.whatever, container.whatever);
        assert.equal(typeof container.whatever, 'function');
        // And the names that change what an object is, rather than what it
        // does, are never answered with one: a thenable breaks an await.
        assert.equal(container.then, undefined);
        assert.equal(container.toJSON, undefined);
        const awaited = await Promise.resolve(container);
        assert.equal(awaited, container);
    });

    it('gives back a value that is really there, at either level', ( ) => {
        // Something wrote a field this does not know about - theirs sets
        // pruned on that entry - so reading it has to give the field back.
        // Watching a thing must not change what reading it answers.
        for ( const level of [ undefined, 'probe' ] ) {
            const w = boot({
                before: w_ => {
                    if ( level !== undefined ) { debugLevel(w_, level); }
                    snippet()(w_);
                },
            });
            w.google_tag_manager.dataLayer.pruned = true;
            assert.equal(
                w.google_tag_manager.dataLayer.pruned, true, String(level)
            );
            // Named once, since it is still something this does not provide.
            assert.equal(w.google_tag_manager.dataLayer.subscribers, 1);
        }
    });

    it('leaves a missing name missing unless asked to probe', ( ) => {
        const w = boot({ before: snippet() });
        // The default has to leave a page's own check alone: asking whether
        // something is there and being told yes is a different page.
        assert.equal(w.google_tag_manager[ID].setConsentState, undefined);
        assert.throws(( ) => {
            w.google_tag_manager[ID].setConsentState('granted');
        });
    });

    it('leaves what it does provide unremarked, and working', ( ) => {
        let out;
        const w = boot({
            before: w_ => { out = lines(w_); snippet()(w_); },
        });
        const container = w.google_tag_manager[ID];
        container.dataLayer.set('page', { title: 'Home' });
        assert.equal(container.dataLayer.get('page.title'), 'Home');
        assert.equal(container.bootstrap > 0, true);
        assert.equal(typeof container.callback, 'function');
        // Watched through a get-only proxy, so the keys a page enumerates are
        // the ones theirs would have.
        assert.deepEqual(Object.keys(container).sort(), [
            'bootstrap', 'callback', 'dataLayer', 'onHtmlFailure',
            'onHtmlSuccess',
        ]);
        assert.equal(out.length, 1, out.join(' | '));
    });

    it('names the page script, not one of its own frames', ( ) => {
        // The field case, reproduced: uBO injects a scriptlet from a blob:
        // URL belonging to the page, so this resource's own frames carry a
        // real source and a name a page could have used - trademe reported
        //   from=get@blob:https://www.trademe.co.nz/<uuid>:528:39
        // which is the proxy's own get trap, not the page. A sourceURL on
        // each side puts both in that shape.
        const dom = new JSDOM(fixture, {
            runScripts: 'outside-only', url: URL,
        });
        const w = dom.window;
        const out = lines(w);
        snippet()(w);
        w.eval(neutered +
            '\n//# sourceURL=blob:https://www.example.com/0123-4567');
        w.eval('//# sourceURL=https://site.example/app.js\n' +
            'window.pageCode = function get(){' +
            ' return window.google_tag_manager["' + ID + '"].somethingMissing;' +
            '};');
        w.pageCode();
        const line = out.find(
            l => l.includes(' missing=container.somethingMissing')
        );
        assert.ok(line !== undefined, out.join(' | '));
        // The page's own file, even though its function is called get - the
        // same name as the trap that saw the read - and not the blob.
        assert.match(line, / from=.*app\.js/);
        assert.equal(line.includes('blob:'), false, line);
    });

    it('echoes what a page passed, and who asked, when asked to',
    async ( ) => {
        let out;
        const w = bootGtag(w_ => { debugVerbose(w_); out = lines(w_); });
        w.gtag('consent', 'update', { ad_storage: 'granted' });
        await settle(10);
        const line = out.find(l => l.includes(' missing=command.consent'));
        assert.ok(line !== undefined, out.join(' | '));
        // A command's arguments are its value, so they are echoed.
        assert.ok(line.includes('args=["update",{ad_storage:"granted"}]'), line);
        // And which script asked, which is what makes a report chaseable.
        assert.ok(/ from=\S/.test(line), line);
    });

    it('shows no value for a property, because there is none', ( ) => {
        let out;
        const w = boot({
            before: w_ => { out = lines(w_); snippet()(w_); },
        });
        w.google_tag_manager[ID].somethingMissing;
        const line = out.find(l => l.includes(' missing=container.somethingMissing'));
        assert.ok(line !== undefined, out.join(' | '));
        // Missing means there was nothing to read, so an args= would be
        // reporting a value this resource made up.
        assert.equal(line.includes(' args='), false);
    });

    it('keeps what it echoes short', async ( ) => {
        let out;
        const w = bootGtag(w_ => { debugVerbose(w_); out = lines(w_); });
        // A console line is something a visitor pastes into a report, so a
        // page passing a page's worth of data does not get a page's worth of
        // line.
        w.eval('gtag("event", "big", { note: "x".repeat(400) });');
        await settle(10);
        const line = out.find(l => l.includes(' missing=command.event'));
        const args = /args=(.*?) from=/.exec(line);
        assert.ok(args !== null, line);
        assert.ok(args[1].length <= 164, args[1].length + ': ' + args[1]);
        assert.ok(args[1].endsWith('...'), args[1].slice(-20));
    });

    it('survives what a page hands it', async ( ) => {
        let out;
        const w = bootGtag(w_ => { debugVerbose(w_); out = lines(w_); });
        // Circular, and a getter that throws when read: both are things a
        // page can pass, and neither may throw in here - this runs inside the
        // page's own call to push.
        w.eval('window.__awkward = { ok: 1 };' +
            'window.__awkward.self = window.__awkward;' +
            'Object.defineProperty(window.__awkward, "boom", {' +
            ' enumerable: true, get: function(){ throw new Error("no"); } });' +
            'gtag("event", "awkward", window.__awkward);');
        await settle(10);
        const line = out.find(l => l.includes(' missing=command.awkward')) ||
            out.find(l => l.includes(' missing=command.event'));
        assert.ok(line !== undefined, out.join(' | '));
        // Something was said, and the page carried on.
        assert.ok(line.includes(' args='), line);
        assert.equal(w.dataLayer.length > 0, true);
    });

    it('names a gtag command that went nowhere, when asked to', async ( ) => {
        let out;
        const w = bootGtag(w_ => { debugVerbose(w_); out = lines(w_); });
        w.gtag('consent', 'update', { ad_storage: 'granted' });
        w.gtag('event', 'purchase', { value: 1 });
        await settle(10);
        assert.ok(out.some(l => l.includes(' missing=command.consent')),
            out.join(' | '));
        assert.ok(out.some(l => l.includes(' missing=command.event')),
            out.join(' | '));
        // The one that is answered is not reported as missing.
        w.gtag('get', 'G-KQ9NC85WD9', 'client_id', ( ) => {});
        await settle(10);
        assert.equal(out.some(l => l.includes(' missing=command.get')), false);
    });

    it('names what a page called ga with', ( ) => {
        let out;
        const w = boot({
            before: w_ => { out = lines(w_); snippet()(w_); },
        });
        w.ga('send', 'pageview');
        assert.ok(out.some(l => l.includes(' missing=ga.send')), out.join(' | '));
    });

    it('does not wrap the registry again on a second injection', ( ) => {
        const w = boot({ before: snippet() });
        const first = w.google_tag_manager;
        w.eval(neutered);
        // Wrapping a wrapper works and reports nothing wrong, which is why
        // this is about identity: left unguarded, every injection adds
        // another layer to read through and the page's own reference stops
        // matching what is on the window.
        assert.equal(w.google_tag_manager, first);
        assert.ok(w.google_tag_manager[ID]);
    });

    // The recommended install is the redirect and the global scriptlet
    // together, since whether a site's CSP will accept the redirect cannot be
    // known from a list. On a site where both land, either can get there
    // first.
    const bothWays = async redirectFirst => {
        const dom = new JSDOM(
            '<!doctype html><html><head></head><body></body></html>',
            { runScripts: 'outside-only', url: URL }
        );
        const w = dom.window;
        const out = lines(w);
        snippet()(w);
        // The scriptlet, at document_start, before the page's tag exists.
        w.eval(neutered);
        assert.deepEqual(out, [], 'a scriptlet with no loader says nothing');
        w.document.head.insertAdjacentHTML('beforeend',
            '<script src="https://www.googletagmanager.com/gtm.js' +
            '?id=GTM-BOTH0001"></scr' + 'ipt>');
        const tag = w.document.querySelector('script[src*=googletagmanager]');
        const asRedirect = ( ) => {
            // uBO serves the resource as the script itself, so
            // document.currentScript is the page's own tag.
            Object.defineProperty(w.document, 'currentScript', {
                value: tag, configurable: true,
            });
            w.eval(neutered);
            delete w.document.currentScript;
        };
        if ( redirectFirst ) {
            asRedirect();
            await settle(60);
        } else {
            // Let the scriptlet's watch see the tag first.
            await settle(60);
            asRedirect();
        }
        await settle(20);
        return { w, out };
    };

    for ( const redirectFirst of [ true, false ] ) {
        const order = redirectFirst ? 'the redirect' : 'the scriptlet';
        it('installs once with both active, ' + order + ' first',
        async ( ) => {
            const { w, out } = await bothWays(redirectFirst);
            const ID2 = 'GTM-BOTH0001';
            const g = w.google_tag_manager;
            // One did the work and the other found it done.
            assert.equal(out.length, 2, out.join(' | '));
            assert.ok(out.some(l => l.includes(' push=hooked container=installed')),
                out.join(' | '));
            assert.ok(out.some(l => l.includes(' push=already container=kept')),
                out.join(' | '));
            // And nothing is doubled: theirs counts one subscriber per
            // instance, the push is wrapped once, their two events go out
            // once each, and the registry is wrapped once.
            assert.equal(g.dataLayer.subscribers, 1);
            assert.equal(w.dataLayer.consentRRGtm, versions.gtm);
            assert.deepEqual(
                Array.from(w.dataLayer)
                    .filter(i => i && typeof i.event === 'string')
                    .map(i => String(i.event)),
                [ 'gtm.js', 'gtm.dom', 'gtm.load' ]
            );
            assert.equal(
                Object.keys(g).filter(k => k.startsWith('GTM-')).length, 1
            );
            assert.equal(g.consentRRGtmWatched, versions.gtm);
            // The contract a page waits on still answers exactly once.
            const calls = [];
            w.dataLayer.push({
                event: 'submit',
                eventCallback: ( ) => { calls.push(1); },
            });
            await settle(10);
            assert.deepEqual(calls, [ 1 ]);
            assert.ok(g[ID2]);
        });
    }

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

    it('finds the id off a tag whose own fetch was refused', ( ) => {
        // A site whose CSP will not have a data: script refuses the redirect,
        // and the way round it is the scriptlet form - injected, so no URI to
        // object to, and no document.currentScript either. The element is
        // still in the document, which is where the id comes from.
        let out;
        const html = '<!doctype html><html><head><script async src=' +
            '"https://www.googletagmanager.com/gtag/js?id=G-JJTLVXMBWX' +
            '&cx=c&gtm=4e69u2h1"></scr' + 'ipt>' +
            '</head><body><p id="content">x</p></body></html>';
        const w = boot({
            html,
            before: w_ => {
                out = lines(w_);
                w_.eval('window.dataLayer = window.dataLayer || [];' +
                    'window.gtag = function gtag(){' +
                    ' window.dataLayer.push(arguments); };' +
                    'window.gtag("config", "G-JJTLVXMBWX");');
            },
        });
        // Their extra query parameters do not get in the way of the id.
        assert.ok(summary(out).includes(' id=G-JJTLVXMBWX'), summary(out));
        assert.ok(summary(out).includes(' loader=/gtag/js'), summary(out));
        assert.deepEqual(
            Object.keys(w.google_tag_manager['G-JJTLVXMBWX']).sort(),
            [ 'bootstrap', 'callback', 'dataLayer' ]
        );
    });

    it('does nothing at all on a page with no loader to stand in for', ( ) => {
        // Injected as a scriptlet - which a site whose CSP refuses a data:
        // URI needs - this runs on every page the rule covers. A page that
        // never loads a container must not come away with a dataLayer, a
        // registry, or a word in the console.
        let out;
        const html = '<!doctype html><html><head></head><body>' +
            '<p id="content">x</p></body></html>';
        const w = boot({ html, before: w_ => { out = lines(w_); } });
        assert.deepEqual(out, []);
        assert.equal(w.google_tag_manager, undefined);
        assert.equal(w.dataLayer, undefined);
        assert.equal(w.ga, undefined);
    });

    it('starts when a loader tag turns up after it does', async ( ) => {
        // The scriptlet case: at document_start the page has not parsed its
        // own tag yet, so there is nothing to read and nothing to do - until
        // there is.
        let out;
        const dom = runDom(
            neutered, URL,
            '<!doctype html><html><head></head><body></body></html>',
            w_ => { out = lines(w_); }
        );
        const w = dom.window;
        assert.deepEqual(out, []);
        w.document.head.insertAdjacentHTML('beforeend',
            '<script async src="https://www.googletagmanager.com/gtm.js' +
            '?id=GTM-LATER001"></scr' + 'ipt>');
        await settle(20);
        assert.ok(summary(out).includes(' id=GTM-LATER001'), out.join(' | '));
        assert.ok(summary(out).includes(' loader=/gtm.js'), out.join(' | '));
        assert.ok(w.google_tag_manager['GTM-LATER001']);
        // And the page's own pushes from before it started are not lost: the
        // backlog is read when the layer is hooked.
        assert.equal(
            w.google_tag_manager['GTM-LATER001'].dataLayer.name, 'dataLayer'
        );
    });
    it('says on the console what it did', ( ) => {
        let out;
        boot({ before: w_ => { out = lines(w_); snippet()(w_); } });
        assert.equal(out.length, 1);
        assert.equal(
            out[0],
            '[gtm-rr] googletagmanager_gtm ' + versions.gtm +
            ' loader=/gtm.js id=' + ID +
            ' layer=dataLayer push=hooked container=installed hide=absent' +
            ' debug=verbose'
        );
    });
});

/******************************************************************************/

describe('README, gtm', ( ) => {
    it('offers the scriptlet form for a site whose CSP refuses a data: URI',
    async ( ) => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const root = path.join(import.meta.dirname, '..');
        const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
        // The limit is uBO's, not this resource's, and saying so is the
        // difference between a user fixing it in one line and concluding the
        // thing is broken.
        assert.match(readme, /source URI is not allowed in this document/);
        assert.match(readme, /\*##\+js\(googletagmanager_gtm\)/);
        assert.match(readme, /replacing uBO's resource is a step backwards/);
        assert.match(filtersText, /^\*##\+js\(googletagmanager_gtm\)$/m);
    });

    it('lists every command the resource actually answers', async ( ) => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        // Paths rather than URLs: this suite has its own URL binding, and a
        // new URL(...) in here finds a string.
        const root = path.join(import.meta.dirname, '..');
        const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
        // The table says get is the only command answered. If another one
        // ever is, the table is wrong - and a README that lies about which
        // calls work is worse than one that says nothing.
        const resource = await fs.readFile(
            path.join(root, 'src/gtm/lib/gtm-core.js'), 'utf8'
        );
        assert.match(resource, /item\[0\] !== 'get'/);
        assert.match(readme, /every `gtag` command but `get`/);
        // And the two things it must not define are still listed as such.
        assert.match(readme, /`google_tag_data` \(consent mode state\)/);
        assert.match(readme, /`gtag` itself/);
    });
});

describe('filters, gtm', ( ) => {
    it('ships under uBO own resource name, which replaces the built-in',
    async ( ) => {
        const resources = await loadResources();
        // The name is the point: uBO's default lists already redirect both
        // loaders to it, and a user resource of the same name replaces the
        // built-in.
        assert.ok(resources.has('googletagmanager_gtm.js'),
            Array.from(resources.keys()).join(','));
        assert.match(filtersText, /redirect=googletagmanager_gtm\.js:5/);
        assert.match(filtersText, /A user resource replaces a built-in/);
    });

    it('carries no rule for the sites uBO own lists already cover', ( ) => {
        // Nothing to add there, so nothing is added: the only rules here are
        // the first-party ones uBO's cannot reach, and they are examples.
        assert.equal(
            /^\|\|googletagmanager\.com/m.test(filtersText),
            false
        );
        assert.match(filtersText, /sgtm\.example\.com\/gtm\.js/);
    });

    it('sends the unreachable cases to the opt-out instead', ( ) => {
        assert.match(filtersText, /Use\s*\n! ga-optout instead/);
    });
});
