// ============================================================
// AutoResponder Background Service Worker
// ============================================================

const STORAGE_KEY = 'autoresponder_rules';
const ENABLED_KEY = 'autoresponder_enabled';
const LOG_KEY = 'autoresponder_log';
const MAX_LOG_ENTRIES = 500;

// --- 初始化 ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEY, ENABLED_KEY], (result) => {
    if (!result[STORAGE_KEY]) {
      chrome.storage.local.set({ [STORAGE_KEY]: [] });
    }
    if (result[ENABLED_KEY] === undefined) {
      chrome.storage.local.set({ [ENABLED_KEY]: true });
    }
  });
  updateBadge();
});

// --- 请求拦截核心逻辑 ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // 只在异步回调中处理
    return undefined;
  },
  { urls: ["<all_urls>"] },
  []
);

// 使用 declarativeNetRequest 进行重定向（适用于简单场景）
// 但对于本地文件内容响应，我们需要更复杂的方案

// --- 核心：通过 onBeforeRequest 拦截并重定向 ---
// Manifest V3 限制较多，我们采用混合方案：
// 1. 对于可以通过 data URI 返回的内容，使用 declarativeNetRequest redirect
// 2. 对于大文件，使用 extension page 作为代理

class AutoResponder {
  constructor() {
    this.rules = [];
    this.enabled = true;
    this.logs = [];
    this.init();
  }

  async init() {
    await this.loadRules();
    await this.loadEnabled();
    this.setupListeners();
    this.updateDynamicRules();
  }

  async loadRules() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        this.rules = result[STORAGE_KEY] || [];
        resolve();
      });
    });
  }

  async loadEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get(ENABLED_KEY, (result) => {
        this.enabled = result[ENABLED_KEY] !== false;
        resolve();
      });
    });
  }

  setupListeners() {
    // 监听存储变化
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        if (changes[STORAGE_KEY]) {
          this.rules = changes[STORAGE_KEY].newValue || [];
          this.updateDynamicRules();
        }
        if (changes[ENABLED_KEY]) {
          this.enabled = changes[ENABLED_KEY].newValue !== false;
          this.updateDynamicRules();
          updateBadge();
        }
      }
    });

    // 监听来自 popup 和 options 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // 保持消息通道开放
    });
  }

  async handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'GET_RULES':
        sendResponse({ rules: this.rules });
        break;

      case 'SAVE_RULES':
        this.rules = message.rules;
        await chrome.storage.local.set({ [STORAGE_KEY]: this.rules });
        await this.updateDynamicRules();
        sendResponse({ success: true });
        break;

      case 'ADD_RULE':
        this.rules.push(message.rule);
        await chrome.storage.local.set({ [STORAGE_KEY]: this.rules });
        await this.updateDynamicRules();
        sendResponse({ success: true, rules: this.rules });
        break;

      case 'DELETE_RULE':
        this.rules.splice(message.index, 1);
        await chrome.storage.local.set({ [STORAGE_KEY]: this.rules });
        await this.updateDynamicRules();
        sendResponse({ success: true, rules: this.rules });
        break;

      case 'UPDATE_RULE':
        this.rules[message.index] = message.rule;
        await chrome.storage.local.set({ [STORAGE_KEY]: this.rules });
        await this.updateDynamicRules();
        sendResponse({ success: true, rules: this.rules });
        break;

      case 'TOGGLE_ENABLED':
        this.enabled = message.enabled;
        await chrome.storage.local.set({ [ENABLED_KEY]: this.enabled });
        await this.updateDynamicRules();
        updateBadge();
        sendResponse({ success: true });
        break;

      case 'GET_STATUS':
        sendResponse({ enabled: this.enabled, ruleCount: this.rules.length });
        break;

      case 'GET_LOGS':
        sendResponse({ logs: this.logs });
        break;

      case 'CLEAR_LOGS':
        this.logs = [];
        sendResponse({ success: true });
        break;

      case 'EXPORT_RULES':
        sendResponse({ rules: this.rules });
        break;

      case 'IMPORT_RULES':
        this.rules = [...this.rules, ...message.rules];
        await chrome.storage.local.set({ [STORAGE_KEY]: this.rules });
        await this.updateDynamicRules();
        sendResponse({ success: true, rules: this.rules });
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  async updateDynamicRules() {
    try {
      // 先移除所有现有的动态规则
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map(r => r.id);

      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: removeRuleIds
        });
      }

      if (!this.enabled) {
        console.log('[AutoResponder] Disabled - all rules removed');
        return;
      }

      // 构建新规则
      const addRules = [];
      let ruleId = 1;

      for (const rule of this.rules) {
        if (!rule.enabled) continue;
        if (!rule.urlPattern || !rule.responseContent) continue;

        try {
          const mimeType = this.getMimeType(rule.responseType || 'html');
          const encodedContent = this.encodeContent(rule.responseContent, mimeType);

          // 构建 URL 匹配条件
          const urlFilter = rule.urlPattern;
          const isRegex = rule.matchType === 'regex';

          const netRequestRule = {
            id: ruleId++,
            priority: rule.priority || 1,
            action: {
              type: "redirect",
              redirect: {
                url: `data:${mimeType};base64,${encodedContent}`
              }
            },
            condition: {}
          };

          if (isRegex) {
            netRequestRule.condition.regexFilter = urlFilter;
          } else {
            netRequestRule.condition.urlFilter = urlFilter;
          }

          // 资源类型过滤
          if (rule.resourceTypes && rule.resourceTypes.length > 0) {
            netRequestRule.condition.resourceTypes = rule.resourceTypes;
          } else {
            // 默认拦截所有类型
            netRequestRule.condition.resourceTypes = [
              "main_frame", "sub_frame", "stylesheet", "script",
              "image", "font", "object", "xmlhttprequest",
              "ping", "media", "websocket", "webtransport",
              "webbundle", "other"
            ];
          }

          addRules.push(netRequestRule);

          // 记录日志
          this.addLog({
            action: 'RULE_REGISTERED',
            pattern: urlFilter,
            matchType: rule.matchType,
            responseType: rule.responseType,
            timestamp: Date.now()
          });

        } catch (err) {
          console.error(`[AutoResponder] Error creating rule for pattern "${rule.urlPattern}":`, err);
          this.addLog({
            action: 'RULE_ERROR',
            pattern: rule.urlPattern,
            error: err.message,
            timestamp: Date.now()
          });
        }
      }

      if (addRules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: addRules
        });
        console.log(`[AutoResponder] ${addRules.length} rules activated`);
      }

    } catch (error) {
      console.error('[AutoResponder] Error updating dynamic rules:', error);
    }
  }

  getMimeType(responseType) {
    const mimeTypes = {
      'html': 'text/html;charset=utf-8',
      'js': 'application/javascript;charset=utf-8',
      'javascript': 'application/javascript;charset=utf-8',
      'css': 'text/css;charset=utf-8',
      'json': 'application/json;charset=utf-8',
      'xml': 'application/xml;charset=utf-8',
      'text': 'text/plain;charset=utf-8',
      'svg': 'image/svg+xml;charset=utf-8',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'ico': 'image/x-icon',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'ttf': 'font/ttf',
      'eot': 'application/vnd.ms-fontobject'
    };
    return mimeTypes[responseType.toLowerCase()] || 'text/plain;charset=utf-8';
  }

  encodeContent(content, mimeType) {
    // 对于文本内容，使用 UTF-8 编码后转 base64
    if (mimeType.includes('text') || mimeType.includes('javascript') ||
        mimeType.includes('json') || mimeType.includes('xml') ||
        mimeType.includes('svg')) {
      // 文本内容 - 使用 TextEncoder
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(content);
      return this.uint8ArrayToBase64(uint8Array);
    } else {
      // 二进制内容 - 假设已经是 base64
      return content;
    }
  }

  uint8ArrayToBase64(uint8Array) {
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  addLog(entry) {
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(0, MAX_LOG_ENTRIES);
    }
  }
}

// --- Badge 更新 ---
async function updateBadge() {
  const result = await chrome.storage.local.get([ENABLED_KEY, STORAGE_KEY]);
  const enabled = result[ENABLED_KEY] !== false;
  const rules = result[STORAGE_KEY] || [];
  const activeRules = rules.filter(r => r.enabled).length;

  if (enabled && activeRules > 0) {
    chrome.action.setBadgeText({ text: String(activeRules) });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } else if (enabled) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
  }
}

// --- 监听 declarativeNetRequest 匹配（用于日志） ---
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    autoResponder.addLog({
      action: 'REQUEST_INTERCEPTED',
      url: info.request.url,
      ruleId: info.rule.ruleId,
      tabId: info.request.tabId,
      method: info.request.method,
      type: info.request.type,
      timestamp: Date.now()
    });
    console.log(`[AutoResponder] Intercepted: ${info.request.url}`);
  });
}

// --- 启动 ---
const autoResponder = new AutoResponder();
updateBadge();
