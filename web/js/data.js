// 数据层：拉取、心跳（含 Blender 端错误回传）、通用 POST
import { state, grid } from './state.js';
import { renderGrid } from './render.js';
import { toast } from './ui.js';

export async function fetchShots(force) {
    try {
        const res = await fetch('/api/shots', force ? {cache: 'no-store'} : {});
        const data = await res.json();
        if (data.status === 'ok') {
            state.shots = data.shots;
            renderGrid();
        }
    } catch (e) {
        console.error('Failed to fetch shots:', e);
        if (!state.shots.length) {
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

        if (state.lastVersion === null) {
            state.lastVersion = data.version;
        } else if (data.version !== state.lastVersion) {
            state.lastVersion = data.version;
            fetchShots();
        }
    } catch (e) { /* server down, keep quiet */ }
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
        await fetch(`/api/shot/${shotId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
    } catch (e) { console.error(e); }
}

export async function postBatch(action, ids) {
    try {
        await fetch('/api/batch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action, shot_ids: ids})
        });
    } catch (e) { console.error(e); }
}

export function openShot(shotId) {
    postShotAction(shotId, {action: 'open'});
    toast('已切换到该镜头');
}

export function openTimeline() { toast('Timeline view - Phase 2'); }

export async function syncScenes() {
    await fetch('/api/sync', {method: 'POST'});
    toast('Sync 已排队，Blender 将清理孤儿记录');
}
