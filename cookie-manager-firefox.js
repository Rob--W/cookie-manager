/* globals chrome */
/* globals console */
/* globals isPartOfDomain */
/* globals cookieValidators */
/* jshint browser: true */
/* jshint esversion: 6 */
/* exported setCookiesInPrivateMode */
'use strict';

if (typeof browser !== 'undefined') {
    // Firefox bugs...
    let {getAll: cookiesGetAll} = chrome.cookies;
    let isPrivate = (details) => {
        return details.storeId ?
            details.storeId === 'firefox-private' :
            chrome.extension.inIncognitoContext;
    };
    chrome.cookies.getAll = function(details, callback) {
        if (!isPrivate(details) || !details.url && !details.domain) {
            cookiesGetAll(details, callback);
            return;
        }
        // Work around bugzil.la/1318948.
        var {domain, url} = details;
        url = url && new URL(url);
        var allDetails = Object.assign({}, details);
        delete allDetails.domain;
        delete allDetails.url;
        cookiesGetAll(allDetails, function(cookies) {
            if (!cookies) {
                callback(cookies);
                return;
            }
            cookies = cookies.filter(function(cookie) {
                if (url) {
                    if (cookie.hostOnly && url.hostname !== cookie.domain)
                        return false;
                    if (!isPartOfDomain(cookie.domain, url.hostname))
                        return false;
                    if (cookie.secure && url.protocol !== 'https:')
                        return false;
                    if (cookie.path !== '/' && !(url.pathname + '//').startsWith(cookie.path + '/'))
                        return false;
                }
                if (domain) {
                    if (!isPartOfDomain(cookie.domain, domain))
                        return false;
                }
                return true;
            });
            callback(cookies);
        });
    };
}

/**
 * Convert a cookie to a value that can be used as a value for the Set-Cookie HTTP header.
 **/
function cookieToHeaderValue(cookie) {
    // These checks should all pass because the cookie should have been validated.
    assertValid(cookieValidators.name(cookie.name));
    assertValid(cookieValidators.value(cookie.value));
    if (cookie.domain) assertValid(cookieValidators.domain(cookie.domain, new URL(cookie.url).hostname));
    if (cookie.path) assertValid(cookieValidators.path(cookie.path));
    if (cookie.expirationDate) assertValid(cookieValidators.expirationDate(cookie.expirationDate));
    function assertValid(m) {
        if (m) throw new Error('Invalid cookie: ' + m);
    }

    var parts = [cookie.name + '=' + cookie.value];
    if (cookie.path)
        parts.push('path=' + cookie.path);
    if (cookie.domain && !cookie.hostOnly)
        parts.push('domain=' + cookie.domain);
    if (typeof cookie.expirationDate === 'number' && !cookie.session)
        parts.push('expires=' + new Date(cookie.expirationDate * 1000).toGMTString());
    if (cookie.secure)
        parts.push('secure');
    if (cookie.httpOnly)
        parts.push('httponly');
    // Note: In practice the SameSite flag is likely ignored because we use the generated
    // cookie header in a cross-site request.
    if (cookie.sameSite && cookie.sameSite !== 'no_restriction')
        parts.push('samesite=' + cookie.sameSite);
    return parts.join('; ');
}

/**
 * Generate a pseudo-ramdom unique number.
 */
function getRandomUniqueNumber(obj) {
    var randomState = obj._randomNumberState;
    if (!randomState) {
        // We use a random step size instead of a fixed counter,
        // to avoid potential information leakage across domains.
        // (if we simply start with 0 and increment by 1 at every
        // request for a number, then the recipient of the number
        // can derive how many cookies are stored in the browser).
        randomState = obj._randomNumberState = {
            value: Math.floor(Date.now() * Math.random()),
            stepSize: 100 + Math.floor(Math.random() * 900),
            count: 0,
        };
    }

    randomState.value = randomState.value + (++randomState.count) * randomState.stepSize;
    var slack = Math.floor(Math.random() * randomState.stepSize);
    if (randomState > Number.MAX_SAFE_INTEGER - slack) {
        randomState.value -= Number.MAX_SAFE_INTEGER;
        randomState.count = 0;
    }
    return randomState.value + slack;
}

// Append non-holey array |arrayIn| to |arrayOut|.
function arrayAppend(arrayOut, arrayIn) {
    try {
        [].push.apply(arrayOut, arrayIn);
    } catch (e) {
        // arrayIn is too large; stack overflow.
        // Insert one-by-one.
        arrayIn.forEach(function(elem) {
            arrayOut.push(elem);
        });
    }
}

/**
 * Set the given cookies in a request to the given domain.
 * All cookies must be part of the given domain and storeId.
 * The request will be made with the cookie jar of the current extension context.
 * If any of the cookies have the Secure flag, the https:-scheme is used;
 * otherwise http: is used.
 *
 * @returns {Promise<boolean>} Whether the cookies have been set.
 */
function sendRequestToSetCookies(domain, cookies) {
    var cookieHeaderValues = cookies.map(cookieToHeaderValue);
    // If any cookie has the Secure flag, then the request must go over HTTPs.
    var url = (cookies.some((cookie) => cookie.secure) ? 'https://' : 'http://') +
        domain + '/?' + getRandomUniqueNumber(sendRequestToSetCookies);
    var requestFilter = {
        urls: [url],
        types: ['image'],
    };
    var affectedRequestId;
    var didSetCookie = false;

    if (url.startsWith('http:')) {
        // Account for HTTP Strict Transport Security (HSTS) upgrades.
        requestFilter.urls.push(url.replace('http', 'https'));
    }

    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, requestFilter);
    chrome.webRequest.onBeforeSendHeaders.addListener(
        onBeforeSendHeaders, requestFilter, ['requestHeaders', 'blocking']);
    chrome.webRequest.onHeadersReceived.addListener(
        onHeadersReceived, requestFilter, ['responseHeaders', 'blocking']);

    return new Promise(function(resolve) {
        // WebRequest event listeners are registered asynchronously. Make a roundtrip
        // via the parent process to make sure that the event listener has been
        // registered.
        // (The specific API call does not matter here, any async API will do.)
        chrome.runtime.getPlatformInfo(function() {
            var img = new Image();
            img.onload = img.onerror = resolve;
            img.src = url;

            // Ensure that the function does not stall forever.
            setTimeout(function() {
                img.onload = img.onerror = null;
                // Cancel the request if needed.
                img.src = '';
                // Make another round-trip just in case there was a pending
                // response.
                chrome.runtime.getPlatformInfo(function() {
                    resolve();
                });
            }, 2000);
        });
    }).then(function() {
        chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
        chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
        chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);

        return didSetCookie;
    });

    function onBeforeRequest(details) {
        if (affectedRequestId) return;
        affectedRequestId = details.requestId;
        chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
    }
    function onBeforeSendHeaders(details) {
        if (details.requestId !== affectedRequestId) return;
        // Remove cookies in request to prevent the server from recognizing the
        // client.
        var requestHeaders = details.requestHeaders.filter(function(header) {
            return !/^cookie$/i.test(header.name);
        });
        if (requestHeaders.length !== details.requestHeaders.length) {
            return {
                requestHeaders: requestHeaders,
            };
        }
    }
    function onHeadersReceived(details) {
        if (details.requestId !== affectedRequestId) return;
        var responseHeaders = details.responseHeaders.filter(function(header) {
            return !/^(set-cookie2?|location)$/i.test(header.name);
        });
        if (details.statusCode >= 300 && details.statusCode < 400) {
            responseHeaders.push({
                name: 'Location',
                // jshint scripturl:true
                value: 'javascript:// Dummy local URL to block redirect',
                // jshint scripturl:false
            });
        }
        cookieHeaderValues.forEach(function(cookieValue) {
            responseHeaders.push({
                name: 'Set-Cookie',
                value: cookieValue,
            });
        });
        didSetCookie = true;
        return {
            responseHeaders: responseHeaders,
        };
    }
}

// To minimize the number of requests, we shall use a tree structure.
// Each DomainPart represents a part of a domain, e.g.
//                  com
//            /             \
//       example.com        ample.com
//      /                  /          \
//   www.example.com    sub.ample.com sub2.ample.com
//                      /
//                  www.sub.ample.com
// In the above example, the top DomainPart has .part = "com",
// and the .part of its two children are "example.com" and "ample.com".
class DomainPart {
    constructor(domain, parentDomainPart) {
        this.domain = domain;
        this.parentDomainPart = parentDomainPart;
        this.children = [];

        this.secureDomainCookies = [];
        this.insecureDomainCookies = [];
        this.secureHostOnlyCookies = [];
        this.insecureHostOnlyCookies = [];
        this.maySendHttpRequest = true;
        this.maySendHttpsRequest = true;
    }

    // Add a cookie as a node to the tree.
    // domainPartsPrefix should be an array of the domain, e.g. ['www', 'example', 'com'].
    // The list will be modified by this method.
    addNode(domain, cookie) {
        if (domain === this.domain) {
            if (cookie.hostOnly) {
                if (cookie.secure) {
                    this.secureHostOnlyCookies.push(cookie);
                } else {
                    this.insecureHostOnlyCookies.push(cookie);
                }
            } else if (cookie.secure) {
                this.secureDomainCookies.push(cookie);
            } else {
                this.insecureDomainCookies.push(cookie);
            }
            return;
        }
        var indexBeforeThisDomain = domain.length - this.domain.length - 1;
        console.assert(indexBeforeThisDomain > 0); // Can't be 0, otherwise domain === this.domain.
        // If dot is found, then we want the part after the dot.
        // If dot is not found (-1), then we want the full string (i.e. starting at index 0).
        var dotIndex = domain.lastIndexOf('.', indexBeforeThisDomain - 1) + 1;
        var domainSuffix = domain.substr(dotIndex);
        // The number of children per node is expected to be small.
        // So let's use a linear search, opposed to storing the parts in a map.
        var childNode = this.children.find((child) => {
            return child.domain === domainSuffix;
        });
        if (!childNode) {
            childNode = new DomainPart(domainSuffix, this);
            this.children.push(childNode);
        }
        childNode.addNode(domain, cookie);
    }
    
    forEachBottomUp(callback) {
        this.children.forEach((child) => {
            child.forEachBottomUp(callback);
        });
        callback(this);
    }

    removeNodeIfLeaf() {
        if (this.children.length > 0 || !this.parentDomainPart) {
            return;
        }
        var i = this.parentDomainPart.children.indexOf(this);
        if (i >= 0) {
            this.parentDomainPart.children.splice(i, 1);
            this.removeNodeIfLeaf();
        }
    }

    getHostOnlyNodes() {
        var hostOnlyNodes = [];
        this.forEachBottomUp((node) => {
            if (node.secureHostOnlyCookies.length || node.insecureHostOnlyCookies.length) {
                hostOnlyNodes.push(node);
            }
        });
        return hostOnlyNodes;
    }

    getLeafNodes() {
        var leafNodes = [];
        this.forEachBottomUp((node) => {
            if (node.children.length === 0) {
                leafNodes.push(node);
            }
        });
        if (leafNodes.length && !leafNodes[leafNodes.length - 1].parentDomainPart) {
            // Exclude the root.
            leafNodes.pop();
        }
        return leafNodes;
    }

    getUnprocessedCookies() {
        var cookies = [];
        this.forEachBottomUp((node) => {
            arrayAppend(cookies, this.secureDomainCookies);
            arrayAppend(cookies, this.insecureDomainCookies);
            arrayAppend(cookies, this.secureHostOnlyCookies);
            arrayAppend(cookies, this.insecureHostOnlyCookies);
        });
        return cookies;
    }

    // Whether it makes sense to send a request for the domain associated with
    // this node.
    isNodeFinished() {
        if (!this.maySendHttpRequest && !this.maySendHttpsRequest) {
            return true;
        }
        return this.secureHostOnlyCookies.length === 0 &&
            this.insecureHostOnlyCookies.length === 0 &&
            this.secureDomainCookies.length === 0 &&
            this.insecureDomainCookies.length === 0;
    }

    sendRequestWithHostOnlyAndDomainCookies() {
        return this._setCookiesByRequest(true);
    }

    sendRequestWithDomainCookies() {
        return this._setCookiesByRequest(false);
    }

    _getMatchingCookies(includeHostOnly, includeSecure) {
        var cookies = [];
        if (includeSecure) {
            arrayAppend(cookies, this.secureDomainCookies);
        }
        arrayAppend(cookies, this.insecureDomainCookies);
        if (includeHostOnly) {
            if (includeSecure) {
                arrayAppend(cookies, this.secureHostOnlyCookies);
            }
            arrayAppend(cookies, this.insecureHostOnlyCookies);
        }
        if (this.parentDomainPart) { // Only false for the root node.
            // includeHostOnly is unconditionally false because domain cookies
            // can only be set for a request to that specific domain.
            arrayAppend(cookies,
                this.parentDomainPart._getMatchingCookies(false, includeSecure));
        }
        return cookies;
    }

    _unsetMatchingCookies(includeHostOnly, includeSecure) {
        if (includeSecure) {
            this.secureDomainCookies.length = 0;
        }
        this.insecureDomainCookies.length = 0;
        if (includeHostOnly) {
            if (includeSecure) {
                this.secureHostOnlyCookies.length = 0;
            }
            this.insecureHostOnlyCookies.length = 0;
        }
        if (this.parentDomainPart) { // Only false for the root node.
            this.parentDomainPart._unsetMatchingCookies(true, includeSecure);
        }
    }
    
    // The algorithm runs in two passes:
    // 1) host-only cookies anywhere in the tree.
    // 2) domain-cookies at the leaves.
    // This method must be called twice, first with includeHostOnly=true, and
    // then again with includeHostOnly=false.
    _setCookiesByRequest(includeHostOnly) {
        if (!this.maySendHttpRequest && !this.maySendHttpsRequest) {
            return Promise.resolve();
        }
        // We always try sending a HTTPS request, unless we already tried before.
        var includeSecure = this.maySendHttpsRequest;
        this.maySendHttpsRequest = false;
        var cookies = this._getMatchingCookies(includeHostOnly, includeSecure);
        if (cookies.every((cookie) => !cookie.secure)) {
            this.maySendHttpRequest = false;
        }
        if (!cookies.length) {
            this.maySendHttpRequest = false;
            return Promise.resolve();
        }
        return sendRequestToSetCookies(this.domain, cookies)
        .then((didSetCookie) => {
            if (didSetCookie) {
                // There is no future need for a HTTP request.
                this.maySendHttpRequest = false;
                return true;
            }
            if (cookies.every((cookie) => cookie.secure) ||
                cookies.every((cookie) => !cookie.secure)) {
                // All cookies should be using HTTPS,
                // or they already use HTTP.
                // There is no point in trying to fall back to HTTP.
                return false;
            }
            
            if (!this.maySendHttpRequest) {
                // If meanwhile this method was called again, do not fall back to HTTP
                // since the other call will take care of performing the request.
                return false;
            }

            // Host-only cookies were included, so we should only fall back if
            // there are non-secure host-only cookies.
            if (includeHostOnly && this.insecureHostOnlyCookies.length === 0) {
                // This condition covers step 1 (host-only cookies anywhere in the tree)
                // Note: We do not fall back even if there are insecure domain cookies,
                // because if there is a child node under this node, then the domain
                // cookies would be included at step 2 (domain cookies at the leaves).
                return false;
            }
            if (!includeHostOnly && this.insecureDomainCookies.length === 0) {
                // This condition covers step 2 (domain cookies at the leaves).
                return false;
            }
            // At this point, the current domain has non-secure cookies and
            // the request failed. So retry the request with HTTP-only.
            includeSecure = false;
            this.maySendHttpRequest = false;
            cookies = this._getMatchingCookies(includeHostOnly, includeSecure);
            return sendRequestToSetCookies(this.domain, cookies);
        })
        .then((didSetCookie) => {
            if (didSetCookie) {
                this._unsetMatchingCookies(includeHostOnly, includeSecure);
            }
            // TODO: Otherwise setting cookies failed. What now?
        });
    }
}

/**
 * Work-around for https://bugzil.la/1318948, which prevents the cookies API
 * from setting/removing cookies in private browsing mode.
 *
 * The |cookies| list and its content should not be mutated by the caller and
 *  must only contain private browsing cookies.
 * Returns a promise that resolves to a list of booleans. Each boolean at index
 * i reflects whether the cookie at index i in the input list was successfully
 * set. If an error has occurred, the list has a property "errorMessage" that
 * describes the issue.
 */
function setCookiesInPrivateMode(cookies) {
    if (!chrome.extension.inIncognitoContext) {
        return Promise.resolve({
            errorMessage: 'Cannot modify ' + cookies.length +
                ' private cookies due to a Firefox bug (bugzil.la/1318948).' +
                ' Please open the cookie manager in private browsing mode and try again.',
        });
    }
    cookies.forEach(function(cookie) {
        if (cookie.storeId !== 'firefox-private') {
            // Note: Throw instead of promise rejection because the caller should validate that
            // all cookies are private cookies. This error should never be thrown.
            throw new Error('Attempted to set a non-private cookie in private browsing mode!');
        }
    });

    // Group cookies using the following rules to minimize the number of requests:
    // - Host-only cookies must be attached to requests with an exact domain match.
    // - Secure cookies must be attached to https requests.
    // - Domain cookies can be attached to requests which are a (sub)domain.
    //
    // Note that we assume that we won't be affected by browser-side cookie limits,
    // because we either remove existing cookies in bulk, or we add a single cookie.

    // First we construct the tree.
    var domainPartRoot = new DomainPart('', null);
    cookies.forEach(function(cookie) {
        var domain = cookie.domain || new URL(cookie.url).hostname;
        domain = domain.replace(/^\./, '');

        domainPartRoot.addNode(domain, cookie);
    });

    // Now send requests for host-only cookies because host-only cookies must
    // be send to the exact domain.
    return Promise.all(domainPartRoot.getHostOnlyNodes().map(function(domainPart) {
        return domainPart.sendRequestWithHostOnlyAndDomainCookies();
    })).then(function() {
        // Remove leaf nodes that have already been processed due to the
        // leaf node containing host-only cookies.
        domainPartRoot.getLeafNodes().forEach(function(domainPart) {
            if (domainPart.isNodeFinished()) {
                domainPart.removeNodeIfLeaf();
            }
        });
        // Recursively send requests to leaf nodes and remove the leaf nodes.
        return recurseLeafNodes();
    })
    .then(function() {
        var unprocessedCookies = domainPartRoot.getUnprocessedCookies();
        var results = new Array(cookies.length);
        results.fill(true);
        unprocessedCookies.forEach(function(cookie) {
            var i = cookies.indexOf(cookie);
            console.assert(i >= 0);
            results[i] = false;
        });
        if (unprocessedCookies.length) {
            results.errorMessage =
                'Cannot modify ' + unprocessedCookies.length +
                ' private cookies because the web servers are not reachable.';
        }
        return results;
    });

    function recurseLeafNodes() {
        var leafNodes = domainPartRoot.getLeafNodes();
        if (leafNodes.length === 0) {
            return Promise.resolve();
        }
        return Promise.all(leafNodes.map(function(domainPart) {
            return domainPart.sendRequestWithDomainCookies()
            .then(function() {
                console.assert(domainPart.isNodeFinished());
                domainPart.removeNodeIfLeaf();
            });
        }))
        .then(recurseLeafNodes);
    }
}
