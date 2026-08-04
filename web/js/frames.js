// 多图镜头：展开/折叠状态 + 交互入口
// 契约（v0.9.0 第二轮）：
//   双击展开态帧格 = 跳回该构图
//   双击折叠态多图 = 展开
//   空格 = 展开/折叠
//   回车/右键 = 打开 Blender
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
    if (state.viewMode === 'list') {
        const token = _nextToken(shotId);
        toggleExpand(shotId);
        renderGrid();
        // Spring-in: 浮层面板从 0 弹入
        requestAnimationFrame(() => {
            if (_animToken.get(shotId) !== token) return;
            const panel = grid.querySelector('.list-frames');
            if (!panel) return;
            panel.style.transformOrigin = 'top left';
            panel.style.transition = 'none';
            panel.style.transform = 'scaleX(0)';panel.style.maxWidth = '0';
            panel.style.opacity = '0';
            void panel.offsetWidth;
            panel.style.transition = 'transform 0.45s ' + SPRING + ', opacity 0.25s ease';
            panel.style.transform = 'scaleX(1)';panel.style.maxWidth = '';
            panel.style.opacity = '1';
            setTimeout(() => {
                if (_animToken.get(shotId) !== token) return;
                panel.style.transition = '';
                panel.style.transformOrigin = '';
            }, 500);
        });
        return;
    }
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

// 收起：帧格脱离文档流 → renderGrid 立即触发其他卡片 FLIP → 帧格同步飞回封面位置
export function collapseAnimated(shotId) {
    const cells = _frameCells(shotId);
    if (state.viewMode === 'list') {
        const panel = grid.querySelector('.list-frames');
        if (panel) {
            panel.style.transformOrigin = 'top left';
            panel.style.transition = 'transform 0.3s ease-in, opacity 0.2s ease';
            panel.style.transform = 'scaleX(0.8)';
            panel.style.opacity = '0';
            setTimeout(() => {
                toggleExpand(shotId);
                renderGrid();
            }, 320);
        }
        return;
    }
    if (cells.length === 0) {
        toggleExpand(shotId); renderGrid(); return;
    }
    const token = _nextToken(shotId);
    state.animatingShots.add(shotId);

    // 1. 记录各帧格当前屏幕位置，然后脱离文档流（absolute 定位在原地）
    const rects = cells.map(c => c.getBoundingClientRect());
    const parent = cells[0].parentNode;
    const scrollY = window.scrollY;
    cells.forEach((cell, i) => {
        const r = rects[i];
        cell.style.position = 'fixed';
        cell.style.left = r.left + 'px';
        cell.style.top = r.top + 'px';
        cell.style.width = r.width + 'px';
        cell.style.margin = '0';
        cell.style.zIndex = String(50 + i);
        cell.style.transformOrigin = 'top left';
        cell.style.transition = 'none';
        cell.style.transform = 'none';
        document.body.appendChild(cell);
    });

    // 2. 立即 toggle + renderGrid：帧格已脱离流，其他卡片 FLIP 直接开始
    state.focusedFrameId = null;  // 折叠后清焦点，防止下次展开残留蓝框
    toggleExpand(shotId);
    renderGrid();

    // 3. 帧格同步飞向第一格（封面位置），底衬/背景同步淡出
    const target = rects[0];
    const n = cells.length;
    const totalDuration = 380;  // 收拢总时长，比展开略快
    cells.forEach((cell, i) => {
        const r = rects[i];
        const s = target.width / r.width;
        const d = (n - 1 - i) * 30;
        // 底衬背景先开始淡出，与位移同步结束
        cell.style.transition = `transform ${totalDuration}ms ${SPRING} ${d}ms, opacity ${totalDuration * 0.6}ms ease ${d * 0.8}ms`;
        cell.style.transform = `translate(${target.left - r.left}px, ${target.top - r.top}px) scale(${s})`;
        cell.style.opacity = '0';
    });

    // 4. 动画结束时清理浮层（与最后一张帧格淡出同步）
    const ttl = totalDuration + (n - 1) * 30 + 20;
    setTimeout(() => {
        if (_animToken.get(shotId) !== token) { cells.forEach(c => c.remove()); return; }
        cells.forEach(c => c.remove());
        state.animatingShots.delete(shotId);
    }, ttl);
}

// 展开态双击某张图 = 跳回构图（切 Scene + 时间轴跳帧）
export async function jumpToFrame(shotId, frameNo) {
    await postShotAction(shotId, { action: 'jump_to_frame', frame_no: frameNo });
}

// 展开态焦点帧（v0.8.1）：蓝框跟手点击，只动 class 不动 DOM
export function focusFrame(shotId, frameId) {
    // 全局单选：同一时刻只有一个帧格有焦点框
    state.focusedFrameId = frameId;
    grid.querySelectorAll('.frame-img.frame-focused')
        .forEach(img => img.classList.remove('frame-focused'));
    if (frameId) {
        grid.querySelectorAll(`.shot-card.frame-cell[data-id="${shotId}"] .frame-img[data-frame-id="${frameId}"]`)
            .forEach(img => img.classList.add('frame-focused'));
    }
}

// ---- 悬停横向扫视（折叠态一叠牌）----
// 鼠标 X 坐标在卡片宽度内映射到帧索引：左端=第1张，右端=第N张。
// 即时切换（无渐变），靠预载保证跟手。
export function initStackHover() {
    document.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.shot-card.multi:not(.expanded), .list-item.multi:not(.expanded)');
        if (!card) return;
        const shot = state.shots.find(s => s.id === card.dataset.id);
        if (!shot || !shot.frames || shot.frames.length < 2) return;

        // 列表视图：用缩略图范围；宫格视图：用卡片范围
        const thumb = card.classList.contains('list-item')
            ? card.querySelector('.shot-thumb, .frame-img.cover')
            : null;
        const targetEl = thumb || card;
        const rect = targetEl.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const idx = Math.min(shot.frames.length - 1, Math.floor(ratio * shot.frames.length));
        const frame = shot.frames[idx];
        if (!frame || !frame.imageUrl) return;

        const coverImg = card.querySelector('.frame-stack .frame-img.cover') || card.querySelector('.shot-thumb');
        if (coverImg && coverImg.dataset.frameId !== frame.id) {
            coverImg.src = frame.imageUrl;
            coverImg.dataset.frameId = frame.id;
        }
    });
}
