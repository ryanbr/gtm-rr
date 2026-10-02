/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Loads one tag a container would have loaded, named in the filter rather
    than read from the container.

    Some sites keep page functionality inside GTM: a map, a player, a store
    locator, a consent manager that gates one of those. Replacing the
    container cannot bring those back - googletagmanager_gtm.js answers the
    API and has no idea which tags were configured - and the usual way out is
    to allow the container, which runs every other tag in it too.

    This is the other way out. The tag's url goes in the filter, so only that
    one script loads: no container, no tag manager, nothing else it carried.

      example.com##+js(gtm-tag, https://host/thing.js)

    uBO fills in the placeholder below from the filter's arguments, by
    position:

      patchScriptlet = (fname, content, arglist) => { ...
          for ( let i = 0; i < arglist.length; i++ ) {
              content = content.replace("{{" + (i+1) + "}}", arglist[i]);
          } ... }

    (their line builds that placeholder with a template literal; written out
    here because this file may not contain one - the bundler strips lines.)

    A second argument names a global the tag needs before it runs. A Maps
    loader asked for with &callback=initGmaps will throw if it arrives before
    the page has defined initGmaps, so with that argument this waits for the
    name to appear - and for the page to have parsed, because a page may put
    an empty placeholder of that name in the head and the real one at the
    foot - and injects then:

      example.com##+js(gtm-tag, https://maps.googleapis.com/maps/api/js?key=K&callback=initGmaps, initGmaps)

    Only https is accepted, and only as a scriptlet: used as a redirect the
    placeholders are never filled in, and this does nothing at all.

    It loads a script you have named. That is the point of it and also the
    whole of its risk - keep it to your own filters, where you can see what
    the url is.

*/

function consentRRGtmTag() {
    const w = window;
    const doc = w.document;
    const VERSION = '@@VERSION@@';
    const NAME = 'gtm-tag';
    // Not the name of this function: re-injected, the function declaration
    // is hoisted over whatever was stored there and the guard is lost. That
    // has been got wrong twice in this repo now.
    const MARKER = 'consentRRGtmTagLoaded';
    // Filled in by uBO from the filter's arguments. Left as they are, this
    // was used without arguments - or as a redirect, which it is not for.
    const url = '{{1}}';
    const needs = '{{2}}';

    const unfilled = value => /^\{\{\d+\}\}$/.test(value);

    const say = what => {
        try {
            w.console.info('[gtm-rr] ' + NAME + ' ' + VERSION + ' ' + what);
        } catch(ex) {
        }
    };

    if ( unfilled(url) || url === '' ) { return; }

    // https only: a tag worth loading is served over it, and a filter
    // argument is not a place to accept anything else.
    let wanted = null;
    try {
        wanted = new w.URL(url, w.location.href);
    } catch(ex) {
        say('refused=unparseable');
        return;
    }
    if ( wanted.protocol !== 'https:' ) {
        say('refused=not-https url=' + wanted.protocol);
        return;
    }

    const id = MARKER + '-' + wanted.href;

    const inject = ( ) => {
        try {
            // Once per url, however many times this runs.
            if ( w[MARKER] === undefined ) { w[MARKER] = {}; }
            if ( w[MARKER][id] === true ) { return true; }
            w[MARKER][id] = true;
            const script = doc.createElement('script');
            script.async = true;
            script.src = wanted.href;
            const where = doc.head || doc.documentElement;
            if ( where === null ) { return false; }
            where.appendChild(script);
            say('injected=' + wanted.href +
                (unfilled(needs) || needs === '' ? '' : ' waited=' + needs));
            return true;
        } catch(ex) {
        }
        return false;
    };

    // No name to wait for: the tag stands alone, so it goes in as soon as
    // there is a document to put it in.
    if ( unfilled(needs) || needs === '' ) {
        try {
            if ( doc.head !== null ) { inject(); }
            else {
                doc.addEventListener('DOMContentLoaded', inject, { once: true });
            }
        } catch(ex) {
        }
        return;
    }

    // A name to wait for: a loader asked for with a callback throws if it
    // arrives before the page has defined it. Their own tags run late in a
    // page's life, so waiting is what they would have done.
    const ready = ( ) => {
        try {
            return typeof w[needs] === 'function';
        } catch(ex) {
        }
        return false;
    };

    const EVERY = 50;
    const UNTIL = 10000;
    let waited = 0;

    const look = ( ) => {
        if ( ready() === false ) {
            waited += EVERY;
            if ( waited >= UNTIL ) {
                say('gave-up=' + needs + ' after=' + UNTIL + 'ms');
                return;
            }
            try {
                w.setTimeout(look, EVERY);
            } catch(ex) {
            }
            return;
        }
        inject();
    };

    const begin = ( ) => {
        if ( ready() ) { inject(); }
        else { look(); }
    };

    // Not while the document is still being parsed, even if the name is
    // already there. A page can define the name early as a placeholder and
    // assign the real one late: petzl.com's dealer page sets
    //   window.initGmaps = window.initGmaps || function() { };
    // in the head, and the real initGmaps comes from a script at the foot of
    // the page, so a tag let in between the two is answered by the empty one
    // and draws nothing. Their own tags fire after the page is parsed anyway.
    try {
        if ( doc.readyState !== 'loading' ) { begin(); }
        else {
            doc.addEventListener('DOMContentLoaded', begin, { once: true });
        }
    } catch(ex) {
    }
}

consentRRGtmTag();
