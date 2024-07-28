/* globals chrome */
/* globals console */
/* jshint browser: true */
/* jshint esversion: 6 */
'use strict';

if (typeof browser !== 'undefined') {
    // Firefox bugs...
    let {
        getAllCookieStores: cookiesGetAllCookieStores,
        set: cookiesSet,
    } = chrome.cookies;
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

    // It's assumed that the |cookie| parameter is not modified by the caller after calling us.
    chrome.cookies.set = function(cookie, callback) {
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
        setWithCookiesAPI();
    };
}
