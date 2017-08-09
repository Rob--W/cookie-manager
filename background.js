/* globals chrome */
/* globals console */
/* globals Promise */
/* globals Set */
/* jshint browser: true */
'use strict';

if (!chrome.tabs) {
    // chrome.tabs in Android is available since Firefox 54.
    // In Fireefox 53 and earlier, it was unavailable.
    chrome.pageAction.setPopup({
        tabId: 0,
        popup: 'cookie-manager.html',
    });
    chrome.pageAction.show(0);
    window.close();
} else if (!chrome.storage.sync) {
    // Firefox 51-.
    chrome.storage.local.get('autostart', onGotStorage);
} else {
    chrome.storage.sync.get('autostart', function(items) {
        if (items) {
            onGotStorage(items);
        } else { // Can happen in Firefox 52.
            chrome.storage.local.get('autostart', onGotStorage);
        }
    });
}

if (chrome.browserAction) {
    if (chrome.browserAction.setIcon) {
        // Not supported yet on Android.
        chrome.browserAction.setIcon({
            path: {
                16: 'icons/16.png',
                32: 'icons/32.png',
                64: 'icons/64.png',
            },
        });
    }
    chrome.browserAction.onClicked.addListener(function(activeTab) {
        // Note: Using chrome.extension.getViews is a very good way to find
        // extension tabs. chrome.tabs.query cannot be used here, because
        // before Firefox 56, extension URLs cannot be filtered
        // (https://bugzil.la/1269341).
        Promise.all(
            chrome.extension.getViews({ type: 'tab' })
            .map(function(win) {
                return new Promise(function(resolve) {
                    if (win.location.pathname === '/cookie-manager.html') {
                        win.chrome.tabs.getCurrent(function(tab) {
                            resolve(tab);
                        });
                    }
                }).catch(function() {
                    // Never reject the promise.
                });
            })
        ).then(function(tabs) {
            // Exclude missing tabs and tabs from other windows.
            return tabs.filter(function(tab) {
                return tab && tab.windowId === activeTab.windowId;
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
            chrome.tabs.create({
                url: 'cookie-manager.html',
                windowId: activeTab.windowId,
                index: activeTab.index + 1,
            });
        });
    });
}

if (chrome.tabs) {
    chrome.runtime.onConnect.addListener(function(port) {
        console.assert(port.name === 'kill-tabs-on-unload');
        var tabIds = new Set();
        port.onMessage.addListener(function(msg) {
            if (msg.createdTabId) {
                tabIds.add(msg.createdTabId);
            }
            if (msg.removedTabId) {
                tabIds.delete(msg.removedTabId);
            }
        });
        port.onDisconnect.addListener(function() {
            tabIds.forEach(function(tabId) {
                chrome.tabs.remove(tabId);
            });
        });
    });
}

function onGotStorage(items) {
    // By default, auto-start.
    if (!items || items.autostart !== false) {
        chrome.tabs.create({
            url: 'cookie-manager.html',
        });
    }
}
