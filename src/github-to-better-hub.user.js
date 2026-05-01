// ==UserScript==
// @name         Redirect github.com to better-hub.com
// @namespace    https://better-hub.com/
// @version      1.1
// @description  Redirect github.com browsing to better-hub.com while preserving paths, query strings, hashes, and ?noredirect bypasses.
// @author       https://github.com/o-az
// @match        *://github.com/*
// @icon         https://better-hub.com/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @source       https://github.com/o-az/userscripts/blob/main/src/github-to-better-hub.user.js
// @downloadURL  http://github.com/o-az/userscripts/blob/main/src/github-to-better-hub.user.js?raw=true
// @updateURL    http://github.com/o-az/userscripts/blob/main/src/github-to-better-hub.user.js?raw=true
// @supportURL   https://github.com/o-az/userscripts/issues
// @tag          github
// @tag          better-hub
// @tag          redirect
// @tag          code-review
// @license      MIT
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const { pathname, search, hash } = window.location

  // Bypass: Add ?noredirect to any URL to skip redirection
  if (new URLSearchParams(search).has('noredirect')) return

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
  if (
    excludedPaths.some(
      (path) => pathname === path || pathname.startsWith(path + '/'),
    )
  )
    return

  // Redirect without adding to browser history
  window.location.replace(`https://better-hub.com${pathname}${search}${hash}`)
})()
