// 数据层：拉取、心跳（含 Blender 端错误回传）、通用 POST
import { state, grid } from './state.js';
import { renderGrid } from './render.js';
import { toast } from './ui.js';

export async function fetchShots(force) {
    const url = state.trashMode ? '/api/trash' : '/api/shots';
    try {
        const res = await fetch(url, force ? {cache: 'no-store'} : {});
        const data = await res.json();
        if (data.status === 'ok') {
            state.shots = data.shots;
            renderGrid();
            // 数据到位后重算缩放上限（列表 maxW 依赖最大帧数，v0.8.2）
            if (window.__zoomApply) window.__zoomApply();
        }
    } catch (e) {
        console.error('Failed to fetch shots:', e);
        if (!state.shots.length) {
            // 骨架层必须一并揭掉，否则失败提示被盖住 = 卡骨架屏（v0.8.2）
            const skel = document.getElementById('skelLayer');
            if (skel) { skel.classList.add('out'); setTimeout(() => skel.remove(), 420); }
            grid.innerHTML = '<div class="empty-state"><p>Failed to load shots. Is the server running?</p></div>';
        }
    }
}

export function forceRefresh() {
    state.lastVersion = null;
    fetchShots(true);
}

export async function heartbeat() {
    if (state.editingId || state.marqueeActive || state.panning || state.dragSrcEl) return;
    try {
        const res = await fetch('/api/version');
        const data = await res.json();
        if (data.status !== 'ok') return;

        // Blender 端执行失败的命令回传为 toast（只报新错误）
        const errors = data.errors || [];
        if (state.lastErrorTs === null) {
            // 首次心跳：历史错误不轰炸，只记录水位
            state.lastErrorTs = errors.length ? errors[errors.length - 1].ts : '';
        } else {
            for (const err of errors) {
                if (err.ts > state.lastErrorTs) {
                    toast(`${err.command} 失败: ${err.error}`, true);
                    state.lastErrorTs = err.ts;
                }
            }
        }

        // 垃圾桶徽标（版本没变也要跟，因为 trash_count 自己会变）
        if (typeof data.trash_count === 'number') {
            const badge = document.getElementById('trashCount');
            badge.textContent = data.trash_count;
            badge.classList.toggle('on', data.trash_count > 0);
        }

        if (state.lastVersion === null) {
            state.lastVersion = data.version;
        } else if (data.version !== state.lastVersion) {
            state.lastVersion = data.version;
            fetchShots();
        }
    } catch (e) { /* server down, keep quiet */ }
}

// Ctrl+Z 撤销 (#6)：后端逆操作栈，栈深 20
export async function undoLast() {
    try {
        const res = await fetch('/api/undo', {method: 'POST'});
        const data = await res.json();
        if (data.status === 'ok') {
            toast(data.label ? `已撤销：${data.label}` : '已撤销');
            fetchShots(true);
        } else if (data.status === 'empty') {
            toast('没有可撤销的操作');
        } else {
            toast(data.message || '撤销失败', true);
        }
    } catch (e) {
        toast('撤销请求失败', true);
    }
}

export async function loadProjectTitle() {
    try {
        const res = await fetch('/api/project');
        const data = await res.json();
        if (data.status === 'ok' && data.name) {
            document.title = data.name;
            const h1 = document.getElementById('pageTitle');
            if (h1) h1.innerText = data.name;
        }
    } catch (e) { /* keep default */ }
}

export async function postShotAction(shotId, body) {
    try {
        const res = await fetch(`/api/shot/${shotId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        return await res.json();
    } catch (e) { console.error(e); return null; }
}

export async function postBatch(action, ids) {
    try {
        const res = await fetch('/api/batch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action, shot_ids: ids})
        });
        return await res.json();
    } catch (e) { console.error(e); return null; }
}

export function openShot(shotId) {
    if (state.trashMode) return;  // 垃圾桶里的场景已停用，不可打开
    postShotAction(shotId, {action: 'open'});
    toast('已切换到该镜头');
}

export function openTimeline() { toast('Timeline view - Phase 2'); }

export async function syncScenes() {
    await fetch('/api/sync', {method: 'POST'});
    toast('Sync 已排队，Blender 将清理孤儿记录');
}
