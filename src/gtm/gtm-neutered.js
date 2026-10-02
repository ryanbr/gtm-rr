/*******************************************************************************

    gtm-rr - Google Tag Manager resource replacements for uBlock Origin
    Copyright (C) 2026-present ryanbr
    SPDX-License-Identifier: GPL-3.0-or-later

    Stands in for googletagmanager.com/gtm.js: the container loads nothing,
    fires no tag and asks for nothing, and the page keeps the API its own code
    was written against.

*/

// @include lib/gtm-core.js

consentRRGtm();
