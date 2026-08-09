// 时间线视图（v0.9.37 改版）：顶部预览区 + 底部缩略图横排区
// v0.9.37 用户拍板：去时间轴语义——时间标尺去掉、clip 等宽（不再按时长定长）、
// 缩略图统一 4:3（104×78 居中）、缩放只缩放横轴（clip 宽档位 104~320，纵向固定）。
// 复用：clip 带 .shot-card/.shot-name → 点击选中/右键菜单/删除/改名/搜索定位全部自动生效；
// 大图链路复用 preview.js 的 showPreviewImage（先小图后大图 + 预载缓存）。
import { state, grid } from './state.js';
import { showPreviewImage, stillUrl } from './preview.js';
import { updateStats } from './render.js';  // 循环引用：仅函数体引用，安全

const CLIP_H = 100;      // clip 总高（thumb 78 + 名字条 18），纵向固定 = 只缩放横轴
const CLIP_GAP = 12;     // clip 水平间距
const THUMB_W = 104;     // 4:3 缩略图宽（78 × 4/3）
const THUMB_H = 78;      // 4:3 缩略图高（clip 高 - 名字 18 - 顶距 4）
const TL_W_MIN = THUMB_W;      // clip 宽下限 = 缩略图宽
const TL_W_MAX = 320;          // clip 宽上限
const TL_W_STEP = 24;          // 缩放档位步进（104/128/152/176/200/.../320，10 档）
const TL_W_KEY = 'sb-tl-w';    // clip 宽持久化键
let lastOrder = [];            // 最近一次渲染的镜头顺序（updateTimelineStage 复用，避免重算）

// 当前 clip 宽（localStorage 持久化，缩放只改它）
export function tlClipW() {
    return parseInt(localStorage.getItem(TL_W_KEY) || '', 10) || 200;
}

// 档位化写入（zoom.js 调用：滑块/Ctrl 滚轮/Ctrl++- 共用）
export function setTlClipW(w) {
    const n = Math.round((w - TL_W_MIN) / TL_W_STEP);
    const v = Math.min(TL_W_MAX, Math.max(TL_W_MIN, TL_W_MIN + n * TL_W_STEP));
    localStorage.setItem(TL_W_KEY, String(v));
    return v;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function coverFrame(shot) {
    const fs = shot.frames || [];
    return fs.find(f => f.isCover) || fs[0] || null;
}

// 镜头顺序（v0.9.37：去时间轴语义后无时间区间，只有 seq 顺序）
function shotOrder() {
    return state.shots.map((shot, idx) => ({ shot, idx }));
}

// ---- 顶部预览区（惰性建一次，之后只更新内容——img 不重建避免闪烁）----
// v0.9.36：纯 DOM 存在性判断——renderGrid 切走时会 remove stage，标志位会失真
// （曾实测：stage 被清后标志仍 true，重建被跳过 = 空预览区）
function buildStage() {
    if (document.getElementById('timelineStage')) return;
    const stage = document.createElement('div');
    stage.id = 'timelineStage';
    stage.innerHTML = `
        <div class="tl-stage-body">
            <img id="tlStageImg" alt="" style="display:none;">
            <div id="tlStageEmpty" class="tl-stage-empty">未选中镜头</div>
            <div id="tlSubtitle" class="subtitle-overlay" style="display:none;"></div>
        </div>
        <div class="tl-stage-info">
            <span id="tlStageName">—</span>
            <span id="tlStageDur">—</span>
            <span id="tlStageTime">—</span>
        </div>`;
    grid.appendChild(stage);
}

// 时间线区（缩略图横排），每次渲染重建内部、容器常驻（v0.9.37：标尺已去掉）
function buildTimeline() {
    if (document.getElementById('timeline')) return;
    const tl = document.createElement('div');
    tl.id = 'timeline';
    tl.innerHTML = `
        <div class="tl-inner" id="tlInner">
            <div class="tl-lane tl-shot-lane" id="tlShotLane"></div>
            <div class="tl-lane tl-dlg-lane" id="tlDlgLane"></div>
        </div>`;
    grid.appendChild(tl);
}

// 预览区更新（preview.js 的 updatePreview 在时间线模式下转发到这里，
// 点击/清空选中/心跳刷新后自动跟随——复用同一调用链，零新增调用点）
export function updateTimelineStage() {
    const img = document.getElementById('tlStageImg');
    if (!img) return;  // 时间线还没渲染过
    const emptyEl = document.getElementById('tlStageEmpty');
    const sub = document.getElementById('tlSubtitle');
    const nameEl = document.getElementById('tlStageName');
    const durEl = document.getElementById('tlStageDur');
    const timeEl = document.getElementById('tlStageTime');
    let targetId = (state.lastClickId && state.shots.some(s => s.id === state.lastClickId))
        ? state.lastClickId : null;
    if (!targetId) targetId = [...state.selectedIds][0] || null;
    const shot = targetId ? state.shots.find(s => s.id === targetId) : null;
    if (!shot) {
        img.style.display = 'none';
        emptyEl.style.display = 'block';
        emptyEl.textContent = '未选中镜头';
        sub.style.display = 'none';
        nameEl.textContent = '—';
        durEl.textContent = '—';
        timeEl.textContent = '—';
        return;
    }
    const frame = coverFrame(shot);
    nameEl.textContent = shot.name;
    durEl.textContent = (Number(shot.duration) || 0).toFixed(1) + 's';
    // v0.9.37：去时间轴语义——原时间区间显示改为镜头序号
    const o = lastOrder.find(x => x.shot.id === shot.id);
    timeEl.textContent = o ? `第 ${o.idx + 1} 镜` : '';
    if (frame && frame.imageUrl) {
        img.style.display = 'block';
        emptyEl.style.display = 'none';
        // v0.9.36：showPreviewImage 默认写侧边预览框的 img——时间线 stage 必须传 target
        showPreviewImage(frame.imageUrl, stillUrl(frame.imageUrl), img);
    } else {
        img.style.display = 'none';
        emptyEl.style.display = 'block';
        emptyEl.textContent = `${shot.name} · 暂无图片`;
    }
    // 字幕浮层：大图下方居中（电影字幕位），跟随 T 开关
    const dlg = (shot.dialogue || '').trim();
    if (dlg && state.dialogueOn) {
        sub.style.display = 'block';
        sub.textContent = dlg.replace(/\n/g, ' ');
    } else {
        sub.style.display = 'none';
    }
}

// 时间线渲染（renderGrid 的 timeline 分支转发入口）
export function renderTimeline() {
    // 骨架层清掉（对应 renderGrid 的 removeSkeleton）
    const skel = document.getElementById('skelLayer');
    if (skel) {
        skel.classList.add('out');
        setTimeout(() => skel.remove(), 420);
    }
    // v0.9.36：清掉宫格/列表视图残留的卡片——timeline 是 flex column 布局，残留的
    // .shot-card 会以全宽 flex item 排开（每张 ~830px 高，76 张 ≈ 48000px），
    // 把 stage/timeline 推到页面深处（实测：DOM 断言全过但视觉全毁）
    // 只清直接子元素，保留 stage/timeline 容器自身
    [...grid.children].forEach(el => {
        if (el.id !== 'timelineStage' && el.id !== 'timeline') el.remove();
    });
    // 模式 class：timeline 布局覆盖 grid 布局；列表列头隐藏
    grid.classList.add('timeline-mode');
    grid.classList.remove('grid-empty', 'list-mode');
    const lh = document.getElementById('listHeader');
    if (lh) lh.classList.remove('on');

    buildStage();
    lastOrder = shotOrder();

    if (state.shots.length === 0) {
        grid.classList.add('grid-empty');
        const tl = document.getElementById('timeline');
        if (tl) tl.remove();
        updateTimelineStage();
        updateStats();  // 标题 + 右下角统计（空态 0 镜头）
        return;
    }
    buildTimeline();

    // v0.9.37：缩放控件在时间线可用（横轴缩放 clip 宽）——滑块范围/值同步
    syncTlSlider();

    // 滚动位置保持（差分重建不跳位——同 renderGrid 的 savedScrollY 手法）
    const tl = document.getElementById('timeline');
    const prevScroll = tl.scrollLeft;
    const inner = document.getElementById('tlInner');
    const clipW = tlClipW();
    const n = lastOrder.length;
    const totalW = n * clipW + (n - 1) * CLIP_GAP + 32;  // 32 = 左右 16px padding
    inner.style.width = Math.max(totalW, tl.clientWidth) + 'px';

    // 镜头轨道：clip = 等宽缩略图（4:3）+ 名字（.shot-name 复用双击改名/右键重命名）
    // v0.9.37：clip 宽 = 横轴缩放值（不再∝时长），顺序均布（left = idx × (clipW + GAP)）
    const lane = document.getElementById('tlShotLane');
    lane.innerHTML = '';
    const frag = document.createDocumentFragment();
    lastOrder.forEach(({ shot, idx }) => {
        const s = shot;
        const f = coverFrame(s);
        const clip = document.createElement('div');
        clip.className = 'shot-card timeline-clip' + (state.selectedIds.has(s.id) ? ' selected' : '');
        clip.dataset.id = s.id;
        clip.style.left = (16 + idx * (clipW + CLIP_GAP)) + 'px';
        clip.style.width = clipW + 'px';
        const thumb = f && f.imageUrl
            ? `<img class="tl-clip-thumb" loading="lazy" src="${esc(f.imageUrl)}" alt="">`
            : '<div class="tl-clip-thumb tl-clip-nothumb">无图</div>';
        clip.innerHTML = `${thumb}<div class="shot-name tl-clip-name" title="${esc(s.name)}">${esc(s.name)}</div>`;
        frag.appendChild(clip);
    });
    lane.appendChild(frag);

    // 台词轨道（v0.9.37：台词块 = 镜头 clip 同宽同位，与镜头一一对齐；T 开关控制显隐）
    const dlgLane = document.getElementById('tlDlgLane');
    dlgLane.innerHTML = '';
    if (state.dialogueOn && !state.trashMode) {
        const dfrag = document.createDocumentFragment();
        lastOrder.forEach(({ shot, idx }) => {
            const dlg = (shot.dialogue || '').trim();
            if (!dlg) return;
            const box = document.createElement('div');
            box.className = 'tl-dlg-clip';
            box.title = dlg.replace(/\n/g, ' ');
            box.style.left = (16 + idx * (clipW + CLIP_GAP)) + 'px';
            box.style.width = clipW + 'px';
            box.textContent = dlg.replace(/\n/g, ' ');
            dfrag.appendChild(box);
        });
        dlgLane.appendChild(dfrag);
    }

    tl.scrollLeft = prevScroll;
    updateTimelineStage();
}

// 缩放控件同步到时间线横轴档位（v0.9.37：滑块 value = 档位序号，0..(TL_W_MAX-TL_W_MIN)/STEP）
function syncTlSlider() {
    const sl = document.getElementById('sizeSlider');
    if (!sl) return;
    const steps = Math.round((TL_W_MAX - TL_W_MIN) / TL_W_STEP);
    sl.min = 0;
    sl.max = steps;
    sl.step = 1;
    sl.disabled = false;
    sl.value = Math.round((tlClipW() - TL_W_MIN) / TL_W_STEP);
    const out = document.getElementById('zoomOut');
    const inn = document.getElementById('zoomIn');
    if (out) out.disabled = false;
    if (inn) inn.disabled = false;
}
