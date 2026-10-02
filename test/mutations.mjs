/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    The mutations tools/mutate.mjs runs: each one breaks something the suite is
    supposed to notice. `from` has to match its file exactly once, or the
    mutation is reported stale rather than silently skipped - which is what
    happens when the code it was written against has moved.

*/

const CORE = 'src/shared/lib/core.js';
const GTM = 'src/gtm/lib/gtm-core.js';
const GA = 'src/ga/lib/ga-optout-core.js';

export default [

    // The push contract: what a page is waiting for.
    {
        label: 'eventCallback never run',
        file: CORE,
        from: '            w.setTimeout(fire, 0);',
        to: '',
    },
    {
        label: 'eventCallback gets the wrong this',
        file: CORE,
        from: '                callback.apply(callback, []);',
        to: '                callback.call(null);',
    },
    {
        label: 'push returns nothing',
        file: CORE,
        from: '            return push.apply(queue, items);',
        to: '            push.apply(queue, items);',
    },
    {
        label: 'a non-array data layer is replaced',
        file: CORE,
        from: '            if ( w[layer] === undefined ) { w[layer] = []; }',
        to: '            if ( Array.isArray(w[layer]) === false ) { w[layer] = []; }',
    },
    {
        label: 'a push is invented on a page object',
        file: CORE,
        from: "        if ( typeof push !== 'function' ) { return 'nopush'; }",
        to: "        if ( typeof push !== 'function' ) { queue.push = function(){}; }",
    },
    {
        label: 'the backlog is not read',
        file: CORE,
        from: '                for ( const item of queue.slice(0) ) { handle(item); }',
        to: '',
    },
    {
        label: 'a command is merged into the model',
        file: CORE,
        from: `        if ( Object.prototype.toString.call(item) === '[object Arguments]' ) {
            return;
        }`,
        to: '',
    },

    // The registry and the container object.
    {
        label: 'bootstrap left at zero',
        file: CORE,
        from: '            bootstrap: stamp(),',
        to: '            bootstrap: 0,',
    },
    {
        label: 'an existing container is overwritten',
        file: CORE,
        from: `        if ( registry[id] !== undefined && registry[id] !== null ) {
            return 'kept';
        }`,
        to: '',
    },
    {
        label: 'the marker is enumerable',
        file: CORE,
        from: `            Object.defineProperty(object, 'consentRRGtm', {
                value: VERSION,
                enumerable: false,
            });`,
        to: "            object.consentRRGtm = VERSION;",
    },
    {
        label: 'the container fields go on both loaders',
        file: GTM,
        from: `            if ( path !== '/gtm.js' ) { return {}; }`,
        to: '',
    },

    // Their two pushes, which a page's triggers hang off.
    {
        label: 'gtm.dom pushed more than once',
        file: CORE,
        from: '            entry.gtmDom = true;',
        to: '',
    },
    {
        label: 'no gtm.load on a page already loaded',
        file: CORE,
        from: "            if ( doc.readyState === 'complete' ) { load(); }",
        to: '            if ( false ) { load(); }',
    },

    // The anti-flicker undo.
    {
        label: 'the hiding is never ended',
        file: CORE,
        from: '            end();',
        to: '',
    },
    {
        label: 'the hiding is ended over another container',
        file: CORE,
        from: `            for ( const key of Object.keys(hide) ) {
                if ( hide[key] === true ) {
                    hiding = 'waiting';
                    return;
                }
            }`,
        to: '',
    },
    {
        label: 'a hiding that is not ours is ended',
        file: CORE,
        from: `            if ( hide[id] === undefined ) {
                // Not listed, so not this container's to end.
                hiding = 'theirs';
                return;
            }`,
        to: '',
    },

    // What comes off the script's own src.
    {
        label: 'a renamed data layer is ignored',
        file: CORE,
        from: `                else if ( key === 'l' ) { layer = value; }`,
        to: '',
    },
    {
        label: 'no fallback to the page own tag',
        file: CORE,
        from: `            const tags = doc.querySelectorAll('script[src]');`,
        to: '            const tags = [];',
    },

    // gtag's one command, and uBO's own noop.
    {
        label: 'a get is never answered',
        file: GTM,
        from: '            win.setTimeout(fire, 0);',
        to: '',
    },
    {
        label: 'a client id is invented',
        file: GTM,
        from: '                callback(undefined);',
        to: "                callback('GA1.1.1234567890.1234567890');",
    },
    {
        label: 'any command is answered as a get',
        file: GTM,
        from: `        if ( item[0] !== 'get' ) { return false; }`,
        to: '',
    },
    {
        label: 'a plain object is read as a command',
        file: GTM,
        from: `        if ( Object.prototype.toString.call(item) !== '[object Arguments]' ) {
            return false;
        }`,
        to: '',
    },
    {
        label: 'the ga noop uBO put up is dropped',
        file: GTM,
        from: `        if ( typeof w.ga !== 'function' ) {
            w.ga = function( ) {
                if ( gaCalls === null ) { return; }
                gaCalls(arguments);
            };
        }`,
        to: '',
    },
    {
        label: 'a better ga stub is overwritten',
        file: GTM,
        from: `        if ( typeof w.ga !== 'function' ) {`,
        to: '        if ( true ) {',
    },

    // The debug reporting, which is off unless a visitor turns it on.
    {
        label: 'debug: on by default',
        file: CORE,
        from: "            return w.localStorage.getItem('gtm-rr-debug') !== null;",
        to: '            return true;',
    },
    {
        label: 'debug: nothing is watched',
        file: CORE,
        from: '        if ( debug === false ) { return object; }',
        to: '        return object;',
    },
    {
        label: 'debug: known names reported too',
        file: CORE,
        from: '                        if ( known.indexOf(property) === -1 ) {',
        to: '                        if ( true ) {',
    },
    {
        label: 'debug: a name is reported every time',
        file: CORE,
        from: `        if ( Object.prototype.hasOwnProperty.call(named, key) ) { return; }
        named[key] = true;`,
        to: '',
    },
    {
        label: 'debug: an answered command is reported missing',
        file: CORE,
        from: '        if ( debug === false || answered ) { return; }',
        to: '        if ( debug === false ) { return; }',
    },
    {
        label: 'debug: the proxy changes what a page reads',
        file: CORE,
        from: '                    return Reflect.get(target, property, receiver);',
        to: '                    return undefined;',
    },
    {
        label: 'debug: ga calls are not named',
        file: GTM,
        from: `                report.report(
                    'ga', String(args[0]), [].slice.call(args, 1)
                );`,
        to: '',
    },

    {
        label: 'debug: command arguments are not echoed',
        file: CORE,
        from: "            report('command', item[0], [].slice.call(item, 1));",
        to: "            report('command', item[0]);",
    },
    {
        label: 'debug: a value is invented for a missing property',
        file: CORE,
        from: "                (value !== undefined ? ' args=' + snippet(value) : '') +",
        to: "                ' args=' + snippet(value) +",
    },
    {
        label: 'debug: what is echoed is unbounded',
        file: CORE,
        from: "            if ( text.length <= CAP ) { return text; }\n            return text.slice(0, CAP) + '...';",
        to: '            return text;',
    },
    {
        label: 'debug: the caller is not named',
        file: CORE,
        from: "                ' from=' + caller()",
        to: "                ''",
    },

    // The opt-out, which is a different job in the same repo.
    {
        label: 'optout: ioo answers false',
        file: GA,
        from: '            object.ioo = ( ) => true;',
        to: '            object.ioo = ( ) => false;',
    },
    {
        label: 'optout: no attribute on the document',
        file: GA,
        from: "            root.setAttribute(ATTRIBUTE, '');",
        to: '',
    },
    {
        label: 'optout: a page prefs object is discarded',
        file: GA,
        from: `            if ( object === null || typeof object !== 'object' ) {
                object = {};
            }`,
        to: '            object = {};',
    },
    {
        label: 'optout: no per-id flag',
        file: GA,
        from: "            w['ga-disable-' + id] = true;",
        to: '',
    },
    {
        label: 'optout: ids in a snippet are missed',
        file: GA,
        from: '                for ( const id of idsFromText(tag.textContent) ) { take(id); }',
        to: '',
    },
    {
        label: 'optout: anything prefixed counts as an id',
        file: GA,
        from: `            const rest = value.slice(prefix.length);
            if ( rest === '' ) { return false; }
            return /^[A-Za-z0-9-]+$/.test(rest);`,
        to: '            return true;',
    },
    {
        label: 'optout: runs again on reinjection',
        file: GA,
        from: '    if ( w[FLAG] === VERSION ) { return; }',
        to: '',
    },
];
