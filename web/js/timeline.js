// 时间线视图（v0.9.38c 改版）：顶部预览区 + 底部缩略图横排区
// v0.9.37 用户拍板：去时间轴语义——时间标尺去掉、clip 等宽（不再按时长定长）。
// v0.9.38 用户拍板：缩略图完整显示（contain 不裁切）+ 左对齐 + 宽 100% 跟随 clip 缩放；clip 宽下限 104→52。
// v0.9.38b 用户拍板：缩略图等比缩放——aspect-ratio 4:3 区域随 clip 宽等比（纵向不再固定 78），clip 高动态。
// v0.9.38c 用户拍板：预览区/缩略图区比例可拖动调节（分隔条），默认 7:3，localStorage 持久化。
// v0.9.40 用户拍板（方案 A）：比例改为按缩略图大小完全自适应——缩略图区高度恒 = 内容需要
// （台词轨道 38 + clip 高 + 留白 12），预览区吃剩余空间；分隔条拖动移除（sb-tl-split 作废）。
// 复用：clip 带 .shot-card/.shot-name → 点击选中/右键菜单/删除/改名/搜索定位全部自动生效；
// 大图链路复用 preview.js 的 showPreviewImage（先小图后大图 + 预载缓存）。
import { state, grid } from './state.js';
import { showPreviewImage, stillUrl } from './preview.js';
import { updateStats, getDialogueWidth, commitDialogue } from './render.js';  // 循环引用：仅函数体引用，安全；v0.9.40：时间线台词宽度/编辑复用宫格数据机制

const CLIP_GAP = 12;     // clip 水平间距
const NAME_H = 18;       // 名字条高（clip 底部）
const THUMB_TOP = 4;     // 缩略图顶距
// v0.9.38b：缩略图等比缩放（aspect-ratio 4:3，宽=clip 内容宽），clip 高 = 顶距4 + 内容宽×3/4 + 名字18
export function tlClipH(clipW) {
    return Math.round((clipW - 2) * 0.75) + THUMB_TOP + NAME_H;
}
export const TL_W_MIN = 52;     // clip 宽下限（v0.9.38：原 104 缩小 2 倍 = 52；缩略图宽 100% 跟随，最小 52 时缩略图 52 宽）
export const TL_W_MAX = 320;          // clip 宽上限
export const TL_W_STEP = 24;          // 缩放档位步进（52/76/100/.../316，12 档；320 非档位，clamp 到 316）
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

// v0.9.38d：时间线横轴缩放锚定焦点镜头——缩放前后焦点 clip 在容器内的水平位置不变。
// 时间线是水平滚动容器（#timeline scrollLeft），与宫格/列表的垂直 scrollY 锚定同思路。
export function tlAnchor() {
    if (!state.selectedIds || state.selectedIds.size === 0) return null;
    const id = [...state.selectedIds][0];
    const sel = document.querySelector(`.timeline-clip[data-id="${id}"]`);
    const tl = document.getElementById('timeline');
    if (!sel || !tl) return null;
    const r = sel.getBoundingClientRect();
    const tr = tl.getBoundingClientRect();
    return { id, rel: r.left + r.width / 2 - tr.left };
}

// 恢复锚定（必须在 renderTimeline 返回后调用——其内部 prevScroll 恢复会覆盖，后调者胜）
export function tlRestoreAnchor(a) {
    if (!a) return;
    const tl = document.getElementById('timeline');
    const sel = document.querySelector(`.timeline-clip[data-id="${a.id}"]`);
    if (!tl || !sel) return;
    const r = sel.getBoundingClientRect();
    const tr = tl.getBoundingClientRect();
    const cur = r.left + r.width / 2 - tr.left;
    tl.scrollLeft += cur - a.rel;
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
    applyTlSplit();     // v0.9.40：缩略图区高度自适应内容（stage 吃剩余）

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

    // 镜头轨道：clip = 等比缩略图（v0.9.38b：宽=clipW、高=clipW×3/4 区域）+ 名字（.shot-name 复用双击改名/右键重命名）
    // v0.9.37：clip 宽 = 横轴缩放值（不再∝时长），顺序均布（left = idx × (clipW + GAP)）
    const lane = document.getElementById('tlShotLane');
    lane.innerHTML = '';
    const clipH = tlClipH(clipW);   // v0.9.38b：等比缩放后 clip 总高动态
    // v0.9.38f：timeline 最小高 = 内容需要高（台词 38 + clipH + 留白 12，tlNeedHeight 同源）。
    // 常规下 timeline 靠 flex grow 吃剩余空间（≥ needH）；clip 超高时 stage 已借空间收缩（applyTlSplit），
    // 借到 stage 保底 180 仍不够 → 此 minHeight 撑 grid 页面滚动兜底
    tl.style.minHeight = tlNeedHeight() + 'px';
    // 下沿对齐：lane 高 = 容器可用高 - 台词轨道 38，clip bottom:0 贴容器底
    lane.style.height = Math.max(0, inner.clientHeight - 38) + 'px';
    const frag = document.createDocumentFragment();
    lastOrder.forEach(({ shot, idx }) => {
        const s = shot;
        const f = coverFrame(s);
        const clip = document.createElement('div');
        clip.className = 'shot-card timeline-clip' + (state.selectedIds.has(s.id) ? ' selected' : '');
        clip.dataset.id = s.id;
        clip.style.left = (16 + idx * (clipW + CLIP_GAP)) + 'px';
        clip.style.width = clipW + 'px';
        clip.style.height = clipH + 'px';
        const thumb = f && f.imageUrl
            ? `<img class="tl-clip-thumb" loading="lazy" src="${esc(f.imageUrl)}" alt="">`
            : '<div class="tl-clip-thumb tl-clip-nothumb">无图</div>';
        clip.innerHTML = `${thumb}<div class="shot-name tl-clip-name" title="${esc(s.name)}">${esc(s.name)}</div>`;
        frag.appendChild(clip);
    });
    lane.appendChild(frag);

    // 台词轨道（v0.9.38：台词块移到镜头 clip 上方，同宽同位与镜头一一对齐；T 开关控制显隐）
    // v0.9.40：宽度 = 自动大小（map 无值 → 跟随 clipW 缩放）或自定义（map 有值）；双击编辑/右键菜单见 startTlDlgEdit/applyTlDlgWidths
    const dlgLane = document.getElementById('tlDlgLane');
    dlgLane.innerHTML = '';
    if (state.dialogueOn && !state.trashMode) {
        const dfrag = document.createDocumentFragment();
        lastOrder.forEach(({ shot, idx }) => {
            const dlg = (shot.dialogue || '').trim();
            if (!dlg) return;
            const box = document.createElement('div');
            box.className = 'tl-dlg-clip';
            box.dataset.dlgId = shot.id;
            box.title = dlg.replace(/\n/g, ' ');
            box.style.left = (16 + idx * (clipW + CLIP_GAP)) + 'px';
            box.style.width = getDialogueWidth(shot.id, clipW) + 'px';
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

// ---- v0.9.40：预览区/缩略图区按缩略图大小完全自适应（方案 A，用户拍板）----
// 缩略图区（#timeline）高度恒 = 内容需要高（tlNeedHeight：台词 38 + clipH + 留白 12），
// 预览区（#timelineStage）吃剩余空间；clip 缩放 → needH 变 → 分割自动跟随，无固定比例、无拖动条。
// 约束：stage 保底 180px；needH 超过可用空间（极小视口/超大 clip）时 timeline minHeight
// 撑 grid 页面滚动兜底（renderTimeline 的 tl.style.minHeight 同源）。
// 基准高 = #grid.timeline-mode 的 min-height（calc(100vh - header 61 - 底部 92)），computed 读 px。
// 开销：padding-bottom 12 + 一处 grid gap（stage ↔ timeline 之间；divider 已移除）
function tlGridBase() {
    const g = document.getElementById('grid');
    if (!g) return window.innerHeight - 61 - 92;
    const mh = getComputedStyle(g).minHeight || '';
    const px = parseFloat(mh);
    if (!isNaN(px) && px > 0) return px;
    return window.innerHeight - 61 - 92;
}

// v0.9.38f：timeline 内容需要高 = 台词轨道 38 + clip 总高 + 顶部留白 12（与 renderTimeline 的 minHeight 同源）
function tlNeedHeight() {
    return 38 + tlClipH(tlClipW()) + 12;
}

// stage 高度 = 可用空间 - 内容需要高（保底 180）。clip 越大 needH 越大 → stage 越小；clip 越小 stage 越大。
function stageHeightFor() {
    const base = tlGridBase();
    const needH = tlNeedHeight();
    const g = document.getElementById('grid');
    const gap = parseFloat(getComputedStyle(g).gap) || 0;
    const avail = base - 12 - gap;   // padding-bottom 12 + 一处 gap（stage↔timeline）
    return Math.max(avail - needH, 180);
}

// 应用自适应分割到 stage 高度（像素，renderTimeline 每次渲染调用）
function applyTlSplit() {
    const stage = document.getElementById('timelineStage');
    if (!stage) return;
    stage.style.height = stageHeightFor() + 'px';
}

// ---- v0.9.40：时间线台词块就地编辑（单行，无换行）+ 宽度自适应应用 ----
// 用户拍板：时间线台词双击编辑，但不需要换行功能（宫格是 textarea 多行，时间线单行 input）。
// 提交复用 render.js 的 commitDialogue（toast/API 一致）；宽度机制复用 sb-dialogue-w-map
// （自动 = 跟随 clipW 缩放 / 自定义 = map 固定值，右键菜单自动大小勾选控制）。

// 编辑态 input：Enter 保存 / Esc 取消 / blur 保存；事件全 stopPropagation（防右键滑动/框选/拖拽）
export function startTlDlgEdit(shotId) {
    if (state.editingDlg || state.trashMode) return;
    const shot = state.shots.find(s => s.id === shotId);
    if (!shot) return;
    const box = document.querySelector(`.tl-dlg-clip[data-dlg-id="${shotId}"]`);
    if (!box) return;
    const input = document.createElement('input');
    input.className = 'tl-dlg-edit';
    input.value = shot.dialogue || '';
    input.draggable = false;
    ['mousedown', 'mousemove', 'mouseup', 'dragstart', 'selectstart', 'click', 'dblclick'].forEach(t => {
        input.addEventListener(t, (ev) => ev.stopPropagation());
    });
    box.textContent = '';
    box.appendChild(input);
    box.classList.add('editing');
    state.editingDlg = shotId;
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        const newText = input.value.trim();
        state.editingDlg = null;
        box.classList.remove('editing');
        if (commit && newText !== shot.dialogue) {
            commitDialogue(shotId, newText);   // 成功 toast；心跳刷新 state.shots 后差分重建块
            // 本地先更新显示（不等心跳）：内容换回文本
            box.textContent = newText;
            box.title = newText.replace(/\n/g, ' ');
        } else {
            box.textContent = shot.dialogue || '';
            box.title = (shot.dialogue || '').replace(/\n/g, ' ');
        }
    };
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') finish(false);
        ev.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
}

// 双击台词块就地编辑（委托：块是动态 DOM；与宫格 .dialogue-text 委托互不干扰——时间线块无该 class）
document.addEventListener('dblclick', (e) => {
    const box = e.target.closest('.tl-dlg-clip');
    if (!box || !box.dataset.dlgId) return;
    startTlDlgEdit(box.dataset.dlgId);
});

// 时间线台词块宽度就地更新（右键菜单自动大小切换后调用；renderTimeline 重建也会按 map 重算）
export function applyTlDlgWidths() {
    const clipW = tlClipW();
    document.querySelectorAll('.tl-dlg-clip[data-dlg-id]').forEach(box => {
        box.style.width = getDialogueWidth(box.dataset.dlgId, clipW) + 'px';
    });
}
