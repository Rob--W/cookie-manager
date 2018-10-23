/* To test the cookie manager UI as a regular web page without extension environment.
 * Put the following in cookie-manager.html

<script src="fake-api-snippet.js"></script>

*/
/* jshint esversion:6, browser:true, devel:true */
/* globals compileDomainFilter, compileUrlFilter */ // from cookie-manager.js
'use strict';

var _FAKE_INITIAL_COOKIE_COUNT = 1234;
var _FAKE_FPD_SUPPORT =
    location.href.includes('fpd=0') ? false :
    location.href.includes('fpd=1') ? true :
    true; // Default to true for now.

var _fakeCookies = (() => {
    var cookies = [];
    var value = '#';
    for (var i = 0; i < _FAKE_INITIAL_COOKIE_COUNT; ++i) {
        var cookie = {
            name: 'cook' + i,
            domain: 'num' + (i % 10) + '.example.com',
            path: '/',
            value: (value += ' & value of ' + i),
            storeId: (i % 12) ? 'firefox-default' : 'firefox-private',
            hostOnly: (i % 9) === 0,
            httpOnly: (i % 4) === 1,
            sameSite: (i % 17) === 0 ? 'lax' : (i % 17) === 1 ? 'strict' : 'no_restriction',
            secure: (i % 6) === 0,
        };
        if (_FAKE_FPD_SUPPORT) {
            cookie.firstPartyDomain = (i % 10) ? 'num.' + (i % 5) + '.example.com' : '';
        }
        if (i % 2) {
            cookie.session = true;
        } else {
            cookie.expirationDate = Math.floor((Date.now() + 15000 * (i - 10)) / 1000);
        }
        if (!cookie.hostOnly) {
            cookie.domain = '.' + cookie.domain;
        }

        cookies.push(cookie);
    }
    return cookies;
})();

function _getFakeCookies(details) {
    var {url, name, domain, path, secure, session, storeId, firstPartyDomain} = details;
    var matchesUrl = url && compileUrlFilter(new URL(url));
    var matchesDomain = domain && compileDomainFilter(domain);
    if (!_FAKE_FPD_SUPPORT && 'firstPartyDomain' in details) {
        throw new Error("firstPartyDomain is not supported because _FAKE_FPD_SUPPORT is false");
    }
    return _fakeCookies.filter(function(cookie) {
        // Logic copied from cookie-manager-firefox.js and extended.
        if (matchesUrl && !matchesUrl(cookie))
            return false;
        if (name && cookie.name !== name)
            return false;
        if (path && cookie.path !== path)
            return false;
        if (typeof secure === 'boolean' && cookie.secure !== secure)
            return false;
        if (typeof session === 'boolean' && cookie.session !== session)
            return false;
        if (storeId && cookie.storeId !== storeId)
            return false;
        if (matchesDomain && !matchesDomain(cookie))
            return false;
        if (firstPartyDomain != null && cookie.firstPartyDomain !== firstPartyDomain)
            return false;
        return true;
    });
}

if (window.chrome && window.chrome.cookies) {
    throw new Error('Do not load fake-api-snippet.js in an extension!');
}

if (_FAKE_FPD_SUPPORT) {
    window.addEventListener("load", function() {
        console.assert(typeof checkFirstPartyIsolationStatus === 'function',
            'checkFirstPartyIsolationStatus should be defined by cookie-manager.js');
        window.checkFirstPartyIsolationStatus = function() {
            /* globals gFirstPartyIsolationEnabled:true */
            /* globals gFirstPartyDomainSupported:true */
            gFirstPartyIsolationEnabled = true;
            gFirstPartyDomainSupported = true;
            return Promise.resolve();
        };
    });
}

// The bare minimum of chrome.* APIs that are used by cookie-manager.js
window.chrome = {
    extension: {
        isAllowedIncognitoAccess(cb) {
            cb(true);
        },
    },
    storage: {
        local: {
            get(mixed, cb) {
                var keys =
                    typeof mixed === 'string' ? [mixed] :
                    Array.isArray(mixed) ? mixed :
                    mixed === null ? Object.keys(sessionStorage) :
                    Object.keys(mixed);
                function defaultItem(key) {
                    try {
                        if (typeof mixed === 'object' && mixed && key in mixed)
                            return JSON.parse(JSON.stringify(mixed[key]));
                    } catch (e) {}
                }
                var items = {};
                keys.forEach(function(key) {
                    try {
                        var value = sessionStorage.getItem(key);
                        items[key] = value === null ? defaultItem(key) : JSON.parse(value);
                    } catch (e) {
                        items[key] = defaultItem(key);
                        console.error('fake storage.local.get failed to parse ' + key + ' : ' + e);
                    }
                });
                cb(items);
            },
            set(items, cb) {
                Object.keys(items).forEach(function(key) {
                    sessionStorage[key] = JSON.stringify(items[key]);
                });
                if (cb) cb();
            },
        },
    },
    runtime: {
        // Used for chrome.runtime.lastError

        getManifest() {
            try {
                var x = new XMLHttpRequest();
                x.open('get', 'manifest.json', false);
                x.overrideMimeType('application/json');
                x.send();
                return JSON.parse(x.responseText);
            } catch (e) {
                return {
                    version: '<fake-api-snippet>',
                };
            }
        },
    },
    cookies: {
        SameSiteStatus: {LAX: "lax", NO_RESTRICTION: "no_restriction", STRICT: "strict"},
        getAllCookieStores(cb) {
            cb([
                {id:'firefox-default'},
                {id:'firefox-private'}
            ]);
        },
        getAll(details, cb) {
            var cookies = _getFakeCookies(details);
            cookies = cookies.map(cookie => Object.assign({}, cookie));
            cb(cookies);
        },
        set(details, cb) {
            var cookie = _getFakeCookies(details)[0] || null;
            var i = _fakeCookies.indexOf(cookie);
            console.assert(cookie === null || i >= 0, '_fakeCookies should have the cookie.');
            if ('expirationDate' in details && details.expirationDate < Date.now() / 1000) {
                if (cookie) _fakeCookies.splice(i, 1);
                cb(null);
                return;
            }
            // Logic copied from cookie-manager.js
            var newCookie = Object.assign({}, details);
            newCookie.hostOnly = !('domain' in newCookie);
            if (newCookie.hostOnly) {
                newCookie.domain = new URL(details.url).hostname;
            } else if (!newCookie.domain.startsWith('.')) {
                newCookie.domain = '.' + newCookie.domain;
            }
            if (!('path' in newCookie)) {
                newCookie.path = '/';
            }
            if (!('expirationDate' in newCookie)) {
                newCookie.session = true;
            }
            if (cookie) {
                _fakeCookies[i] = newCookie;
            } else {
                _fakeCookies.push(newCookie);
            }
            cb(Object.assign({}, newCookie));
        },
    }
};
