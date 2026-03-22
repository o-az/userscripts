// ==UserScript==
// @name         Redirect github.com to better-hub.com
// @namespace    https://better-hub.com/
// @version      1.0
// @description  Automatically redirect from github.com to better-hub.com. URL paths are fully compatible for browsing. Append `?noredirect` to any URL to skip redirection.
// @author       https://github.com/o-az
// @match        *://github.com/*
// @match        *://*.github.com/*
// @icon         https://better-hub.com/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @supportURL   https://github.com/o-az/userscripts/issues
// @license      MIT
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const { pathname, search, hash } = window.location

  // Bypass: Add ?noredirect to any URL to skip redirection
  if (search.includes('noredirect')) return

  // Paths that don't have equivalents on better-hub.com
  const excludedPaths = [
    '/login',
    '/logout',
    '/signup',
    '/settings',
    '/notifications',
    '/new',
    '/marketplace',
    '/sponsors',
    '/organizations',
    '/codespaces',
    '/account',
    '/sessions',
    '/password_reset',
  ]

  // Check if current path should be excluded
  if (excludedPaths.some((path) => pathname.startsWith(path))) return

  // Redirect without adding to browser history
  window.location.replace(`https://better-hub.com${pathname}${search}${hash}`)
})()
