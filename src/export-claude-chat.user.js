// ==UserScript==
// @name         Export Claude Chat
// @namespace    https://claude.ai/
// @version      1.4
// @description  Export Claude conversations as TXT, JSON, or printable PDF from a floating in-page menu.
// @author       https://github.com/o-az
// @match        *://claude.ai/*
// @match        *://*.claude.ai/*
// @icon         https://claude.ai/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @source       https://github.com/o-az/userscripts/blob/main/src/export-claude-chat.user.js
// @downloadURL  https://github.com/o-az/userscripts/blob/main/src/export-claude-chat.user.js?raw=true
// @updateURL    https://github.com/o-az/userscripts/blob/main/src/export-claude-chat.user.js?raw=true
// @supportURL   https://github.com/o-az/userscripts/issues
// @tag          claude
// @tag          export
// @tag          chat
// @tag          pdf
// @tag          json
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const EXPORT_BUTTON_ID = 'export-claude-chat-btn'
  const STYLE_ID = 'export-claude-chat-styles'
  const MENU_ID = 'export-claude-menu'

  /** @param {string} str */
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return

    const styles = document.createElement('style')
    styles.id = STYLE_ID
    styles.textContent = /* css */ `
      #${EXPORT_BUTTON_ID} {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        background: #d97757;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 10px 16px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(217, 119, 87, 0.4);
        transition: all 0.2s ease;
      }
      #${EXPORT_BUTTON_ID}:hover {
        background: #c46a4e;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(217, 119, 87, 0.5);
      }
      #${EXPORT_BUTTON_ID}:active {
        transform: translateY(0);
      }
      #${EXPORT_BUTTON_ID} svg {
        width: 16px;
        height: 16px;
      }
      .export-claude-menu {
        position: fixed;
        bottom: 70px;
        right: 20px;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 8px 0;
        min-width: 140px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        z-index: 9998;
        display: none;
      }
      .export-claude-menu.visible {
        display: block;
      }
      .export-claude-menu button {
        display: block;
        width: 100%;
        padding: 10px 16px;
        background: transparent;
        border: none;
        color: #e0e0e0;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s;
      }
      .export-claude-menu button:hover {
        background: #333;
        color: white;
      }
    `
    document.head.appendChild(styles)
  }

  function createExportMenu() {
    const existing = document.getElementById(MENU_ID)
    if (existing) return existing

    const menu = document.createElement('div')
    Object.assign(menu, {
      id: MENU_ID,
      className: 'export-claude-menu',
    })

    const txtBtn = document.createElement('button')
    txtBtn.textContent = '📄 Export as TXT'
    txtBtn.onclick = () => {
      exportAsText()
      menu.classList.remove('visible')
    }

    const pdfBtn = document.createElement('button')
    pdfBtn.textContent = '📑 Export as PDF'
    pdfBtn.onclick = () => {
      exportAsPDF()
      menu.classList.remove('visible')
    }

    const jsonBtn = document.createElement('button')
    jsonBtn.textContent = '🔧 Export as JSON'
    jsonBtn.onclick = () => {
      exportAsJSON()
      menu.classList.remove('visible')
    }

    menu.appendChild(txtBtn)
    menu.appendChild(pdfBtn)
    menu.appendChild(jsonBtn)
    document.body.appendChild(menu)
    return menu
  }

  function addExportButton() {
    if (document.getElementById(EXPORT_BUTTON_ID)) return

    addStyles()
    const menu = createExportMenu()

    const button = document.createElement('button')
    button.id = EXPORT_BUTTON_ID
    button.innerHTML = /* html */ `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export Chat
    `

    button.onclick = (e) => {
      e.stopPropagation()
      menu.classList.toggle('visible')
    }

    document.body.appendChild(button)
  }

  // Single global click listener to dismiss the menu — registered once
  document.addEventListener('click', (event) => {
    const target = /** @type {Node|null} */ (event.target)
    const button = document.getElementById(EXPORT_BUTTON_ID)
    const menu = document.getElementById(MENU_ID)
    if (button && menu && !button.contains(target) && !menu.contains(target)) {
      menu.classList.remove('visible')
    }
  })

  const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]'
  // claude.ai (late 2025) wraps replies in [data-testid="assistant-message"]; the old
  // `font-claude-response` class now only survives as a CSS variable name, so it is a
  // fallback for older builds only.
  const ASSISTANT_MESSAGE_SELECTOR =
    '[data-testid="assistant-message"], .font-claude-response'
  // Rendered markdown blocks inside a reply. Reading these (instead of the whole
  // message) skips the sr-only "Claude responded:" heading, the collapsed thinking
  // block and the copy/retry action bar.
  const ASSISTANT_TEXT_SELECTOR =
    '[data-perf-reply-text], .standard-markdown, .font-claude-response'
  const ASSISTANT_NOISE_SELECTOR =
    '[data-testid="message-actions"], [data-cds="TurnStatus"], [data-find-omitted], .sr-only'

  /** @param {Element} element */
  function readText(element) {
    return /** @type {HTMLElement} */ (element).innerText?.trim() ?? ''
  }

  /** @param {Element} messageElement */
  function readAssistantText(messageElement) {
    const blocks = messageElement.querySelectorAll(ASSISTANT_TEXT_SELECTOR)
    const parts = []
    for (const block of blocks) {
      // Skip nested matches so the same text is not collected twice
      if (block.parentElement?.closest(ASSISTANT_TEXT_SELECTOR)) continue
      if (block.closest(ASSISTANT_NOISE_SELECTOR)) continue
      const text = readText(block)
      if (text) parts.push(text)
    }
    if (parts.length > 0) return parts.join('\n\n')

    // No markdown blocks (older layout): read the rendered text so line breaks survive.
    return readText(messageElement)
  }

  /**
   * @param {Element} element
   * @returns {{role: 'You' | 'Claude', element: Element} | null}
   */
  function classifyMessage(element) {
    if (element.matches(USER_MESSAGE_SELECTOR)) {
      return { role: 'You', element }
    }
    if (element.matches(ASSISTANT_MESSAGE_SELECTOR)) {
      return { role: 'Claude', element }
    }
    const user = element.querySelector(USER_MESSAGE_SELECTOR)
    if (user) return { role: 'You', element: user }
    const assistant = element.querySelector(ASSISTANT_MESSAGE_SELECTOR)
    if (assistant) return { role: 'Claude', element: assistant }
    return null
  }

  function findMessageElements() {
    // Preferred: transcript rows keep user and assistant turns in display order.
    const rows = document.querySelectorAll('[data-testid="transcript-row"]')
    if (rows.length > 0) return Array.from(rows)

    // Fallback: collect both kinds of message and sort them by document position.
    const elements = Array.from(
      document.querySelectorAll(
        `${USER_MESSAGE_SELECTOR}, ${ASSISTANT_MESSAGE_SELECTOR}`,
      ),
    )
    return elements
      .filter(
        (element) =>
          !element.parentElement?.closest(
            `${USER_MESSAGE_SELECTOR}, ${ASSISTANT_MESSAGE_SELECTOR}`,
          ),
      )
      .sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      )
  }

  function extractChatContent() {
    /** @type {Array<{role: string, content: string, timestamp: string}>} */
    const messages = []
    const seen = new Set()

    for (const element of findMessageElements()) {
      const message = classifyMessage(element)
      if (!message) continue

      const content =
        message.role === 'You'
          ? readText(message.element)
          : readAssistantText(message.element)
      if (!content) continue

      const key = `${message.role}\u0000${content}`
      if (seen.has(key)) continue
      seen.add(key)

      messages.push({
        role: message.role,
        content,
        timestamp: new Date().toISOString(),
      })
    }

    return {
      title:
        document.title.replace(/\s+-\s+Claude$/, '').trim() || 'Claude Chat',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      messages,
    }
  }

  /**
   * @param {{title: string, url: string, exportedAt: string, messages: Array<{role: string, content: string}>}} data
   */
  function formatAsText(data) {
    let output = `${data.title}\n`
    output += `${'='.repeat(data.title.length)}\n\n`
    output += `URL: ${data.url}\n`
    output += `Exported: ${new Date(data.exportedAt).toLocaleString()}\n\n`
    output += `${'-'.repeat(50)}\n\n`

    for (const msg of data.messages) {
      output += `[${msg.role}]\n`
      output += `${msg.content}\n\n`
    }

    return output
  }

  function exportAsText() {
    const data = extractChatContent()
    const text = formatAsText(data)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const fileBaseName = getExportFileBaseName(data.title)

    const a = document.createElement('a')
    Object.assign(a, {
      href: url,
      download: `${fileBaseName}.txt`,
    })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportAsJSON() {
    const data = extractChatContent()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const fileBaseName = getExportFileBaseName(data.title)

    const a = document.createElement('a')
    Object.assign(a, {
      href: url,
      download: `${fileBaseName}.json`,
    })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /** @param {string} title */
  function getExportFileBaseName(title) {
    try {
      const normalizedTitle = title
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-_]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!normalizedTitle) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        return `claude-chat-${timestamp}`
      }

      return normalizedTitle.startsWith('claude-')
        ? normalizedTitle
        : `claude-${normalizedTitle}`
    } catch {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      return `claude-chat-${timestamp}`
    }
  }

  function exportAsPDF() {
    const data = extractChatContent()
    const fileBaseName = getExportFileBaseName(data.title)

    // Create a printable window
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('Please allow popups to export as PDF')
      return
    }

    printWindow.document.write(/* html */ `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${escapeHtml(fileBaseName)}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            color: #333;
          }
          h1 {
            border-bottom: 2px solid #d97757;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .meta {
            color: #666;
            font-size: 14px;
            margin-bottom: 30px;
          }
          .message {
            margin: 20px 0;
            padding: 15px;
            background: #f8f8f8;
            border-radius: 8px;
            border-left: 4px solid #d97757;
          }
          .message.user {
            border-left-color: #4a90d9;
            background: #f0f7ff;
          }
          .role {
            font-weight: 600;
            color: #d97757;
            margin-bottom: 8px;
            font-size: 14px;
            text-transform: uppercase;
          }
          .message.user .role {
            color: #4a90d9;
          }
          .content {
            white-space: pre-wrap;
          }
          @media print {
            body { margin: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <button class="no-print" onclick="window.print()" style="
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 10px 20px;
          background: #d97757;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        ">Print / Save as PDF</button>
        <h1>${escapeHtml(data.title)}</h1>
        <div class="meta">
          <strong>URL:</strong> ${escapeHtml(data.url)}<br>
          <strong>Exported:</strong> ${new Date(data.exportedAt).toLocaleString()}
        </div>
        <hr>
        ${data.messages
          .map(
            (msg) => /* html */ `
          <div class="message ${msg.role === 'You' ? 'user' : ''}">
            <div class="role">${escapeHtml(msg.role)}</div>
            <div class="content">${escapeHtml(msg.content)}</div>
          </div>
        `,
          )
          .join('')}
      </body>
      </html>
    `)
    printWindow.document.close()
  }

  // Initialize
  function init() {
    // Wait for the conversation to load
    const checkInterval = setInterval(() => {
      // Look for conversation container or messages
      const hasConversation =
        document.querySelector('[data-testid="user-message"]') ||
        document.querySelector('.font-claude-response') ||
        document.querySelector('[data-is-streaming]') ||
        (document.querySelector('main')?.querySelectorAll('div')?.length ?? 0) >
          5

      if (hasConversation || document.querySelector('main')) {
        clearInterval(checkInterval)
        addExportButton()
      }
    }, 1_000)

    // Stop checking after 30 seconds
    setTimeout(() => clearInterval(checkInterval), 30_000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  // Re-add button if removed by page navigation (SPA)
  const observer = new MutationObserver(() => {
    if (!document.getElementById(EXPORT_BUTTON_ID)) {
      addExportButton()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
})()
