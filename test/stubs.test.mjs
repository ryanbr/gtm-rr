/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    A page waiting for the global an SDK the container would have injected
    creates. uAssets #32369: b2c.voegol.com.br/minhas-viagens/login polls for
    window.amplitude every 1.2s, with no timeout anywhere in the wait, and
    only navigates to the identity provider once it answers.

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

const URL = 'https://b2c.voegol.com.br/minhas-viagens/login';
const ID = 'GTM-N29TWPN';
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

// The page's own wait, as built. Their rxjs pipe, by hand and in the page's
// window, so the polling is the fixture's and the answer has to come from the
// resource:
//
//   waitForWindowProp(name, every = 1200) {
//     return timer(0, every).pipe(
//       map(() => window[name]), filter(v => !!v), take(1)); }
//
// A real 1200 would make every test here take over a second, so the interval
// is the argument it already is on their side. The cap is not theirs - their
// wait has no end in it, which is the whole complaint - and is here only so
// an unanswered poll does not leave a timer pending and keep the test runner
// from exiting.
const waitForWindowProp = (w, name, every = 5, limit = 12) => {
    const state = { answered: false, value: undefined, polls: 0 };
    const tick = ( ) => {
        state.polls += 1;
        const value = w[name];
        if ( value ) {
            state.answered = true;
            state.value = value;
            return;
        }
        if ( state.polls >= limit ) { return; }
        w.setTimeout(tick, every);
    };
    tick();
    return state;
};

// What they do with it, and the only two things they ask of it:
//
//   this.goToLoginSmiles(this.culture, {
//     deviceId: a.getDeviceId(), sessionId: a.getSessionId() })
//   ...
//   ids?.deviceId && params.set('ampDeviceId', ids.deviceId)
//   ids?.sessionId && params.set('ampSessionId', ids.sessionId)
const ssoUrl = sdk => {
    const ids = { deviceId: sdk.getDeviceId(), sessionId: sdk.getSessionId() };
    const params = new global.URLSearchParams({ client_id: 'gol' });
    if ( ids.deviceId ) { params.set('ampDeviceId', ids.deviceId); }
    if ( ids.sessionId ) { params.set('ampSessionId', ids.sessionId); }
    return 'https://sso.example/authorize?' + params.toString();
};

/******************************************************************************/

describe('googletagmanager_gtm, the global the container would have made', ( ) => {
    it('leaves the page waiting with nothing to stand in for it', async ( ) => {
        const w = page().window;
        w.eval(gtm);
        const wait = waitForWindowProp(w, 'amplitude');
        await settle(40);
        assert.equal(wait.answered, false, 'nothing answered the poll');
        assert.ok(wait.polls > 2, 'and it is still polling: ' + wait.polls);
    });

    it('answers it where a filter names the global', async ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval(withArgs('stub=amplitude'));
        const wait = waitForWindowProp(w, 'amplitude');
        await settle(40);
        assert.equal(wait.answered, true);
        assert.ok(
            out.some(line => line.includes(' stub=amplitude')),
            out.join('\n')
        );
    });

    it('answers before the page has a loader in it at all', async ( ) => {
        // uBO injects a scriptlet at document_start. The app appends its own
        // <script id="GTMscript"> later, from Angular, so at the moment the
        // argument is read there is no container tag to be seen.
        const w = page('').window;
        w.eval(withArgs('stub=amplitude'));
        const wait = waitForWindowProp(w, 'amplitude');
        await settle(40);
        assert.equal(wait.answered, true);
    });

    it('carries the sign-in through without minting an id for it', ( ) => {
        const w = page().window;
        w.eval(withArgs('stub=amplitude'));
        const sdk = w.amplitude;
        assert.equal(sdk.getDeviceId(), undefined);
        assert.equal(sdk.getSessionId(), undefined);
        const url = ssoUrl(sdk);
        assert.equal(url.includes('ampDeviceId'), false, url);
        assert.equal(url.includes('ampSessionId'), false, url);
        assert.ok(url.includes('client_id=gol'), url);
    });

    it('answers to a name it was never told, at any depth', ( ) => {
        const w = page().window;
        w.eval(withArgs('stub=amplitude'));
        const sdk = w.amplitude;
        assert.equal(typeof sdk.logEvent, 'function');
        assert.equal(sdk.logEvent('$exposure', { flag_key: 'x' }), undefined);
        assert.equal(typeof sdk.Identify.prototype, 'object', 'prototype');
        assert.equal(typeof sdk.plugin.remove.whatever, 'function');
    });

    it('answers a call with undefined rather than with itself', ( ) => {
        // Deliberate, and the reason is in the resource: a stub that answered
        // its own calls would be truthy, and the value this page reads off it
        // goes into a URL. The cost is that chaining past a call throws,
        // which is where an absent global throws today anyway.
        const w = page().window;
        w.eval(withArgs('stub=amplitude'));
        const sdk = w.amplitude;
        assert.equal(sdk.getInstance(), undefined);
        assert.throws(( ) => sdk.getInstance().logEvent('x'), TypeError);
    });

    it('is not a thenable, so awaiting it is not a second wait', async ( ) => {
        const w = page().window;
        w.eval(withArgs('stub=amplitude'));
        const sdk = w.amplitude;
        assert.equal(sdk.then, undefined, 'then must answer for itself');
        const settled = await Promise.race([
            Promise.resolve(sdk).then(( ) => 'resolved'),
            settle(60).then(( ) => 'hung'),
        ]);
        assert.equal(settled, 'resolved');
    });

    it('leaves a global that is already there alone', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval('window.amplitude = { getDeviceId: function(){ return "real" } };');
        w.eval(withArgs('stub=amplitude'));
        assert.equal(w.amplitude.getDeviceId(), 'real');
        assert.ok(
            out.some(line => line.includes(' stub=none held=amplitude')),
            out.join('\n')
        );
    });

    it('steps aside for the real SDK arriving after it', ( ) => {
        const w = page().window;
        w.eval(withArgs('stub=amplitude'));
        assert.equal(typeof w.amplitude, 'function');
        w.eval('window.amplitude = { getDeviceId: function(){ return "real" } };');
        assert.equal(w.amplitude.getDeviceId(), 'real');
    });

    it('takes more than one name', ( ) => {
        // One argument, because uBO splits the filter's on commas: the two
        // names reach here together only through its own escape,
        // stub=amplitude\,amplitudeGTM.
        const w = page().window;
        const out = lines(w);
        w.eval(withArgs('stub=amplitude,amplitudeGTM'));
        assert.equal(typeof w.amplitude, 'function');
        assert.equal(typeof w.amplitudeGTM, 'function');
        assert.ok(
            out.some(line => line.includes(' stub=amplitude,amplitudeGTM')),
            out.join('\n')
        );
    });

    it('takes a global name and nothing else', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval(withArgs('stub=amplitude.getDeviceId,1up,window'));
        assert.equal(w.amplitude, undefined, 'a path is not a global');
        assert.equal(w['1up'], undefined);
        // window is a name, and a name that is already answered is held
        // rather than refused - the two outcomes are told apart in the line.
        assert.ok(
            out.some(line => line.includes(' stub=none held=window')),
            out.join('\n')
        );
    });

    it('does not take a whole page of them', ( ) => {
        const w = page().window;
        w.eval(withArgs('stub=a1,a2,a3,a4,a5,a6'));
        assert.equal(typeof w.a4, 'function');
        assert.equal(w.a5, undefined, 'the fifth is past the limit');
        assert.equal(w.a6, undefined);
    });

    it('makes nothing where no filter asked for it', ( ) => {
        const w = page().window;
        w.eval(gtm);
        assert.equal(w.amplitude, undefined);
        w.eval(withArgs(''));
        assert.equal(w.amplitude, undefined);
    });
});
