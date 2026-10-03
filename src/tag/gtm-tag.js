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

    The filter's arguments arrive as this function's parameters. uBO decides
    that by looking at how the resource starts:

      const match = /^function\s+([^(\s]+)\s*\(/.exec(details.js);
      const fname = match && match[1];
      ... if ( fname ) { content = fname + "({{args}});" }
          else { ...content.replace("{{" + (i+1) + "}}", arglist[i])... }

    so a resource whose body opens with a named function declaration - this
    one does - is CALLED with the arguments, and the {{1}} placeholders of
    the older form are never filled in. Getting that backwards is silent in
    both directions: the placeholders stay as literal text and the resource
    quietly does nothing.

    A second argument names a global the tag needs before it runs. A Maps
    loader asked for with &callback=initGmaps will throw if it arrives before
    the page has defined initGmaps, so with that argument this waits for the
    name to hold a function with a body - a page may define an empty
    placeholder of that name early and the real one much later - and injects
    then:

      example.com##+js(gtm-tag, https://maps.googleapis.com/maps/api/js?key=K&callback=initGmaps, initGmaps)

    A third argument is the container's own trigger, as Key=substring tested
    against the page's data layer. petzl.com pushes

      {'PageName':'Web_DealerLocator','PageType':'DealerLocator', ...}

    and the tag that loads their map is held behind a _cn on PageType, so

      petzl.com##+js(gtm-tag, https://maps.googleapis.com/..., initGmaps, PageType=DealerLocator)

    is the same test the container makes. It matters because a scriptlet
    filter cannot be scoped to a path: without it this runs on every page of
    a site, and a tag meant for one page would load on all of them.
    tools/tags.mjs reads the trigger out of a container and writes the line.

    Only https is accepted, and only as a scriptlet: used as a redirect the
    placeholders are never filled in, and this does nothing at all.

    It loads a script you have named. That is the point of it and also the
    whole of its risk - keep it to your own filters, where you can see what
    the url is.

*/

function consentRRGtmTag(url = '', needs = '', when = '') {
    const w = window;
    const doc = w.document;
    const VERSION = '@@VERSION@@';
    const NAME = 'gtm-tag';
    // Not the name of this function: re-injected, the function declaration
    // is hoisted over whatever was stored there and the guard is lost. That
    // has been got wrong twice in this repo now.
    const MARKER = 'consentRRGtmTagLoaded';

    const given = value => typeof value === 'string' && value !== '';

    const say = what => {
        try {
            w.console.info('[gtm-rr] ' + NAME + ' ' + VERSION + ' ' + what);
        } catch(ex) {
        }
    };

    // No url: used without arguments, or served as a redirect, which this
    // is not for.
    if ( given(url) === false ) { return; }

    // A third argument is the trigger: Key=substring, tested against the
    // page's data layer, which is where a container reads a condition like
    // this from too. petzl.com pushes
    //   {'PageName':'Web_DealerLocator','PageType':'DealerLocator', ...}
    // and the tag that loads their map is held behind a _cn on PageType, so
    //   PageType=DealerLocator
    // is that same test. It matters because a scriptlet filter cannot be
    // scoped to a path: without it this runs on every page of a site, and a
    // tag meant for one page would load on all of them.
    let key = '';
    let wanted_in = '';
    if ( given(when) ) {
        const at = when.indexOf('=');
        if ( at < 1 ) {
            say('refused=condition when=' + when);
            return;
        }
        key = when.slice(0, at).trim();
        wanted_in = when.slice(at + 1).trim();
    }

    // Last write wins, as their model's get does, and a dotted key walks in
    // as theirs does: a.b reads b of a.
    const layerValue = ( ) => {
        try {
            const layer = w.dataLayer;
            if ( Array.isArray(layer) === false ) { return undefined; }
            const parts = key.split('.');
            let found;
            for ( const item of layer ) {
                let node = item;
                let ok = true;
                for ( const part of parts ) {
                    if ( node === null ) { ok = false; break; }
                    if ( typeof node !== 'object' ) { ok = false; break; }
                    if ( Object.prototype.hasOwnProperty.call(node, part) === false ) {
                        ok = false;
                        break;
                    }
                    node = node[part];
                }
                if ( ok ) { found = node; }
            }
            return found;
        } catch(ex) {
        }
        return undefined;
    };

    const matched = ( ) => {
        if ( given(when) === false ) { return true; }
        const value = layerValue();
        if ( value === undefined ) { return false; }
        try {
            return String(value).indexOf(wanted_in) !== -1;
        } catch(ex) {
        }
        return false;
    };

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
                (given(needs) ? ' waited=' + needs : '') +
                (given(when) ? ' when=' + when : ''));
            return true;
        } catch(ex) {
        }
        return false;
    };

    // Nothing to wait for and nothing to test: the tag stands alone, so it
    // goes in as soon as there is a document to put it in.
    if ( given(needs) === false && given(when) === false ) {
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
    // An empty function is a placeholder, not the callback. petzl.com's
    // dealer page defines
    //   window.initGmaps = window.initGmaps || function() { };
    // in the head so their other pages do not throw, and the real initGmaps
    // is assigned inside petzl.controllers.map, their map controller, when
    // the page constructs it. A loader answered by the placeholder draws
    // nothing and reports nothing - the only sign is the absence of whatever
    // the real one does, which on that page is the browser asking for the
    // user's location.
    const reEmptyBody = /\{\s*\}\s*$/;

    const placeholder = fn => {
        try {
            return reEmptyBody.test(w.Function.prototype.toString.call(fn));
        } catch(ex) {
        }
        return false;
    };

    const ready = ( ) => {
        if ( matched() === false ) { return false; }
        if ( given(needs) === false ) { return true; }
        try {
            const fn = w[needs];
            if ( typeof fn !== 'function' ) { return false; }
            return placeholder(fn) === false;
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
                // Whatever is there after this long is what the page has. A
                // placeholder is still worth loading for: their own code
                // guards on the loader's global existing - petzl's
                // onSearchDealer opens with if (!window.google) return; - so
                // a search the page makes later works even when the callback
                // was spent on an empty function.
                // The trigger is different from the callback: a page it
                // does not match is a page the tag was never meant for, so
                // there is nothing to fall back to.
                if ( matched() === false ) {
                    say('gave-up=' + when + ' after=' + UNTIL + 'ms');
                    return;
                }
                if ( given(needs) && typeof w[needs] === 'function' ) {
                    say('waited-out=' + needs + ' after=' + UNTIL + 'ms');
                    inject();
                    return;
                }
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

    // Not while the document is still being parsed. Their own tags fire after
    // that at the earliest - the one this stands in for fires on a consent
    // event, later still - and a page that has not finished parsing has not
    // run the code that sets up what the tag is for.
    // One task after that event, not in the listener itself. This runs at
    // document_start, so its listener is registered before any the page adds
    // and would run before them - and petzl.com assigns the real initGmaps
    // from one of theirs:
    //   $(document).ready(function(){ new petzl.controllers.DealerLocator; });
    // Every listener for that event runs in the one task, so a timeout
    // scheduled from ours runs after all of them, and what this looks at is
    // what the page has finished setting up.
    const soon = ( ) => {
        try {
            w.setTimeout(begin, 0);
        } catch(ex) {
            begin();
        }
    };

    try {
        if ( doc.readyState !== 'loading' ) { begin(); }
        else {
            doc.addEventListener('DOMContentLoaded', soon, { once: true });
        }
    } catch(ex) {
    }
}

consentRRGtmTag();
