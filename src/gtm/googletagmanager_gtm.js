/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Stands in for both of Google's loaders - googletagmanager.com/gtm.js and
    /gtag/js - and ships under uBlock Origin's own resource name, which a user
    resource of the same name replaces.

*/

// @include lib/gtm-core.js

// 'self' marks the call this file makes on its own behalf, which is the one
// that stands in for the container. uBO appends its own call per filter, and
// those only carry out what their arguments ask for.
consentRRGtm('', '', 'self');
