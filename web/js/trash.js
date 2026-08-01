// trash.js — 垃圾桶弹窗：恢复 / 彻底删除（软删除的镜头在这里管理）
import { fetchShots, postShotAction, postBatch } from './data.js';
import { toast, askConfirm } from './ui.js';

let items = [];

function rowEl(item) {
    const row = document.createElement('div');
    row.className = 'trash-row';

    const name = document.createElement('span');
    name.className = 't-name';
    name.textContent = item.name;
    name.title = item.name;

    const btnRestore = document.createElement('button');
    btnRestore.textContent = '恢复';
    btnRestore.addEventListener('click', async () => {
        const data = await postShotAction(item.id, {action: 'restore'});
        if (data && data.status === 'ok') {
            toast(`已恢复 ${item.name}`);
        } else {
            toast((data && data.message) ? `恢复失败：${data.message}` : '恢复失败', true);
        }
        await refresh();
        fetchShots(true);
    });

    const btnPurge = document.createElement('button');
    btnPurge.className = 'danger';
    btnPurge.textContent = '彻底删除';
    btnPurge.addEventListener('click', async () => {
        if (!await askConfirm(`彻底删除 ${item.name}？场景和文件都会移除，不可恢复。`)) return;
        const data = await postShotAction(item.id, {action: 'purge'});
        if (data && data.status === 'ok') toast(`已彻底删除 ${item.name}`);
        else toast('删除失败', true);
        await refresh();
        fetchShots(true);
    });

    row.append(name, btnRestore, btnPurge);
    return row;
}

async function refresh() {
    try {
        const res = await fetch('/api/trash');
        const data = await res.json();
        items = data.status === 'ok' ? (data.shots || []) : [];
    } catch (e) {
        items = [];
    }
    const list = document.getElementById('trashList');
    list.innerHTML = '';
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'trash-empty';
        empty.textContent = '垃圾桶是空的';
        list.appendChild(empty);
    } else {
        for (const item of items) list.appendChild(rowEl(item));
    }
}

export async function openTrashModal() {
    document.getElementById('trashModal').style.display = 'flex';
    await refresh();
}

export function closeTrashModal() {
    document.getElementById('trashModal').style.display = 'none';
}

export function initTrash() {
    document.getElementById('trashBtn').addEventListener('click', openTrashModal);
    document.getElementById('trashClose').addEventListener('click', closeTrashModal);
    document.getElementById('trashModal').addEventListener('mousedown', (e) => {
        if (e.target.id === 'trashModal') closeTrashModal();
    });
    document.getElementById('trashPurgeAll').addEventListener('click', async () => {
        if (!items.length) { toast('垃圾桶是空的'); return; }
        if (!await askConfirm(`彻底删除垃圾桶里的 ${items.length} 个镜头？不可恢复。`)) return;
        const data = await postBatch('purge', items.map(i => i.id));
        if (data && data.status === 'ok') toast(`已彻底删除 ${data.done ?? items.length} 个镜头`);
        else toast('清空失败', true);
        await refresh();
        fetchShots(true);
    });
}
