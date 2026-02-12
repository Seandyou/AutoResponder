// ============================================================
// AutoResponder Options Page Script
// ============================================================

class OptionsController {
  constructor() {
    this.rules = [];
    this.editingIndex = -1;
    this.selectedIndices = new Set();
    this.init();
  }

  async init() {
    await this.loadRules();
    this.bindEvents();
    this.render();
  }

  async loadRules() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_RULES' }, (response) => {
        this.rules = response?.rules || [];
        resolve();
      });
    });
  }

  bindEvents() {
    // 添加规则
    document.getElementById('addRuleBtn').addEventListener('click', () => {
      this.editingIndex = -1;
      this.openModal();
    });

    // 导入/导出
    document.getElementById('importBtn').addEventListener('click', () => this.importRules());
    document.getElementById('exportBtn').addEventListener('click', () => this.exportRules());
    document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAllRules());

    // 搜索
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.renderTable(e.target.value);
    });

    // 全选
    document.getElementById('selectAll').addEventListener('change', (e) => {
      this.toggleSelectAll(e.target.checked);
    });

    // 批量操作
    document.getElementById('batchEnableBtn').addEventListener('click', () => this.batchToggle(true));
    document.getElementById('batchDisableBtn').addEventListener('click', () => this.batchToggle(false));
    document.getElementById('batchDeleteBtn').addEventListener('click', () => this.batchDelete());

    // 模态框
    document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
    document.getElementById('cancelBtn').addEventListener('click', () => this.closeModal());
    document.getElementById('saveRuleBtn').addEventListener('click', () => this.saveRule());

    // 文件加载
    document.getElementById('loadFileBtn').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', (e) => {
      this.loadFile(e.target.files[0]);
    });

    // 格式化
    document.getElementById('formatBtn').addEventListener('click', () => this.formatContent());

    // 模板
    document.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', () => {
        this.applyTemplate(card.dataset.template);
      });
    });

    // 模态框外部点击关闭
    document.getElementById('ruleModal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('ruleModal')) {
        this.closeModal();
      }
    });
  }

  // --- 渲染 ---
  render() {
    this.renderTable();
    this.updateBatchActions();
  }

  renderTable(searchQuery = '') {
    const tbody = document.getElementById('rulesTableBody');
    const emptyState = document.getElementById('emptyState');

    const filteredRules = searchQuery
      ? this.rules.filter((r, i) => {
          const q = searchQuery.toLowerCase();
          return (r.urlPattern || '').toLowerCase().includes(q) ||
                 (r.originalPattern || '').toLowerCase().includes(q) ||
                 (r.note || '').toLowerCase().includes(q) ||
                 (r.responseType || '').toLowerCase().includes(q);
        })
      : this.rules;

    if (filteredRules.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    tbody.innerHTML = this.rules.map((rule, index) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches = (rule.urlPattern || '').toLowerCase().includes(q) ||
                       (rule.originalPattern || '').toLowerCase().includes(q) ||
                       (rule.note || '').toLowerCase().includes(q);
        if (!matches) return '';
      }

      const pattern = rule.originalPattern || rule.urlPattern;
      const size = this.formatSize(rule.responseContent);

      return `
        <tr class="${rule.enabled ? '' : 'disabled-row'}" data-index="${index}">
          <td>
            <input type="checkbox" class="row-select" data-index="${index}"
                   ${this.selectedIndices.has(index) ? 'checked' : ''}>
          </td>
          <td>
            <input type="checkbox" class="rule-toggle" data-index="${index}"
                   ${rule.enabled ? 'checked' : ''}>
          </td>
          <td class="pattern-cell" title="${this.escapeHtml(pattern)}">
            ${this.escapeHtml(pattern)}
          </td>
          <td>
            <span class="rule-badge badge-${rule.responseType || 'text'}">
              ${(rule.responseType || 'text').toUpperCase()}
            </span>
          </td>
          <td>${this.getMatchLabel(rule.matchType)}</td>
          <td>${size}</td>
          <td>${rule.priority || 1}</td>
          <td title="${this.escapeHtml(rule.note || '')}">${this.escapeHtml(rule.note || '-')}</td>
          <td>
            <div class="action-btns">
              <button data-action="edit" data-index="${index}" title="编辑">✏️</button>
              <button data-action="duplicate" data-index="${index}" title="复制">📋</button>
              <button data-action="delete" data-index="${index}" title="删除">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // 绑定表格事件
    tbody.querySelectorAll('.rule-toggle').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.toggleRule(index, e.target.checked);
      });
    });

    tbody.querySelectorAll('.row-select').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (e.target.checked) {
          this.selectedIndices.add(index);
        } else {
          this.selectedIndices.delete(index);
        }
        this.updateBatchActions();
      });
    });

    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]').dataset.action;
        const index = parseInt(e.target.closest('[data-action]').dataset.index);
        switch (action) {
          case 'edit': this.editRule(index); break;
          case 'duplicate': this.duplicateRule(index); break;
          case 'delete': this.deleteRule(index); break;
        }
      });
    });
  }

  updateBatchActions() {
    const batchActions = document.getElementById('batchActions');
    const count = this.selectedIndices.size;
    if (count > 0) {
      batchActions.style.display = 'flex';
      document.getElementById('selectedCount').textContent = `${count} 条已选`;
    } else {
      batchActions.style.display = 'none';
    }
  }

  // --- 规则操作 ---
  toggleRule(index, enabled) {
    this.rules[index].enabled = enabled;
    this.saveAllRules();
  }

  editRule(index) {
    this.editingIndex = index;
    const rule = this.rules[index];
    this.openModal(rule);
  }

  duplicateRule(index) {
    const rule = { ...this.rules[index] };
    rule.note = (rule.note || '') + ' (副本)';
    rule.createdAt = Date.now();

    chrome.runtime.sendMessage({ type: 'ADD_RULE', rule }, (response) => {
      if (response?.success) {
        this.rules = response.rules;
        this.render();
        this.showToast('规则已复制', 'success');
      }
    });
  }

  deleteRule(index) {
    if (!confirm('确定删除此规则？')) return;
    chrome.runtime.sendMessage({ type: 'DELETE_RULE', index }, (response) => {
      if (response?.success) {
        this.rules = response.rules;
        this.selectedIndices.delete(index);
        this.render();
        this.showToast('规则已删除', 'success');
      }
    });
  }

  toggleSelectAll(checked) {
    if (checked) {
      this.rules.forEach((_, i) => this.selectedIndices.add(i));
    } else {
      this.selectedIndices.clear();
    }
    this.render();
  }

  batchToggle(enabled) {
    this.selectedIndices.forEach(index => {
      this.rules[index].enabled = enabled;
    });
    this.saveAllRules();
    this.showToast(`已${enabled ? '启用' : '禁用'} ${this.selectedIndices.size} 条规则`, 'success');
  }

  batchDelete() {
    if (!confirm(`确定删除选中的 ${this.selectedIndices.size} 条规则？`)) return;
    const indices = Array.from(this.selectedIndices).sort((a, b) => b - a);
    indices.forEach(index => this.rules.splice(index, 1));
    this.selectedIndices.clear();
    this.saveAllRules();
    this.showToast('批量删除完成', 'success');
  }

  clearAllRules() {
    if (!confirm('确定清空所有规则？此操作不可撤销！')) return;
    this.rules = [];
    this.selectedIndices.clear();
    this.saveAllRules();
    this.showToast('所有规则已清空', 'success');
  }

  saveAllRules() {
    chrome.runtime.sendMessage({
      type: 'SAVE_RULES',
      rules: this.rules
    }, () => {
      this.render();
    });
  }

  // --- 模态框 ---
  openModal(rule = null) {
    const modal = document.getElementById('ruleModal');
    document.getElementById('modalTitle').textContent = rule ? '编辑规则' : '添加规则';

    if (rule) {
      document.getElementById('matchType').value = rule.matchType === 'urlFilter' ? 'contains' : (rule.matchType || 'contains');
      document.getElementById('urlPattern').value = rule.originalPattern || rule.urlPattern || '';
      document.getElementById('responseType').value = rule.responseType || 'html';
      document.getElementById('responseContent').value = rule.responseContent || '';
      document.getElementById('priority').value = rule.priority || 1;
      document.getElementById('ruleNote').value = rule.note || '';

      document.querySelectorAll('#resourceTypes input').forEach(cb => {
        cb.checked = rule.resourceTypes?.includes(cb.value) || false;
      });
    } else {
      document.getElementById('matchType').value = 'contains';
      document.getElementById('urlPattern').value = '';
      document.getElementById('responseType').value = 'html';
      document.getElementById('responseContent').value = '';
      document.getElementById('priority').value = '1';
      document.getElementById('ruleNote').value = '';
      document.querySelectorAll('#resourceTypes input').forEach(cb => cb.checked = false);
    }

    modal.style.display = 'flex';
  }

  closeModal() {
    document.getElementById('ruleModal').style.display = 'none';
    this.editingIndex = -1;
  }

  saveRule() {
    const urlPattern = document.getElementById('urlPattern').value.trim();
    const responseContent = document.getElementById('responseContent').value;
    const matchType = document.getElementById('matchType').value;
    const responseType = document.getElementById('responseType').value;
    const priority = parseInt(document.getElementById('priority').value) || 1;
    const note = document.getElementById('ruleNote').value.trim();

    if (!urlPattern) {
      this.showToast('请输入URL匹配模式', 'error');
      return;
    }
    if (!responseContent) {
      this.showToast('请输入响应内容', 'error');
      return;
    }

    if (matchType === 'regex') {
      try { new RegExp(urlPattern); } catch (e) {
        this.showToast('正则表达式无效', 'error');
        return;
      }
    }

    const resourceTypes = [];
    document.querySelectorAll('#resourceTypes input:checked').forEach(cb => {
      resourceTypes.push(cb.value);
    });

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
      createdAt: this.editingIndex >= 0 ? this.rules[this.editingIndex].createdAt : Date.now(),
      updatedAt: Date.now()
    };

    if (this.editingIndex >= 0) {
      rule.enabled = this.rules[this.editingIndex].enabled;
      chrome.runtime.sendMessage({
        type: 'UPDATE_RULE',
        index: this.editingIndex,
        rule
      }, (response) => {
        if (response?.success) {
          this.rules = response.rules;
          this.render();
          this.closeModal();
          this.showToast('规则已更新', 'success');
        }
      });
    } else {
      chrome.runtime.sendMessage({ type: 'ADD_RULE', rule }, (response) => {
        if (response?.success) {
          this.rules = response.rules;
          this.render();
          this.closeModal();
          this.showToast('规则已添加', 'success');
        }
      });
    }
  }

  convertPattern(pattern, matchType) {
    switch (matchType) {
      case 'exact': return pattern;
      case 'prefix': return pattern + '*';
      case 'suffix': return '*' + pattern;
      case 'contains': return '*' + pattern + '*';
      case 'wildcard': return pattern;
      case 'regex': return pattern;
      default: return '*' + pattern + '*';
    }
  }

  // --- 文件操作 ---
  loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('responseContent').value = e.target.result;
      const ext = file.name.split('.').pop().toLowerCase();
      const typeMap = { html: 'html', htm: 'html', js: 'js', mjs: 'js', css: 'css', json: 'json', xml: 'xml', txt: 'text', svg: 'svg' };
      if (typeMap[ext]) document.getElementById('responseType').value = typeMap[ext];
      this.showToast(`已加载: ${file.name}`, 'success');
    };
    reader.readAsText(file);
  }

  formatContent() {
    const textarea = document.getElementById('responseContent');
    const type = document.getElementById('responseType').value;
    try {
      if (type === 'json') {
        textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2);
        this.showToast('JSON 已格式化', 'success');
      } else {
        this.showToast('仅支持JSON格式化', 'info');
      }
    } catch (e) {
      this.showToast('格式化失败: ' + e.message, 'error');
    }
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

  importRules() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const rules = JSON.parse(e.target.result);
          if (!Array.isArray(rules)) throw new Error('格式错误');
          const valid = rules.filter(r => r.urlPattern && r.responseContent);
          chrome.runtime.sendMessage({ type: 'IMPORT_RULES', rules: valid }, (response) => {
            if (response?.success) {
              this.rules = response.rules;
              this.render();
              this.showToast(`已导入 ${valid.length} 条规则`, 'success');
            }
          });
        } catch (e) {
          this.showToast('导入失败: ' + e.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // --- 模板 ---
  applyTemplate(templateName) {
    const templates = {
      'empty-html': {
        responseType: 'html',
        responseContent: '<!DOCTYPE html>\n<html>\n<head><title>Empty</title></head>\n<body></body>\n</html>',
        note: '空白HTML页面'
      },
      'empty-js': {
        responseType: 'js',
        responseContent: '// Empty JavaScript file\n',
        note: '空白JS文件'
      },
      'empty-css': {
        responseType: 'css',
        responseContent: '/* Empty CSS file */\n',
        note: '空白CSS文件'
      },
      'json-mock': {
        responseType: 'json',
        responseContent: JSON.stringify({
          success: true,
          code: 200,
          message: "Mock response",
          data: {
            id: 1,
            name: "Test",
            items: []
          }
        }, null, 2),
        note: 'JSON Mock数据'
      },
      '404': {
        responseType: 'html',
        responseContent: '<!DOCTYPE html>\n<html>\n<head><title>404 Not Found</title></head>\n<body>\n<h1>404 Not Found</h1>\n<p>The requested resource was not found.</p>\n</body>\n</html>',
        note: '404页面'
      },
      'cors-json': {
        responseType: 'json',
        responseContent: JSON.stringify({
          success: true,
          data: {}
        }, null, 2),
        note: 'CORS JSON响应'
      }
    };

    const template = templates[templateName];
    if (!template) return;

    this.editingIndex = -1;
    this.openModal({
      matchType: 'contains',
      urlPattern: '',
      ...template,
      enabled: true,
      priority: 1
    });

    this.showToast(`已应用模板: ${template.note}`, 'info');
  }

  // --- 工具方法 ---
  getMatchLabel(type) {
    const labels = { contains: '包含', exact: '精确', prefix: '前缀', suffix: '后缀', regex: '正则', wildcard: '通配符', urlFilter: 'URL过滤' };
    return labels[type] || type;
  }

  formatSize(content) {
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
  new OptionsController();
});
