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

  const UA_PRESETS = [
    {
      id: 'chrome-windows',
      label: 'Chrome on Windows',
      keywords: [
        'chrome',
        'chromium',
        'brave',
        'google',
        'windows',
        'win',
        'desktop',
        'default',
      ],
      userAgent: CHROME_120_WINDOWS_UA,
      platform: 'Win32',
      vendor: 'Google Inc.',
      uaPlatform: 'Windows',
      brands: [
        { brand: 'Not A(Brand', version: '99' },
        { brand: 'Google Chrome', version: '120' },
        { brand: 'Chromium', version: '120' },
      ],
    },
    {
      id: 'chrome-mac',
      label: 'Chrome on macOS',
      keywords: [
        'chrome',
        'chromium',
        'brave',
        'google',
        'mac',
        'macos',
        'osx',
        'desktop',
      ],
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'MacIntel',
      vendor: 'Google Inc.',
      uaPlatform: 'macOS',
      brands: [
        { brand: 'Not A(Brand', version: '99' },
        { brand: 'Google Chrome', version: '120' },
        { brand: 'Chromium', version: '120' },
      ],
    },
    {
      id: 'edge-windows',
      label: 'Edge on Windows',
      keywords: ['edge', 'edg', 'microsoft', 'windows', 'win', 'desktop'],
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      platform: 'Win32',
      vendor: 'Google Inc.',
      uaPlatform: 'Windows',
      brands: [
        { brand: 'Not A(Brand', version: '99' },
        { brand: 'Microsoft Edge', version: '120' },
        { brand: 'Chromium', version: '120' },
      ],
    },
    {
      id: 'safari-mac',
      label: 'Safari on macOS',
      keywords: ['safari', 'mac', 'macos', 'osx', 'desktop'],
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      platform: 'MacIntel',
      vendor: 'Apple Computer, Inc.',
      uaPlatform: 'macOS',
      brands: [],
    },
    {
      id: 'firefox-windows',
      label: 'Firefox on Windows',
      keywords: ['firefox', 'ff', 'mozilla', 'windows', 'win', 'desktop'],
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      platform: 'Win32',
      vendor: '',
      uaPlatform: 'Windows',
      brands: [],
    },
    {
      id: 'iphone-safari',
      label: 'Safari on iPhone',
      keywords: ['iphone', 'ios', 'mobile', 'safari', 'phone'],
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      vendor: 'Apple Computer, Inc.',
      uaPlatform: 'iOS',
      mobile: true,
      brands: [],
    },
  ]

  const DEFAULT_PRESET_ID = 'chrome-windows'

  /** @param {string | undefined} presetId */
  const getPresetById = (presetId) =>
    UA_PRESETS.find((preset) => preset.id === presetId) ||
    /** @type {(typeof UA_PRESETS)[number]} */ (UA_PRESETS[0])

  /**
   * Pick the most likely preset from one or two human keywords like:
   * 'chrome', 'windows chrome', 'safari mac', 'iphone', or 'firefox'.
   *
   * @param {string} [keywords]
   */
  const pickPreset = (keywords = DEFAULT_PRESET_ID) => {
    const searchTerms = keywords
      .toLowerCase()
      .split(/[\s,;+/-]+/)
      .filter(Boolean)

    if (searchTerms.length === 0) return getPresetById(DEFAULT_PRESET_ID)

    const exactPreset = UA_PRESETS.find(
      (preset) => preset.id === keywords.toLowerCase(),
    )
    if (exactPreset) return exactPreset

    return UA_PRESETS.map((preset) => ({
      preset,
      score: searchTerms.reduce((score, term) => {
        if (preset.id.includes(term)) return score + 4
        if (preset.keywords.includes(term)) return score + 3
        if (preset.label.toLowerCase().includes(term)) return score + 2
        return score
      }, 0),
    })).sort((a, b) => b.score - a.score)[0]?.preset
  }

  /** @param {string | string[]} hostnames */
  const normalizeHostnames = (hostnames) => {
    const values = Array.isArray(hostnames) ? hostnames : [hostnames]
    return [
      ...new Set(
        values.flatMap((value) => {
          const hostname = value
            .trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, '')
            .toLowerCase()

          if (!hostname || hostname.startsWith('*.')) return [hostname]
          if (hostname.startsWith('www.')) return [hostname, hostname.slice(4)]
          return [hostname, `www.${hostname}`]
        }),
      ),
    ].filter(Boolean)
  }

  /**
   * @param {string | string[]} hostnames
   * @param {string} [keywords]
   * @param {Record<string, unknown>} [overrides]
   */
  const createRule = (
    hostnames,
    keywords = DEFAULT_PRESET_ID,
    overrides = {},
  ) => {
    const preset = pickPreset(keywords) || getPresetById(DEFAULT_PRESET_ID)
    const normalizedHostnames = normalizeHostnames(hostnames)

    return {
      name:
        typeof overrides.name === 'string'
          ? overrides.name
          : normalizedHostnames[0] || 'Custom site',
      hostnames: normalizedHostnames,
      preset: preset.id,
      userAgent: preset.userAgent,
      platform: preset.platform,
      vendor: preset.vendor,
      uaPlatform: preset.uaPlatform,
      mobile: preset.mobile || false,
      brands: preset.brands,
      ...overrides,
    }
  }

  /**
   * Built-in rules live in the userscript so they work before any page scripts run.
   *
   * Add more sites here when you want the rule to be synced with the userscript:
   * createRule('example.com', 'chrome')
   */
  const DEFAULT_RULES = [
    createRule('lobste.rs', 'chrome windows', { name: 'Lobsters' }),
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
  const getUserAgentData = (rule) => {
    const brands = Array.isArray(rule.brands) ? rule.brands : []

    if (brands.length === 0) return undefined

    return {
      brands,
      mobile: rule.mobile === true,
      platform:
        typeof rule.uaPlatform === 'string' ? rule.uaPlatform : 'Windows',
      getHighEntropyValues: async (/** @type {string[]} */ hints) => {
        const values = {
          architecture: 'x86',
          bitness: '64',
          brands,
          fullVersionList: brands.map((brand) => ({
            ...brand,
            version: `${brand.version}.0.0.0`,
          })),
          mobile: rule.mobile === true,
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
    }
  }

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
    presets: () =>
      UA_PRESETS.map(({ id, label, keywords, userAgent }) => ({
        id,
        label,
        keywords,
        userAgent,
      })),
    pickPreset,
    createRule,
    /**
     * Add a site with one or two human keywords. Defaults to Chrome on Windows.
     *
     * Examples:
     * SwitchUserAgent.add('example.com')
     * SwitchUserAgent.add('example.com', 'safari mac')
     * SwitchUserAgent.add(['example.com', '*.example.com'], 'firefox')
     *
     * @param {string | string[]} hostnames
     * @param {string} [keywords]
     * @param {Record<string, unknown>} [overrides]
     */
    add(hostnames, keywords = DEFAULT_PRESET_ID, overrides = {}) {
      const customRules = getStoredRules()
      const nextRule = createRule(hostnames, keywords, overrides)
      customRules.push(nextRule)
      setStoredRules(customRules)
      return nextRule
    },
    /** @param {Record<string, unknown>} rule */
    addRule(rule) {
      const customRules = getStoredRules()
      const hostnames = Array.isArray(rule.hostnames)
        ? rule.hostnames.filter((hostname) => typeof hostname === 'string')
        : typeof rule.hostname === 'string'
          ? rule.hostname
          : []
      const nextRule = rule.userAgent ? rule : createRule(hostnames)
      customRules.push(nextRule)
      setStoredRules(customRules)
      return nextRule
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
    exampleRule: createRule('example.com', 'chrome'),
  }

  Object.defineProperty(PAGE, 'SwitchUserAgent', {
    configurable: true,
    value: api,
  })
})()
