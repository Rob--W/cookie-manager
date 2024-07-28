/* globals chrome */
/* jshint browser: true */
'use strict';

chrome.runtime.onInstalled.addListener(maybeAutoStart);
chrome.runtime.onStartup.addListener(maybeAutoStart);

var started = false;
function maybeAutoStart() {
    if (started) {
        return;
    }
    started = true;
    chrome.storage.sync.get('autostart', function(items) {
        if (items) {
            onGotStorage(items);
        } else { // Can happen in Firefox 52.
            // or when webextensions.storage.sync.enabled is set to true,
            // until Firefox 130: pref removed as part of bugzil.la/1888472
            chrome.storage.local.get('autostart', onGotStorage);
        }
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
