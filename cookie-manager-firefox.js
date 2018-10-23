/* globals chrome */
/* globals console */
/* globals compileDomainFilter, compileUrlFilter */
/* globals cookieValidators */
/* jshint browser: true */
/* jshint esversion: 6 */
'use strict';

if (typeof browser !== 'undefined') {
    // Firefox bugs...
    let {
        getAll: cookiesGetAll,
        getAllCookieStores: cookiesGetAllCookieStores,
        set: cookiesSet,
    } = chrome.cookies;
    let isPrivate = (details) => {
        return details.storeId ?
            details.storeId === 'firefox-private' :
            chrome.extension.inIncognitoContext;
    };
    let withLastError = function(callback, error) {
        if (callback) {
            let chromeRuntime = chrome.runtime;
            try {
                chrome.runtime = Object.create(chrome.runtime, {
                    lastError: { value: error },
                });
                callback();
            } finally {
                chrome.runtime = chromeRuntime;
            }
        } else {
            // I always set a callback, but throw just in case I don't to not hide errors.
            throw error;
        }
    };
    // https://hg.mozilla.org/mozilla-central/rev/17e4514dc6e6
    let kReplaceChars = /[\x00-\x1F/:*?"<>|\\]/g;
    let sanitizeFirstPartyDomain = function(details) {
        let {firstPartyDomain} = details;
        if (kReplaceChars.test(firstPartyDomain)) {
            // Sanitize firstPartyDomain to avoid crashes in Firefox 62 and earlier.
            details.firstPartyDomain = firstPartyDomain.replace(kReplaceChars, '+');
        }
    };
    chrome.cookies.getAll = function(details, callback) {
        sanitizeFirstPartyDomain(details);
        callback = getAllCallbackWithoutImmutableCookies(details, callback);
        if (!isPrivate(details) || !details.url && !details.domain) {
            cookiesGetAll(details, callback);
            return;
        }
        runWithoutPrivateCookieBugs(function() {
            cookiesGetAll(details, callback);
        }, function() {
            privateCookiesGetAll(details, callback);
        });
    };

    let privateCookiesGetAll = function(details, callback) {
        // Work around bugzil.la/1318948.
        // and work around bugzil.la/1381197.
        var {domain, url} = details;
        var matchesUrl = url && compileUrlFilter(new URL(url));
        var matchesDomain = domain && compileDomainFilter(domain);
        var allDetails = Object.assign({}, details);
        delete allDetails.domain;
        delete allDetails.url;
        cookiesGetAll(allDetails, function(cookies) {
            if (!cookies) {
                callback(cookies);
                return;
            }
            if (matchesUrl) {
                cookies = cookies.filter(matchesUrl);
            }
            if (matchesDomain) {
                cookies = cookies.filter(matchesDomain);
            }
            callback(cookies);
        });
    };

    chrome.cookies.getAllCookieStores = function(callback) {
        if (window.browser.contextualIdentities) {
            // getAllCookieStores only returns cookie stores with an active tab - bugzil.la/1486274
            // Let's query the list of containers and add those too.
            // This is also done to ensure a stable and consistent ordering.
            Promise.all([
                window.browser.contextualIdentities.query({}).catch(() => []),
                window.browser.cookies.getAllCookieStores(),
            ]).then(function([contextualIdentities, activeCookieStores]) {
                var cookieStoreIds = contextualIdentities.map(ci => ci.cookieStoreId);
                if (activeCookieStores.some(cs => cs.id === 'firefox-private')) {
                    cookieStoreIds.unshift('firefox-private');
                }
                cookieStoreIds.unshift('firefox-default');
                var cookieStores = cookieStoreIds.map(id => {
                    let cookieStore = activeCookieStores.find(cs => cs.id === id);
                    if (cookieStore) {
                        return cookieStore;
                    }
                    return {id, tabIds: []};
                });
                callback(cookieStores);
            });
            return;
        }
        cookiesGetAllCookieStores(function(cookieStores) {
            if (cookieStores) {
                callback(cookieStores);
                return;
            }
            // In Firefox for Android before version 54, chrome.cookies.getAllCookieStores
            // fails due to the lack of tabs API support.
            cookieStores = [{
                id: 'firefox-default',
                tabIds: [],
            }, {
                id: 'firefox-private',
                tabIds: [],
            }];
            callback(cookieStores);
        });
    };

    let pendingPrivateCookieRequests = [];
    let hasNoPendingCookieRequests = true;
    let queueRequestToSetCookies = function(cookie, callback = function() {}) {
        // Queue cookie requests so that when chrome.cookies.set is called in a loop,
        // that similar cookies are grouped together in a single request.
        pendingPrivateCookieRequests.push([cookie, callback]);
        if (hasNoPendingCookieRequests) {
            hasNoPendingCookieRequests = false;
            if (!chrome.extension.inIncognitoContext) {
                Promise.resolve().then(function() {
                    hasNoPendingCookieRequests = true;
                    var requests = pendingPrivateCookieRequests.splice(0);
                    var callbacks = requests.map(([cookie, callback]) => callback);
                    var error = new Error(
                        'Cannot modify ' + requests.length +
                        ' private cookies due to browser bugs.' +
                        ' Please open the Cookie Manager in private browsing mode and try again.');
                    withLastError(function() {
                        callbacks.forEach(function(callback) {
                            callback();
                        });
                    }, error);
                });
                return;
            }
            // It is important that getConsentForRequests returns a promise, because that
            // ensures that multiple chrome.cookies.set calls in a loop are grouped together.
            getConsentForRequests().then(function() {
                hasNoPendingCookieRequests = true;
                var requests = pendingPrivateCookieRequests.splice(0);
                var cookies = requests.map(([cookie, callback]) => cookie);
                var callbacks = requests.map(([cookie, callback]) => callback);
                setCookiesInPrivateMode(cookies).then(function(results) {
                    var error = results.errorMessage && new Error(results.errorMessage);
                    callbacks.forEach(function(callback, i) {
                        if (results[i]) {
                            callback();
                        } else {
                            withLastError(callback, error || {message: 'Unknown error'});
                        }
                    });
                });
            }, function(error) {
                hasNoPendingCookieRequests = true;
                var requests = pendingPrivateCookieRequests.splice(0);
                var callbacks = requests.map(([cookie, callback]) => callback);
                withLastError(function() {
                    callbacks.forEach(function(callback) {
                        callback();
                    });
                }, error);
            });
        }
    };

    // It's assumed that the |cookie| parameter is not modified by the caller after calling us.
    chrome.cookies.set = function(cookie, callback) {
        sanitizeFirstPartyDomain(cookie);
        function setWithCookiesAPI() {
            if (!('expirationDate' in cookie) || cookie.expirationDate > Date.now() / 1000) {
                cookiesSet(cookie, callback);
                return;
            }
            // Requesting to delete cookie. Need to check whether it was really deleted.
            // Work-around to cookies still being in the database but not expired.
            // These are visible to cookies.getAll - https://bugzil.la/1388873
            cookiesSet(cookie, function(newCookie) {
                if (!newCookie) {
                    // Successfully modified.
                    callback(newCookie);
                    return;
                }
                console.log('Temporarily unexpiring cookie to forcibly remove it (bug 1388873).');
                // The work-around is to first unexpire the cookie,
                // and then to try and expire it again.
                newCookie = Object.assign({}, cookie);
                cookie.expirationDate = Date.now() / 1000 + 60;
                cookiesSet(cookie, function() {
                    cookie.expirationDate = 0;
                    cookiesSet(cookie, function(newCookie2) {
                        if (!newCookie2) {
                            callback(newCookie2);
                        } else {
                            withLastError(callback, {
                                message: 'Cannot delete an already-expired cookie. ' +
                                'The browser will automatically remove it in the future.',
                            });
                        }
                    });
                });
            });
        }
        if (!isPrivate(cookie)) {
            setWithCookiesAPI();
            return;
        }
        runWithoutPrivateCookieBugs(function() {
            setWithCookiesAPI();
        }, function() {
            queueRequestToSetCookies(cookie, callback);
        });
    };
}

var cookiesAPIwithFirstPartyDomainSupport = false;
try {
    // firstPartyDomain is only supported in Firefox 59+ - bugzil.la/1381197
    chrome.cookies.get({
        name: 'dummyName',
        firstPartyDomain: 'dummy',
        url: 'about:blank',
    });
    cookiesAPIwithFirstPartyDomainSupport = true;
} catch (e) {
}

// Return a callback that is passed to cookies.getAll(details, callback),
// but without immutable cookies, such as safe browsing cookies while bug 1381197 is open.
function getAllCallbackWithoutImmutableCookies(details, callback) {
    // The cookies used for Safebrowsing requests end up in a different cookie jar,
    // but Firefox's cookies API does not show any difference between the two.
    function isGoogleNIDCookie(c) {
        return c.storeId === 'firefox-default' &&
            c.domain === '.google.com' &&
            c.httpOnly &&
            c.name === 'NID';
    }
    if (details.domain || details.url || cookiesAPIwithFirstPartyDomainSupport) {
        // Because of https://bugzil.la/1381197#c2 , if the domain/url is set, the getAll query
        // does not include SB cookies.
        // If https://bugzil.la/1381197 has been fixed, then we can also return the callback as-is.
        return callback;
    }

    return function(cookies) {
        if (!cookies || !cookies.length) {
            callback(cookies);
            return;
        }
        if ('firstPartyDomain' in cookies[0]) {
            // Apparently the patches for https://bugzil.la/1381197 have landed.
            cookiesAPIwithFirstPartyDomainSupport = true;
            callback(cookies);
            return;
        }
        var googleNidCookies = cookies && cookies.filter(isGoogleNIDCookie);
        if (!googleNidCookies.length) {
            callback(cookies);
            return;
        }
        // We cannot use chrome.cookies.getAll because we patch and overwrite it.
        window.browser.cookies.getAll({
            // Because of https://bugzil.la/1381197#c2 , the result excludes SB cookies.
            domain: '.google.com',
            name: 'NID',
            storeId: 'firefox-default',
        }).then(function(cookiesNoSB) {
            cookiesNoSB = cookiesNoSB.filter(isGoogleNIDCookie);
            cookies = cookies.filter(function(c) {
                if (!isGoogleNIDCookie(c)) {
                    return true;
                }
                var i = cookiesNoSB.findIndex(function(cNoSB) {
                    return c.value === cNoSB.value &&
                        c.path === cNoSB.path &&
                        c.secure === cNoSB.secure &&
                        c.httpOnly === cNoSB.httpOnly &&
                        c.expirationDate === cNoSB.expirationDate;
                });
                if (i === -1) {
                    // This is a safe browsing cookie.
                    return false;
                }
                cookiesNoSB.splice(i, 1);
                return true;
            });
            callback(cookies);
        });
    };
}

// Checks whether the browser supports the cookies API without bugs.
// If (likely) bug-free, callbackNoBugs is called.
// Otherwise callbackWithBugs is called, which marks the cookies API as unusable,
// and forces cookies to be modified via actual network requests.
// - runWithoutPrivateCookieBugs.needsFirstPartyRequest is set to true if the network request has
//   to happen via a main-frame navigation.
function runWithoutPrivateCookieBugs(callbackNoBugs, callbackWithBugs) {
    // There are several bugs in Firefox with private cookies.
    //
    // Firefox before 56:
    // - cookies cannot be modified - bugzil.la/1354229
    // - cookies cannot be filtered by 'url' or 'domain' - bugzil.la/1318948
    //
    // Firefox before 59:
    // - cookies cannot be modified or queried by 'url' or 'domain' when FPI is enabled, i.e.
    //   privacy.firstparty.isolate is true - bugzil.la/1381197
    // - cookies in the safebrowsing cookie jar can never be modified.

    if (!runWithoutPrivateCookieBugs.cachedResultPromise) {
        runWithoutPrivateCookieBugs.cachedResultPromise = new Promise(checkPrivateCookieBugs);
    }
    runWithoutPrivateCookieBugs.cachedResultPromise.then(callbackNoBugs, callbackWithBugs);
}

function checkPrivateCookieBugs(callbackNoBugs, callbackWithBugs) {
    if (cookiesAPIwithFirstPartyDomainSupport) {
        // Firefox 59+ - no work-arounds needed.
        callbackNoBugs();
        return;
    }
    // Even if we detect that third-party cookies are disabled, we cannot fall back to first-party
    // cookies if we cannot open tabs through the tabs API, e.g. in Firefox for Android before 54.
    // Even if the tabs API is available, we don't want to try opening tabs if private windows are
    // not supported, e.g. in all versions of Firefox for Android.
    var canSimulateFirstPartyRequests = !!(chrome.tabs && chrome.windows);

    var browserPrivatebrowsingAutostart = false;
    if (chrome.extension.inIncognitoContext) {
        try {
            browserPrivatebrowsingAutostart =
                chrome.extension.getBackgroundPage().chrome.extension.inIncognitoContext;
        } catch (e) {
            // This can happen if the current tab's OriginAttributes does not match the background
            // page's. E.g. private browsing mode mismatch.
            // Or maybe the background page was shut down.
            console.warn('Cannot determine status of browser.privatebrowsing.autostart: ' + e);
        }
    }

    // In the TOR Browser, browser.privatebrowsing.autostart=true by default.
    // We are mainly interested in the following defaults of the TOR browser:
    // - First-party isolation (FPI) is enabled.
    // - Third-party cookies are disabled.
    // - Private browsing mode is always enabled.
    //
    // For the following reasons:
    // - Because of FPI, the cookies API cannot edit cookies - bugzil.la/1381197
    // - Because of disabled third-party cookies, the only cookies are first-party cookies.
    //   Consequently, by forcing our cookie requests to be first-party, all cookies can be edited.
    // - We ducktype the TOR browser: If private browsing mode is enabled, then assume that
    //   FPI and third-party cookies are enabled too.
    //
    // TODO: Hopefully the FPI bugs are fixed in Firefox 59, so we can improve this feature
    // detection and support FPI through the cookies API - see the discussion at bugzil.la/1362834
    if (browserPrivatebrowsingAutostart && canSimulateFirstPartyRequests) {
        // FPI is likely enabled, need to force 1st-party requests.
        runWithoutPrivateCookieBugs.needsFirstPartyRequest = true;
        callbackWithBugs();
        return;
    }

    // NOTE: After this point, we are unable to detect whether FPI is enabled.
    // If FPI is enabled, then we cannot modify cookies.
    // In the default Firefox release, FPI is disabled, so we should not/rarely be affected.

    // <applet> was removed from Firefox 56 (bugzil.la/1279218),
    // so if it is present, then we are in an engine based on Firefox 56 and certainly buggy.
    if (typeof HTMLAppletElement !== 'undefined') {
        if (!canSimulateFirstPartyRequests) {
            runWithoutPrivateCookieBugs.needsFirstPartyRequest = false;
            callbackWithBugs();
            return;
        }
        checkThirdPartyCookiesEnabled(function() {
            runWithoutPrivateCookieBugs.needsFirstPartyRequest = false;
            callbackWithBugs();
        }, function() {
            // Third-party cookies disabled, need to force 1st-party requests.
            runWithoutPrivateCookieBugs.needsFirstPartyRequest = true;
            callbackWithBugs();
        });
        return;
    }

    runWithoutPrivateCookieBugs.needsFirstPartyRequest = false;
    callbackNoBugs();
}

// Quickly checks whether third-party cookies are enabled.
function checkThirdPartyCookiesEnabled(isEnabled, isDisabled) {
    var dummyCookie = {
        url: 'http://cookie-manager-firefox.local',
        name: 'cookie-manager-test-cookie-' + Math.random(),
        value: 'dummy-test-value',
        // No expirationDate = session cookie.
        // No storeId = inherit from current context.
    };

    function cookiesSet(cookie, callback) {
        // We cannot use chrome.cookies.set because we patch and overwrite it.
        window.browser.cookies.set(cookie).then(callback);
    }

    var img = new Image();

    // The onBeforeSendHeaders will always be triggered, even if the target is unreachable.
    chrome.webRequest.onBeforeSendHeaders.addListener(function listener({requestHeaders}) {
        chrome.webRequest.onBeforeSendHeaders.removeListener(listener);

        // If the cookie is set, third-party cookies are enabled.
        // If the cookie is not set, third-party cookies are disabled (e.g. in TOR Browser).
        var isThirdPartyCookisEnabled = requestHeaders.some(({name, value}) => {
            return /^cookie$/i.test(name) &&
                value.includes(dummyCookie.name + '=' + dummyCookie.value);
        });

        // Delete the cookie.
        dummyCookie.expirationDate = 0;
        cookiesSet(dummyCookie, function() {
            if (isThirdPartyCookisEnabled) {
                isEnabled();
            } else {
                isDisabled();
            }
        });

        return {cancel: true};
    }, {
        urls: [dummyCookie.url + '/*'],
        types: ['image'],
    }, ['requestHeaders', 'blocking']);

    cookiesSet(dummyCookie, function() {
        img.src = dummyCookie.url;
    });
}

function getConsentForRequests() {
    return new Promise(function(resolve, reject) {
        var defaultSettings = {
            consentedToRequests: false,
            consentedToTabs: false,
        };
        chrome.storage.local.get(defaultSettings, function(items) {
            items = items || defaultSettings;

            var needsFirstPartyRequest = runWithoutPrivateCookieBugs.needsFirstPartyRequest;
            var needsConsent = !items.consentedToRequests ||
                (needsFirstPartyRequest && !items.consentedToTabs);
            if (!needsConsent) {
                resolve();
                return;
            }
            var consentMessage =
                'Private cookies cannot directly be modified because of browser bugs.\n' +
                'Cookies can be modified anyway by sending a HTTP request to the sites of the cookies.\n' +
                (needsFirstPartyRequest ?
                    'Because third-party cookies are blocked, new tabs need to be opened.' :
                    // The following message is only true for Firefox 56 with default settings.
                    // If the user enables FPI, then we can usually not even work around the bug,
                    // except under specific circumstances (such as in the TOR browser).
                    'The last bug (bug 1354229) has been fixed in Firefox 56.') +
                '\n\n' +
                'Do you want to allow the Cookie Manager to send requests to modify cookies?';
            if (window.confirm(consentMessage)) {
                var newItems = {
                    consentedToRequests: true,
                };
                if (needsFirstPartyRequest) {
                    newItems.consentedToTabs = true;
                }
                chrome.storage.local.set(newItems, function() {
                    resolve();
                });
            } else {
                reject(new Error('Cannot modify private cookies because of browser bugs, ' +
                    'and you did not give the permission to work around these bugs.'));
            }
        });
    });
}

/**
 * Convert a cookie to a value that can be used as a value for the Set-Cookie HTTP header.
 **/
function cookieToHeaderValue(cookie) {
    // These checks should all pass because the cookie should have been validated.
    assertValid(cookieValidators.name(cookie.name));
    assertValid(cookieValidators.value(cookie.value));
    if (cookie.domain) assertValid(cookieValidators.domain(cookie.domain, new URL(cookie.url).hostname));
    if (cookie.path) assertValid(cookieValidators.path(cookie.path));
    if (cookie.expirationDate) assertValid(cookieValidators.expirationDate(cookie.expirationDate));
    function assertValid(m) {
        if (m) throw new Error('Invalid cookie: ' + m);
    }

    var parts = [cookie.name + '=' + cookie.value];
    if (cookie.path)
        parts.push('path=' + cookie.path);
    if (cookie.domain && !cookie.hostOnly)
        parts.push('domain=' + cookie.domain);
    if (typeof cookie.expirationDate === 'number' && !cookie.session)
        parts.push('expires=' + new Date(cookie.expirationDate * 1000).toGMTString());
    if (cookie.secure)
        parts.push('secure');
    if (cookie.httpOnly)
        parts.push('httponly');
    // Note: In practice the SameSite flag is likely ignored because we use the generated
    // cookie header in a cross-site request.
    if (cookie.sameSite && cookie.sameSite !== 'no_restriction')
        parts.push('samesite=' + cookie.sameSite);
    return parts.join('; ');
}

/**
 * Generate a pseudo-ramdom unique number.
 */
function getRandomUniqueNumber(obj) {
    var randomState = obj._randomNumberState;
    if (!randomState) {
        // We use a random step size instead of a fixed counter,
        // to avoid potential information leakage across domains.
        // (if we simply start with 0 and increment by 1 at every
        // request for a number, then the recipient of the number
        // can derive how many cookies are stored in the browser).
        randomState = obj._randomNumberState = {
            value: Math.floor(Date.now() * Math.random()),
            stepSize: 100 + Math.floor(Math.random() * 900),
            count: 0,
        };
    }

    randomState.value = randomState.value + (++randomState.count) * randomState.stepSize;
    var slack = Math.floor(Math.random() * randomState.stepSize);
    if (randomState > Number.MAX_SAFE_INTEGER - slack) {
        randomState.value -= Number.MAX_SAFE_INTEGER;
        randomState.count = 0;
    }
    return randomState.value + slack;
}

// Append non-holey array |arrayIn| to |arrayOut|.
function arrayAppend(arrayOut, arrayIn) {
    try {
        [].push.apply(arrayOut, arrayIn);
    } catch (e) {
        // arrayIn is too large; stack overflow.
        // Insert one-by-one.
        arrayIn.forEach(function(elem) {
            arrayOut.push(elem);
        });
    }
}

var MAX_TEMPORARY_TABS = 20;
var _temporaryTabCount = 0;
var _temporaryTabPort = null;
var _temporaryTabQueue = [];
function openTemporaryHiddenTab(url, callback) {
    // See similar assertion near sendFirstPartyRequest.
    console.assert(chrome.extension.inIncognitoContext, 'inIncognitoContext === true');

    if (_temporaryTabCount === MAX_TEMPORARY_TABS) {
        _temporaryTabQueue.push([url, callback]);
        return;
    }

    ++_temporaryTabCount;

    chrome.tabs.onRemoved.addListener(tabsOnRemoved);

    var createdTabId;

    chrome.tabs.create({
        url: url,
        active: false,
    }, function(tab) {
        callback(tab, chrome.runtime.lastError);

        // This is not expected to happen, but just in case:
        if (tab) {
            createdTabId = tab.id;
            // Register the tab ID with the background page so that if the user closes the
            // current tab, that all other temporary tabs are gone too.
            if (!_temporaryTabPort) {
                _temporaryTabPort = chrome.runtime.connect({
                    name: 'kill-tabs-on-unload',
                });
            }
            _temporaryTabPort.postMessage({
                createdTabId: createdTabId,
            });
            // Not expected to happen. Can happen if the background page somehow reloads.
            _temporaryTabPort.onDisconnect.addListener(function(port) {
                if (port === _temporaryTabPort) {
                    _temporaryTabPort = null;
                }
            });
        } else {
            tabIsRemoved();
        }
    });

    function tabsOnRemoved(removedTabId) {
        if (removedTabId === createdTabId) {
            tabIsRemoved();
            _temporaryTabPort.postMessage({
                removedTabId: createdTabId,
            });
        }
    }
    function tabIsRemoved() {
        chrome.tabs.onRemoved.removeListener(tabsOnRemoved);
        --_temporaryTabCount;
        if (_temporaryTabQueue.length) {
            var [url, callback] = _temporaryTabQueue.shift();
            openTemporaryHiddenTab(url, callback);
        } else if (_temporaryTabCount === 0) {
            _temporaryTabCount.disconnect();
            _temporaryTabCount = null;
        }
    }
}

/**
 * Set the given cookies in a request to the given domain.
 * All cookies must be part of the given domain and storeId.
 * The request will be made with the cookie jar of the current extension context.
 * If any of the cookies have the Secure flag, the https:-scheme is used;
 * otherwise http: is used.
 *
 * @returns {Promise<boolean>} Whether the cookies have been set.
 */
function sendRequestToSetCookies(domain, cookies) {
    // When third-party cookies are disabled, cookies cannot be modified via a
    // hidden cross-domain request. We have to trigger a main frame navigation
    // in order to be able to modify cookies.
    //
    // See checkPrivateCookieBugs for more information.
    var needsFirstPartyRequest = runWithoutPrivateCookieBugs.needsFirstPartyRequest;

    var cookieHeaderValues = cookies.map(cookieToHeaderValue);
    // If any cookie has the Secure flag, then the request must go over HTTPs.
    var url = (cookies.some((cookie) => cookie.secure) ? 'https://' : 'http://') +
        domain + '/?' + getRandomUniqueNumber(sendRequestToSetCookies);
    var requestFilter = {
        urls: [url],
        types: needsFirstPartyRequest ? ['main_frame'] : ['image'],
    };
    var affectedRequestId;
    var affectedTabId;
    var didSetCookie = false;

    if (url.startsWith('http:')) {
        // Account for HTTP Strict Transport Security (HSTS) upgrades.
        requestFilter.urls.push(url.replace('http', 'https'));
    }

    var cleanupFunctions = [];
    function addListener(target, listener, ...args) {
        target.addListener(listener, ...args);
        cleanupFunctions.push(function() {
            target.removeListener(listener);
        });
    }

    addListener(chrome.webRequest.onBeforeRequest, onBeforeRequest, requestFilter, ['blocking']);
    addListener(chrome.webRequest.onBeforeSendHeaders,
        onBeforeSendHeaders, requestFilter, ['requestHeaders', 'blocking']);
    addListener(chrome.webRequest.onHeadersReceived,
        onHeadersReceived, requestFilter, ['responseHeaders', 'blocking']);

    function sendThirdPartyRequest(resolve) {
        // WebRequest event listeners are registered asynchronously. Make a roundtrip
        // via the parent process to make sure that the event listener has been
        // registered.
        // (The specific API call does not matter here, any async API will do.)
        chrome.runtime.getPlatformInfo(function() {
            var img = new Image();
            img.onload = img.onerror = resolve;
            img.src = url;

            // Ensure that the function does not stall forever.
            setTimeout(function() {
                img.onload = img.onerror = null;
                // Cancel the request if needed.
                img.src = '';
                // Make another round-trip just in case there was a pending
                // response.
                chrome.runtime.getPlatformInfo(function() {
                    resolve();
                });
            }, 2000);
        });
    }

    function sendFirstPartyRequest(resolve, reject) {
        // Open incongito tab in current window to trigger request.
        // Without an explicit windowId, the tabs.create API opens a tab in the current window.
        // The caller ensures that the current window is an incognito window.
        console.assert(chrome.extension.inIncognitoContext, 'inIncognitoContext === true');

        addListener(chrome.tabs.onRemoved, function(tabId) {
            if (affectedTabId === tabId) {
                resolve();
            }
        });

        addListener(chrome.webRequest.onErrorOccurred, function(details) {
            if (details.requestId !== affectedRequestId) return;
            resolve();
        }, requestFilter);

        addListener(chrome.webRequest.onResponseStarted, function(details) {
            if (details.requestId !== affectedRequestId) return;
            resolve();
        }, requestFilter);

        // This happens when the server responds with a redirect, and we rewrite it to a JS-URL.
        // webRequest.onErrorOccurred is not triggered.
        addListener(chrome.webNavigation.onErrorOccurred, function(details) {
            if (details.tabId !== affectedTabId) return;
            resolve();
        });

        var shouldRemoveTab = false;
        cleanupFunctions.push(function() {
            if (affectedTabId) {
                chrome.tabs.remove(affectedTabId);
            } else {
                shouldRemoveTab = true;
            }
        });

        openTemporaryHiddenTab(url, function(tab, error) {
            if (error) {
                reject(error);
                return;
            }
            // Also set in onBeforeRequest, but set it here too in case the request never succeeds.
            affectedTabId = tab.id;

            if (shouldRemoveTab) {
                chrome.tabs.remove(affectedTabId);
            }
        });
    }

    return new Promise(function(resolve) {
        if (needsFirstPartyRequest) {
            sendFirstPartyRequest(resolve);
        } else {
            sendThirdPartyRequest(resolve);
        }
    }).then(function() {
        cleanupFunctions.forEach((cleanup) => cleanup());
        return didSetCookie;
    }, function(error) {
        cleanupFunctions.forEach((cleanup) => cleanup());
        throw error;
    });

    function onBeforeRequest(details) {
        if (affectedRequestId) return;
        affectedRequestId = details.requestId;
        affectedTabId = details.tabId;
        chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
    }
    function onBeforeSendHeaders(details) {
        if (details.requestId !== affectedRequestId) return;
        // Remove cookies in request to prevent the server from recognizing the
        // client.
        var requestHeaders = details.requestHeaders.filter(function(header) {
            return !/^(cookie|authorization)$/i.test(header.name);
        });
        if (requestHeaders.length !== details.requestHeaders.length) {
            return {
                requestHeaders: requestHeaders,
            };
        }
    }
    function onHeadersReceived(details) {
        if (details.requestId !== affectedRequestId) return;
        var responseHeaders = details.responseHeaders.filter(function(header) {
            return !/^(set-cookie2?|location)$/i.test(header.name);
        });
        if (needsFirstPartyRequest) {
            // The main-frame request is aborted as soon as possible.
            // Block all scripts and other resources just in case.
            responseHeaders = responseHeaders.filter(function(header) {
                return !/^(content-security-policy|www-authenticate)$/i.test(header.name);
            });
            responseHeaders.push({
                name: 'Content-Security-Policy',
                value: 'default-src \'none\'',
            });
        }
        if (details.statusCode >= 300 && details.statusCode < 400) {
            responseHeaders.push({
                name: 'Location',
                // jshint scripturl:true
                value: 'javascript:// Dummy local URL to block redirect',
                // jshint scripturl:false
            });
        }
        responseHeaders.push({
            name: 'Set-Cookie',
            value: cookieHeaderValues.join('\n'),
        });
        didSetCookie = true;
        return {
            responseHeaders: responseHeaders,
        };
    }
}

// To minimize the number of requests, we shall use a tree structure.
// Each DomainPart represents a part of a domain, e.g.
//                  com
//            /             \
//       example.com        ample.com
//      /                  /          \
//   www.example.com    sub.ample.com sub2.ample.com
//                      /
//                  www.sub.ample.com
// In the above example, the top DomainPart has .part = "com",
// and the .part of its two children are "example.com" and "ample.com".
class DomainPart {
    constructor(domain, parentDomainPart) {
        this.domain = domain;
        this.parentDomainPart = parentDomainPart;
        this.children = [];
        this.removedChildren = [];

        this.secureDomainCookies = [];
        this.insecureDomainCookies = [];
        this.secureHostOnlyCookies = [];
        this.insecureHostOnlyCookies = [];
        this.maySendHttpRequest = true;
        this.maySendHttpsRequest = true;
    }

    // Add a cookie as a node to the tree.
    // domainPartsPrefix should be an array of the domain, e.g. ['www', 'example', 'com'].
    // The list will be modified by this method.
    addNode(domain, cookie) {
        if (domain === this.domain) {
            if (cookie.hostOnly) {
                if (cookie.secure) {
                    this.secureHostOnlyCookies.push(cookie);
                } else {
                    this.insecureHostOnlyCookies.push(cookie);
                }
            } else if (cookie.secure) {
                this.secureDomainCookies.push(cookie);
            } else {
                this.insecureDomainCookies.push(cookie);
            }
            return;
        }
        var indexBeforeThisDomain = domain.length - this.domain.length - 1;
        console.assert(indexBeforeThisDomain > 0); // Can't be 0, otherwise domain === this.domain.
        // If dot is found, then we want the part after the dot.
        // If dot is not found (-1), then we want the full string (i.e. starting at index 0).
        var dotIndex = domain.lastIndexOf('.', indexBeforeThisDomain - 1) + 1;
        var domainSuffix = domain.substr(dotIndex);
        // The number of children per node is expected to be small.
        // So let's use a linear search, opposed to storing the parts in a map.
        var childNode = this.children.find((child) => {
            return child.domain === domainSuffix;
        });
        if (!childNode) {
            childNode = new DomainPart(domainSuffix, this);
            this.children.push(childNode);
        }
        childNode.addNode(domain, cookie);
    }
    
    forEachBottomUp(callback, includeRemovedChildren) {
        this.children.forEach((child) => {
            child.forEachBottomUp(callback, includeRemovedChildren);
        });
        if (includeRemovedChildren) {
            this.removedChildren.forEach((child) => {
                child.forEachBottomUp(callback, includeRemovedChildren);
            });
        }
        callback(this);
    }

    removeNodeIfLeaf() {
        if (this.children.length > 0 || !this.parentDomainPart) {
            return;
        }
        var i = this.parentDomainPart.children.indexOf(this);
        if (i >= 0) {
            this.parentDomainPart.children.splice(i, 1);
            this.parentDomainPart.removedChildren.push(this);
            this.removeNodeIfLeaf();
        }
    }

    getHostOnlyNodes() {
        var hostOnlyNodes = [];
        this.forEachBottomUp((node) => {
            if (node.secureHostOnlyCookies.length || node.insecureHostOnlyCookies.length) {
                hostOnlyNodes.push(node);
            }
        });
        return hostOnlyNodes;
    }

    getLeafNodes() {
        var leafNodes = [];
        this.forEachBottomUp((node) => {
            if (node.children.length === 0) {
                leafNodes.push(node);
            }
        });
        if (leafNodes.length && !leafNodes[leafNodes.length - 1].parentDomainPart) {
            // Exclude the root.
            leafNodes.pop();
        }
        return leafNodes;
    }

    getUnprocessedCookies() {
        var cookies = [];
        this.forEachBottomUp((node) => {
            arrayAppend(cookies, node.secureDomainCookies);
            arrayAppend(cookies, node.insecureDomainCookies);
            arrayAppend(cookies, node.secureHostOnlyCookies);
            arrayAppend(cookies, node.insecureHostOnlyCookies);
        }, true);
        return cookies;
    }

    // Whether it makes sense to send a request for the domain associated with
    // this node.
    isNodeFinished() {
        if (!this.maySendHttpRequest && !this.maySendHttpsRequest) {
            return true;
        }
        return this.secureHostOnlyCookies.length === 0 &&
            this.insecureHostOnlyCookies.length === 0 &&
            this.secureDomainCookies.length === 0 &&
            this.insecureDomainCookies.length === 0;
    }

    sendRequestWithHostOnlyAndDomainCookies() {
        return this._setCookiesByRequest(true);
    }

    sendRequestWithDomainCookies() {
        return this._setCookiesByRequest(false);
    }

    _getMatchingCookies(includeHostOnly, includeSecure) {
        var cookies = [];
        if (includeSecure) {
            arrayAppend(cookies, this.secureDomainCookies);
        }
        arrayAppend(cookies, this.insecureDomainCookies);
        if (includeHostOnly) {
            if (includeSecure) {
                arrayAppend(cookies, this.secureHostOnlyCookies);
            }
            arrayAppend(cookies, this.insecureHostOnlyCookies);
        }
        if (this.parentDomainPart) { // Only false for the root node.
            // includeHostOnly is unconditionally false because domain cookies
            // can only be set for a request to that specific domain.
            arrayAppend(cookies,
                this.parentDomainPart._getMatchingCookies(false, includeSecure));
        }
        return cookies;
    }

    _unsetMatchingCookies(includeHostOnly, includeSecure) {
        if (includeSecure) {
            this.secureDomainCookies.length = 0;
        }
        this.insecureDomainCookies.length = 0;
        if (includeHostOnly) {
            if (includeSecure) {
                this.secureHostOnlyCookies.length = 0;
            }
            this.insecureHostOnlyCookies.length = 0;
        }
        if (this.parentDomainPart) { // Only false for the root node.
            this.parentDomainPart._unsetMatchingCookies(true, includeSecure);
        }
    }
    
    // The algorithm runs in two passes:
    // 1) host-only cookies anywhere in the tree.
    // 2) domain-cookies at the leaves.
    // This method must be called twice, first with includeHostOnly=true, and
    // then again with includeHostOnly=false.
    _setCookiesByRequest(includeHostOnly) {
        if (!this.maySendHttpRequest && !this.maySendHttpsRequest) {
            return Promise.resolve();
        }
        // We always try sending a HTTPS request, unless we already tried before.
        var includeSecure = this.maySendHttpsRequest;
        this.maySendHttpsRequest = false;
        var cookies = this._getMatchingCookies(includeHostOnly, includeSecure);
        if (cookies.every((cookie) => !cookie.secure)) {
            this.maySendHttpRequest = false;
        }
        if (!cookies.length) {
            this.maySendHttpRequest = false;
            return Promise.resolve();
        }
        return sendRequestToSetCookies(this.domain, cookies)
        .then((didSetCookie) => {
            if (didSetCookie) {
                // There is no future need for a HTTP request.
                this.maySendHttpRequest = false;
                return true;
            }
            if (cookies.every((cookie) => cookie.secure) ||
                cookies.every((cookie) => !cookie.secure)) {
                // All cookies should be using HTTPS,
                // or they already use HTTP.
                // There is no point in trying to fall back to HTTP.
                return false;
            }
            
            if (!this.maySendHttpRequest) {
                // If meanwhile this method was called again, do not fall back to HTTP
                // since the other call will take care of performing the request.
                return false;
            }

            // Host-only cookies were included, so we should only fall back if
            // there are non-secure host-only cookies.
            if (includeHostOnly && this.insecureHostOnlyCookies.length === 0) {
                // This condition covers step 1 (host-only cookies anywhere in the tree)
                // Note: We do not fall back even if there are insecure domain cookies,
                // because if there is a child node under this node, then the domain
                // cookies would be included at step 2 (domain cookies at the leaves).
                return false;
            }
            if (!includeHostOnly && this.insecureDomainCookies.length === 0) {
                // This condition covers step 2 (domain cookies at the leaves).
                return false;
            }
            // At this point, the current domain has non-secure cookies and
            // the request failed. So retry the request with HTTP-only.
            includeSecure = false;
            this.maySendHttpRequest = false;
            cookies = this._getMatchingCookies(includeHostOnly, includeSecure);
            return sendRequestToSetCookies(this.domain, cookies);
        })
        .then((didSetCookie) => {
            if (didSetCookie) {
                this._unsetMatchingCookies(includeHostOnly, includeSecure);
            }
            // TODO: Otherwise setting cookies failed. What now?
        });
    }
}

/**
 * Work-around for https://bugzil.la/1318948, which prevents the cookies API
 * from setting/removing cookies in private browsing mode.
 *
 * The |cookies| list and its content should not be mutated by the caller and
 *  must only contain private browsing cookies.
 * Returns a promise that resolves to a list of booleans. Each boolean at index
 * i reflects whether the cookie at index i in the input list was successfully
 * set. If an error has occurred, the list has a property "errorMessage" that
 * describes the issue.
 */
function setCookiesInPrivateMode(cookies) {
    if (!chrome.extension.inIncognitoContext) {
        // Callers should ensure that we are in private browsing mode.
        throw new Error('Attempted to set private cookies in non-private browsing mode!');
    }
    cookies.forEach(function(cookie) {
        if (cookie.storeId !== 'firefox-private') {
            // Note: Throw instead of promise rejection because the caller should validate that
            // all cookies are private cookies. This error should never be thrown.
            throw new Error('Attempted to set a non-private cookie in private browsing mode!');
        }
    });

    // Group cookies using the following rules to minimize the number of requests:
    // - Host-only cookies must be attached to requests with an exact domain match.
    // - Secure cookies must be attached to https requests.
    // - Domain cookies can be attached to requests which are a (sub)domain.
    //
    // Note that we assume that we won't be affected by browser-side cookie limits,
    // because we either remove existing cookies in bulk, or we add a single cookie.

    // First we construct the tree.
    var domainPartRoot = new DomainPart('', null);
    cookies.forEach(function(cookie) {
        var domain = cookie.domain || new URL(cookie.url).hostname;
        domain = domain.replace(/^\./, '');

        domainPartRoot.addNode(domain, cookie);
    });

    // Now send requests for host-only cookies because host-only cookies must
    // be send to the exact domain.
    return Promise.all(domainPartRoot.getHostOnlyNodes().map(function(domainPart) {
        return domainPart.sendRequestWithHostOnlyAndDomainCookies();
    })).then(function() {
        // Remove leaf nodes that have already been processed due to the
        // leaf node containing host-only cookies.
        domainPartRoot.getLeafNodes().forEach(function(domainPart) {
            if (domainPart.isNodeFinished()) {
                domainPart.removeNodeIfLeaf();
            }
        });
        // Recursively send requests to leaf nodes and remove the leaf nodes.
        return recurseLeafNodes();
    })
    .then(function() {
        var unprocessedCookies = domainPartRoot.getUnprocessedCookies();
        var results = new Array(cookies.length);
        results.fill(true);
        unprocessedCookies.forEach(function(cookie) {
            var i = cookies.indexOf(cookie);
            console.assert(i >= 0);
            results[i] = false;
        });
        if (unprocessedCookies.length) {
            results.errorMessage =
                'Cannot modify ' + unprocessedCookies.length +
                ' private cookies because the sites are not reachable.' +
                ' Try to temporarily disable Tracking Protection at Settings > Privacy.';
        }
        return results;
    });

    function recurseLeafNodes() {
        var leafNodes = domainPartRoot.getLeafNodes();
        if (leafNodes.length === 0) {
            return Promise.resolve();
        }
        return Promise.all(leafNodes.map(function(domainPart) {
            return domainPart.sendRequestWithDomainCookies()
            .then(function() {
                console.assert(domainPart.isNodeFinished());
                domainPart.removeNodeIfLeaf();
            });
        }))
        .then(recurseLeafNodes);
    }
}
