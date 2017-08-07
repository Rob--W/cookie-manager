/* globals chrome */
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
            },
        });
    }
    chrome.browserAction.onClicked.addListener(function(tab) {
        chrome.tabs.query({
            windowId: tab.windowId,
            // Cannot filter on extension URLs before Firefox 56, 
            // see https:bugzil.la/1269341.
            title: 'Cookie Manager',
        }, function(tabs) {
            tabs = tabs.filter(function(tab) {
                return tab.url.startsWith(location.origin);
            });
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
                windowId: tab.windowId,
                index: tab.index + 1,
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
