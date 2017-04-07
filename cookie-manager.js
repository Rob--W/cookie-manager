/* globals chrome, alert */
/* globals Promise */
/* globals console */
/* jshint browser: true */
'use strict';

var ANY_COOKIE_STORE_ID = '(# of any cookie jar)';
// Updated whenever the user clicks on a row.
// Used by the edit form for auto-fill.
var mostRecentlySelectedCookie;

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
function getAllCookieRows() {
    if (document.querySelector('#result .no-results')) {
        return [];
    }
    return Array.from(document.getElementById('result').tBodies[0].rows);
}
function isRowSelected(row) {
    return row.classList.contains('highlighted');
}

document.getElementById('.session').onchange = function() {
    // Expiry is only meaningful for non-session cookies
    document.getElementById('.expiry.min').disabled = 
    document.getElementById('.expiry.max').disabled = this.value == 'true';
};
document.getElementById('select-all').onclick = function() {
    getAllCookieRows().forEach(function(row) {
        row.classList.add('highlighted');
    });
    updateButtonView();
};
document.getElementById('select-none').onclick = function() {
    getAllCookieRows().forEach(function(row) {
        row.classList.remove('highlighted');
    });
    updateButtonView();
};
document.getElementById('remove-selected').onclick = function() {
    var rows = getAllCookieRows().filter(function(row) {
        return isRowSelected(row) && !row.cmApi.isDeleted();
    });
    if (!window.confirm('Do you really want to remove ' + rows.length + ' selected cookies?')) {
        return;
    }
    Promise.all(rows.map(function(tr) {
        return tr.cmApi.deleteCookie();
    })).then(updateButtonView);
};
document.getElementById('restore-selected').onclick = function() {
    var rows = getAllCookieRows().filter(function(row) {
        return isRowSelected(row) && row.cmApi.isDeleted();
    });
    if (!window.confirm('Do you really want to restore ' + rows.length + ' selected cookies?')) {
        return;
    }
    Promise.all(rows.map(function(tr) {
        return tr.cmApi.restoreCookie();
    })).then(updateButtonView);
};

function updateButtonView() {
    var allCookieRows = getAllCookieRows();
    var selectedCookieRows = allCookieRows.filter(isRowSelected);
    var deletedSelectionCount = selectedCookieRows.filter(function(row) {
        return row.cmApi.isDeleted();
    }).length;

    function setButtonCount(buttonId, count) {
        var button = document.getElementById(buttonId);
        button.disabled = count === 0;
        var countElem = button.querySelector('.count');
        if (countElem) countElem.textContent = count;
    }

    setButtonCount('select-all', allCookieRows.length);
    setButtonCount('select-none', selectedCookieRows.length);
    setButtonCount('remove-selected', selectedCookieRows.length - deletedSelectionCount);
    setButtonCount('restore-selected', deletedSelectionCount);
}
function setEditSaveEnabled(canSave) {
    var editSaveButton = document.getElementById('edit-save');
    editSaveButton.disabled = !canSave;
    editSaveButton.textContent = canSave ? 'Save' : 'Saved';

    // Reset validation messages so that the validation can happen again upon submission.
    document.getElementById('editform.name').setCustomValidity('');
    document.getElementById('editform.value').setCustomValidity('');
    document.getElementById('editform.domain').setCustomValidity('');
    document.getElementById('editform.path').setCustomValidity('');
    document.getElementById('editform.expiry').setCustomValidity('');
}

updateButtonView();
updateCookieStoreIds();
window.addEventListener('focus', updateCookieStoreIds);

// Add/edit cookie functionality
document.getElementById('add-or-edit').onclick = function() {
    document.body.classList.add('editing-cookie');
};
document.getElementById('editform').onsubmit = function(event) {
    event.preventDefault();
    var cookie = {};
    cookie.url = document.getElementById('editform.url').value;
    cookie.name = document.getElementById('editform.name').value;
    cookie.value = document.getElementById('editform.value').value;

    if (reportValidity('editform.name', cookieValidators.name(cookie.name)) ||
        reportValidity('editform.value', cookieValidators.value(cookie.value))) {
        return;
    }

    var parsedUrl = new URL(cookie.url);
    if (document.getElementById('editform.hostOnlyFalseDefault').checked) {
        cookie.domain = parsedUrl.hostname;
    } else if (document.getElementById('editform.hostOnlyFalseCustom').checked) {
        cookie.domain = document.getElementById('editform.domain').value.trim();
        if (reportValidity('editform.domain', cookieValidators.domain(cookie.domain, parsedUrl.hostname))) {
            return;
        }
    }
    // Else (hostOnlyTrue): the cookie becomes a host-only cookie.

    if (document.getElementById('editform.pathIsSlash').checked) {
        cookie.path = '/';
    } else if (document.getElementById('editform.pathIsCustom').checked) {
        cookie.path = document.getElementById('editform.path').value;
        if (reportValidity('editform.path', cookieValidators.path(cookie.path))) {
            return;
        }
    }
    // Else (pathIsDefault): Defaults to the path portion of the url parameter.

    cookie.secure = document.getElementById('editform.secure').checked;
    cookie.httpOnly = document.getElementById('editform.httpOnly').checked;
    if (!document.getElementById('editform.sameSiteBox').hidden) {
        cookie.sameSite = document.getElementById('editform.sameSite').value;
    }
    if (document.getElementById('editform.sessionFalse').checked) {
        cookie.expirationDate = dateToExpiryCompatibleTimestamp(document.getElementById('editform.expiry'));
        if (reportValidity('editform.expiry', cookieValidators.expirationDate(cookie.expirationDate))) {
            return;
        }
    }
    cookie.storeId = document.getElementById('editform.storeId').value;

    chrome.cookies.set(cookie, function() {
        if (chrome.runtime.lastError) {
            alert('Failed to save cookie because of:\n' + chrome.runtime.lastError.message);
        } else {
            setEditSaveEnabled(false);
        }
    });

    function reportValidity(elementId, validationMessage) {
        if (!validationMessage) {
            return false;  // Should not abort.
        }
        document.getElementById(elementId).setCustomValidity(validationMessage);
        document.getElementById('editform').reportValidity();
        return true;  // Validation error; Abort.
    }
};

// Only show sameSite controls if supported by the API.
document.getElementById('editform.sameSiteBox').hidden = !chrome.cookies.SameSiteStatus;

document.getElementById('editform').oninput =
document.getElementById('editform').onchange = function() {
    setEditSaveEnabled(true);
};
document.getElementById('editform').onkeydown = function(event) {
    if (event.charCode) {
        setEditSaveEnabled(true);
    }
};

document.getElementById('edit-copy').onclick = function() {
    var cookie = mostRecentlySelectedCookie;
    if (!cookie) {
        alert('Please search for cookies and click on a cookie row to select a cookie.');
        return;
    }
    document.getElementById('editform.url').value = cookie.url;
    document.getElementById('editform.name').value = cookie.name;
    document.getElementById('editform.value').value = cookie.value;

    var parsedUrl = new URL(cookie.url);

    if (cookie.hostOnly) {
        document.getElementById('editform.hostOnlyTrue').checked = true;
    } else if (cookie.domain === '.' + parsedUrl.hostname) {
        document.getElementById('editform.hostOnlyFalseDefault').checked = true;
    } else {
        document.getElementById('editform.hostOnlyFalseCustom').checked = true;
    }
    document.getElementById('editform.domain').value = cookie.domain;

    if (cookie.path === '/') {
        document.getElementById('editform.pathIsSlash').checked = true;
    } else if (cookie.path === parsedUrl.pathname) {
        document.getElementById('editform.pathIsDefault').checked = true;
    } else {
        document.getElementById('editform.pathIsCustom').checked = true;
    }
    document.getElementById('editform.path').value = cookie.path;
    if (cookie.session) {
        document.getElementById('editform.sessionTrue').checked = true;
    } else {
        document.getElementById('editform.sessionFalse').checked = true;
        setExpiryTimestamp(document.getElementById('editform.expiry'), cookie.expirationDate);
    }

    document.getElementById('editform.secure').checked = cookie.secure;
    document.getElementById('editform.httpOnly').checked = cookie.httpOnly;
    if (cookie.sameSite) {
        document.getElementById('editform.sameSite').value = cookie.sameSite;
    }
    document.getElementById('editform.storeId').value = cookie.storeId;
    setEditSaveEnabled(true);
};
document.getElementById('edit-cancel').onclick = function() {
    document.body.classList.remove('editing-cookie');
};

Array.from(document.querySelectorAll('#editform label[for]')).forEach(function(radioOtherBox) {
    var radioInput = radioOtherBox.querySelector('input[type=radio]');
    var otherInput = radioOtherBox.querySelector('input:not([type=radio])');
    radioInput.onchange = function() {
        if (radioInput.checked) {
            otherInput.focus();
        }
    };
    otherInput.onfocus = function() {
        if (radioInput.checked) return;
        radioInput.checked = true;
        setEditSaveEnabled(true);
    };
});



function getAllCookieStores(callback) {
    chrome.cookies.getAllCookieStores(function(cookieStores) {
        if (cookieStores) {
            callback(cookieStores);
            return;
        }
        if (typeof browser != 'undefined') {
            // In Firefox for Android before version 54, chrome.cookies.getAllCookieStores
            // fails due to the lack of tabs API support.
            cookieStores = [{
                id: 'firefox-default',
                tabIds: [],
            }, {
                id: 'firefox-private',
                tabIds: [],
            }];
        }
        callback(cookieStores);
    });
}

function updateCookieStoreIds() {
    getAllCookieStores(function(cookieStores) {
        var cookieJarDropdown = document.getElementById('.storeId');
        var editCoJarDropdown = document.getElementById('editform.storeId');
        var selectedValue = cookieJarDropdown.value;
        var editValue = editCoJarDropdown.value;
        cookieJarDropdown.textContent = '';
        cookieJarDropdown.appendChild(new Option('Any cookie jar', ANY_COOKIE_STORE_ID));
        editCoJarDropdown.textContent = '';
        // TODO: Do something with cookieStores[*].tabIds ?
        cookieStores.forEach(function(cookieStore) {
            cookieJarDropdown.appendChild(new Option(storeIdToHumanName(cookieStore.id), cookieStore.id));
            editCoJarDropdown.appendChild(new Option(storeIdToHumanName(cookieStore.id), cookieStore.id));
        });
        cookieJarDropdown.value = selectedValue;
        editCoJarDropdown.value = editValue;
        if (cookieJarDropdown.selectedIndex === -1) {
            cookieJarDropdown.value = ANY_COOKIE_STORE_ID;
        }
        if (editCoJarDropdown.selectedIndex === -1) {
            // Presumably the default cookie jar.
            editCoJarDropdown.selectedIndex = 0;
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
    var expiryMinFilter = dateToExpiryCompatibleTimestamp(document.getElementById('.expiry.min'));
    var expiryMaxFilter = dateToExpiryCompatibleTimestamp(document.getElementById('.expiry.max'));

    // Filter by httpOnly. The chrome.cookies API somehow does not support filtering by httpOnly...
    var httpOnly = query.httpOnly;
    delete query.httpOnly;

    if (query.storeId !== ANY_COOKIE_STORE_ID) {
        useCookieStoreIds(query, [query.storeId]);
    } else {
        getAllCookieStores(function(cookieStores) {
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
            cell.colSpan = 6;
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

        updateButtonView();
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
function dateToExpiryCompatibleTimestamp(dateInput) {
    if (!dateInput || !dateInput.value) {
        return NaN;
    }
    if (dateInput.valueAsNumber) {
        return dateInput.valueAsNumber / 1000;
    }
    var date = dateInput.valueAsDate || new Date(dateInput.value);
    return date.getTime() / 1000;
}

function setExpiryTimestamp(dateInput, expirationDate) {
    expirationDate *= 1000;
    console.assert(!isNaN(expirationDate),
        'expirationDate is not a valid numeric timestamp: ' + arguments[1]);

    try {
        dateInput.valueAsNumber = expirationDate;
    } catch (e) {
        // Not supported (e.g. Firefox 52).
        dateInput.value = new Date(expirationDate).toJSON();
    }
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

function isPartOfDomain(domain, mainDomain) {
    function normalizeDomain(d) {
        return d.toLowerCase().replace(/^\,?/, '.');
    }
    domain = normalizeDomain(domain);
    mainDomain = normalizeDomain(mainDomain);
    return domain !== '' && mainDomain.endsWith(domain);
}

var cookieValidators = {};
cookieValidators._nameAndValueCommon = function(prefix, v) {
    // Based on ParsedCookie::ParseTokenString and ParsedCookie::ParseValueString
    // via CanonicalCookie::Create.
    if (/^[ \t]/.test(v))
        return prefix + ' cannot start with whitespace.';
    if (/[ \t]$/.test(v))
        return prefix + ' cannot end with whitespace.';
    if (/[\r\n\0]/.test(v))
        return prefix + ' cannot contain line terminators.';
    if (v.includes(';'))
        return prefix + ' cannot contain ";".';
};
cookieValidators.name = function(name) {
    // Based on ParsedCookie::ParseTokenString via CanonicalCookie::Create.
    if (name.includes('='))
        return 'The cookie name cannot contain "=".';
    return cookieValidators._nameAndValueCommon('The cookie name', name);
};
cookieValidators.value = function(value) {
    // Based on ParsedCookie::ParseValueString via CanonicalCookie::Create.
    return cookieValidators._nameAndValueCommon('The cookie value', value);
};
cookieValidators.domain = function(domain, mainDomain) {
    if (!isPartOfDomain(domain, mainDomain))
        return 'The domain must be a part of the given URL.';
};
cookieValidators.path = function(path) {
    if (!path.startsWith('/'))
        return 'The path must start with a /.';
};
cookieValidators.expirationDate = function(expirationDate) {
    // expirationDate is parsed using dateToExpiryCompatibleTimestamp.
    // If the input is invalid, then it is NaN.
    if (isNaN(expirationDate))
        return 'Please enter a valid expiration date.';
};


/**
 * Render the cookies in a table
 * @param cookiesOut HTMLTableSectionElement (e.g. a tbody)
 * @param cookie chrome.cookies.Cookie type extended with "url" key.
 */
function renderCookie(cookiesOut, cookie) {
    var row = cookiesOut.insertRow(-1);
    row.onclick = function() {
        this.classList.toggle('highlighted');
        mostRecentlySelectedCookie = cookie;
        updateButtonView();
    };
    row.cmApi = {};
    row.cmApi.isDeleted = function() {
        return row.classList.contains('cookie-removed');
    };
    row.cmApi.deleteCookie = function() {
        // Promise is resolved regardless of whether the call succeeded.
        return new Promise(deleteCookie);
    };
    row.cmApi.restoreCookie = function() {
        // Promise is resolved regardless of whether the call succeeded.
        return new Promise(restoreCookie);
    };
    row.insertCell(0).textContent = cookie.name;
    row.insertCell(1).textContent = cookie.value;
    row.insertCell(2).textContent = cookie.domain;
    row.insertCell(3).textContent = cookie.path;

    var extraInfo = [];
    // Not sure if host-only should be added
    if (cookie.secure) extraInfo.push('secure');
    if (cookie.httpOnly) extraInfo.push('httpOnly');
    if (cookie.storeId === '1') extraInfo.push('incognito');
    else if (cookie.storeId === 'firefox-private') extraInfo.push('private');
    else if (/^firefox-container-/.test(cookie.storeId)) extraInfo.push('containerTab');
    if (cookie.sameSite === 'lax') extraInfo.push('SameSite=lax');
    else if (cookie.sameSite === 'strict') extraInfo.push('SameSite=strict');
    extraInfo = extraInfo.join(', ');
    row.insertCell(4).textContent = extraInfo;

    var expiryInfo;
    if (cookie.session) {
        expiryInfo = 'At end of session';
    } else {
        expiryInfo = formatDate(new Date(cookie.expirationDate*1000));
    }
    row.insertCell(5).textContent = expiryInfo;

    function deleteCookie(resolve) {
        chrome.cookies.remove({
            url: cookie.url,
            name: cookie.name,
            storeId: cookie.storeId
        }, function() {
            if (chrome.runtime.lastError) {
                alert('Failed to remove cookie because of:\n' + chrome.runtime.lastError.message);
            } else {
                row.classList.add('cookie-removed');
            }
            resolve();
        });
    }
    function restoreCookie(resolve) {
        var details = {};
        details.url = cookie.url;
        details.name = cookie.name;
        details.value = cookie.value;
        if (!details.hostOnly) {
            details.domain = cookie.domain;
        }
        details.path = cookie.path;
        details.secure = cookie.secure;
        details.httpOnly = cookie.httpOnly;
        if (cookie.sameSite) details.sameSite = cookie.sameSite;
        if (!cookie.session) details.expirationDate = cookie.expirationDate;
        details.storeId = cookie.storeId;
        chrome.cookies.set(details, function() {
            if (chrome.runtime.lastError) {
                alert('Failed to save cookie because of:\n' + chrome.runtime.lastError.message);
            } else {
                row.classList.remove('cookie-removed');
            }
            resolve();
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
