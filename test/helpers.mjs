/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Test helpers. Resources are read back out of the dist/*.js files with the
    same line rules uBlock Origin applies, and joined the way uBO joins the
    contents of several userResourcesLocation URLs, so the tests exercise the
    artifacts that ship rather than the sources they were built from.

*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.join(import.meta.dirname, '..');

// Every list, so the token guards cover each one rather than only the first.
export const filtersText = (await Promise.all(
    (await fs.readdir(path.join(root, 'filters')))
        .filter(name => name.endsWith('.txt'))
        .sort()
        .map(name => fs.readFile(path.join(root, 'filters', name), 'utf8'))
)).join('\n');

const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'package.json'), 'utf8')
);

// The repo's release version, and the per-family resource versions.
export const version = manifest.version;
export const versions = manifest.resourceVersions;

export const parseResources = text => {
    const resources = new Map();
    let name;
    let lines = [];
    const finish = ( ) => {
        if ( name === undefined ) { return; }
        resources.set(name, lines.join('\n'));
        name = undefined;
        lines = [];
    };
    for ( const line of `${text}\n\n`.split('\n') ) {
        if ( line.startsWith('#') ) { continue; }
        if ( line.startsWith('// ') ) { continue; }
        if ( name === undefined ) {
            if ( line.startsWith('/// ') ) { name = line.slice(4).trim(); }
            continue;
        }
        if ( line.startsWith('/// ') ) { continue; }
        if ( /\S/.test(line) ) {
            lines.push(line);
            continue;
        }
        finish();
    }
    finish();
    return resources;
};

export const loadResources = async ( ) => {
    const dir = path.join(root, 'dist');
    const names = (await fs.readdir(dir)).filter(n => n.endsWith('.js')).sort();
    const files = await Promise.all(
        names.map(name => fs.readFile(path.join(dir, name), 'utf8'))
    );
    return parseResources(files.join('\n\n'));
};

export const fixture = `<!DOCTYPE html><html><head>
<script id="snippet">(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-KJZD388');</script>
<script id="container" async src="https://www.googletagmanager.com/gtm.js?id=GTM-KJZD388"></script>
</head><body>
<p id="content">hello</p>
</body></html>`;

// runScripts: 'outside-only' gives window.eval without running the page's own
// scripts - the snippet in the fixture is markup to be read, not run, and a
// test that wants a dataLayer evals one itself.
export const openPage = (html = fixture, before = undefined) => {
    const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: 'https://example.com/',
        // Dropped rather than forwarded: the resources announce themselves on
        // load, and a test that wants the line stubs console.info itself.
        virtualConsole: new VirtualConsole(),
    });
    if ( typeof before === 'function' ) { before(dom.window); }
    return dom;
};

export const run = (code, html = fixture, before = undefined) => {
    const dom = openPage(html, before);
    dom.window.eval(code);
    return dom.window;
};

// The jsdom instance rather than its window, for a test that needs the document
// itself or a second eval into the same page.
export const runDom = (code, url, html = fixture, before = undefined) => {
    const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url,
        virtualConsole: new VirtualConsole(),
    });
    if ( typeof before === 'function' ) { before(dom.window); }
    dom.window.eval(code);
    return dom;
};

export const cookies = win => {
    const out = new Map();
    for ( const cookie of String(win.document.cookie).split(';') ) {
        const pos = cookie.indexOf('=');
        if ( pos === -1 ) { continue; }
        out.set(cookie.slice(0, pos).trim(), cookie.slice(pos + 1).trim());
    }
    return out;
};

export const settle = (ms = 30) => new Promise(resolve => {
    setTimeout(resolve, ms);
});
