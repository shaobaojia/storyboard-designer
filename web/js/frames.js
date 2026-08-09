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
import { updatePreview } from './preview.js';

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

// 展开/折叠焦点（v0.9.4）：展开后焦点落第一帧（frame_no 最小）——预览窗口按顺序看图时
// 从本镜头第一帧衔接到下一个镜头；预览同步刷新到该帧
function focusFirstFrame(shotId) {
    const shot = state.shots.find(s => s.id === shotId);
    const fr = (shot && shot.frames) || [];
    if (fr.length > 0) {
        focusFrame(shotId, fr[0].id);
        updatePreview();
    }
}

// 展开：先抓折叠卡 rect 作 origin，toggle+render 后让每个帧格从 origin
// 缩弹回自己的格位（逐格错峰 40ms）
export function expandAnimated(shotId) {
    if (state.viewMode === 'list') {
        const token = _nextToken(shotId);
        toggleExpand(shotId);
        renderGrid();
        focusFirstFrame(shotId);
        // Spring-in: 浮层面板从 0 弹入
        // v0.9.2：按 shotId 精确选本镜头的 panel——批量展开时 querySelector('.list-frames')
        // 只取第一个，导致第二个镜头动画作用到第一个的 panel（静默无动画）
        requestAnimationFrame(() => {
            if (_animToken.get(shotId) !== token) return;
            const panel = grid.querySelector(`.shot-card.list-item[data-id="${shotId}"] .list-frames`);
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
    focusFirstFrame(shotId);
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
    // 分帧播放（v0.9.1 批量展开修复）：起点 transform 必须被浏览器渲染一帧后再清空，
    // 否则 transition 的起点是"上一渲染帧"（批量时 renderGrid 重建后新 cells 已以自然位置
    // 渲染过）→ 从 none 到 none 无过渡 → 该镜头静默无动画（批量第二个镜头必现）
    requestAnimationFrame(() => {
        if (_animToken.get(shotId) !== token) return;
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
    });
}

// 收起：帧格脱离文档流 → renderGrid 立即触发其他卡片 FLIP → 帧格同步飞回封面位置
export function collapseAnimated(shotId) {
    const cells = _frameCells(shotId);
    if (state.viewMode === 'list') {
        // v0.9.2：按 shotId 精确选本镜头的 panel（批量折叠时 querySelector('.list-frames')
        // 只取第一个，第二个镜头动画作用到第一个的 panel）
        const panel = grid.querySelector(`.shot-card.list-item[data-id="${shotId}"] .list-frames`);
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
    // v0.9.30b：折叠不再清 focusedFrameId——折叠态多图封面帧保留焦点框
    //（用户语义：焦点框盖在镜头上；下次展开 focusFirstFrame 会重置，无残留风险）
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
// v0.9.2：列表视图 frame-thumb 共用同一焦点机制（单焦点，宫格/列表互斥）
export function focusFrame(shotId, frameId) {
    // 全局单选：同一时刻只有一个帧格有焦点框
    state.focusedFrameId = frameId;
    // v0.9.32：列表折叠态封面缩略图（.shot-thumb）也参与帧焦点，清除/添加选择器同步
    grid.querySelectorAll('.frame-img.frame-focused, .frame-thumb.frame-focused, .shot-thumb.frame-focused')
        .forEach(el => el.classList.remove('frame-focused'));
    if (frameId) {
        // v0.9.30b：选择器从 .shot-card.frame-cell 放宽到 .shot-card[data-id]——
        // 折叠态多图封面帧（.frame-stack .frame-img.cover）也参与帧焦点（焦点框盖在封面上）
        // v0.9.32：列表折叠态封面缩略图（.thumb-wrap .shot-thumb，带 data-frame-id）同语义
        grid.querySelectorAll(`.shot-card[data-id="${shotId}"] .frame-img[data-frame-id="${frameId}"], .shot-card.list-item[data-id="${shotId}"] .frame-thumb[data-frame-id="${frameId}"], .shot-card.list-item[data-id="${shotId}"] .shot-thumb[data-frame-id="${frameId}"]`)
            .forEach(el => el.classList.add('frame-focused'));
    }
}

// ---- 悬停横向扫视（折叠态一叠牌）----
// 鼠标 X 坐标在卡片宽度内映射到帧索引：左端=第1张，右端=第N张。
// 即时切换（无渐变），靠预载保证跟手。
// 扫视只在缩略图范围内触发（列表视图文字区不扫视，恢复封面）；移出卡片恢复封面（v0.8.3）
function restoreCover(card) {
    if (card.dataset.hoverOrigSrc === undefined) return;
    const coverImg = card.querySelector('.frame-stack .frame-img.cover') || card.querySelector('.shot-thumb');
    if (coverImg) {
        coverImg.src = card.dataset.hoverOrigSrc;
        coverImg.dataset.frameId = card.dataset.hoverOrigFrameId || '';
    }
    delete card.dataset.hoverOrigSrc;
    delete card.dataset.hoverOrigFrameId;
}

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
        // 鼠标不在缩略图/卡片范围内：不扫视，恢复封面（列表文字区 hover 不再触发扫视）
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            restoreCover(card);
            return;
        }
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const idx = Math.min(shot.frames.length - 1, Math.floor(ratio * shot.frames.length));
        const frame = shot.frames[idx];
        if (!frame || !frame.imageUrl) return;

        const coverImg = card.querySelector('.frame-stack .frame-img.cover') || card.querySelector('.shot-thumb');
        if (coverImg && coverImg.dataset.frameId !== frame.id) {
            // 首次扫视：记住原始 src/frameId，鼠标移出时恢复封面（v0.8.3 修复悬停后不回到封面）
            if (card.dataset.hoverOrigSrc === undefined) {
                card.dataset.hoverOrigSrc = coverImg.src;
                // 列表视图 .shot-thumb 无 data-frame-id（undefined），存 '' 避免恢复出 "undefined" 字符串
                card.dataset.hoverOrigFrameId = coverImg.dataset.frameId || '';
            }
            coverImg.src = frame.imageUrl;
            coverImg.dataset.frameId = frame.id;
        }
    });

    // 鼠标移出折叠卡：恢复封面帧（v0.8.3）
    document.addEventListener('mouseout', (e) => {
        const card = e.target.closest('.shot-card.multi:not(.expanded), .list-item.multi:not(.expanded)');
        if (!card) return;
        // 还在卡片内移动（子元素之间），不恢复
        if (card.contains(e.relatedTarget)) return;
        restoreCover(card);
    });
}
