/* globals chrome */
/* jshint browser: true */
'use strict';

var autostart = document.getElementById('autostart');
autostart.onchange = function() {
    var items = {
        autostart: autostart.checked,
    };
    if (!chrome.storage) {
        // Firefox 51-
        chrome.storage.local.set(items);
        return;
    }
    chrome.storage.sync.set(items, function() {
        if (chrome.runtime.lastError) {
            // Can happen in Firefox 52.
            chrome.storage.local.set(items);
        }
    });
};

if (!chrome.storage.sync) {
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
    autostart.checked = !items || items.autostart !== false;
}
