// ==UserScript==
// @name         Redirect npmjs.com to npmx.dev
// @namespace    https://npmx.dev/
// @version      1.1
// @description  Automatically redirect from npmjs.com to the faster npmx.dev browser. URL paths are fully compatible for package browsing. Append `?noredirect` to any URL to skip redirection.
// @author       https://github.com/o-az
// @match        *://npmjs.com/*
// @match        *://*.npmjs.com/*
// @icon         https://npmx.dev/favicon.ico
// @grant        none
// @run-at       document-start
// @license      MIT
// @noframes
// ==/UserScript==

(() => {
  // Bypass: Add ?noredirect to any URL to skip redirection
  if (window.location.search.includes("noredirect")) return;

  // Paths that don't have equivalents on npmx.dev (auth, settings, org management, API)
  const excludedPaths = [
    "/login",
    "/logout",
    "/signup",
    "/settings",
    "/org/",
    "/~", // User profiles
    "/-/", // API/internal routes
    "/advisories", // Security advisories management
    "/support",
  ];

  // Check if current path should be excluded
  const currentPath = window.location.pathname;
  if (excludedPaths.some((path) => currentPath.startsWith(path))) return;

  // Build target URL preserving path, search params, and hash
  const targetUrl =
    "https://npmx.dev" +
    currentPath +
    window.location.search +
    window.location.hash;

  // Redirect without adding to browser history
  window.location.replace(targetUrl);
})();
