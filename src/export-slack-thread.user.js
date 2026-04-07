// ==UserScript==
// @name         Export Slack Thread
// @namespace    https://app.slack.com/
// @version      1.0
// @description  Add an export button to Slack thread panels to save conversations as text, JSON, or PDF
// @author       https://github.com/o-az
// @match        *://app.slack.com/*
// @match        *://*.slack.com/*
// @icon         https://app.slack.com/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @supportURL   https://github.com/o-az/userscripts/issues
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const EXPORT_BUTTON_ID = 'export-slack-thread-btn'
  const MENU_ID = 'export-slack-thread-menu'
  const STYLE_ID = 'export-slack-thread-styles'

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
        background: #611f69;
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
        box-shadow: 0 4px 12px rgba(97, 31, 105, 0.4);
        transition: all 0.2s ease;
      }
      #${EXPORT_BUTTON_ID}:hover {
        background: #4a154b;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(97, 31, 105, 0.5);
      }
      #${EXPORT_BUTTON_ID}:active {
        transform: translateY(0);
      }
      #${EXPORT_BUTTON_ID} svg {
        width: 16px;
        height: 16px;
      }
      .export-slack-menu {
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
      .export-slack-menu.visible {
        display: block;
      }
      .export-slack-menu button {
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
      .export-slack-menu button:hover {
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
      className: 'export-slack-menu',
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
      Export Thread
    `

    button.onclick = (event) => {
      event.stopPropagation()
      menu.classList.toggle('visible')
    }

    document.body.appendChild(button)
  }

  function removeExportButton() {
    document.getElementById(EXPORT_BUTTON_ID)?.remove()
    document.getElementById(MENU_ID)?.remove()
    document.getElementById(STYLE_ID)?.remove()
  }

  // Dismiss menu on outside click
  document.addEventListener('click', (event) => {
    const target = /** @type {Node|null} */ (event.target)
    const button = document.getElementById(EXPORT_BUTTON_ID)
    const menu = document.getElementById(MENU_ID)
    if (button && menu && !button.contains(target) && !menu.contains(target)) {
      menu.classList.remove('visible')
    }
  })

  /**
   * @typedef {Object} ThreadMessage
   * @property {string} sender
   * @property {string} timestamp
   * @property {string} content
   * @property {boolean} isRoot
   */

  /**
   * Find the open thread flexpane.
   * @returns {Element | null}
   */
  function findThreadPanel() {
    // The thread panel is .p-threads_flexpane inside a secondary view
    return (
      document.querySelector('.p-threads_flexpane') ||
      document.querySelector('[data-qa="threads_flexpane"]')
    )
  }

  /**
   * Extract the channel name from the thread panel's aria-label.
   * @param {Element} panel
   * @returns {string}
   */
  function getChannelName(panel) {
    // aria-label="Thread in channel <name>" on the dialog container
    const dialog = panel.closest('[aria-label^="Thread in"]')
    if (dialog) {
      const label = dialog.getAttribute('aria-label') || ''
      const match = label.match(/Thread in (?:channel )?(.+)/)
      if (match?.[1]) return match[1].trim()
    }

    // Fallback: look for the virtual list's aria-label
    const list = panel.querySelector('[role="list"][aria-label]')
    if (!list) return 'unknown-channel'

    const label = list.getAttribute('aria-label') || ''
    const match = label.match(/Thread in (.+?)(?:\s*\()/)
    if (match?.[1]) return match[1].trim()

    return 'unknown-channel'
  }

  /**
   * Parse a single message container element.
   * @param {Element} el - element with data-qa="message_container"
   * @param {string | null} lastSender - previous sender (for compact/adjacent messages)
   * @returns {{ sender: string, timestamp: string, content: string, isRoot: boolean } | null}
   */
  function parseMessage(el, lastSender) {
    const isRoot = el.classList.contains('c-message_kit__thread_message--root')

    // --- Sender ---
    const senderBtn = el.querySelector('[data-qa="message_sender_name"]')
    const sender = senderBtn
      ? senderBtn.textContent?.trim() || ''
      : lastSender || ''

    // --- Timestamp ---
    let timestamp = ''
    const tsLink = el.querySelector('a.c-timestamp')
    if (tsLink) {
      const ariaLabel = tsLink.getAttribute('aria-label') || ''
      timestamp = ariaLabel || tsLink.textContent?.trim() || ''
    } else {
      // Compact gutter timestamp
      const compactTs = el.querySelector(
        '.p-thread_compact_gutter_generic a.c-timestamp',
      )
      if (compactTs) {
        timestamp =
          compactTs.getAttribute('aria-label') ||
          compactTs.textContent?.trim() ||
          ''
      }
    }

    // --- Content ---
    // Primary: rich text blocks
    const richTextSections = el.querySelectorAll('.p-rich_text_section')
    /** @type {string[]} */
    const parts = []
    for (const section of richTextSections) {
      const text = /** @type {HTMLElement} */ (section).innerText?.trim()
      if (text) parts.push(text)
    }

    // Code blocks
    const codeBlocks = el.querySelectorAll(
      '.p-rich_text_block pre, .p-code_block code',
    )
    for (const code of codeBlocks) {
      const text = /** @type {HTMLElement} */ (code).innerText?.trim()
      if (text) parts.push('```\n' + text + '\n```')
    }

    // Blockquotes
    const quotes = el.querySelectorAll('.p-rich_text_block blockquote')
    for (const quote of quotes) {
      const text = /** @type {HTMLElement} */ (quote).innerText?.trim()
      if (text) parts.push('> ' + text)
    }

    // Lists
    const lists = el.querySelectorAll('.p-rich_text_list')
    for (const list of lists) {
      const items = list.querySelectorAll('.p-rich_text_section')
      for (const item of items) {
        const text = /** @type {HTMLElement} */ (item).innerText?.trim()
        if (text) parts.push('• ' + text)
      }
    }

    // Fallback: data-qa="message-text"
    if (parts.length === 0) {
      const messageText = el.querySelector('[data-qa="message-text"]')
      if (messageText) {
        const text = /** @type {HTMLElement} */ (messageText).innerText?.trim()
        if (text) parts.push(text)
      }
    }

    // Attachments / files
    const attachments = el.querySelectorAll(
      '[data-qa="attachment"], .c-message_attachment',
    )
    for (const att of attachments) {
      const text = /** @type {HTMLElement} */ (att).innerText?.trim()
      if (text) parts.push('[Attachment] ' + text)
    }

    const content = parts.join('\n')
    if (!content && !sender) return null

    return { sender, timestamp, content, isRoot }
  }

  /**
   * Extract all messages from the currently open thread panel.
   */
  function extractThreadContent() {
    const panel = findThreadPanel()
    if (!panel) {
      console.warn('Slack Export: No thread panel found')
      return {
        channel: '',
        title: 'Slack Thread',
        url: window.location.href,
        exportedAt: new Date().toISOString(),
        messages: /** @type {ThreadMessage[]} */ ([]),
      }
    }

    const channel = getChannelName(panel)

    // Get all message containers inside the thread panel
    const containers = panel.querySelectorAll('[data-qa="message_container"]')
    /** @type {ThreadMessage[]} */
    const messages = []
    /** @type {string | null} */
    let lastSender = null

    for (const container of containers) {
      const msg = parseMessage(container, lastSender)
      if (msg) {
        // Deduplicate: skip if same sender + content as previous
        const prev = messages[messages.length - 1]
        if (
          prev &&
          prev.sender === msg.sender &&
          prev.content === msg.content
        ) {
          continue
        }
        messages.push(msg)
        if (msg.sender) lastSender = msg.sender
      }
    }

    // Build a title from the root message
    const rootMsg = messages.find((message) => message.isRoot) || messages.at(0)
    const title = rootMsg
      ? `Thread by ${rootMsg.sender} in #${channel}`
      : `Thread in #${channel}`

    return {
      channel,
      title,
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      messages,
    }
  }

  // ---- Export Formats ----

  /**
   * @param {{ channel: string, title: string, url: string, exportedAt: string, messages: ThreadMessage[] }} data
   */
  function formatAsText(data) {
    let output = `${data.title}\n`
    output += `${'='.repeat(data.title.length)}\n\n`
    output += `URL: ${data.url}\n`
    output += `Exported: ${new Date(data.exportedAt).toLocaleString()}\n\n`
    output += `${'-'.repeat(50)}\n\n`

    for (const msg of data.messages) {
      const label = msg.isRoot ? `${msg.sender} (thread start)` : msg.sender
      output += `[${label}]  ${msg.timestamp}\n`
      output += `${msg.content}\n\n`
    }

    return output
  }

  /** @param {string} title */
  function getExportFileBaseName(title) {
    try {
      const normalized = title
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-_]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!normalized)
        return `slack-thread-${new Date().toISOString().replace(/[:.]/g, '-')}`

      return normalized.startsWith('slack-')
        ? normalized
        : `slack-${normalized}`
    } catch {
      return `slack-thread-${new Date().toISOString().replace(/[:.]/g, '-')}`
    }
  }

  /** @param {Blob} blob @param {string} filename */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    Object.assign(a, { href: url, download: filename })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportAsText() {
    const data = extractThreadContent()
    if (data.messages.length === 0) {
      alert('No thread messages found. Make sure a thread panel is open.')
      return
    }
    const text = formatAsText(data)
    download(
      new Blob([text], { type: 'text/plain;charset=utf-8' }),
      `${getExportFileBaseName(data.title)}.txt`,
    )
  }

  function exportAsJSON() {
    const data = extractThreadContent()
    if (data.messages.length === 0) {
      alert('No thread messages found. Make sure a thread panel is open.')
      return
    }
    download(
      new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      }),
      `${getExportFileBaseName(data.title)}.json`,
    )
  }

  function exportAsPDF() {
    const data = extractThreadContent()
    if (data.messages.length === 0) {
      alert('No thread messages found. Make sure a thread panel is open.')
      return
    }

    const fileBaseName = getExportFileBaseName(data.title)
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
            border-bottom: 2px solid #611f69;
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
            border-left: 4px solid #611f69;
          }
          .message.root {
            border-left-color: #1264a3;
            background: #f0f7ff;
          }
          .role {
            font-weight: 600;
            color: #611f69;
            margin-bottom: 4px;
            font-size: 14px;
          }
          .message.root .role {
            color: #1264a3;
          }
          .ts {
            font-size: 12px;
            color: #888;
            margin-bottom: 8px;
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
          background: #611f69;
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
          <div class="message ${msg.isRoot ? 'root' : ''}">
            <div class="role">${escapeHtml(msg.sender)}</div>
            <div class="ts">${escapeHtml(msg.timestamp)}</div>
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

  // ---- Lifecycle ----

  function hasThreadPanel() {
    return !!(
      document.querySelector('.p-threads_flexpane') ||
      document.querySelector('[data-qa="threads_flexpane"]')
    )
  }

  function init() {
    const checkInterval = setInterval(() => {
      if (hasThreadPanel()) {
        clearInterval(checkInterval)
        addExportButton()
      }
    }, 1_000)

    // Stop checking after 30 seconds
    setTimeout(() => clearInterval(checkInterval), 30_000)
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init)
  else init()

  // Show/hide button as thread panel opens/closes (Slack is a SPA)
  const observer = new MutationObserver(() => {
    const panelOpen = hasThreadPanel()
    const buttonExists = !!document.getElementById(EXPORT_BUTTON_ID)

    if (panelOpen && !buttonExists) {
      addExportButton()
    } else if (!panelOpen && buttonExists) {
      removeExportButton()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
})()
