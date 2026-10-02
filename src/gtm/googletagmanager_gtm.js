/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Stands in for both of Google's loaders - googletagmanager.com/gtm.js and
    /gtag/js - and ships under uBlock Origin's own resource name, which a user
    resource of the same name replaces.

*/

// @include lib/gtm-core.js

consentRRGtm();
