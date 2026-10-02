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

// Every __html tag, with what it would inject and what the container says it
// is for. Their "metadata" often names the purpose - both the OneTrust and
// the Maps entry in petzl's container are tagged ["map"].
const tagsFrom = text => {
    const found = [];
    const re = /\{"function":"__html"[\s\S]{0,8000}?"vtp_html":"((?:[^"\\]|\\.)*)"/g;
    let match = re.exec(text);
    while ( match !== null ) {
        const entry = match[0];
        const html = unescape(match[1]);
        const urls = [];
        const src = /src\s*=\s*\\?["']([^"'\\]+)/g;
        let one = src.exec(html);
        while ( one !== null ) {
            urls.push(one[1]);
            one = src.exec(html);
        }
        // A loader asked for with a callback needs that name to exist first.
        const callback = /[?&]callback=([A-Za-z0-9_$.]+)/.exec(html);
        // Only this entry's own metadata: it sits before vtp_html in the
        // same object, and a window that reaches into the next tag would
        // label every script with the first one it found.
        const head = entry.slice(0, entry.indexOf('"vtp_html"'));
        const metadata = /"metadata":\[([^\]]*)\][^{]*$/.exec(head);
        for ( const url of urls ) {
            found.push({
                url,
                callback: callback !== null ? callback[1] : '',
                metadata: metadata !== null ? metadata[1] : '',
            });
        }
        match = re.exec(text);
    }
    return found;
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
];

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
    const tags = tagsFrom(text);
    console.log(`\n${id}  (${Math.round(text.length / 1024)}KB)`);
    if ( tags.length === 0 ) {
        console.log('  no __html tag injects a script - nothing a container' +
            ' holds that a page needs');
        continue;
    }
    const seen = new Set();
    const rest = [];
    for ( const tag of tags ) {
        if ( seen.has(tag.url) ) { continue; }
        seen.add(tag.url);
        if ( looksLikeTracker(tag.url) ) { continue; }
        rest.push(tag);
    }
    const trackers = seen.size - rest.length;
    console.log(`  ${seen.size} scripts, of which ${trackers} are plainly ad` +
        ` or analytics infrastructure and are not listed.`);
    if ( rest.length === 0 ) {
        console.log('  Nothing else - so this container holds nothing a page' +
            ' needs.');
        continue;
    }
    console.log('  The rest, which is where page functionality would be:');
    for ( const { url, callback, metadata } of rest ) {
        console.log(`    ${url}` +
            `${metadata !== '' ? '   metadata=' + metadata : ''}`);
        console.log(`      <site>##+js(gtm-tag, ${url}` +
            `${callback !== '' ? ', ' + callback : ''})`);
    }
}
