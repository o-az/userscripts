// ==UserScript==
// @name         Export Amp Thread
// @namespace    https://ampcode.com/
// @version      1.0
// @description  Add an export button to Amp threads to save conversations as text or PDF
// @author       https://github.com/o-az
// @match        *://ampcode.com/threads/*
// @match        *://*.ampcode.com/threads/*
// @icon         https://ampcode.com/favicon.ico
// @homepageURL  https://github.com/o-az/userscripts
// @supportURL   https://github.com/o-az/userscripts/issues
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const EXPORT_BUTTON_ID = 'export-amp-thread-btn'
  const STYLE_ID = 'export-amp-thread-styles'

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
      .export-amp-menu {
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
      .export-amp-menu.visible {
        display: block;
      }
      .export-amp-menu button {
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
      .export-amp-menu button:hover {
        background: #333;
        color: white;
      }
    `
    document.head.appendChild(styles)
  }

  function createExportMenu() {
    const menu = document.createElement('div')
    menu.className = 'export-amp-menu'
    menu.id = 'export-amp-menu'

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
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export Thread
    `

    button.onclick = (e) => {
      e.stopPropagation()
      menu.classList.toggle('visible')
    }

    document.addEventListener('click', (e) => {
      const target = /** @type {Node|null} */ (e.target)
      if (!button.contains(target) && !menu.contains(target)) {
        menu.classList.remove('visible')
      }
    })

    document.body.appendChild(button)
  }

  function extractThreadContent() {
    const messages = []
    const processedTexts = new Set()

    // Find the thread container
    const threadContainer = document.querySelector('[data-thread]')
    if (!threadContainer) {
      console.log('Amp Export: No thread container found')
      return {
        title: document.title,
        url: window.location.href,
        exportedAt: new Date().toISOString(),
        messages,
      }
    }

    // Get all message sections in the thread
    // User messages are typically in sections without data-block-id or with specific patterns
    // Assistant messages have data-block-id and data-block-type attributes
    const allSections = threadContainer.querySelectorAll(':scope > div')

    for (const section of allSections) {
      // Check if this is an assistant message (has data-block-id and data-block-type)
      const blockId = section.getAttribute('data-block-id')
      const blockType = section.getAttribute('data-block-type')

      if (blockId && blockType) {
        // This is an assistant message block
        const content = extractBlockContent(section, blockType)
        if (content && !processedTexts.has(content)) {
          processedTexts.add(content)
          messages.push({
            role: 'Amp',
            type: blockType,
            content: content,
            timestamp: new Date().toISOString(),
          })
        }
      } else {
        // This could be a user message - look for text content
        // User messages are typically the content between assistant blocks
        const textContent = extractUserContent(section)
        if (textContent && !processedTexts.has(textContent)) {
          processedTexts.add(textContent)
          messages.push({
            role: 'You',
            content: textContent,
            timestamp: new Date().toISOString(),
          })
        }
      }
    }

    // Alternative: Look for all blocks with data-block-type
    const allBlocks = threadContainer.querySelectorAll(
      '[data-block-id][data-block-type]',
    )
    for (const block of allBlocks) {
      const blockType = block.getAttribute('data-block-type')
      const content = extractBlockContent(block, blockType || '')
      if (content && !processedTexts.has(content)) {
        processedTexts.add(content)
        messages.push({
          role: 'Amp',
          type: blockType,
          content: content,
          timestamp: new Date().toISOString(),
        })
      }
    }

    return {
      title: document.title.replace(' - Amp', '').trim() || 'Amp Thread',
      url: window.location.href,
      exportedAt: new Date().toISOString(),
      messages,
    }
  }

  function extractBlockContent(block, blockType) {
    // For text blocks, get the markdown content
    const markdownDiv = block.querySelector('.markdown')
    if (markdownDiv) {
      return markdownDiv.innerText?.trim()
    }

    // For tool_use blocks, get the tool information
    if (blockType === 'tool_use') {
      const resourceChip = block.querySelector('.resource-chip')
      if (resourceChip) {
        const toolName = resourceChip.querySelector('a')?.textContent?.trim()
        const toolContent = resourceChip.innerText?.trim()
        return toolName ? `[Tool: ${toolName}]\n${toolContent}` : toolContent
      }
    }

    // For thinking blocks
    if (blockType === 'thinking') {
      const thinkingContent =
        block.querySelector('[data-thinking]')?.textContent?.trim() ||
        block.innerText?.trim()
      return `[Thinking]\n${thinkingContent}`
    }

    // Default: get all text content
    return block.innerText?.trim()
  }

  function extractUserContent(section) {
    // Skip if it has block attributes (assistant content)
    if (section.hasAttribute('data-block-id')) return null

    // Get text content but filter out UI elements
    const text = section.innerText?.trim()
    if (!text) return null

    // Filter out common UI text patterns
    const uiPatterns = [
      'Copy',
      'Link to this block',
      'Workspace',
      'Archived',
      'Run',
      'Accept',
      'Reject',
      'Edit',
    ]

    for (const pattern of uiPatterns) {
      if (text === pattern || text.startsWith(pattern + '\n')) {
        return null
      }
    }

    // Check if it's just UI elements
    if (text.length < 3) return null

    return text
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
    const data = extractThreadContent()
    const text = formatAsText(data)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `amp-thread-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportAsJSON() {
    const data = extractThreadContent()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `amp-thread-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function exportAsPDF() {
    const data = extractThreadContent()

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
    // Wait for the thread to load
    const checkInterval = setInterval(() => {
      // Look for thread container or messages
      const hasThread =
        document.querySelector('[data-thread]') ||
        document.querySelector('[data-block-id]') ||
        document.querySelector('.markdown')

      if (hasThread) {
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
