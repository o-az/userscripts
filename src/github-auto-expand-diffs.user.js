// ==UserScript==
// @name         GitHub Auto-Expand Diffs
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically expands all collapsed code sections in GitHub diffs
// @author       You
// @match        https://github.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

;(() => {
  function expandAllDiffs() {
    // Find all expand buttons using the class name pattern
    const expandButtons = document.querySelectorAll(
      'button.js-expand-all-difflines-button',
    )

    if (expandButtons.length > 0) {
      console.log(
        `Found ${expandButtons.length} collapsed diff sections, expanding...`,
      )

      expandButtons.forEach((button, index) => {
        // Small delay between clicks to avoid overwhelming the page
        setTimeout(() => {
          button.click()
          console.log(
            `Expanded diff ${index + 1}/${expandButtons.length}: ${button.getAttribute('data-file-path')}`,
          )
        }, index * 100)
      })
    }
  }

  // Run when the page loads
  expandAllDiffs()

  // Also watch for dynamic content changes (GitHub uses a lot of AJAX)
  const observer = new MutationObserver((mutations) => {
    // Check if new diff content has been added
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Look for expand buttons in the new content
        const hasNewDiffs = Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType === 1) {
            // Element node
            return node.querySelector?.('.js-expand-all-difflines-button')
          }
          return false
        })

        if (hasNewDiffs) {
          setTimeout(expandAllDiffs, 500) // Small delay to let the page settle
          break
        }
      }
    }
  })

  // Start observing the document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  // Also run when navigating between pages (GitHub is a SPA)
  let lastUrl = location.href
  new MutationObserver(() => {
    const url = location.href
    if (url !== lastUrl) {
      lastUrl = url
      setTimeout(expandAllDiffs, 1000)
    }
  }).observe(document, { subtree: true, childList: true })
})()
