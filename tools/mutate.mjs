/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Runs the mutations in test/mutations.mjs: for each one, break the source on
    purpose, build, run the suite, put the source back, and report whether the
    suite noticed.

    A test that passes against broken code is testing nothing, and this repo
    has had two of those - both passing because something other than the code
    under test was doing the work. Keeping the mutations in the repo rather
    than in shell history means they are reviewable, rerunnable, and run in
    CI.

    A mutation that survives is not automatically a missing test: check that it
    actually disabled the behaviour. Some are equivalent to the original - an
    expression whose result is caught and discarded either way - and those
    belong in the manifest marked { equivalent: true }, with the reason, so the
    next reader does not chase them again.

    Usage:
      node tools/mutate.mjs            every mutation
      node tools/mutate.mjs push       only those whose label matches "push"

*/

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import mutations from '../test/mutations.mjs';

const root = path.join(import.meta.dirname, '..');
const filter = process.argv[2];
// Long enough for a full build and suite, short enough that a mutation which
// leaves a timer pending - and so keeps node's test runner from exiting - is
// reported rather than waited on. That has happened.
const TIMEOUT_MS = 180000;

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, text) => fs.writeFileSync(path.join(root, file), text, 'utf8');

const run = ( ) => {
    const result = spawnSync('npm', [ 'test' ], {
        cwd: root,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: { ...process.env, FORCE_COLOR: '0' },
    });
    if ( result.error !== undefined && result.error !== null ) {
        if ( result.error.code === 'ETIMEDOUT' ) { return { hung: true }; }
        throw result.error;
    }
    if ( result.signal === 'SIGTERM' ) { return { hung: true }; }
    const out = (result.stdout || '') + (result.stderr || '');
    const pass = /^.\s*pass (\d+)$/m.exec(out);
    const fail = /^.\s*fail (\d+)$/m.exec(out);
    if ( pass === null || fail === null ) { return { unreadable: true, out }; }
    return { pass: Number(pass[1]), fail: Number(fail[1]) };
};

/******************************************************************************/

const chosen = mutations.filter(mutation =>
    filter === undefined || mutation.label.includes(filter)
);
assert.ok(chosen.length !== 0, `no mutation matches ${filter}`);

// The originals, so an interrupted run cannot leave a mutated source behind.
const originals = new Map();
for ( const { file } of chosen ) {
    if ( originals.has(file) ) { continue; }
    originals.set(file, read(file));
}

const restore = ( ) => {
    for ( const [ file, text ] of originals ) { write(file, text); }
};

for ( const signal of [ 'SIGINT', 'SIGTERM' ] ) {
    process.on(signal, ( ) => {
        restore();
        process.exit(130);
    });
}

const results = [];

try {
    for ( const mutation of chosen ) {
        const { label, file, from, to } = mutation;
        const original = originals.get(file);
        const count = original.split(from).length - 1;
        if ( count !== 1 ) {
            results.push({ label, verdict: 'stale', detail: `${count} matches` });
            continue;
        }
        write(file, original.replace(from, to));
        let outcome;
        try {
            outcome = run();
        } finally {
            write(file, original);
        }
        if ( outcome.hung === true ) {
            results.push({ label, verdict: 'hung' });
        } else if ( outcome.unreadable === true ) {
            results.push({ label, verdict: 'unreadable' });
        } else if ( outcome.fail > 0 ) {
            results.push({
                label,
                verdict: 'caught',
                detail: `${outcome.fail} failed`,
            });
        } else if ( mutation.equivalent === true ) {
            results.push({ label, verdict: 'equivalent' });
        } else {
            results.push({ label, verdict: 'SURVIVED' });
        }
    }
} finally {
    restore();
}

/******************************************************************************/

// Back to a built state, since every run above left dist/ from a mutation.
spawnSync('npm', [ 'run', 'build' ], { cwd: root, stdio: 'ignore' });

const width = Math.max(...results.map(r => r.label.length));
let bad = 0;
for ( const { label, verdict, detail } of results ) {
    if ( verdict !== 'caught' && verdict !== 'equivalent' ) { bad += 1; }
    console.log(
        `  ${label.padEnd(width)}  ${verdict}${detail ? ` (${detail})` : ''}`
    );
}
console.log(
    `\n  ${results.length} mutations, ${bad} to answer for` +
    ` (equivalent ones are declared in the manifest)`
);

if ( bad !== 0 ) {
    console.log(
        '\n  A mutation that survived means the tests pass against broken' +
        ' code.\n  Check it really disabled the behaviour; if it did, the' +
        ' test is missing.\n  If it cannot, declare it { equivalent: true }' +
        ' with the reason.'
    );
    process.exit(1);
}
