// ==UserScript==
// @name         Slack Multi-Emoji Upload
// @namespace    https://app.slack.com/
// @version      1.1
// @description  Lets you upload multiple emojis at once to your Slack workspace
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

  const STYLE_ID = 'slack-multi-emoji-upload-styles'
  const PICKER_ID = 'slack-multi-emoji-upload-picker'
  const ACTIONS_ID = 'slack-multi-emoji-upload-actions'
  const STATUS_ID = 'slack-multi-emoji-upload-status'

  /** @type {{running: boolean, cancelled: boolean, total: number, done: number, ok: number, failed: number, current: string}} */
  const state = {
    running: false,
    cancelled: false,
    total: 0,
    done: 0,
    ok: 0,
    failed: 0,
    current: '',
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = /* css */ `
      #${ACTIONS_ID} {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }

      .smu-btn {
        appearance: none;
        border: 1px solid rgba(29, 28, 29, 0.16);
        border-radius: 6px;
        background: #fff;
        color: #1d1c1d;
        padding: 8px 12px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .smu-btn:hover {
        background: #f8f8f8;
      }

      .smu-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .smu-btn--primary {
        background: #611f69;
        border-color: #611f69;
        color: #fff;
      }

      .smu-btn--primary:hover {
        background: #4a154b;
      }

      #${STATUS_ID} {
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(97, 31, 105, 0.07);
        color: #1d1c1d;
        font-size: 13px;
        line-height: 1.4;
      }

      #${STATUS_ID}[data-tone='error'] {
        background: rgba(224, 30, 90, 0.09);
      }

      #${STATUS_ID}[data-tone='success'] {
        background: rgba(46, 182, 125, 0.12);
      }

      .smu-muted {
        opacity: 0.75;
      }
    `

    document.head.appendChild(style)
  }

  /** @returns {HTMLElement | null} */
  function getDialogBody() {
    return /** @type {HTMLElement|null} */ (
      document.querySelector('[data-qa="customize_emoji_add_dialog_body"]')
    )
  }

  /** @returns {HTMLInputElement | null} */
  function getSlackFileInput() {
    return /** @type {HTMLInputElement|null} */ (
      document.querySelector(
        '[data-qa="customize_emoji_add_dialog_file_input"]',
      )
    )
  }

  /** @returns {HTMLInputElement | null} */
  function getNameInput() {
    return /** @type {HTMLInputElement|null} */ (
      document.querySelector('[data-qa="customize_emoji_add_dialog_input"]')
    )
  }

  /** @returns {HTMLButtonElement | null} */
  function getSaveButton() {
    return /** @type {HTMLButtonElement|null} */ (
      document.querySelector('[data-qa="customize_emoji_add_dialog_go"]')
    )
  }

  function isSaveEnabled() {
    const button = getSaveButton()
    if (!button) return false
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true'
  }

  /**
   * @param {string} message
   * @param {'info' | 'error' | 'success'} [tone]
   */
  function setStatus(message, tone = 'info') {
    const status = document.getElementById(STATUS_ID)
    if (!status) return
    status.textContent = message
    status.setAttribute('data-tone', tone)
  }

  /** @param {HTMLElement} body */
  function ensureControls(body) {
    addStyles()

    if (!document.getElementById(PICKER_ID)) {
      const picker = document.createElement('input')
      picker.id = PICKER_ID
      picker.type = 'file'
      picker.accept = 'image/*'
      picker.multiple = true
      picker.style.display = 'none'
      picker.addEventListener('change', async () => {
        const files = Array.from(picker.files || [])
        picker.value = ''
        if (!files.length) return
        await uploadBatch(files)
      })
      document.body.appendChild(picker)
    }

    if (body.querySelector(`#${ACTIONS_ID}`)) return

    const actions = document.createElement('div')
    actions.id = ACTIONS_ID

    const choose = document.createElement('button')
    choose.className = 'smu-btn smu-btn--primary'
    choose.type = 'button'
    choose.textContent = 'Bulk upload images'
    choose.addEventListener('click', () => {
      if (state.running) return
      document.getElementById(PICKER_ID)?.click()
    })

    const cancel = document.createElement('button')
    cancel.className = 'smu-btn'
    cancel.type = 'button'
    cancel.textContent = 'Cancel batch'
    cancel.disabled = true
    cancel.addEventListener('click', () => {
      state.cancelled = true
      setStatus(`Stopping after ${state.current || 'current upload'}…`, 'error')
    })

    const hint = document.createElement('div')
    hint.className = 'smu-muted'
    hint.textContent =
      'Names come from filenames and are sanitized for Slack emoji syntax.'

    const status = document.createElement('div')
    status.id = STATUS_ID
    status.textContent = 'Pick multiple image files to upload them one by one.'

    actions.appendChild(choose)
    actions.appendChild(cancel)
    body.appendChild(actions)
    body.appendChild(hint)
    body.appendChild(status)
  }

  function refreshControls() {
    const body = getDialogBody()
    if (!body) return
    ensureControls(body)

    const choose = /** @type {HTMLButtonElement|null} */ (
      document.querySelector(`#${ACTIONS_ID} .smu-btn--primary`)
    )
    const cancel = /** @type {HTMLButtonElement|null} */ (
      document.querySelector(`#${ACTIONS_ID} .smu-btn:not(.smu-btn--primary)`)
    )

    if (choose) choose.disabled = state.running
    if (cancel) cancel.disabled = !state.running
  }

  /** @param {HTMLInputElement} input @param {string} value */
  function setReactTextInputValue(input, value) {
    const prototype = Object.getPrototypeOf(input)
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /** @param {HTMLInputElement} input @param {File} file */
  function setFileInput(input, file) {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    input.files = dataTransfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /** @param {string} base */
  function makeSlackEmojiName(base) {
    let name = base
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_-]+|[_-]+$/g, '')

    if (!name) name = 'emoji'
    if (!/^[a-z]/.test(name)) name = `emoji_${name}`
    return name.slice(0, 100)
  }

  /** @param {File[]} files */
  function buildUploadPlan(files) {
    const used = new Map()

    return files.map((file) => {
      const bare = file.name.replace(/\.[^.]+$/, '')
      const base = makeSlackEmojiName(bare)
      const count = used.get(base) || 0
      used.set(base, count + 1)
      const name = count === 0 ? base : `${base}_${count + 1}`.slice(0, 100)
      return { file, name }
    })
  }

  /** @param {number} ms */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** @param {() => boolean} predicate @param {{timeout?: number, interval?: number}} [opts] */
  async function waitFor(predicate, opts = {}) {
    const timeout = opts.timeout ?? 10000
    const interval = opts.interval ?? 100
    const start = Date.now()

    while (Date.now() - start < timeout) {
      if (predicate()) return true
      await sleep(interval)
    }

    return false
  }

  function dialogIsOpen() {
    return !!getDialogBody()
  }

  function findOpenDialogButton() {
    const candidates = Array.from(
      document.querySelectorAll('button, a, [role="button"]'),
    )
    return /** @type {HTMLElement | null} */ (
      candidates.find((element) =>
        /add\s+emoji/i.test(element.textContent || ''),
      ) || null
    )
  }

  async function ensureDialogOpen() {
    if (dialogIsOpen()) return true

    const opener = findOpenDialogButton()
    if (!opener) return false
    opener.click()
    return waitFor(() => dialogIsOpen(), { timeout: 5000 })
  }

  function readVisibleErrors() {
    const body = getDialogBody()
    if (!body) return ''

    const texts = Array.from(
      body.querySelectorAll(
        '[role="alert"], [aria-live="polite"], [aria-live="assertive"], .c-form__error, .c-input_note',
      ),
    )
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)

    return texts.join(' | ')
  }

  /** @param {File} file @param {string} emojiName */
  async function uploadOne(file, emojiName) {
    const dialogReady = await ensureDialogOpen()
    if (!dialogReady) {
      throw new Error('Could not find or reopen the Add emoji dialog.')
    }

    const fileInput = getSlackFileInput()
    const nameInput = getNameInput()
    const saveButton = getSaveButton()

    if (!fileInput || !nameInput || !saveButton) {
      throw new Error('Could not find Slack emoji upload controls.')
    }

    setFileInput(fileInput, file)
    await sleep(150)
    setReactTextInputValue(nameInput, emojiName)

    const enabled = await waitFor(() => isSaveEnabled(), {
      timeout: 12000,
      interval: 150,
    })
    if (!enabled) {
      const errorText = readVisibleErrors()
      throw new Error(errorText || 'Slack never enabled the Save button.')
    }

    saveButton.click()

    const completed = await waitFor(
      () => {
        if (!dialogIsOpen()) return true

        const currentNameInput = getNameInput()
        const currentFileInput = getSlackFileInput()
        const currentValue = currentNameInput?.value?.trim() || ''
        const fileCleared =
          !currentFileInput?.files || currentFileInput.files.length === 0
        return !isSaveEnabled() && currentValue !== emojiName && fileCleared
      },
      { timeout: 15000, interval: 200 },
    )

    if (!completed) {
      const errorText = readVisibleErrors()
      throw new Error(
        errorText || 'Timed out waiting for Slack to finish saving.',
      )
    }

    await sleep(400)
  }

  /** @param {File[]} files */
  async function uploadBatch(files) {
    if (state.running) return

    const plan = buildUploadPlan(files)
    state.running = true
    state.cancelled = false
    state.total = plan.length
    state.done = 0
    state.ok = 0
    state.failed = 0
    state.current = ''
    refreshControls()

    setStatus(
      `Uploading ${plan.length} emoji${plan.length === 1 ? '' : 's'}…`,
      'info',
    )

    for (const item of plan) {
      if (state.cancelled) break

      state.current = item.name
      setStatus(
        `Uploading ${state.done + 1}/${state.total}: :${item.name}: (${item.file.name})`,
        'info',
      )

      try {
        await uploadOne(item.file, item.name)
        state.ok += 1
      } catch (error) {
        state.failed += 1
        console.error('Slack Multi-Emoji Upload:', error)
        setStatus(
          `Failed on :${item.name}: — ${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
        await sleep(1200)
      }

      state.done += 1
    }

    const cancelled = state.cancelled
    const summary = cancelled
      ? `Stopped. Uploaded ${state.ok}/${state.total}${state.failed ? `, failed ${state.failed}` : ''}.`
      : state.failed
        ? `Done. Uploaded ${state.ok}/${state.total}, failed ${state.failed}.`
        : `Done. Uploaded all ${state.ok} emoji${state.ok === 1 ? '' : 's'} successfully.`

    state.running = false
    state.cancelled = false
    state.current = ''
    refreshControls()
    setStatus(summary, state.failed ? 'error' : 'success')
  }

  const observer = new MutationObserver(() => {
    refreshControls()
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })

  refreshControls()
})()
