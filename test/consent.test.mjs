/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

const URL = 'https://www.globalblue.com/es/refund-points-map';
const ID = 'GTM-TESTGB1';
const LOADER = '<script src="https://www.googletagmanager.com/gtm.js?id=' +
    ID + '"></scr' + 'ipt>';

let gtm;

before(async ( ) => {
    gtm = (await loadResources()).get('googletagmanager_gtm.js');
});

const withArgs = (...args) => {
    const match = /^function\s+([^(\s]+)\s*\(/.exec(gtm);
    return gtm + '\n' + match[1] +
        '(' + JSON.stringify(args).slice(1, -1) + ');';
};

const page = (head = LOADER) => new JSDOM(
    '<!doctype html><html><head>' + head + '</head><body><p>x</p></body></html>',
    { runScripts: 'outside-only', url: URL, virtualConsole: new VirtualConsole() }
);

const lines = w => {
    const out = [];
    w.console.info = line => { out.push(String(line)); };
    return out;
};

// globalblue.com's own gate, as built:
//   checkOptanonActiveGroups() {
//       const i = window.OptanonActiveGroups ?? '';
//       return i.includes('C0001') && i.includes('C0002') && i.includes('C0003') }
const gated = w => {
    const i = w.OptanonActiveGroups || '';
    return i.includes('C0001') && i.includes('C0002') && i.includes('C0003');
};

/******************************************************************************/

describe('googletagmanager_gtm, a consent state the container took with it', ( ) => {
    it('gives a page the categories its own content needs', ( ) => {
        const w = page().window;
        const out = lines(w);
        assert.equal(gated(w), false, 'nothing to read to begin with');
        w.eval(gtm);
        assert.equal(gated(w), true);
        assert.ok(out[0].includes(' consent=content'), out[0]);
    });

    it('withholds targeting and social', ( ) => {
        const w = page().window;
        lines(w);
        w.eval(gtm);
        // What an ad is gated on is not what a page needs to show itself.
        assert.equal(w.OptanonActiveGroups.includes('C0004'), false);
        assert.equal(w.OptanonActiveGroups.includes('C0005'), false);
    });

    it('gives all of them when a filter asks', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval(withArgs('consent=all'));
        assert.equal(w.OptanonActiveGroups.includes('C0004'), true);
        assert.ok(out.some(l => l.includes(' consent=all')), out.join(' | '));
    });

    it('gives none when a filter says off', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval(withArgs('consent=off'));
        assert.equal(w.OptanonActiveGroups, undefined);
        assert.equal(w.OneTrust, undefined);
        assert.ok(out.some(l => l.includes(' consent=off')), out.join(' | '));
    });

    it('leaves a state something else already set', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval("window.OptanonActiveGroups = ',C0001,';" +
            'window.OneTrust = { theirs: true };');
        w.eval(gtm);
        assert.equal(w.OptanonActiveGroups, ',C0001,', 'untouched');
        assert.deepEqual(Object.keys(w.OneTrust), [ 'theirs' ]);
        assert.ok(out.some(l => l.includes(' consent=theirs')), out.join(' | '));
    });

    it('does nothing on a page it is not standing in for', ( ) => {
        const w = page('').window;
        lines(w);
        w.eval(gtm);
        assert.equal(w.OptanonActiveGroups, undefined);
    });

    it('leaves it to a container that answered for itself', ( ) => {
        // container=kept: their own container loaded, so it will load their
        // consent manager too, and none of this is needed or wanted.
        const w = page().window;
        const out = lines(w);
        w.eval('window.google_tag_manager = { "' + ID + '": { theirs: 1 } };');
        w.eval(gtm);
        assert.ok(out.some(l => l.includes(' container=kept')), out.join(' | '));
        assert.equal(w.OptanonActiveGroups, undefined);
        assert.equal(w.OneTrust, undefined);
        assert.ok(out.some(l => l.includes(' consent=left')), out.join(' | '));
    });

    it('answers the reopen button a page wires to their UI', ( ) => {
        // globalblue: openOTYTNotification(){ window.OneTrust?.ToggleInfoDisplay() }
        const w = page().window;
        lines(w);
        w.eval(gtm);
        assert.equal(typeof w.OneTrust.ToggleInfoDisplay, 'function');
        assert.equal(w.OneTrust.ToggleInfoDisplay(), undefined, 'and no throw');
        assert.equal(w.OneTrust.IsAlertBoxClosed(), true, 'no banner pending');
    });

    it('calls the callback their loader would have called', async ( ) => {
        const w = page().window;
        lines(w);
        w.eval('window.wrapped = 0;' +
            'window.OptanonWrapper = function(){ window.wrapped += 1; };');
        w.eval(gtm);
        await settle(20);
        assert.equal(w.wrapped, 1);
    });

    it('fires the event a page re-checks on', async ( ) => {
        // globalblue: fromEvent(window, 'OneTrustGroupsUpdated')
        const w = page().window;
        lines(w);
        w.eval(gtm);
        w.eval('window.rechecked = 0;' +
            'window.addEventListener("OneTrustGroupsUpdated", function(){' +
            ' window.rechecked += 1; });');
        await settle(150);
        assert.equal(w.rechecked, 1);
    });
});
