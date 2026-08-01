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
    if (state.editingId || state.trashMode) return;  // 垃圾桶里不可改名
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
        // 先把输入框换回名字元素（DOM 差分会复用卡片，不还原的话输入框会孤儿化）
        if (input.isConnected) input.replaceWith(nameEl);
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

// ---- 通用字段就地编辑 (#15)：列表视图的 时长/内容/台词，交互与改名一致 ----
const FIELD_LABEL = {duration: '时长', content: '内容', dialogue: '台词'};

export function startFieldEdit(e, cellEl, shotId, field) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.editingId || state.trashMode) return;  // 垃圾桶里不可编辑
    const shot = state.shots.find(s => s.id === shotId);
    if (!shot) return;
    const card = cellEl.closest('.shot-card');
    if (!card) return;

    state.editingId = shotId;
    card.draggable = false;
    const oldVal = field === 'duration' ? String(shot.duration) : (shot[field] || '');
    const input = document.createElement('input');
    input.className = 'field-input';
    input.value = oldVal;
    input.draggable = false;
    ['mousedown', 'mousemove', 'mouseup', 'dragstart', 'selectstart', 'click', 'dblclick'].forEach(t => {
        input.addEventListener(t, (ev) => ev.stopPropagation());
    });
    cellEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        const raw = input.value.trim();
        state.editingId = null;
        card.draggable = true;
        // 先还原单元格 DOM（差分渲染会复用卡片，输入框不能留在里面）
        if (input.isConnected) input.replaceWith(cellEl);
        if (commit && raw !== oldVal) {
            if (field === 'duration') {
                const v = parseFloat(raw);
                if (!isFinite(v) || v <= 0) {
                    toast('时长必须是大于 0 的数字', true);
                    renderGrid();
                    return;
                }
                commitField(shotId, {duration: v});
            } else {
                commitField(shotId, {[field]: raw});
            }
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

async function commitField(shotId, fields) {
    try {
        const res = await fetch(`/api/shot/${shotId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'update', fields})
        });
        const data = await res.json();
        if (data.status !== 'ok') {
            toast(data.message || '保存失败', true);
        } else {
            const label = FIELD_LABEL[Object.keys(fields)[0]] || '字段';
            toast(`${label}已保存`);
        }
    } catch (e) {
        toast('保存请求失败', true);
    }
    fetchShots();
}
