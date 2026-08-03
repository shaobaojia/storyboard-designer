// 多图镜头：展开/折叠状态 + 交互入口（双击/空格/悬停扫视/跳回构图）
// 契约：AGENTS.md 多图镜头接口契约（2026-08-01 用户拍板）
//   双击/空格 = 展开/折叠（统一，不分单图多图）
//   右键/回车 = 打开镜头（Blender）
//   展开态双击某张图 = 跳回该构图（shot_id + frame_no）
// 状态：展开是视图态，不写库，刷新恢复全折叠
import { state, grid } from './state.js';
import { postShotAction } from './data.js';
import { renderGrid } from './render.js';

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

// ---- 展开/收起弹簧动效编排（v0.8.0，招牌时刻）----
// 展开 = 折叠卡"弹开"成一排帧格；收起 = 帧格逐张"飞回"一叠牌。
// 动画期间 shotId 挂进 state.animatingShots，renderGrid 的 FLIP 和
// fade-in 会跳过这些卡片（见 render.js），transform 全由这里接管。
// 后台标签页 rAF/setTimeout 被冻结时视觉降级为瞬时切换，结构不受影响。

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const _animToken = new Map();  // shotId -> 代数：快速连点时旧定时器不得清掉新动画

function _nextToken(shotId) {
    const t = (_animToken.get(shotId) || 0) + 1;
    _animToken.set(shotId, t);
    return t;
}

function _frameCells(shotId) {
    return [...grid.querySelectorAll(`.shot-card.frame-cell[data-id="${shotId}"]`)];
}

function _clearCellStyle(cell) {
    cell.style.transition = '';
    cell.style.transform = '';
    cell.style.opacity = '';
    cell.style.transformOrigin = '';
    cell.style.zIndex = '';
}

// 展开：先抓折叠卡 rect 作 origin，toggle+render 后让每个帧格从 origin
// 缩弹回自己的格位（逐格错峰 40ms）
export function expandAnimated(shotId) {
    if (state.viewMode === 'list') { toggleExpand(shotId); renderGrid(); return; }
    const token = _nextToken(shotId);
    const collapsed = grid.querySelector(`.shot-card[data-id="${shotId}"]:not(.frame-cell)`);
    const origin = collapsed ? collapsed.getBoundingClientRect() : null;
    state.animatingShots.add(shotId);
    toggleExpand(shotId);
    renderGrid();
    const cells = _frameCells(shotId);
    if (!origin || cells.length === 0) {
        // 无 origin（如收起动画中途反悔再展开）：清掉残留内联样式，瞬时呈现
        cells.forEach(_clearCellStyle);
        state.animatingShots.delete(shotId);
        return;
    }
    cells.forEach((cell) => {
        const r = cell.getBoundingClientRect();
        const s = origin.width / r.width;
        cell.style.transformOrigin = 'top left';
        cell.style.transition = 'none';
        cell.style.transform = `translate(${origin.left - r.left}px, ${origin.top - r.top}px) scale(${s})`;
        cell.style.opacity = '0.4';
        cell.style.zIndex = '30';
    });
    void grid.offsetWidth;  // 强制 reflow，让起始姿态先生效
    cells.forEach((cell, i) => {
        const d = i * 40;
        cell.style.transition = `transform 0.5s ${SPRING} ${d}ms, opacity 0.32s ease ${d}ms`;
        cell.style.transform = '';
        cell.style.opacity = '';
    });
    setTimeout(() => {
        if (_animToken.get(shotId) !== token) return;  // 期间又触发了收起，别清
        cells.forEach((cell) => {
            cell.style.transition = '';
            cell.style.transformOrigin = '';
            cell.style.zIndex = '';
        });
        state.animatingShots.delete(shotId);
    }, 500 + (cells.length - 1) * 40 + 80);
}

// 收起：帧格逐张飞向第一格位置（远处的先收，非首格淡出），到齐后
// 再 toggle+render——折叠卡恰好出现在收敛点，其余卡片走 FLIP 让位
export function collapseAnimated(shotId) {
    const cells = _frameCells(shotId);
    if (state.viewMode === 'list' || cells.length === 0) {
        toggleExpand(shotId); renderGrid(); return;
    }
    const token = _nextToken(shotId);
    state.animatingShots.add(shotId);
    const target = cells[0].getBoundingClientRect();
    const n = cells.length;
    cells.forEach((cell, i) => {
        const r = cell.getBoundingClientRect();
        const s = target.width / r.width;
        const d = (n - 1 - i) * 35;
        cell.style.transformOrigin = 'top left';
        cell.style.zIndex = String(30 + i);
        cell.style.transition = `transform 0.4s ${SPRING} ${d}ms, opacity 0.25s ease ${d + 100}ms`;
        cell.style.transform = `translate(${target.left - r.left}px, ${target.top - r.top}px) scale(${s})`;
        if (i > 0) cell.style.opacity = '0';
    });
    setTimeout(() => {
        if (_animToken.get(shotId) !== token) return;
        toggleExpand(shotId);
        renderGrid();
        state.animatingShots.delete(shotId);
    }, 400 + (n - 1) * 35 + 60);
}

// 展开态双击某张图 = 跳回构图（切 Scene + 时间轴跳帧）
export async function jumpToFrame(shotId, frameNo) {
    await postShotAction(shotId, { action: 'jump_to_frame', frame_no: frameNo });
}

// 展开态焦点帧（v0.8.1）：蓝框跟手点击，只动 class 不动 DOM
export function focusFrame(shotId, frameId) {
    state.focusedFrameId = frameId;
    grid.querySelectorAll(`.shot-card.frame-cell[data-id="${shotId}"] .frame-img`)
        .forEach(img => img.classList.toggle('frame-focused', img.dataset.frameId === frameId));
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
