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
const TAG = 'src/tag/gtm-tag.js';
// The build too: what it emits is what ships, so the one-file delivery is
// worth the same treatment as the resources in it.
const BUILD = 'tools/build.mjs';

export default [

    // The push contract: what a page is waiting for.
    {
        label: 'eventCallback never run',
        file: CORE,
        from: '            w.setTimeout(fire, 0);',
        to: '',
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
        from: `            if ( Object.prototype.toString.call(item) === '[object Arguments]' ) {
                return;
            }`,
        to: '',
    },

    {
        label: 'no once-guard on the page callback',
        file: CORE,
        from: '                item.eventCallback = guard;',
        to: '',
    },
    {
        label: 'the guard passes its own this',
        file: CORE,
        from: '                    return callback.apply(callback, arguments);',
        to: '                    return callback.apply(this, arguments);',
    },

    {
        label: 'never stands aside for a live container',
        file: CORE,
        from: '            if ( yieldTo() ) { return; }',
        to: '',
    },
    {
        label: 'stands aside with no live container',
        file: CORE,
        from: '            if ( liveContainer() === false ) { return false; }',
        to: '',
    },
    {
        label: 'yields but leaves the proxy on',
        file: CORE,
        from: '                if ( w.google_tag_manager !== registry ) {\n                    w.google_tag_manager = registry;\n                }',
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
        from: `            if ( registry[id] !== undefined && registry[id] !== null ) {
                return 'kept';
            }`,
        to: '',
    },
    {
        label: 'the marker is enumerable',
        file: CORE,
        from: `                Object.defineProperty(object, 'consentRRGtm', {
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
        from: `                for ( const key of Object.keys(hide) ) {
                    if ( hide[key] === true ) {
                        // Another container is still expected, and this one has
                        // said its piece by clearing its own entry: theirs is
                        // what ends it now.
                        hiding = 'waiting';
                        settled = true;
                        return;
                    }
                }`,
        to: '',
    },
    {
        label: 'a hiding that is not ours is ended',
        file: CORE,
        from: `                if ( hide[id] === undefined ) {
                    // Not listed, so not this container's to end.
                    hiding = 'theirs';
                    settled = true;
                    return;
                }`,
        to: '',
    },

    {
        // Equivalent, and declared so rather than chased again: without the
        // early return the check runs on every push for the life of the page
        // and reaches the same answer each time. Ended, hide.end is already
        // null and it returns; another container's, and its entry is still
        // undefined; waiting, and that container clears its own entry and
        // ends the hiding itself, as the real one does and as a second copy
        // of this resource does for its own id. The difference is CPU, which
        // is why the return is there - see the benchmark in the commit that
        // added it.
        label: 'the hiding check never settles',
        file: CORE,
        from: '        if ( settled ) { return; }',
        to: '',
        equivalent: true,
    },
    {
        label: 'the hiding check settles before the snippet can run',
        file: CORE,
        from: "                if ( doc.readyState !== 'loading' ) { settled = true; }",
        to: '                settled = true;',
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
        from: `            if ( typeof w.ga !== 'function' ) {
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
        label: 'debug: off by default',
        file: CORE,
        from: "            if ( value === null ) { return 'verbose'; }",
        to: "            if ( value === null ) { return 'off'; }",
    },
    {
        label: 'debug: default is only names',
        file: CORE,
        from: "            if ( value === null ) { return 'verbose'; }",
        to: "            if ( value === null ) { return 'quiet'; }",
    },
    {
        label: 'debug: cannot be quietened',
        file: CORE,
        from: "            if ( wanted === 'quiet' ) { return 'quiet'; }",
        to: '',
    },
    {
        label: 'debug: cannot be silenced',
        file: CORE,
        from: "            if ( wanted === 'off' || wanted === '0' ) { return 'off'; }",
        to: '',
    },
    {
        label: 'debug: page data echoed at the quiet level',
        file: CORE,
        from: "    const verbose = level === 'verbose' || level === 'probe';",
        to: "    const verbose = level !== 'off';",
    },
    {
        label: 'debug: verbose by default',
        file: CORE,
        from: "    const verbose = level === 'verbose' || level === 'probe';",
        to: '    const verbose = true;',
    },
    {
        label: 'debug: page data echoed by default',
        file: CORE,
        from: "                    (verbose && value !== undefined\n                        ? ' args=' + snippet(value)\n                        : '') +",
        to: "                (value !== undefined ? ' args=' + snippet(value) : '') +",
    },
    {
        label: 'debug: every command reported by default',
        file: CORE,
        from: '        if ( verbose === false || answered ) { return; }',
        to: '        if ( debug === false || answered ) { return; }',
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
        from: `                        if ( mine[property] !== undefined ) {
                            return Reflect.get(target, property, receiver);
                        }`,
        to: '',
    },
    {
        label: 'debug: a name is reported every time',
        file: CORE,
        from: `            if ( Object.prototype.hasOwnProperty.call(named, key) ) { return; }
            named[key] = true;`,
        to: '',
    },
    {
        label: 'debug: an answered command is reported missing',
        file: CORE,
        from: '        if ( verbose === false || answered ) { return; }',
        to: '        if ( answered === false ) { return; }',
    },
    {
        label: 'debug: the proxy changes what a page reads',
        file: CORE,
        from: `                        if ( probing === false ) {
                            return Reflect.get(target, property, receiver);
                        }`,
        to: `                    if ( probing === false ) {
                        return undefined;
                    }`,
    },
    {
        label: 'debug: ga calls are not named',
        file: GTM,
        from: `                    report.report(
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
        from: "                    (verbose && value !== undefined\n                        ? ' args=' + snippet(value)\n                        : '') +",
        to: "                ' args=' + snippet(value) +",
    },
    {
        label: 'debug: what is echoed is unbounded',
        file: CORE,
        from: "                if ( text.length <= CAP ) { return text; }\n                return text.slice(0, CAP) + '...';",
        to: '            return text;',
    },
    {
        label: 'debug: the caller is not named',
        file: CORE,
        from: `                    (verbose && value !== undefined
                        ? ' args=' + snippet(value)
                        : '') +
                    ' from=' + caller()`,
        to: `                (verbose && value !== undefined
                    ? ' args=' + snippet(value)
                    : '') +
                ''`,
    },

    {
        label: 'debug: the registry is not watched',
        file: CORE,
        from: '    watchRegistry();',
        to: '',
    },
    {
        label: 'debug: the layer entry is not watched',
        file: CORE,
        from: `                registry[layer] = watch(entry, 'layer', [
                    'subscribers', 'gtmDom', 'gtmLoad',
                ]);`,
        to: '            registry[layer] = entry;',
    },
    {
        label: 'debug: a later key is reported as missing',
        file: CORE,
        from: `                    set(target, property, value, receiver) {
                        if ( typeof property === 'string' ) {
                            known[property] = true;
                        }
                        return Reflect.set(target, property, value, receiver);
                    },`,
        to: `                set(target, property, value, receiver) {
                    return Reflect.set(target, property, value, receiver);
                },`,
    },
    {
        label: 'debug: the registry is wrapped twice',
        file: CORE,
        from: "            if ( registry.consentRRGtmWatched === VERSION ) { return; }",
        to: '',
    },

    {
        label: 'probe: a missing method is not answered',
        file: CORE,
        from: '                    if ( probing === false ) {',
        to: '                    if ( true ) {',
    },
    {
        label: 'probe: answers at every level',
        file: CORE,
        from: "    const probing = level === 'probe';",
        to: '    const probing = debug;',
    },
    {
        label: 'probe: structural names answered too',
        file: CORE,
        from: '                        if ( structural[property] !== undefined ) {\n                            return Reflect.get(target, property, receiver);\n                        }',
        to: '',
    },
    {
        label: 'probe: a new function on every read',
        file: CORE,
        from: '        if ( probes[property] === undefined ) {',
        to: '        if ( true ) {',
    },
    {
        label: 'probe: a real value is replaced by a function',
        file: CORE,
        from: '                        const held = Reflect.get(target, property, receiver);\n                        if ( held !== undefined ) { return held; }',
        to: '',
    },
    {
        label: 'probe: the call is not reported',
        file: CORE,
        from: "                        ' called=' + where + '.' + property +",
        to: "                        ' called=' +",
    },

    {
        label: 'starts on a page with no loader at all',
        file: CORE,
        from: "    if ( first.id !== '' ) { return start(first); }",
        to: '    return start(first);',
    },
    {
        label: 'never starts when the tag turns up later',
        file: CORE,
        from: '    waiting();',
        to: '',
    },
    {
        label: 'the watch for a tag never stops',
        file: CORE,
        from: '                w.setTimeout(( ) => {\n                    if ( done ) { return; }\n                    done = true;',
        to: '                w.setTimeout(( ) => {\n                    if ( true ) { return; }\n                    done = true;',
        // Equivalent: the timer only stops a watch that has not fired, and a
        // watch that never stops reaches the same answers - it just keeps a
        // disconnected-from-nothing observer alive for the life of the page.
        equivalent: true,
    },
    {
        label: 'the ga noop goes up with no loader to stand in for',
        file: GTM,
        from: "        try {\n            if ( typeof w.ga !== 'function' ) {",
        to: '        try {\n            if ( true ) {',
    },

    {
        label: 'debug: our own frames are named as the caller',
        file: CORE,
        from: "                    if ( mine !== '' && sourceOf(frame) === mine ) { continue; }",
        to: '',
    },
    {
        label: 'debug: the caller source is read off the wrong frame',
        file: CORE,
        from: '                const mine = sourceOf(frames[0]);',
        to: "                const mine = '';",
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

    // The one-tag loader, where the url comes from the filter.
    {
        label: 'bundle: a resource is left out of the one-file delivery',
        file: BUILD,
        from: '        bundled.push(file);',
        to: '',
    },
    {
        label: 'bundle: the resources run together with no blank line',
        file: BUILD,
        from: "    const bundle = bundled.join('\\n');",
        to: "    const bundle = bundled.join('');",
    },
    {
        label: 'gtag: a command callback is not looked for',
        file: CORE,
        from: "            if ( item[0] !== 'event' ) { return null; }",
        to: "            if ( item[0] !== 'nothing-is-this' ) { return null; }",
    },
    {
        label: 'gtag: any command shape is answered',
        file: CORE,
        from: '            if ( item.length !== 3 ) { return null; }\n' +
            "            if ( item[0] !== 'event' ) { return null; }\n" +
            "            if ( typeof item[1] !== 'string' ) { return null; }",
        to: '',
    },
    {
        label: 'gtag: the callback is answered more than once',
        file: CORE,
        from: '                holder[field] = guard;',
        to: '',
    },
    {
        label: 'templates: run without a filter asking for them',
        file: GTM,
        from: "    if ( from !== 'self' ) {\n" +
            "        if ( selector !== '' ) { templates(); }\n" +
            '        return;\n    }',
        to: '    templates();',
    },
    {
        label: 'templates: the resource stands in for the container twice',
        file: 'src/gtm/googletagmanager_gtm.js',
        from: "consentRRGtm('', '', 'self');",
        to: 'consentRRGtm();',
    },
    {
        label: 'templates: run on a page this never stood in for',
        file: GTM,
        from: "        if ( report.installed === 'installed' ) { scan(); }",
        to: '        scan();',
    },
    {
        label: 'templates: markup in a template is no objection',
        file: GTM,
        from: '        if ( children.length !== scripts.length ) { return false; }',
        to: '',
    },
    {
        label: 'templates: a src in a template is no objection',
        file: GTM,
        from: "                if ( script.hasAttribute('src') ) { return false; }",
        to: '',
    },
    {
        label: 'templates: code that would load a third party is run',
        file: GTM,
        from: '        return reEmbeds.test(code) === false;',
        to: '        return true;',
    },
    {
        label: 'templates: a page with nothing to run is reported anyway',
        file: GTM,
        from: '        if ( ran === 0 ) { return; }',
        to: '',
    },
    {
        label: 'templates: anything matching the selector is run',
        file: GTM,
        from: "                if ( template.localName !== 'template' ) { continue; }",
        to: '',
    },
    {
        label: 'templates: a named template is run again on every look',
        file: GTM,
        from: "                if ( template.localName !== 'template' ) { continue; }\n" +
            '                if ( template.hasAttribute(MARKED) ) { continue; }',
        to: "                if ( template.localName !== 'template' ) { continue; }",
    },
    {
        label: 'templates: the page own code is run again on every look',
        file: GTM,
        from: '                if ( template.hasAttribute(MARKED) ) { continue; }\n' +
            '            } catch(ex) {\n' +
            '                continue;\n' +
            '            }\n' +
            '            if ( codeOnly(template) === false ) {',
        to: '            } catch(ex) {\n' +
            '                continue;\n' +
            '            }\n' +
            '            if ( codeOnly(template) === false ) {',
    },
    {
        label: 'templates: a script the page marked as not JavaScript is run',
        file: GTM,
        from: '            if ( runnable(type) === false ) {\n' +
            '                left += 1;\n' +
            '                continue;\n            }',
        to: '',
    },
    {
        label: 'templates: the global they need is not waited for',
        file: GTM,
        from: "        if ( needs === '' ) { return false; }",
        to: '        if ( true ) { return false; }',
    },
    {
        label: 'templates: one look and no more',
        file: GTM,
        from: '        try {\n            w.setTimeout(look, step);\n' +
            '        } catch(ex) {\n        }',
        to: '',
    },
    {
        label: 'tag: no url at all is loaded as a url',
        file: TAG,
        from: '    if ( given(url) === false ) { return; }',
        to: '',
    },
    {
        label: 'tag: anything but https is accepted',
        file: TAG,
        from: "    if ( wanted.protocol !== 'https:' ) {\n        say('refused=not-https url=' + wanted.protocol);\n        return;\n    }",
        to: '',
    },
    {
        label: 'tag: loaded again on every run',
        file: TAG,
        from: '            if ( w[MARKER][id] === true ) { return true; }',
        to: '',
    },
    {
        label: 'tag: the marker is this function own name',
        file: TAG,
        from: "    const MARKER = 'consentRRGtmTagLoaded';",
        to: "    const MARKER = 'consentRRGtmTag';",
    },
    {
        label: 'tag: does not wait for the global it needs',
        file: TAG,
        from: '        if ( ready() ) { inject(); }\n        else { look(); }',
        to: '        inject();',
    },
    {
        label: 'tag: the trigger is not tested',
        file: TAG,
        from: '        if ( given(when) === false ) { return true; }\n' +
            '        const value = layerValue();',
        to: '        if ( true ) { return true; }\n' +
            '        const value = layerValue();',
    },
    {
        label: 'tag: an unmatched trigger is given the benefit of the doubt',
        file: TAG,
        from: "                if ( matched() === false ) {\n" +
            "                    say('gave-up=' + when + ' after=' + UNTIL + " +
            "'ms');\n                    return;\n                }",
        to: '',
    },
    {
        label: 'tag: the first write of a data layer key wins',
        file: TAG,
        from: '                if ( ok ) { found = node; }',
        to: '                if ( ok && found === undefined ) { found = node; }',
    },
    {
        label: 'tag: any key holding the value matches',
        file: TAG,
        from: '                    if ( Object.prototype.hasOwnProperty.call(node, part) === false ) {\n' +
            '                        ok = false;\n' +
            '                        break;\n' +
            '                    }',
        to: '',
    },
    {
        label: 'tag: a placeholder counts as the real thing',
        file: TAG,
        from: '            return placeholder(fn) === false;',
        to: '            return true;',
    },
    {
        label: 'tag: a page that only ever has a placeholder gets nothing',
        file: TAG,
        from: "                if ( given(needs) && typeof w[needs] === " +
            "'function' ) {\n" +
            "                    say('waited-out=' + needs + ' after=' + " +
            "UNTIL + 'ms');\n                    inject();\n" +
            "                    return;\n                }",
        to: '',
    },
    {
        label: 'tag: looks before the page\'s own ready handlers run',
        file: TAG,
        from: '            w.setTimeout(begin, 0);',
        to: '            begin();',
    },
    {
        label: 'tag: injects while the page is still parsing',
        file: TAG,
        from: "        if ( doc.readyState !== 'loading' ) { begin(); }\n" +
            "        else {\n" +
            "            doc.addEventListener('DOMContentLoaded', soon, " +
            "{ once: true });\n        }",
        to: '        begin();',
    },
    {
        label: 'tag: the wait never backs off',
        file: TAG,
        from: '            const step = waited < RACE ? EVERY : SLOWER;',
        to: '            const step = EVERY;',
    },
    {
        label: 'tag: the wait is slow from the start',
        file: TAG,
        from: '            const step = waited < RACE ? EVERY : SLOWER;',
        to: '            const step = SLOWER;',
    },
    {
        label: 'tag: waits for ever',
        file: TAG,
        from: '            if ( waited >= UNTIL ) {',
        to: '            if ( false ) {',
    },
];
