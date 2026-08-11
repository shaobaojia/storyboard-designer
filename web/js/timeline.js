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
import { showPreviewImage, stillUrl, updatePreview } from './preview.js';
import { updateStats, getDialogueWidth, commitDialogue, SVG_NOIMG } from './render.js';  // 循环引用：仅函数体引用，安全；v0.9.40：时间线台词宽度/编辑复用宫格数据机制；v0.9.45：SVG_NOIMG 展开帧格缺图兜底
import { updateSelectionUI } from './selection.js';  // v0.9.56c：预览区工具条焦点切换
import { focusFrame } from './frames.js';  // v0.9.56c：moveTlFocus 清蓝框
import { ICONS } from './icons.js';  // v0.9.45：展开态折叠按钮图标
import { inlineEdit } from './inline_edit.js';  // v0.9.71：就地编辑输入框生命周期共享模板

export const CLIP_GAP = 12;   // clip 水平间距（v0.9.52 export：render.js 台词条镜头位语义换算用）
const NAME_H = 28;       // 名字条总高（clip 底部；v0.9.59：18 行高 + 上下 padding 5×2，镜头号上下间隔与左缘对称）
const THUMB_TOP = 4;     // 缩略图顶距
// v0.9.51：缩略图区域比例 4:3 → 16:9（对齐宫格 --aspect 1.778 与画面真实比例）——
// contain 16:9 图零露边填满区域，展开态文字条紧贴画面下沿（宫格同款"挨着"）；
// v0.9.38b 原 4:3 区域对 16:9 画面上下露边 ~14px，文字条与画面间视觉空隙
export function tlClipH(clipW) {
    return Math.round((clipW - 2) * 0.5625) + THUMB_TOP + NAME_H;
}
export const TL_W_MIN = 52;     // clip 宽下限（v0.9.38：原 104 缩小 2 倍 = 52；缩略图宽 100% 跟随，最小 52 时缩略图 52 宽）
export const TL_W_MAX = 320;          // clip 宽上限
export const TL_W_STEP = 24;          // 缩放档位步进（52/76/100/.../316，12 档；320 非档位，clamp 到 316）
const TL_W_KEY = 'sb-tl-w';    // clip 宽持久化键
let lastOrder = [];            // 最近一次渲染的镜头顺序（updateTimelineStage 复用，避免重算）
let xPos = new Map();          // v0.9.45：最近一次渲染的 clip 左缘（展开镜头占多列，后续顺移；台词条/添加模式复用）

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

// v0.9.38d：时间线横轴缩放锚定——缩放前后锚点内容在容器内的水平位置不变。
// 时间线是水平滚动容器（#timeline scrollLeft），与宫格/列表的垂直 scrollY 锚定同思路。
// v0.9.46：测量改用布局坐标（offsetLeft + offsetWidth/2 - scrollLeft）——getBoundingClientRect
// 含 FLIP transform：缩放时旧 DOM 可能有动画残留，且 renderTimeline 内 FLIP 起点先于滚动补偿设置，
// 实测补偿被 transform 吃掉只剩 11.8px（期望 924px），焦点镜头动画中滑 912px。
// 布局坐标不受 transform 影响，与 renderTimeline 内 finalScroll 计算同一坐标系。
// v0.9.65：缩放中心改为画面中心——记录视口中心落在哪个 clip 及其内部比例 frac，
// 缩放后该 clip 内同比例位置回到视口中心（与焦点镜头无关，无选中也可锚定；空库返回 null）。
export function tlAnchor() {
    const tl = document.getElementById('timeline');
    if (!tl) return null;
    const pt = tl.scrollLeft + tl.clientWidth / 2;   // 视口中心的内容布局坐标（与 offsetLeft 同系）
    let best = null;
    let minD = Infinity;
    for (const c of tl.querySelectorAll('.timeline-clip')) {
        const L = c.offsetLeft, R = L + c.offsetWidth;
        if (pt >= L && pt <= R) return { id: c.dataset.id, frac: (pt - L) / c.offsetWidth };
        const d = pt < L ? L - pt : pt - R;   // 落在 gap/空白 → 最近 clip 边界（gap 仅 12px，可忽略）
        if (d < minD) { minD = d; best = { id: c.dataset.id, frac: pt < L ? 0 : 1 }; }
    }
    return best;
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
            <div class="tl-stage-frame">
                <img id="tlStageImg" alt="" style="display:none;">
                <div id="tlSubtitle" class="subtitle-overlay" style="display:none;"></div>
            </div>
            <div id="tlStageEmpty" class="tl-stage-empty">未选中镜头</div>
        </div>
        <div class="tl-stage-info">
            <span id="tlStageName">—</span>
            <span id="tlStageDur">—</span>
            <span id="tlStageTime">—</span>
            <div class="tl-stage-toolbar">
                <button id="tlJumpPrev5" class="tl-jump-btn" data-tip="向前 5 个"><span data-icon="tiaozhen-prev5"></span></button>
                <button id="tlJumpPrev" class="tl-jump-btn" data-tip="上一个镜头"><span data-icon="tiaozhen-prev"></span></button>
                <button id="tlJumpNext" class="tl-jump-btn" data-tip="下一个镜头"><span data-icon="tiaozhen-next"></span></button>
                <button id="tlJumpNext5" class="tl-jump-btn" data-tip="向后 5 个"><span data-icon="tiaozhen-next5"></span></button>
            </div>
        </div>`;
    grid.appendChild(stage);
    // v0.9.56c：buildStage 动态创建的按钮不在 mountIcons 的初始扫描范围——手动注入图标
    stage.querySelectorAll('[data-icon]').forEach(el => {
        const body = ICONS[el.dataset.icon];
        if (body) el.innerHTML = body;
    });
    // v0.9.56c：预览区下缘工具条——焦点镜头切换（镜头级，±1/±5，越界 clamp）
    stage.querySelector('#tlJumpPrev').addEventListener('click', () => moveTlFocus(-1));
    stage.querySelector('#tlJumpNext').addEventListener('click', () => moveTlFocus(1));
    stage.querySelector('#tlJumpPrev5').addEventListener('click', () => moveTlFocus(-5));
    stage.querySelector('#tlJumpNext5').addEventListener('click', () => moveTlFocus(5));
}

// v0.9.56c：预览区工具条焦点镜头切换——镜头级跳转（上一/下一 ±1，向前/向后 5 个 ±5）。
// 与键盘 ←→（帧格级）区分：按钮语义 = 切换焦点镜头（用户拍板）；展开态帧格焦点清空（镜头级无帧格语义）。
// 收尾与 arrowMove 同款：蓝框清空 + 选中 UI + 预览跟随 + 70% 区定位
export function moveTlFocus(step) {
    const shots = state.shots;
    if (!shots.length) return;
    const curId = [...state.selectedIds][0] ?? state.lastClickId ?? state.anchorId;
    let idx = shots.findIndex(s => s.id === curId);
    if (idx === -1) idx = step > 0 ? -1 : shots.length;
    const next = Math.min(shots.length - 1, Math.max(0, idx + step));
    if (next === idx) return;   // 已在边界（含无选中时 step 负向）
    const shot = shots[next];
    state.selectedIds = new Set([shot.id]);
    state.anchorId = shot.id;
    state.lastClickId = shot.id;
    state.focusedFrameId = null;
    focusFrame(null, null);     // 清蓝框
    updateSelectionUI();
    updatePreview();            // timeline 下转发 updateTimelineStage（预览区跟随）
    const card = document.querySelector(`.timeline-clip[data-id="${shot.id}"]`);
    if (card) tlReveal(card);   // 滚动定位到 70% 有效区
}

// 时间线区（缩略图横排），每次渲染重建内部、容器常驻（v0.9.37：标尺已去掉）
// v0.9.53 舞台：.tl-wrap 相对定位容器（承接原 #timeline 的 flex 属性），
// 两侧 15% 淡出遮罩 #tlFadeL/#tlFadeR 覆盖在 #timeline 上（pointer-events:none，不随内容滚动）
function buildTimeline() {
    if (document.getElementById('timeline')) return;
    const wrap = document.createElement('div');
    wrap.className = 'tl-wrap';
    const tl = document.createElement('div');
    tl.id = 'timeline';
    tl.innerHTML = `
        <div class="tl-inner" id="tlInner">
            <div class="tl-lane tl-shot-lane" id="tlShotLane"></div>
            <div class="tl-lane tl-dlg-lane" id="tlDlgLane"></div>
        </div>`;
    wrap.appendChild(tl);
    const fadeL = document.createElement('div');
    fadeL.id = 'tlFadeL';
    const fadeR = document.createElement('div');
    fadeR.id = 'tlFadeR';
    wrap.appendChild(fadeL);
    wrap.appendChild(fadeR);
    grid.appendChild(wrap);
}

// ═══ v0.9.53 舞台滚动：中间 70% 有效区，两侧各 15% 淡出带（镜头块不进带，滚动极限 = 15%/85% 边缘）═══
const TL_FADE = 0.15;

function tlScrollMinMax() {
    const tl = document.getElementById('timeline');
    const clips = tl ? tl.querySelectorAll('.timeline-clip') : [];
    if (!tl || clips.length === 0) return { min: 0, max: 0 };
    const W = tl.clientWidth;
    const first = clips[0];
    const last = clips[clips.length - 1];
    const totalW = last.offsetLeft + last.offsetWidth + 16;  // 内容总宽（含右 padding）
    if (totalW < 0.7 * W) return { min: 0, max: 0 };  // 内容不足 70%：布局已居中，无需滚动
    return {
        min: Math.max(0, first.offsetLeft - TL_FADE * W),
        max: Math.max(0, last.offsetLeft + last.offsetWidth - (1 - TL_FADE) * W),
    };
}

// 统一滚动入口：所有 scrollLeft 赋值走这里（锚定缩放/↑↓/滚轮/定位），越界自动 clamp
export function setTlScroll(x) {
    const tl = document.getElementById('timeline');
    if (!tl) return;
    const { min, max } = tlScrollMinMax();
    if (max <= min) { tl.scrollLeft = 0; return; }
    tl.scrollLeft = Math.min(Math.max(x, min), max);
}

// 定位到 70% 区内且滚动量最小（决策 2-B）：左缘 <15% 向左滚（内容右移）、右缘 >85% 向右滚（内容左移），其余不滚
export function tlReveal(clip) {
    const tl = document.getElementById('timeline');
    if (!tl || !clip) return;
    const W = tl.clientWidth;
    let x = tl.scrollLeft;
    const L = clip.offsetLeft - x;
    if (L < TL_FADE * W) x += L - TL_FADE * W;
    const L2 = clip.offsetLeft - x;
    if (L2 + clip.offsetWidth > (1 - TL_FADE) * W) x += L2 + clip.offsetWidth - (1 - TL_FADE) * W;
    setTlScroll(x);
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
    // v0.9.45b：大图跟随焦点帧（宫格预览同款）——focusedFrameId 命中本镜头优先，无则封面
    const focusF = state.focusedFrameId && (shot.frames || []).some(fr => fr.id === state.focusedFrameId)
        ? (shot.frames || []).find(fr => fr.id === state.focusedFrameId) : null;
    const frame = focusF || coverFrame(shot);
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
    // 字幕浮层：大图下方居中（电影字幕位），跟随 T 开关。
    // v0.9.45：被前面镜头台词条盖住的镜头——浮层显示「盖住者的台词 + 自己的台词」多行
    //（前面在上、当前在下）；判定 = 台词条右缘越过当前 clip 左缘（水平重叠，用户拍板口径）。
    // 几何用 offsetLeft/offsetWidth（同 tl-inner 坐标系，与 clip 可比；DOM 实时读，无缓存过期问题）
    const dlg = (shot.dialogue || '').trim();
    if (state.dialogueOn) {
        const lines = [];
        const bClip = document.querySelector(`.timeline-clip[data-id="${targetId}"]`);
        if (bClip) {
            const bIdx = lastOrder.findIndex(x => x.shot.id === targetId);
            const bLeft = bClip.offsetLeft;
            const dlgBoxes = new Map();
            document.querySelectorAll('.tl-dlg-clip').forEach(b => dlgBoxes.set(b.dataset.dlgId, b));
            for (let i = 0; i < bIdx; i++) {
                const { shot: c } = lastOrder[i];
                const box = dlgBoxes.get(c.id);
                if (box && box.offsetLeft + box.offsetWidth > bLeft) {
                    lines.push((c.dialogue || '').replace(/\n/g, ' ').trim());
                }
            }
        }
        if (dlg) lines.push(dlg.replace(/\n/g, ' '));
        if (lines.length) {
            sub.innerHTML = '';
            for (const line of lines) {
                const d = document.createElement('div');
                d.textContent = line;
                sub.appendChild(d);
            }
            sub.style.display = 'block';
        } else {
            sub.style.display = 'none';
        }
    } else {
        sub.style.display = 'none';
    }
}

// 时间线渲染（renderGrid 的 timeline 分支转发入口）
// v0.9.46：可选 anchor 参数（缩放锚定，zoom.js 传入）——最终滚动位置 = 新布局锚点位置 - 锚定 rel，
// 且 FLIP 起点叠加滚动补偿（起点屏幕 = 旧屏幕位置，锚点动画全程钉住）。
// v0.9.65：锚点语义从「焦点镜头中心」改为「画面中心」——anchor = {id, frac}（视口中心所在 clip + 内部比例），
// finalScroll = 新布局同比例位置 - 视口宽/2（画面中心内容守恒；无 anchor → prevScroll 行为不变）。
export function renderTimeline(anchor) {
    // v0.9.54：时间线入场生长动画标志（setView('timeline') / main.js 首屏直落设置）。
    // 注意：不在开头清空——initZoom 初始化在 shots 到达前会先空渲染一次（空分支 return），
    // 提前清会把首屏直落的标志吃掉（场景 2 实测无动画）；消费点唯一 = 入场段真正执行处。
    const enterAnim = state.tlEnterAnim;
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
    // v0.9.58：.tl-wrap（v0.9.53 舞台包装容器，无 id）也要保留——漏了它 = 每次渲染
    // remove+重建整个时间线 DOM：leave 动画 class 丢失（关台词无动画）、FLIP 起点
    // capture 取空（缩放/展开/拖拽动画全失效）、滚动位置归零（v0.9.53 回归，实测）
    [...grid.children].forEach(el => {
        if (el.id !== 'timelineStage' && el.id !== 'timeline' && !el.classList.contains('tl-wrap')) el.remove();
    });
    // v0.9.45b：FLIP 避让/恢复——展开/折叠后其他 clip 从旧位置滑到新位置（宫格同款水平 FLIP）。
    // capture 必须在清空前（旧 DOM 还在）；首屏/切视图无旧 DOM → 空 Map → 无动画。
    // 展开镜头自身 dx=0（left 不变）自然跳过；台词条不 FLIP（宫格同款，瞬移）
    // v0.9.46b：台词条也 FLIP——位置与 clip 同源（xPos），重排时跟 clip 一起滑（用户拍板 A）
    const oldClips = new Map();
    document.querySelectorAll('.timeline-clip').forEach(c => oldClips.set(c.dataset.id, c.offsetLeft));
    const oldDlg = new Map();
    document.querySelectorAll('.tl-dlg-clip').forEach(b => oldDlg.set(b.dataset.dlgId, b.offsetLeft));
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
        state.dlgAnim = null;  // v0.9.43：空库分支不消费动画标记，手动清防残留
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
    // v0.9.45：x 排位改累计——展开镜头占多列宽（帧格横排连片），后续镜头顺移；
    // xPos 提升为模块级（startTlDlgEdit 添加模式复用）
    // v0.9.53 舞台排位：两遍法——先算内容总宽，起点 base = 内容不足 70% 视口时整体居中（决策 1-A），
    // 否则左贴 15% 视口边缘（滚动极限语义：scrollLeft=0 时首 clip 左缘恰在淡出带边缘）
    const stageW = tl.clientWidth;
    let rawW = 16;
    for (const { shot } of lastOrder) {
        const frames = shot.frames || [];
        const w = frames.length > 1 && state.expandedShotIdsTl.has(shot.id)
            ? tlExpandW(frames.length, clipW) : clipW;
        rawW += w + CLIP_GAP;
    }
    const totalW = rawW - CLIP_GAP + 16;  // 最右 clip 右缘 + 右 padding 16
    const base = totalW < 0.7 * stageW
        ? Math.max(16, Math.round((stageW - totalW) / 2))   // 内容不足 70%：居中（70% 区中心 = 视口中心）
        : Math.max(16, Math.round(0.15 * stageW));          // 正常：左贴 15% 边缘
    xPos = new Map();
    let cursor = base;
    for (const { shot } of lastOrder) {
        const frames = shot.frames || [];
        const w = frames.length > 1 && state.expandedShotIdsTl.has(shot.id)
            ? tlExpandW(frames.length, clipW) : clipW;
        xPos.set(shot.id, cursor);
        cursor += w + CLIP_GAP;
    }
    // v0.9.53 舞台内容宽：内容占位（base + 净宽，totalW 含左右 padding 32）+ 右尾部 15% 视口空间——
    // 滚动极限"末 clip 右缘贴 85%"的物理前提（scrollLeft 最大 = 内容右缘贴视口右缘，无尾部空间则舞台 max 被浏览器吃掉）
    inner.style.width = Math.max(Math.round((base + totalW - 32) + 0.15 * stageW), tl.clientWidth) + 'px';

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
        const frames = s.frames || [];
        const isMulti = frames.length > 1;
        const expanded = isMulti && state.expandedShotIdsTl.has(s.id);
        const w = expanded ? tlExpandW(frames.length, clipW) : clipW;
        const f = coverFrame(s);
        const clip = document.createElement('div');
        clip.className = 'shot-card timeline-clip'
            // v0.9.62：时间线 clip 补 multi/expanded class（与宫格语义统一）——multi 供折叠态多图
            // 悬停扫视选择器命中（frames.js）；expanded 供 :not(.expanded) 排除展开态
            + (isMulti && !expanded ? ' multi' : '')
            + (expanded ? ' expanded' : '')
            + (state.selectedIds.has(s.id) ? ' selected' : '');
        clip.dataset.id = s.id;
        clip.style.left = xPos.get(s.id) + 'px';
        clip.style.width = w + 'px';
        clip.style.height = clipH + 'px';
        if (expanded) {
            // v0.9.45：展开态 = 帧格横排连片（每格 clipW 宽、间距 9px、右缘留折叠按钮位）；
            // img.frame-img 复用宫格帧格选择器 → 右键帧级菜单/双击跳帧自动生效
            const focusId = (state.focusedFrameId && frames.some(fr => fr.id === state.focusedFrameId))
                ? state.focusedFrameId : null;
            const row = document.createElement('div');
            row.className = 'tl-expand-row';
            frames.forEach((fr, fi) => {
                const cell = document.createElement('div');
                cell.className = 'tl-expand-cell';
                cell.dataset.frameId = fr.id;  // v0.9.45b：点击帧格任意处（图/名字条）焦点蓝框跟手，宫格同款
                cell.style.width = clipW + 'px';
                cell.innerHTML = tlFrameCellHtml(fr, s, fi === 0, focusId === fr.id);
                row.appendChild(cell);
            });
            clip.appendChild(row);
            clip.insertAdjacentHTML('beforeend',
                `<button class="collapse-btn" data-tip="折叠" data-action="collapse-tl" ` +
                `onclick="window.__sb.toggleListMulti('${s.id}');event.stopPropagation();">${ICONS.collapse}</button>`);
        } else {
            const thumb = f && f.imageUrl
                ? `<img class="tl-clip-thumb" loading="lazy" src="${esc(f.imageUrl)}" alt="">`
                : '<div class="tl-clip-thumb tl-clip-nothumb">无图</div>';
            clip.innerHTML = `${thumb}<div class="tl-clip-bottom"><div class="shot-name tl-clip-name" title="${esc(s.name)}">${esc(s.name)}</div><div class="tl-clip-meta">${s.duration.toFixed(1)}s</div></div>`;
            if (isMulti) {
                clip.insertAdjacentHTML('beforeend',
                    `<button class="stack-badge" data-tip="展开/折叠" ` +
                    `onclick="window.__sb.toggleListMulti('${s.id}');event.stopPropagation();">${frames.length}</button>`);
            }
        }
        frag.appendChild(clip);
    });
    lane.appendChild(frag);

    // v0.9.46：缩放锚定并入渲染——最终滚动位置 = 新布局锚点布局位置 - 锚定 rel（内容区位置守恒）。
    // v0.9.65：锚点 = 画面中心（anchor.frac 比例位置），非焦点镜头。
    // 必须在 FLIP 起点设置前算（offsetLeft 布局坐标不受 transform 影响）；
    // clamp 到 [0, maxScroll]（锚点在视口外时锚定需求可能为负/超右缘，坑 220 同源）。
    let finalScroll = prevScroll;
    if (anchor && anchor.id) {
        const aSel = document.querySelector(`.timeline-clip[data-id="${anchor.id}"]`);
        if (aSel) {
            // v0.9.65：画面中心锚定——新布局 clip 内同比例位置回到视口中心（clip 宽变化按 frac 比例跟随）
            finalScroll = aSel.offsetLeft + anchor.frac * aSel.offsetWidth - tl.clientWidth / 2;
            const maxS = Math.max(0, tl.scrollWidth - tl.clientWidth);
            finalScroll = Math.max(0, Math.min(finalScroll, maxS));
        }
    } else if (enterAnim) {
        // v0.9.54：切换入场——焦点镜头水平居中到视口中心（满足"焦点居中"；视口中心在 15%~85% 区内，不违反舞台极限）
        const selId = [...state.selectedIds][0];
        const selClip = selId ? document.querySelector(`.timeline-clip[data-id="${selId}"]`) : null;
        if (selClip) {
            finalScroll = selClip.offsetLeft + selClip.offsetWidth / 2 - tl.clientWidth / 2;
            const maxS = Math.max(0, tl.scrollWidth - tl.clientWidth);
            finalScroll = Math.max(0, Math.min(finalScroll, maxS));
        }
    }

    // v0.9.45b：FLIP 播放——新 clip 从旧位置水平滑到新位置（标准 FLIP：起点 transform + reflow 提交
    // → 恢复 transition 清 transform 过渡到 0）。水平滚动不影响 offsetLeft（布局坐标），无需 scrollY 补偿。
    // ⚠️ 必须 reflow 提交起点：仅 rAF 清（宫格 animateFrom 写法）在时间线实测起点从未上屏（computed 恒 none）
    // v0.9.46：起点叠加滚动补偿 (finalScroll - prevScroll)——否则起点屏幕 = 旧布局 - 新滚动（整体偏移），
    // 焦点镜头动画中滑 i×(w1-w0) 而非钉住中心；补偿后起点屏幕 = 旧布局 - 旧滚动 = 旧屏幕位置。
    document.querySelectorAll('.timeline-clip').forEach(c => {
        if (state.animatingShots.has(c.dataset.id)) return;  // 弹簧编排接管中，FLIP 让位
        const old = oldClips.get(c.dataset.id);
        if (old === undefined) return;  // 首屏/新镜头
        const dx = old - c.offsetLeft + (finalScroll - prevScroll);
        if (!dx) return;
        c.style.transition = 'none';
        c.style.transform = `translate(${dx}px, 0)`;
        void c.offsetWidth;  // 强制 reflow：起点 transform 提交（此后 transition 恢复才有效）
        c.style.transition = 'transform 0.35s ease';
        c.style.transform = '';
    });

    // 台词轨道（v0.9.38：台词块移到镜头 clip 上方，同宽同位与镜头一一对齐；T 开关控制显隐）
    // v0.9.40：宽度 = 自动大小（map 无值 → 跟随 clipW 缩放）或自定义（map 有值）；双击编辑/右键菜单见 startTlDlgEdit/applyTlDlgWidths
    // v0.9.43：开关/拖拽动画——state.dlgAnim 由 toggleDialogue/moveOrSwapDialogue 设置（{all:true}=全体长出来 /
    // {ids:[...]}=指定镜头长出来），本次渲染消费；.tl-dlg-leave 块在播「收回去」动画时跳过 innerHTML 清空
    const dlgLane = document.getElementById('tlDlgLane');
    const dlgAnim = state.dlgAnim;
    state.dlgAnim = null;
    // v0.9.43：leave 块在播「收回去」动画时保留（跳过全清），其余旧块照常清除防翻倍；无 leave 块 = 全清重建
    if (dlgLane.querySelector('.tl-dlg-leave')) {
        dlgLane.querySelectorAll('.tl-dlg-clip:not(.tl-dlg-leave)').forEach(b => b.remove());
    } else {
        dlgLane.innerHTML = '';
    }
    if (state.dialogueOn && !state.trashMode) {
        const dfrag = document.createDocumentFragment();
        // v0.9.45：台词条 DOM 顺序反转（后镜头在前、前镜头在后）——同 z-index 下 DOM 靠后者在上，
        // 反转后前面镜头的台词条盖住后面镜头的台词条（"前面盖后面，前面在上"）；idx 不变仍按原顺序排位
        // v0.9.45：台词条 DOM 顺序反转（后镜头在前、前镜头在后）——同 z-index 下 DOM 靠后者在上，
        // 反转后前面镜头的台词条盖住后面镜头的台词条（"前面盖后面，前面在上"）；idx 不变仍按原顺序排位
        [...lastOrder].reverse().forEach(({ shot, idx }) => {
            const dlg = (shot.dialogue || '').trim();
            if (!dlg) return;
            // v0.9.45：left 用累计 xPos（展开镜头台词条跟随展开 clip 左缘；宽度独立语义不变）
            const box = makeTlDlgBox(shot.id, xPos.get(shot.id), getDialogueWidth(shot.id, clipW));
            // v0.9.57：只有选中的镜头台词条才高亮（selected class 跟随选中态）
            if (state.selectedIds.has(shot.id)) box.classList.add('selected');
            if (dlgAnim && (dlgAnim.all || dlgAnim.ids.includes(shot.id))) box.classList.add('tl-dlg-in');
            box.title = dlg.replace(/\n/g, ' ');
            box.querySelector('.tl-dlg-text').textContent = dlg.replace(/\n/g, ' ');
            dfrag.appendChild(box);
        });
        dlgLane.appendChild(dfrag);
    }

    // v0.9.46b：台词条水平 FLIP——与 clip 同款（起点叠加滚动补偿），重排时跟 clip 一起滑。
    // 跳过：.tl-dlg-leave（收回去动画播中，animation 覆盖 inline transform，且块要消失）、
    // .tl-dlg-in（toggle 长出来动画，旧 DOM 无记录自然跳过，显式排除双保险）；
    // 旧 DOM 无记录（toggle 后首次/新台词）跳过 = 无位移。
    document.querySelectorAll('.tl-dlg-clip').forEach(b => {
        if (b.classList.contains('tl-dlg-leave') || b.classList.contains('tl-dlg-in')) return;
        const old = oldDlg.get(b.dataset.dlgId);
        if (old === undefined) return;
        const dx = old - b.offsetLeft + (finalScroll - prevScroll);
        if (!dx) return;
        b.style.transition = 'none';
        b.style.transform = `translate(${dx}px, 0)`;
        void b.offsetWidth;  // 强制 reflow：起点 transform 提交（同 clip FLIP 坑）
        b.style.transition = 'transform 0.35s ease';
        b.style.transform = '';
    });

    tl.scrollLeft = finalScroll;  // v0.9.46：锚定缩放 = finalScroll（无 anchor 时 = prevScroll 原行为）
    setTlScroll(finalScroll);  // v0.9.53：舞台 clamp（滚动极限 = 15%/85% 边缘，覆盖上行的原生赋值）

    // ═══ v0.9.54：切换入场生长动画——从焦点镜头（无选中=视口中心）向两侧生长 ═══
    // scale 0.6→1 + opacity 0→1 + 向中心收拢位移（d×18%）；v0.9.54c：错帧 50ms/块 + 视口外统一
    // （视口内的块按 |i−centerIdx|×50ms 递增波浪推进；出了视口（屏幕）的块统一 delay = 视口内最远+50ms
    //  一起长出来——动画时长 = 可见块数×50 + 0.4s ≈ 0.7s，不被视口外看不见的块拖长；
    //  原 100ms/块全量递增 76 镜 ≈ 7.4s 过长，用户拍板改）；动画 0.4s。
    //  动画纯 CSS transition 不阻塞交互（点击/滚轮/方向键/缩放/拖拽动画中均可操作，实测）。
    //  播完按 maxDelay+550ms 动态摘内联样式防污染（残留 transform 会污染后续拖拽/FLIP 测量，坑 346 同源）。
    //  台词条与对应 clip 同步同款。
    if (enterAnim) {
        state.tlEnterAnim = false;  // 真正消费（唯一消费点：空渲染/无动画渲染不消费，防首屏标志被 initZoom 空渲染吃掉）
        const clips = [...document.querySelectorAll('.timeline-clip')];
        if (clips.length) {
            const ENTER_STEP = 50;  // v0.9.54c：每块错帧 50ms（用户拍板缩短一半）
            const ENTER_DUR = 0.4;
            const selId = state.selectedIds && state.selectedIds.size ? [...state.selectedIds][0] : null;
            const cSel = selId ? clips.find(c => c.dataset.id === selId) : null;
            // 中心块索引：选中镜头 → 其 DOM 索引；无选中 → 视口中心最近块（舞台语义：滚动极限 15%/85%）
            let centerIdx;
            if (cSel) {
                centerIdx = clips.indexOf(cSel);
            } else {
                const cx = tl.clientWidth / 2;
                let best = 0, bd = Infinity;
                clips.forEach((c, i) => {
                    const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - tl.scrollLeft - cx);
                    if (d < bd) { bd = d; best = i; }
                });
                centerIdx = best;
            }
            const centerX = clips[centerIdx].offsetLeft + clips[centerIdx].offsetWidth / 2 - tl.scrollLeft;
            // v0.9.54c：视口内/外判定（舞台淡出带算视口内——可见块）；视口外统一 delay 一起长
            const viewL = tl.scrollLeft;
            const viewR = tl.scrollLeft + tl.clientWidth;
            let maxInView = 0;
            const inView = [];
            clips.forEach((c, i) => {
                const l = c.offsetLeft, r = l + c.offsetWidth;
                const v = r > viewL && l < viewR;
                inView.push(v);
                if (v) maxInView = Math.max(maxInView, Math.abs(i - centerIdx) * ENTER_STEP);
            });
            const outsideDelay = maxInView + ENTER_STEP;  // 视口外统一：视口内最远 + 一步（一起长出来）
            const maxDelay = Math.max(maxInView, outsideDelay);
            const stage = (c, delay) => {
                const ctr = c.offsetLeft + c.offsetWidth / 2 - tl.scrollLeft;
                c.style.transition = 'none';
                c.style.transform = `translate(${(centerX - ctr) * 0.18}px, 0) scale(0.6)`;
                c.style.opacity = '0';
                void c.offsetWidth;  // reflow 提交起点（同 FLIP 坑：仅 rAF 清起点从未上屏）
                c.style.transition = `transform ${ENTER_DUR}s ease-out, opacity ${ENTER_DUR}s ease-out`;
                c.style.transitionDelay = delay + 'ms';
                c.style.transform = '';
                c.style.opacity = '';
            };
            clips.forEach((c, i) => {
                const delay = inView[i] ? Math.abs(i - centerIdx) * ENTER_STEP : outsideDelay;
                c._enterDelay = delay;
                stage(c, delay);
            });
            document.querySelectorAll('.tl-dlg-clip').forEach(b => {
                const c = clips.find(x => x.dataset.id === b.dataset.dlgId);
                if (c) stage(b, c._enterDelay || 0);
            });
            const cleanupAt = maxDelay + ENTER_DUR * 1000 + 150;
            setTimeout(() => {
                clips.forEach(c => {
                    c.style.transform = ''; c.style.opacity = '';
                    c.style.transition = ''; c.style.transitionDelay = '';
                    delete c._enterDelay;
                });
                document.querySelectorAll('.tl-dlg-clip').forEach(b => {
                    b.style.transform = ''; b.style.opacity = '';
                    b.style.transition = ''; b.style.transitionDelay = '';
                });
            }, cleanupAt);
        }
    }

    updateTimelineStage();
}

// v0.9.45：时间线多图展开宽 = 帧格横排（每格 clipW + 间距 9 + 右缘折叠按钮位 9）+ 边框 2
function tlExpandW(frameCount, clipW) {
    return frameCount * (clipW + 9) + 2;
}

// v0.9.45：展开态帧格——img.frame-img 复用宫格帧格选择器（右键帧级菜单/双击跳帧自动生效）；
// 底部条 = 第一格镜头名、其它格帧号（宫格展开同款语义）；
// ⚠️ 返回 img + name（不含 cell 容器）——cell 由调用处创建并挂 data-frame-id（v0.9.45b 曾误嵌套双层 cell）
function tlFrameCellHtml(frame, shot, isFirst, focused) {
    const name = isFirst ? shot.name : 'f' + frame.frame_no;
    const imgCls = 'frame-img' + (focused ? ' frame-focused' : '');
    const img = frame.imageUrl
        ? `<img class="${imgCls}" draggable="false" data-frame-id="${frame.id}" data-frame-no="${frame.frame_no}" src="${esc(frame.imageUrl)}" loading="lazy" onerror="this.src='${SVG_NOIMG}'">`
        : `<div class="frame-img frame-missing" data-frame-id="${frame.id}" data-frame-no="${frame.frame_no}"><span class="missing-no">f${frame.frame_no}</span></div>`;
    return `${img}<div class="tl-expand-name" title="${esc(name)}">${esc(name)}</div>`;
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
// 开销：padding-top 16（v0.9.55e）+ padding-bottom 12 + 一处 grid gap（stage ↔ timeline 之间；divider 已移除）
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
    // v0.9.55e：border-box 下 min-height 含 padding——顶部 16px（与左右缘同宽）也要扣，
    // 动态读 paddingTop 防 CSS 改值后 JS 脱节
    const pt = parseFloat(getComputedStyle(g).paddingTop) || 0;
    const avail = base - pt - 12 - gap;   // padding-top + padding-bottom 12 + 一处 gap（stage↔timeline）
    return Math.max(avail - needH, 180);
}

// 应用自适应分割到 stage 高度（像素，renderTimeline 每次渲染调用）
function applyTlSplit() {
    const stage = document.getElementById('timelineStage');
    if (!stage) return;
    stage.style.height = stageHeightFor() + 'px';
}

// v0.9.66：窗口 resize 时时间线布局重算（stage/lane/minHeight 高度源随视口变）——
// renderTimeline 的 w!==w0 门控（v0.9.54）下 resize 不重渲染，显式重算布局保持缩略图向下对齐。
// 与 renderTimeline 内布局段同源（minHeight + lane 高 + stage 高）；不重建 DOM（丝滑，无 FLIP）。
// ⚠️ 顺序：先 applyTlSplit 定稿 stage，再读 inner 设 lane——resize 触发后 flex 先重排
// （stage 仍是旧值 → wrap 吃剩余临时变高），先读 inner 会拿到中间态（实测 lane 290 = 328-38 残留）
export function tlResizeLayout() {
    const tl = document.getElementById('timeline');
    const inner = document.getElementById('tlInner');
    const lane = document.querySelector('.tl-shot-lane');
    if (!tl || !inner || !lane) return;
    tl.style.minHeight = tlNeedHeight() + 'px';
    applyTlSplit();
    lane.style.height = Math.max(0, inner.clientHeight - 38) + 'px';  // 读取强制 reflow，拿到 stage 定稿后的布局
}

// ---- v0.9.40：时间线台词块就地编辑（单行，无换行）+ 宽度自适应应用 ----
// 用户拍板：时间线台词双击编辑，但不需要换行功能（宫格是 textarea 多行，时间线单行 input）。
// 提交复用 render.js 的 commitDialogue（toast/API 一致）；宽度机制复用 sb-dialogue-w-map
// （自动 = 跟随 clipW 缩放 / 自定义 = map 固定值，右键菜单自动大小勾选控制）。

// v0.9.41：时间线台词块工厂（渲染 + 添加台词共用）——span 文本 + 右沿拖宽手柄（复用宫格 .dialogue-resize 全局样式）
function makeTlDlgBox(shotId, leftPx, widthPx) {
    const el = document.createElement('div');
    el.className = 'tl-dlg-clip';
    el.dataset.dlgId = shotId;
    el.style.left = leftPx + 'px';
    el.style.width = widthPx + 'px';
    const span = document.createElement('span');
    span.className = 'tl-dlg-text';
    el.appendChild(span);
    const h = document.createElement('div');
    h.className = 'dialogue-resize';
    h.dataset.tip = '拖拽调整台词框宽度';
    el.appendChild(h);
    return el;
}

// 编辑态 input：Enter 保存 / Esc 取消 / blur 保存；事件全 stopPropagation（防右键滑动/框选/拖拽）
// v0.9.71：输入框生命周期走 inlineEdit 共享模板
export function startTlDlgEdit(shotId) {
    if (state.editingDlg || state.trashMode) return;
    const shot = state.shots.find(s => s.id === shotId);
    if (!shot) return;
    let box = document.querySelector(`.tl-dlg-clip[data-dlg-id="${shotId}"]`);
    let tempBox = false;
    if (!box) {
        // v0.9.41 添加台词（无台词镜头）：临时块定位到该镜头 clip 上方（lastOrder 取序），
        // 提交后心跳 renderTimeline 重建正式块（dlgLane.innerHTML='' 会清掉临时块）
        const o = lastOrder.find(x => x.shot.id === shotId);
        if (!o) return;
        const clipW = tlClipW();
        // v0.9.45：left 优先用累计 xPos（展开镜头存在时旧公式算错位）
        box = makeTlDlgBox(shotId, xPos.get(shotId) ?? 16 + o.idx * (clipW + CLIP_GAP), getDialogueWidth(shotId, clipW));
        document.getElementById('tlDlgLane').appendChild(box);
        tempBox = true;
    }
    const textEl = box.querySelector('.tl-dlg-text');
    if (!textEl) return;
    box.classList.add('editing');
    state.editingDlg = shotId;
    inlineEdit({
        targetEl: textEl,
        className: 'tl-dlg-edit',
        value: shot.dialogue || '',
        onFinish: (commit, newText) => {
            state.editingDlg = null;
            box.classList.remove('editing');
            // inlineEdit 已把 textEl 换回原位；时间线这里重建新 span 替换它（内容更新 + title 刷新）
            const rebuildText = (t) => {
                const span = document.createElement('span');
                span.className = 'tl-dlg-text';
                span.textContent = t;
                textEl.replaceWith(span);
                box.title = t.replace(/\n/g, ' ');
            };
            if (commit && newText !== shot.dialogue) {
                if (tempBox && !newText) {
                    box.remove();           // 添加模式空文本 = 取消不加
                } else {
                    commitDialogue(shotId, newText);   // 成功 toast；心跳刷新 state.shots 后重建正式块
                    rebuildText(newText);              // 本地先更新显示（不等心跳）
                }
            } else {
                if (tempBox) box.remove();  // 添加模式 Esc/无改动 = 不加
                else rebuildText(shot.dialogue || '');
            }
        },
    });
}

// 双击台词块就地编辑（委托：块是动态 DOM；与宫格 .dialogue-text 委托互不干扰——时间线块无该 class）
document.addEventListener('dblclick', (e) => {
    // v0.9.41：右沿拖宽手柄上的双击不算编辑（同宫格 .dialogue-resize 排除）
    if (e.target.closest('.dialogue-resize')) return;
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
