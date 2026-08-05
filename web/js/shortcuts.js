// 右下角「快捷键」面板（v0.9.4）：渲染 SHORTCUTS 清单 + 开关交互
// 清单唯一事实源在 keyboard.js（与快捷键实现同文件），改快捷键必须同步那边
import { SHORTCUTS } from './keyboard.js';

const btn = document.getElementById('shortcutsBtn');
const panel = document.getElementById('shortcutsPanel');

function render() {
    panel.innerHTML = '<div class="sc-title">快捷键</div>' + SHORTCUTS.map(s =>
        `<div class="sc-row"><kbd>${s.keys}</kbd><span>${s.desc}</span></div>`
    ).join('');
}

function close() {
    panel.style.display = 'none';
    btn.classList.remove('active');
}

export function initShortcutsHelp() {
    if (!btn || !panel) return;
    render();
    btn.addEventListener('click', () => {
        if (panel.style.display === 'block') close();
        else {
            panel.style.display = 'block';
            btn.classList.add('active');
        }
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
