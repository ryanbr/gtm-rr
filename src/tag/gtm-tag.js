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

    A script that writes into the page is handled the way their own injectHtml
    does with vtp_usePostscribe: what it writes while it runs is caught and
    put where the script sits, because a script appended async runs after
    parsing and a document.write then would replace the whole document, so
    browsers ignore it.

    Only https is accepted, and only as a scriptlet: used as a redirect the
    placeholders are never filled in, and this does nothing at all.

    It loads a script you have named. That is the point of it and also the
    whole of its risk - keep it to your own filters, where you can see what
    the url is.

*/

function consentRRGtmTag(a1 = '', a2 = '', a3 = '', a4 = '', a5 = '') {
    const w = window;
    const doc = w.document;
    const VERSION = '@@VERSION@@';
    const NAME = 'gtm-tag';
    // Not the name of this function: re-injected, the function declaration
    // is hoisted over whatever was stored there and the guard is lost. That
    // has been got wrong twice in this repo now.
    const MARKER = 'consentRRGtmTagLoaded';

    const given = value => typeof value === 'string' && value !== '';

    // The filter's arguments, named or in the order they were first
    // documented. A src alone does not reproduce every tag a container
    // holds: OneTrust's loader needs its tenant, and carries it on the
    // element -
    //
    //   <script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"
    //           data-domain-script="bb3af1ef-...">
    //
    // - so without a way to set an attribute this could not reproduce the
    // tag a site's content is most often gated on. petzl.com and
    // globalblue.com both hold their consent manager that way.
    //
    //   example.com##+js(gtm-tag, https://host/thing.js)
    //   example.com##+js(gtm-tag, https://host/thing.js, initGmaps)
    //   example.com##+js(gtm-tag, https://host/x.js, attr:data-domain-script=abc)
    //   example.com##+js(gtm-tag, https://host/x.js, needs=jQuery, when=PageType=Shop)
    //
    // A url or a callback name can hold an '=' of its own, so only these
    // three keys and the attr: prefix count as named; anything else falls
    // through to the position it was given in. An empty argument needs no
    // guard of its own: these are assigned by index, so an empty one lands
    // where it was and moves nothing along. The resource that collapsed them
    // instead put 'self' where a selector goes.
    const named = {};
    const attrs = [];
    const loose = [ '', '', '' ];
    const args = [ a1, a2, a3, a4, a5 ];
    for ( let i = 0; i < args.length; i += 1 ) {
        const arg = args[i];
        if ( typeof arg !== 'string' ) { continue; }
        if ( arg.startsWith('attr:') ) {
            const at = arg.indexOf('=');
            if ( at > 5 ) {
                attrs.push([ arg.slice(5, at).trim(), arg.slice(at + 1) ]);
            }
            continue;
        }
        const at = arg.indexOf('=');
        const key = at > 0 ? arg.slice(0, at) : '';
        if ( key === 'url' || key === 'needs' || key === 'when' ||
            key === 'campaign' )
        {
            named[key] = arg.slice(at + 1).trim();
            continue;
        }
        if ( i < 3 ) { loose[i] = arg; }
    }
    const url = named.url !== undefined ? named.url : loose[0];
    const needs = named.needs !== undefined ? named.needs : loose[1];
    const when = named.when !== undefined ? named.when : loose[2];
    const campaign = named.campaign !== undefined ? named.campaign : '';

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

    // A tag whose script writes into the page. GTM's own injectHtml has a
    // path for this - vtp_usePostscribe, which tag 148 of hokkaido-np.co.jp's
    // container switches on because b-dash's btm.js calls document.write -
    // and without it the write is lost: a script appended async runs after
    // parsing, when document.write would replace the whole document, so
    // browsers ignore it and the tag quietly does nothing.
    //
    // So what it writes is caught and put where the script sits, which is
    // what their postscribe does. Only while that script is the one running:
    // document.currentScript says so, and anything else writing goes to the
    // real one untouched.
    const writtenBy = script => {
        let held = '';
        let write = null;
        let writeln = null;
        try {
            write = doc.write;
            writeln = doc.writeln;
            const catchIt = function( ) {
                try {
                    if ( doc.currentScript !== script ) {
                        return write.apply(doc, arguments);
                    }
                } catch(ex) {
                }
                held += [].join.call(arguments, '');
                return undefined;
            };
            doc.write = catchIt;
            doc.writeln = function( ) {
                catchIt.apply(doc, arguments);
                held += '\n';
                return undefined;
            };
        } catch(ex) {
            return null;
        }
        return ( ) => {
            try {
                doc.write = write;
                doc.writeln = writeln;
            } catch(ex) {
            }
            return held;
        };
    };

    // Their markup, where their script stood. A script element out of
    // innerHTML never runs - it is marked already-started - so each one is
    // rebuilt, in order, the way their executor rebuilds a text/gtmscript.
    const put = (html, after) => {
        let holder = null;
        try {
            holder = doc.createElement('template');
            holder.innerHTML = html;
        } catch(ex) {
            return 0;
        }
        const parent = after.parentNode || doc.head || doc.documentElement;
        if ( parent === null ) { return 0; }
        const at = after.nextSibling;
        const content = holder.content !== undefined ? holder.content : holder;
        const nodes = [];
        try {
            while ( content.firstChild !== null ) {
                const node = content.firstChild;
                content.removeChild(node);
                nodes.push(node);
            }
        } catch(ex) {
            return 0;
        }
        let count = 0;
        for ( const node of nodes ) {
            let adding = node;
            try {
                if ( node.nodeType === 1 && node.localName === 'script' ) {
                    adding = doc.createElement('script');
                    for ( const name of node.getAttributeNames() ) {
                        adding.setAttribute(name, node.getAttribute(name));
                    }
                    adding.textContent = node.textContent;
                    // In the order they were written, as a parser would.
                    adding.async = false;
                }
                parent.insertBefore(adding, at);
                count += 1;
            } catch(ex) {
            }
        }
        return count;
    };

    // Some loaders cannot start from their own URL, and naming the script is
    // then not enough. LivePerson's is the one this has met - uAssets #33693,
    // medibank.com.au's "Message us" button, which is an LPMcontainer their
    // engagement draws and GTM-TS6X5PB holds the only copy of the snippet
    // that starts it. Where that snippet used to sit inline the page has a
    // bare "<!--Live person and standard tag -->", and none of their twenty
    // clientlibs mentions lpTag, so there is nothing left in the page to
    // wait for.
    //
    // Their tag.js opens with
    //
    //   window.lpTag = window.lpTag || {}
    //
    // which reads as self-starting and is not: it takes the account as
    // "site = a.site || b.site" off objects the snippet was expected to have
    // built, and the first thing it does with them is b.defer(...). Appended
    // on its own it throws "TypeError: b.defer is not a function" with
    // lpTag.site null - measured on their page. What is missing is not a URL,
    // it is the object: an account id, three queueing functions, a loader for
    // their taglets, and seven arrays those push into.
    //
    // That object is published boilerplate, the same on every LivePerson site
    // but for the id, and it is rebuilt below rather than copied, so what
    // ships is this file's own expression of it. The id is read off the url
    // the filter already gives, so this needs no argument of its own and the
    // filter stays an ordinary line:
    //
    //   www.medibank.com.au##+js(gtm-tag, https://lptag.liveperson.net/tag/tag.js?site=3178090)
    //
    // Nothing is unblocked by it. The host is one no default list blocks - the
    // rule that would is in Fanboy's Social/Chat addon list, and a reader
    // running that is asking for chat widgets to be gone, so there the append
    // does not load and nothing comes back. Blocking stays the lists' call.
    const LP_PATH = '/tag/tag.js';
    const LP_HOST = 'liveperson.net';
    const reACCOUNT = /^[0-9]{3,12}$/;
    const reCAMPAIGN = /^[A-Za-z0-9_-]{1,40}$/;

    const lpTagUrl = ( ) => {
        try {
            const host = String(wanted.hostname);
            if ( host !== LP_HOST && host.endsWith('.' + LP_HOST) === false ) {
                return false;
            }
            return wanted.pathname === LP_PATH;
        } catch(ex) {
        }
        return false;
    };

    const lpAccount = ( ) => {
        try {
            const site = String(wanted.searchParams.get('site') || '');
            return reACCOUNT.test(site) ? site : '';
        } catch(ex) {
        }
        return '';
    };

    // Failing the url, the object: a page that sets lpTag.site itself is the
    // other documented way for the account to arrive, and a filter written
    // without the query string is right on such a page.
    const lpSeededAccount = ( ) => {
        try {
            const site = String((w.lpTag && w.lpTag.site) || '');
            return reACCOUNT.test(site) ? site : '';
        } catch(ex) {
        }
        return '';
    };

    const lpTagFor = site => {
        // A page may seed the object before the tag runs: sdes and vars are
        // the documented way to hand LivePerson a visitor's details, and a
        // site that does it writes them first. Their snippet reads every
        // field back out of whatever is there (section: lpTag.section || ""),
        // so dropping them would lose what the page meant to pass. Theirs is
        // also where autoStart's shape comes from: false only when the page
        // said false.
        let seeded = null;
        try {
            if ( w.lpTag && typeof w.lpTag === 'object' ) { seeded = w.lpTag; }
        } catch(ex) {
        }
        const was = (field, fallback) => {
            if ( seeded === null ) { return fallback; }
            try {
                const had = seeded[field];
                return had !== undefined && had !== null ? had : fallback;
            } catch(ex) {
            }
            return fallback;
        };
        const wasList = field => {
            const had = was(field, null);
            return Array.isArray(had) ? had : [];
        };

        // The buckets their taglets defer into: before the tag (0), on
        // trigger (1), and last for anything else. tag.js drains them by
        // these names.
        const BEFORE = '_defB';
        const TRIGGER = '_defT';
        const LAST = '_defL';

        const tag = {
            wl: was('wl', null),
            scp: was('scp', null),
            site: site,
            section: was('section', ''),
            tagletSection: was('tagletSection', null),
            autoStart: was('autoStart', true) !== false,
            ovr: was('ovr', {}),
            protocol: 'https:',
            // Their snippet's own version of itself, which taglets read to
            // decide what the host page supports. 1.10.0 is the one every
            // container carrying this tag ships.
            _v: '1.10.0',
            _tagCount: 1,
            isDom: false,
            _timing: {},
            vars: wasList('vars'),
            dbs: wasList('dbs'),
            ctn: wasList('ctn'),
            sdes: wasList('sdes'),
            hooks: wasList('hooks'),
            identities: wasList('identities'),
            ev: wasList('ev'),
        };

        // The one thing their bootstrap does not carry, and the thing the
        // button turned out to hang on. GTM-TS6X5PB has five tags touching
        // lpTag, not one, and the fifth is
        //
        //   var isSupported = CheckAbcSupport(), targetChannel = "chat";
        //   isSupported && (targetChannel = "abc");
        //   lpTag.sdes = lpTag.sdes || [];
        //   lpTag.sdes.push({ type: "mrktInfo",
        //                     info: { campaignId: targetChannel } });
        //
        // which is how their account picks a campaign. Measured against the
        // live page, back to back with the container allowed: with the
        // bootstrap alone lpTag comes up, every taglet loads and no
        // engagement is served; with that one SDE pushed, the LPMcontainer
        // and their message-us-button.svg render exactly as the container
        // produces them. A third tag sets lpTag.section from the path -
        // ["service","contact-us"] on /contact-us/ - and that turned out not
        // to matter: the SDE alone is enough, and section stayed [].
        //
        // mrktInfo is the only engagement datum worth synthesising here, and
        // deliberately the only one accepted. The others their container
        // pushes - customerSDE, cartSDE, purchaseSDE - are a visitor's
        // income band, basket and order, and a filter argument is no place
        // to invent those. This one is a campaign name and nothing else.
        //
        // Their abc-or-chat choice is a browser capability test, which this
        // does not make: a filter names one campaign and an Apple Business
        // Chat capable browser gets the chat engagement rather than the abc
        // one. A working button either way.
        if ( campaign !== '' ) {
            if ( reCAMPAIGN.test(campaign) ) {
                try {
                    tag.sdes.push({
                        type: 'mrktInfo',
                        info: { campaignId: campaign },
                    });
                } catch(ex) {
                }
            } else {
                say('refused=campaign campaign=' + campaign.slice(0, 24));
            }
        }

        tag.defer = function(fn, bucket) {
            const into = bucket === 0 ? BEFORE : bucket === 1 ? TRIGGER : LAST;
            if ( Array.isArray(this[into]) === false ) { this[into] = []; }
            this[into].push(fn);
        };

        // Until tag.js replaces these, a bind or a trigger is a call to make
        // later: it goes into the queue as a call on whatever events object
        // is there by then, which is theirs.
        tag.events = {
            bind: function(a, b, c) {
                tag.defer(( ) => { tag.events.bind(a, b, c); }, 0);
            },
            trigger: function(a, b, c) {
                tag.defer(( ) => { tag.events.trigger(a, b, c); }, 1);
            },
        };

        // Their framework loads its own taglets through this, so it stays
        // whatever else happens - the tag.js append itself is done below, by
        // the same path every other tag here takes.
        tag._load = function(url, charset, id) {
            const where = doc.head || doc.documentElement;
            if ( !where ) { return false; }
            const script = doc.createElement('script');
            script.setAttribute('charset', charset ? charset : 'UTF-8');
            if ( id ) { script.setAttribute('id', id); }
            script.setAttribute('src', url ||
                this.protocol + '//' +
                (this.ovr && this.ovr.domain ? this.ovr.domain : wanted.hostname) +
                LP_PATH + '?site=' + this.site);
            where.appendChild(script);
            return true;
        };

        tag.load = function(url, charset, id) {
            const self = this;
            try {
                w.setTimeout(( ) => { self._load(url, charset, id); }, 0);
            } catch(ex) {
                self._load(url, charset, id);
            }
        };

        tag.start = function( ) {
            this.autoStart = true;
        };

        tag._domReady = function(which) {
            if ( this.isDom !== true ) {
                this.isDom = true;
                try {
                    this.events.trigger('LPT', 'DOM_READY', { t: which });
                } catch(ex) {
                }
            }
            this._timing[which] = (new Date()).getTime();
        };

        // What theirs does in init() bar the load, which is this file's job:
        // the timing their taglets read, and the DOM_READY their framework
        // waits on. Dropping it would leave a page where the widget never
        // opens, since that trigger is queued for tag.js to drain.
        // Both of their milestones, however late this runs. Theirs is called
        // from a container tag and registers two listeners, so it always
        // records contReady and domReady; this runs a task after the document
        // parsed and can run after load as well, and a listener registered
        // then never fires - leaving _timing.domReady unset on a page where
        // theirs would have had it. Their framework reads that object, so the
        // milestone is taken from readyState where the event is already gone
        // rather than waited for.
        tag.init = function( ) {
            if ( this._timing.start !== undefined ) { return; }
            this._timing.start = (new Date()).getTime();
            const self = this;
            const ready = which => ( ) => { self._domReady(which); };
            try {
                if ( doc.readyState === 'loading' ) {
                    doc.addEventListener(
                        'DOMContentLoaded', ready('contReady'), { once: true }
                    );
                } else {
                    self._domReady('contReady');
                }
                if ( doc.readyState === 'complete' ) {
                    self._domReady('domReady');
                } else {
                    w.addEventListener('load', ready('domReady'), { once: true });
                }
            } catch(ex) {
            }
        };

        return tag;
    };

    // Run before the append, and the answer is whether to go on with it.
    const prepare = ( ) => {
        if ( lpTagUrl() === false ) { return true; }
        const site = lpAccount() || lpSeededAccount();
        // Their tag url with no account anywhere. Appending it is measured
        // broken - tag.js throws on the object it expected and leaves behind
        // the window.lpTag = window.lpTag || {} it opens with, which then
        // reads as present to anything that looks - so this refuses instead
        // and names what is missing. A url is not enough for this one, and a
        // filter that says nothing about why is a filter nobody can fix.
        if ( site === '' ) {
            say('refused=site url=' + wanted.href);
            return false;
        }
        // LivePerson's documented way to switch itself off, which a page or a
        // reader can set. Theirs checks it before loading and so does this: a
        // resource that puts back a widget somebody turned off is restoring
        // nothing.
        try {
            if ( typeof w._lptStop !== 'undefined' ) {
                say('refused=_lptStop site=' + site);
                return false;
            }
        } catch(ex) {
        }
        // Their snippet is written to run twice safely - a second copy only
        // raises _tagCount - and the same has to be true here, because a page
        // where the container was allowed through has the real one. _tagCount
        // is what theirs tests, so it is what this tests.
        try {
            const already = w.lpTag;
            if ( already && typeof already._tagCount !== 'undefined' ) {
                already._tagCount += 1;
                say('kept=theirs site=' + site);
                return false;
            }
        } catch(ex) {
        }
        const tag = lpTagFor(site);
        try {
            w.lpTag = tag;
            tag.init();
        } catch(ex) {
            say('failed=lpTag site=' + site);
            return false;
        }
        say('built=lpTag site=' + site +
            (campaign !== '' ? ' campaign=' + campaign : ''));
        return true;
    };

    const inject = ( ) => {
        try {
            // Once per url, however many times this runs.
            if ( w[MARKER] === undefined ) { w[MARKER] = {}; }
            if ( w[MARKER][id] === true ) { return true; }
            w[MARKER][id] = true;
            // The object some loaders read their account off, where this is
            // one of those urls. It also answers whether to append at all.
            if ( prepare() === false ) { return true; }
            const script = doc.createElement('script');
            script.async = true;
            script.src = wanted.href;
            // On the element, never on the url: a tenant id in a query
            // string is not what their loader reads.
            for ( const pair of attrs ) {
                try {
                    script.setAttribute(pair[0], pair[1]);
                } catch(ex) {
                }
            }
            const where = doc.head || doc.documentElement;
            if ( where === null ) { return false; }
            const written = writtenBy(script);
            const settle = ( ) => {
                if ( written === null ) { return; }
                const html = written();
                if ( html === '' ) { return; }
                const count = put(html, script);
                say('wrote=' + count + ' from=' + wanted.href);
            };
            try {
                script.addEventListener('load', settle, { once: true });
                script.addEventListener('error', settle, { once: true });
            } catch(ex) {
            }
            where.appendChild(script);
            say('injected=' + wanted.href +
                (given(needs) ? ' waited=' + needs : '') +
                (given(when) ? ' when=' + when : '') +
                (attrs.length !== 0
                    ? ' with=' + attrs.map(pair => pair[0]).join(',')
                    : ''));
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

    // Quick while this is a race - the callback a page assigns from a ready
    // handler lands within a tick or two of the look starting - and slower
    // after that, when it is only a page that may do something later. Ten
    // seconds at 50ms is 200 wakeups for a page the trigger excludes, which
    // is rude on a phone for no gain; this is 37.
    const EVERY = 50;
    const SLOWER = 500;
    const RACE = 1000;
    const UNTIL = 10000;
    let waited = 0;

    const look = ( ) => {
        if ( ready() === false ) {
            const step = waited < RACE ? EVERY : SLOWER;
            waited += step;
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
                w.setTimeout(look, step);
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
