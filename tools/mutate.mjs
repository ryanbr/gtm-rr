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
      node tools/mutate.mjs --anchors  no mutations: only check that every
                                       one still matches its file exactly
                                       once, which takes a second rather
                                       than half an hour

    That last one exists because a stale anchor is the one failure a shorter
    run cannot see. A mutation whose `from` no longer appears has stopped
    testing anything, silently, and the usual way for that to happen is a
    rename in the code it was pointed at - which is exactly when the mutation
    matters most. CI runs it before the mutations, so a rename is reported in
    seconds.

*/

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import mutations from '../test/mutations.mjs';

const root = path.join(import.meta.dirname, '..');
const asked = process.argv[2];
const anchorsOnly = asked === '--anchors';
const filter = anchorsOnly ? undefined : asked;
// Long enough for a full build and suite, short enough that a mutation which
// leaves a timer pending - and so keeps node's test runner from exiting - is
// reported rather than waited on. That has happened.
const TIMEOUT_MS = 180000;

const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Every mutation's anchor, against the files as they are. Exactly one match
// each: none means it has stopped testing anything, and more than one means
// the runner would not know which to break.
// Which files are not as they are committed. A mutation run in progress has
// one of them broken on purpose at any moment, and its anchor - and any other
// anchor through the same lines - will not match. Asked once, so the answer
// cannot be read as a verdict on the code.
const uncommitted = ( ) => {
    const out = new Set();
    try {
        const result = spawnSync('git', [ 'status', '--porcelain' ], {
            cwd: root,
            encoding: 'utf8',
        });
        for ( const line of String(result.stdout || '').split('\n') ) {
            const name = line.slice(3).trim();
            if ( name !== '' ) { out.add(name); }
        }
    } catch(ex) {
    }
    return out;
};

const anchors = ( ) => {
    const files = new Map();
    const changed = uncommitted();
    let bad = 0;
    let unsure = 0;
    for ( const mutation of mutations ) {
        const { label, file, from } = mutation;
        if ( files.has(file) === false ) { files.set(file, read(file)); }
        const text = files.get(file);
        let found = 0;
        let at = text.indexOf(from);
        while ( at !== -1 ) {
            found += 1;
            at = text.indexOf(from, at + 1);
        }
        if ( found === 1 ) { continue; }
        const live = changed.has(file);
        if ( live ) { unsure += 1; } else { bad += 1; }
        console.log(`  ${found === 0 ? 'no match ' : found + ' matches'}` +
            `  ${label}  (${file})` +
            (live ? ' - uncommitted changes in that file' : ''));
    }
    console.log(`\n  ${mutations.length} anchors, ${bad} that do not match ` +
        'their file exactly once' +
        (unsure !== 0 ? `, ${unsure} unanswerable` : ''));
    if ( unsure !== 0 ) {
        console.log('\n  Unanswerable means the file is not as it is' +
            ' committed - a mutation run in\n  progress is the usual reason,' +
            ' since it keeps one line broken at a time.\n  Run this on a' +
            ' clean tree for an answer.');
    }
    if ( bad !== 0 ) {
        console.log('\n  An anchor that does not match is a mutation that' +
            ' tests nothing.\n  Point it at the line as it reads now, or' +
            ' delete it if the behaviour went.');
    }
    return bad + unsure === 0 ? 0 : 1;
};

if ( anchorsOnly ) { process.exit(anchors()); }
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
