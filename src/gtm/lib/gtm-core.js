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

function consentRRGtm(selector = '', needs = '', from = '') {
    const w = window;
    const doc = w.document;
    const NAME = 'googletagmanager_gtm';
    const VERSION = '@@VERSION@@';

    let gaCalls = null;

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

    // Said when it starts, which is either now or when a loader tag turns up
    // - injected as a scriptlet, there is nothing to stand in for yet.
    const announce = report => {
        // uBO's own resource noops ga, so standing in front of it has to -
        // but only once there is a loader to stand in for. Injected as a
        // scriptlet this runs on every page the rule covers, and a page with
        // no container has no business growing a ga() either.
        try {
            if ( typeof w.ga !== 'function' ) {
                w.ga = function( ) {
                    if ( gaCalls === null ) { return; }
                    gaCalls(arguments);
                };
            }
        } catch(ex) {
        }
        // Their own resource noops ga and says nothing. With the reporting on,
        // what a page called it with is worth having: it means analytics.js
        // was blocked without a stub of its own.
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
                ' debug=' + report.level
            );
        } catch(ex) {
        }
        // Where a real container answered, nothing went missing: its own tags
        // do whatever writing into the page they do.
        if ( report.installed === 'installed' ) { scan(); }
    };

    const say = what => {
        try {
            w.console.info('[gtm-rr] ' + NAME + ' ' + VERSION + ' ' + what);
        } catch(ex) {
        }
    };

    // A container does not only load tags, it also writes into the page - and
    // a site that has moved that work browser-side often leaves the same code
    // in the page, inside a <template>, where it waits for something to
    // insert it. shonenjumpplus.com is the worked example: four
    //
    //   <template class="js-browser-html-setting"><script> ... </script></template>
    //
    // blocks, one per banner area, each filling its own container and ending
    // with the event the page's carousel waits for. The HTML is the site's
    // own and already in the page; nothing had inserted it, and the container
    // was what used to do that work.
    //
    // A template's content is inert, but a script taken out of it runs as
    // soon as it lands in the document - it was never parser-inserted, so
    // nothing marks it as already started. Only the scripts are taken, so
    // none of the template's other markup is duplicated into the page.
    //
    // This is opt-in per site and takes the selector from the filter, because
    // running whatever a page left in a template would be a way to un-gate a
    // consent-gated embed. Nothing here is site-specific.
    const MARKED = 'data-consent-rr-gtm';

    // A script the page marked as something other than JavaScript is not
    // ours to run: GTM's own templates carry type="text/gtmscript" exactly so
    // that the browser leaves them alone.
    const runnable = type => {
        if ( type === '' ) { return true; }
        if ( type === 'module' ) { return true; }
        return /^(?:text|application)\/(?:java|ecma)script$/i.test(type);
    };

    // What a template has to look like before this runs it on its own, with
    // no filter naming it. Each of these is about not running something the
    // page is holding back on purpose:
    //
    //   nothing but code     a template carrying markup is a payload someone
    //                        clones when they are ready, not deferred work
    //   no src               a third-party script is the page's to load, and
    //                        a consent-gated embed looks exactly like one
    //   no embedding         code that creates a script, iframe, object or
    //                        embed, or writes with document.write, can load a
    //                        third party itself, which is the same objection
    //
    // shonenjumpplus.com's four pass all three: one inline script each,
    // nothing else in the template, and not a mention of script or iframe in
    // 27KB of banner HTML. A filter that names a selector overrides this -
    // that is a person deciding, and some tags a container used to inject
    // really are third-party scripts.
    const reEmbeds =
        /(?:<\s*|createElement\s*\(\s*["'])\s*(?:script|iframe|object|embed)|document\s*\.\s*write/i;

    const codeOnly = template => {
        let scripts = [];
        let children = [];
        try {
            const content = template.content;
            if ( content === null || content === undefined ) { return false; }
            scripts = content.querySelectorAll('script');
            children = content.children;
        } catch(ex) {
            return false;
        }
        if ( scripts.length === 0 ) { return false; }
        if ( children.length !== scripts.length ) { return false; }
        let code = '';
        for ( const script of scripts ) {
            try {
                if ( script.hasAttribute('src') ) { return false; }
                const type = String(script.getAttribute('type') || '').trim();
                if ( runnable(type) === false ) { return false; }
                code += script.textContent + '\n';
            } catch(ex) {
                return false;
            }
        }
        return reEmbeds.test(code) === false;
    };

    const runTemplate = template => {
        let scripts = [];
        try {
            const content = template.content;
            if ( content === null || content === undefined ) { return [ 0, 0 ]; }
            scripts = content.querySelectorAll('script');
            if ( scripts.length === 0 ) { return [ 0, 0 ]; }
            template.setAttribute(MARKED, VERSION);
        } catch(ex) {
            return [ 0, 0 ];
        }
        let ran = 0;
        let left = 0;
        for ( const script of scripts ) {
            let type = '';
            let src = '';
            try {
                type = String(script.getAttribute('type') || '').trim();
                src = String(script.getAttribute('src') || '').trim();
            } catch(ex) {
            }
            if ( runnable(type) === false ) {
                left += 1;
                continue;
            }
            try {
                // Built fresh rather than cloned, so what lands in the
                // document is the script and nothing around it.
                const copy = doc.createElement('script');
                if ( type !== '' ) { copy.type = type; }
                if ( src !== '' ) { copy.src = src; }
                else { copy.textContent = script.textContent; }
                const where = doc.head || doc.documentElement;
                if ( where === null ) { continue; }
                where.appendChild(copy);
                ran += 1;
            } catch(ex) {
            }
        }
        return [ ran, left ];
    };

    const missing = ( ) => {
        if ( needs === '' ) { return false; }
        try {
            return w[needs] === undefined;
        } catch(ex) {
        }
        return false;
    };

    // Answers whether there is nothing left to wait for.
    const activate = ( ) => {
        let found = [];
        try {
            found = doc.querySelectorAll(selector);
        } catch(ex) {
            say('refused=selector selector=' + selector);
            return;
        }
        let ran = 0;
        let left = 0;
        let seen = 0;
        for ( const template of found ) {
            try {
                if ( template.localName !== 'template' ) { continue; }
                if ( template.hasAttribute(MARKED) ) { continue; }
            } catch(ex) {
                continue;
            }
            seen += 1;
            const counts = runTemplate(template);
            ran += counts[0];
            left += counts[1];
        }
        if ( seen === 0 ) { return false; }
        say('ran=' + ran + ' templates=' + seen +
            (left !== 0 ? ' left=' + left : '') + ' from=' + selector);
        return true;
    };

    // After the document has parsed, and one task later: a scriptlet runs at
    // document_start, so its DOMContentLoaded listener is registered before
    // any the page adds and would run before them - and a template's script
    // is usually written against what the page sets up in those. Then once
    // more at load, for a template that was not there the first time.
    // Quick while it is still a race, slower afterwards, the way gtm-tag
    // waits: a library a template's script is written against can arrive
    // late, and a template itself can be added to the page later.
    const EVERY = 50;
    const SLOWER = 500;
    const RACE = 1000;
    const UNTIL = 10000;
    let waited = 0;

    const look = ( ) => {
        if ( missing() === false && activate() ) { return; }
        const step = waited < RACE ? EVERY : SLOWER;
        waited += step;
        if ( waited >= UNTIL ) {
            say(missing() ? 'gave-up=' + needs : 'none=' + selector);
            return;
        }
        try {
            w.setTimeout(look, step);
        } catch(ex) {
        }
    };

    // No filter named a selector: every template the page carries that is
    // plainly deferred code and nothing else. Only where this stood in for a
    // container, because that is the work that went missing - a page whose
    // own container loaded is not missing anything.
    const generic = ( ) => {
        let found = [];
        try {
            found = doc.querySelectorAll('template');
        } catch(ex) {
            return;
        }
        let ran = 0;
        let seen = 0;
        let held = 0;
        for ( const template of found ) {
            try {
                if ( template.hasAttribute(MARKED) ) { continue; }
            } catch(ex) {
                continue;
            }
            if ( codeOnly(template) === false ) {
                held += 1;
                continue;
            }
            seen += 1;
            ran += runTemplate(template)[0];
        }
        if ( ran === 0 ) { return; }
        say('ran=' + ran + ' templates=' + seen +
            (held !== 0 ? ' held=' + held : '') + ' from=page');
    };

    // Twice, and no polling: a page's own deferred code is in the markup it
    // was served. A filter that names a selector gets the waiting, because
    // then there is something specific to wait for.
    const scan = ( ) => {
        const soon = ( ) => {
            try {
                w.setTimeout(generic, 0);
            } catch(ex) {
                generic();
            }
        };
        try {
            if ( doc.readyState === 'loading' ) {
                doc.addEventListener('DOMContentLoaded', soon, { once: true });
            } else {
                soon();
            }
            if ( doc.readyState === 'complete' ) { soon(); }
            else { w.addEventListener('load', soon, { once: true }); }
        } catch(ex) {
        }
    };

    const templates = ( ) => {
        const begin = ( ) => {
            try {
                w.setTimeout(look, 0);
            } catch(ex) {
                look();
            }
        };
        try {
            if ( doc.readyState === 'loading' ) {
                doc.addEventListener('DOMContentLoaded', begin, { once: true });
            } else {
                begin();
            }
        } catch(ex) {
        }
    };

    // Nothing to install twice: the resource is injected and then called
    // again by uBO for each filter that asked for it, so only the call this
    // file makes itself goes on to stand in for the container. A second
    // DELIVERY - the redirect landing as well as the scriptlet - has its own
    // copy of this file and so its own self call, which is what reports
    // push=already container=kept.
    if ( from !== 'self' ) {
        if ( selector !== '' ) { templates(); }
        return;
    }

    const core = consentRRGtmCore({
        name: NAME,
        started: announce,
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
    if ( core !== null ) { announce(core); }
    if ( selector !== '' ) { templates(); }
}

// Last, so that the first function declaration in the built resource is the
// one above: uBO reads the name off the front of a resource and calls that
// with the filter's arguments.
// @include ../../shared/lib/core.js
