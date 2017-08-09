# Cookie Manager

This Cookie Manager allows you to quickly view and edit specific cookies.
It is designed to be compatible with Chrome, Firefox and Firefox for Android.

By default, the Cookie Manager opens when the extension starts up. This allows
you to keep the extension disabled until you need it.

You can also turn off the automatic opening, and manually open the cookie
manager by clicking on the extension button in the toolbar (desktop) or the
Cookie Manager menu item (Firefox for Android 55+).

Cookie Manager is created by Rob Wu <rob@robwu.nl> (https://robwu.nl/).
If you have suggestions or questions, open an issue at https://github.com/Rob--W/cookie-manager/issues or send me a mail.

## Supported features

- Viewing all cookies
- Querying cookies by any combination of url, domain, path, cookie content (name/value), httpOnly/secure/session flags, expiration time range.
- Recognizes cookie jars (default, private browsing mode, container tabs aka userContext).
- Allows you to remove individual cookies, or all matching cookies with one click.
- Supports Firefox for Android (Fennec)
- Supports the TOR Browser
- Add cookies
- Edit cookies (=add cookie, click the "Copy last selected cookie" button and save the changes)

# Browser-specific notes
## Chrome
No special notes. I haven't published the extension to the Chrome Web Store.

## Firefox for Desktop
Install from: https://addons.mozilla.org/en-US/firefox/addon/a-cookie-manager

### All versions
The cookies API in Firefox has several bugs that makes it unsuitable for
modifying (private) cookies. In these cases, after a prompt, the extension will
work around the bugs by initiating a request to the sites of the cookies, and
modify the cookies when the server sends any response (and abort the request as
soon as possible).
If the server is unreachable, the cookie cannot be modified.

As of Firefox 56, no work-arounds are needed when the browser runs with the
default settings.

When First Party Isolation is enabled (this is the case in the TOR Browser),
the work-around is needed, until https://bugzil.la/1381197 is fixed.

The cookie manager may show a "NID" cookie for the google.com domain, but
not have the ability to modify it. This is because the cookie is in a cookie jar
used for Safebrowsing, and this jar is completely isolated from the rest of the
browser, including extensions (https://bugzil.la/1362834).

### Version 55 and earlier
To edit private browsing cookies, the cookie manager must be opened in a private
browsing window. If you try to edit a private browsing cookie of a
site on the Tracking protection blocklist, then you must temporarily disable
Tracking protection, via the "Tracking protection" checkbox at Settings >
Privacy (or open a new tab in a private browsing window and flip the
"Tracking Protection" switch at the bottom).

## Firefox for Android
Install from: https://addons.mozilla.org/en-US/firefox/addon/a-cookie-manager

### Version 56 and later
There are no known bugs for the default use case.

### Version 55 and earlier
To edit private browsing cookies, the cookie manager must be opened in a
private browsing tab (select the URL in the location bar, open an incognito
tab, paste the URL and go). If you try to edit a private browsing cookie of a
site on the Tracking protection blocklist, then you must temporarily disable
Tracking protection, via the "Tracking protection" checkbox at Settings >
Privacy.

### Version 54 and earlier
There Cookie Manager cannot be opened via the menu (https://bugzil.la/1331742).

### Version 53 and earlier
The Cookie manager cannot be opened upon start-up. Tap on the icon in the
address bar to open the cookie manager. Due to a bug in Firefox this icon is
very small, unfortunately.

[Screenshot](https://addons.cdn.mozilla.net/user-media/previews/full/183/183935.png)
