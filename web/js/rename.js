// 资源管理器式改名：双击镜头名就地编辑，回车/失焦确认、Esc 取消
import { state } from './state.js';
import { renderGrid } from './render.js';
import { toast } from './ui.js';
import { fetchShots } from './data.js';
import { inlineEdit } from './inline_edit.js';

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
    inlineEdit({
        targetEl: nameEl,
        className: 'shot-name-input',
        value: shot.name,
        onFinish: (commit, newName) => {
            state.editingId = null;
            card.draggable = true;
            // DOM 已由 inlineEdit 还原（输入框换回名字元素，防差分复用孤儿化）
            if (commit && newName && newName !== shot.name) {
                commitRename(shotId, newName);
            } else {
                renderGrid();
            }
        },
    });
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
    // v0.9.21：预览框详情区元素不在 .shot-card 内（无卡片可禁拖）——判空适配
    state.editingId = shotId;
    if (card) card.draggable = false;
    const oldVal = field === 'duration' ? String(shot.duration) : (shot[field] || '');
    // v0.9.19：内容/台词 = 多行 textarea（自动换行 + 高随内容，至少撑满条目内容区
    // 与显示态一致）；时长 = 单行 input
    const isMultiline = (field === 'content' || field === 'dialogue');
    inlineEdit({
        targetEl: cellEl,
        multiline: isMultiline,
        className: isMultiline ? 'field-input multiline' : 'field-input',
        value: oldVal,
        shiftEnter: isMultiline,  // v0.9.19：多行框 Enter=保存、Shift+Enter=换行
        onSetup: (input) => {
            if (!isMultiline) return;
            const cellH = cellEl.offsetHeight;   // 编辑前显示态高度（撑满条目内容区）
            const autoResize = () => {
                input.style.height = 'auto';
                input.style.height = Math.max(input.scrollHeight, cellH) + 'px';
            };
            input.addEventListener('input', autoResize);
            autoResize();
        },
        onFinish: (commit, raw) => {
            state.editingId = null;
            if (card) card.draggable = true;
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
        },
    });
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
