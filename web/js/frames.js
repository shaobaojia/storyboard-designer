// 多图镜头：展开/折叠状态 + 交互入口（双击/空格/悬停扫视/跳回构图）
// 契约：AGENTS.md 多图镜头接口契约（2026-08-01 用户拍板）
//   双击/空格 = 展开/折叠（统一，不分单图多图）
//   右键/回车 = 打开镜头（Blender）
//   展开态双击某张图 = 跳回该构图（shot_id + frame_no）
// 状态：展开是视图态，不写库，刷新恢复全折叠
import { state } from './state.js';
import { postShotAction } from './data.js';

// expandedShotIds 挂在 state 上（state.js 初始化 Set），此处只做读写

export function isExpanded(shotId) {
    return state.expandedShotIds.has(shotId);
}

export function toggleExpand(shotId) {
    if (state.expandedShotIds.has(shotId)) {
        state.expandedShotIds.delete(shotId);
    } else {
        state.expandedShotIds.add(shotId);
    }
}

export function collapseAll() {
    state.expandedShotIds.clear();
}

// 展开态双击某张图 = 跳回构图（切 Scene + 时间轴跳帧）
export async function jumpToFrame(shotId, frameNo) {
    await postShotAction(shotId, { action: 'jump_to_frame', frame_no: frameNo });
}

// ---- 悬停横向扫视（折叠态一叠牌）----
// 鼠标 X 坐标在卡片宽度内映射到帧索引：左端=第1张，右端=第N张。
// 即时切换（无渐变），靠预载保证跟手。
export function initStackHover() {
    document.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.shot-card.multi:not(.expanded)');
        if (!card) return;
        const shot = state.shots.find(s => s.id === card.dataset.id);
        if (!shot || !shot.frames || shot.frames.length < 2) return;

        const rect = card.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const idx = Math.min(shot.frames.length - 1, Math.floor(ratio * shot.frames.length));
        const frame = shot.frames[idx];
        if (!frame || !frame.imageUrl) return;

        const coverImg = card.querySelector('.frame-stack .frame-img.cover');
        if (coverImg && coverImg.dataset.frameId !== frame.id) {
            coverImg.src = frame.imageUrl;
            coverImg.dataset.frameId = frame.id;
        }
    });
}
