// ==UserScript==
// @name         Export Claude Chat
// @namespace    https://claude.ai/
// @version      1.0
// @description  Add an export button to Claude.ai conversations to save chats as text or PDF
// @author       https://github.com/o-az
// @match        *://claude.ai/*
// @match        *://*.claude.ai/*
// @icon         https://claude.ai/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @supportURL   https://github.com/o-az/userscripts/issues
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const EXPORT_BUTTON_ID = 'export-claude-chat-btn'
  const STYLE_ID = 'export-claude-chat-styles'

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return

    const styles = document.createElement('style')
    styles.id = STYLE_ID
    styles.textContent = `
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
    const menu = document.createElement('div')
    menu.className = 'export-claude-menu'
    menu.id = 'export-claude-menu'

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

    menu.appendChild(txtBtn)
    menu.appendChild(pdfBtn)
    document.body.appendChild(menu)
    return menu
  }

  function addExportButton() {
    if (document.getElementById(EXPORT_BUTTON_ID)) return

    addStyles()
    const menu = createExportMenu()

    const button = document.createElement('button')
    button.id = EXPORT_BUTTON_ID
    button.innerHTML = `
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

    document.addEventListener('click', (e) => {
      if (!button.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('visible')
      }
    })

    document.body.appendChild(button)
  }

  function extractChatContent() {
    const messages = []

    // Try multiple selectors for message containers
    const messageSelectors = [
      '[data-testid="conversation-turn"]',
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '.font-claude-message',
      '[data-message-author-role]',
      '.message',
      '.conversation-message',
      '[class*="message"]',
    ]

    let foundElements = []
    for (const selector of messageSelectors) {
      foundElements = document.querySelectorAll(selector)
      if (foundElements.length > 0) break
    }

    // Fallback: look for elements with specific attributes
    if (foundElements.length === 0) {
      const allElements = document.querySelectorAll('*')
      for (const el of allElements) {
        if (
          el.getAttribute('data-testid')?.includes('message') ||
          el.getAttribute('data-testid')?.includes('turn') ||
          el.className?.includes('message') ||
          el.getAttribute('data-message-author-role')
        ) {
          foundElements.push(el)
        }
      }
    }

    for (const el of foundElements) {
      const role =
        el.getAttribute('data-message-author-role') ||
        (el.getAttribute('data-testid')?.includes('user') ? 'user' : null) ||
        (el.getAttribute('data-testid')?.includes('assistant')
          ? 'assistant'
          : null) ||
        (el.textContent?.toLowerCase().includes('claude')
          ? 'assistant'
          : 'user')

      const contentEl =
        el.querySelector('[class*="content"]') ||
        el.querySelector('p, .prose, .text') ||
        el

      const text = contentEl.innerText?.trim()
      if (text && text.length > 0) {
        messages.push({
          role: role === 'user' ? 'You' : 'Claude',
          content: text,
          timestamp: new Date().toISOString(),
        })
      }
    }

    return {
      title: document.title.replace(' - Claude', '').trim() || 'Claude Chat',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      messages,
    }
  }

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

    const a = document.createElement('a')
    a.href = url
    a.download = `claude-chat-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportAsPDF() {
    const data = extractChatContent()
    const text = formatAsText(data)

    // Create a printable window
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('Please allow popups to export as PDF')
      return
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${data.title}</title>
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
        <h1>${data.title}</h1>
        <div class="meta">
          <strong>URL:</strong> ${data.url}<br>
          <strong>Exported:</strong> ${new Date(data.exportedAt).toLocaleString()}
        </div>
        <hr>
        ${data.messages
          .map(
            (msg) => `
          <div class="message ${msg.role === 'You' ? 'user' : ''}">
            <div class="role">${msg.role}</div>
            <div class="content">${msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
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
        document.querySelector('[data-testid="conversation-turn"]') ||
        document.querySelector('[data-testid="user-message"]') ||
        document.querySelector('[data-testid="assistant-message"]') ||
        document.querySelector('.font-claude-message') ||
        document.querySelector('[class*="conversation"]') ||
        document.querySelector('main')?.querySelectorAll('div').length > 5

      if (hasConversation || document.querySelector('main')) {
        clearInterval(checkInterval)
        addExportButton()
      }
    }, 1000)

    // Stop checking after 30 seconds
    setTimeout(() => clearInterval(checkInterval), 30000)
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
