// ==UserScript==
// @name         Switch User Agent
// @namespace    https://github.com/o-az/userscripts
// @version      1.0
// @description  Spoof navigator user-agent values for configured websites. Includes lobste.rs by default and exposes SwitchUserAgent helpers in the console for adding more rules.
// @author       https://github.com/o-az
// @match        *://*/*
// @homepageURL  https://github.com/o-az/userscripts
// @supportURL   https://github.com/o-az/userscripts/issues
// @license      MIT
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

;(() => {
  'use strict'

  const STORAGE_KEY = 'switch-user-agent.rules.v1'
  const GLOBAL = /** @type {typeof globalThis & {
    unsafeWindow?: Window
    GM_getValue?: (key: string, defaultValue: string) => string
    GM_setValue?: (key: string, value: string) => void
  }} */ (globalThis)
  const PAGE = GLOBAL.unsafeWindow || window
  const CHROME_120_WINDOWS_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  /**
   * Built-in rules live in the userscript so they work before any page scripts run.
   *
   * Add more sites here when you want the rule to be synced with the userscript:
   * { name: 'Example', hostnames: ['example.com', '*.example.com'], userAgent: CHROME_120_WINDOWS_UA }
   */
  const DEFAULT_RULES = [
    {
      name: 'Lobsters',
      hostnames: ['lobste.rs', 'www.lobste.rs'],
      userAgent: CHROME_120_WINDOWS_UA,
      platform: 'Win32',
      vendor: 'Google Inc.',
    },
  ]

  const getStoredRules = () => {
    try {
      const raw = GLOBAL.GM_getValue
        ? GLOBAL.GM_getValue(STORAGE_KEY, '[]')
        : localStorage.getItem(STORAGE_KEY) || '[]'
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /** @param {Array<Record<string, unknown>>} rules */
  const setStoredRules = (rules) => {
    const serializedRules = JSON.stringify(rules, null, 2)

    if (GLOBAL.GM_setValue) {
      GLOBAL.GM_setValue(STORAGE_KEY, serializedRules)
      return
    }

    localStorage.setItem(STORAGE_KEY, serializedRules)
  }

  const getRules = () => [...DEFAULT_RULES, ...getStoredRules()]

  /** @param {string} pattern */
  const hostnameMatches = (pattern) => {
    const hostname = location.hostname.toLowerCase()
    const normalizedPattern = pattern.toLowerCase()

    if (normalizedPattern.startsWith('*.')) {
      const suffix = normalizedPattern.slice(2)
      return hostname === suffix || hostname.endsWith(`.${suffix}`)
    }

    return hostname === normalizedPattern
  }

  /** @param {Record<string, unknown>} rule */
  const ruleMatches = (rule) => {
    const hostnames = Array.isArray(rule.hostnames)
      ? rule.hostnames
      : rule.hostname
        ? [rule.hostname]
        : []

    const hostMatch = hostnames.some(
      (hostname) => typeof hostname === 'string' && hostnameMatches(hostname),
    )

    if (!hostMatch) return false

    if (typeof rule.pathnamePrefix === 'string') {
      return location.pathname.startsWith(rule.pathnamePrefix)
    }

    if (typeof rule.hrefPattern === 'string') {
      return new RegExp(rule.hrefPattern).test(location.href)
    }

    return true
  }

  /** @param {Record<string, unknown>} rule */
  const getUserAgentData = (rule) => ({
    brands: [
      { brand: 'Not A(Brand', version: '99' },
      { brand: 'Google Chrome', version: '120' },
      { brand: 'Chromium', version: '120' },
    ],
    mobile: false,
    platform: typeof rule.uaPlatform === 'string' ? rule.uaPlatform : 'Windows',
    getHighEntropyValues: async (/** @type {string[]} */ hints) => {
      const values = {
        architecture: 'x86',
        bitness: '64',
        brands: [
          { brand: 'Not A(Brand', version: '99' },
          { brand: 'Google Chrome', version: '120' },
          { brand: 'Chromium', version: '120' },
        ],
        fullVersionList: [
          { brand: 'Not A(Brand', version: '99.0.0.0' },
          { brand: 'Google Chrome', version: '120.0.0.0' },
          { brand: 'Chromium', version: '120.0.0.0' },
        ],
        mobile: false,
        model: '',
        platform:
          typeof rule.uaPlatform === 'string' ? rule.uaPlatform : 'Windows',
        platformVersion: '10.0.0',
        uaFullVersion: '120.0.0.0',
        wow64: false,
      }

      const typedValues = /** @type {Record<string, unknown>} */ (values)

      return Object.fromEntries(
        hints
          .filter((hint) => Object.hasOwn(typedValues, hint))
          .map((hint) => [hint, typedValues[hint]]),
      )
    },
    toJSON() {
      return {
        brands: this.brands,
        mobile: this.mobile,
        platform: this.platform,
      }
    },
  })

  /**
   * @param {object} target
   * @param {string} property
   * @param {unknown} value
   */
  const defineNavigatorGetter = (target, property, value) => {
    try {
      Object.defineProperty(target, property, {
        configurable: true,
        enumerable: true,
        get: () => value,
      })
    } catch {
      // Some browsers expose non-configurable navigator properties. Try the next target.
    }
  }

  /** @param {Record<string, unknown>} rule */
  const applyRule = (rule) => {
    if (typeof rule.userAgent !== 'string') return

    const navigatorPrototype = Object.getPrototypeOf(PAGE.navigator)
    const properties = {
      userAgent: rule.userAgent,
      appVersion: rule.userAgent.replace(/^Mozilla\//, ''),
      platform: typeof rule.platform === 'string' ? rule.platform : 'Win32',
      vendor: typeof rule.vendor === 'string' ? rule.vendor : 'Google Inc.',
      userAgentData: getUserAgentData(rule),
    }

    for (const [property, value] of Object.entries(properties)) {
      defineNavigatorGetter(navigatorPrototype, property, value)
      defineNavigatorGetter(PAGE.navigator, property, value)
    }

    console.info(
      '[Switch User Agent] Active rule:',
      rule.name || rule.hostnames,
    )
    console.info(
      '[Switch User Agent] navigator.userAgent:',
      PAGE.navigator.userAgent,
    )
  }

  const activeRule = getRules().find(ruleMatches)
  if (activeRule) applyRule(activeRule)

  const api = {
    currentRule: activeRule || null,
    listRules: getRules,
    listCustomRules: getStoredRules,
    saveCustomRules: setStoredRules,
    /** @param {Record<string, unknown>} rule */
    addRule(rule) {
      const customRules = getStoredRules()
      customRules.push(rule)
      setStoredRules(customRules)
      return customRules
    },
    /** @param {string} nameOrHostname */
    removeRule(nameOrHostname) {
      const customRules = getStoredRules().filter((rule) => {
        const hostnames = Array.isArray(rule.hostnames)
          ? rule.hostnames
          : rule.hostname
            ? [rule.hostname]
            : []

        return (
          rule.name !== nameOrHostname && !hostnames.includes(nameOrHostname)
        )
      })
      setStoredRules(customRules)
      return customRules
    },
    exampleRule: {
      name: 'Example',
      hostnames: ['example.com', '*.example.com'],
      userAgent: CHROME_120_WINDOWS_UA,
      platform: 'Win32',
      vendor: 'Google Inc.',
    },
  }

  Object.defineProperty(PAGE, 'SwitchUserAgent', {
    configurable: true,
    value: api,
  })
})()
