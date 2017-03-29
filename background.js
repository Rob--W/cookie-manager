/* globals chrome */
/* jshint browser: true */
'use strict';

chrome.tabs.create({
    url: 'cookie-manager.html',
});

window.close();
