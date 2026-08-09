// 时间线视图（v0.9.36）：顶部预览区 + 底部时间线区
// 时间线：所有镜头按 seq 顺序横向排布，宽 ∝ duration（PX_PER_SEC 固定刻度，决策 5A），
// 带时间标尺；台词在独立轨道排（决策 2A：台词块 = 镜头时间区间，零数据模型改动），
// T 开关控制台词轨道显隐；预览区大图下方字幕浮层居中显示台词（电影字幕位，决策 3A）。
// 复用：clip 带 .shot-card/.shot-name → 点击选中/右键菜单/删除/改名/搜索定位全部自动生效；
// 大图链路复用 preview.js 的 showPreviewImage（先小图后大图 + 预载缓存）。
import { state, grid } from './state.js';
import { showPreviewImage, stillUrl } from './preview.js';
import { updateStats } from './render.js';  // 循环引用：仅函数体引用，安全

const PX_PER_SEC = 100;    // 时间刻度（决策 5A：v1 固定，后续接缩放滑块）
const RULER_STEP = 5;      // 标尺刻度间隔（秒）
let lastRanges = [];       // 最近一次渲染的镜头时间区间（updateTimelineStage 复用，避免重算）

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function coverFrame(shot) {
    const fs = shot.frames || [];
    return fs.find(f => f.isCover) || fs[0] || null;
}

// 镜头时间区间：起点 = 之前所有镜头 duration 累加（seq 顺序）
function shotRanges() {
    let acc = 0;
    return state.shots.map(s => {
        const dur = Math.max(0.1, Number(s.duration) || 2);
        const r = { start: acc, dur, shot: s };
        acc += dur;
        return r;
    });
}

function fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
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

// 时间线区（标尺 + 镜头轨道 + 台词轨道），每次渲染重建内部、容器常驻
function buildTimeline() {
    if (document.getElementById('timeline')) return;
    const tl = document.createElement('div');
    tl.id = 'timeline';
    tl.innerHTML = `
        <div class="tl-inner" id="tlInner">
            <div class="tl-ruler" id="tlRuler"></div>
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
    const r = lastRanges.find(x => x.shot.id === shot.id);
    timeEl.textContent = r ? `${fmtTime(r.start)} – ${fmtTime(r.start + r.dur)}` : '';
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
    // v0.9.36：时间线刻度固定（决策 5A）——每次渲染强制禁用缩放控件。
    // 不能只靠 setView：刷新后 localStorage 直接落在 timeline 模式时 setView 不执行，
    // 滑块会保持可用（实测 bug）
    ['sizeSlider', 'zoomOut', 'zoomIn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });
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
    lastRanges = shotRanges();

    if (state.shots.length === 0) {
        grid.classList.add('grid-empty');
        const tl = document.getElementById('timeline');
        if (tl) tl.remove();
        updateTimelineStage();
        updateStats();  // 标题 + 右下角统计（空态 0 镜头）
        return;
    }
    buildTimeline();

    // 滚动位置保持（差分重建不跳位——同 renderGrid 的 savedScrollY 手法）
    const tl = document.getElementById('timeline');
    const prevScroll = tl.scrollLeft;
    const inner = document.getElementById('tlInner');
    const totalSec = lastRanges.reduce((a, r) => a + r.dur, 0);
    const totalW = totalSec * PX_PER_SEC;
    inner.style.width = Math.max(totalW, tl.clientWidth) + 'px';

    // 时间标尺：每 5s 一个刻度 + 时间标签
    const ruler = document.getElementById('tlRuler');
    const ticks = [];
    for (let t = 0; t <= totalSec + 0.001; t += RULER_STEP) {
        ticks.push(`<div class="tl-tick" style="left:${(t * PX_PER_SEC).toFixed(1)}px"><span>${fmtTime(t)}</span></div>`);
    }
    ruler.innerHTML = ticks.join('');

    // 镜头轨道：clip = 封面缩略图 + 名字（.shot-name 复用双击改名/右键重命名）
    const lane = document.getElementById('tlShotLane');
    lane.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const r of lastRanges) {
        const s = r.shot;
        const f = coverFrame(s);
        const w = Math.max(20, r.dur * PX_PER_SEC);
        const clip = document.createElement('div');
        clip.className = 'shot-card timeline-clip' + (state.selectedIds.has(s.id) ? ' selected' : '');
        clip.dataset.id = s.id;
        clip.style.left = (r.start * PX_PER_SEC).toFixed(1) + 'px';
        clip.style.width = w.toFixed(1) + 'px';
        const thumb = f && f.imageUrl
            ? `<img class="tl-clip-thumb" loading="lazy" src="${esc(f.imageUrl)}" alt="">`
            : '<div class="tl-clip-thumb tl-clip-nothumb">无图</div>';
        clip.innerHTML = `${thumb}<div class="shot-name tl-clip-name" title="${esc(s.name)}">${esc(s.name)}</div>`;
        frag.appendChild(clip);
    }
    lane.appendChild(frag);

    // 台词轨道（决策 2A：台词块 = 镜头时间区间，独立一排；T 开关控制显隐）
    const dlgLane = document.getElementById('tlDlgLane');
    dlgLane.innerHTML = '';
    if (state.dialogueOn && !state.trashMode) {
        const dfrag = document.createDocumentFragment();
        for (const r of lastRanges) {
            const dlg = (r.shot.dialogue || '').trim();
            if (!dlg) continue;
            const w = Math.max(20, r.dur * PX_PER_SEC);
            const box = document.createElement('div');
            box.className = 'tl-dlg-clip';
            box.title = dlg.replace(/\n/g, ' ');
            box.style.left = (r.start * PX_PER_SEC).toFixed(1) + 'px';
            box.style.width = w.toFixed(1) + 'px';
            box.textContent = dlg.replace(/\n/g, ' ');
            dfrag.appendChild(box);
        }
        dlgLane.appendChild(dfrag);
    }

    tl.scrollLeft = prevScroll;
    updateTimelineStage();
}
