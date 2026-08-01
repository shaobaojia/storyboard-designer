// 共享状态：所有模块从这里读写，替代原来的全局 let 变量
export const state = {
    shots: [],
    selectedIds: new Set(),
    anchorId: null,        // Shift 范围选择/方向键的锚点
    dragSrcEl: null,
    contextShotId: null,
    editingId: null,
    marqueeActive: false,
    panning: false,
    lastVersion: null,
    lastErrorTs: null,
    firstLoadDone: false,  // 首屏加载门控只做一次
    trashMode: false,      // 垃圾桶页面模式：宫格复用，菜单只剩恢复/彻底删除
    viewMode: localStorage.getItem('sb-view') || 'grid',  // 'grid' | 'list'
};

export const grid = document.getElementById('grid');
