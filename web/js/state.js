// 共享状态：所有模块从这里读写，替代原来的全局 let 变量
export const state = {
    shots: [],
    selectedIds: new Set(),
    anchorId: null,        // Shift 范围选择/方向键的锚点
    dragSrcEl: null,
    contextShotId: null,
    contextFrameId: null,  // 帧级右键菜单：右键点在哪张帧上（v0.7.0）
    editingId: null,
    marqueeActive: false,
    panning: false,
    lastVersion: null,
    lastErrorTs: null,
    firstLoadDone: false,  // 首屏加载门控只做一次
    trashMode: false,      // 垃圾桶页面模式：宫格复用，菜单只剩恢复/彻底删除
    viewMode: localStorage.getItem('sb-view') || 'grid',  // 'grid' | 'list'
    expandedShotIds: new Set(),  // 多图镜头展开态（视图态，不写库，刷新全折叠 v0.7.0）
    animatingShots: new Set(),   // 弹簧编排接管中的 shotId：renderGrid 跳过它们的 FLIP/入场（v0.8.0）
    focusedFrameId: null,        // 展开态焦点帧：蓝框跟手点击，默认落封面（v0.8.1）
    previewOn: false,            // 预览框开关（v0.9.4，视图态不写库）
    previewSide: 'right',        // 预览框贴边方向：'right' | 'left'
    lastClickId: null,           // 最后点击/移动到的镜头 id（预览框显示对象，多选时取它）
    dialogueOn: localStorage.getItem('sb-dialogue-on') !== '0',  // 宫格台词条全局开关（v0.9.8，默认开）
    aspect: 16 / 9,              // 项目画幅比（v0.9.7，/api/project 拉取；不写 localStorage 防多项目串味）
    resolution: null,            // {x, y} 项目分辨率（画幅对话框预填）
};

// 已有帧图的基准画幅比（用户拍板：镜头里已有的图以 16:9 为基准，宽比裁上下、高比上下留空）
export const SRC_ASPECT = 16 / 9;

export const grid = document.getElementById('grid');
