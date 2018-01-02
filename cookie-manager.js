/* globals chrome, alert */
/* globals Promise */
/* globals Set */
/* globals URLSearchParams */
/* globals browser */
/* globals console */
/* jshint browser: true */
/* jshint esversion: 6 */ // TODO: Make more use of ES6 for prettier code.
'use strict';

var ANY_COOKIE_STORE_ID = '(# of any cookie jar)';
var currentlyEditingCookieRow = null;
var _visibleCookieRows = null;

document.getElementById('searchform').onsubmit = function(e) {
    e.preventDefault();
    doSearch();
};

document.body.addEventListener('selectstart', function(event) {
    document.body.addEventListener('mouseup', onMouseUpAfterTextSelection);
});

chrome.extension.isAllowedIncognitoAccess(function(isAllowedAccess) {
    if (!isAllowedAccess) {
        var introContainer = document.querySelector('.no-results td');
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
    if (document.querySelector('#result.no-results')) {
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
document.getElementById('select-visible').onclick = function() {
    getVisibleCookieRows(true).forEach(function(row) {
        row.classList.add('highlighted');
    });
    updateButtonView();
};
document.getElementById('unselect-visible').onclick = function() {
    getVisibleCookieRows(true).forEach(function(row) {
        row.classList.remove('highlighted');
    });
    updateButtonView();
};
document.getElementById('remove-selected').onclick = function() {
    modifyCookieRows(false);
};
document.getElementById('restore-selected').onclick = function() {
    modifyCookieRows(true);
};
document.getElementById('whitelist-selected').onclick = function() {
    whitelistCookieRows(true);
};
document.getElementById('unwhitelist-selected').onclick = function() {
    whitelistCookieRows(false);
};

function modifyCookieRows(shouldRestore) {
    var action = shouldRestore ? 'restore' : 'remove';
    var rows = getAllCookieRows().filter(function(row) {
        return isRowSelected(row) && row.cmApi.isDeleted() === shouldRestore;
    });
    if (!window.confirm('Do you really want to ' + action + ' ' + rows.length + ' selected cookies?')) {
        return;
    }
    // Promises that always resolve. Upon success, a void value. Otherwise an error string.
    var promises = [];
    rows.forEach(function(row) {
        if (shouldRestore) {
            promises.push(row.cmApi.restoreCookie());
        } else {
            promises.push(row.cmApi.deleteCookie());
        }
    });

    Promise.all(promises).then(function(errors) {
        updateButtonView();
        errors = errors.filter(function(error) { return error; });
        if (errors.length > 1) {
            // De-duplication of errors.
            errors = Array.from(new Set(errors));
        }
        if (errors.length) {
            alert('Failed to ' + action + ' some cookies:\n' + errors.join('\n'));
        }
    });
}

function whitelistCookieRows(shouldWhitelist) {
    var allCookieRows = getAllCookieRows();
    allCookieRows.filter(isRowSelected).forEach(function(row) {
        if (shouldWhitelist) {
            WhitelistManager.addToList(row.cmApi.rawCookie);
        } else {
            WhitelistManager.removeFromList(row.cmApi.rawCookie);
        }
    });
    // The rows need to separately be updated, because there may be more than one cookie that
    // matches a (domain, name) pair.
    allCookieRows.forEach(function(row) {
        row.cmApi.renderListState();
    });
    updateButtonView();
}

function setButtonCount(buttonId, count) {
    var button = document.getElementById(buttonId);
    button.disabled = count === 0;
    var countElem = button.querySelector('.count');
    if (countElem) countElem.textContent = count;
}
function updateButtonView() {
    var allCookieRows = getAllCookieRows();
    var selectedCookieRows = allCookieRows.filter(isRowSelected);
    var deletedSelectionCount = selectedCookieRows.filter(function(row) {
        return row.cmApi.isDeleted();
    }).length;
    var whitelistedSelectionCount = selectedCookieRows.filter(function(row) {
        return WhitelistManager.isWhitelisted(row.cmApi.rawCookie);
    }).length;

    // updateVisibleButtonView may require a recalc, so call this before updating the rest.
    updateVisibleButtonView();

    setButtonCount('select-all', allCookieRows.length);
    setButtonCount('select-none', selectedCookieRows.length);
    setButtonCount('remove-selected', selectedCookieRows.length - deletedSelectionCount);
    setButtonCount('restore-selected', deletedSelectionCount);
    setButtonCount('whitelist-selected', selectedCookieRows.length - whitelistedSelectionCount);
    setButtonCount('unwhitelist-selected', whitelistedSelectionCount);
}
function updateVisibleButtonView() {
    _throttledVisIsThrottled = false;  // can be set to true in updateVisibleButtonViewThrottled.

    var visibleCookieRows = getVisibleCookieRows();
    var selectedVisibleCookieRows = visibleCookieRows.filter(isRowSelected);

    setButtonCount('select-visible', visibleCookieRows.length);
    setButtonCount('unselect-visible', selectedVisibleCookieRows.length);
}
var _throttledVisTimer;
var _throttledVisIsThrottled = false;
function updateVisibleButtonViewThrottled() {
    // Throttle for use in scroll events, etc.
    if (_throttledVisTimer) {
        _throttledVisIsThrottled = true; // will be set to false in updateVisibleButtonView.
    } else {
        updateVisibleButtonView();
        _throttledVisTimer = setTimeout(function() {
            _throttledVisTimer = null;
            if (_throttledVisIsThrottled) {
                updateVisibleButtonView();
            }
        }, 500);
        // ^ Frequent updates is not that important, since the rows' heights are constrained,
        // so the number of visible items is more or less the same.
    }
}

function getVisibleCookieRows(forceRecalc = false) {
    if (!_visibleCookieRows || forceRecalc) {
        // Calculating the visible rows is relatively expensive.
        // To avoid layout trashing, the list of visible rows is cached.
        _visibleCookieRows = getVisibleCookieRowsWithRecalc_();
        Promise.resolve().then(function() {
            _visibleCookieRows = null;
        });
    }
    return _visibleCookieRows;
}
// Do not use getVisibleCookieRowsWithRecalc_. Use getVisibleCookieRows(true) instead.
function getVisibleCookieRowsWithRecalc_() {
    var tableRect = document.getElementById('result').tBodies[0].getBoundingClientRect();
    var bottomOffset = document.getElementById('footer-controls').getBoundingClientRect().top;
    var minimumVisibleRowHeight = document.querySelector('#result thead > tr').offsetHeight || 1;

    var visibleCenter = tableRect.left + tableRect.width / 2;
    var visibleTop = Math.max(0, tableRect.top) + minimumVisibleRowHeight;
    var visibleBottom = Math.min(bottomOffset, tableRect.bottom) - minimumVisibleRowHeight;
    if (visibleTop >= visibleBottom) {
        // That must be a very narrow screen, for the result table to not fit...
        return [];
    }

    function getRowAt(x, y) {
        var cell = document.elementsFromPoint(x, y).find(e => e.tagName === 'TD');
        return cell && cell.parentNode;
    }
    var topRow = getRowAt(visibleCenter, visibleTop);
    var bottomRow = getRowAt(visibleCenter, visibleBottom);
    if (!topRow) {
        console.info('getVisibleCookieRows did not find a top row');
        return [];
    }
    if (!bottomRow) {
        console.info('getVisibleCookieRows did not find a bottom row');
        return [];
    }
    if (topRow.parentNode !== bottomRow.parentNode) {
        console.error('getVisibleCookieRows found rows from different parents!');
        return [];
    }
    if (topRow.rowIndex > bottomRow.rowIndex) {
        console.error('getVisibleCookieRows found the top row after the bottom row!');
        return [];
    }
    var visibleCookieRows = [];
    for (var row = topRow; row && row !== bottomRow; row = row.nextElementSibling) {
        visibleCookieRows.push(row);
    }
    if (topRow !== bottomRow) {
        visibleCookieRows.push(bottomRow);
    }
    return visibleCookieRows;
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
updateCookieStoreIds().then(function() {
    var params = new URLSearchParams(location.search);
    var inputs = document.getElementById('searchform')
        .querySelectorAll('select[id^="."],input[id^="."]');
    var any = false;
    Array.from(inputs).forEach(function(input) {
        var value = params.get(input.id.slice(1));
        if (value) {
            input.value = value;
            any = true;
        }
    });
    if (any) {
        doSearch();
    }
});
window.addEventListener('focus', updateCookieStoreIds);

document.getElementById('other-action').onchange = function() {
    var option = this.options[this.selectedIndex];
    // We always select the first option again.
    this.selectedIndex = 0;

    var FILLED_DOT = '\u25C9';
    var HOLLOW_DOT = '\u25CC';
    if (option.textContent.startsWith(FILLED_DOT)) {
        // Radio choice not changed - nothing to do.
        return;
    }
    if (option.textContent.startsWith(HOLLOW_DOT)) {
        // If the current selection is a hollow dot, then we have
        // changed the selection.
        option.textContent = option.textContent.replace(HOLLOW_DOT, FILLED_DOT);
        Array.from(option.parentNode.children).filter(function(opt) {
            return opt !== option;
        }).forEach(function(opt) {
            opt.textContent = opt.textContent.replace(FILLED_DOT, HOLLOW_DOT);
        });
    }

    // Will throw if you add a new option in the HTML but forget to implement it below.
    OtherActionsController[option.value]();
};

var OtherActionsController = {
    new_cookie() {
        document.getElementById('show-new-form').click();
    },

    bulk_export() {
        var selectionCount = getAllCookieRows().filter(isRowSelected).length;
        if (!selectionCount) {
            alert('You have not selected any cookies to export.\n' +
                'Please search for cookies and select some cookies before trying to export them.');
            return;
        }
        document.getElementById('export-cookie-count').textContent = 
            selectionCount + (selectionCount === 1 ? ' cookie' : ' cookies');
        document.body.classList.add('exporting-cookies');
    },

    bulk_import() {
        document.body.classList.add('importing-cookies');
    },

    workflow_remove() {
        document.getElementById('remove-selected').hidden = false;
        document.getElementById('restore-selected').hidden = false;
        document.getElementById('whitelist-selected').hidden = true;
        document.getElementById('unwhitelist-selected').hidden = true;
    },

    workflow_whitelist() {
        document.getElementById('remove-selected').hidden = true;
        document.getElementById('restore-selected').hidden = true;
        document.getElementById('whitelist-selected').hidden = false;
        document.getElementById('unwhitelist-selected').hidden = false;
    },

    bulk_select_all() {
        document.getElementById('select-all').hidden = false;
        document.getElementById('select-none').hidden = false;
        document.getElementById('select-visible').hidden = true;
        document.getElementById('unselect-visible').hidden = true;
        window.removeEventListener('scroll', updateVisibleButtonViewThrottled);
        window.removeEventListener('resize', updateVisibleButtonViewThrottled);
    },

    bulk_select_some() {
        document.getElementById('select-all').hidden = true;
        document.getElementById('select-none').hidden = true;
        document.getElementById('select-visible').hidden = false;
        document.getElementById('unselect-visible').hidden = false;
        window.addEventListener('scroll', updateVisibleButtonViewThrottled);
        window.addEventListener('resize', updateVisibleButtonViewThrottled);
    },
};

var WhitelistManager = {
    _cached: new Map(),
    _storageLastChanged: 0,
    _initialized: false,
    _initPromise: null,
    _throttledSync: null,
    _dirty: false,
    _locked: true,

    _getDomain(cookie) {
        if ('domain' in cookie) {
            // Assuming that domain is already normalized to lower case.
            var domain = cookie.domain;
            return domain.startsWith('.') ? domain.slice(1) : domain;
        }
        return new URL(cookie.url).hostname;
    },

    _serialize() {
        var serializable = Object.create(null);
        WhitelistManager._cached.forEach(function(list, domain) {
            serializable[domain] = Array.from(list);
        });
        return JSON.stringify(serializable);
    },

    _load(serialized) {
        var serializable = JSON.parse(serialized);
        WhitelistManager._cached.clear();
        Object.keys(serializable).forEach(function(domain) {
            WhitelistManager._cached.set(domain, new Set(serializable[domain]));
        });
    },

    _sync() {
        WhitelistManager._dirty = true;
        clearTimeout(WhitelistManager._throttledSync);
        WhitelistManager._throttledSync = setTimeout(WhitelistManager._syncImmediate, 1000);
    },

    _syncImmediate() {
        if (!WhitelistManager._dirty) return;

        var serialized = WhitelistManager._serialize();
        WhitelistManager._dirty = false;
        WhitelistManager._storageLastChanged = Date.now();
        chrome.storage.local.set({
            lastChanged: WhitelistManager._storageLastChanged,
            cookieWhitelist: serialized,
        });
    },

    // Initialize the storage. The promise resolves with whether _cached was changed.
    initialize(force = false) {
        if (!WhitelistManager._initPromise || force && WhitelistManager._initialized) {
            var shouldSkipDataLookup = WhitelistManager._storageLastChanged !== 0;
            WhitelistManager._initialized = false;
            WhitelistManager._initPromise = new Promise(function doLookup(resolve) {
                // If we have already looked up "cookieWhitelist" before, avoid unnecessarily
                // reading the data again by first looking up "lastChanged" to determine whether
                // there is any updated data to look up.
                if (shouldSkipDataLookup) {
                    shouldSkipDataLookup = false;
                    chrome.storage.local.get({lastChanged: 0}, function(items) {
                        var lastChanged = items && items.lastChanged || 0;
                        if (lastChanged) {
                            doLookup(resolve);
                        } else {
                            resolve(false);
                        }
                    });
                    return;
                }

                chrome.storage.local.get({
                    lastChanged: 0,
                    cookieWhitelist: '',
                }, function(items) {
                    var serialized = items && items.cookieWhitelist;
                    var lastChanged = items && items.lastChanged || 0;
                    var didChange = lastChanged !== WhitelistManager._storageLastChanged;
                    WhitelistManager._storageLastChanged = lastChanged;

                    try {
                        if (serialized && didChange) {
                            WhitelistManager._load(serialized);
                        }
                    } finally {
                        WhitelistManager._initialized = true;
                        resolve(didChange);
                    }
                });
            });
        }
        return WhitelistManager._initPromise;
    },

    addToList(cookie) {
        var domain = WhitelistManager._getDomain(cookie);
        var list = WhitelistManager._cached.get(domain);
        if (!list) {
            list = new Set();
            WhitelistManager._cached.set(domain, list);
        }
        if (list.has(cookie.name)) return;
        list.add(cookie.name);
        WhitelistManager._sync();
    },

    removeFromList(cookie) {
        var domain = WhitelistManager._getDomain(cookie);
        var list = WhitelistManager._cached.get(domain);
        if (list) {
            if (!list.delete(cookie.name)) return;
            if (list.size === 0) {
                WhitelistManager._cached.delete(domain);
            }
            WhitelistManager._sync();
        }
    },

    isWhitelisted(cookie) {
        var domain = WhitelistManager._getDomain(cookie);
        var list = WhitelistManager._cached.get(domain);
        if (list) {
            return list.has(cookie.name);
        }
        return false;
    },

    isModificationAllowed(cookie) {
        return !WhitelistManager._locked || !WhitelistManager.isWhitelisted(cookie);
    },

    requestModification() {
        var unlockPrompt = document.getElementById('whitelist-unlock-prompt');
        if (unlockPrompt.hidden) {
            unlockPrompt.hidden = false;
            document.getElementById('whitelist-unlock-yes').disabled = false;
            document.getElementById('whitelist-unlock-confirm').disabled = true;
            document.getElementById('whitelist-unlock-no').focus();
        }
    },

    setLocked(locked = true) {
        WhitelistManager._locked = locked;
        document.getElementById('whitelist-unlock-prompt').hidden = true;
        document.getElementById('whitelist-lock-again').hidden = locked;
        // To discourage the use of unlocked whitelisted cookies, disallow creation
        // of new cookies. This also results in more space in the default button layout.
        document.getElementById('show-new-form').hidden = !locked;
    }
};

// Synchronize the storage upon changing tabs, in case we use multiple storage managers and
// modify the map from different pages. In theory this can have race conditions, where the whitelist
// is modified while the tab is inactive. In practice this should not happen because we only modify
// the whitelist in response to a user action.
window.addEventListener('focus', function() {
    WhitelistManager.initialize(true).then(function(didChange) {
        if (didChange) {
            updateButtonView();
            getAllCookieRows().forEach(function(row) {
                row.cmApi.renderListState();
            });
        }
    });
});
window.addEventListener('blur', function() {
    WhitelistManager._syncImmediate();
});


document.getElementById('whitelist-unlock-yes').onclick = function() {
    document.getElementById('whitelist-unlock-yes').disabled = true;
    document.getElementById('whitelist-unlock-confirm').disabled = false;
};
document.getElementById('whitelist-unlock-confirm').onclick = function() {
    WhitelistManager.setLocked(false);
};
document.getElementById('whitelist-unlock-no').onclick = function() {
    WhitelistManager.setLocked(true);
};
document.getElementById('whitelist-lock-again').onclick = function() {
    WhitelistManager.setLocked(true);
};


// Add/edit cookie functionality
document.getElementById('show-new-form').onclick = function() {
    document.getElementById('editform').reset();
    setEditSaveEnabled(true);
    currentlyEditingCookieRow = null;
    document.body.classList.add('editing-cookie');
};
document.getElementById('editform').onsubmit = function(event) {
    event.preventDefault();
    var cookie = {};
    cookie.url = urlWithoutPort(document.getElementById('editform.url').value);
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
    } else if (document.getElementById('editform.sessionFalseExpired').checked) {
        cookie.expirationDate = 0;
    }
    cookie.storeId = document.getElementById('editform.storeId').value;

    // Format cookie to the cookies.Cookie type.
    var newCookie = Object.assign({}, cookie);
    newCookie.hostOnly = !('domain' in newCookie);
    if (newCookie.hostOnly) {
        newCookie.domain = parsedUrl.hostname;
    } else if (!newCookie.domain.startsWith('.')) {
        newCookie.domain = '.' + newCookie.domain;
    }
    if (!('path' in newCookie)) {
        newCookie.path = '/';
    }
    if (!('expirationDate' in newCookie)) {
        newCookie.session = true;
    }

    if (!WhitelistManager.isModificationAllowed(cookie)) {
        WhitelistManager.requestModification();
        return;
    }

    var rowToEdit = currentlyEditingCookieRow;
    if (rowToEdit && !isSameCookieKey(newCookie, rowToEdit.cmApi.rawCookie)) {
        rowToEdit.cmApi.deleteCookie().then(function(error) {
            if (rowToEdit !== currentlyEditingCookieRow) {
                console.warn('Closed edit form while deleting the old cookie.');
            }
            if (error) {
                alert('Failed to replace cookie:\n' + error);
                return;
            }
            if (!newCookie.session && cookie.expirationDate < Date.now() / 1000) {
                return;
            }
            addOrReplaceCookie();
        });
    } else {
        addOrReplaceCookie();
    }

    function addOrReplaceCookie() {
        chrome.cookies.set(cookie, function() {
            if (rowToEdit !== currentlyEditingCookieRow) {
                console.warn('Closed edit form while saving the cookie.');
            }

            var errorMessage = chrome.runtime.lastError && chrome.runtime.lastError.message;
            if (errorMessage) {
                alert('Failed to save cookie because of:\n' + errorMessage);
                return;
            }
            if (!rowToEdit) {
                setEditSaveEnabled(false);
                return;
            }

            // Replace the cookie row.
            var row = document.createElement('tr');
            row.classList.add('cookie-edited');
            row.classList.toggle('highlighted', rowToEdit.classList.contains('highlighted'));
            renderCookie({
                insertRow: function() {
                    return row;
                },
            }, newCookie);
            var restoreButton = document.createElement('button');
            restoreButton.className = 'restore-single-cookie';
            restoreButton.textContent = 'Restore';
            restoreButton.onclick = function(event) {
                event.stopPropagation();
                if (!window.confirm('Do you want to undo the edit and restore the previous cookie?')) {
                    return;
                }
                restoreButton.disabled = true;

                if (isSameCookieKey(newCookie, rowToEdit.cmApi.rawCookie)) {
                    rowToEdit.cmApi.restoreCookie().then(onCookieRestored);
                } else {
                    row.cmApi.deleteCookie().then(function(error) {
                        if (error) {
                            restoreButton.disabled = false;
                            alert('Failed to delete new cookie because of:\n' + error);
                            return;
                        }
                        rowToEdit.restoreCookie().then(onCookieRestored);
                    });
                }
                function onCookieRestored(error) {
                    if (error) {
                        restoreButton.disabled = false;
                        alert('Failed to restore cookie because of:\n' + error);
                        return;
                    }
                    rowToEdit.classList.toggle('highlighted', row.classList.contains('highlighted'));
                    row.replaceWith(rowToEdit);
                    rowToEdit.focus();
                    // updateButtonView() not needed because we have copied the 'highlighted' state.
                }
            };
            row.querySelector('.action-buttons').appendChild(restoreButton);
            rowToEdit.replaceWith(row);
            if (rowToEdit === currentlyEditingCookieRow) {
                currentlyEditingCookieRow = null;
                document.body.classList.remove('editing-cookie');
                row.querySelector('button.edit-single-cookie').focus();
                // updateButtonView() not needed because we have copied the 'highlighted' state.
            }
        });
    }

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

function renderEditCookieForm(cookie, rowToEdit) {
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
        if (cookie.expirationDate < Date.now() / 1000) {
            document.getElementById('editform.sessionFalseExpired').checked = true;
        }
    }

    document.getElementById('editform.secure').checked = cookie.secure;
    document.getElementById('editform.httpOnly').checked = cookie.httpOnly;
    if (cookie.sameSite) {
        document.getElementById('editform.sameSite').value = cookie.sameSite;
    }
    document.getElementById('editform.storeId').value = cookie.storeId;
    setEditSaveEnabled(true);
    currentlyEditingCookieRow = rowToEdit;
    document.body.classList.add('editing-cookie');

}
document.getElementById('edit-cancel').onclick = function() {
    currentlyEditingCookieRow = null;
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


// Import / export functionality.
var CookieExporter = {
    KEY_TYPES: {
        name: ['string'],
        value: ['string'],
        domain: ['string'],
        hostOnly: ['boolean'],
        path: ['string'],
        secure: ['boolean'],
        httpOnly: ['boolean'],
        session: ['boolean'],
        // Optional if session is true:
        expirationDate: ['number', 'undefined'],
        storeId: ['string'],
        // Chrome 51+
        sameSite: ['string', 'undefined'],
        // Firefox 59+ ? - https://bugzil.la/1381197
        firstPartyDomain: ['string', 'undefined'],
    },
    get KEYS() {
        var KEYS = Object.keys(CookieExporter.KEY_TYPES);
        Object.defineProperty(CookieExporter, 'KEYS', {
            configurable: true,
            enumerable: true,
            value: KEYS,
        });
        return KEYS;
    },
    // cookies is a list of chrome.cookie.Cookie objects.
    serialize(cookies) {
        // serialize() is called internally, so it should never fail. Still, perform some validation
        // as a smoke test to help in debugging, if for some reason we ever export invalid data.
        // To recover, we can apply a patch in deserialize to fixup the data if needed.
        cookies.forEach(function(cookie, i) {
            var validationMessage = CookieExporter.validateCookieObject(cookie);
            if (validationMessage) {
                console.warn('serialize: Invalid cookie at index ' + i + ': ' + validationMessage);
            }
        });
        var serializedCookies = JSON.stringify(cookies, CookieExporter.KEYS, 1);
        var exported = {
            // Include extension and browser versions to allow old data to be migrated in the
            // deserialize method, if needed in the future.
            cookieManagerVersion: chrome.runtime.getManifest().version,
            userAgent: navigator.userAgent,
            cookies: 'placeholder',
        };
        return JSON.stringify(exported, null, 1).replace('"placeholder"', serializedCookies);
    },
    deserialize(serialized) {
        var imported;
        try {
            imported = JSON.parse(serialized);
        } catch (e) {
            throw new Error('Invalid JSON: ' + e.message.replace(/^JSON\.parse: /, ''));
        }
        var cookies = imported.cookies;
        if (!Array.isArray(cookies)) {
            throw new Error('Invalid data: "cookies" array not found!');
        }
        for (var i = 0; i < cookies.length; ++i) {
            var cookie = cookies[i];
            var validationMessage = CookieExporter.validateCookieObject(cookie);
            if (validationMessage) {
                throw new Error('Invalid cookie at index ' + i + ': ' + validationMessage);
            }
            cookie.url = cookieToUrl(cookie);
        }
        return cookies;
    },

    // Do a basic validation of the cookie.
    validateCookieObject(cookie) {
        if (typeof cookie !== 'object')
            return 'cookie has an invalid type. Expected object, got ' + typeof cookie;
        if (cookie === null)
            return 'cookie has an invalid type. Expected object, got null';

        function typeofProp(key) {
            return key in cookie ? typeof cookie[key] : 'undefined';
        }

        for (var key of CookieExporter.KEYS) {
            var allowedTypes = CookieExporter.KEY_TYPES[key];
            if (!allowedTypes.includes(typeofProp(key))) {
                return 'cookie.' + key + ' has an invalid type. Expected ' + allowedTypes +
                    ', got ' + typeofProp(key);
            }
        }
        if (!cookie.session && typeofProp('expirationDate') !== 'number') {
            return 'cookie.expirationDate has an invalid type. Expected number , got ' +
                typeofProp(key);
        }
        // This is a very shallow validator. If the format is really that terrible, then
        // cookies.set will reject with an error.
    },
};
document.getElementById('export-cancel').onclick = function() {
    document.getElementById('exportform').reset();
    document.getElementById('export-text').hidden = true;
    document.body.classList.remove('exporting-cookies');
};
document.getElementById('import-cancel').onclick = function() {
    _importFormInstanceCounter++;  // Invalidates existing import, if possible.
    document.getElementById('importform').reset();
    document.getElementById('import-import').disabled = false;
    document.querySelector('#importform progress').hidden = true;
    document.getElementById('import-log').hidden = true;
    document.getElementById('import-log').value = '';
    document.body.classList.remove('importing-cookies');
};
document.getElementById('exportform').onsubmit = function(event) {
    event.preventDefault();
    var exportType = document.querySelector('#exportform input[name="export-type"]:checked').value;

    var cookies = getAllCookieRows().filter(isRowSelected).map(function(row) {
        return row.cmApi.rawCookie;
    });
    var text = CookieExporter.serialize(cookies);

    if (exportType === 'file') {
        // Trigger the download from a child frame to work around a Firefox bug where an attempt to
        // load a blob:-URL causes the document to unload - https://bugzil.la/1420419
        var f = document.createElement('iframe');
        f.style.position = 'fixed';
        f.style.left = f.style.top = '-999px';
        f.style.width = f.style.height = '99px';
        f.srcdoc = '<a download="cookies.json" target="_blank">cookies.json</a>';
        f.onload = function() {
            var blob = new Blob([text], {type: 'application/json'});
            var a = f.contentDocument.querySelector('a');
            a.href = f.contentWindow.URL.createObjectURL(blob);
            a.click();
            // Removing the frame document implicitly revokes the blob:-URL too.
            setTimeout(function() { f.remove(); }, 2000);
        };
        document.body.appendChild(f);
    } else {
        document.getElementById('export-text').value = text;
        document.getElementById('export-text').hidden = false;
    }
};

var _importFormInstanceCounter = 0;
document.getElementById('importform').onsubmit = function(event) {
    event.preventDefault();
    var importFormInstanceId = ++_importFormInstanceCounter;

    importStarted();

    var importFile = document.getElementById('import-file').files[0];
    if (importFile) {
        var fr = new FileReader();
        fr.onloadend = function() {
            fr.onloadend = null;
            if (fr.error) {
                importError('Failed to read file: ' +
                    (fr.error.message || fr.error.name || fr.error));
            } else if (!fr.result) {
                importError('Failed to import: Input file is empty!');
            } else {
                importText(fr.result);
            }

        };
        try {
            fr.readAsText(importFile);
        } catch (e) {
            fr.onloadend = null;
            // Firefox may synchronously throw an Exception, e.g. when the file has been deleted.
            importError('Failed to read file: ' + e);
        }
    } else {
        importText(document.getElementById('import-text').value);
    }

    function importText(text) {
        if (!text) {
            importError('Failed to import: You must select a file or use the text field.');
            return;
        }
        var cookies;
        try {
            cookies = CookieExporter.deserialize(text);
        } catch (e) {
            importError('Failed to import: ' + e.message);
            return;
        }
        if (!cookies.length) {
            importError('Failed to import: The list of cookies is empty');
            return;
        }
        WhitelistManager.initialize().then(function() {
            importParsedCookies(cookies);
        });
    }
    function importParsedCookies(cookies) {
        // One last chance to abort the import before actually (over)writing cookies.
        if (importFormInstanceId !== _importFormInstanceCounter) {
            console.log('Import was aborted because the form was closed.');
            return;
        }
        if (!cookies.every(WhitelistManager.isModificationAllowed)) {
            importError('Failed to import: One or more cookies is locked by the whitelist.');
            WhitelistManager.requestModification();
            return;
        }
        var progressbar = document.querySelector('#importform progress');
        progressbar.hidden = false;
        progressbar.max = cookies.length;
        progressbar.value = 0;
        document.getElementById('import-log').hidden = false;
        document.getElementById('import-cancel').disabled = true;

        var progress = 0;
        var failCount = 0;
        cookies.forEach(function(cookie, i) {
            if (cookie.expirationDate < Date.now() / 1000) {
                onImportedOneCookie('Did not import cookie ' + i + ' because it has been expired.');
                return;
            }
            var details = getDetailsForCookiesSetAPI(cookie);
            chrome.cookies.set(details, function() {
                var error = chrome.runtime.lastError;
                onImportedOneCookie(error && 'Failed to import cookie ' + i + ': ' + error.message);
            });
        });

        function onImportedOneCookie(error) {
            if (error) {
                document.getElementById('import-log').value += error + '\n';
                ++failCount;
            }
            progressbar.value = ++progress;
            if (progress !== cookies.length) {
                return;
            }
            var message;
            if (failCount) {
                message = 'Imported ' + (cookies.length - failCount) + ' cookies, ' +
                    'failed to import ' + failCount + ' cookies.';
            } else {
                message = 'Imported all ' + cookies.length + ' cookies.';
            }
            document.getElementById('import-log').value += message + '\n';
            document.getElementById('import-cancel').disabled = false;
            importFinished();
        }
    }

    function importError(error) {
        importOutput('ERROR: ' + error);
        importFinished();
    }
    function importOutput(msg) {
        document.querySelector('#importform output').value = msg;
    }

    function importStarted() {
        // Disallow concurrent imports.
        document.getElementById('import-import').disabled = true;
    }
    function importFinished() {
        document.getElementById('import-import').disabled = false;
    }
};


// Return a mapping from a cookieStoreId to a human-readable name.
function getContextualIdentityNames() {
    // contextualIdentities is Firefox-only.
    var contextualIdNameMap = {};
    if (typeof browser !== 'object' || !browser.contextualIdentities) {
        return Promise.resolve(contextualIdNameMap);
    }
    return browser.contextualIdentities.query({}).then(function(contextualIdentities) {
        if (!contextualIdentities) {
            // contextualIdentities can be false or null - https://bugzil.la/1389265
            return contextualIdNameMap;
        }
        var byName = Object.create(null);
        contextualIdentities.forEach(function(contextualIdentity) {
            var name = contextualIdentity.name;
            contextualIdNameMap[contextualIdentity.cookieStoreId] = name;
            (byName[name] || (byName[name] = [])).push(contextualIdentity);
        });
        // Create more specific names if necessary.
        Object.values(byName).forEach(function(contextualIdentitySubset) {
            if (contextualIdentitySubset.length < 2) {
                return;
            }
            var nameGenerators = [
                // First try to create a unique name with the icon.
                function(contextualIdentity) {
                    return contextualIdentity.name + ' (' + contextualIdentity.icon + ')';
                },
                // If the icon is not unique, try a unique color.
                function(contextualIdentity) {
                    return contextualIdentity.name + ' (' + contextualIdentity.color + ')';
                },
                // If the color is not unique, use both.
                function(contextualIdentity) {
                    return contextualIdentity.name + ' (' + contextualIdentity.icon + ', ' + contextualIdentity.color + ')';
                },
            ];
            var uniqNames = [];
            for (var i = 0; i < contextualIdentitySubset.length; ++i) {
                var contextualIdentity = contextualIdentitySubset[i];
                var name = nameGenerators[0](contextualIdentity);
                if (nameGenerators.length && uniqNames.includes(name)) {
                    // Not unique. Restart the loop with the next name generator.
                    uniqNames.length = 0;
                    i = 0;
                } else {
                    contextualIdNameMap[contextualIdentity.cookieStoreId] = name;
                    uniqNames.push(name);
                }
            }
        });
        return contextualIdNameMap;
    }, function(error) {
        console.error('Unexpected error in contextualIdentities.query: ' + error);
        return contextualIdNameMap;
    });
}

function updateCookieStoreIds() {
    return Promise.all([
        new Promise(function(resolve) {
            chrome.cookies.getAllCookieStores(resolve);
        }),
        getContextualIdentityNames(),
    ]).then(function(args) {
        var cookieStores = args[0];
        var contextualIdNameMap = args[1];

        var cookieJarDropdown = document.getElementById('.storeId');
        var editCoJarDropdown = document.getElementById('editform.storeId');
        var selectedValue = cookieJarDropdown.value;
        var editValue = editCoJarDropdown.value;
        cookieJarDropdown.textContent = '';
        cookieJarDropdown.appendChild(new Option('Any cookie jar', ANY_COOKIE_STORE_ID));
        editCoJarDropdown.textContent = '';
        // TODO: Do something with cookieStores[*].tabIds ?
        cookieStores.forEach(function(cookieStore) {
            var option = new Option(storeIdToHumanName(cookieStore.id, contextualIdNameMap), cookieStore.id);
            cookieJarDropdown.appendChild(option.cloneNode(true));
            editCoJarDropdown.appendChild(option.cloneNode(true));
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

function storeIdToHumanName(storeId, contextualIdNameMap) {
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
        var contextualIdName = contextualIdNameMap[storeId];
        if (contextualIdName) {
            return 'Cookie jar: ' +  contextualIdName + ' (Container Tab)';
        }
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
                filters[param] = patternToRegExp(value, param === 'domain');
            }
        } else if (value) {
            query[param] = value;
        }
    });

    if (typeof query.url === 'string') {
        query.url = urlWithoutPort(query.url);
    }

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

        // Not really a cookie promise, but before showing any cookie rows we need to ensure that
        // the whitelist is initialized. We can do that here.
        cookiePromises.push(WhitelistManager.initialize().then(() => []));

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
        var whitelistChoice = document.getElementById('.whitelist').value;
        if (whitelistChoice) {  // If 'true' or 'false' instead of ''.
            whitelistChoice = whitelistChoice === 'true' ? true : false;
            cookies = cookies.filter(function(cookie) {
                return whitelistChoice === WhitelistManager.isWhitelisted(cookie);
            });
        }
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
            cell.colSpan = 7;
            if (errors.length === 0) {
                cell.textContent = 'No cookies found.';
            } else {
                cell.style.whiteSpace = 'pre-wrap';
                cell.textContent = errors.join('\n');
            }
        } else {
            cookies.forEach(function(cookie) {
                renderCookie(cookiesOut, cookie);
            });
        }

        invalidateRowReferences();

        var result = document.getElementById('result');
        result.classList.toggle('no-results', hasNoCookies);
        result.replaceChild(cookiesOut, result.tBodies[0]);

        updateButtonView();
    }
}

function invalidateRowReferences() {
    if (currentlyEditingCookieRow) {
        // currentlyEditingCookieRow should be null because it should not be possible
        // to invalidate the table rows while an edit form is being shown.
        console.warn('currentlyEditingCookieRow should be null');
    }

    _visibleCookieRows = null;
}

// Utility functions.

function patternToRegExp(pattern, isDomainPattern) {
    pattern = pattern.replace(/[[^$.|?+(){}\\]/g, '\\$&');
    pattern = pattern.replace(/\*/g, '.*');
    if (isDomainPattern) {
        // The cookies API is not consistent in filtering dots.
        // Filtering by example.com and .example.com has the same effect.
        // So we too permit an optional dot in the front.
        // The following extra matches are added:
        // example.com* -> .example.com*
        // *example.com -> *.example.com
        // .example.com -> *.example.com
        pattern = pattern.replace(/^(((?:\.\*)*)\\\.?)?/, '$1\\.?');
    }
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
        return d.toLowerCase().replace(/^\.?/, '.');
    }
    domain = normalizeDomain(domain);
    mainDomain = normalizeDomain(mainDomain);
    return domain !== '' && mainDomain.endsWith(domain);
}

var cookieValidators = {};
cookieValidators._cookiePartCommon = function(prefix, v) {
    // Based on ParsedCookie::ParseTokenString and ParsedCookie::ParseValueString
    // via CanonicalCookie::Create.
    // TODO: These restrictions are for Chrome.
    // TODO: Look at netwerk/cookie/nsCookieService.cpp for Firefox.
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
    return cookieValidators._cookiePartCommon('The cookie name', name);
};
cookieValidators.value = function(value) {
    // Based on ParsedCookie::ParseValueString via CanonicalCookie::Create.
    return cookieValidators._cookiePartCommon('The cookie value', value);
};
cookieValidators.domain = function(domain, mainDomain) {
    if (!isPartOfDomain(domain, mainDomain))
        return 'The domain must be a part of the given URL.';
};
cookieValidators.path = function(path) {
    if (!path.startsWith('/'))
        return 'The path must start with a /.';
    return cookieValidators._cookiePartCommon('The path', path);
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
    row.appendChild(document.getElementById('cookie_row_template').content.cloneNode(true));
    row.onclick = function(event) {
        if (event.altKey || event.ctrlKey || event.cmdKey || event.shiftKey) {
            return;  // Do nothing if a key modifier was pressed.
        }
        this.classList.toggle('highlighted');
        updateButtonView();
    };
    row.cmApi = {
        // The caller should not modify this value!
        get rawCookie() { return cookie; },
    };
    row.cmApi.isDeleted = function() {
        return row.classList.contains('cookie-removed');
    };
    row.cmApi.setDeleted = function(isDeleted) {
        row.classList.toggle('cookie-removed', isDeleted);
    };
    row.cmApi.deleteCookie = function() {
        // Promise is resolved regardless of whether the call succeeded.
        // The resolution value is an error string if an error occurs.
        return new Promise(deleteCookie);
    };
    row.cmApi.restoreCookie = function() {
        // Promise is resolved regardless of whether the call succeeded.
        // The resolution value is an error string if an error occurs.
        return new Promise(restoreCookie);
    };
    row.cmApi.renderListState = function() {
        if (cookieIsWhitelisted === WhitelistManager.isWhitelisted(cookie)) {
            return; // Common case, nothing to change;
        }
        cookieIsWhitelisted = !cookieIsWhitelisted;
        var flagCell = row.querySelector('.flag_');
        var flagCellText = flagCell.textContent;
        if (cookieIsWhitelisted) {
            if (flagCellText.length) {
                flagCell.textContent = TEXT_FLAG_WHITELIST + TEXT_FLAG_SEPARATOR + flagCellText;
            } else {
                flagCell.textContent = TEXT_FLAG_WHITELIST;
            }
        } else {
            // If flagCellText === TEXT_FLAG_WHITELIST, then .slice(...) returns an empty string.
            flagCell.textContent = flagCellText.slice(
                TEXT_FLAG_WHITELIST.length + TEXT_FLAG_SEPARATOR.length);
        }
    };

    var TEXT_FLAG_SEPARATOR = ', ';
    var TEXT_FLAG_WHITELIST = 'whitelist';
    var cookieIsWhitelisted = WhitelistManager.isWhitelisted(cookie);

    row.querySelector('.name_').textContent = cookie.name;
    row.querySelector('.valu_').textContent = cookie.value;
    row.querySelector('.doma_').textContent = cookie.domain;
    row.querySelector('.path_').textContent = cookie.path;

    var extraInfo = [];
    if (cookieIsWhitelisted) extraInfo.push(TEXT_FLAG_WHITELIST);
    // Not sure if host-only should be added
    if (cookie.secure) extraInfo.push('secure');
    if (cookie.httpOnly) extraInfo.push('httpOnly');
    if (cookie.storeId === '1') extraInfo.push('incognito');
    else if (cookie.storeId === 'firefox-private') extraInfo.push('private');
    else if (/^firefox-container-/.test(cookie.storeId)) extraInfo.push('containerTab');
    if (cookie.sameSite === 'lax') extraInfo.push('SameSite=lax');
    else if (cookie.sameSite === 'strict') extraInfo.push('SameSite=strict');

    extraInfo = extraInfo.join(TEXT_FLAG_SEPARATOR);
    row.querySelector('.flag_').textContent = extraInfo;

    var expiryInfo;
    if (cookie.session) {
        expiryInfo = 'At end of session';
    } else {
        expiryInfo = formatDate(new Date(cookie.expirationDate*1000));
    }
    var expiCell = row.querySelector('.expi_');
    expiCell.textContent = expiryInfo;
    if (cookie.expirationDate < Date.now() / 1000) {
        expiCell.title =
            'This cookie has already been expired and will not be sent to websites.\n' +
            'To explicitly delete it, select the cookie and click on the Remove button.';
        expiCell.style.cursor = 'help';
        expiCell.style.color = 'red';
    }

    row.querySelector('.edit-single-cookie').onclick = function(event) {
        event.stopPropagation();
        renderEditCookieForm(cookie, row);
    };

    bindKeyboardToRow(row);

    function shouldBlockModification(resolve) {
        if (!WhitelistManager.isModificationAllowed(cookie)) {
            WhitelistManager.requestModification();
            resolve('Refused to modify a whitelisted cookie.');
            return true;
        }
    }
    function deleteCookie(resolve) {
        if (shouldBlockModification(resolve)) {
            return;
        }
        var details = getDetailsForCookiesSetAPI(cookie);
        details.value = '';
        details.expirationDate = 0;
        chrome.cookies.set(details, function(newCookie) {
            if (chrome.runtime.lastError) {
                resolve(chrome.runtime.lastError.message);
            } else {
                row.cmApi.setDeleted(true);
                resolve();
            }
        });
    }
    function restoreCookie(resolve) {
        if (shouldBlockModification(resolve)) {
            return;
        }
        var details = getDetailsForCookiesSetAPI(cookie);
        chrome.cookies.set(details, function() {
            if (chrome.runtime.lastError) {
                resolve(chrome.runtime.lastError.message);
            } else {
                row.cmApi.setDeleted(false);
                resolve();
            }
        });
    }
}
function bindKeyboardToRow(row) {
    row.tabIndex = 1;
    row.onfocus = function() {
        var rect = row.getBoundingClientRect();
        var viewTop = 0;
        var viewBottom = document.getElementById('footer-controls').offsetTop;
        var deltaY;
        if (rect.top < viewTop) {
            deltaY = (rect.top - viewTop);
        } else if (rect.bottom > viewBottom) {
            deltaY = (rect.bottom - viewBottom);
        }
        if (deltaY) {
            window.scrollBy({
                top: deltaY,
                behavior: 'instant',
            });
        }
    };
    row.onkeydown = function(event) {
        if (event.altKey ||
            event.ctrlKey ||
            event.cmdKey) {
            // Do nothing if a key modifier was pressed.
            return;
        }
        if (event.shiftKey && !isEmptyTextSelection()) {
            return;
        }
        switch (event.keyCode) {
        case 32: // Spacebar
            row.classList.toggle('highlighted');
            updateButtonView();
            break;
        case 38: // Arrow up
        case 40: // Arrow down
            var next = event.keyCode === 40 ? row.nextElementSibling : row.previousElementSibling;
            if (next) {
                next.focus();
                if (event.shiftKey) {
                    next.classList.toggle('highlighted', row.classList.contains('highlighted'));
                }
            }
            break;
        case 46: // Delete
            deleteThisRowCookie();
            break;
        default:
            return;
        }
        event.preventDefault();
    };

    function deleteThisRowCookie() {
        var msg = 'Do you really want to delete the currently focused cookie?';
        msg += '\nTo delete all selected cookies (instead of the currently focused cookie),' +
            ' use the "Remove selected" button at the bottom.';
        if (window.confirm(msg)) {
            row.cmApi.deleteCookie().then(function(error) {
                if (error) {
                    alert('Failed to delete cookie:\n' + error);
                } else {
                    updateButtonView();
                }
            });
        }
    }
}

var _delayedMultiSelectShower;
var _delayedMultiSelectHider;
function onMouseUpAfterTextSelection(event) {
    // The following line should probably be kept in sync with hideMultiSelectionToolOnMousedown.
    if (event.button !== 0 || event.target.closest('#multi-selection-tool')) return;

    clearTimeout(_delayedMultiSelectShower);
    // Wait a short timeout to allow the selection change to propagate, if needed.
    // Also to not immediately disturb the user when they release the mouse.
    _delayedMultiSelectShower = setTimeout(onClickAfterTextSelection, 200, event);
}
function onClickAfterTextSelection(event) {
    if (isEmptyTextSelection()) {
        hideMultiSelectionTool();
        return;
    }
    var tbody = document.getElementById('result').tBodies[0];
    if (!tbody || !tbody.contains(event.target)) {
        // Did not click inside the result table.
        hideMultiSelectionTool();
        return;
    }
    function getRow(node) {
        if (node.nodeType === 3) node = node.parentNode;
        if (node.nodeType === 1) {
            node = node.closest('tr');
            if (node && node.parentNode === tbody) return node;
        }
        return null;
    }
    var sel = window.getSelection();
    var rows = new Set();
    for (var i = 0; i < sel.rangeCount; ++i) {
        var range = sel.getRangeAt(i);
        var row = getRow(range.commonAncestorContainer);
        if (row) {
            // Range spans one row. E.g. Firefox puts each row in a separate row.
            rows.add(row);
            continue;
        }
        var rowStart = getRow(range.startContainer);
        var rowEnd = getRow(range.endContainer);
        if (!rowStart || !rowEnd || rowStart === rowEnd) {
            // At most one row.
            row = rowStart || rowEnd;
            if (row) rows.add(row);
            continue;
        }
        // Multiple rows.
        if (rowStart.rowIndex > rowEnd.rowIndex) {
            [rowStart, rowEnd] = [rowEnd, rowStart];
        }
        for (row = rowStart; row !== rowEnd; row = row.nextElementSibling) {
            rows.add(row);
        }
        rows.add(rowEnd);
    }
    if (rows.size < 2) {
        hideMultiSelectionTool();
        return;
    }

    // We have at least two rows. Ask whether the user wants to highlight both rows.

    setButtonCount('multi-selection-select', rows.size);
    document.getElementById('multi-selection-select').onclick = function() {
        rows.forEach(function(row) {
            row.classList.add('highlighted');
        });
        updateButtonView();
    };
    document.getElementById('multi-selection-invert').onclick = function() {
        rows.forEach(function(row) {
            row.classList.toggle('highlighted');
        });
        updateButtonView();
    };

    cancelHideMultiSelectionTool();
    var multiSelectionTool = document.getElementById('multi-selection-tool');

    // TODO: Try to not fall off the screen.
    // Add +5 to ensure that the user can move the mouse without immediately triggering mouseleave.
    var x = event.clientX + 5;
    var y = event.clientY + 5;
    multiSelectionTool.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    multiSelectionTool.hidden = false;

    // The tool can only be shown with mouse interaction, so it makes sense to only allow the
    // tool to be hidden via other mouse events (opposed to keyboard events).
    multiSelectionTool.addEventListener('mouseenter', cancelHideMultiSelectionTool);
    multiSelectionTool.addEventListener('mouseleave', hideMultiSelectionToolAfterDelay);
    document.body.addEventListener('mousedown', hideMultiSelectionToolOnMousedown);
}
function hideMultiSelectionTool() {
    document.getElementById('multi-selection-select').onclick = null;
    document.getElementById('multi-selection-invert').onclick = null;
    var multiSelectionTool = document.getElementById('multi-selection-tool');
    multiSelectionTool.hidden = true;
    multiSelectionTool.removeEventListener('mouseenter', cancelHideMultiSelectionTool);
    multiSelectionTool.removeEventListener('mouseleave', hideMultiSelectionToolAfterDelay);
    document.body.removeEventListener('mousedown', hideMultiSelectionToolOnMousedown);

    if (isEmptyTextSelection()) {
        document.body.removeEventListener('mouseup', onMouseUpAfterTextSelection);
    }
}
function cancelHideMultiSelectionTool() {
    clearTimeout(_delayedMultiSelectHider);
}
function hideMultiSelectionToolAfterDelay() {
    clearTimeout(_delayedMultiSelectHider);
    // Almost a second before it disappears. Should be more than sufficient.
    _delayedMultiSelectHider = setTimeout(hideMultiSelectionTool, 750);
}
function hideMultiSelectionToolOnMousedown(event) {
    // The following line should probably be kept in sync with onMouseUpAfterTextSelection.
    if (event.button !== 0 || event.target.closest('#multi-selection-tool')) return;
    hideMultiSelectionTool();
}

function isEmptyTextSelection() {
    var sel = window.getSelection();
    return !sel || sel.anchorNode === sel.focusNode && sel.anchorOffset === sel.focusOffset;
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
/**
 * @param cookie chrome.cookies.Cookie type extended with "url" key.
 * @returns {object} A parameter for the cookies.set API.
 */
function getDetailsForCookiesSetAPI(cookie) {
    var details = {};
    details.url = cookie.url;
    details.name = cookie.name;
    details.value = cookie.value;
    if (!cookie.hostOnly) {
        details.domain = cookie.domain;
    }
    details.path = cookie.path;
    details.secure = cookie.secure;
    details.httpOnly = cookie.httpOnly;
    if (cookie.sameSite) details.sameSite = cookie.sameSite;
    if (!cookie.session) details.expirationDate = cookie.expirationDate;
    details.storeId = cookie.storeId;
    return details;
}

function urlWithoutPort(url) {
    // Strip port to work around https://bugzil.la/1417828
    return url && url.replace(/^(https?:\/\/[^\/]+):\d+(\/|$)/i, '$1$2');
}

// Checks whether the given cookies would be written to the same cookie slot.
// The given cookies must be of the type cookies.Cookie.
function isSameCookieKey(cookieA, cookieB) {
    // Cookies are keyed by (domain, path, name) + origin attributes.
    // (where the domain starts with a dot iff it is a domain cookie (opposed to host-only)).
    // Origin attributes currently include:
    // - userContextId and privateBrowsingId -> storeId
    // - firstPartyDomain -> TODO when 
    // TODO: Add firstPartyDomain here when implemented - see https://bugzil.la/1381197
    if (cookieA.name !== cookieB.name ||
        cookieA.domain !== cookieB.domain ||
        cookieA.path !== cookieB.path ||
        cookieA.storeId !== cookieB.storeId) {
        return false;
    }
    return true;
}
