/* globals chrome */
/* globals console */
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
    chrome.runtime.getPlatformInfo(function(info) {
        // On Firefox for Android, the "popup" is just a tab that closes, so we need
        // to cache the "last active tab".
        var lastActiveTab = null;
        var popupTabId = null;
        chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
            if (msg === 'getActiveTab') {
                if (lastActiveTab) {
                    sendResponse(lastActiveTab);
                    return;
                }
                chrome.tabs.query({
                    lastFocusedWindow: true,
                    active: true,
                }, function(tabs) {
                    sendResponse(tabs && tabs[0] || null);
                });
                return true;
            }
            if (msg === 'closePopup') {
                if (popupTabId) {
                    chrome.tabs.remove(popupTabId);
                    popupTabId = null;
                }
                return;
            }
        });

        if (chrome.browserAction.setPopup && info.platform !== 'android') {
            chrome.browserAction.setPopup({
                popup: 'popup.html',
            });
            return;
        }
        chrome.browserAction.onClicked.addListener(function(activeTab) {
            lastActiveTab = activeTab;
            chrome.tabs.create({
                url: 'popup.html',
                windowId: activeTab.windowId,
                index: activeTab.index + 1,
            }, function(popupTab) {
                popupTabId = popupTab.id;
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
