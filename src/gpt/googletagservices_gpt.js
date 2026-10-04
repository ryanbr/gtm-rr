/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Stands in for Google Publisher Tag, and ships under uBlock Origin's own
    resource name so a user resource of that name replaces their built-in -
    the same arrangement googletagmanager_gtm.js already uses.

    Why replace theirs: it throws. Twenty-five documented, publisher-facing
    GPT calls raise a TypeError on it rather than answering, which takes out
    the rest of whatever function the page was in. Allowing the real file and
    blocking it both leave a page coherent; a stub that throws is the only
    outcome that does neither. The surface here was built by enumerating the
    real gpt.js in a browser rather than from either project's resource, so
    it is measured against what pages are written for:

      googletag                29 names on the real file
      pubads()                 51
      defineSlot(...)          37
      companionAds()           14
      content()                 6
      secureSignalProviders     4, and NOT an array

    Theirs covers 15 / 36 / 20 / 3 / 2 / 0 of those. AdGuard's covers more
    and is otherwise a working fake - slot identity, targeting state, a real
    display() that builds an iframe. This is neither: it answers everything
    and does nothing, which is the shape a stand-in should have.

    Two things it will not do, both for the same reason as the rest of this
    repo:

      no invented ids          getCorrelator and getTagSessionCorrelator
                               answer '' and 0. The real ones are a
                               request-joining id; minting one here would be
                               this resource creating the thing the blocking
                               exists to prevent.
      no signal collection     secureSignalProviders.push does nothing, so a
                               third party's collectorFunction is never
                               invoked and no encrypted signal is generated,
                               let alone sent. Anything the page queued before
                               this arrived is left where it is, because
                               draining it would run those collectors.

    What it does answer, beyond the surface: the slot events a page branches
    on. A great deal of publisher code is

      googletag.pubads().addEventListener('slotRenderEnded', e => {
          if ( e.isEmpty ) { collapse(div); } else { show(div); } });

    and a resource that registers that listener and never calls it leaves the
    page mid-decision - neither branch runs, so a slot meant to collapse when
    empty stays open for ever. This answers with isEmpty, which is the truth:
    nothing filled it.

    It does not build a google_ads_iframe_* in the slot, which AdGuard's does.
    An event is a page's own question answered; an iframe carrying
    data-load-complete is a prop for something checking whether an ad
    rendered, and that is a different business.

*/

function consentRRGpt() {
    const w = window;
    const doc = w.document;
    const NAME = 'googletagservices_gpt';
    const VERSION = '@@VERSION@@';

    const noop = function( ) { };
    const noopSelf = function( ) { return this; };
    const noopNull = function( ) { return null; };
    const noopList = function( ) { return []; };
    const noopStr = function( ) { return ''; };
    const noopObj = function( ) { return {}; };
    const noopFalse = function( ) { return false; };
    const noopZero = function( ) { return 0; };

    // Their enums, both directions, as the real file carries them - a page
    // reads googletag.enums.OutOfPageFormat.REWARDED, and an absent enums
    // throws on the property before the call.
    const twoWay = pairs => {
        const out = {};
        for ( const pair of pairs ) {
            out[pair[0]] = pair[1];
            out[pair[1]] = pair[0];
        }
        return out;
    };
    const enums = {
        OutOfPageFormat: twoWay([
            [ 'TOP_ANCHOR', 2 ], [ 'BOTTOM_ANCHOR', 3 ], [ 'REWARDED', 4 ],
            [ 'INTERSTITIAL', 5 ], [ 'AD_INTENTS', 6 ],
            [ 'GAME_MANUAL_INTERSTITIAL', 7 ], [ 'LEFT_SIDE_RAIL', 8 ],
            [ 'RIGHT_SIDE_RAIL', 9 ], [ 'CONTENT_OVERLAY', 10 ],
        ]),
        TrafficSource: twoWay([ [ 'PURCHASED', 1 ], [ 'ORGANIC', 2 ] ]),
        TagForAgeTreatment: twoWay([
            [ 'UNSPECIFIED', 0 ], [ 'CHILD', 1 ], [ 'TEEN', 2 ],
        ]),
    };

    // The listeners a page registers, and the events it branches on. Their
    // own set, in the order the real file fires them.
    const FIRED = [
        'slotRequested',
        'slotResponseReceived',
        'slotRenderEnded',
        'slotOnload',
        'impressionViewable',
    ];
    const listeners = new Map();

    const addEventListener = function(name, listener) {
        try {
            if ( typeof listener !== 'function' ) { return this; }
            if ( listeners.has(name) === false ) { listeners.set(name, []); }
            listeners.get(name).push(listener);
        } catch(ex) {
        }
        return this;
    };
    const removeEventListener = function(name, listener) {
        try {
            const had = listeners.get(name);
            if ( had === undefined ) { return false; }
            const at = had.indexOf(listener);
            if ( at === -1 ) { return false; }
            had.splice(at, 1);
            return true;
        } catch(ex) {
        }
        return false;
    };

    // Deferred, because theirs answers after the request rather than inside
    // display(), and a page that reads the DOM in its handler should not do
    // so while display() is still on the stack.
    const fireFor = slot => {
        for ( const name of FIRED ) {
            const had = listeners.get(name);
            if ( had === undefined || had.length === 0 ) { continue; }
            for ( const listener of had.slice() ) {
                const event = {
                    serviceName: 'publisher_ads',
                    slot: slot,
                    isEmpty: true,
                    size: null,
                    advertiserId: null,
                    campaignId: null,
                    creativeId: null,
                    lineItemId: null,
                    sourceAgnosticCreativeId: null,
                    sourceAgnosticLineItemId: null,
                    isBackfill: false,
                    slotContentChanged: false,
                };
                try {
                    w.setTimeout(( ) => {
                        try {
                            listener(event);
                        } catch(ex) {
                        }
                    }, 0);
                } catch(ex) {
                }
            }
        }
    };

    const slots = new Map();

    const makeSlot = (path, div) => {
        const slot = {
            addService: noopSelf,
            clearAdIntentsDrawerSlots: noop,
            clearCategoryExclusions: noopSelf,
            clearTargeting: noopSelf,
            defineSizeMapping: noopSelf,
            get: noopNull,
            getAdUnitPath: ( ) => String(path || ''),
            getAttributeKeys: noopList,
            getCategoryExclusions: noopList,
            getClickUrl: noopStr,
            getCollapseEmptyDiv: noopNull,
            getConfig: noopObj,
            getContentUrl: noopStr,
            getDivStartsCollapsed: noopNull,
            // Not on the real file: uBO's resource has carried it for years
            // and a page may have been written against theirs.
            getDomId: ( ) => String(div || ''),
            getEscapedQemQueryId: noopStr,
            getFirstLook: noopZero,
            getHtml: noopStr,
            getName: ( ) => String(path || ''),
            getOutOfPage: noopFalse,
            // An object, not null: every caller reads a field off it.
            getResponseInformation: noopObj,
            getServices: noopList,
            getSizes: noopList,
            getSlotElementId: ( ) => String(div || ''),
            getSlotId: noopSelf,
            getTargeting: noopList,
            getTargetingKeys: noopList,
            getTargetingMap: noopObj,
            requestAdIntentsDrawerSlot: noopNull,
            set: noopSelf,
            setCategoryExclusion: noopSelf,
            setClickUrl: noopSelf,
            setCollapseEmptyDiv: noopSelf,
            setConfig: noop,
            setForceSafeFrame: noopSelf,
            setSafeFrameConfig: noopSelf,
            setTargeting: noopSelf,
            updateTargetingFromMap: noopSelf,
        };
        return slot;
    };

    const defineSlot = function(path, sizes, div) {
        const id = String(div === undefined ? '' : div);
        if ( slots.has(id) === false ) { slots.set(id, makeSlot(path, id)); }
        return slots.get(id);
    };

    const PassbackSlot = {
        display: noop,
        get: noopNull,
        set: noopSelf,
        setClickUrl: noopSelf,
        setTagForChildDirectedTreatment: noopSelf,
        setTargeting: noopSelf,
        updateTargetingFromMap: noopSelf,
    };
    const passback = ( ) => Object.create(PassbackSlot);

    let initialLoadDisabled = false;

    const pubads = {
        addEventListener,
        removeEventListener,
        clear: noopFalse,
        clearCategoryExclusions: noopSelf,
        clearTagForChildDirectedTreatment: noopSelf,
        clearTargeting: noopSelf,
        collapseEmptyDivs: noopFalse,
        defineOutOfPagePassback: passback,
        definePassback: passback,
        disableInitialLoad: function( ) { initialLoadDisabled = true; },
        display: noop,
        enableAsyncRendering: noopFalse,
        enableLazyLoad: noop,
        enableSingleRequest: noopFalse,
        enableSyncRendering: noopFalse,
        enableVideoAds: noop,
        forceExperiment: noop,
        get: noopNull,
        getAttributeKeys: noopList,
        // Inert, deliberately. The real ones join a page's requests together;
        // one invented here would be this resource creating the id that
        // blocking the file exists to prevent.
        getCorrelator: noopStr,
        getTagSessionCorrelator: noopZero,
        getImaContent: noopNull,
        getName: ( ) => 'publisher_ads',
        getSlotIdMap: noopObj,
        getSlots: noopList,
        getTargeting: noopList,
        getTargetingKeys: noopList,
        getVersion: noopStr,
        getVideoContent: noopNull,
        isInitialLoadDisabled: ( ) => initialLoadDisabled,
        isSRA: noopFalse,
        markAsAmp: noop,
        refresh: noop,
        registerRequestHook: noop,
        set: noopSelf,
        setCategoryExclusion: noopSelf,
        setCentering: noop,
        setCookieOptions: noopSelf,
        setCorrelator: noopSelf,
        setForceSafeFrame: noopSelf,
        setImaContent: noopSelf,
        setLocation: noopSelf,
        setPrivacySettings: noopSelf,
        setPublisherProvidedId: noopSelf,
        setRequestNonPersonalizedAds: noopSelf,
        setSafeFrameConfig: noopSelf,
        setTagForChildDirectedTreatment: noopSelf,
        setTagForUnderAgeOfConsent: noopSelf,
        setTargeting: noopSelf,
        setVideoContent: noop,
        updateCorrelator: noopSelf,
    };

    const companionAds = {
        addEventListener,
        removeEventListener,
        enableSyncLoading: noop,
        getDisplayAdsCorrelator: noopStr,
        getName: ( ) => 'companion_ads',
        getSlotIdMap: noopObj,
        getSlots: noopList,
        getVideoStreamCorrelator: noopZero,
        isSlotAPersistentRoadblock: noopFalse,
        notifyUnfilledSlots: noop,
        onImplementationLoaded: noop,
        refreshAllSlots: noop,
        setRefreshUnfilledSlots: noop,
        setVideoSession: noop,
        slotRenderEnded: noop,
    };

    const content = {
        addEventListener,
        removeEventListener,
        getName: ( ) => 'content',
        getSlotIdMap: noopObj,
        getSlots: noopList,
        setContent: noop,
    };

    // Not an array, whatever its name suggests: the real one carries exactly
    // these four. push does nothing, so no collectorFunction ever runs.
    const signals = ( ) => ({
        push: noop,
        addErrorHandler: noop,
        addOnSignalResolveCallback: noop,
        clearAllCache: noop,
    });

    const sizeMapping = ( ) => {
        const builder = {
            addSize: ( ) => builder,
            build: noopNull,
        };
        return builder;
    };

    const gpt = w.googletag || {};
    const queued = Array.isArray(gpt.cmd) ? gpt.cmd : [];

    // Served as a redirect and injected as a scriptlet both, this file is
    // evaluated twice on the same page - and a second evaluation brings a new
    // closure, so its listeners Map and slots Map would be empty ones put in
    // front of the first copy's. Every listener a page had already registered
    // would then hear nothing. The first copy keeps the page.
    try {
        if ( gpt.consentRRGpt !== undefined ) { return; }
    } catch(ex) {
        return;
    }

    const display = function(what) {
        let id = '';
        try {
            if ( what !== null && typeof what === 'object' ) {
                id = typeof what.getSlotElementId === 'function'
                    ? what.getSlotElementId()
                    : String(what.id || '');
            } else {
                id = String(what === undefined ? '' : what);
            }
        } catch(ex) {
        }
        const slot = slots.get(id);
        if ( slot === undefined ) { return; }
        fireFor(slot);
    };

    gpt.consentRRGpt = VERSION;
    gpt.apiReady = true;
    // Not on the real file any more, and kept because theirs has carried it
    // for years: a page gating on it would otherwise wait for ever.
    gpt.pubadsReady = true;
    gpt._loaded_ = true;
    gpt._loadStarted_ = true;
    gpt._vars_ = gpt._vars_ || {};
    gpt._b_ = gpt._b_ || noop;
    gpt.cmd = [];
    gpt.cmd.push = function(fn) {
        try {
            fn();
        } catch(ex) {
        }
        return 1;
    };
    gpt.companionAds = ( ) => companionAds;
    gpt.content = ( ) => content;
    gpt.defineOutOfPageSlot = defineSlot;
    gpt.defineSlot = defineSlot;
    gpt.defineUnit = defineSlot;
    gpt.destroySlots = function( ) {
        slots.clear();
        return true;
    };
    gpt.disablePublisherConsole = noop;
    gpt.display = display;
    gpt.enableServices = noop;
    gpt.enums = enums;
    gpt.evalScripts = noop;
    gpt.getConfig = noopObj;
    gpt.getEventLog = noopObj;
    gpt.getVersion = noopStr;
    gpt.getWindowsThatCanCommunicateWithHostpageLibrary = noopList;
    gpt.onPubConsoleJsLoad = noop;
    gpt.openConsole = noop;
    gpt.pubads = ( ) => pubads;
    gpt.setAdIframeTitle = noop;
    gpt.setConfig = noop;
    gpt.sizeMapping = sizeMapping;
    // Two separate objects on the real file, not one aliased twice.
    gpt.secureSignalProviders = signals();
    gpt.encryptedSignalProviders = signals();

    try {
        w.googletag = gpt;
    } catch(ex) {
        return;
    }

    // Whatever the page queued before this arrived, run now - the same order
    // theirs drains it in.
    while ( queued.length !== 0 ) {
        gpt.cmd.push(queued.shift());
    }

    try {
        if ( doc !== undefined && w.console !== undefined ) {
            const level = w.localStorage.getItem('gtm-rr-debug');
            if ( level === 'verbose' || level === 'probe' ) {
                w.console.info('[gtm-rr] ' + NAME + ' ' + VERSION + ' answered');
            }
        }
    } catch(ex) {
    }
}

consentRRGpt();
