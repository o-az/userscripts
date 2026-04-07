// ==UserScript==
// @name         Export ChatGPT Thread
// @namespace    https://chatgpt.com/
// @version      1.0
// @description  Add an export button to ChatGPT threads to save conversations as text or PDF
// @author       https://github.com/o-az
// @match        *://chatgpt.com/c/*
// @match        *://*.chatgpt.com/c/*
// @icon         https://chatgpt.com/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @supportURL   https://github.com/o-az/userscripts/issues
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const EXPORT_BUTTON_ID = 'export-chatgpt-thread-btn'
  const STYLE_ID = 'export-chatgpt-thread-styles'
  const MENU_ID = 'export-chatgpt-thread-menu'

  /**
   * @typedef {Object} Message
   * @property {string} role
   * @property {string} [type]
   * @property {string} content
   * @property {string} timestamp
   */

  /** @param {string} str */
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  /** @param {string | null | undefined} text */
  function normalizeText(text) {
    return (text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /** @param {Element | null} element */
  function getElementText(element) {
    if (!element) return ''
    const htmlElement = /** @type {HTMLElement} */ (element)
    return normalizeText(htmlElement.innerText || htmlElement.textContent)
  }

  function getConversationTitle() {
    return (
      document.title
        .replace(/\s+-\s+ChatGPT$/, '')
        .replace(/\s+\|\s+ChatGPT$/, '')
        .trim() || 'ChatGPT Thread'
    )
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
        background: #10a37f;
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
        box-shadow: 0 4px 12px rgba(16, 163, 127, 0.35);
        transition: all 0.2s ease;
      }
      #${EXPORT_BUTTON_ID}:hover {
        background: #0d8a6b;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(16, 163, 127, 0.45);
      }
      #${EXPORT_BUTTON_ID}:active {
        transform: translateY(0);
      }
      #${EXPORT_BUTTON_ID} svg {
        width: 16px;
        height: 16px;
      }
      #${MENU_ID} {
        position: fixed;
        bottom: 70px;
        right: 20px;
        background: #171717;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 8px 0;
        min-width: 150px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        z-index: 9998;
        display: none;
      }
      #${MENU_ID}.visible {
        display: block;
      }
      #${MENU_ID} button {
        display: block;
        width: 100%;
        padding: 10px 16px;
        background: transparent;
        border: none;
        color: #e5e5e5;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      #${MENU_ID} button:hover {
        background: #2a2a2a;
        color: white;
      }
    `

    document.head.appendChild(styles)
  }

  function createExportMenu() {
    const existing = document.getElementById(MENU_ID)
    if (existing) return existing

    const menu = document.createElement('div')
    menu.id = MENU_ID

    const txtBtn = document.createElement('button')
    txtBtn.textContent = 'Export as TXT'
    txtBtn.onclick = () => {
      exportAsText()
      menu.classList.remove('visible')
    }

    const pdfBtn = document.createElement('button')
    pdfBtn.textContent = 'Export as PDF'
    pdfBtn.onclick = () => {
      exportAsPDF()
      menu.classList.remove('visible')
    }

    const jsonBtn = document.createElement('button')
    jsonBtn.textContent = 'Export as JSON'
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Export Chat
    `

    button.onclick = (event) => {
      event.stopPropagation()
      menu.classList.toggle('visible')
    }

    document.body.appendChild(button)
  }

  document.addEventListener('click', (event) => {
    const target = /** @type {Node | null} */ (event.target)
    const button = document.getElementById(EXPORT_BUTTON_ID)
    const menu = document.getElementById(MENU_ID)

    if (button && menu && !button.contains(target) && !menu.contains(target)) {
      menu.classList.remove('visible')
    }
  })

  /** @param {HTMLElement} turn */
  function extractUserMessage(turn) {
    const roleElement = /** @type {HTMLElement | null} */ (
      turn.querySelector('[data-message-author-role="user"]')
    )
    if (!roleElement) return ''

    const bubble = roleElement.querySelector(
      '[class*="user-message-bubble-color"]',
    )
    return getElementText(bubble || roleElement)
  }

  /** @param {HTMLElement} turn */
  function extractAssistantMessages(turn) {
    /** @type {Array<string>} */
    const blocks = []
    const seen = new Set()

    const roleElements = turn.querySelectorAll(
      '[data-message-author-role="assistant"]',
    )

    for (const roleElement of roleElements) {
      const markdownBlocks = roleElement.querySelectorAll(
        '.markdown, [class*="QKycbG_markdown"]',
      )

      if (markdownBlocks.length > 0) {
        for (const block of markdownBlocks) {
          const text = getElementText(block)
          if (text && !seen.has(text)) {
            seen.add(text)
            blocks.push(text)
          }
        }
        continue
      }

      const text = getElementText(roleElement)
      if (text && !seen.has(text)) {
        seen.add(text)
        blocks.push(text)
      }
    }

    return blocks
  }

  function extractThinkingMessages() {
    /** @type {Array<string>} */
    const thinkingBlocks = []
    const seen = new Set()

    const roots = document.querySelectorAll(
      '[data-testid="stage-thread-flyout"], [data-stage-thread-flyout="true"], [aria-label="Reasoning details"]',
    )

    for (const root of roots) {
      const contentBlocks = root.matches('[aria-label="Reasoning details"]')
        ? [root]
        : root.querySelectorAll(
            '[aria-label="Reasoning details"], .markdown, [class*="QKycbG_markdown"]',
          )

      for (const contentBlock of contentBlocks) {
        const text = getElementText(contentBlock)
        if (!text || seen.has(text)) continue

        if (
          text === 'Reasoning details' ||
          text === 'Thinking' ||
          /^Thought for \d+/i.test(text)
        ) {
          continue
        }

        seen.add(text)
        thinkingBlocks.push(text)
      }
    }

    return thinkingBlocks
  }

  function extractChatContent() {
    /** @type {Array<Message>} */
    const messages = []
    const processedTexts = new Set()

    const turns = document.querySelectorAll(
      '[data-testid^="conversation-turn-"][data-turn]',
    )

    for (const turnElement of turns) {
      const turn = /** @type {HTMLElement} */ (turnElement)
      const turnRole = turn.getAttribute('data-turn')

      if (turnRole === 'user') {
        const text = extractUserMessage(turn)
        if (text && !processedTexts.has(`user:${text}`)) {
          processedTexts.add(`user:${text}`)
          messages.push({
            role: 'You',
            content: text,
            timestamp: new Date().toISOString(),
          })
        }
        continue
      }

      if (turnRole === 'assistant') {
        const assistantMessages = extractAssistantMessages(turn)
        for (const text of assistantMessages) {
          const key = `assistant:${text}`
          if (processedTexts.has(key)) continue
          processedTexts.add(key)
          messages.push({
            role: 'ChatGPT',
            type: 'response',
            content: text,
            timestamp: new Date().toISOString(),
          })
        }
      }
    }

    const thinkingMessages = extractThinkingMessages()
    for (const text of thinkingMessages) {
      const key = `thinking:${text}`
      if (processedTexts.has(key)) continue
      processedTexts.add(key)
      messages.push({
        role: 'ChatGPT',
        type: 'thinking',
        content: text,
        timestamp: new Date().toISOString(),
      })
    }

    return {
      title: getConversationTitle(),
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      messages,
    }
  }

  /**
   * @param {{title: string, url: string, exportedAt: string, messages: Array<{role: string, type?: string, content: string}>}} data
   */
  function formatAsText(data) {
    let output = `${data.title}\n`
    output += `${'='.repeat(data.title.length)}\n\n`
    output += `URL: ${data.url}\n`
    output += `Exported: ${new Date(data.exportedAt).toLocaleString()}\n\n`
    output += `${'-'.repeat(50)}\n\n`

    for (const message of data.messages) {
      const roleLabel = message.type
        ? `${message.role} (${message.type})`
        : message.role
      output += `[${roleLabel}]\n`
      output += `${message.content}\n\n`
    }

    return output
  }

  /** @param {string} title */
  function getExportFileBaseName(title) {
    try {
      const normalizedTitle = title
        .replace(/\s+-\s+ChatGPT$/, '')
        .replace(/\s+\|\s+ChatGPT$/, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-_]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      if (!normalizedTitle) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        return `chatgpt-thread-${timestamp}`
      }

      return normalizedTitle.startsWith('chatgpt-')
        ? normalizedTitle
        : `chatgpt-${normalizedTitle}`
    } catch {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      return `chatgpt-thread-${timestamp}`
    }
  }

  function exportAsText() {
    const data = extractChatContent()
    const text = formatAsText(data)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const fileBaseName = getExportFileBaseName(data.title)

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileBaseName}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  function exportAsJSON() {
    const data = extractChatContent()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const fileBaseName = getExportFileBaseName(data.title)

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${fileBaseName}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  function exportAsPDF() {
    const data = extractChatContent()
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
            color: #222;
          }
          h1 {
            border-bottom: 2px solid #10a37f;
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
            border-left: 4px solid #10a37f;
          }
          .message.user {
            border-left-color: #4a90d9;
            background: #f0f7ff;
          }
          .message.thinking {
            border-left-color: #8b5cf6;
            background: #f5f3ff;
          }
          .role {
            font-weight: 600;
            color: #10a37f;
            margin-bottom: 8px;
            font-size: 14px;
            text-transform: uppercase;
          }
          .message.user .role {
            color: #4a90d9;
          }
          .message.thinking .role {
            color: #8b5cf6;
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
        <button
          class="no-print"
          onclick="window.print()"
          style="
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            background: #10a37f;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          "
        >
          Print / Save as PDF
        </button>
        <h1>${escapeHtml(data.title)}</h1>
        <div class="meta">
          <strong>URL:</strong> ${escapeHtml(data.url)}<br>
          <strong>Exported:</strong> ${new Date(data.exportedAt).toLocaleString()}
        </div>
        <hr>
        ${data.messages
          .map((message) => {
            const roleLabel = message.type
              ? `${message.role} (${message.type})`
              : message.role
            const classNames = [
              'message',
              message.role === 'You' ? 'user' : '',
              message.type === 'thinking' ? 'thinking' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return /* html */ `
              <div class="${classNames}">
                <div class="role">${escapeHtml(roleLabel)}</div>
                <div class="content">${escapeHtml(message.content)}</div>
              </div>
            `
          })
          .join('')}
      </body>
      </html>
    `)

    printWindow.document.close()
  }

  function isConversationReady() {
    return Boolean(
      document.querySelector('[data-testid^="conversation-turn-"]') ||
        document.querySelector('[data-message-author-role]') ||
        document.querySelector('main'),
    )
  }

  function init() {
    const attachIfReady = () => {
      if (isConversationReady()) addExportButton()
    }

    attachIfReady()

    const checkInterval = setInterval(() => {
      attachIfReady()
      if (document.getElementById(EXPORT_BUTTON_ID)) {
        clearInterval(checkInterval)
      }
    }, 1_000)

    setTimeout(() => clearInterval(checkInterval), 30_000)

    const observer = new MutationObserver(() => {
      if (!document.getElementById(EXPORT_BUTTON_ID) && isConversationReady()) {
        addExportButton()
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
