/* globals chrome */
/* globals URLSearchParams */
/* jshint esversion: 6 */
/* jshint browser: true */
'use strict';

var activeTab;

document.getElementById('open-cm-any').onclick = openAnyCookieManager;
document.getElementById('open-cm-tab-top').onclick = openTopTabCookieManager;
document.getElementById('open-cm-tab-top').disabled = true;

chrome.runtime.sendMessage('getActiveTab', function(tab) {
    if (tab && tab.url && tab.url.startsWith('http')) {
        activeTab = tab;
        document.getElementById('open-cm-tab-top').disabled = false;
        document.getElementById('open-cm-tab-top').title =
            'View all cookies for ' + tab.url;
    } else {
        document.getElementById('open-cm-tab-top').remove();
    }
});

function openAnyCookieManager() {
    openOrActivateCookieManager('');
}

function openTopTabCookieManager() {
    var params = new URLSearchParams();
    params.append('url', activeTab.url);
    params.append('storeId', storeIdForTab(activeTab));
    openOrActivateCookieManager('?' + params.toString());
}

function openOrActivateCookieManager(query) {
    chrome.tabs.query({
        lastFocusedWindow: true,
        active: true,
    }, function(tabs) {
        openOrActivateCookieManager_(tabs && tabs[0], query);
    });
}

function openOrActivateCookieManager_(currentTab, query) {
    // Note: Using chrome.extension.getViews is a very good way to find
    // extension tabs. chrome.tabs.query cannot be used here, because
    // before Firefox 56, extension URLs cannot be filtered
    // (https://bugzil.la/1269341).
    Promise.all(
        chrome.extension.getViews({ type: 'tab' })
        .map(function(win) {
            return new Promise(function(resolve) {
                if (win.location.pathname === '/cookie-manager.html' &&
                    isSameQuery(win.location.search, query)) {
                    win.chrome.tabs.getCurrent(function(tab) {
                        resolve(tab);
                    });
                } else {
                    resolve();
                }
            }).catch(function() {
                // Never reject the promise.
            });
        })
    ).then(function(tabs) {
        // Exclude missing tabs and tabs from other windows.
        return tabs.filter(function(tab) {
            return tab && currentTab && tab.windowId === currentTab.windowId;
        });
    }).then(function(tabs) {
        if (tabs.some(function(tab) { return tab.active; })) {
            // Current tab is already the cookie manager.
            return;
        }
        if (tabs.length) {
            // Focus the first cookie manager tab.
            chrome.tabs.update(tabs[0].id, {
                active: true,
            });
            return;
        }
        var createProperties = {
            url: 'cookie-manager.html' + query,
        };
        if (currentTab) {
            createProperties.windowId = currentTab.windowId;
            createProperties.index = currentTab.index + 1;
        }
        chrome.tabs.create(createProperties);
    }).then(function() {
        window.close();
        chrome.runtime.sendMessage('closePopup');
    });
}

function isSameQuery(queryA, queryB) {
    return queryA.replace('?', '') === queryB.replace('?', '');
}

function storeIdForTab(tab) {
    if (tab.cookieStoreId) {
        return tab.cookieStoreId;
    }
    // TODO: Do not hard-code the cookieStoreIds.
    if (typeof browser === 'undefined') {
        // Chrome
        return activeTab.incognito ? '1' : '0';
    }
    // Firefox
    return activeTab.incognito ? 'firefox-private' : 'firefox-default';
}
