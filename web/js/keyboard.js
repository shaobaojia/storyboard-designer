// 键盘快捷键：Ctrl+A 全选 / Delete 删除 / Enter 打开（单选时）
import { state } from './state.js';
import { selectAll, deleteSelection } from './selection.js';
import { openShot } from './data.js';

export function initKeyboard() {
    document.addEventListener('keydown', async (e) => {
        if (state.editingId) return;
        if (document.getElementById('createModal').style.display === 'flex') return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectAll();
        } else if (e.key === 'Delete' && state.selectedIds.size > 0) {
            e.preventDefault();
            await deleteSelection();
        } else if (e.key === 'Enter' && state.selectedIds.size === 1) {
            e.preventDefault();
            const id = [...state.selectedIds][0];
            openShot(id);
        }
    });
}
