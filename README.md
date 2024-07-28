# Cookie Manager

This Cookie Manager allows you to quickly view and edit specific cookies.
It is designed to be compatible with Chrome, Firefox and Firefox for Android.

By default, the Cookie Manager opens when the extension starts up. This allows
you to keep the extension disabled until you need it.

You can also turn off the automatic opening, and manually open the cookie
manager by clicking on the extension button in the toolbar (desktop) or the
Cookie Manager menu item (Firefox for Android).

Cookie Manager is created by Rob Wu <rob@robwu.nl> (https://robwu.nl/).
If you have suggestions or questions, open an issue at https://github.com/Rob--W/cookie-manager/issues or send me a mail.

## Supported features

- Viewing all cookies
- Querying cookies by any combination of url, domain, path, cookie content (name/value), httpOnly/secure/sameSite/session flags, expiration time range.
- Recognizes cookie jars (default, private browsing mode, container tabs aka userContext).
- Allows you to remove individual cookies, or all matching cookies with one click.
- Supports Firefox for Android (Fenix)
- Supports the TOR Browser (and first-party domain cookies)
- Supports partitioned cookies (known as State Partitioning or Total Cookie Protection)
- Add cookies
- Edit cookies
- Import / export cookies
  - JSON format for backup and restoration purposes.
  - Netscape HTTP Cookie File format for use with other tools like curl and wget.
  - Copying cookies to a different cookie jar.


## Searching for cookies
The Cookie Manager has a search form that allows you to filter on every possible
cookie field or flag. Only non-empty filters are used in the query.
Wildcards (`*`) can be used in each filter to match any text.

The list of results is **not** automatically updated. The "Search" button needs
to be clicked again to refresh the list of cookies.


## Keyboard shortcuts

Currently the UI is optimized for use on mobile, and support for keyboard shortcuts is limited to
the rows in the result table:

- <kbd>Arrow up</kbd> Focus the previous cookie row.
  * <kbd>Shift</kbd> + <kbd>Arrow up</kbd> Focus the previous cookie row and
    extend the current selection (or lack thereof) to that row.
    This shortcut is ignored when text has been selected.
  * <kbd>Page up</kbd> and <kbd>Home</kbd> are also supported.
- <kbd>Arrow down</kbd> Focus the next cookie row.
  * <kbd>Shift</kbd> + <kbd>Arrow down</kbd> Focus the next cookie row and
    extend the current selection (or lack thereof) to that row.
    This shortcut is ignored when text has been selected.
  * <kbd>Page down</kbd> and <kbd>End</kbd> are also supported.
- <kbd>Spacebar</kbd> Toggle selection of the focused row.
- <kbd>Delete</kbd> Remove the focused cookie.


## Bulk cookie selection
The Cookie Manager is optimized for the use case of selecting many cookies and
then removing them. Being able to quickly select specific cookies is important,
so there are multiple ways to select cookies.

Individual cookies can be added or removed from the selection by clicking on a
cookie row. All results can be selected by one click on the "Select all" button.

### Bulk selection by mouse
When you select text in the results with a mouse, and the text selection
contains two or more cookies, then two buttons appear near the mouse pointer:

- "Select *n* rows" - adds the cookie rows to the cookie selection.
- "Invert selection" - toggles the cookie selection of the cookie rows.

### Bulk selection by keyboard
Click on a cookie and use arrow up/down to go to the previous/next cookie row.
Press spacebar to toggle the selection.

You can also hold <kbd>Shift</kbd> pressed and then press the arrow up/down
key to quickly select consecutive rows (or unselect, if the initial row was
unselected).

### Bulk selection of visible cookies
The default "Select all" button selects all cookies in the search results.
To only select the cookies that are visible on the screen, go to the
"More actions" menu and change the "Bulk selection" option from  
"Select all = select all results" to  
"Select all = select visible results".

After doing this, the "Select all" button is replaced with "Select visible".

Because mobile devices do usually not have a physical keyboard or mouse, this
button is usually the fastest way to process a large number of cookies.


# Browser-specific notes
## Chrome
No special notes. I haven't published the extension to the Chrome Web Store.

## Firefox for Desktop
Install from: https://addons.mozilla.org/en-US/firefox/addon/a-cookie-manager

## Firefox for Android
Install from: https://addons.mozilla.org/en-US/firefox/addon/a-cookie-manager

