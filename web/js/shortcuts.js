// 右下角「快捷键」面板（v0.9.4）：渲染 SHORTCUTS 清单 + 开关交互
// 清单唯一事实源在 keyboard.js（与快捷键实现同文件），改快捷键必须同步那边
// v0.9.56e：Tab 标签页（全局/时间线）——SHORTCUTS 每项带 scope 字段，按 Tab 过滤；
// 打开面板时按当前 viewMode 自动选中对应 Tab（时间线视图打开默认时间线 Tab）
import { SHORTCUTS } from './keyboard.js';
import { state } from './state.js';

const btn = document.getElementById('shortcutsBtn');
const panel = document.getElementById('shortcutsPanel');
let closeTimer = null;  // 关闭动画计时器（v0.9.5 弹簧动画）

function rows(scope) {
    return SHORTCUTS.filter(s => s.scope === scope || s.scope === 'both')
        .map(s => `<div class="sc-row"><kbd>${s.keys}</kbd><span>${s.desc}</span></div>`)
        .join('');
}

function selectTab(scope) {
    panel.querySelectorAll('.sc-tab').forEach(t => t.classList.toggle('active', t.dataset.scope === scope));
    panel.querySelectorAll('.sc-list').forEach(l => { l.style.display = l.dataset.list === scope ? 'block' : 'none'; });
}

function render() {
    panel.innerHTML = `
        <div class="sc-title">快捷键</div>
        <div class="sc-tabs">
            <button type="button" class="sc-tab" data-scope="global">全局</button>
            <button type="button" class="sc-tab" data-scope="tl">时间线</button>
        </div>
        <div class="sc-list" data-list="global">${rows('global')}</div>
        <div class="sc-list" data-list="tl" style="display:none">${rows('tl')}</div>`;
    panel.querySelectorAll('.sc-tab').forEach(t => {
        t.addEventListener('click', () => selectTab(t.dataset.scope));
    });
    // 打开时按当前视图选 Tab（时间线视图 → 时间线 Tab）
    selectTab(state.viewMode === 'timeline' ? 'tl' : 'global');
}

// 弹簧动画（v0.9.5）：打开 = 弹入（translateY+scale overshoot）；关闭 = 先弹走再隐藏
function open() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    panel.classList.remove('panel-out');
    panel.style.display = 'block';
    panel.classList.remove('panel-in');
    void panel.offsetWidth;  // 强制 reflow，重启动画
    panel.classList.add('panel-in');
    btn.classList.add('active');
    // v0.9.56e：每次打开按当前视图自动选 Tab（render 只跑一次，这里保持跟随）
    selectTab(state.viewMode === 'timeline' ? 'tl' : 'global');
}

function close() {
    if (panel.style.display === 'none' || panel.classList.contains('panel-out')) return;
    btn.classList.remove('active');
    panel.classList.remove('panel-in');
    panel.classList.add('panel-out');
    closeTimer = setTimeout(() => {
        closeTimer = null;
        panel.style.display = 'none';
        panel.classList.remove('panel-out');
    }, 180);  // 匹配 .panel-out 动画时长
}

export function initShortcutsHelp() {
    if (!btn || !panel) return;
    render();
    btn.addEventListener('click', () => {
        if (panel.classList.contains('panel-out')) open();       // 关闭动画中再点 = 重新打开
        else if (panel.style.display === 'block') close();
        else open();
    });
    // 点击外部关闭（按钮自身排除；stopPropagation 不必要——document 监听会判断目标）
    document.addEventListener('click', (e) => {
        if (panel.style.display === 'block' && !panel.contains(e.target) && !btn.contains(e.target)) {
            close();
        }
    });
    // Esc 关闭面板（不 preventDefault——垃圾桶模式的 Esc 行为由 keyboard.js 处理，两者可并存）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.style.display === 'block') {
            close();
        }
    });
}
