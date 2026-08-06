// 右下角「快捷键」面板（v0.9.4）：渲染 SHORTCUTS 清单 + 开关交互
// 清单唯一事实源在 keyboard.js（与快捷键实现同文件），改快捷键必须同步那边
import { SHORTCUTS } from './keyboard.js';

const btn = document.getElementById('shortcutsBtn');
const panel = document.getElementById('shortcutsPanel');
let closeTimer = null;  // 关闭动画计时器（v0.9.5 弹簧动画）

function render() {
    panel.innerHTML = '<div class="sc-title">快捷键</div>' + SHORTCUTS.map(s =>
        `<div class="sc-row"><kbd>${s.keys}</kbd><span>${s.desc}</span></div>`
    ).join('');
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
