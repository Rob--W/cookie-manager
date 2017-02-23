/* globals chrome, alert */
/* jshint browser: true */
'use strict';

document.getElementById('searchform').onsubmit = function(e) {
    e.preventDefault();
    doSearch();
};
document.getElementById('.storeId').onchange = function() {
    var storeIdInput = this;
    if (storeIdInput.value === '0') {
        // Extensions always have access to non-incognito sessions.
        return;
    }
    chrome.extension.isAllowedIncognitoAccess(function(isAllowedAccess) {
        if (isAllowedAccess) {
            // Got access, no problem!
            return;
        }
        if (window.confirm('To access the incognito cookies, you need to select ' +
                '"Allow in incognito" at the Extension settings.\n\n' +
                'Do you want to open the extension settings?')) {
            chrome.tabs.create({
                url: 'chrome://extensions/?id=' + chrome.runtime.id
            });
        } else {
            storeIdInput.value = '0';
        }
    });
};
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

    if (query.storeId) {
        chrome.cookies.getAll(query, renderAllCookies);
    } else {
        query.storeId = '1';
        chrome.cookies.getAll(query, function(incognitoCookies) {
            if (incognitoCookies) {
                query.storeId = '0';
                chrome.cookies.getAll(query, function(cookies) {
                    if (cookies) {
                        cookies = cookies.concat(incognitoCookies);
                    }
                    renderAllCookies(cookies);
                });
            } else {
                renderAllCookies(null);
            }
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
    function renderAllCookies(cookies) {
        if (cookies) cookies = processAllCookies(cookies);

        var cookiesOut = document.createElement('tbody');
        var hasNoCookies = !cookies || cookies.length === 0;

        if (hasNoCookies) {
            var cell = cookiesOut.insertRow().insertCell();
            cell.colSpan = 7;
            if (cookies) {
                cell.textContent = 'No cookies found.';
            } else {
                cell.textContent = 'Error: ' + chrome.runtime.lastError.message;
                if (chrome.runtime.lastError.message.indexOf('cookie store id') > 0) {
                    cell.textContent = 'Error: Cannot read incognito cookies because the ' +
                        'extension has no access to the incognito session.';
                }
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
