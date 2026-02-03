// ==UserScript==
// @name         Redirect npmjs.com to npmx.dev
// @namespace    https://npmx.dev/
// @version      1.3
// @description  Automatically redirect from npmjs.com to the faster npmx.dev browser. URL paths are fully compatible for package browsing. Append `?noredirect` to any URL to skip redirection.
// @author       https://github.com/o-az
// @match        *://npmjs.com/*
// @match        *://*.npmjs.com/*
// @icon         https://npmx.dev/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @supportURL   https://github.com/o-az/userscripts/issues
// @license      MIT
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const { pathname, search, hash } = window.location;

  // Bypass: Add ?noredirect to any URL to skip redirection
  if (search.includes("noredirect")) return;

  // Paths that don't have equivalents on npmx.dev
  const excludedPaths = [
    "/login",
    "/logout",
    "/signup",
    "/settings",
    "/org/",
    "/~",          // User profiles
    "/-/",         // API/internal routes
    "/advisories", // Security advisories management
    "/support",
  ];

  // Check if current path should be excluded
  if (excludedPaths.some((path) => pathname.startsWith(path))) return;

  // Exclude package management subpages (but allow package view pages)
  // e.g., /package/react/access, /package/react/collaborators
  const packageManagementSuffixes = ["/access", "/collaborators", "/admin"];
  if (packageManagementSuffixes.some((suffix) => pathname.endsWith(suffix))) return;

  // Redirect without adding to browser history
  window.location.replace(`https://npmx.dev${pathname}${search}${hash}`);
})();
