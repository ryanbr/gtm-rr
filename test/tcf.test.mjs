/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    The IAB TCF API, where a container's consent manager was the only thing
    providing it. nowtv.com.tr is the worked example: its container holds one
    script, OneTrust's otSDKStub.js, and the video player's init loop waits on
    a flag that only __tcfapi's callback sets.

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { loadResources, settle } from './helpers.mjs';

const URL = 'https://www.nowtv.com.tr/Sevdam-Karadeniz/fragmanlar';
const ID = 'GTM-NJ7G7JV';
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

/******************************************************************************/

describe('googletagmanager_gtm, the TCF answer a container took with it', ( ) => {
    it('answers the wait their player is held behind', ( ) => {
        // Their shape, as built:
        //   window.__tcfapi('addEventListener', 2, function(tcData, success) {
        //     if (success && (tcData.eventStatus === 'tcloaded'
        //         || tcData.eventStatus === 'useractioncomplete')) {
        //       initGoogleAds(tcData); } });
        // and initGoogleAds is what sets the flag the init loop reads.
        const w = page().window;
        w.eval(gtm);
        assert.equal(typeof w.__tcfapi, 'function', 'nothing to call');
        let inited = false;
        w.__tcfapi('addEventListener', 2, (data, success) => {
            if ( success !== true ) { return; }
            if ( data.eventStatus !== 'tcloaded' &&
                data.eventStatus !== 'useractioncomplete' )
            {
                return;
            }
            inited = true;
        });
        assert.equal(inited, true, 'their callback never ran');
    });

    it('answers with a refusal, not a consent', ( ) => {
        const w = page().window;
        w.eval(gtm);
        let got = null;
        w.__tcfapi('getTCData', 2, (data, success) => {
            assert.equal(success, true);
            got = data;
        });
        assert.equal(got.gdprApplies, true, 'GDPR applies');
        assert.equal(got.tcString, '', 'and there is no string to hand over');
        for ( const where of [
            got.purpose.consents,
            got.purpose.legitimateInterests,
            got.vendor.consents,
            got.vendor.legitimateInterests,
            got.specialFeatureOptins,
            got.publisher.consents,
            got.publisher.legitimateInterests,
        ] ) {
            assert.deepEqual(
                Object.keys(where), [],
                'not one consent: ' + JSON.stringify(where)
            );
        }
    });

    it('says so on the summary line', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval(gtm);
        assert.ok(out[0].includes(' tcf=refusal'), out[0]);
    });

    it('answers their ping with one argument, as their API does', ( ) => {
        const w = page().window;
        w.eval(gtm);
        let seen;
        let extra = 'untouched';
        w.__tcfapi('ping', 2, (ping, second) => {
            seen = ping;
            extra = second;
        });
        assert.equal(seen.cmpLoaded, true);
        assert.equal(seen.cmpStatus, 'loaded');
        assert.equal(seen.apiVersion, '2');
        assert.equal(extra, undefined, 'ping takes one argument');
    });

    it('takes a listener off again', ( ) => {
        const w = page().window;
        w.eval(gtm);
        let first;
        w.__tcfapi('addEventListener', 2, data => { first = data.listenerId; });
        assert.equal(typeof first, 'number');
        let gone = null;
        w.__tcfapi('removeEventListener', 2, ok => { gone = ok; }, first);
        assert.equal(gone, true);
    });

    it('says false to a command it is not standing in for', ( ) => {
        const w = page().window;
        w.eval(gtm);
        let data = 'untouched';
        let success = 'untouched';
        w.__tcfapi('getInAppTCData', 2, (a, b) => { data = a; success = b; });
        assert.equal(data, null);
        assert.equal(success, false);
    });

    it('leaves a real CMP alone', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval('window.__tcfapi = function(){ window.theirs = true; };');
        w.eval(gtm);
        w.__tcfapi('ping', 2, ( ) => undefined);
        assert.equal(w.theirs, true, 'theirs is still the one answering');
        assert.ok(out[0].includes(' tcf=theirs'), out[0]);
    });

    it('answers nothing where it stood in for nothing', ( ) => {
        // No loader in the page, so there was no container to replace - and a
        // page with no container is not missing a consent manager.
        const w = page('').window;
        w.eval(gtm);
        assert.equal(w.__tcfapi, undefined);
    });

    it('leaves it to a container that answered for itself', ( ) => {
        // container=kept, which is the case the "no loader" test above cannot
        // reach: with no loader nothing starts at all, so the gate that reads
        // installed is never evaluated and a mutation removing it survived.
        const w = page().window;
        const out = lines(w);
        w.eval('window.google_tag_manager = { "' + ID + '": { theirs: 1 } };');
        w.eval(gtm);
        assert.ok(out.some(l => l.includes(' container=kept')), out.join(' | '));
        assert.equal(
            w.__tcfapi, undefined,
            'their container will load their own CMP'
        );
        assert.ok(out.some(l => l.includes(' tcf=left')), out.join(' | '));
    });

    it('is taken away by consent=off', ( ) => {
        const w = page().window;
        const out = lines(w);
        w.eval(withArgs('consent=off'));
        assert.equal(w.__tcfapi, undefined, 'left for consent-rr to answer');
        assert.ok(out.some(l => l.includes(' consent=off')), out.join(' | '));
    });

    it('is not raised by consent=all', ( ) => {
        // The group variables are what a site reads to show its own content.
        // A TCF purpose consent is a message to every ad vendor on the page,
        // and that is not this resource's to send.
        const w = page().window;
        w.eval(withArgs('consent=all'));
        let got = null;
        w.__tcfapi('getTCData', 2, data => { got = data; });
        assert.deepEqual(Object.keys(got.purpose.consents), []);
        assert.deepEqual(Object.keys(got.vendor.consents), []);
        assert.equal(got.gdprApplies, true);
    });

    it('builds a fresh answer per call, so a page cannot poison it', ( ) => {
        const w = page().window;
        w.eval(gtm);
        let first = null;
        w.__tcfapi('getTCData', 2, data => { first = data; });
        first.purpose.consents[1] = true;
        let second = null;
        w.__tcfapi('getTCData', 2, data => { second = data; });
        assert.deepEqual(Object.keys(second.purpose.consents), []);
    });

    it('does nothing at all without a callback', ( ) => {
        const w = page().window;
        w.eval(gtm);
        assert.doesNotThrow(( ) => w.__tcfapi('addEventListener', 2));
        assert.doesNotThrow(( ) => w.__tcfapi('ping', 2, 'not a function'));
    });

    it('leaves no __tcfapiLocator frame for someone else to ask', async ( ) => {
        // That frame exists so third party frames can postMessage the CMP for
        // a consent string. There is nothing here for them to have.
        const w = page().window;
        w.eval(gtm);
        await settle();
        assert.equal(
            w.document.querySelector('iframe[name="__tcfapiLocator"]'), null
        );
    });
});
