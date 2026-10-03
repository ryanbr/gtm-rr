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

function consentRRGtm(a1 = '', a2 = '', a3 = '') {
    const w = window;
    const doc = w.document;
    const NAME = 'googletagmanager_gtm';

    // The filter's arguments, named or in the order they were first
    // documented. Named because there are three of them now and a position is
    // a poor way to ask for the third:
    //
    //   +js(googletagmanager_gtm, template.js-x)
    //   +js(googletagmanager_gtm, template.js-x, jQuery)
    //   +js(googletagmanager_gtm, event=aiRecommendGenerated)
    //   +js(googletagmanager_gtm, template=template.js-x, needs=jQuery)
    //   +js(googletagmanager_gtm, stub=amplitude)
    //
    // A selector can hold an '=' of its own - template[data-x="y"] - so only
    // these keys count as named, and anything else falls through to the
    // position it was given in.
    const given = {};
    // A position kept is a position: an argument left empty does not move the
    // ones after it along, which is how the call this file makes itself -
    // three arguments, the first two empty - put 'self' where a selector goes.
    const loose = [ '', '', '' ];
    const args = [ a1, a2, a3 ];
    for ( let i = 0; i < args.length; i += 1 ) {
        const arg = args[i];
        if ( typeof arg !== 'string' || arg === '' ) { continue; }
        const at = arg.indexOf('=');
        const key = at > 0 ? arg.slice(0, at) : '';
        if ( key === 'template' || key === 'needs' || key === 'event' ||
            key === 'from' || key === 'consent' || key === 'stub' )
        {
            given[key] = arg.slice(at + 1).trim();
            continue;
        }
        loose[i] = arg;
    }
    const selector = given.template !== undefined ? given.template : loose[0];
    const needs = given.needs !== undefined ? given.needs : loose[1];
    const event = given.event !== undefined ? given.event : '';
    const from = given.from !== undefined ? given.from : loose[2];
    const consentAsked = given.consent !== undefined ? given.consent : '';
    const asked = given.stub !== undefined ? given.stub : '';
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
        const consentState = report.installed === 'installed'
            ? assumeConsent()
            : 'left';
        try {
            w.console.info(
                '[gtm-rr] ' + NAME + ' ' + VERSION +
                ' loader=' + (report.path !== '' ? report.path : 'unknown') +
                ' id=' + (report.id !== '' ? report.id : 'unknown') +
                ' layer=' + report.layer +
                ' push=' + report.hooked +
                ' container=' + report.installed +
                ' hide=' + report.hiding() +
                ' consent=' + consentState +
                ' debug=' + report.level
            );
        } catch(ex) {
        }
        // Where a real container answered, nothing went missing: its own tags
        // do whatever writing into the page they do.
        if ( typeof report.live === 'function' ) { live = report.live; }
        if ( report.installed === 'installed' ) {
            scan();
            watchWaits();
            try {
                if ( doc.readyState === 'complete' ) {
                    w.setTimeout(tellWhatWaits, 0);
                } else {
                    w.addEventListener('load', ( ) => {
                        try {
                            w.setTimeout(tellWhatWaits, 0);
                        } catch(ex) {
                            tellWhatWaits();
                        }
                    }, { once: true });
                }
            } catch(ex) {
            }
        }
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
    // A consent manager the container used to load, and a page that reads
    // its state to decide whether to show its own content. Replacing the
    // loader takes the manager with it, so the state is never set and the
    // page waits for an answer nobody will give:
    //
    //   globalblue.com/es/refund-points-map
    //     checkOptanonActiveGroups() {
    //         const i = window.OptanonActiveGroups ?? '';
    //         return i.includes('C0001') && i.includes('C0002')
    //             && i.includes('C0003') }
    //     openOTYTNotification() { window.OneTrust?.ToggleInfoDisplay() }
    //
    // - so the map never renders and the button that would open the banner
    // optional-chains into nothing. Blocking gtm.js did that, which makes it
    // this resource's to answer.
    //
    // What it answers with is a judgement, stated plainly: the categories a
    // page needs to show its own content - necessary, performance,
    // functional - and NOT targeting or social, which is what an ad is gated
    // on. consent=all asks for those too; consent=off asks for none of it,
    // for a visitor running consent-rr, which does this properly for
    // nineteen managers with a stored and transmitted refusal behind it.
    //
    // Nothing is transmitted from here. This is a variable a page reads, and
    // every request that follows is still the filter lists' business.
    const CONTENT_GROUPS = 'C0001,C0002,C0003';
    const ALL_GROUPS = 'C0001,C0002,C0003,C0004,C0005';
    const GROUP_NAMES = [ 'OptanonActiveGroups', 'OnetrustActiveGroups' ];

    // Answers what it did, for the one line this resource prints: a second
    // line on every page is noise, and the summary is where its state goes.
    // What this put up, so a filter's own call can change it afterwards:
    // uBO appends that call after this file has run, so the only way an
    // argument can have a say is by adjusting what is already there.
    const GAVE = 'consentRRGtmGave';

    // Only this file's own call reaches here, and that one never carries a
    // filter's arguments - so off and all are not this function's business;
    // adjustConsent() applies those to what this put up.
    const assumeConsent = ( ) => {
        // Their state, whoever set it. One name holding a value means a
        // consent manager has spoken, and none of this is ours to touch.
        for ( const name of GROUP_NAMES ) {
            try {
                const had = w[name];
                if ( typeof had === 'string' && had !== '' ) { return 'theirs'; }
            } catch(ex) {
            }
        }
        const set = [];
        for ( const name of GROUP_NAMES ) {
            try {
                w[name] = CONTENT_GROUPS;
                set.push(name);
            } catch(ex) {
            }
        }
        try {
            if ( w.OneTrust === undefined ) {
                const noop = ( ) => undefined;
                w.OneTrust = {
                    // Their UI, which is not here: a page's reopen button
                    // calls this and must not throw or sit dead.
                    ToggleInfoDisplay: noop,
                    Close: noop,
                    changeLanguage: noop,
                    AllowAll: noop,
                    RejectAll: noop,
                    IsAlertBoxClosed: ( ) => true,
                    consentRRGtm: VERSION,
                };
                set.push('OneTrust');
            }
        } catch(ex) {
        }
        if ( set.length === 0 ) { return 'theirs'; }
        try {
            w[GAVE] = { groups: set, level: 'content' };
        } catch(ex) {
        }
        // Their own callback, which a page defines and their loader calls
        // once it has a state. Same contract as eventCallback.
        try {
            if ( typeof w.OptanonWrapper === 'function' ) {
                w.setTimeout(( ) => {
                    try {
                        w.OptanonWrapper();
                    } catch(ex) {
                    }
                }, 0);
            }
        } catch(ex) {
        }
        // And their event, which a page uses to re-check: globalblue does
        // fromEvent(window, 'OneTrustGroupsUpdated') and runs change
        // detection off it.
        const tellGroups = ( ) => {
            try {
                w.setTimeout(( ) => { fire('OneTrustGroupsUpdated'); }, 0);
            } catch(ex) {
            }
        };
        try {
            if ( doc.readyState === 'complete' ) { tellGroups(); }
            else { w.addEventListener('load', tellGroups, { once: true }); }
        } catch(ex) {
        }
        return 'content';
    };

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
        if ( live() ) { return; }
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
    // A page that waits to be told the work is done, where the telling was a
    // container's job and the name of it is the page's own. GTM has three of
    // these and this resource answers them all - eventCallback, gtag's
    // event_callback, and the anti-flicker hide.end() - but a site can
    // hand-roll a fourth, and then only a filter can say what it is called.
    //
    // hokkaido-np.co.jp: the page shows an overlay with 読み込み中... and
    //   window.addEventListener('aiRecommendGenerated', () => {
    //       spinnerOverlay.style.display = 'none'; ... })
    // is the only thing that takes it away. What fires it is three vendors
    // deep inside their container, so with the container replaced the overlay
    // spins for ever.
    //
    // Dispatched at the document and bubbling, because a listener on window
    // hears that and a listener on the document does not hear a dispatch at
    // window. Once, after load, when the page has registered what it is
    // going to. This ends the wait; it cannot produce what the page was
    // waiting FOR, so an area filled by a container's vendor stays empty.
    // On the window, not in here: the redirect landing and the scriptlet
    // running are two evaluations of this file with a closure each, and a
    // page's handler should hear its event once however many of us arrive.
    const TOLD = 'consentRRGtmTold';
    const fired = new Set();

    const fire = name => {
        try {
            if ( w[TOLD] === undefined ) { w[TOLD] = {}; }
            if ( w[TOLD][name] === true ) { return false; }
            w[TOLD][name] = true;
        } catch(ex) {
            if ( fired.has(name) ) { return false; }
            fired.add(name);
        }
        try {
            let ev = null;
            try {
                ev = new w.CustomEvent(name, {
                    bubbles: true,
                    cancelable: true,
                    detail: { consentRRGtm: VERSION },
                });
            } catch(ex) {
                ev = doc.createEvent('CustomEvent');
                ev.initCustomEvent(name, true, true, null);
            }
            doc.dispatchEvent(ev);
            return true;
        } catch(ex) {
        }
        return false;
    };

    const tell = ( ) => {
        say((fire(event) ? 'told=' : 'could-not-tell=') + event);
    };

    // With no filter to name it, the event has to be found. A page registers
    // what it is waiting for, so the registration is where to look: this
    // wraps addEventListener on the window and the document, keeps the names
    // nothing standard fires, and reads the handlers.
    //
    // Then it fires only the ones that look like a page revealing its own
    // content. Firing whatever a page listens for would be reckless - 'optin'
    // and 'consent' are events too, and b-dash's own script on the page that
    // led to this dispatches both - so a name or a handler that looks like
    // consent, tracking or loading is left alone. The filter form
    // (event=name) stays for the ones this refuses.
    const STANDARD = new Set([
        'click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseover',
        'mouseout', 'mouseenter', 'mouseleave', 'contextmenu', 'wheel',
        'keydown', 'keyup', 'keypress', 'input', 'change', 'submit', 'reset',
        'focus', 'blur', 'focusin', 'focusout', 'scroll', 'resize', 'load',
        'unload', 'beforeunload', 'pagehide', 'pageshow', 'popstate',
        'hashchange', 'DOMContentLoaded', 'readystatechange', 'visibilitychange',
        'touchstart', 'touchend', 'touchmove', 'touchcancel', 'pointerdown',
        'pointerup', 'pointermove', 'pointerover', 'pointerout', 'drag',
        'dragstart', 'dragend', 'dragover', 'drop', 'copy', 'cut', 'paste',
        'play', 'pause', 'ended', 'timeupdate', 'error', 'abort', 'online',
        'offline', 'message', 'storage', 'animationend', 'transitionend',
    ]);
    // What a handler that reveals the page's own content does.
    const reREVEAL = /display|visibility|hidden|opacity|classList|\.remove\(/i;
    // And what one that does something this has no business triggering does.
    const reKEEPOUT =
        /fetch\(|XMLHttpRequest|createElement|\.src\s*=|dataLayer|gtag\(|consent|optin|optout|cookie|localStorage|\.submit\(|location\s*=|location\.(?:href|assign|replace)/i;
    // A name is a clue of its own.
    const reNAMEOUT =
        /consent|optin|optout|cmp|gdpr|ccpa|accept|cookie|login|logout|signin|signup|purchase|checkout|order|submit|pay/i;

    const heard = new Map();

    // Whether a real container has taken over since. Their bind is what
    // triggers the yield and it comes later than the install, so this is
    // asked at the moment of doing something, not before.
    let live = ( ) => false;

    const noteWait = (type, listener) => {
        if ( typeof type !== 'string' || type === '' ) { return; }
        if ( STANDARD.has(type) ) { return; }
        if ( reNAMEOUT.test(type) ) { return; }
        let source = '';
        try {
            source = typeof listener === 'function'
                ? w.Function.prototype.toString.call(listener)
                : String((listener && listener.handleEvent) || '');
        } catch(ex) {
            return;
        }
        const was = heard.get(type) || [];
        was.push(source);
        heard.set(type, was);
    };

    const watchWaits = ( ) => {
        for ( const target of [ w, doc ] ) {
            try {
                const original = target.addEventListener;
                if ( typeof original !== 'function' ) { continue; }
                target.addEventListener = function(type, listener, options) {
                    try {
                        noteWait(type, listener);
                    } catch(ex) {
                    }
                    return original.call(this, type, listener, options);
                };
            } catch(ex) {
            }
        }
    };

    const ours = name => {
        const sources = heard.get(name) || [];
        if ( sources.length === 0 ) { return false; }
        for ( const source of sources ) {
            if ( reKEEPOUT.test(source) ) { return false; }
            if ( reREVEAL.test(source) === false ) { return false; }
        }
        return true;
    };

    const tellWhatWaits = ( ) => {
        // Their container answers its own page. Field-seen on
        // hokkaido-np.co.jp with gtm.js allowlisted: one copy of this
        // reported yielded=live-container while another told the page the
        // wait was over, which is theirs to do.
        if ( live() ) { return; }
        let told = 0;
        let held = 0;
        for ( const name of heard.keys() ) {
            if ( ours(name) === false ) {
                held += 1;
                continue;
            }
            fire(name);
            told += 1;
        }
        if ( told === 0 ) { return; }
        say('told=' + told + (held !== 0 ? ' held=' + held : '') +
            ' from=page');
    };

    const telling = ( ) => {
        const soon = ( ) => {
            try {
                w.setTimeout(tell, 0);
            } catch(ex) {
                tell();
            }
        };
        try {
            if ( doc.readyState === 'complete' ) { soon(); }
            else { w.addEventListener('load', soon, { once: true }); }
        } catch(ex) {
        }
    };

    // A container does not only measure a page, it installs other people's
    // SDKs into it - and a page then waits for the global that SDK creates.
    // Standing in for the container means that script is never injected, so
    // the global never arrives, and a page that waits for it with no timeout
    // in the wait waits for ever.
    //
    // b2c.voegol.com.br/minhas-viagens/login is the worked example, and there
    // is no end to its wait:
    //
    //   ngAfterViewInit() {
    //     this.waitForWindowProp('amplitude').subscribe(a => {
    //       this.goToLoginSmiles(this.culture, {
    //         deviceId: a.getDeviceId(), sessionId: a.getSessionId() })); }
    //   waitForWindowProp(name, every = 1200) {
    //     return timer(0, every).pipe(
    //       map(() => window[name]), filter(v => !!v), take(1)); }
    //
    // so the sign-in page polls for window.amplitude every 1.2 seconds and
    // navigates to the identity provider the first time it is there. The
    // container is what puts it there: an Amplitude tag that injects
    // cdn.amplitude.com/libs/analytics-browser-gtm-wrapper-*, whose own tags
    // then read amplitudeGTM.getDeviceId() back off the window. With this
    // standing in, nothing injects the wrapper and the page never leaves the
    // sign-in screen - no error, no timeout, nothing in the console.
    //
    // The name cannot be worked out here, which is why a filter names it. A
    // container is JSON this resource never fetches - it is served instead of
    // it - so there is nothing at runtime to read a vendor's global off, and
    // a read of a property that is not there is not observable. What this
    // provides is the shape rather than the name: a function that answers to
    // any property with itself, and returns undefined however it is called,
    // so a page can walk whatever path through it that SDK's API has.
    //
    // Undefined is the answer, not a plausible id. The page sends on what it
    // gets -
    //   ids?.deviceId && params.set('ampDeviceId', ids.deviceId)
    // - so a device id invented here would be this resource minting a
    // tracking id and then putting it in a URL bound for someone else, which
    // is the line gtag('get', ...) already refuses to cross. Falsy leaves the
    // parameter out and the sign-in carries on without it.
    //
    // Which is also why a call returns undefined rather than the stub again,
    // even though chaining would then carry amplitude.getInstance().logEvent()
    // the way that SDK's older API reads. A stub that answered its own calls
    // would be truthy, and the pages that wait for a global wait in order to
    // read values off it - a function where a device id goes is a function
    // stringified into a URL. One level further on, a call's return is where
    // an absent global throws today, so this is no worse there and ends the
    // wait, which is the whole of what it is for.
    //
    // Several names take one argument, so they need uBO's own escape -
    // +js(googletagmanager_gtm, stub=amplitude\,amplitudeGTM) - because the
    // comma it splits arguments on would otherwise put the second one where
    // needs= goes.
    //
    // Nothing is replaced: a global already there is left alone and said so,
    // and the stub goes on as a plain assignment, so the real SDK arriving
    // later overwrites it exactly as it would have overwritten nothing.
    const reGLOBAL = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
    const STUBS = 4;

    // The properties that have to answer for themselves. A stub that returns
    // a function for 'then' is a thenable, and awaiting it is a second wait
    // that never ends - this file exists to end those, not to add one.
    const PASS = new Set([
        'then', 'catch', 'finally', 'toString', 'toJSON', 'valueOf',
        'constructor', 'prototype', 'length', 'name', 'call', 'apply', 'bind',
    ]);

    const stubFor = ( ) => {
        const answer = function( ) { return undefined; };
        let self = answer;
        try {
            self = new w.Proxy(answer, {
                get: (target, key) => {
                    if ( typeof key !== 'string' ) { return target[key]; }
                    if ( PASS.has(key) ) { return target[key]; }
                    return self;
                },
            });
        } catch(ex) {
            return answer;
        }
        return self;
    };

    const stubbing = ( ) => {
        const names = [];
        for ( const part of asked.split(',') ) {
            const name = part.trim();
            if ( reGLOBAL.test(name) === false ) { continue; }
            if ( names.includes(name) ) { continue; }
            names.push(name);
            if ( names.length === STUBS ) { break; }
        }
        const made = [];
        const held = [];
        for ( const name of names ) {
            let there = undefined;
            try {
                there = w[name];
            } catch(ex) {
                held.push(name);
                continue;
            }
            if ( there !== undefined && there !== null ) {
                held.push(name);
                continue;
            }
            try {
                w[name] = stubFor();
                made.push(name);
            } catch(ex) {
                held.push(name);
            }
        }
        say('stub=' + (made.length !== 0 ? made.join(',') : 'none') +
            (held.length !== 0 ? ' held=' + held.join(',') : ''));
    };

    // What a filter asked for, applied to what this file's own call already
    // put up a moment ago. Removing it where the answer is off, raising it
    // where the answer is all.
    const adjustConsent = ( ) => {
        let gave = null;
        try {
            gave = w[GAVE];
        } catch(ex) {
        }
        if ( gave === null || gave === undefined ) { return; }
        if ( consentAsked === 'off' ) {
            for ( const name of gave.groups || [] ) {
                try {
                    delete w[name];
                } catch(ex) {
                }
            }
            try {
                if ( w.OneTrust && w.OneTrust.consentRRGtm === VERSION ) {
                    delete w.OneTrust;
                }
                delete w[GAVE];
            } catch(ex) {
            }
            say('consent=off');
            return;
        }
        if ( consentAsked === 'all' && gave.level !== 'all' ) {
            for ( const name of gave.groups || [] ) {
                try {
                    w[name] = ALL_GROUPS;
                } catch(ex) {
                }
            }
            try {
                gave.level = 'all';
            } catch(ex) {
            }
            say('consent=all');
        }
    };

    if ( from !== 'self' ) {
        // First: a page polling for a global may read it at any moment, and
        // the ones that read it once read it early.
        if ( asked !== '' ) { stubbing(); }
        if ( consentAsked !== '' ) { adjustConsent(); }
        if ( selector !== '' ) { templates(); }
        if ( event !== '' ) { telling(); }
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
