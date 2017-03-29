/* globals chrome, alert */
/* globals Promise */
/* globals console */
/* jshint browser: true */
'use strict';

var ANY_COOKIE_STORE_ID = '(# of any cookie jar)';

document.getElementById('searchform').onsubmit = function(e) {
    e.preventDefault();
    doSearch();
};

chrome.extension.isAllowedIncognitoAccess(function(isAllowedAccess) {
    if (!isAllowedAccess) {
        var introContainer = document.querySelector('.no-results');
        introContainer.insertAdjacentHTML(
            'beforeend',
            '<br>To see incognito cookies, visit <a class="ext-settings"></a>' +
            ' and enable "Allow in incognito".');
        var a = introContainer.querySelector('.ext-settings');
        a.href = 'chrome://extensions/?id=' + chrome.runtime.id;
        a.textContent = a.href;
        a.onclick = function(e) {
            if (e.shiftKey) {
                chrome.windows.create({
                    url: a.href,
                });
            } else {
                chrome.tabs.create({
                    url: a.href,
                });
            }
        };
    }
});
document.getElementById('.session').onchange = function() {
    // Expiry is only meaningful for non-session cookies
    document.getElementById('.expiry.min').disabled = 
    document.getElementById('.expiry.max').disabled = this.value == 'true';
};
document.getElementById('clickAll').onclick = function() {
    var actionIsRemoveCookie = this.value === 'Remove';
    if (!window.confirm('Do you really want to ' + (actionIsRemoveCookie ? 'remove' : 'restore') + ' all matching cookies?')) {
        return;
    }
    var buttons = document.querySelector('#result tbody').querySelectorAll(
            actionIsRemoveCookie ? 'input[value="Remove"]' : 'input[value="Restore"]');
    for (var i = 0; i < buttons.length; ++i) {
        buttons[i].click();
    }
    this.value = actionIsRemoveCookie ? 'Restore' : 'Remove';
};

updateCookieStoreIds();
window.addEventListener('focus', updateCookieStoreIds);

function updateCookieStoreIds() {
    chrome.cookies.getAllCookieStores(function(cookieStores) {
        var cookieJarDropdown = document.getElementById('.storeId');
        var selectedValue = cookieJarDropdown.value;
        cookieJarDropdown.textContent = '';
        cookieJarDropdown.appendChild(new Option('Any cookie jar', ANY_COOKIE_STORE_ID));
        // TODO: Do something with cookieStores[*].tabIds ?
        cookieStores.forEach(function(cookieStore) {
            cookieJarDropdown.appendChild(new Option(storeIdToHumanName(cookieStore.id), cookieStore.id));
        });
        cookieJarDropdown.value = selectedValue;
        if (cookieJarDropdown.selectedIndex === -1) {
            cookieJarDropdown.value = ANY_COOKIE_STORE_ID;
        }
    });
}

function storeIdToHumanName(storeId) {
    // Chrome
    // These values are not documented, but they appear to be hard-coded in
    // https://chromium.googlesource.com/chromium/src/+/3c7170a0bed4bf8cc9b0a95f5066100bec0f15bb/chrome/browser/extensions/api/cookies/cookies_helpers.cc#43
    if (storeId === '0') {
        return 'Cookie jar: Default';
    }
    if (storeId === '1') {
        return 'Cookie jar: Incognito';
    }

    // Firefox
    // Not documented either, but also hardcoded in
    // http://searchfox.org/mozilla-central/rev/7419b368156a6efa24777b21b0e5706be89a9c2f/toolkit/components/extensions/ext-cookies.js#15
    if (storeId === 'firefox-default') {
        return 'Cookie jar: Default';
    }
    if (storeId === 'firefox-private') {
        return 'Cookie jar: Private browsing';
    }
    var tmp = /^firefox-container-(.*)$/.exec(storeId);
    if (tmp) {
        return 'Cookie jar: Container ' + tmp[1];
    }
    return 'Cookie jar: ID ' + storeId;
}

function doSearch() {
    // Filters for cookie:
    var filters = {};
    var query = {};
    [
        'url',
        'name',
        'domain',
        'path',
        'secure',
        'hostOnly',
        'httpOnly',
        'session',
        'storeId',
    ].forEach(function(param) {
        var input = document.getElementById('.' + param);
        var value = input.value;
        if (input.tagName === 'SELECT') {
            if (value === 'true') {
                query[param] = true;
            } else if (value === 'false') {
                query[param] = false;
            } else if (value) {
                query[param] = value;
            }
        } else if (value.indexOf('*') >= 0) {
            if (value !== '*') {
                // Optimization: Do not create the query and filter if the
                // user wants to see all results.
                filters[param] = patternToRegExp(value);
            }
        } else if (value) {
            query[param] = value;
        }
    });

    // Custom filter: value
    var valueFilterPattern = document.getElementById('.value').value;
    if (valueFilterPattern && valueFilterPattern !== '*') {
        filters.value = patternToRegExp(valueFilterPattern);
    }
    // Custom filter: Minimal/maximal expiry date
    var expiryMinFilter = dateToExpiryCompatibleTimestamp(document.getElementById('.expiry.min').value);
    var expiryMaxFilter = dateToExpiryCompatibleTimestamp(document.getElementById('.expiry.max').value);

    // Filter by httpOnly. The chrome.cookies API somehow does not support filtering by httpOnly...
    var httpOnly = query.httpOnly;
    delete query.httpOnly;

    // Filter by httpOnly. The chrome.cookies API does not support a hostOnly filter either.
    var hostOnly = query.hostOnly;
    delete query.hostOnly;

    if (query.storeId !== ANY_COOKIE_STORE_ID) {
        useCookieStoreIds(query, [query.storeId]);
    } else {
        chrome.cookies.getAllCookieStores(function(cookieStores) {
            var cookieStoreIds = cookieStores.map(function(cookieStore) {
                return cookieStore.id;
            });
            useCookieStoreIds(query, cookieStoreIds);
        });
    }

    /**
     * Fetches all cookies matching `query` from the cookie stores listed in `storeIds`,
     * and renders the result.
     *
     * @param {object} query
     * @param {string[]} cookieStoreIds List of CookieStore IDs for which cookies should be shown.
     */
    function useCookieStoreIds(query, cookieStoreIds) {
        var errors = [];
        var cookiePromises = cookieStoreIds.map(function(storeId) {
            return new Promise(function(resolve) {
                var queryWithId = Object.assign({}, query);
                queryWithId.storeId = storeId;
                chrome.cookies.getAll(queryWithId, function(cookies) {
                    var error = chrome.runtime.lastError && chrome.runtime.lastError.message;
                    if (error) {
                        // This should never happen.
                        // This might happen if the browser profile was closed while the user tries to
                        // access cookies in its cookie store.
                        console.error('Cannot retrieve cookies: ' + error);
                        errors.push('Failed to fetch cookies from cookie store ' + storeId + ': ' + error);
                    }
                    resolve(cookies || []);
                });
            });
        });
        Promise.all(cookiePromises).then(function(allCookies) {
            // Flatten [[...a], [...b], ...] to [...a, ...b, ...]
            allCookies = allCookies.reduce(function(a, b) {
                return a.concat(b);
            }, []);
            renderAllCookies(allCookies, errors);
        }, function(error) {
            var allCookies = [];
            var errors = ['Failed to fetch cookies: ' + error];
            renderAllCookies(allCookies, errors);
        });
    }

    /**
     * @pre cookies is a list of chrome.cookie.Cookie objects.
     * @modifies cookie.url for each cookie in cookies
     * @return filtered and sorted cookies
     */
    function processAllCookies(cookies) {
        // For filtering, deletion and restoration.
        cookies.forEach(function(cookie) {
            cookie.url = cookieToUrl(cookie);
            cookie._comparatorOperand = reverseString(cookie.domain) + cookie.path;
        });

        var filterKeys = Object.keys(filters);
        cookies = cookies.filter(function(cookie) {
            if (httpOnly !== undefined && cookie.httpOnly !== httpOnly ||
                hostOnly !== undefined && cookie.hostOnly !== hostOnly ||
                !cookie.session && (
                    !isNaN(expiryMinFilter) && cookie.expirationDate < expiryMinFilter ||
                    !isNaN(expiryMaxFilter) && cookie.expirationDate > expiryMaxFilter)) {
                return false;
            }
            // Exclude cookies that do not match every filter
            return filterKeys.every(function(key) {
                return filters[key].test(cookie[key]);
            });
        });

        // Sort the stuff.
        cookies.sort(function(cookieA, cookieB) {
            return cookieA._comparatorOperand.localeCompare(cookieB._comparatorOperand);
        });
        // Clean-up
        cookies.forEach(function(cookie) {
            delete cookie._comparatorOperand;
        });
        return cookies;
    }
    function renderAllCookies(cookies, errors) {
        cookies = processAllCookies(cookies);

        var cookiesOut = document.createElement('tbody');
        var hasNoCookies = cookies.length === 0;

        if (hasNoCookies) {
            var cell = cookiesOut.insertRow().insertCell();
            cell.colSpan = 7;
            if (errors.length === 0) {
                cell.textContent = 'No cookies found.';
            } else {
                cell.style.whiteSpace = 'pre-wrap';
                cell.textContent = errors.join('\n');
            }
            cell.className = 'no-results';
        } else {
            cookies.forEach(function(cookie) {
                renderCookie(cookiesOut, cookie);
            });
        }

        var result = document.getElementById('result');
        result.replaceChild(cookiesOut, result.tBodies[0]);

        document.getElementById('clickAll').hidden = hasNoCookies;
    }
}

// Utility functions.

function patternToRegExp(pattern) {
    pattern = pattern.replace(/[[^$.|?+(){}\\]/g, '\\$&');
    pattern = pattern.replace(/\*/g, '.*');
    pattern = '^' + pattern + '$';
    return new RegExp(pattern, 'i');
}

/**
 * Converts the value of input[type=date] to a timestamp that can be used in
 * comparisons with cookie.expirationDate
 */
function dateToExpiryCompatibleTimestamp(date) {
    date = new Date(date);
    date.setMinutes(date.getTimezoneOffset());
    return date.getTime() / 1000;
}

var months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
function pad(d) {
    return d < 10 ? '0' + d : d;
}
function formatDate(date) {
    return date.getDate() + '/' + months[date.getMonth()] + '/' + date.getFullYear() + ' ' +
        pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function reverseString(string) {
    var result = '';
    for (var i = string.length - 1; i >= 0; i--) {
        result += string[i];
    }
    return result;
}


/**
 * Render the cookies in a table
 * @param cookiesOut HTMLTableSectionElement (e.g. a tbody)
 * @param cookie chrome.cookies.Cookie type extended with "url" key.
 */
function renderCookie(cookiesOut, cookie) {
    var row = cookiesOut.insertRow(-1);
    row.onclick = function() {
        this.classList.toggle('highlighted');
    };
    var deleteButton = row.insertCell(0).appendChild(document.createElement('input'));
    deleteButton.type = 'button';
    deleteButton.value = 'Remove';
    deleteButton.onclick = function(e) {
        e.stopPropagation();
        if (this.value === 'Remove') {
            deleteCookie();
        } else {
            restoreCookie();
        }
    };
    row.insertCell(1).textContent = cookie.name;
    row.insertCell(2).textContent = cookie.value;
    row.insertCell(3).textContent = cookie.domain;
    row.insertCell(4).textContent = cookie.path;

    var extraInfo = [];
    // Not sure if host-only should be added
    if (cookie.secure) extraInfo.push('secure');
    if (cookie.hostOnly) extraInfo.push('hostOnly');
    if (cookie.httpOnly) extraInfo.push('httpOnly');
    if (cookie.storeId === '1') extraInfo.push('incognito');
    else if (cookie.storeId === 'firefox-private') extraInfo.push('private');
    extraInfo = extraInfo.join(', ');
    row.insertCell(5).textContent = extraInfo;

    var expiryInfo;
    if (cookie.session) {
        expiryInfo = 'At end of session';
    } else {
        expiryInfo = formatDate(new Date(cookie.expirationDate*1000));
    }
    row.insertCell(6).textContent = expiryInfo;

    function deleteCookie() {
        chrome.cookies.remove({
            url: cookie.url,
            name: cookie.name,
            storeId: cookie.storeId
        }, function() {
            if (chrome.runtime.lastError) {
                alert('Failed to remove cookie because of:\n' + chrome.runtime.lastError.message);
            } else {
                deleteButton.value = 'Restore';
                row.classList.add('cookie-removed');
            }
        });
    }
    function restoreCookie() {
        var details = {};
        details.url = cookie.url;
        details.name = cookie.name;
        details.value = cookie.value;
        details.domain = cookie.domain;
        details.path = cookie.path;
        details.secure = cookie.secure;
        details.httpOnly = cookie.httpOnly;
        if (!cookie.session) details.expirationDate = cookie.expirationDate;
        details.storeId = cookie.storeId;
        chrome.cookies.set(details, function() {
            if (chrome.runtime.lastError) {
                alert('Failed to save cookie because of:\n' + chrome.runtime.lastError.message);
            } else {
                deleteButton.value = 'Remove';
                row.classList.remove('cookie-removed');
            }
        });
    }
}
function cookieToUrl(cookie) {
    var url = '';
    url += cookie.secure ? 'https' : 'http';
    url += '://';
    if (cookie.domain.charAt(0) === '.') {
        url += cookie.domain.slice(1);
    } else {
        url += cookie.domain;
    }
    url += cookie.path;
    return url;
}
