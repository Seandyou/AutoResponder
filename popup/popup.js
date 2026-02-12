// ============================================================
// AutoResponder Popup Script
// ============================================================

class PopupController {
  constructor() {
    this.rules = [];
    this.enabled = true;
    this.editingIndex = -1;
    this.init();
  }

  async init() {
    await this.loadState();
    this.bindEvents();
    this.render();
  }

  // --- 数据加载 ---
  async loadState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (response) {
          this.enabled = response.enabled;
        }
        chrome.runtime.sendMessage({ type: 'GET_RULES' }, (response) => {
          if (response) {
            this.rules = response.rules || [];
          }
          resolve();
        });
      });
    });
  }

  // --- 事件绑定 ---
  bindEvents() {
    // 全局开关
    const toggle = document.getElementById('globalToggle');
    toggle.checked = this.enabled;
    toggle.addEventListener('change', () => {
      this.enabled = toggle.checked;
      chrome.runtime.sendMessage({
        type: 'TOGGLE_ENABLED',
        enabled: this.enabled
      });
      this.updateStatus();
    });

    // 添加规则
    document.getElementById('addRuleBtn').addEventListener('click', () => {
      this.editingIndex = -1;
      this.openRuleModal();
    });

    // 关闭模态框
    document.getElementById('closeModal').addEventListener('click', () => {
      this.closeRuleModal();
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      this.closeRuleModal();
    });

    // 保存规则
    document.getElementById('saveRuleBtn').addEventListener('click', () => {
      this.saveRule();
    });

    // 从文件加载
    document.getElementById('loadFileBtn').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', (e) => {
      this.loadFromFile(e.target.files[0]);
    });

    // 匹配类型帮助文本
    document.getElementById('matchType').addEventListener('change', (e) => {
      this.updateMatchHelp(e.target.value);
    });

    // 导出
    document.getElementById('exportBtn').addEventListener('click', () => {
      this.exportRules();
    });

    // 导入
    document.getElementById('importBtn').addEventListener('click', () => {
      this.openImportModal();
    });

    document.getElementById('closeImportModal').addEventListener('click', () => {
      document.getElementById('importModal').style.display = 'none';
    });

    document.getElementById('cancelImportBtn').addEventListener('click', () => {
      document.getElementById('importModal').style.display = 'none';
    });

    document.getElementById('confirmImportBtn').addEventListener('click', () => {
      this.importRules();
    });

    document.getElementById('importFileInput').addEventListener('change', (e) => {
      this.loadImportFile(e.target.files[0]);
    });

    // 日志
    document.getElementById('logsBtn').addEventListener('click', () => {
      this.openLogModal();
    });

    document.getElementById('closeLogModal').addEventListener('click', () => {
      document.getElementById('logModal').style.display = 'none';
    });

    document.getElementById('clearLogsBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
      document.getElementById('logList').innerHTML = '<div class="empty-state">暂无日志</div>';
    });

    // 选项页
    document.getElementById('optionsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // 点击模态框外部关闭
    document.getElementById('ruleModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('ruleModal')) {
        this.closeRuleModal();
      }
    });

    document.getElementById('logModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('logModal')) {
        document.getElementById('logModal').style.display = 'none';
      }
    });

    document.getElementById('importModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('importModal')) {
        document.getElementById('importModal').style.display = 'none';
      }
    });
  }

  // --- 渲染 ---
  render() {
    this.renderRules();
    this.updateStatus();
  }

  renderRules() {
    const container = document.getElementById('rulesList');
    const emptyState = document.getElementById('emptyState');

    if (this.rules.length === 0) {
      emptyState.style.display = 'flex';
      container.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    container.style.display = 'block';

    container.innerHTML = this.rules.map((rule, index) => `
      <div class="rule-card ${rule.enabled ? '' : 'disabled'}" data-index="${index}">
        <div class="rule-card-header">
          <div class="rule-card-header-left">
            <input type="checkbox" class="rule-toggle" 
                   ${rule.enabled ? 'checked' : ''} 
                   data-action="toggle" data-index="${index}"
                   title="启用/禁用此规则">
            <span class="rule-pattern" title="${this.escapeHtml(rule.urlPattern)}">
              ${this.escapeHtml(rule.urlPattern)}
            </span>
          </div>
          <div class="rule-card-header-right">
            <button class="btn-icon" data-action="edit" data-index="${index}" title="编辑">✏️</button>
            <button class="btn-icon" data-action="duplicate" data-index="${index}" title="复制">📋</button>
            <button class="btn-icon" data-action="delete" data-index="${index}" title="删除">🗑️</button>
          </div>
        </div>
        <div class="rule-card-meta">
          <span class="rule-badge badge-${rule.responseType || 'text'}">${(rule.responseType || 'text').toUpperCase()}</span>
          <span class="rule-match-type">${this.getMatchTypeLabel(rule.matchType)}</span>
          ${rule.note ? `<span class="rule-note" title="${this.escapeHtml(rule.note)}">${this.escapeHtml(rule.note)}</span>` : ''}
          <span style="margin-left:auto; font-size:10px; color:var(--text-secondary)">
            ${this.formatContentSize(rule.responseContent)}
          </span>
        </div>
      </div>
    `).join('');

    // 绑定规则卡片事件
    container.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;
      const index = parseInt(target.dataset.index);

      switch (action) {
        case 'toggle':
          this.toggleRule(index, target.checked);
          break;
        case 'edit':
          this.editRule(index);
          break;
        case 'duplicate':
          this.duplicateRule(index);
          break;
        case 'delete':
          this.deleteRule(index);
          break;
      }
    });
  }

  updateStatus() {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('statusText');
    const activeRules = this.rules.filter(r => r.enabled).length;

    if (this.enabled) {
      statusDot.className = 'status-dot active';
      statusText.textContent = `已启用 - ${activeRules} 条活跃规则 / 共 ${this.rules.length} 条`;
    } else {
      statusDot.className = 'status-dot inactive';
      statusText.textContent = '已禁用';
    }
  }

  // --- 规则操作 ---
  openRuleModal(rule = null) {
    const modal = document.getElementById('ruleModal');
    const title = document.getElementById('modalTitle');

    if (rule) {
      title.textContent = '编辑规则';
      document.getElementById('matchType').value = rule.matchType || 'contains';
      document.getElementById('urlPattern').value = rule.urlPattern || '';
      document.getElementById('responseType').value = rule.responseType || 'html';
      document.getElementById('responseContent').value = rule.responseContent || '';
      document.getElementById('priority').value = rule.priority || 1;
      document.getElementById('ruleNote').value = rule.note || '';

      // 资源类型
      const checkboxes = document.querySelectorAll('#resourceTypes input[type="checkbox"]');
      checkboxes.forEach(cb => {
        cb.checked = rule.resourceTypes && rule.resourceTypes.includes(cb.value);
      });
    } else {
      title.textContent = '添加规则';
      document.getElementById('matchType').value = 'contains';
      document.getElementById('urlPattern').value = '';
      document.getElementById('responseType').value = 'html';
      document.getElementById('responseContent').value = '';
      document.getElementById('priority').value = '1';
      document.getElementById('ruleNote').value = '';

      const checkboxes = document.querySelectorAll('#resourceTypes input[type="checkbox"]');
      checkboxes.forEach(cb => cb.checked = false);
    }

    this.updateMatchHelp(document.getElementById('matchType').value);
    modal.style.display = 'flex';
    document.getElementById('urlPattern').focus();
  }

  closeRuleModal() {
    document.getElementById('ruleModal').style.display = 'none';
    document.getElementById('fileInput').value = '';
    this.editingIndex = -1;
  }

  saveRule() {
    const urlPattern = document.getElementById('urlPattern').value.trim();
    const responseContent = document.getElementById('responseContent').value;
    const matchType = document.getElementById('matchType').value;
    const responseType = document.getElementById('responseType').value;
    const priority = parseInt(document.getElementById('priority').value) || 1;
    const note = document.getElementById('ruleNote').value.trim();

    // 验证
    if (!urlPattern) {
      this.showToast('请输入URL匹配模式', 'error');
      document.getElementById('urlPattern').focus();
      return;
    }

    if (!responseContent) {
      this.showToast('请输入响应内容', 'error');
      document.getElementById('responseContent').focus();
      return;
    }

    // 验证正则表达式
    if (matchType === 'regex') {
      try {
        new RegExp(urlPattern);
      } catch (e) {
        this.showToast('正则表达式无效: ' + e.message, 'error');
        return;
      }
    }

    // 获取资源类型
    const resourceTypes = [];
    document.querySelectorAll('#resourceTypes input[type="checkbox"]:checked').forEach(cb => {
      resourceTypes.push(cb.value);
    });

    // 转换 URL 模式为 declarativeNetRequest 格式
    const convertedPattern = this.convertPattern(urlPattern, matchType);

    const rule = {
      urlPattern: convertedPattern,
      originalPattern: urlPattern,
      matchType: matchType === 'regex' ? 'regex' : 'urlFilter',
      responseType,
      responseContent,
      resourceTypes: resourceTypes.length > 0 ? resourceTypes : null,
      priority,
      note,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (this.editingIndex >= 0) {
      // 更新现有规则
      rule.createdAt = this.rules[this.editingIndex].createdAt;
      chrome.runtime.sendMessage({
        type: 'UPDATE_RULE',
        index: this.editingIndex,
        rule
      }, (response) => {
        if (response && response.success) {
          this.rules = response.rules;
          this.render();
          this.closeRuleModal();
          this.showToast('规则已更新', 'success');
        }
      });
    } else {
      // 添加新规则
      chrome.runtime.sendMessage({
        type: 'ADD_RULE',
        rule
      }, (response) => {
        if (response && response.success) {
          this.rules = response.rules;
          this.render();
          this.closeRuleModal();
          this.showToast('规则已添加', 'success');
        }
      });
    }
  }

  convertPattern(pattern, matchType) {
    switch (matchType) {
      case 'exact':
        return pattern;
      case 'prefix':
        return pattern + '*';
      case 'suffix':
        return '*' + pattern;
      case 'contains':
        return '*' + pattern + '*';
      case 'wildcard':
        return pattern;
      case 'regex':
        return pattern;
      default:
        return '*' + pattern + '*';
    }
  }

  toggleRule(index, enabled) {
    this.rules[index].enabled = enabled;
    chrome.runtime.sendMessage({
      type: 'UPDATE_RULE',
      index,
      rule: this.rules[index]
    }, (response) => {
      if (response && response.success) {
        this.rules = response.rules;
        this.updateStatus();
      }
    });
  }

  editRule(index) {
    this.editingIndex = index;
    const rule = this.rules[index];
    // 使用原始模式显示
    const displayRule = {
      ...rule,
      urlPattern: rule.originalPattern || rule.urlPattern
    };
    this.openRuleModal(displayRule);
  }

  duplicateRule(index) {
    const rule = { ...this.rules[index] };
    rule.note = (rule.note || '') + ' (副本)';
    rule.createdAt = Date.now();
    rule.updatedAt = Date.now();

    chrome.runtime.sendMessage({
      type: 'ADD_RULE',
      rule
    }, (response) => {
      if (response && response.success) {
        this.rules = response.rules;
        this.render();
        this.showToast('规则已复制', 'success');
      }
    });
  }

  deleteRule(index) {
    if (!confirm('确定要删除这条规则吗？')) return;

    chrome.runtime.sendMessage({
      type: 'DELETE_RULE',
      index
    }, (response) => {
      if (response && response.success) {
        this.rules = response.rules;
        this.render();
        this.showToast('规则已删除', 'success');
      }
    });
  }

  // --- 文件加载 ---
  loadFromFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('responseContent').value = e.target.result;

      // 自动检测响应类型
      const ext = file.name.split('.').pop().toLowerCase();
      const typeMap = {
        'html': 'html', 'htm': 'html',
        'js': 'js', 'mjs': 'js',
        'css': 'css',
        'json': 'json',
        'xml': 'xml',
        'txt': 'text',
        'svg': 'svg'
      };

      if (typeMap[ext]) {
        document.getElementById('responseType').value = typeMap[ext];
      }

      this.showToast(`已加载文件: ${file.name}`, 'success');
    };

    reader.onerror = () => {
      this.showToast('文件读取失败', 'error');
    };

    reader.readAsText(file, 'utf-8');
  }

  // --- 导入/导出 ---
  exportRules() {
    if (this.rules.length === 0) {
      this.showToast('没有可导出的规则', 'info');
      return;
    }

    const data = JSON.stringify(this.rules, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `autoresponder-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    this.showToast(`已导出 ${this.rules.length} 条规则`, 'success');
  }

  openImportModal() {
    document.getElementById('importModal').style.display = 'flex';
    document.getElementById('importContent').value = '';
    document.getElementById('importFileInput').value = '';
  }

  loadImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('importContent').value = e.target.result;
    };
    reader.readAsText(file);
  }

  importRules() {
    const content = document.getElementById('importContent').value.trim();
    if (!content) {
      this.showToast('请提供导入内容', 'error');
      return;
    }

    try {
      const rules = JSON.parse(content);
      if (!Array.isArray(rules)) {
        throw new Error('格式错误：需要JSON数组');
      }

      // 验证规则格式
      const validRules = rules.filter(r => r.urlPattern && r.responseContent);
      if (validRules.length === 0) {
        throw new Error('没有找到有效的规则');
      }

      chrome.runtime.sendMessage({
        type: 'IMPORT_RULES',
        rules: validRules
      }, (response) => {
        if (response && response.success) {
          this.rules = response.rules;
          this.render();
          document.getElementById('importModal').style.display = 'none';
          this.showToast(`已导入 ${validRules.length} 条规则`, 'success');
        }
      });
    } catch (e) {
      this.showToast('导入失败: ' + e.message, 'error');
    }
  }

  // --- 日志 ---
  openLogModal() {
    const modal = document.getElementById('logModal');
    modal.style.display = 'flex';

    chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (response) => {
      const logs = response?.logs || [];
      const logList = document.getElementById('logList');

      if (logs.length === 0) {
        logList.innerHTML = '<div class="empty-state">暂无日志</div>';
        return;
      }

      logList.innerHTML = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        let actionClass = '';
        let actionText = '';

        switch (log.action) {
          case 'REQUEST_INTERCEPTED':
            actionClass = 'intercepted';
            actionText = '已拦截';
            break;
          case 'RULE_REGISTERED':
            actionClass = 'registered';
            actionText = '已注册';
            break;
          case 'RULE_ERROR':
            actionClass = 'error';
            actionText = '错误';
            break;
          default:
            actionText = log.action;
        }

        return `
          <div class="log-entry">
            <span class="log-time">${time}</span>
            <span class="log-action ${actionClass}">${actionText}</span>
            <span class="log-url">${this.escapeHtml(log.url || log.pattern || log.error || '')}</span>
          </div>
        `;
      }).join('');
    });
  }

  // --- 工具方法 ---
  updateMatchHelp(matchType) {
    const helpTexts = {
      'contains': '匹配URL中包含指定文本的请求。例如: "api/users" 匹配所有包含此文本的URL',
      'exact': '精确匹配完整URL。例如: "https://example.com/api/users"',
      'prefix': '匹配以指定文本开头的URL。例如: "https://example.com/api"',
      'suffix': '匹配以指定文本结尾的URL。例如: ".js" 匹配所有JS文件',
      'regex': '使用RE2正则表达式匹配。例如: "https://example\\.com/api/.*"',
      'wildcard': '使用通配符匹配。* 匹配任意字符。例如: "*://example.com/*/data.json"'
    };
    document.getElementById('matchHelp').textContent = helpTexts[matchType] || '';
  }

  getMatchTypeLabel(matchType) {
    const labels = {
      'contains': '包含',
      'exact': '精确',
      'prefix': '前缀',
      'suffix': '后缀',
      'regex': '正则',
      'wildcard': '通配符',
      'urlFilter': 'URL过滤'
    };
    return labels[matchType] || matchType;
  }

  formatContentSize(content) {
    if (!content) return '0 B';
    const bytes = new Blob([content]).size;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  showToast(message, type = 'info') {
    // 移除现有 toast
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }
}

// --- 启动 ---
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
