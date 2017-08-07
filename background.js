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

function onGotStorage(items) {
    // By default, auto-start.
    if (!items || items.autostart !== false) {
        chrome.tabs.create({
            url: 'cookie-manager.html',
        }, function() {
            window.close();
        });
    } else {
        window.close();
    }
}
