// 共享状态：所有模块从这里读写，替代原来的全局 let 变量
export const state = {
    shots: [],
    selectedIds: new Set(),
    dragSrcEl: null,
    contextShotId: null,
    editingId: null,
    marqueeActive: false,
    panning: false,
    lastVersion: null,
    lastErrorTs: null,
    viewMode: localStorage.getItem('sb-view') || 'grid',  // 'grid' | 'list'
};

export const grid = document.getElementById('grid');
