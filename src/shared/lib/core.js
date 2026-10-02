/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    The part both of Google's loaders do, which in their own bundles is
    literally the same code: /gtm.js and /gtag/js are one engine behind two
    front doors, and their container picks between them with
      var c = cc(b, "GTM-") ? "/gtm.js" : "/gtag/js"

    Read off GTM-KJZD388, GTM-NSXXFR, GTM-W4F8P893 and a served gtag/js, which
    agreed on every structure below.

    The minified names quoted here are from the first two, and they move
    between builds: the container object is built by RU() in one and LU() in
    another, the data model is fA and then cA, the callback gate is Do and
    then Co. Match a structure by its shape when checking a new sample, never
    by the name - 401KB of one and 540KB of another agreed on every shape and
    on almost none of the names.

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
      no gtag                  neither loader defines it. The page's own
                               snippet does -
                                 function gtag(){ dataLayer.push(arguments) }
                               - and the bundle only reads what that pushes, so
                               defining one here would replace the page's.
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

function consentRRGtmCore(options) {
    const w = window;
    const doc = w.document;
    const VERSION = '@@VERSION@@';
    const DEFAULT_LAYER = 'dataLayer';
    const paths = options.paths;
    const extrasFor = options.extrasFor;
    const command = options.command;

    const settings = ( ) => {
        const found = { id: '', layer: DEFAULT_LAYER, path: '' };
        const read = src => {
            if ( typeof src !== 'string' ) { return false; }
            let wanted = '';
            for ( const path of paths ) {
                if ( src.indexOf(path) !== -1 ) { wanted = path; }
            }
            if ( wanted === '' ) { return false; }
            let query = '';
            const pos = src.indexOf('?');
            if ( pos !== -1 ) { query = src.slice(pos + 1); }
            let id = '';
            let layer = '';
            for ( const pair of query.split('&') ) {
                const eq = pair.indexOf('=');
                if ( eq === -1 ) { continue; }
                const key = pair.slice(0, eq);
                let value = pair.slice(eq + 1);
                try {
                    value = decodeURIComponent(value);
                } catch(ex) {
                }
                if ( key === 'id' ) { id = value; }
                else if ( key === 'l' ) { layer = value; }
            }
            if ( id === '' ) { return false; }
            found.id = id;
            found.path = wanted;
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

    // Served as a redirect, this knows which loader it is standing in for the
    // moment it runs: document.currentScript is the page's own tag, with the
    // id in its src. Injected as a scriptlet it has no such tag at
    // document_start - the page has not parsed it yet - and a scriptlet is
    // what a site whose CSP refuses a data: URI needs, since an injected
    // script has no URI to object to.
    //
    // So: start when a loader can be identified, and otherwise wait for one
    // and start then. A page that never loads a container never gets a
    // dataLayer, a registry or a word in the console out of this - which it
    // must not, because a global scriptlet runs on every page there is.
    const start = found => {
        const { id, layer, path } = found;

        // On, and saying everything it has: a page that half-works is reported
        // as "it half-works", and the useful question is which part of their API
        // the site asked for that is not here, and what it was trying to do with
        // it. On a page that works it says nothing at all.
        //
        // Three levels, and the middle one is the default:
        //
        //   off       nothing, and nothing wrapped: one storage read and no more
        //   quiet     the name of what was asked for, and who asked
        //   verbose   those, plus the arguments the page passed, plus every
        //             command that went nowhere - the default
        //   probe     those, and a missing method answers the call instead of
        //             failing it, so what the page meant to pass is reported
        //
        //   localStorage.setItem('gtm-rr-debug', 'probe')
        //   localStorage.setItem('gtm-rr-debug', 'quiet')
        //   localStorage.setItem('gtm-rr-debug', 'off')
        //
        // probe is for chasing something, not for leaving on. A read of a name
        // that is not here answers with a function, so
        //   google_tag_manager[id].whatever(a, b)
        // reports a and b instead of throwing - but a page that asks whether
        // something exists before using it now gets yes, and takes the other
        // branch. That is a different page from the one being debugged, which is
        // why it is not a default.
        //
        // What verbose carries that quiet does not is the page's own data - a
        // transaction id, a user_data payload, a path with an order number in it
        // - because the arguments to a call are what the call was for, and
        // without them the name of a missing thing often does not say whether it
        // mattered. A console does get pasted into bug reports, so quiet is there
        // for anyone who would rather it did not carry theirs.
        //
        // Everything this hands the page is watched through a get-only Proxy,
        // which leaves keys, values and behaviour alone - a page enumerating the
        // container object still sees exactly what it would have.
        const setting = ( ) => {
            try {
                const value = w.localStorage.getItem('gtm-rr-debug');
                if ( value === null ) { return 'verbose'; }
                const wanted = String(value).toLowerCase();
                if ( wanted === 'off' || wanted === '0' ) { return 'off'; }
                if ( wanted === 'quiet' ) { return 'quiet'; }
                if ( wanted === 'probe' ) { return 'probe'; }
                return 'verbose';
            } catch(ex) {
            }
            return 'verbose';
        };

        const level = setting();
        const debug = level !== 'off';
        const verbose = level === 'verbose' || level === 'probe';
        const probing = level === 'probe';
        const named = {};

        // What a page passed, bounded and shallow. A console line is something a
        // visitor pastes into a bug report, so this stays short, never walks into
        // an object's own getters twice, and never throws over something it was
        // handed.
        const CAP = 160;

        const snippet = value => {
            const one = item => {
                const type = typeof item;
                if ( item === null ) { return 'null'; }
                if ( type === 'undefined' ) { return 'undefined'; }
                if ( type === 'function' ) { return 'function'; }
                if ( type === 'string' ) { return JSON.stringify(item); }
                if ( type === 'number' || type === 'boolean' ) { return String(item); }
                if ( type === 'symbol' ) { return 'symbol'; }
                if ( Array.isArray(item) ) { return '[' + item.length + ' items]'; }
                try {
                    const keys = Object.keys(item);
                    const parts = [];
                    for ( const key of keys.slice(0, 8) ) {
                        const held = item[key];
                        const held_ = typeof held;
                        if ( held_ === 'object' && held !== null ) {
                            parts.push(key + ':{}');
                        } else if ( held_ === 'function' ) {
                            parts.push(key + ':function');
                        } else {
                            parts.push(key + ':' + JSON.stringify(held));
                        }
                    }
                    if ( keys.length > 8 ) { parts.push('+' + (keys.length - 8)); }
                    return '{' + parts.join(',') + '}';
                } catch(ex) {
                }
                return 'object';
            };
            try {
                const items = [];
                for ( const item of Array.from(value) ) { items.push(one(item)); }
                const text = '[' + items.join(',') + ']';
                if ( text.length <= CAP ) { return text; }
                return text.slice(0, CAP) + '...';
            } catch(ex) {
            }
            return 'unreadable';
        };

        // Which script asked, which is the part a report needs to be chased
        // at all - and this resource's own frames have to come off the stack
        // first, by source rather than by name. uBO injects a scriptlet from
        // a blob: URL belonging to the page, so in the field these frames
        // read
        //   get@blob:https://site/<uuid>:528:39
        // with names a page could just as well have used. Listing our own
        // function names and dropping those was wrong twice - first for
        // caller itself, then for the proxy's get trap - so what is dropped
        // is every leading frame from the same source as this function,
        // whatever it is called and whatever scheme it came from.
        //
        // jsdom evals everything from one file, so every frame shares a
        // source there and the answer is unknown: honest about what it knows
        // rather than pointing at the wrong thing.
        const sourceOf = frame => {
            // "at name (src:1:2)" and "name@src:1:2" are the two shapes.
            let match = /\(([^()]*)\)\s*$/.exec(frame);
            if ( match === null ) { match = /@(.*)$/.exec(frame); }
            if ( match === null ) { return ''; }
            return match[1].replace(/:\d+:\d+$/, '');
        };

        const caller = ( ) => {
            try {
                const frames = [];
                const stack = String(new w.Error().stack || '');
                for ( const line of stack.split('\n') ) {
                    const trimmed = line.trim();
                    if ( trimmed === '' ) { continue; }
                    if ( trimmed.startsWith('Error') ) { continue; }
                    frames.push(trimmed);
                }
                if ( frames.length === 0 ) { return 'unknown'; }
                const mine = sourceOf(frames[0]);
                for ( const frame of frames ) {
                    if ( mine !== '' && sourceOf(frame) === mine ) { continue; }
                    if ( frame.indexOf('<anonymous>') !== -1 ) { continue; }
                    if ( frame.length <= 120 ) { return frame; }
                    return frame.slice(0, 120) + '...';
                }
            } catch(ex) {
            }
            return 'unknown';
        };

        const report = (where, property, value) => {
            // Each name once: a page reading the same missing thing in a loop
            // should say so once, not fill the console.
            const key = where + '.' + property;
            if ( Object.prototype.hasOwnProperty.call(named, key) ) { return; }
            named[key] = true;
            try {
                // A property that is missing has no value to show - that is what
                // missing means - so what goes out is the name and who asked. A
                // command's arguments are its value, and those are echoed.
                w.console.info(
                    '[gtm-rr] ' + options.name + ' ' + VERSION +
                    ' missing=' + key +
                    ' id=' + (id !== '' ? id : 'unknown') +
                    (verbose && value !== undefined
                        ? ' args=' + snippet(value)
                        : '') +
                    ' from=' + caller()
                );
            } catch(ex) {
            }
        };

        // Only where it is on, and only for what the page asks for by name.
        // Names that change what an object is rather than what it does, so a
        // function is never handed back for one of them: a thenable breaks an
        // await, a toJSON breaks a stringify, and the rest are read by anything
        // that inspects a value.
        const STRUCTURAL = [
            'then', 'toJSON', 'valueOf', 'toString', 'constructor', 'inspect',
            'length', 'name', 'prototype', 'nodeType', 'tagName', 'item',
        ];

        const structural = Object.create(null);
        for ( const name of STRUCTURAL ) { structural[name] = true; }

        // In probe, a name that is not here answers with a function, so the call
        // a page was about to make happens and says what it carried instead of
        // throwing on undefined. One function per name, so repeated reads of the
        // same one give the same thing back - a page may compare them.
        const probes = Object.create(null);

        const probe = (where, property) => {
            if ( probes[property] === undefined ) {
                probes[property] = function( ) {
                    try {
                        const args = [].slice.call(arguments, 0);
                        w.console.info(
                            '[gtm-rr] ' + options.name + ' ' + VERSION +
                            ' called=' + where + '.' + property +
                            ' id=' + (id !== '' ? id : 'unknown') +
                            ' args=' + snippet(args) +
                            ' from=' + caller()
                        );
                    } catch(ex) {
                    }
                    return undefined;
                };
            }
            return probes[property];
        };

        const watch = (object, where, known) => {
            if ( debug === false ) { return object; }
            // A lookup rather than a scan: this runs on every property read a
            // page makes on what it was handed.
            const mine = Object.create(null);
            for ( const name of known ) { mine[name] = true; }
            try {
                return new w.Proxy(object, {
                    get(target, property, receiver) {
                        if ( typeof property !== 'string' ) {
                            return Reflect.get(target, property, receiver);
                        }
                        if ( mine[property] !== undefined ) {
                            return Reflect.get(target, property, receiver);
                        }
                        report(where, property);
                        if ( probing === false ) {
                            return Reflect.get(target, property, receiver);
                        }
                        if ( structural[property] !== undefined ) {
                            return Reflect.get(target, property, receiver);
                        }
                        const held = Reflect.get(target, property, receiver);
                        if ( held !== undefined ) { return held; }
                        return probe(where, property);
                    },
                });
            } catch(ex) {
            }
            return object;
        };

        const stamp = ( ) => {
            try {
                return new w.Date().getTime();
            } catch(ex) {
            }
            return Date.now();
        };

        let registry = null;
        try {
            if ( w.google_tag_manager === undefined || w.google_tag_manager === null ) {
                w.google_tag_manager = {};
            }
            registry = w.google_tag_manager;
        } catch(ex) {
            return null;
        }
        if ( registry === null || typeof registry !== 'object' ) { return null; }

        // Their own registry is get-or-create per key - ho(a, b) returns
        // c.D[a] = c.D[a] || b() - so what makes a second run a no-op is the id
        // already being there, not a flag on the registry. A page carrying a
        // container and a GA4 snippet gets this resource twice, once per script,
        // with a different id each time, and both have to register.
        const already = id !== '' &&
            registry[id] !== undefined && registry[id] !== null &&
            registry[id].consentRRGtm === VERSION;

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

        const container = watch(
            model(), 'dataLayer',
            [ 'name', 'get', 'set', 'reset' ]
        );

        const absorb = item => {
            if ( item === null || typeof item !== 'object' ) { return; }
            // An arguments object is what the page's own gtag() pushes, and that
            // is a command for their RD.* table rather than a model update, so
            // their own code does not merge one. Detected by its class: reading
            // .callee off one throws in strict mode, and this runs inside the
            // page's own call to push.
            if ( Object.prototype.toString.call(item) === '[object Arguments]' ) {
                return;
            }
            for ( const key of Object.keys(item) ) {
                if ( key === 'eventCallback' || key === 'eventTimeout' ) { continue; }
                container.set(key, item[key]);
            }
        };

        const callBack = item => {
            let callback = null;
            try {
                callback = item.eventCallback;
            } catch(ex) {
                return;
            }
            if ( typeof callback !== 'function' ) { return; }
            // Their own gate runs the callback once and once only - Go()
            // sets a.D and empties the list - so a once-guard in its place
            // is their contract, not an addition to it.
            //
            // It matters where a real container is running as well as this,
            // which is what an allowlisted site gives you: it wraps the same
            // push, this answers on the next tick and theirs answers when
            // its tags finish, and the page's callback runs twice. A form
            // that submits on it submits twice. Whoever gets there first now
            // wins and the second call is a no-op, whether the other caller
            // is a real container, a second container, or the page itself.
            let guard = callback;
            try {
                let answered = false;
                guard = function( ) {
                    if ( answered ) { return undefined; }
                    answered = true;
                    // Theirs applies the page's callback with the callback
                    // itself as this, so the guard hands that on rather than
                    // passing its own.
                    return callback.apply(callback, arguments);
                };
                item.eventCallback = guard;
            } catch(ex) {
                // A frozen object keeps its own callback; this still answers
                // once from here.
                guard = callback;
            }
            const fire = ( ) => {
                // A real container that bound itself to this data layer will
                // answer the callback when its own tags finish, and it read
                // the page's function before this guard existed if it wrapped
                // the push on top. Their own bookkeeping says when that has
                // happened: bind() does
                //   d.subscribers = (d.subscribers || 0) + 1
                // on the entry named after the layer. One more subscriber
                // than this resource accounted for means something else is
                // live and answering, and the quiet thing is to leave it to
                // them - two answers to one callback is a form that submits
                // twice.
                try {
                    const live = registry[layer];
                    if ( live !== null && typeof live === 'object' ) {
                        if ( live.subscribers > subscribed ) { return; }
                    }
                } catch(ex) {
                }
                try {
                    guard.apply(guard, []);
                } catch(ex) {
                }
            };
            // eventTimeout is read only to keep it out of the model. Their
            // timer exists because their tags take time and the callback must
            // not be lost behind a slow one; nothing here takes any time, so
            // the next tick is always sooner than any bound a page could ask
            // for.
            try {
                w.setTimeout(fire, 0);
                return;
            } catch(ex) {
            }
            fire();
        };

        // Google's anti-flicker snippet hides the page - it puts a class on the
        // document element and parks the undo on the data layer - and waits for
        // the container to call it. Theirs, run as it pumps messages:
        //
        //   try { var h = A[C(19)], k = C(5), m = h.hide;
        //         if (m && m[k] !== void 0 && m.end) {
        //             m[k] = !1;
        //             var p = !0, q;
        //             for (q in m) if (m.hasOwnProperty(q) && m[q] === !0) {
        //                 p = !1; break }
        //             p && (m.end(), m.end = null) } } catch(r) { C(5) }
        //
        // so it clears its own entry, and only ends the hiding when no other
        // container is still expected. Their snippet does carry a timer of its
        // own - four seconds by default - so a page whose container never
        // arrives is blank until that fires rather than for ever. Four seconds
        // of blank page is the thing worth not doing.
        //
        // Unconditionally ending it instead would un-hide a page that a second,
        // unblocked container is still loading for, which is theirs to do.
        let hiding = 'absent';
        // Theirs re-runs this as it pumps messages, because its own state is
        // changing underneath. Here nothing changes once it has ended the hiding,
        // decided the hiding is another container's, or found none - so it stops
        // looking rather than reading three properties on every push for the rest
        // of the page's life. Only 'absent' is worth asking again: the snippet
        // can run after this does.
        let settled = false;

        const unhide = ( ) => {
            if ( settled ) { return; }
            try {
                const queue = w[layer];
                if ( queue === null || typeof queue !== 'object' ) { return; }
                const hide = queue.hide;
                if ( hide === null || typeof hide !== 'object' ) {
                    // None on the page. Their snippet's whole job is hiding the
                    // page while it loads, so one that is not there by the time
                    // the document is ready is not coming - and theirs would have
                    // timed itself out anyway. Stop asking.
                    if ( doc.readyState !== 'loading' ) { settled = true; }
                    return;
                }
                if ( id === '' ) { return; }
                if ( hide[id] === undefined ) {
                    // Not listed, so not this container's to end.
                    hiding = 'theirs';
                    settled = true;
                    return;
                }
                if ( typeof hide.end !== 'function' ) { return; }
                hide[id] = false;
                for ( const key of Object.keys(hide) ) {
                    if ( hide[key] === true ) {
                        // Another container is still expected, and this one has
                        // said its piece by clearing its own entry: theirs is
                        // what ends it now.
                        hiding = 'waiting';
                        settled = true;
                        return;
                    }
                }
                const end = hide.end;
                hide.end = null;
                end();
                hiding = 'ended';
                settled = true;
            } catch(ex) {
            }
        };

        const handle = item => {
            unhide();
            absorb(item);
            callBack(item);
            if ( typeof command !== 'function' ) { return; }
            let answered = false;
            try {
                answered = command(item, w) === true;
            } catch(ex) {
            }
            // A command that went nowhere is this resource working, so it is
            // only worth a line where it was asked for.
            if ( verbose === false || answered ) { return; }
            // A command that went nowhere, which is most of them and the point of
            // this resource - but worth naming when a page is misbehaving, since
            // the one it was waiting on will be in here.
            try {
                if ( Object.prototype.toString.call(item) !== '[object Arguments]' ) {
                    return;
                }
                if ( typeof item[0] !== 'string' ) { return; }
                // Their command name, and what the page passed with it: the one
                // a misbehaving page was waiting on will be in here.
                report('command', item[0], [].slice.call(item, 1));
            } catch(ex) {
            }
        };

        // Their get-or-create, which only ever creates what is not there:
        //   function $c(a,b){ var c=A, d=c[a]; c[a] = d===void 0 ? b : d;
        //                     return c[a] }
        // and then wraps whatever push that object has. Replacing anything that
        // is not an array would throw away a data layer the page made itself,
        // along with whatever the page had put in it.
        const hook = ( ) => {
            let queue = null;
            try {
                if ( w[layer] === undefined ) { w[layer] = []; }
                queue = w[layer];
            } catch(ex) {
                return 'refused';
            }
            if ( queue === null || typeof queue !== 'object' ) { return 'refused'; }
            if ( queue.consentRRGtm === VERSION ) { return 'already'; }
            const push = queue.push;
            if ( typeof push !== 'function' ) { return 'nopush'; }
            const wrapped = function( ) {
                const items = [].slice.call(arguments, 0);
                for ( const item of items ) { handle(item); }
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
            // Whatever the snippet pushed before this arrived is in there
            // already, and theirs reads it on arrival. Only an array can be read
            // back that way.
            try {
                if ( Array.isArray(queue) ) {
                    for ( const item of queue.slice(0) ) { handle(item); }
                }
            } catch(ex) {
            }
            return 'hooked';
        };

        const hooked = already ? 'already' : hook();

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
        // What the count stood at once this resource had added itself, so a
        // later bind by something else is visible.
        let subscribed = 0;
        try {
            subscribed = entry !== null && typeof entry === 'object'
                ? entry.subscribers
                : 0;
        } catch(ex) {
        }

        // Their own entry carries more than these three - pruned, and whatever a
        // feature of theirs parks on it - so a read of something else is worth a
        // name.
        if ( already === false ) {
            try {
                registry[layer] = watch(entry, 'layer', [
                    'subscribers', 'gtmDom', 'gtmLoad',
                ]);
            } catch(ex) {
            }
        }

        const install = ( ) => {
            if ( id === '' ) { return 'noid'; }
            if ( registry[id] !== undefined && registry[id] !== null ) {
                return 'kept';
            }
            const pending = {};
            const object = {
                dataLayer: container,
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
            };
            // What the two loaders differ by, which the caller decides from the
            // path this is standing in for.
            if ( typeof extrasFor === 'function' ) {
                const extras = extrasFor(path);
                if ( extras !== null && typeof extras === 'object' ) {
                    for ( const key of Object.keys(extras) ) {
                        object[key] = extras[key];
                    }
                }
            }
            // The marker this reads to know it has already run for this id, kept
            // off the key set: theirs has no such field, and a page enumerating
            // the container object should see what theirs would.
            try {
                Object.defineProperty(object, 'consentRRGtm', {
                    value: VERSION,
                    enumerable: false,
                });
            } catch(ex) {
            }
            registry[id] = watch(object, 'container', [
                'dataLayer', 'bootstrap', 'callback',
                'onHtmlSuccess', 'onHtmlFailure', 'consentRRGtm',
            ]);
            if ( registry.rm === undefined || registry.rm === null ) {
                registry.rm = {};
            }
            return 'installed';
        };

        const installed = already ? 'kept' : install();

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

        if ( already === false ) {
            unhide();
            announce();
        }

        // And the registry itself, which their own code fills with far more than
        // this does: ho("tcf"), ho("gth"), ho("mb"), ho("r"), ho("ads_pageview")
        // and the sandboxed-JS semaphore are all created on demand by a feature
        // of theirs, and a page or a tag template reading one gets nothing from
        // here. Wrapped last, so everything this puts in it is already a name it
        // knows, and with a set trap so a key written later - by a second
        // container of theirs that was not replaced, say - is not then reported
        // as missing.
        const watchRegistry = ( ) => {
            if ( debug === false ) { return; }
            try {
                if ( registry.consentRRGtmWatched === VERSION ) { return; }
                const known = Object.create(null);
                for ( const key of Object.keys(registry) ) { known[key] = true; }
                known.consentRRGtmWatched = true;
                Object.defineProperty(registry, 'consentRRGtmWatched', {
                    value: VERSION,
                    enumerable: false,
                });
                w.google_tag_manager = new w.Proxy(registry, {
                    get(target, property, receiver) {
                        if ( typeof property === 'string' ) {
                            if ( known[property] === undefined ) {
                                report('google_tag_manager', property);
                            }
                        }
                        return Reflect.get(target, property, receiver);
                    },
                    set(target, property, value, receiver) {
                        if ( typeof property === 'string' ) {
                            known[property] = true;
                        }
                        return Reflect.set(target, property, value, receiver);
                    },
                });
            } catch(ex) {
            }
        };

        watchRegistry();
        const answer = {
            id, layer, path, hooked, installed, container, registry,
            hiding: ( ) => hiding,
            debug,
            level,
            report,
        };
        return answer;
    };

    const first = settings();
    if ( first.id !== '' ) { return start(first); }

    // Nothing to stand in for yet. Watch for the tag, and give up when their
    // own last sweep would have: a container that turns up after that is one
    // theirs would not have served either.
    const waiting = ( ) => {
        let observer = null;
        let done = false;
        const look = ( ) => {
            if ( done ) { return true; }
            const found = settings();
            if ( found.id === '' ) { return false; }
            done = true;
            try {
                if ( observer !== null ) { observer.disconnect(); }
            } catch(ex) {
            }
            const answer = start(found);
            if ( typeof options.started === 'function' ) {
                try {
                    options.started(answer);
                } catch(ex) {
                }
            }
            return true;
        };
        try {
            observer = new w.MutationObserver(( ) => { look(); });
            observer.observe(doc.documentElement || doc, {
                childList: true,
                subtree: true,
            });
        } catch(ex) {
        }
        const stop = ( ) => {
            try {
                w.setTimeout(( ) => {
                    if ( done ) { return; }
                    done = true;
                    try {
                        if ( observer !== null ) { observer.disconnect(); }
                    } catch(ex) {
                    }
                }, 600);
            } catch(ex) {
            }
        };
        try {
            if ( doc.readyState === 'loading' ) {
                doc.addEventListener('DOMContentLoaded', ( ) => { look(); },
                    { once: true });
            }
            if ( doc.readyState === 'complete' ) { stop(); }
            else {
                w.addEventListener('load', ( ) => {
                    look();
                    stop();
                }, { once: true });
            }
        } catch(ex) {
        }
        // One look now, in case the tag is already there and only the
        // currentScript was missing.
        look();
    };

    waiting();
    return null;
}
