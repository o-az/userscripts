// ==UserScript==
// @name         Scrolling Screenshot
// @namespace    https://github.com/o-az/userscripts
// @version      1.0
// @description  Capture scrolling screenshots of any scrollable area, including nested ones like chats, side panels, and modals. Scroll manually or use auto-scroll, then save as PNG or PDF.
// @author       https://github.com/o-az
// @match        *://*/*
// @homepageURL  https://github.com/o-az/userscripts
// @source       https://github.com/o-az/userscripts/blob/main/src/scrolling-screenshot.user.js
// @downloadURL  https://github.com/o-az/userscripts/blob/main/src/scrolling-screenshot.user.js?raw=true
// @updateURL    https://github.com/o-az/userscripts/blob/main/src/scrolling-screenshot.user.js?raw=true
// @supportURL   https://github.com/o-az/userscripts/issues
// @tag          screenshot
// @tag          scroll
// @tag          capture
// @tag          png
// @tag          pdf
// @license      MIT
// @require      https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/dist/index.js
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  /**
   * @typedef {{
   *   url: string
   *   method?: string
   *   responseType?: 'blob'
   *   anonymous?: boolean
   *   timeout?: number
   *   onload?: (response: { status: number, response: unknown }) => void
   *   onerror?: () => void
   *   ontimeout?: () => void
   * }} GMRequestDetails
   *
   * @typedef {{
   *   domToCanvas: (node: Node, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>
   * }} ModernScreenshot
   *
   * @typedef {{ confirmArea: boolean, autoStop: boolean, scale: number }} Settings
   * @typedef {[number, number]} Interval
   * @typedef {{ blob: Blob, y: number, height: number, offsetPx: number, clips: Interval[] }} Frame
   * @typedef {{ el: Element, top: number }} Anchor
   * @typedef {'idle' | 'armed' | 'confirm' | 'pick' | 'capturing' | 'processing' | 'result'} State
   * @typedef {{ blob: Blob, url: string, width: number, height: number }} Part
   */

  const GLOBAL = /** @type {typeof globalThis & {
    modernScreenshot?: ModernScreenshot
    GM_registerMenuCommand?: (name: string, fn: () => void) => number | string
    GM_unregisterMenuCommand?: (id: number | string) => void
    GM_getValue?: (key: string, defaultValue: string) => string
    GM_setValue?: (key: string, value: string) => void
    GM_xmlhttpRequest?: (details: GMRequestDetails) => void
  }} */ (globalThis)

  const ROOT_ID = 'scrolling-screenshot-root'
  const SETTINGS_KEY = 'scrolling-screenshot.settings.v1'
  const AREAS_KEY = 'scrolling-screenshot.areas.v1'
  // iOS Safari caps canvases at 16,777,216 pixels; other browsers cap a side at ~32k.
  const MAX_CANVAS_AREA = 16_777_216
  const MAX_CANVAS_SIDE = 16_384
  // PDF viewers commonly cap page sides at 14,400pt (200in).
  const MAX_PDF_PAGE_PT = 14_400
  const IDLE_CAPTURE_MS = 140
  const AUTO_STOP_MS = 3000
  const AUTO_SCROLL_STEP = 0.8

  /** @type {Settings} */
  const DEFAULT_SETTINGS = { confirmArea: false, autoStop: true, scale: 0 }

  /* ---------------------------------- storage --------------------------------- */

  /** @param {string} key @param {string} fallback */
  const readValue = (key, fallback) => {
    try {
      return GLOBAL.GM_getValue
        ? GLOBAL.GM_getValue(key, fallback)
        : (localStorage.getItem(key) ?? fallback)
    } catch {
      return fallback
    }
  }

  /** @param {string} key @param {string} value */
  const writeValue = (key, value) => {
    try {
      if (GLOBAL.GM_setValue) GLOBAL.GM_setValue(key, value)
      else localStorage.setItem(key, value)
    } catch {}
  }

  /** @returns {Settings} */
  const loadSettings = () => {
    try {
      return {
        ...DEFAULT_SETTINGS,
        ...JSON.parse(readValue(SETTINGS_KEY, '{}')),
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  let settings = loadSettings()

  /** @param {Partial<Settings>} patch */
  const saveSettings = (patch) => {
    settings = { ...settings, ...patch }
    writeValue(SETTINGS_KEY, JSON.stringify(settings))
  }

  /** @returns {Record<string, string>} */
  const loadAreas = () => {
    try {
      const parsed = JSON.parse(readValue(AREAS_KEY, '{}'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  /** @param {string | null} selector */
  const saveArea = (selector) => {
    const areas = loadAreas()
    if (selector) areas[location.host] = selector
    else delete areas[location.host]
    writeValue(AREAS_KEY, JSON.stringify(areas))
  }

  const outputScale = () =>
    sessionScale ||
    settings.scale ||
    Math.min(2, Math.max(1, window.devicePixelRatio || 1))

  /* ------------------------------ scroll targets ------------------------------ */

  const scrollingElement = () =>
    document.scrollingElement || document.documentElement

  /** @param {Element} el */
  const isDocumentTarget = (el) =>
    el === scrollingElement() ||
    el === document.documentElement ||
    el === document.body

  /** @param {Element} el */
  const isScrollableY = (el) => {
    if (isDocumentTarget(el)) {
      return scrollingElement().scrollHeight > window.innerHeight + 1
    }
    const { overflowY } = getComputedStyle(el)
    return (
      /(auto|scroll|overlay)/.test(overflowY) &&
      el.scrollHeight > el.clientHeight + 1
    )
  }

  /**
   * @param {EventTarget | Node | null} node
   * @returns {Element | null}
   */
  const resolveScrollTarget = (node) => {
    if (!node || node === document) {
      return isScrollableY(scrollingElement()) ? scrollingElement() : null
    }
    let el = node instanceof Element ? node : null
    while (el) {
      if (isDocumentTarget(el)) break
      if (isScrollableY(el)) return el
      el = el.parentElement
    }
    return isScrollableY(scrollingElement()) ? scrollingElement() : null
  }

  /** @param {Element} el */
  const nextScrollableAncestor = (el) => {
    if (isDocumentTarget(el)) return null
    return resolveScrollTarget(el.parentElement)
  }

  /** @param {Element} el */
  const getScrollTop = (el) =>
    isDocumentTarget(el) ? window.scrollY : el.scrollTop

  /** @param {Element} el @param {number} top */
  const setScrollTop = (el, top) => {
    if (isDocumentTarget(el)) window.scrollTo({ top, behavior: 'instant' })
    else el.scrollTo({ top, behavior: 'instant' })
  }

  /** @param {Element} el @returns {[number, number]} */
  const scrollRange = (el) => {
    if (isDocumentTarget(el)) {
      return [
        0,
        Math.max(0, scrollingElement().scrollHeight - window.innerHeight),
      ]
    }
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    // flex column-reverse containers scroll from 0 (bottom) to -max (top).
    return getComputedStyle(el).flexDirection === 'column-reverse'
      ? [-max, 0]
      : [0, max]
  }

  /**
   * Visible client box of the scroll target in viewport coordinates.
   * @param {Element} el
   */
  const viewportOf = (el) => {
    if (isDocumentTarget(el)) {
      const width = document.documentElement.clientWidth
      const height = window.innerHeight
      return { top: 0, left: 0, width, height, bottom: height, right: width }
    }
    const rect = el.getBoundingClientRect()
    const top = rect.top + el.clientTop
    const left = rect.left + el.clientLeft
    return {
      top,
      left,
      width: el.clientWidth,
      height: el.clientHeight,
      bottom: top + el.clientHeight,
      right: left + el.clientWidth,
    }
  }

  /**
   * Height of the target's viewport that renders reliably. The DOM renderer can leave
   * the bottom padding (plus the last child's margin) of a scrolled container blank,
   * so that strip, with some slack, is excluded from each frame.
   * @param {Element} el
   */
  const captureHeightOf = (el) => {
    const { height } = viewportOf(el)
    if (isDocumentTarget(el)) return height
    const padding = Number.parseFloat(getComputedStyle(el).paddingBottom) || 0
    return Math.max(1, height - Math.min(padding + 16, height / 4))
  }

  /** @param {Element} el */
  const backgroundOf = (el) => {
    /** @type {Element | null} */
    let node = el
    while (node) {
      const color = getComputedStyle(node).backgroundColor
      if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) {
        return color
      }
      node = node.parentElement
    }
    return '#ffffff'
  }

  /** @param {Element} el */
  const selectorFor = (el) => {
    if (isDocumentTarget(el)) return ':root'
    /** @type {string[]} */
    const parts = []
    /** @type {Element | null} */
    let node = el
    while (node && node !== document.documentElement) {
      if (
        node.id &&
        document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1
      ) {
        parts.unshift(`#${CSS.escape(node.id)}`)
        break
      }
      let part = node.localName
      const testId = node.getAttribute('data-testid')
      if (testId) part += `[data-testid="${CSS.escape(testId)}"]`
      /** @type {Element | null} */
      const parent = node.parentElement
      const current = node
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (child) => child.localName === current.localName,
        )
        if (sameTag.length > 1)
          part += `:nth-of-type(${sameTag.indexOf(current) + 1})`
      }
      parts.unshift(part)
      node = parent
    }
    return parts.join(' > ')
  }

  const rememberedTarget = () => {
    const selector = loadAreas()[location.host]
    if (!selector) return null
    try {
      const el =
        selector === ':root'
          ? scrollingElement()
          : document.querySelector(selector)
      return el && isScrollableY(el) ? el : null
    } catch {
      return null
    }
  }

  /* ---------------------------------- assets ---------------------------------- */

  /** @type {Map<string, Promise<string | false>>} */
  const assetCache = new Map()

  /** @param {Blob} blob @returns {Promise<string>} */
  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })

  /**
   * Cross-origin images go through GM_xmlhttpRequest to avoid CORS-tainted canvases.
   * @param {string} url
   * @returns {Promise<string | false>}
   */
  const fetchAsset = (url) => {
    const request = GLOBAL.GM_xmlhttpRequest
    if (!request) return Promise.resolve(false)
    try {
      const parsed = new URL(url, location.href)
      if (
        !/^https?:$/.test(parsed.protocol) ||
        parsed.origin === location.origin
      ) {
        return Promise.resolve(false)
      }
    } catch {
      return Promise.resolve(false)
    }
    const cached = assetCache.get(url)
    if (cached) return cached
    /** @type {Promise<string | false>} */
    const pending = new Promise((resolve) => {
      request({
        url,
        method: 'GET',
        responseType: 'blob',
        // No cookies: page-supplied URLs must not get the user's credentials.
        anonymous: true,
        timeout: 15_000,
        onload: (response) => {
          if (response.status >= 400 || !(response.response instanceof Blob)) {
            resolve(false)
            return
          }
          blobToDataUrl(response.response).then(resolve, () => resolve(false))
        },
        onerror: () => resolve(false),
        ontimeout: () => resolve(false),
      })
    })
    assetCache.set(url, pending)
    return pending
  }

  /* ----------------------------------- UI ------------------------------------ */

  const STYLES = /* css */ `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
    }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    .highlight {
      position: fixed;
      pointer-events: none;
      z-index: 1;
      border: 2px solid #2563eb;
      border-radius: 4px;
      transition: background 0.15s ease;
      display: none;
    }
    .highlight[data-mode='tint'] { background: rgba(37, 99, 235, 0.2); }
    .highlight[data-mode='outline'] { border-style: dashed; border-color: rgba(239, 68, 68, 0.8); }
    .catcher {
      position: fixed;
      inset: 0;
      z-index: 2;
      cursor: crosshair;
      display: none;
      background: rgba(0, 0, 0, 0.05);
    }
    .pill, .sheet {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
      z-index: 3;
      max-width: calc(100vw - 16px);
      background: rgba(17, 17, 17, 0.94);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      font-size: 14px;
      line-height: 1.3;
    }
    .pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 8px 8px 12px;
      white-space: nowrap;
    }
    .pill[hidden], .sheet[hidden], .result[hidden], .toast[hidden] { display: none; }
    .sheet {
      width: min(420px, calc(100vw - 16px));
      padding: 14px;
    }
    .sheet p { margin: 0 0 4px; font-weight: 600; }
    .sheet small { display: block; opacity: 0.7; margin-bottom: 12px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .label { overflow: hidden; text-overflow: ellipsis; }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      flex: none;
      animation: pulse 1.2s ease-in-out infinite;
    }
    .dot[data-idle] { background: #a3a3a3; animation: none; }
    .warn { color: #fbbf24; }
    @keyframes pulse { 50% { opacity: 0.35; } }
    button {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.08);
      color: inherit;
      font: inherit;
      font-size: 13px;
      border-radius: 6px;
      padding: 7px 10px;
      cursor: pointer;
      touch-action: manipulation;
    }
    button:active { background: rgba(255, 255, 255, 0.2); }
    button[data-primary] { background: #2563eb; border-color: #2563eb; }
    button[data-danger] { background: #dc2626; border-color: #dc2626; }
    button:disabled { opacity: 0.4; }
    .result {
      position: fixed;
      inset: 0;
      z-index: 4;
      display: flex;
      flex-direction: column;
      background: #0a0a0a;
      color: #fff;
      padding-top: env(safe-area-inset-top, 0px);
    }
    .result header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    }
    .result header .label { flex: 1 1 100%; font-size: 13px; opacity: 0.8; }
    .result .images {
      flex: 1;
      overflow: auto;
      -webkit-overflow-scrolling: touch;
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .result img {
      max-width: min(100%, 720px);
      height: auto;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 2px;
    }
    .toast {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      top: calc(env(safe-area-inset-top, 0px) + 12px);
      z-index: 5;
      background: rgba(17, 17, 17, 0.94);
      color: #fff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      max-width: calc(100vw - 24px);
    }
  `

  /** @type {{ host: HTMLElement, root: ShadowRoot, highlight: HTMLElement, catcher: HTMLElement, pill: HTMLElement, sheet: HTMLElement, result: HTMLElement, toast: HTMLElement } | null} */
  let ui = null

  const ensureUi = () => {
    if (ui?.host.isConnected) return ui
    const host = document.createElement('div')
    host.id = ROOT_ID
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = /* html */ `
      <style>${STYLES}</style>
      <div class="highlight"></div>
      <div class="catcher"></div>
      <div class="pill" hidden></div>
      <div class="sheet" hidden></div>
      <div class="result" hidden></div>
      <div class="toast" hidden></div>
    `
    document.documentElement.append(host)
    /** @param {string} selector */
    const part = (selector) => {
      const el = root.querySelector(selector)
      if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`)
      return el
    }
    ui = {
      host,
      root,
      highlight: part('.highlight'),
      catcher: part('.catcher'),
      pill: part('.pill'),
      sheet: part('.sheet'),
      result: part('.result'),
      toast: part('.toast'),
    }
    root.addEventListener('click', onUiClick)
    ui.catcher.addEventListener('click', onCatcherClick)
    return ui
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let toastTimer
  /** @param {string} message */
  const toast = (message) => {
    const { toast: el } = ensureUi()
    el.textContent = message
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      el.hidden = true
    }, 2600)
  }

  /** @param {string} str */
  const escapeHtml = (str) =>
    str.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

  /** @param {number} px */
  const formatPx = (px) => `${Math.round(px).toLocaleString()} px`

  /* --------------------------------- session ---------------------------------- */

  /** @type {State} */
  let state = 'idle'
  /** @type {Element | null} */
  let target = null
  /** @type {Element | null} */
  let candidate = null
  /** @type {Element[]} */
  let pickStack = []
  /** @type {Frame[]} */
  let frames = []
  /** @type {Interval[]} */
  let coverage = []
  /** @type {Anchor[]} */
  let anchors = []
  let position = 0
  let lastScrollTop = 0
  let busy = false
  let pendingCapture = false
  /** @type {0 | 1 | -1} */
  let autoDirection = 0
  /** @type {0 | 1 | -1} */
  let travelDirection = 0
  let frameWidthPx = 0
  let renderErrors = 0
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let idleTimer
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let edgeTimer
  let updateRaf = 0
  let highlightRaf = 0
  /** @type {MutationObserver | null} */
  let observer = null
  /** @type {Part[]} */
  let parts = []
  let resultInfo = ''
  /** Locked at start so a settings change mid-capture can't mix frame scales. */
  let sessionScale = 0
  /** Bumped on reset so stale async work (stitching, auto-scroll) can bail. */
  let generation = 0
  let autoRun = 0

  const resetSession = () => {
    clearTimeout(idleTimer)
    clearTimeout(edgeTimer)
    cancelAnimationFrame(updateRaf)
    cancelAnimationFrame(highlightRaf)
    observer?.disconnect()
    observer = null
    document.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('keydown', onKeydown, true)
    for (const part of parts) URL.revokeObjectURL(part.url)
    target = null
    candidate = null
    pickStack = []
    frames = []
    coverage = []
    anchors = []
    parts = []
    position = 0
    lastScrollTop = 0
    busy = false
    pendingCapture = false
    autoDirection = 0
    travelDirection = 0
    frameWidthPx = 0
    renderErrors = 0
    updateRaf = 0
    highlightRaf = 0
    sessionScale = 0
    generation++
  }

  /** @param {State} next */
  const setState = (next) => {
    state = next
    render()
  }

  const start = () => {
    if (state !== 'idle') {
      toast('Scrolling screenshot is already running')
      return
    }
    if (!GLOBAL.modernScreenshot) {
      toast('Scrolling Screenshot: rendering library failed to load')
      return
    }
    ensureUi()
    resetSession()
    sessionScale = outputScale()
    candidate = settings.confirmArea ? rememberedTarget() : null
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    })
    document.addEventListener('keydown', onKeydown, true)
    setState('armed')
    trackHighlight()
  }

  const cancel = () => {
    resetSession()
    setState('idle')
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key !== 'Escape') return
    if (state === 'pick') {
      setState(candidate ? 'confirm' : 'armed')
      return
    }
    cancel()
  }

  /** @param {Event} event */
  function onScroll(event) {
    if (state === 'armed' || state === 'confirm') {
      const scrolled = resolveScrollTarget(event.target)
      if (!scrolled) return
      if (!settings.confirmArea) {
        beginCapture(scrolled)
        return
      }
      const remembered = rememberedTarget()
      if (state === 'armed' && remembered === scrolled) {
        beginCapture(scrolled)
        return
      }
      if (candidate !== scrolled || state !== 'confirm') {
        candidate = scrolled
        pickStack = []
        setState('confirm')
      }
      return
    }
    if (state !== 'capturing' || !target) return
    const scrolled = resolveScrollTarget(event.target)
    if (scrolled !== target) return
    scheduleUpdate()
  }

  /** @param {Element} el */
  const beginCapture = (el) => {
    target = el
    candidate = null
    lastScrollTop = getScrollTop(el)
    position = 0
    anchors = sampleAnchors()
    observer = new MutationObserver(() => {
      scheduleUpdate()
    })
    observer.observe(isDocumentTarget(el) ? document.body : el, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    setState('capturing')
    scheduleIdleCapture()
  }

  /* ---------------------------- position tracking ----------------------------- */

  /** @param {Element} el */
  const isPinned = (el) => {
    /** @type {Element | null} */
    let node = el
    while (node && node !== target) {
      const { position: pos } = getComputedStyle(node)
      if (pos === 'fixed' || pos === 'sticky') return true
      node = node.parentElement
    }
    return false
  }

  /** @returns {Anchor[]} */
  const sampleAnchors = () => {
    if (!target) return []
    const vp = viewportOf(target)
    const top = Math.max(vp.top, 0)
    const bottom = Math.min(vp.bottom, window.innerHeight)
    const left = Math.max(vp.left, 0)
    const right = Math.min(vp.right, window.innerWidth)
    if (bottom - top < 4 || right - left < 4) return []
    const isDoc = isDocumentTarget(target)
    /** @type {Anchor[]} */
    const found = []
    const seen = new Set()
    for (const fx of [0.3, 0.7]) {
      for (const fy of [0.15, 0.5, 0.85]) {
        const x = left + (right - left) * fx
        const y = top + (bottom - top) * fy
        for (const el of document.elementsFromPoint(x, y)) {
          if (el === ui?.host || el === target) continue
          if (
            isDoc
              ? el === document.documentElement || el === document.body
              : !target.contains(el)
          ) {
            continue
          }
          if (seen.has(el) || isPinned(el)) break
          seen.add(el)
          found.push({ el, top: el.getBoundingClientRect().top })
          break
        }
      }
    }
    return found
  }

  /** @param {number[]} values */
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }

  /**
   * Tracks the target's viewport top in a coordinate space fixed to its content.
   * Visible elements are used as anchors so content inserted, recycled or resized
   * above the viewport (lazy loading, virtualized lists, late images) doesn't skew it.
   * The scrollTop delta is the fallback when no anchor survived.
   */
  const updatePosition = () => {
    const el = target
    if (!el) return
    const scrollTop = getScrollTop(el)
    let delta = scrollTop - lastScrollTop
    const isDoc = isDocumentTarget(el)
    const deltas = anchors
      .filter(
        (anchor) => anchor.el.isConnected && (isDoc || el.contains(anchor.el)),
      )
      .map((anchor) => anchor.top - anchor.el.getBoundingClientRect().top)
    if (deltas.length) delta = median(deltas)
    if (Math.abs(delta) > 0.5) travelDirection = delta > 0 ? 1 : -1
    position += delta
    lastScrollTop = scrollTop
    anchors = sampleAnchors()
  }

  const scheduleUpdate = () => {
    if (updateRaf) return
    updateRaf = requestAnimationFrame(() => {
      updateRaf = 0
      updatePosition()
      if (!autoDirection) {
        scheduleIdleCapture()
        scheduleEdgeStop()
      }
      renderPill()
    })
  }

  const scheduleIdleCapture = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      void captureIfNeeded()
    }, IDLE_CAPTURE_MS)
  }

  const scheduleEdgeStop = () => {
    clearTimeout(edgeTimer)
    if (!settings.autoStop || !target || frames.length < 2 || !travelDirection)
      return
    const [min, max] = scrollRange(target)
    const scrollTop = getScrollTop(target)
    const atEdge =
      travelDirection > 0 ? scrollTop >= max - 1 : scrollTop <= min + 1
    if (!atEdge) return
    edgeTimer = setTimeout(() => {
      if (state === 'capturing' && !autoDirection && !busy) void finish()
    }, AUTO_STOP_MS)
  }

  /* --------------------------------- coverage --------------------------------- */

  /** @param {Interval[]} intervals @returns {Interval[]} */
  const mergeIntervals = (intervals) => {
    const sorted = [...intervals].sort((a, b) => a[0] - b[0])
    /** @type {Interval[]} */
    const merged = []
    for (const [start, end] of sorted) {
      const last = merged[merged.length - 1]
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
      else merged.push([start, end])
    }
    return merged
  }

  /** @param {Interval} range @returns {Interval[]} */
  const uncovered = ([start, end]) => {
    /** @type {Interval[]} */
    const gaps = []
    let cursor = start
    for (const [cStart, cEnd] of coverage) {
      if (cEnd <= cursor) continue
      if (cStart >= end) break
      if (cStart > cursor) gaps.push([cursor, Math.min(cStart, end)])
      cursor = Math.max(cursor, cEnd)
      if (cursor >= end) break
    }
    if (cursor < end) gaps.push([cursor, end])
    return gaps.filter(([a, b]) => b - a >= 2)
  }

  /* --------------------------------- capture ---------------------------------- */

  /** @param {Element} el */
  const makeFilter = (el) => {
    const isDoc = isDocumentTarget(el)
    const vp = viewportOf(el)
    const margin = vp.height * 0.5
    /** @type {Map<Element, boolean>} */
    const reverseCache = new Map()
    /** @param {Element} node @returns {boolean} */
    const isInsideReverse = (node) => {
      const parent = node.parentElement
      if (!parent) return false
      const cached = reverseCache.get(parent)
      if (cached !== undefined) return cached
      const result =
        getComputedStyle(parent).flexDirection.endsWith('reverse') ||
        (parent !== el && isInsideReverse(parent))
      reverseCache.set(parent, result)
      return result
    }
    /** @param {Node} node */
    return (node) => {
      if (!(node instanceof Element)) return true
      if (node === ui?.host || node.id === ROOT_ID) return false
      const style = getComputedStyle(node)
      if (isDoc && style.position === 'fixed') return false
      const rect = node.getBoundingClientRect()
      if (!rect.width && !rect.height) return true
      const above = rect.bottom < vp.top - margin
      const below = rect.top > vp.bottom + margin
      if (!above && !below) return true
      // Skipping out-of-flow nodes never shifts layout, so they are always safe to drop.
      if (style.position === 'absolute' || style.position === 'fixed')
        return false
      // In-flow nodes below the viewport only affect layout after them, unless an
      // ancestor stacks from the bottom (column-reverse), where they shift everything.
      return !below || isInsideReverse(node)
    }
  }

  /** @param {HTMLCanvasElement} canvas @param {string} type @param {number} [quality] @returns {Promise<Blob>} */
  const canvasToBlob = (canvas, type, quality) =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Canvas export failed')),
        type,
        quality,
      )
    })

  /** @param {Element} el @param {() => void} [onCloned] */
  const renderViewport = async (el, onCloned) => {
    const lib = GLOBAL.modernScreenshot
    if (!lib) throw new Error('modern-screenshot is not loaded')
    const isDoc = isDocumentTarget(el)
    /** @type {Record<string, unknown>} */
    const options = {
      scale: outputScale(),
      backgroundColor: backgroundOf(el),
      filter: makeFilter(el),
      fetchFn: fetchAsset,
      timeout: 10_000,
      features: { restoreScrollPosition: true },
      onCloneNode: onCloned,
    }
    if (isDoc) {
      options.width = document.documentElement.clientWidth
      options.height = window.innerHeight
      options.style = { overflow: 'hidden' }
    }
    return lib.domToCanvas(isDoc ? document.documentElement : el, options)
  }

  const captureIfNeeded = async () => {
    if (state !== 'capturing' || !target) return
    if (busy) {
      pendingCapture = true
      return
    }
    updatePosition()
    const height = captureHeightOf(target)
    const before = position
    // The renderer's first row can come out blank; skip it unless it's the real top.
    const atTop = getScrollTop(target) <= scrollRange(target)[0] + 1
    const range = /** @type {Interval} */ ([
      before + (atTop || isDocumentTarget(target) ? 0 : 2),
      before + height,
    ])
    if (!uncovered(range).length) return
    busy = true
    pendingCapture = false
    renderPill()
    try {
      // The scroll position is baked in when the DOM is cloned, so only scrolling
      // during the (synchronous) clone can tear a frame, not the slower raster step.
      let clonedAt = before
      const canvas = await renderViewport(target, () => {
        updatePosition()
        clonedAt = position
      })
      updatePosition()
      if (state !== 'capturing') return
      if (Math.abs(clonedAt - before) > 1) {
        // Scrolled mid-render, so the frame may be torn. Retry once scrolling settles.
        pendingCapture = true
        return
      }
      const scale =
        canvas.width /
        (viewportOf(target).width +
          (isDocumentTarget(target) ? 0 : target.clientLeft * 2) || 1)
      const offsetPx = isDocumentTarget(target)
        ? 0
        : Math.round(target.clientTop * scale)
      const clips = uncovered(range)
      frameWidthPx = frameWidthPx || canvas.width
      const blob = await canvasToBlob(canvas, 'image/png')
      canvas.width = 0
      canvas.height = 0
      frames.push({ blob, y: before, height, offsetPx, clips })
      coverage = mergeIntervals([...coverage, range])
    } catch (error) {
      renderErrors++
      console.error('[scrolling-screenshot] capture failed', error)
      if (renderErrors === 3)
        toast('Capture keeps failing on this page. See console.')
    } finally {
      busy = false
      renderPill()
      if (pendingCapture && state === 'capturing' && !autoDirection)
        scheduleIdleCapture()
    }
  }

  /** @param {number} ms */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve))

  /** Waits for the DOM inside the target to stop changing (lazy loading, layout). */
  const settle = async (quietMs = 200, maxMs = 1500) => {
    await nextFrame()
    await nextFrame()
    const startedAt = Date.now()
    let lastMutation = Date.now()
    const watcher = new MutationObserver(() => {
      lastMutation = Date.now()
    })
    if (target) {
      watcher.observe(isDocumentTarget(target) ? document.body : target, {
        childList: true,
        subtree: true,
        attributes: true,
      })
    }
    while (
      Date.now() - lastMutation < quietMs &&
      Date.now() - startedAt < maxMs
    ) {
      await sleep(50)
    }
    watcher.disconnect()
  }

  /**
   * Content that grew above/below the viewport mid-step (e.g. late-loading images)
   * can make a step overshoot the captured area, so scroll back to overlap it.
   * @param {1 | -1} direction
   */
  const closeGap = async (direction) => {
    if (!target || !coverage.length) return
    const height = captureHeightOf(target)
    const start = coverage[0]?.[0] ?? 0
    const end = coverage[coverage.length - 1]?.[1] ?? 0
    const gap = direction < 0 ? start - (position + height) : position - end
    if (gap <= 0) return
    setScrollTop(target, getScrollTop(target) - (gap + 8) * direction)
    await settle()
    updatePosition()
  }

  /** @param {1 | -1} direction */
  const runAutoScroll = async (direction) => {
    if (!target) return
    clearTimeout(idleTimer)
    clearTimeout(edgeTimer)
    const run = ++autoRun
    autoDirection = direction
    renderPill()
    while (
      run === autoRun &&
      autoDirection === direction &&
      state === 'capturing' &&
      target
    ) {
      while (busy) await sleep(50)
      await captureIfNeeded()
      if (
        run !== autoRun ||
        autoDirection !== direction ||
        state !== 'capturing'
      )
        break
      const step = captureHeightOf(target) * AUTO_SCROLL_STEP * direction
      const before = getScrollTop(target)
      const heightBefore = target.scrollHeight
      setScrollTop(target, before + step)
      await settle()
      updatePosition()
      await closeGap(direction)
      if (Math.abs(getScrollTop(target) - before) >= 1) continue
      // At an edge: give lazy loaders a moment to append more content.
      const waitStart = Date.now()
      while (
        Date.now() - waitStart < 2000 &&
        target.scrollHeight === heightBefore
      ) {
        await sleep(100)
      }
      await settle()
      setScrollTop(target, getScrollTop(target) + step)
      await settle()
      updatePosition()
      if (Math.abs(getScrollTop(target) - before) >= 1) continue
      await captureIfNeeded()
      if (run !== autoRun) return
      autoDirection = 0
      if (settings.autoStop && state === 'capturing') {
        await finish()
        return
      }
    }
    if (run !== autoRun) return
    autoDirection = 0
    renderPill()
  }

  /* --------------------------------- stitching -------------------------------- */

  /** @param {number} width @param {number} height */
  const createCanvas = (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  /** @param {HTMLCanvasElement} canvas */
  const context2d = (canvas) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    return ctx
  }

  const stitch = async () => {
    if (!frames.length || !target) return []
    const scale = outputScale()
    const minY = coverage[0]?.[0] ?? 0
    const maxY = coverage[coverage.length - 1]?.[1] ?? 0
    const width = frameWidthPx
    const totalHeight = Math.round((maxY - minY) * scale)
    const maxPartHeight = Math.min(
      MAX_CANVAS_SIDE,
      Math.floor(MAX_CANVAS_AREA / width),
    )
    const background = backgroundOf(target)
    /** @type {Part[]} */
    const result = []
    for (let partTop = 0; partTop < totalHeight; partTop += maxPartHeight) {
      const partHeight = Math.min(maxPartHeight, totalHeight - partTop)
      const canvas = createCanvas(width, partHeight)
      const ctx = context2d(canvas)
      ctx.fillStyle = background
      ctx.fillRect(0, 0, width, partHeight)
      for (const frame of frames) {
        const relevant = frame.clips
          .map(
            ([a, b]) =>
              /** @type {Interval} */ ([
                Math.round((a - minY) * scale),
                Math.round((b - minY) * scale),
              ]),
          )
          .map(
            ([a, b]) =>
              /** @type {Interval} */ ([
                Math.max(a, partTop),
                Math.min(b, partTop + partHeight),
              ]),
          )
          .filter(([a, b]) => b > a)
        if (!relevant.length) continue
        const bitmap = await createImageBitmap(frame.blob)
        const frameTop = Math.round((frame.y - minY) * scale)
        for (const [a, b] of relevant) {
          ctx.drawImage(
            bitmap,
            0,
            frame.offsetPx + (a - frameTop),
            bitmap.width,
            b - a,
            0,
            a - partTop,
            width,
            b - a,
          )
        }
        bitmap.close()
      }
      const blob = await canvasToBlob(canvas, 'image/png')
      result.push({
        blob,
        url: URL.createObjectURL(blob),
        width,
        height: partHeight,
      })
      canvas.width = 0
      canvas.height = 0
    }
    return result
  }

  const finish = async () => {
    if (state !== 'capturing') return
    autoDirection = 0
    clearTimeout(idleTimer)
    clearTimeout(edgeTimer)
    while (busy) await sleep(50)
    await captureIfNeeded()
    observer?.disconnect()
    document.removeEventListener('scroll', onScroll, true)
    if (!frames.length) {
      toast('Nothing captured')
      cancel()
      return
    }
    setState('processing')
    try {
      const minY = coverage[0]?.[0] ?? 0
      const maxY = coverage[coverage.length - 1]?.[1] ?? 0
      const gaps = uncovered([minY, maxY]).length
      const session = generation
      const stitched = await stitch()
      if (session !== generation) {
        for (const part of stitched) URL.revokeObjectURL(part.url)
        return
      }
      parts = stitched
      const first = parts[0]
      const totalHeight = parts.reduce((sum, part) => sum + part.height, 0)
      resultInfo = [
        first ? `${first.width} × ${totalHeight.toLocaleString()} px` : '',
        `${frames.length} frame${frames.length === 1 ? '' : 's'}`,
        parts.length > 1 ? `${parts.length} images (canvas size limit)` : '',
        gaps ? `${gaps} gap${gaps === 1 ? '' : 's'} (scrolled too fast)` : '',
      ]
        .filter(Boolean)
        .join(' · ')
      frames = []
      setState('result')
    } catch (error) {
      console.error('[scrolling-screenshot] stitching failed', error)
      toast('Stitching failed. See console.')
      cancel()
    }
  }

  /* ---------------------------------- export ---------------------------------- */

  const fileStem = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return `scrolling-screenshot-${location.host.replace(/[^\w.-]/g, '')}-${stamp}`
  }

  /** @param {Blob} blob @param {string} name */
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  /** @param {string} stem */
  const pngFiles = (stem) =>
    parts.map(
      (part, index) =>
        new File(
          [part.blob],
          parts.length > 1 ? `${stem}-${index + 1}.png` : `${stem}.png`,
          {
            type: 'image/png',
          },
        ),
    )

  /**
   * Minimal PDF writer: each page is one JPEG slice, sized at 0.75pt per CSS pixel.
   * @param {Array<{ jpeg: Uint8Array, widthPx: number, heightPx: number, widthPt: number, heightPt: number }>} pages
   */
  const buildPdf = (pages) => {
    const encoder = new TextEncoder()
    /** @type {Uint8Array[]} */
    const chunks = []
    /** @type {number[]} */
    const offsets = []
    let length = 0
    /** @param {string | Uint8Array} data */
    const push = (data) => {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data
      chunks.push(bytes)
      length += bytes.length
    }
    /** @param {number} id @param {string} body @param {Uint8Array} [stream] */
    const object = (id, body, stream) => {
      offsets[id] = length
      push(`${id} 0 obj\n${body}\n`)
      if (stream) {
        push('stream\n')
        push(stream)
        push('\nendstream\n')
      }
      push('endobj\n')
    }
    push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
    const pageIds = pages.map((_, index) => 3 + index * 3)
    object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    object(
      2,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    )
    pages.forEach((page, index) => {
      const pageId = 3 + index * 3
      const contentId = pageId + 1
      const imageId = pageId + 2
      const w = page.widthPt.toFixed(2)
      const h = page.heightPt.toFixed(2)
      const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`)
      object(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      )
      object(contentId, `<< /Length ${content.length} >>`, content)
      object(
        imageId,
        `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
        page.jpeg,
      )
    })
    const objectCount = 3 + pages.length * 3
    const xrefOffset = length
    push(`xref\n0 ${objectCount}\n0000000000 65535 f \n`)
    for (let id = 1; id < objectCount; id++) {
      push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`)
    }
    push(
      `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    )
    return new Blob(/** @type {BlobPart[]} */ (chunks), {
      type: 'application/pdf',
    })
  }

  const exportPdf = async () => {
    const scale = outputScale()
    const maxPageHeightPx = Math.floor((MAX_PDF_PAGE_PT / 0.75) * scale)
    /** @type {Parameters<typeof buildPdf>[0]} */
    const pages = []
    for (const part of parts) {
      const bitmap = await createImageBitmap(part.blob)
      for (let top = 0; top < part.height; top += maxPageHeightPx) {
        const heightPx = Math.min(maxPageHeightPx, part.height - top)
        const canvas = createCanvas(part.width, heightPx)
        const ctx = context2d(canvas)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, part.width, heightPx)
        ctx.drawImage(
          bitmap,
          0,
          top,
          part.width,
          heightPx,
          0,
          0,
          part.width,
          heightPx,
        )
        const jpeg = new Uint8Array(
          await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer(),
        )
        pages.push({
          jpeg,
          widthPx: part.width,
          heightPx,
          widthPt: (part.width / scale) * 0.75,
          heightPt: (heightPx / scale) * 0.75,
        })
        canvas.width = 0
        canvas.height = 0
      }
      bitmap.close()
    }
    return buildPdf(pages)
  }

  /** @param {string} action */
  const runResultAction = async (action) => {
    const stem = fileStem()
    if (action === 'png') {
      for (const file of pngFiles(stem)) download(file, file.name)
      return
    }
    if (action.startsWith('png:')) {
      const file = pngFiles(stem)[Number(action.slice(4))]
      if (file) download(file, file.name)
      return
    }
    if (action === 'pdf') {
      toast('Building PDF…')
      download(await exportPdf(), `${stem}.pdf`)
      return
    }
    if (action === 'share') {
      const files = pngFiles(stem)
      try {
        await navigator.share({ files })
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          toast('Sharing failed')
        }
      }
      return
    }
    if (action === 'copy') {
      const part = parts[0]
      if (!part) return
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': part.blob }),
        ])
        toast('Copied image')
      } catch {
        toast('Copy failed')
      }
    }
  }

  /* --------------------------------- rendering -------------------------------- */

  const trackHighlight = () => {
    cancelAnimationFrame(highlightRaf)
    const tick = () => {
      if (state === 'idle' || state === 'result') return
      positionHighlight()
      highlightRaf = requestAnimationFrame(tick)
    }
    highlightRaf = requestAnimationFrame(tick)
  }

  const positionHighlight = () => {
    if (!ui) return
    const el =
      state === 'confirm' || state === 'pick' || state === 'armed'
        ? candidate
        : target
    const { highlight } = ui
    if (!el || state === 'processing') {
      highlight.style.display = 'none'
      return
    }
    const vp = viewportOf(el)
    const top = Math.max(vp.top, 0)
    const left = Math.max(vp.left, 0)
    const bottom = Math.min(vp.bottom, window.innerHeight)
    const right = Math.min(vp.right, window.innerWidth)
    highlight.dataset.mode = state === 'capturing' ? 'outline' : 'tint'
    Object.assign(highlight.style, {
      display: 'block',
      top: `${top}px`,
      left: `${left}px`,
      width: `${Math.max(0, right - left)}px`,
      height: `${Math.max(0, bottom - top)}px`,
    })
  }

  const renderPill = () => {
    if (!ui) return
    const { pill } = ui
    if (state === 'armed') {
      pill.hidden = false
      pill.innerHTML = /* html */ `
        <span class="dot" data-idle></span>
        <span class="label">Scroll the area to capture</span>
        <button data-action="pick">Pick area</button>
        <button data-action="cancel" aria-label="Cancel">✕</button>
      `
      return
    }
    if (state === 'capturing') {
      const covered = coverage.reduce((sum, [a, b]) => sum + (b - a), 0)
      const hasGap = coverage.length > 1
      const status = hasGap
        ? '<span class="label warn">Gap: scroll back slower</span>'
        : `<span class="label">${frames.length} · ${formatPx(covered)}${busy ? ' …' : ''}</span>`
      const autoButtons = autoDirection
        ? '<button data-action="auto-stop">Pause</button>'
        : '<button data-action="auto-up" aria-label="Auto-scroll up">Auto ↑</button><button data-action="auto-down" aria-label="Auto-scroll down">Auto ↓</button>'
      pill.hidden = false
      pill.innerHTML = /* html */ `
        <span class="dot"></span>
        ${status}
        ${autoButtons}
        <button data-action="stop" data-danger>Stop</button>
        <button data-action="cancel" aria-label="Cancel">✕</button>
      `
      return
    }
    if (state === 'processing') {
      pill.hidden = false
      pill.innerHTML =
        '<span class="dot" data-idle></span><span class="label">Stitching…</span>'
      return
    }
    pill.hidden = true
    pill.innerHTML = ''
  }

  const renderSheet = () => {
    if (!ui) return
    const { sheet, catcher } = ui
    catcher.style.display = state === 'pick' ? 'block' : 'none'
    if (state === 'confirm' && candidate) {
      const contentHeight = isDocumentTarget(candidate)
        ? scrollingElement().scrollHeight
        : candidate.scrollHeight
      sheet.hidden = false
      sheet.innerHTML = /* html */ `
        <p>Capture this area?</p>
        <small>This is the scrolling area that will be captured (${escapeHtml(formatPx(contentHeight))} of content loaded).</small>
        <div class="row">
          <button data-action="use" data-primary>Use this</button>
          <button data-action="pick">Pick another</button>
          <button data-action="cancel">Cancel</button>
        </div>
      `
      return
    }
    if (state === 'pick') {
      sheet.hidden = false
      sheet.innerHTML = /* html */ `
        <p>${candidate ? 'Selected area' : 'Tap the area to capture'}</p>
        <small>${candidate ? 'Adjust the selection or tap somewhere else.' : 'The nearest scrollable area around your tap gets selected.'}</small>
        <div class="row">
          <button data-action="bigger" ${candidate && nextScrollableAncestor(candidate) ? '' : 'disabled'}>↑ Bigger</button>
          <button data-action="smaller" ${pickStack.length ? '' : 'disabled'}>↓ Smaller</button>
          <button data-action="use" data-primary ${candidate ? '' : 'disabled'}>Use this</button>
          <button data-action="cancel">Cancel</button>
        </div>
      `
      return
    }
    sheet.hidden = true
    sheet.innerHTML = ''
  }

  const renderResult = () => {
    if (!ui) return
    const { result } = ui
    if (state !== 'result') {
      result.hidden = true
      result.innerHTML = ''
      return
    }
    const canShare =
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: pngFiles('check') })
    const canCopy =
      parts.length === 1 &&
      typeof ClipboardItem !== 'undefined' &&
      !!navigator.clipboard?.write
    result.hidden = false
    result.innerHTML = /* html */ `
      <header>
        <span class="label">${escapeHtml(resultInfo)}</span>
        ${
          // Safari drops all but the last of several downloads started by one tap.
          parts.length > 1
            ? parts
                .map(
                  (_, index) =>
                    `<button data-action="png:${index}"${index ? '' : ' data-primary'}>Save PNG ${index + 1}/${parts.length}</button>`,
                )
                .join('')
            : '<button data-action="png" data-primary>Save PNG</button>'
        }
        <button data-action="pdf">Save PDF</button>
        ${canShare ? '<button data-action="share">Share</button>' : ''}
        ${canCopy ? '<button data-action="copy">Copy</button>' : ''}
        <button data-action="close">Close</button>
      </header>
      <div class="images">
        ${parts.map((part, index) => `<img src="${part.url}" alt="Scrolling screenshot part ${index + 1}" width="${part.width}" height="${part.height}">`).join('')}
      </div>
    `
  }

  const render = () => {
    if (!ui) return
    if (state === 'idle') {
      ui.highlight.style.display = 'none'
      ui.catcher.style.display = 'none'
    }
    renderPill()
    renderSheet()
    renderResult()
    positionHighlight()
  }

  /** @param {Event} event */
  function onUiClick(event) {
    const button =
      event.target instanceof Element
        ? event.target.closest('button[data-action]')
        : null
    if (!(button instanceof HTMLButtonElement) || button.disabled) return
    const action = button.dataset.action ?? ''
    switch (action) {
      case 'cancel':
        if (
          state === 'pick' &&
          candidate &&
          pickStack.length === 0 &&
          target === null
        ) {
          cancel()
          return
        }
        cancel()
        return
      case 'pick':
        setState('pick')
        return
      case 'use':
        if (!candidate) return
        saveArea(selectorFor(candidate))
        beginCapture(candidate)
        return
      case 'bigger': {
        if (!candidate) return
        const parent = nextScrollableAncestor(candidate)
        if (!parent) return
        pickStack.push(candidate)
        candidate = parent
        render()
        return
      }
      case 'smaller': {
        const previous = pickStack.pop()
        if (previous) candidate = previous
        render()
        return
      }
      case 'auto-up':
        void runAutoScroll(-1)
        return
      case 'auto-down':
        void runAutoScroll(1)
        return
      case 'auto-stop':
        autoDirection = 0
        renderPill()
        return
      case 'stop':
        void finish()
        return
      case 'close':
        cancel()
        return
      default:
        void runResultAction(action)
    }
  }

  /** @param {Element} el */
  const paintsBackground = (el) => {
    const style = getComputedStyle(el)
    const alpha = style.backgroundColor.match(/[\d.]+/g)?.[3]
    return (
      (style.backgroundColor !== 'transparent' && alpha !== '0') ||
      style.backgroundImage !== 'none' ||
      (style.backdropFilter || 'none') !== 'none'
    )
  }

  /**
   * The innermost scrollable area at a point. Sites often put the visible content of
   * a scroller in a sibling layer on top of it (X's chat does), so the elements under
   * the point aren't always inside the scroller; fall back to geometry.
   * @param {number} x @param {number} y
   */
  const scrollableAt = (x, y) => {
    const hits = document
      .elementsFromPoint(x, y)
      .filter((el) => el !== ui?.host)
    for (const hit of hits) {
      const found = resolveScrollTarget(hit)
      if (found && !isDocumentTarget(found)) return found
      // Only see through layers that don't paint over what's beneath (e.g. not modals).
      if (paintsBackground(hit)) return found
    }
    /** @type {Element | null} */
    let best = null
    let bestArea = Number.POSITIVE_INFINITY
    for (const el of document.body.querySelectorAll('*')) {
      if (el === ui?.host) continue
      const rect = el.getBoundingClientRect()
      const area = rect.width * rect.height
      if (
        area >= bestArea ||
        x < rect.left ||
        x > rect.right ||
        y < rect.top ||
        y > rect.bottom ||
        !isScrollableY(el)
      )
        continue
      best = el
      bestArea = area
    }
    if (best) return best
    return isScrollableY(scrollingElement()) ? scrollingElement() : null
  }

  /** @param {MouseEvent} event */
  function onCatcherClick(event) {
    if (!ui) return
    ui.catcher.style.display = 'none'
    const scrollable = scrollableAt(event.clientX, event.clientY)
    ui.catcher.style.display = 'block'
    if (!scrollable) {
      toast('No scrollable area there')
      return
    }
    candidate = scrollable
    pickStack = []
    render()
  }

  /* ----------------------------------- menu ----------------------------------- */

  /** @type {Array<number | string>} */
  let menuIds = []

  const registerMenu = () => {
    const registerCommand = GLOBAL.GM_registerMenuCommand
    if (!registerCommand) return false
    const unregister = GLOBAL.GM_unregisterMenuCommand
    if (unregister) for (const id of menuIds) unregister(id)
    else if (menuIds.length) return true
    const scaleLabel = settings.scale
      ? `${settings.scale}x`
      : `Auto (${outputScale()}x)`
    menuIds = [
      registerCommand('Start scrolling screenshot', start),
      registerCommand(
        `Confirm area prompt: ${settings.confirmArea ? 'On' : 'Off'}`,
        () => {
          saveSettings({ confirmArea: !settings.confirmArea })
          toast(`Confirm area prompt ${settings.confirmArea ? 'on' : 'off'}`)
          registerMenu()
        },
      ),
      registerCommand(
        `Auto-stop at end: ${settings.autoStop ? 'On' : 'Off'}`,
        () => {
          saveSettings({ autoStop: !settings.autoStop })
          toast(`Auto-stop at end ${settings.autoStop ? 'on' : 'off'}`)
          registerMenu()
        },
      ),
      registerCommand(`Output scale: ${scaleLabel}`, () => {
        const order = [0, 1, 2, 3]
        const next =
          order[(order.indexOf(settings.scale) + 1) % order.length] ?? 0
        saveSettings({ scale: next })
        toast(`Output scale: ${next ? `${next}x` : `Auto (${outputScale()}x)`}`)
        registerMenu()
      }),
      registerCommand('Forget remembered area for this site', () => {
        saveArea(null)
        toast(`Forgot remembered area for ${location.host}`)
      }),
    ]
    return true
  }

  if (!registerMenu()) {
    console.info(
      '[scrolling-screenshot] GM_registerMenuCommand unavailable; menu disabled',
    )
  }
})()
