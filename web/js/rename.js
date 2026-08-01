// 资源管理器式改名：双击镜头名就地编辑，回车/失焦确认、Esc 取消
import { state } from './state.js';
import { renderGrid } from './render.js';
import { toast } from './ui.js';
import { fetchShots } from './data.js';

export function startRename(e, shotId) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.editingId) return;
    const shot = state.shots.find(s => s.id === shotId);
    if (!shot) return;
    const card = document.querySelector(`.shot-card[data-id="${shotId}"]`);
    if (!card) return;
    const nameEl = card.querySelector('.shot-name');
    if (!nameEl) return;

    state.editingId = shotId;
    card.draggable = false;  // 编辑态禁止卡片拖拽（拖选文字不拖卡）
    const input = document.createElement('input');
    input.className = 'shot-name-input';
    input.value = shot.name;
    input.draggable = false;
    // 输入框内的事件一律不冒泡：拖选文字不触发卡片拖拽/框选
    ['mousedown', 'mousemove', 'mouseup', 'dragstart', 'selectstart', 'click', 'dblclick'].forEach(t => {
        input.addEventListener(t, (ev) => ev.stopPropagation());
    });
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        const newName = input.value.trim();
        state.editingId = null;
        card.draggable = true;
        if (commit && newName && newName !== shot.name) {
            commitRename(shotId, newName);
        } else {
            renderGrid();
        }
    };
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') finish(true);
        else if (ev.key === 'Escape') finish(false);
        ev.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
}

async function commitRename(shotId, newName) {
    try {
        const res = await fetch(`/api/shot/${shotId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'rename', new_name: newName})
        });
        const data = await res.json();
        if (data.status !== 'ok') {
            toast(data.message || '改名失败', true);
        } else {
            toast('改名已生效');
        }
    } catch (e) {
        toast('改名请求失败', true);
    }
    fetchShots();
}
