/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

*/

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { BUNDLE, loadBundle, loadResources, versions } from './helpers.mjs';

let separate;
let bundled;

before(async ( ) => {
    separate = await loadResources();
    bundled = await loadBundle();
});

/******************************************************************************/

// One userResourcesLocation URL instead of three. A resources file holds as
// many resources as it likes, each starting at its own "/// name.js" and
// ending at a blank line - the same shape uBO makes anyway when it joins the
// contents of several URLs with '\n\n'. Nothing is merged: the resources stay
// separate, under their own names, and a scriptlet asks for one by name.
describe(BUNDLE, ( ) => {
    it('carries every resource, and nothing else', ( ) => {
        assert.deepEqual(
            [ ...bundled.keys() ].sort(),
            [ ...separate.keys() ].sort()
        );
        assert.notEqual(bundled.size, 0);
    });

    it('carries them unchanged', ( ) => {
        for ( const [ name, code ] of separate ) {
            assert.equal(bundled.get(name), code, name);
        }
    });

    it('is still a file uBO can parse', ( ) => {
        // The rules that apply to one resource apply to the file: ASCII, and
        // no line that uBO would eat except the separators between them.
        for ( const code of bundled.values() ) {
            for ( const line of code.split('\n') ) {
                assert.notEqual(line.trim(), '');
                assert.equal(line.startsWith('#'), false);
                assert.equal(line.startsWith('/// '), false);
            }
            assert.equal(/[^\x20-\x7e\t\n]/.test(code), false);
        }
    });

    it('stamps each resource with its own version', ( ) => {
        assert.ok(bundled.get('googletagmanager_gtm.js')
            .includes(versions.gtm));
        assert.ok(bundled.get('ga-optout.js').includes(versions.ga));
        assert.ok(bundled.get('gtm-tag.js').includes(versions.tag));
    });
});
