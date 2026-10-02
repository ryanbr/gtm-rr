/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    One resource for both of Google's loaders, because uBlock Origin's own
    lists send both to one name:

      privacy.txt  ||googletagmanager.com/gtag/js$script,xhr,
                     redirect=googletagmanager_gtm.js:5
      privacy.txt  ||googletagmanager.com/gtm.js$script,
                     redirect=googletagmanager_gtm.js:5,domain=~nerc.com

    and a user resource replaces a built-in of the same name: uBO awaits
    loadBuiltinResources first and parses the userResourcesLocation text after
    it, into the same Map. So this ships as googletagmanager_gtm.js, needs no
    filters of its own on the sites those rules already cover, and has to be
    at least as safe as the resource it stands in front of.

    What uBO's own version does, which this keeps:

      window.ga = window.ga || noopfn
                               a page calling ga() where analytics.js was
                               blocked without a stub would otherwise throw.
                               uBO's analytics surrogate assigns
                               w[gaName] = ga unconditionally and handles
                               hitCallback, so where that one applies it wins,
                               as it should.
      dataLayer.hide.end()     the anti-flicker undo, below.
      an eventCallback         called on a push, below. Theirs replaces push
                               outright, so the array keeps nothing and the
                               call returns undefined; this keeps the page's
                               array and returns what its own push returned.

    What it does not do, and this has to:

      window.google_tag_manager
                               absent there, so a page reading
                               google_tag_manager[id].dataLayer.get(...)
                               throws.
      it needs a data layer    theirs returns early where window.dataLayer is
                               not already an object, so on a page whose
                               snippet has not run yet - which at
                               document_start is every page - it does nothing
                               at all.

    The two loaders differ in exactly two places, both read off a served
    gtag/js and the containers GTM-KJZD388 and GTM-NSXXFR:

      onHtmlSuccess / onHtmlFailure
                               in the gtm.js build of their RU() only -
                                 b.onHtmlSuccess = vo(!0),
                                 b.onHtmlFailure = vo(!1)
                               the handlers an injected custom-HTML tag
                               reports through. The gtag/js build of the same
                               function has neither.
      RD.get                   in gtag/js only, and the one a page waits on:
                                 RD.get = function(a,b){ T(53);
                                   if (a.length===4 && Ib(a[1]) && Ib(a[2])
                                       && Hb(a[3])) { ...
                                     rD(d, function(h){
                                          od(function(){ e(h) }) },
                                        c.id, b) ... } }
                               so gtag("get", target, field, callback) answers
                               through the callback, deferred, with the
                               field's value.

                               undefined is the honest answer and the only
                               safe one: there is no client id or session id
                               because nothing is measuring, and inventing one
                               would mean this resource creating a tracking id
                               that a page may go on to put in a link.

                               Theirs parks a get for a destination the
                               container does not carry, to answer if it ever
                               arrives. Here it never does, so this answers
                               it: leaving the page waiting is the failure
                               this resource exists to prevent.

    Which surface to put up is read off the script's own src, the same place
    the container id comes from - so a page carrying both loaders gets the
    right one for each.

*/

// @include ../../shared/lib/core.js

function consentRRGtm() {
    const w = window;
    const NAME = 'googletagmanager_gtm';
    const VERSION = '@@VERSION@@';

    // uBO's own resource does this, so standing in front of it has to.
    const noopfn = ( ) => undefined;
    let gaCalls = null;
    try {
        if ( typeof w.ga !== 'function' ) {
            w.ga = function( ) {
                if ( gaCalls === null ) { return; }
                gaCalls(arguments);
            };
        }
    } catch(ex) {
    }

    let answered = 0;

    // Their RD.get, by its own shape test: four arguments, two strings and a
    // function.
    const command = (item, win) => {
        if ( Object.prototype.toString.call(item) !== '[object Arguments]' ) {
            return false;
        }
        if ( item.length !== 4 ) { return false; }
        if ( item[0] !== 'get' ) { return false; }
        if ( typeof item[1] !== 'string' ) { return false; }
        if ( typeof item[2] !== 'string' ) { return false; }
        const callback = item[3];
        if ( typeof callback !== 'function' ) { return false; }
        answered += 1;
        try {
            win.console.info(
                '[gtm-rr] ' + NAME + ' ' + VERSION +
                ' get=' + item[2] + ' answered=undefined'
            );
        } catch(ex) {
        }
        // Theirs defers it - od(function(){ e(h) }) - and hands over the
        // field's value, which here there is none of.
        const fire = ( ) => {
            try {
                callback(undefined);
            } catch(ex) {
            }
        };
        try {
            win.setTimeout(fire, 0);
            return true;
        } catch(ex) {
        }
        fire();
        return true;
    };

    const core = consentRRGtmCore({
        name: NAME,
        paths: [ '/gtm.js', '/gtag/js' ],
        // The container's two fields go on only where this is standing in for
        // the container.
        extrasFor: path => {
            if ( path !== '/gtm.js' ) { return {}; }
            return {
                onHtmlSuccess: ( ) => undefined,
                onHtmlFailure: ( ) => undefined,
            };
        },
        command,
    });
    if ( core === null ) { return; }
    const report = core;
    // Their own resource noops ga and says nothing. With debugging on, what a
    // page called it with is worth having: it means analytics.js was blocked
    // without a stub of its own.
    if ( report.debug ) {
        gaCalls = args => {
            try {
                report.report(
                    'ga', String(args[0]), [].slice.call(args, 1)
                );
            } catch(ex) {
            }
        };
    }

    try {
        w.console.info(
            '[gtm-rr] ' + NAME + ' ' + VERSION +
            ' loader=' + (report.path !== '' ? report.path : 'unknown') +
            ' id=' + (report.id !== '' ? report.id : 'unknown') +
            ' layer=' + report.layer +
            ' push=' + report.hooked +
            ' container=' + report.installed +
            ' hide=' + report.hiding() +
            ' debug=' + (report.debug ? 'on' : 'off')
        );
    } catch(ex) {
    }
}
