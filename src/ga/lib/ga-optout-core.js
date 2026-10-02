/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    This one replaces nothing. It sets the switches Google's own code reads
    before it sends anything, for the case a redirect cannot cover: a bundle
    served from the site's own domain, behind a proxied path, or inlined in the
    page, where there is no third-party URL to match and so nothing to redirect.

    Their check, read off a served gtag/js and present in the gtm.js container
    too, with the window as uR and the document as sR:

      vR = function(a) {
          var b = uR._gaUserPrefs;
          if (b && b.ioo && b.ioo()
              || sR.documentElement.hasAttribute(
                     "data-google-analytics-opt-out")
              || a && uR["ga-disable-" + a] === !0) return !0;
          try { var c = uR.external;
                if (c && c._gaUserPrefs && c._gaUserPrefs == "oo") return !0
          } catch(f) {}
          for (var d = tR(function(f) { return f === "AMP_TOKEN" }).AMP_TOKEN
                   || [], e = 0; e < d.length; e++)
              if (d[e] == "$OPT_OUT") return !0;
          return sR.getElementById("__gaOptOutExtension") ? !0 : !1
      }

    and what consults it, per event and per destination:

      lS = function(a) {
          if (!Q(634) || !U(a, K.H.cj))
              if (vR(a.target.destinationId)) {
                  T(28); a.isAborted = !0; V(a, K.H.ib, !0)
              } else {
                  var b = nm();
                  if (b && Array.isArray(b.destinations))
                      for (var c = 0; c < b.destinations.length; c++)
                          if (vR(b.destinations[c])) {
                              T(125); a.isAborted = !0; V(a, K.H.ib, !0); break
                          }
              }
      }

    So an event is aborted where the check passes for its destination or for
    any destination the container carries, and vR() called with no id at all
    still answers from the first two switches. That is the whole mechanism:
    nothing is emulated here, no API is stood in for, and the page keeps a
    real, working, self-disabled Google bundle.

    Three of their six are set:

      _gaUserPrefs.ioo         theirs is the protocol Google's own opt-out
                               add-on uses, and it is id-independent, so it
                               covers destinations that are not on the page
                               yet. Neither bundle ever writes this object -
                               both only read it - so a plain assignment is
                               not at risk of being clobbered, and an object
                               the page already put there keeps its other
                               fields.
      data-google-analytics-opt-out
                               theirs, on the document element, also
                               id-independent.
      ga-disable-<id>          theirs, per measurement id, and the one Google
                               documents for site owners - so code outside
                               their bundle looks at it too. The ids come off
                               the page: ?id= on a googletagmanager URL, and
                               the G-, AW-, DC-, GT- and GTM- ids an inline
                               snippet names.

    Three are not:

      window.external          not settable from a content script in any
                               browser this matters in.
      AMP_TOKEN=$OPT_OUT       a cookie, and writing one to announce a refusal
                               to send is a worse trade than the two switches
                               above, which need no storage at all.
      #__gaOptOutExtension     an element, and the most visible of the six: it
                               is a marker their add-on leaves, and any script
                               on the page can see it. The two id-independent
                               switches already answer every path that reads
                               the element, so this adds reach to nobody but a
                               fingerprinter.

*/

function consentRRGaOptOut() {
    const w = window;
    const doc = w.document;
    const VERSION = '@@VERSION@@';
    const NAME = 'ga-optout';
    const ATTRIBUTE = 'data-google-analytics-opt-out';
    // Not the name of this function: assigning the version to that would be
    // overwritten by the function declaration the next time this is injected,
    // and the guard below would miss.
    const FLAG = 'consentRRGaOptOutDone';

    if ( w[FLAG] === VERSION ) { return; }

    // Their first switch, and the one that needs no id: the protocol their
    // own opt-out add-on speaks.
    const prefs = ( ) => {
        try {
            let object = w._gaUserPrefs;
            if ( object === null || typeof object !== 'object' ) {
                object = {};
            }
            object.ioo = ( ) => true;
            w._gaUserPrefs = object;
            return w._gaUserPrefs.ioo() === true;
        } catch(ex) {
        }
        return false;
    };

    // Their second, on the document element.
    const attribute = ( ) => {
        try {
            const root = doc.documentElement;
            if ( root === null ) { return false; }
            root.setAttribute(ATTRIBUTE, '');
            return root.hasAttribute(ATTRIBUTE);
        } catch(ex) {
        }
        return false;
    };

    // Their third, per measurement id. Theirs reads
    // window["ga-disable-" + id] === true, so the ids have to be found - off
    // the loader's own query, and out of an inline snippet's text.
    const PREFIXES = [ 'G-', 'UA-', 'AW-', 'DC-', 'GT-', 'GTM-' ];

    const looksLikeId = value => {
        if ( typeof value !== 'string' ) { return false; }
        for ( const prefix of PREFIXES ) {
            if ( value.startsWith(prefix) === false ) { continue; }
            const rest = value.slice(prefix.length);
            if ( rest === '' ) { return false; }
            return /^[A-Za-z0-9-]+$/.test(rest);
        }
        return false;
    };

    const idsFromUrl = src => {
        const found = [];
        if ( typeof src !== 'string' ) { return found; }
        if ( src.indexOf('googletagmanager.com') === -1 ) {
            if ( src.indexOf('/gtag/js') === -1 && src.indexOf('/gtm.js') === -1 ) {
                return found;
            }
        }
        const pos = src.indexOf('?');
        if ( pos === -1 ) { return found; }
        for ( const pair of src.slice(pos + 1).split('&') ) {
            const eq = pair.indexOf('=');
            if ( eq === -1 ) { continue; }
            if ( pair.slice(0, eq) !== 'id' ) { continue; }
            let value = '';
            try {
                value = decodeURIComponent(pair.slice(eq + 1));
            } catch(ex) {
                value = pair.slice(eq + 1);
            }
            if ( looksLikeId(value) ) { found.push(value); }
        }
        return found;
    };

    // An inline snippet names its ids in its own text, which is where a
    // first-party or proxied loader hides them.
    const reInline = /['"]((?:G|UA|AW|DC|GT|GTM)-[A-Za-z0-9-]+)['"]/g;

    const idsFromText = text => {
        const found = [];
        if ( typeof text !== 'string' ) { return found; }
        if ( text.length > 20000 ) { return found; }
        let match = reInline.exec(text);
        while ( match !== null ) {
            if ( looksLikeId(match[1]) ) { found.push(match[1]); }
            match = reInline.exec(text);
        }
        reInline.lastIndex = 0;
        return found;
    };

    const disable = id => {
        try {
            w['ga-disable-' + id] = true;
            return w['ga-disable-' + id] === true;
        } catch(ex) {
        }
        return false;
    };

    const sweep = ( ) => {
        const seen = {};
        const take = id => {
            if ( Object.prototype.hasOwnProperty.call(seen, id) ) { return; }
            if ( disable(id) === false ) { return; }
            seen[id] = true;
        };
        try {
            for ( const tag of Array.from(doc.querySelectorAll('script')) ) {
                for ( const id of idsFromUrl(tag.getAttribute('src')) ) {
                    take(id);
                }
                if ( tag.hasAttribute('src') ) { continue; }
                for ( const id of idsFromText(tag.textContent) ) { take(id); }
            }
        } catch(ex) {
        }
        return Object.keys(seen);
    };

    const ioo = prefs();
    const marked = attribute();
    let ids = sweep();

    // The two switches above are id-independent and already cover a
    // destination that turns up later; this is only so a reader outside their
    // bundle, which looks at the documented flag alone, sees it too. Their own
    // sweep of the page happens as it parses, so one more pass once it has.
    const later = ( ) => {
        const grown = sweep();
        if ( grown.length === ids.length ) { return; }
        ids = grown;
        try {
            w.console.info(
                '[gtm-rr] ' + NAME + ' ' + VERSION +
                ' ids=' + grown.join(',')
            );
        } catch(ex) {
        }
    };

    try {
        if ( doc.readyState === 'loading' ) {
            doc.addEventListener('DOMContentLoaded', later, { once: true });
        }
    } catch(ex) {
    }

    try {
        w[FLAG] = VERSION;
    } catch(ex) {
    }

    try {
        w.console.info(
            '[gtm-rr] ' + NAME + ' ' + VERSION +
            ' ioo=' + (ioo ? 'set' : 'refused') +
            ' attribute=' + (marked ? 'set' : 'refused') +
            ' ids=' + (ids.length !== 0 ? ids.join(',') : 'none')
        );
    } catch(ex) {
    }
}
