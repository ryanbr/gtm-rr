/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Prints the scripts a container would inject, and a gtm-tag filter line for
    each, so a site that keeps page functionality inside GTM can have that one
    tag back without the container.

    This is deliberately a tool and not a feature. The same thing could be done
    at runtime - uBO's own rule for gtm.js is $script, so a fetch of the
    container is not redirected - but it would mean a 740KB request to Google
    on every page view, from the resource the user installed to avoid exactly
    that, and then a judgement about which tags are "functional" that this
    cannot make: the __html tags in a real container include a consent
    manager, a map loader and a LinkedIn tracker side by side. Read once, by
    hand, into a filter you can see is the honest version.

    Usage:
      node tools/tags.mjs GTM-MWKBJV [more ids...]

*/

const ids = process.argv.slice(2);
if ( ids.length === 0 ) {
    console.log('usage: node tools/tags.mjs <GTM-XXXX|G-XXXX> [...]');
    process.exit(1);
}

// Their config is JSON-escaped inside the bundle, so a url reads as
// https:\/\/host\/path and a template may carry \x3d for '='.
const unescape = text => text
    // Their templates are escaped twice over: JSON inside the bundle, then
    // \\x3d inside the template. Collapse the doubled backslashes first or
    // a url stops at the one before its first '='.
    .replace(/\\\\/g, '\\')
    .replace(/\\\//g, '/')
    .replace(/\\x3d/gi, '=')
    .replace(/\\x26/gi, '&')
    .replace(/\\x2f/gi, '/')
    // Their compiler escapes these inside strings too: a selector reads as
    // ".gtm-top-banner \\x3e div" and a match that stops at a backslash
    // misses it, which is how a tag writing into the page went unreported.
    .replace(/\\x3c/gi, '<')
    .replace(/\\x3e/gi, '>')
    .replace(/\\x27/gi, "'")
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\"/g, '"');

const fetchContainer = async id => {
    const path = id.startsWith('GTM-') ? 'gtm.js' : 'gtag/js';
    const url = `https://www.googletagmanager.com/${path}?id=${encodeURIComponent(id)}`;
    const response = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0' },
    });
    if ( response.ok === false ) {
        throw new Error(`${id}: HTTP ${response.status}`);
    }
    return await response.text();
};

// Their config is a JavaScript object literal, not JSON - the strings carry
// \x3d escapes that JSON.parse refuses - so the arrays are split by hand.
// String-aware, because a vtp_html template is full of braces and commas.
const splitArray = (text, key) => {
    const at = text.indexOf('"' + key + '":[');
    if ( at === -1 ) { return []; }
    return splitFrom(text, text.indexOf('[', at));
};

const splitFrom = (text, start) => {
    const out = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    let cur = start + 1;
    for ( let i = start; i < text.length; i++ ) {
        const c = text[i];
        if ( inString ) {
            if ( escaped ) { escaped = false; }
            else if ( c === '\\' ) { escaped = true; }
            else if ( c === '"' ) { inString = false; }
            continue;
        }
        if ( c === '"' ) { inString = true; continue; }
        if ( c === '[' || c === '{' ) { depth += 1; continue; }
        if ( c === ']' || c === '}' ) {
            depth -= 1;
            if ( depth === 0 ) { out.push(text.slice(cur, i)); return out; }
            continue;
        }
        if ( c === ',' && depth === 1 ) {
            out.push(text.slice(cur, i));
            cur = i + 1;
        }
    }
    return out;
};

// What a container tests before firing a tag. The same condition gtm-tag
// takes as its third argument: a data layer variable and a substring.
//   {"function":"_cn","arg0":["macro",24],"arg1":"DealerLocator"}
//   macro 24 = {"function":"__v","vtp_name":"PageType"}
// so the tag is held behind PageType=DealerLocator, and a filter without
// that condition loads the tag on every page of the site, because a
// scriptlet filter cannot be scoped to a path.
const triggersFrom = text => {
    const macros = splitArray(text, 'macros').map(raw => {
        const kind = /"function":"(__[a-z]+)"/.exec(raw);
        const name = /"vtp_name":"((?:[^"\\]|\\.)*)"/.exec(raw);
        // __u is the url, and which part of it is in vtp_component. PATH is
        // the one gtm-tag can be given, as path=.
        const part = /"vtp_component":"([A-Z_]+)"/.exec(raw);
        return {
            kind: kind !== null ? kind[1] : '',
            name: name !== null ? unescape(name[1]) : '',
            part: part !== null ? part[1] : '',
        };
    });
    const predicates = splitArray(text, 'predicates').map(raw => {
        const fn = /"function":"(_[a-z]{2})"/.exec(raw);
        const macro = /"arg0":\["macro",(\d+)\]/.exec(raw);
        const value = /"arg1":"((?:[^"\\]|\\.)*)"/.exec(raw);
        return {
            fn: fn !== null ? fn[1] : '',
            macro: macro !== null ? Number(macro[1]) : -1,
            value: value !== null ? unescape(value[1]) : '',
        };
    });
    // Rules are plain numbers and short words, so these do parse.
    const rules = [];
    for ( const raw of splitArray(text, 'rules') ) {
        try {
            rules.push(JSON.parse(raw));
        } catch(ex) {
        }
    }
    // tag index -> the conditions of every rule that adds it
    const byTag = new Map();
    for ( const rule of rules ) {
        const ifs = [];
        const adds = [];
        for ( const clause of rule ) {
            if ( Array.isArray(clause) === false ) { continue; }
            const [ what, ...rest ] = clause;
            if ( what === 'if' ) { ifs.push(...rest); }
            else if ( what === 'add' ) { adds.push(...rest); }
        }
        for ( const index of adds ) {
            const had = byTag.get(index) || [];
            for ( const i of ifs ) {
                const p = predicates[i];
                if ( p === undefined ) { continue; }
                const m = macros[p.macro];
                if ( m === undefined ) { continue; }
                had.push({
                    ...p,
                    variable: m.kind === '__v' ? m.name : '',
                    path: m.kind === '__u' && m.part === 'PATH',
                });
            }
            byTag.set(index, had);
        }
    }
    return byTag;
};

// A tag's html, in both forms GTM stores it in. A plain string, or - when a
// container variable is interpolated into the tag - an array:
//
//   "vtp_html":["template","\u003Cscript\u003E...",["macro",7],"..."]
//
// 24 of the 203 __html tags in one real container are in that second form,
// and reading only the string form skipped every one of them silently. The
// string pieces are what can be read; a macro is a value only the container
// resolves, so it is marked and left in place.
const htmlFrom = entry => {
    const key = '"vtp_html":';
    const at = entry.indexOf(key);
    if ( at === -1 ) { return ''; }
    const rest = entry.slice(at + key.length);
    if ( rest.startsWith('"') ) {
        const one = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
        return one === null ? '' : unescape(one[1]);
    }
    if ( rest.startsWith('[') === false ) { return ''; }
    const parts = splitFrom(rest, 0);
    const out = [];
    for ( const part of parts ) {
        const piece = part.trim();
        if ( piece === '"template"' ) { continue; }
        if ( piece.startsWith('"') ) {
            const one = /^"((?:[^"\\]|\\.)*)"/.exec(piece);
            if ( one !== null ) { out.push(unescape(one[1])); }
            continue;
        }
        if ( piece.startsWith('[') ) {
            const macro = /\["macro",(\d+)\]/.exec(piece);
            out.push(macro !== null ? '{{macro ' + macro[1] + '}}' : '{{value}}');
        }
    }
    return out.join('');
};

// Every __html tag, with what it would inject and what the container says it
// is for. Their "metadata" often names the purpose - both the OneTrust and
// the Maps entry in petzl's container are tagged ["map"].
const tagsFrom = text => {
    const found = [];
    const writes = [];
    const triggers = triggersFrom(text);
    const entries = splitArray(text, 'tags');
    for ( let index = 0; index < entries.length; index++ ) {
        const entry = entries[index];
        if ( entry.includes('"function":"__html"') === false ) { continue; }
        const html = htmlFrom(entry);
        if ( html === '' ) { continue; }
        // Scripts only. A src= anywhere would do, and did: shonenjumpplus's
        // container writes banner HTML into the page, and every <img src> in
        // it was reported as a script the container loads.
        const urls = [];
        for ( const re of [
            // <script ... src="...">
            /<script[^>]*?\ssrc\s*=\s*\\?["']?([^"'\s>\\]+)/gi,
            // a.src = "..." next to a createElement('script')
            /\.src\s*=\s*\\?["']([^"'\\]+)/g,
        ] ) {
            let one = re.exec(html);
            while ( one !== null ) {
                const url = one[1];
                const fromScriptEl = re.source.startsWith('\\.src') === false ||
                    /createElement\(\\?["']script/i.test(html);
                if ( fromScriptEl && isWholeUrl(url) ) {
                    urls.push(asHttps(url));
                }
                one = re.exec(html);
            }
        }
        // A loader asked for with a callback needs that name to exist first.
        const callback = /[?&]callback=([A-Za-z0-9_$.]+)/.exec(html);
        // Their "metadata" is a GTM key-value map, serialised as
        // ["map", key, value, ...] - so a bare ["map"] is an EMPTY map and
        // says nothing at all. Printing it as if it named the tag's purpose
        // was a misreading: petzl's map tags carry ["map"] and so does every
        // tag in shonenjumpplus's container. Only the pairs are worth a word.
        const head = entry.slice(0, entry.indexOf('"vtp_html"'));
        const metaRaw = /"metadata":\[([^\]]*)\][^{]*$/.exec(head);
        const pairs = metaRaw === null
            ? []
            : metaRaw[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''))
                .filter(s => s !== '' && s !== 'map');
        const metadata = pairs.length !== 0 ? pairs.join('=') : '';
        // Only a data layer variable tested for a substring or an exact
        // value: that is what gtm-tag can be given. Anything else is for a
        // person to read.
        const conditions = triggers.get(index) || [];
        for ( const url of urls ) {
            found.push({
                url,
                callback: callback !== null ? callback[1] : '',
                metadata,
                conditions,
            });
        }
        // A tag that writes into the page rather than loading anything. This
        // is the other way a container holds page functionality, and no
        // resource can stand in for it: shonenjumpplus's container fills ten
        // carousel slides with campaign HTML and hardcoded dates, then fires
        // the event the page's carousel waits for. There is nothing to put in
        // a filter - only something to know before promising a fix.
        if ( /innerHTML|\.html\(|insertAdjacent|appendChild|\.text\(/.test(html) ) {
            const targets = new Set();
            for ( const m of html.matchAll(
                /(?:querySelector(?:All)?\(|\$\()\s*\\?["']([^"'\\]{2,60})["']/g
            ) ) {
                targets.add(m[1]);
            }
            if ( targets.size !== 0 ) {
                writes.push({ targets: [ ...targets ], conditions });
            }
        }
    }
    return { found, writes };
};

// Hosts that are plainly ad or analytics infrastructure. Not a filter list,
// just enough to put a human's attention on the few tags that are not.
const KNOWN_TRACKERS = [
    'facebook.com', 'facebook.net', 'linkedin.com', 'licdn.com',
    'ads-twitter.com', 'analytics.twitter.com', 't.co', 'adsrvr.org',
    'teads.tv', 'doubleclick.net', 'googlesyndication.com',
    'google-analytics.com', 'googleadservices.com', 'bing.com', 'clarity.ms',
    'hotjar.com', 'criteo', 'taboola.com', 'outbrain.com', 'quantserve.com',
    'scorecardresearch.com', 'adnxs.com', 'pinterest', 'tiktok',
    'snapchat.com', 'sc-static.net', 'reddit.com', 'cct.google',
    'smartnews-ads.com', 'ads-twitter.com', 'ytag.js',
];

// A src built from variables reads as its first literal piece, which can be
// just a scheme: shonenjumpplus's Treasure Data tag is
//   a.src = ("https:" === location.protocol ? "https:" : "http:") + "//cdn..."
// and that is not a url anyone can put in a filter.
const isWholeUrl = url =>
    /^(?:https?:)?\/\/[^/\s]+\.[a-z]{2,}/i.test(url);

// A protocol-relative src is a whole url with the scheme left to the page.
// Missing these cost an evening: hokkaido-np.co.jp's container injects
// //cdn.activity.smart-bdash.com/tag-manager/bd-7verxz/btm.js, which is what
// loads their recommendation widget, and the tool reported the container as
// injecting nothing but an ad pixel.
const asHttps = url => url.startsWith('//') ? 'https:' + url : url;

const looksLikeTracker = url => {
    for ( const host of KNOWN_TRACKERS ) {
        if ( url.includes(host) ) { return true; }
    }
    return false;
};

for ( const id of ids ) {
    let text;
    try {
        text = await fetchContainer(id);
    } catch(ex) {
        console.log(`  ${id}: ${ex.message}`);
        continue;
    }
    const { found: tags, writes } = tagsFrom(text);
    console.log(`\n${id}  (${Math.round(text.length / 1024)}KB)`);
    const sayWrites = ( ) => {
        if ( writes.length === 0 ) { return; }
        const targets = new Set();
        for ( const w of writes ) {
            for ( const t of w.targets ) { targets.add(t); }
        }
        console.log(`  ${writes.length} tag(s) write into the page instead of` +
            ' loading anything - no filter can stand in for these, the' +
            ' content is in the container:');
        for ( const t of [ ...targets ].sort() ) {
            console.log(`      ${t}`);
        }
        console.log('  Check whether the page still has those elements: a' +
            ' container often keeps tags for markup a site has moved on from.');
    };
    if ( tags.length === 0 ) {
        console.log('  no __html tag injects a script');
        sayWrites();
        continue;
    }
    // The same script can be in a container more than once, behind different
    // triggers: petzl's Maps tag is there twice, one copy for their sandbox
    // hosts and one, the live one, behind PageType. Keeping the first and
    // dropping the rest reports the wrong trigger, so they are merged.
    const byUrl = new Map();
    for ( const tag of tags ) {
        const had = byUrl.get(tag.url);
        if ( had === undefined ) {
            byUrl.set(tag.url, { ...tag, conditions: [ ...tag.conditions ] });
            continue;
        }
        had.conditions.push(...tag.conditions);
        if ( had.callback === '' ) { had.callback = tag.callback; }
        if ( had.metadata === '' ) { had.metadata = tag.metadata; }
    }
    const rest = [];
    for ( const tag of byUrl.values() ) {
        if ( looksLikeTracker(tag.url) ) { continue; }
        // Only a data layer variable tested for a substring or an exact
        // value: that is what gtm-tag can be given. A host or an event test
        // is for a person to read.
        const usable = new Set();
        // A path test is the other kind a filter can be given, and the one
        // containers hold a page-specific tag behind most often. Their four
        // shapes map onto gtm-tag's one argument.
        const paths = new Set();
        for ( const c of tag.conditions ) {
            if ( c.path === true ) {
                if ( c.fn === '_eq' ) { paths.add('path=' + c.value); }
                else if ( c.fn === '_sw' ) { paths.add('path=' + c.value + '*'); }
                else if ( c.fn === '_ew' ) { paths.add('path=*' + c.value); }
                else if ( c.fn === '_cn' ) { paths.add('path=*' + c.value + '*'); }
                continue;
            }
            if ( c.variable === '' ) { continue; }
            if ( c.fn !== '_cn' && c.fn !== '_eq' ) { continue; }
            usable.add(c.variable + '=' + c.value);
        }
        tag.path = paths.size === 1 ? [ ...paths ][0] : '';
        tag.when = usable.size === 1 ? [ ...usable ][0] : '';
        tag.others = [ ...usable, ...paths ];
        rest.push(tag);
    }
    const trackers = byUrl.size - rest.length;
    console.log(`  ${byUrl.size} scripts, of which ${trackers} are plainly ad` +
        ` or analytics infrastructure and are not listed.`);
    if ( rest.length === 0 ) {
        console.log('  Nothing else.');
        sayWrites();
        continue;
    }
    console.log('  The rest, which is where page functionality would be:');
    for ( const { url, callback, metadata, when, path, conditions } of rest ) {
        console.log(`    ${url}` +
            `${metadata !== '' ? '   metadata=' + metadata : ''}`);
        console.log(`      <site>##+js(gtm-tag, ${url}` +
            `${callback !== '' || when !== '' ? ', ' + callback : ''}` +
            `${when !== '' ? ', ' + when : ''}` +
            `${path !== '' ? ', ' + path : ''})`);
        if ( when === '' && path === '' && conditions.length !== 0 ) {
            const seenSaid = new Set();
            console.log('      no single data layer condition to give it -' +
                ' what the container tests:');
            for ( const c of conditions ) {
                const said = `        ${c.fn} ${c.variable !== '' ?
                    c.variable : 'macro ' + c.macro} ${c.value}`;
                if ( seenSaid.has(said) ) { continue; }
                seenSaid.add(said);
                console.log(said);
            }
        }
    }
}
