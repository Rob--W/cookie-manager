/* globals chrome */
/* jshint browser: true */
'use strict';

if (chrome.tabs) {
    chrome.tabs.create({
        url: 'cookie-manager.html',
    });
} else {
    // chrome.tabs in Android is available since Firefox 54.
    // In Fireefox 53 and earlier, it was unavailable.
    chrome.pageAction.setPopup({
        tabId: 0,
        popup: 'cookie-manager.html',
    });
    chrome.pageAction.show(0);
}

window.close();
