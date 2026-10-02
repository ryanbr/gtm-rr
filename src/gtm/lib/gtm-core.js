/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Read off two real containers rather than documentation - GTM-KJZD388 and
    GTM-NSXXFR, 540KB each, which agreed on every structure below:

      the snippet              creates window.dataLayer and pushes
                               { "gtm.start": <ms>, event: "gtm.js" } before
                               the container arrives, so the array is the
                               page's and is never replaced here - page code
                               holds a reference to it. Only its push is
                               wrapped, which is what theirs does:
                                 var e = c.push; c.push = function() { ... }
                               keeping the array's own push as the return
                               value, so a caller still gets the new length.
      window.google_tag_manager  theirs, from RU():
                                 { dataLayer: <model>, bootstrap: 0,
                                   callback: fn, onHtmlSuccess: fn,
                                   onHtmlFailure: fn }
                               stored under the container id, with the entry
                               under the data layer's own name carrying
                               { subscribers, gtmDom, gtmLoad } and "rm"
                               holding their macro-resolver map.
      the model                theirs is dA.R:
                                 { name: "dataLayer", get, set, reset }
                               and its get walks a dotted path, so
                               get("a.b") reads b out of a.
      eventCallback            the one that breaks pages when it goes missing.
                               Theirs runs it when every tag for that event has
                               finished:
                                 jd: new Do(function() {
                                   k && k.apply(k, [].slice.call(arguments, 0))
                                 }, m)
                               with Do's own gate
                                 Co = function(a, b, c) {
                                   b !== void 0 && a.zg(b);
                                   c && A.setTimeout(function() { Go(a) },
                                                     Number(c)) }
                               so eventTimeout is an upper bound and nothing
                               more: with no timeout there is no timer at all
                               and the callback waits on the tags. A container
                               with no tags has nothing to wait for, so this
                               runs it on the next tick. A page that pushes
                               { event: "x", eventCallback: fn } and never
                               hears back is a form that never submits, with
                               no error anywhere.
                               Theirs applies it with the callback itself as
                               this, and no arguments, which is what this does.
      gtm.dom and gtm.load     theirs pushes them itself, once each, guarded by
                               the flags on that entry:
                                 if (!d.gtmDom) { d.gtmDom = true;
                                   c.push({ event: "gtm.dom" }) }
                                 if (!d.gtmLoad) { d.gtmLoad = true;
                                   c.push({ event: "gtm.load" }) }
                               A page's own triggers hang off those two.
      the container id         off the script's own src, ?id=GTM-XXXX, which a
                               redirected resource can still read: uBO
                               redirects the request, so the element keeps its
                               attributes. &l=<name> renames the data layer,
                               which the snippet passes when the page uses one.
                               gtm.js without an id answers 400, so there is
                               always one to read.

    Deliberately not done:

      no google_tag_data       theirs creates it only where a consent API is
                               actually used - ics, tidr, gl, xcd are built on
                               demand - and every reader seen in the field
                               guards for it (CookieScript's own check is
                               window.google_tag_data && .ics &&
                               .ics.usedDefault). Writing a consent state here
                               would tell a consent manager that defaults had
                               been set when nothing set them.
      no gtag                  gtm.js does not define it. That is gtag/js, a
                               different URL and a different resource.
      no gtm.init              theirs does push gtm.init and gtm.init_consent,
                               but onto its own internal queue -
                                 a.D.unshift(p, d)
                               with listeners added through
                               JB().addListener("gtm.init", ...) - and not
                               onto window.dataLayer, so page code reading the
                               array never sees them. gtm.dom and gtm.load do
                               go onto the array, which is why those two are
                               pushed and these are not.
      no gtm.uniqueEventId     theirs stamps one onto each message it builds,
                               which is an internal id for its own queue.
      no tags, no requests     which is the point. Nothing is fetched, no
                               cookie is written, and the sandboxed-JS
                               semaphore, the tag queue, the macro cache and
                               the rest of a 540KB container are absent.

*/

function consentRRGtm() {
    const w = window;
    const doc = w.document;
    const VERSION = '@@VERSION@@';
    const NAME = 'gtm-neutered';
    const DEFAULT_LAYER = 'dataLayer';

    // Their own: the container id and the data layer's name travel in the
    // query of the script that asks for the container.
    const settings = ( ) => {
        const found = { id: '', layer: DEFAULT_LAYER };
        const read = src => {
            if ( typeof src !== 'string' ) { return false; }
            if ( src.indexOf('googletagmanager.com') === -1 ) { return false; }
            if ( src.indexOf('/gtm.js') === -1 ) { return false; }
            let query = '';
            const pos = src.indexOf('?');
            if ( pos !== -1 ) { query = src.slice(pos + 1); }
            let id = '';
            let layer = '';
            for ( const pair of query.split('&') ) {
                const eq = pair.indexOf('=');
                if ( eq === -1 ) { continue; }
                const key = pair.slice(0, eq);
                const value = decodeURIComponent(pair.slice(eq + 1));
                if ( key === 'id' ) { id = value; }
                else if ( key === 'l' ) { layer = value; }
            }
            if ( id === '' ) { return false; }
            found.id = id;
            if ( layer !== '' ) { found.layer = layer; }
            return true;
        };
        try {
            const current = doc.currentScript;
            if ( current !== null && current !== undefined ) {
                if ( read(current.getAttribute('src') || current.src) ) {
                    return found;
                }
            }
        } catch(ex) {
        }
        // Injected as a scriptlet there is no currentScript, and the page's
        // own tag is still in the document to be read.
        try {
            const tags = doc.querySelectorAll('script[src]');
            for ( const tag of Array.from(tags) ) {
                if ( read(tag.getAttribute('src')) ) { return found; }
            }
        } catch(ex) {
        }
        return found;
    };

    const { id, layer } = settings();

    const stamp = ( ) => {
        try {
            return new w.Date().getTime();
        } catch(ex) {
        }
        return Date.now();
    };

    // Their registry, created the way theirs creates it:
    //   this.D = A.google_tag_manager = A.google_tag_manager || {}
    let registry = null;
    try {
        if ( w.google_tag_manager === undefined || w.google_tag_manager === null ) {
            w.google_tag_manager = {};
        }
        registry = w.google_tag_manager;
    } catch(ex) {
        return;
    }
    if ( registry === null || typeof registry !== 'object' ) { return; }

    // A second copy of this resource on the same page - two container ids on
    // one site is ordinary - registers its own id against the same registry
    // and leaves everything else alone.
    const already = registry.consentRRGtm === VERSION;

    // Their model, dA.R: a name, a dotted-path get, a set that merges, and a
    // reset. The values come from what the page itself pushes.
    const model = ( ) => {
        let values = {};
        const assign = (into, path, value) => {
            const parts = String(path).split('.');
            let cursor = into;
            for ( let i = 0; i < parts.length - 1; i += 1 ) {
                const part = parts[i];
                if ( cursor[part] === null || typeof cursor[part] !== 'object' ) {
                    cursor[part] = {};
                }
                cursor = cursor[part];
            }
            cursor[parts[parts.length - 1]] = value;
        };
        return {
            name: layer,
            set: (key, value) => {
                try {
                    assign(values, key, value);
                } catch(ex) {
                }
            },
            get: key => {
                try {
                    const parts = String(key).split('.');
                    let cursor = values;
                    for ( const part of parts ) {
                        if ( cursor === null ) { return false; }
                        if ( cursor === undefined ) { return undefined; }
                        cursor = cursor[part];
                    }
                    return cursor;
                } catch(ex) {
                }
                return undefined;
            },
            reset: ( ) => { values = {}; },
        };
    };

    const container = model();

    // Theirs merges a pushed event's own keys into the model, which is how
    // google_tag_manager[id].dataLayer.get("page.title") answers at all.
    const absorb = item => {
        if ( item === null || typeof item !== 'object' ) { return; }
        for ( const key of Object.keys(item) ) {
            if ( key === 'eventCallback' || key === 'eventTimeout' ) { continue; }
            container.set(key, item[key]);
        }
    };

    // Their eventCallback contract. The callback runs once: on the next tick,
    // which for a container with no tags to wait for is when theirs would
    // have run it, and never later than an eventTimeout that was asked for.
    const callBack = item => {
        let callback = null;
        try {
            callback = item.eventCallback;
        } catch(ex) {
            return;
        }
        if ( typeof callback !== 'function' ) { return; }
        const fire = ( ) => {
            try {
                // Theirs: k.apply(k, [].slice.call(arguments, 0)), and the
                // arguments it has at that point are none.
                callback.apply(callback, []);
            } catch(ex) {
            }
        };
        // eventTimeout is read only to keep it out of the model. Their timer
        // exists because their tags take time and the callback must not be
        // lost behind a slow one; nothing here takes any time, so the next
        // tick is always sooner than any bound a page could ask for. A second
        // timer for it would never be the one that ran.
        try {
            w.setTimeout(fire, 0);
            return;
        } catch(ex) {
        }
        fire();
    };

    // The array is the page's own and stays that way: only its push is
    // wrapped, exactly as theirs wraps it.
    const hook = ( ) => {
        let queue = null;
        try {
            if ( Array.isArray(w[layer]) === false ) { w[layer] = []; }
            queue = w[layer];
        } catch(ex) {
            return 'refused';
        }
        if ( Array.isArray(queue) === false ) { return 'refused'; }
        if ( queue.consentRRGtm === VERSION ) { return 'already'; }
        const push = queue.push;
        if ( typeof push !== 'function' ) { return 'refused'; }
        const wrapped = function( ) {
            const items = [].slice.call(arguments, 0);
            for ( const item of items ) {
                absorb(item);
                callBack(item);
            }
            // Theirs returns what the array's own push returned.
            return push.apply(queue, items);
        };
        try {
            queue.push = wrapped;
            Object.defineProperty(queue, 'consentRRGtm', {
                value: VERSION,
                enumerable: false,
            });
        } catch(ex) {
            return 'refused';
        }
        // Whatever the snippet pushed before this arrived is in the array
        // already, and theirs reads it on arrival.
        try {
            for ( const item of queue.slice(0) ) { absorb(item); }
        } catch(ex) {
        }
        return 'hooked';
    };

    const hooked = already ? 'already' : hook();

    // Their per-data-layer entry, where their own dom and load flags live.
    const state = ( ) => {
        let entry = registry[layer];
        if ( entry === null || typeof entry !== 'object' ) {
            entry = {};
            registry[layer] = entry;
        }
        if ( typeof entry.subscribers !== 'number' ) { entry.subscribers = 0; }
        entry.subscribers += 1;
        return entry;
    };

    const entry = already ? registry[layer] : state();

    // Their container object, field for field from RU().
    const install = ( ) => {
        if ( id === '' ) { return 'noid'; }
        if ( registry[id] !== undefined && registry[id] !== null ) {
            return 'kept';
        }
        const pending = {};
        registry[id] = {
            dataLayer: container,
            // Theirs is 0 only until the container has finished booting, at
            // which point it becomes a timestamp:
            //   UU().bootstrap = Xb()        Xb = function(){ return
            //                                 Wb().getTime() }
            // so a page watching it for the container to be ready would wait
            // for ever on a 0 that never changes. This one has nothing left
            // to do, so it is already stamped.
            bootstrap: stamp(),
            callback: name => {
                try {
                    if ( Object.prototype.hasOwnProperty.call(pending, name) ) {
                        const fn = pending[name];
                        if ( typeof fn === 'function' ) { fn(); }
                    }
                    delete pending[name];
                } catch(ex) {
                }
            },
            // Theirs are the handlers an injected HTML tag reports through.
            // Nothing is injected here, so they answer and do nothing.
            onHtmlSuccess: ( ) => undefined,
            onHtmlFailure: ( ) => undefined,
        };
        if ( registry.rm === undefined || registry.rm === null ) {
            registry.rm = {};
        }
        return 'installed';
    };

    const installed = already ? 'kept' : install();

    // Theirs pushes these two itself, once each, and a page's triggers hang
    // off them.
    const announce = ( ) => {
        const push = item => {
            try {
                w[layer].push(item);
            } catch(ex) {
            }
        };
        const dom = ( ) => {
            if ( entry === null || entry === undefined ) { return; }
            if ( entry.gtmDom === true ) { return; }
            entry.gtmDom = true;
            push({ event: 'gtm.dom' });
        };
        const load = ( ) => {
            if ( entry === null || entry === undefined ) { return; }
            if ( entry.gtmLoad === true ) { return; }
            entry.gtmLoad = true;
            push({ event: 'gtm.load' });
        };
        try {
            if ( doc.readyState === 'loading' ) {
                doc.addEventListener('DOMContentLoaded', dom, { once: true });
            } else {
                dom();
            }
            if ( doc.readyState === 'complete' ) { load(); }
            else { w.addEventListener('load', load, { once: true }); }
        } catch(ex) {
        }
    };

    if ( already === false ) { announce(); }

    try {
        registry.consentRRGtm = VERSION;
    } catch(ex) {
    }

    try {
        w.console.info(
            '[gtm-rr] ' + NAME + ' ' + VERSION +
            ' id=' + (id !== '' ? id : 'unknown') +
            ' layer=' + layer +
            ' push=' + hooked +
            ' container=' + installed
        );
    } catch(ex) {
    }
}
