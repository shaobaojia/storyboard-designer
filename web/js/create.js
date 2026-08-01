// 创建镜头对话框：打开时预填下一个编号名，回车提交、Esc/点遮罩关闭
import { toast } from './ui.js';
import { fetchShots } from './data.js';

export async function openCreateModal() {
    const modal = document.getElementById('createModal');
    modal.style.display = 'flex';
    try {
        const res = await fetch('/api/next_name');
        const data = await res.json();
        document.getElementById('createName').value = data.name || 'c0010';
    } catch (e) {
        document.getElementById('createName').value = 'c0010';
    }
    const input = document.getElementById('createName');
    input.focus();
    input.select();
}

export function closeCreateModal() {
    document.getElementById('createModal').style.display = 'none';
}

export async function submitCreate() {
    const name = document.getElementById('createName').value.trim();
    const duration = parseFloat(document.getElementById('createDuration').value) || 2.0;
    if (!name) { toast('镜头名不能为空', true); return; }
    closeCreateModal();
    try {
        const res = await fetch('/api/shots', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name, duration})
        });
        const data = await res.json();
        if (data.status !== 'ok') {
            toast(data.message || '创建失败', true);
        }
    } catch (e) {
        toast('创建请求失败', true);
    }
    fetchShots();
}

export function initCreateModal() {
    const modal = document.getElementById('createModal');
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitCreate();
        else if (e.key === 'Escape') closeCreateModal();
    });
    modal.addEventListener('click', (e) => {
        if (e.target.id === 'createModal') closeCreateModal();
    });
    modal.querySelector('.btn-cancel').addEventListener('click', closeCreateModal);
    modal.querySelector('.btn-primary').addEventListener('click', submitCreate);
}
