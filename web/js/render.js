// 渲染：宫格/列表两种视图 + FLIP 动效 + DOM 差分 + 骨架屏首屏门控
import { state, grid } from './state.js';
import { toast } from './ui.js';  // v0.9.8：台词就地编辑的保存反馈

// v0.9.6：XSS 防护——所有用户数据插 innerHTML 前统一过 esc（search.js 已有同款，此处补主渲染路径）
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 差分键：只放"内容字段"。updated_at 故意不在里面——排序/改文本不该重建卡片；
// 图片是否重载由 thumb_ver 独立决定（只有拍屏完成才递增）
const KEY_FIELDS = ['name', 'duration', 'content', 'dialogue', 'thumb_ver'];

function cardKey(shot) {
    const base = KEY_FIELDS.map(k => shot[k] ?? '').join('');
    // 多图镜头：帧列表（id+imageUrl+isCover）进差分键，帧变了才重建
    const frames = (shot.frames || []).map(f => `${f.id}:${f.imageUrl}:${f.isCover}`).join('');
    const expanded = state.expandedShotIds.has(shot.id) ? 'X' : '';
    const mode = state.viewMode;  // 视图模式变化时强制重建卡片
    // v0.9.8：宫格台词条存在与否影响后排布局——台词出现/消失/改行时强制重建卡片（落新行位置）
    const dlg = state.viewMode === 'grid' && !state.trashMode && state.dialogueOn && shot.dialogue ? 'D' : '';
    return base + '' + frames + '' + expanded + '' + mode + '' + dlg;
}

// ---- 宫格台词条（v0.9.8 / v0.9.9 重构：同排合并为一条父条）----
// v0.9.9：原实现"每台词镜头一条独立整行条"——同排多个台词镜头 = 多行条（台词被拆多行），
// 且每排凭空多 N 行。重构为：每个"有台词的排"一条父条（grid-column:1/-1 占一行），
// 父条内每个台词镜头一个台词框（margin-left 对齐到对应卡片列）——同排 N 个台词镜头
// = 一行并排 N 框，排只多一行。无台词排不建父条（零占行）。
// 动画：新建 fade-in（.dialogue-in，播完摘类）；删除原地淡出（.dialogue-leave：
// absolute 锁视觉位置脱离 grid 流，父条释放整行布局由 renderGrid 的 FLIP 吸收，淡完 remove）。
// 列表/宫格功能对等原则不适用：列表已有台词列，台词条只在宫格显示（垃圾桶/列表隐藏）。
// v0.9.11：每条台词框两种状态——自动大小（默认：宽度 = 卡片宽，随缩放同步变化）/
// 自定义（拖动手柄或取消勾选后固定宽度）。状态 = map 里有没有该镜头：
// 无 = 自动（跟随列宽），有 = 自定义（固定值）。手动拖动自动写入 map（解除同步）。
// v0.9.10 的全局默认 sb-dialogue-w 已废弃（需求：默认必须跟卡片同步，不保留固定默认值）。
const DLG_MAP_KEY = 'sb-dialogue-w-map';  // per-shot 自定义宽度：{shotId: width}
let dlgWidthMap = (() => {
    try { return JSON.parse(localStorage.getItem(DLG_MAP_KEY) || '{}') || {}; }
    catch { return {}; }
})();

// 每条宽度：map 有值 = 自定义；无 = 自动跟随卡片宽（列宽），缩放同步变化
function dialogueWidthOf(shotId) {
    const w = dlgWidthMap[shotId];
    if (w > 0) return w;
    const colW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-min')) || 200;
    return colW;
}

// 自动大小开关（右键菜单调用）：auto=true 恢复跟随卡片（删覆盖值）；
// auto=false 固定当前显示宽度（取消勾选瞬间宽度不变，之后不再随缩放）
export function setDialogueAuto(shotId, auto) {
    if (auto) {
        delete dlgWidthMap[shotId];
    } else {
        const box = grid.querySelector(`.dialogue-box[data-dlg-id="${shotId}"]`);
        const w = Math.round(box ? box.getBoundingClientRect().width : dialogueWidthOf(shotId));
        if (w > 0) dlgWidthMap[shotId] = w;
    }
    localStorage.setItem(DLG_MAP_KEY, JSON.stringify(dlgWidthMap));
    updateDialogue();  // 立即应用（宽度就地更新，无需整页渲染）
}

// 当前是否自动大小（右键菜单勾选状态用）
export function isDialogueAuto(shotId) {
    return !dlgWidthMap[shotId];
}

function makeDialogueRow() {
    const el = document.createElement('div');
    el.className = 'dialogue-strip';
    return el;
}

function makeDialogueBox(shotId) {
    const el = document.createElement('div');
    el.className = 'dialogue-box';
    el.dataset.dlgId = shotId;
    el.innerHTML = `<span class="dialogue-text"></span><div class="dialogue-resize" data-tip="拖拽调整台词框宽度"></div>`;
    return el;
}

// 原地淡出：锁当前视觉位置（offset 系相对 grid——grid 的 will-change:transform 使
// 其成为 offsetParent/containing block）→ absolute 脱离 grid 流（布局释放）→ 淡完 remove。
// 父条的 left/right 由 CSS 拉伸，top 由调用方按需设置；box 的 left/top 由调用方设置。
function ghostOut(el, ms = 200) {
    if (!el.isConnected) return;
    el.classList.add('dialogue-leave');
    setTimeout(() => el.remove(), ms + 30);
}

// 入场淡入（新建节点专用；动画类播完即摘——类留着重插 DOM 会重播）
function fadeIn(el) {
    // v0.9.17 首屏：台词条入场挂起到揭幕时统一处理（gateFirstReveal 延迟 500ms）——
    // 数据到就播的动画被骨架层盖住（用户看不到），揭开时类已摘 = 台词条无入场动画，
    // 与卡片波浪入场不协调（用户感知"先卡片后台词条"）。首屏新建的父条/box 先 opacity 0。
    if (!state.firstLoadDone) { el.style.opacity = '0'; return; }
    el.classList.add('dialogue-in');
    el.addEventListener('animationend', () => el.classList.remove('dialogue-in'), { once: true });
}

// renderGrid 完事后调用（v0.9.9 起在 animateFrom 之前——父条增删引起的全页位移必须
// 落在 FLIP 播放前，才能被同一轮动画吸收）：
// 按排分组（offsetTop 相同 = 同排）→ 每排至多一条父条（插在该排最后一个格位后，
// insertAdjacentElement 对已挂载节点是移动不是复制，无"先remove后insert"同帧抖动）；
// 父条内每个台词镜头一个 box，margin-left 对齐卡片列（card.offsetLeft 直接可用：
// grid 是 will-change:transform 的 offsetParent）；文本/宽度/偏移有变才写（差分友好）
export function updateDialogue() {
    // 关闭态（列表/垃圾桶/台词开关关）：所有父条淡出删除，不占行
    const off = state.viewMode !== 'grid' || state.trashMode || !state.dialogueOn;
    const want = off ? [] : state.shots.filter(s => s.dialogue && s.dialogue.trim());
    if (!want.length) {
        grid.querySelectorAll('.dialogue-strip:not(.dialogue-leave)').forEach(el => {
            el.style.top = el.offsetTop + 'px';
            ghostOut(el);
        });
        return;
    }
    // v0.9.9 修正：先把现有父条临时移到 grid 末尾（布局净化）再分组——旧父条未归位时
    // 会干扰 grid auto-placement（缩放后 CSS 变量先变、父条还占着旧行，卡片排布被挤乱，
    // row.last 算错 → 父条插错位置后每轮自锁；reload 首帧无父条所以总是对的，一缩放就错）。
    // 同任务内移动节点无渲染帧，不闪；末尾的父条不再干扰前面卡片的行排布。
    const existingStrips = [...grid.querySelectorAll('.dialogue-strip:not(.dialogue-leave)')];
    existingStrips.forEach(el => grid.appendChild(el));
    const allCards = [...grid.querySelectorAll('.shot-card')];
    // v0.9.9 展开态修复：展开态镜头无主卡片（只渲染帧格）——分组锚 = 最后一个帧格
    // （台词条落在展开区最后一行之后，帧格 DOM 连续、父条插在整行最右后不推挤其他卡片），
    // 对齐锚 = 第一个帧格（台词框左缘对齐展开区左缘）
    const anchorOf = new Map(allCards.filter(c => !c.dataset.frameId).map(c => [c.dataset.id, c]));
    for (let i = allCards.length - 1; i >= 0; i--) {
        const c = allCards[i];
        if (c.dataset.frameId && !anchorOf.has(c.dataset.id)) anchorOf.set(c.dataset.id, c);
    }
    const alignOf = new Map(allCards.filter(c => !c.dataset.frameId).map(c => [c.dataset.id, c]));
    for (const c of allCards) {
        if (c.dataset.frameId && !alignOf.has(c.dataset.id)) alignOf.set(c.dataset.id, c);
    }
    // 按排分组：top → { last: 该排最右格位(含展开帧格), shots: [台词镜头] }
    const rows = new Map();
    for (const shot of want) {
        const card = anchorOf.get(shot.id);
        if (!card) continue;
        const top = card.offsetTop;
        let r = rows.get(top);
        if (!r) {
            r = { top, last: card, shots: [] };
            rows.set(top, r);
        }
        r.shots.push(shot);
    }
    if (!rows.size) return;
    // 补排尾：同排 offsetLeft 最大的格位（展开态帧格也算，父条插它后面才不挤乱布局）
    for (const c of allCards) {
        const r = rows.get(c.offsetTop);
        if (r && c.offsetLeft > r.last.offsetLeft) r.last = c;
    }
    const rowList = [...rows.values()].sort((a, b) => a.top - b.top);
    // 父条对账：现有父条（DOM 顺序 = 排顺序）与排组一一对应；多的淡出删除
    const strips = [...grid.querySelectorAll('.dialogue-strip:not(.dialogue-leave)')];
    while (strips.length > rowList.length) {
        const el = strips.pop();
        el.style.top = el.offsetTop + 'px';
        ghostOut(el);
    }
    // box 对账：全部现有 box（含在旧父条里的）按 dlgId 索引，换排 = 移动节点
    const boxMap = new Map();
    grid.querySelectorAll('.dialogue-box:not(.dialogue-leave)').forEach(b => boxMap.set(b.dataset.dlgId, b));
    // v0.9.9 修正：多余判断必须全局化（box 不属于任何排组才是真多余）——
    // 原 per-strip 判断会在 box 移到新父条前先把它判死 ghost（4 列缩放实测：除首排外
    // 所有父条 box 被清空），因为旧父条里的 box 属于"别的排组"，不该在旧父条处被删。
    const allWant = new Set();
    rowList.forEach(r => r.shots.forEach(s => allWant.add(s.id)));
    boxMap.forEach((b, id) => {
        if (!allWant.has(id)) {
            if (state.editingDlg === id) state.editingDlg = null;
            ghostOut(b, 150);
        }
    });
    const gridW = grid.clientWidth;
    rowList.forEach((row, i) => {
        let strip = strips[i];
        if (!strip) {
            strip = makeDialogueRow();
            strips.push(strip);
            grid.appendChild(strip);  // 先挂上，下面统一归位（同任务内无渲染帧，不闪）
            fadeIn(strip);
        }
        if (strip.previousElementSibling !== row.last) {
            row.last.insertAdjacentElement('afterend', strip);
        }
        // 组内台词镜头按列序（左→右；展开态对齐锚 = 第一个帧格）
        row.shots.sort((a, b) => alignOf.get(a.id).offsetLeft - alignOf.get(b.id).offsetLeft);
        // 每台词镜头一个 box：新建（fade-in）/换排移动/更新文本与位置
        // （多余 box 已在全局阶段删除；这里只归位 + 更新）
        const n = row.shots.length;
        const capW = Math.max(120, Math.floor((gridW - 16 - (n - 1) * 9) / n));  // 同排并排容量钳制
        let maxH = 0;
        row.shots.forEach((shot, si) => {
            const card = alignOf.get(shot.id);
            let box = boxMap.get(shot.id);
            if (!box) {
                box = makeDialogueBox(shot.id);
                boxMap.set(shot.id, box);
                strip.appendChild(box);
                fadeIn(box);
            } else if (box.parentElement !== strip) {
                strip.appendChild(box);  // 换排：移动节点
            }
            // 按列序插入（absolute 定位视觉不受 DOM 顺序影响，但保持整洁/
            // 编辑顺序正确）：box 应排在组内第 si 个 box 的位置
            const siblings = [...strip.querySelectorAll('.dialogue-box:not(.dialogue-leave)')];
            if (siblings.indexOf(box) !== si) {
                strip.insertBefore(box, siblings[si] || null);
            }
            // 文本（textContent 赋值自带转义，无 XSS 面）；双击编辑中不覆盖（editingDlg）
            const t = box.querySelector('.dialogue-text');
            if (state.editingDlg !== shot.id && t.textContent !== shot.dialogue) t.textContent = shot.dialogue;
            // 宽度（v0.9.10 每条独立：per-shot 覆盖 > 全局默认 > 列宽；同排并排时受容量钳制）
            // v0.9.21：再加右缘钳制——box 左偏移 + 宽度 ≤ grid 内容右缘-16。靠右列台词镜头
            // 缩放后自定义宽超过剩余空间 → 溢出视口 → 水平滚动条出现/消失 → 工具栏上下抖
            const availRight = Math.max(120, gridW - 16 - card.offsetLeft);
            const w = Math.min(dialogueWidthOf(shot.id), capW, availRight) + 'px';
            if (box.style.width !== w) box.style.width = w;
            // 左偏移 = 卡片左缘（absolute left 相对父条内容左缘 = grid 左缘；card.offsetLeft
            // 相对 grid 的 offsetParent 坐标，v0.9.9 起替代 getBoundingClientRect——零 reflow、
            // FLIP 动画期间免疫 transform 污染；v0.9.8 曾多加 body padding 16 右偏 16px）
            const l = card.offsetLeft + 'px';
            if (box.style.left !== l) box.style.left = l;
            maxH = Math.max(maxH, box.offsetHeight);
        });
        // 父条高 = 该排最高 box（absolute 子元素不撑高父条，需显式设；有变才写）
        const h = maxH + 'px';
        if (strip.style.height !== h) strip.style.height = h;
    });
}

// 拖拽调宽（右沿手柄）：mousedown 记起点，mousemove 改宽（rAF 节流），mouseup 持久化
export function initDialogueResize() {
    document.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('.dialogue-resize');
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        const box = handle.closest('.dialogue-box');
        const startX = e.clientX, startW = box.offsetWidth;
        const gridW = grid.clientWidth;
        // v0.9.17 修复：上限用同排容量 capW 而非 gridW-16——updateDialogue 渲染按 capW
        // 钳制（同排 N 条并排容量），拖宽上限不齐 = "拖完看是宽的，一重渲染（缩放/开关台词/
        // 心跳差分）缩回窄的"（用户实测拖宽 692 缩放后 542，map 值其实存上了）
        const n = box.parentElement ? box.parentElement.querySelectorAll('.dialogue-box:not(.dialogue-leave)').length : 1;
        const capW = Math.max(120, Math.floor((gridW - 16 - (n - 1) * 9) / n));
        document.body.style.userSelect = 'none';
        let raf = 0;
        const onMove = (ev) => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                // v0.9.21：上限同步渲染端右缘钳制（box 左偏移 + 宽 ≤ grid 右缘-16，
                // 与 relocateDialogue 的 availRight 同源，防拖宽超过剩余空间）
                const availRight = Math.max(120, gridW - 16 - box.offsetLeft);
                const w = Math.round(Math.min(Math.max(startW + ev.clientX - startX, 120), capW, availRight));
                // v0.9.10：只改被拖的这条（每条独立宽度）——v0.9.9 曾同步应用全部 box
                // 是全局共享宽度语义，现已废弃
                box.style.width = w + 'px';
            });
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            document.body.style.userSelect = '';
            // v0.9.10：per-shot 持久化——以被拖 box 的实际宽度为准存 map
            // （别 querySelector 第一条——那是别的镜头没拖的条，会覆盖掉拖出来的宽度）
            const shotId = box.dataset.dlgId;
            const w = Math.round(box.isConnected ? box.getBoundingClientRect().width : (dlgWidthMap[shotId] || 0));
            if (w > 0 && shotId) {
                dlgWidthMap[shotId] = w;
                localStorage.setItem(DLG_MAP_KEY, JSON.stringify(dlgWidthMap));
            }
        };
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    }, true);
}

// 台词条拖拽移动/互换（v0.9.16）：拖台词框体（非 resize 手柄）到其他镜头——
// 目标无台词 = 移动（台词+宽度自定义值跟走，源清空）；目标有台词 = 互换（台词与宽度对调）。
// 与 initDialogueResize 互斥（手柄不启动拖拽）；与卡片拖拽互斥（台词条不是 .shot-card）；
// marquee 已排除 .dialogue-strip（v0.9.8）。落点命中卡片（含展开态帧格）或台词条都算目标镜头。
export function initDialogueDrag() {
    let drag = null;          // {srcBox, srcId, startX, startY, active}
    let lastMove = null;      // pointercancel 无坐标时用最后 move 位置
    let targetEl = null;      // 当前高亮的目标元素（卡片或台词条）
    let suppressClickUntil = 0;

    const clearTarget = () => {
        if (targetEl) { targetEl.classList.remove('dlg-drop-target'); targetEl = null; }
    };

    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const box = e.target.closest('.dialogue-box');
        if (!box || e.target.closest('.dialogue-resize')) return;  // 手柄 = 调宽，不启动
        if (state.trashMode || state.editingDlg) return;
        drag = { srcBox: box, srcId: box.dataset.dlgId, startX: e.clientX, startY: e.clientY, active: false };
    }, true);

    document.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.active) {
            if (Math.hypot(dx, dy) < 6) return;  // 阈值内 = 点击/选择，不启动拖拽
            drag.active = true;
            drag.srcBox.classList.add('dlg-dragging');
            state.dragSrcEl = drag.srcBox;  // data.js 键盘保护：拖拽中忽略快捷键
            document.body.style.userSelect = 'none';
        }
        e.preventDefault();
        lastMove = { x: e.clientX, y: e.clientY };
        drag.srcBox.style.transform = `translate(${dx}px, ${dy}px)`;  // 源条跟随（反馈）
        // 命中检测：目标卡片（含展开态帧格）或目标台词条 → 高亮
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const hit = el && el.closest ? (el.closest('.shot-card') || el.closest('.dialogue-box')) : null;
        if (hit && hit !== drag.srcBox && (hit.dataset.id || hit.dataset.dlgId) !== drag.srcId) {
            if (targetEl !== hit) { clearTarget(); targetEl = hit; hit.classList.add('dlg-drop-target'); }
        } else {
            clearTarget();
        }
    }, true);

    const finishDrag = (e) => {
        if (!drag) return;
        const st = drag;
        drag = null;
        state.dragSrcEl = null;
        document.body.style.userSelect = '';
        // 同 dnd.js：先禁过渡把 transform 落定再恢复——否则 remove 恢复 transition 后
        // 清 transform 被当作一次过渡（起点 = 旧位置），elementFromPoint 命中"还在旧位置的源条"
        st.srcBox.style.transition = 'none';
        st.srcBox.style.transform = '';
        void st.srcBox.offsetWidth;   // 强制 reflow：transition none 下 transform 立即生效
        st.srcBox.style.transition = '';
        st.srcBox.classList.remove('dlg-dragging');
        clearTarget();
        if (!st.active) return;  // 未超阈值 = 点击，原生 dblclick 编辑照常
        suppressClickUntil = Date.now() + 600;  // 拦截拖拽后浏览器补派的 click
        const fx = (e.type === 'pointercancel' && lastMove) ? lastMove.x : e.clientX;
        const fy = (e.type === 'pointercancel' && lastMove) ? lastMove.y : e.clientY;
        const el = document.elementFromPoint(fx, fy);
        const hit = el && el.closest ? (el.closest('.shot-card') || el.closest('.dialogue-box')) : null;
        const dstId = hit ? (hit.dataset.id || hit.dataset.dlgId) : null;
        if (dstId && dstId !== st.srcId) moveOrSwapDialogue(st.srcId, dstId);
    };

    document.addEventListener('pointerup', finishDrag, true);
    document.addEventListener('pointercancel', finishDrag, true);

    // 拖拽后抑制浏览器补派的 click（双击编辑等点击逻辑不被拖拽误触发）
    document.addEventListener('click', (e) => {
        if (Date.now() < suppressClickUntil) {
            e.preventDefault();
            e.stopPropagation();
            suppressClickUntil = 0;
        }
    }, true);
}

// 台词移动/互换的数据操作：两次 update（乐观更新；失败回滚已成功的请求 + 本地 state/宽度 map）
async function moveOrSwapDialogue(srcId, dstId) {
    const src = state.shots.find(s => s.id === srcId);
    const dst = state.shots.find(s => s.id === dstId);
    if (!src || !dst) return;
    const srcText = src.dialogue || '';
    const dstText = dst.dialogue || '';
    const swap = !!(dstText && dstText.trim());
    // 目标无台词 = 移动（源清空）；有台词 = 互换
    const updates = swap
        ? [{ id: srcId, dialogue: dstText }, { id: dstId, dialogue: srcText }]
        : [{ id: srcId, dialogue: '' }, { id: dstId, dialogue: srcText }];
    // 宽度自定义值跟台词走（移动：src→dst；互换：对调），先备份旧 map 供失败回滚
    const oldMap = { ...dlgWidthMap };
    const srcW = dlgWidthMap[srcId], dstW = dlgWidthMap[dstId];
    if (swap) {
        if (srcW !== undefined) dlgWidthMap[dstId] = srcW; else delete dlgWidthMap[dstId];
        if (dstW !== undefined) dlgWidthMap[srcId] = dstW; else delete dlgWidthMap[srcId];
    } else {
        if (srcW !== undefined) dlgWidthMap[dstId] = srcW; else delete dlgWidthMap[dstId];
        delete dlgWidthMap[srcId];
    }
    const oldSrc = src.dialogue, oldDst = dst.dialogue;
    src.dialogue = updates[0].dialogue;
    dst.dialogue = updates[1].dialogue;
    const done = [];
    try {
        for (const u of updates) {
            const res = await fetch(`/api/shot/${u.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update', fields: { dialogue: u.dialogue } })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            done.push(u);
        }
    } catch (err) {
        console.error('Dialogue move/swap failed:', err);
        // 回滚已成功的请求（反序恢复旧值），本地 state 与宽度 map 一并还原
        for (const u of done.reverse()) {
            try {
                await fetch(`/api/shot/${u.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'update', fields: { dialogue: u.id === srcId ? oldSrc : oldDst } })
                });
            } catch { /* 尽力而为 */ }
        }
        src.dialogue = oldSrc;
        dst.dialogue = oldDst;
        Object.keys(dlgWidthMap).forEach(k => delete dlgWidthMap[k]);
        Object.assign(dlgWidthMap, oldMap);
        localStorage.setItem(DLG_MAP_KEY, JSON.stringify(dlgWidthMap));
        toast('台词移动失败，已还原');
    }
    renderGrid();  // 差分渲染 + updateDialogue 对账（源淡出/目标淡入自动）
}

// 缩放/视口变化后列数变 → 台词镜头可能换排，条位置/默认宽重算（zoom.js apply 注入调用）
export function relocateDialogue() {
    updateDialogue();
}

// 双击台词框就地编辑（v0.9.8）：复用 startRename 模式——input 替换文本、
// Enter 保存/Esc 取消/blur 保存、事件全 stopPropagation（防拖拽/框选）
export function startDlgEdit(e, shotId) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.editingDlg || state.trashMode) return;
    const shot = state.shots.find(s => s.id === shotId);
    if (!shot) return;
    let boxEl = grid.querySelector(`.dialogue-box[data-dlg-id="${shotId}"]`);
    let newStrip = null;
    if (!boxEl) {
        // v0.9.13 所见即所得（用户拍板）：添加台词的那一刻就建正式父条、下一行
        // FLIP 让位；提交后 renderGrid 对账直接复用父条+box = 台词固定原地；
        // 取消后父条按多余淡出、布局由 renderGrid 的 FLIP 还原。
        // （v0.9.12 曾用 absolute 浮层不占布局，提交后复用残留 inline top 掉 1545px）
        boxEl = makeDialogueBox(shotId);
        boxEl.style.width = dialogueWidthOf(shotId) + 'px';
        const card = grid.querySelector(`.shot-card[data-id="${shotId}"]`);
        if (card) {
            const rowTop = card.offsetTop;
            // 该排已有台词条（父条）→ 编辑框进父条，与其他台词框并排（同排多台词常态）
            let strip = [...grid.querySelectorAll('.dialogue-strip:not(.dialogue-leave)')]
                .find(s => s.previousElementSibling && s.previousElementSibling.offsetTop === rowTop);
            if (strip) {
                strip.appendChild(boxEl);
                boxEl.style.left = card.offsetLeft + 'px';
                boxEl.style.top = '0px';
            } else {
                // 无父条：立即建正式父条，插在该排最后格位后（台词条正式落点）
                let last = card;
                for (const c of grid.querySelectorAll('.shot-card')) {
                    if (c.offsetTop === rowTop && c.offsetLeft > last.offsetLeft) last = c;
                }
                strip = makeDialogueRow();
                newStrip = strip;
                const oldRects = captureRects();          // 插入前捕获全页（让位 FLIP）
                last.insertAdjacentElement('afterend', strip);
                strip.appendChild(boxEl);
                boxEl.style.left = card.offsetLeft + 'px';
                boxEl.style.top = '0px';
                strip.style.height = boxEl.offsetHeight + 'px';
                fadeIn(strip);
                animateFrom(oldRects);                    // 下一行让位动画
            }
        } else {
            grid.appendChild(boxEl);
        }
    }
    const textEl = boxEl.querySelector('.dialogue-text');
    if (!textEl) return;
    // 右沿手柄（8px）上的双击不算编辑
    if (e && e.target.closest('.dialogue-resize')) return;

    state.editingDlg = shotId;
    // v0.9.19：input → textarea（多行自动换行适配高度，与非编辑态 box 一致大小）；
    // Enter(无Shift)=保存、Shift+Enter=手动换行、Esc=取消、blur=保存
    const input = document.createElement('textarea');
    input.className = 'dialogue-edit';
    input.value = shot.dialogue;
    input.draggable = false;
    input.rows = 1;
    input.wrap = 'soft';
    ['mousedown', 'mousemove', 'mouseup', 'dragstart', 'selectstart', 'click', 'dblclick'].forEach(t => {
        input.addEventListener(t, (ev) => ev.stopPropagation());
    });
    textEl.replaceWith(input);
    // v0.9.19：高度随文字量自适应（textarea 撑高 box，父条高度跟随 = 下一排即时让位）
    const autoResize = () => {
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
        const st = boxEl.closest('.dialogue-strip');
        if (st) st.style.height = boxEl.offsetHeight + 'px';
    };
    input.addEventListener('input', autoResize);
    autoResize();
    // v0.9.13：新建父条（无父条排添加台词）高度跟实际编辑框走——量在 autoResize 后
    //（v0.9.19 前 input 比台词文本矮 padding 1px vs 6px，量错高度会让提交后父条高突变）
    if (newStrip) newStrip.style.height = boxEl.offsetHeight + 'px';
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        const newText = input.value.trim();
        state.editingDlg = null;
        // 换回文本元素（updateDialogue 会按最新 state.shots 同步内容）
        if (input.isConnected) input.replaceWith(textEl);
        if (commit && newText !== shot.dialogue) {
            commitDialogue(shotId, newText);
        } else {
            renderGrid();  // 未变更也重渲染，确保 strip 文本与 state 一致
        }
    };
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') finish(false);
        ev.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
}

async function commitDialogue(shotId, newText) {
    try {
        const res = await fetch(`/api/shot/${shotId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({action: 'update', fields: {dialogue: newText}})
        });
        const data = await res.json();
        if (data.status !== 'ok') {
            toast(data.message || '台词保存失败', true);
            renderGrid();
        } else {
            toast('台词已更新');
        }
    } catch (err) {
        toast('台词保存失败：' + err.message, true);
        renderGrid();
    }
}



// 首屏预载窗口：前 3 屏 eager，更远处 lazy（#2/#16）
function screenCardCount(screens) {
    const cardMin = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--card-min')) || 200;
    const cols = state.viewMode === 'list'
        ? 1
        : Math.max(1, Math.floor(window.innerWidth / (cardMin + 12)));
    const cardH = state.viewMode === 'list' ? 60 : (cardMin / (state.aspect || 16 / 9) + 60);  // 卡高随画幅比（v0.9.7）
    const rows = Math.max(1, Math.ceil(window.innerHeight / cardH));
    return cols * rows * screens;
}

function thumbImgHtml(shot, eager) {
    const load = eager ? 'eager' : 'lazy';
    return shot.thumb_path
        ? `<img class="shot-thumb" draggable="false" src="/shots/${encodeURIComponent(shot.name)}_${shot.id}/thumb.jpg?v=${shot.thumb_ver || 0}" loading="${load}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%23333%22 width=%22320%22 height=%22180%22/><text fill=%22%23666%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22>No image</text></svg>'">`
        : `<div class="shot-thumb" style="display:flex;align-items:center;justify-content:center;color:#666;">No render</div>`;
}

// ---- 多图镜头（v0.7.0）----
const SVG_NOIMG = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%23333%22 width=%22320%22 height=%22180%22/><text fill=%22%23666%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22>No image</text></svg>`;

function frameImgHtml(frame, shot, eager, extraClass = '') {
    const load = eager ? 'eager' : 'lazy';
    if (frame.imageUrl) {
        return `<img class="frame-img ${extraClass}" draggable="false" data-frame-id="${frame.id}" data-frame-no="${frame.frame_no}" src="${frame.imageUrl}" loading="${load}" onerror="this.src='${SVG_NOIMG}'">`;
    }
    // 红格子：数据在但图片缺失/加载失败
    return `<div class="frame-img frame-missing ${extraClass}" data-frame-id="${frame.id}" data-frame-no="${frame.frame_no}" data-tip="帧 ${frame.frame_no} 缺图，右键重拍"><span class="missing-no">f${frame.frame_no}</span></div>`;
}

// 折叠态一叠牌：N 张图叠放，封面在顶，后续图错位露边（最多露 3 层）
function stackHtml(shot, eager) {
    const frames = shot.frames || [];
    const cover = frames.find(f => f.isCover) || frames[0];
    const others = frames.filter(f => f !== cover).slice(0, 3);  // 只露 3 层
    let html = '<div class="frame-stack">';
    // 底层错位牌（先渲染的在最下）
    others.forEach((f, i) => {
        const depth = others.length - i;  // 越靠后越贴近封面
        html += frameImgHtml(f, shot, eager, `stack-layer layer-${depth}`);
    });
    // 封面在顶
    if (cover) html += frameImgHtml(cover, shot, eager, 'cover');
    html += `<button class="stack-badge" onclick="window.__sb.toggleListMulti('${shot.id}');event.stopPropagation();" data-tip="展开/折叠">${frames.length}</button>`;
    html += '</div>';
    return html;
}

// 展开态：一个 shot 渲染 N 个格位（帧格），底衬按行分段（每行一个实例，
// 跨行时次行自动出现对应宽度的底衬，不跨行时只有一个）
// 返回元素数组（renderGrid 逐个 append 进 fragment）
function buildExpandedCards(shot, eager) {
    const frames = shot.frames || [];
    const cards = [];

    // 当前宫格列数（与 zoom.js 的列数反算一致），用于判断展开后每行装几帧
    const cols = (() => {
        try {
            return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
        } catch { return 1; }
    })();

    // 展开的起始位置 = 该 shot 在 shots 数组里的索引 → 决定第一行能放几帧
    // （流式布局下，展开的第一个格位 = 折叠态卡片所在位置）
    // 逐帧分配行号：第一行剩余位置 = cols - (startIdx % cols)，之后每行 cols 个
    // v0.9.4 多展开并存：DOM 流式布局中该镜头实际起始列还要加上它前面所有
    // 已展开镜头多占的格位（每个展开镜头占 frames.length 格而非 1 格），
    // 否则后面镜头的行分段（frame-first/frame-row-last）按错误列算 → 底衬断层
    const startIdx = state.shots.findIndex(s => s.id === shot.id);
    let extra = 0;
    if (startIdx > 0) {
        for (let i = 0; i < startIdx; i++) {
            const s = state.shots[i];
            if ((s.frames || []).length > 1 && state.expandedShotIds.has(s.id)) {
                extra += s.frames.length - 1;
            }
        }
    }
    let rowStart = startIdx === -1 ? 0 : (startIdx + extra) % cols;

    // 计算每帧的行号 + 该行内的帧数（用于底衬宽度）
    const rowOf = [];      // 每帧的行号
    const rowCounts = [];  // 每行的帧数
    let curRow = 0;
    let colInRow = rowStart;
    frames.forEach((f, i) => {
        if (i > 0 && colInRow >= cols) { curRow++; colInRow = 0; }
        rowOf[i] = curRow;
        rowCounts[curRow] = (rowCounts[curRow] || 0) + 1;
        colInRow++;
    });

    frames.forEach((f, i) => {
        const wrap = document.createElement('div');
        const isRowHead = i === 0 || rowOf[i] !== rowOf[i - 1];
        const isRowTail = i === frames.length - 1 || rowOf[i] !== rowOf[i + 1];
        const first = i === 0;
        const last = i === frames.length - 1;  // v0.9.4：折叠按钮挂最后一张（左边缘）
        const cls = ['shot-card', 'frame-cell'];
        if (isRowHead) cls.push('frame-first');
        if (isRowTail) cls.push('frame-row-last');
        if (state.selectedIds.has(shot.id)) cls.push('selected');
        // 焦点帧蓝框跟手点击（v0.8.1）：focusedFrameId 属于本镜头才标框；
        // 不属于本镜头（焦点在别的镜头/已清空）→ 无框——同一时间全局只有一个选中框
        // （v0.9.2 定稿；v0.9.4 展开默认焦点=第一帧 focusFirstFrame，此处不再 fallback 封面帧，
        //  否则多展开镜头切视图时每个镜头都渲染出幽灵蓝框）
        const focusId = (state.focusedFrameId && frames.some(fr => fr.id === state.focusedFrameId))
            ? state.focusedFrameId : null;
        const imgCls = [f.isCover ? 'is-cover' : '', f.id === focusId ? 'frame-focused' : '']
            .filter(Boolean).join(' ');
        wrap.innerHTML = `
            <div class="${cls.join(' ')}" draggable="false" data-id="${shot.id}" data-frame-id="${f.id}">
                ${frameImgHtml(f, shot, eager, imgCls)}
                ${f.isCover ? `<div class="cover-chip">封面</div>` : ''}${first ? `<button class="stack-badge expanded-badge" onclick="window.__sb.toggleListMulti('${shot.id}');event.stopPropagation();" data-tip="折叠">${frames.length}</button>` : ''}
                ${last ? '<button class="collapse-btn" data-tip="折叠" data-action="collapse">◀</button>' : ''}
                <div class="shot-info">
                    ${first ? `<div class="shot-name" data-field="name">${esc(shot.name)}</div>` : `<div class="frame-no">f${f.frame_no}</div>`}
                    ${first ? `<div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>` : ''}
                </div>
            </div>`;
        const el = wrap.firstElementChild;
        el.dataset.key = cardKey(shot);
        cards.push(el);
    });
    return cards;
}

// ===== v0.9.5 展开态帧图布局（用户拍板）=====
// 每行独立计算：图宽 W = (行底衬宽 - 9×(行帧数+1)) / 行帧数，
// 行底衬宽 = 行帧数×列宽 + (行帧数-1)×gap（连片视觉宽，含被负 margin 吃掉的 gap）。
// 外沿 = 图间距 = 9px 严格统一（用户拍板 D：外沿 9 优先，跨行时行间图宽允许不同——
// 2+1 跨行的 2 格行图宽 > 1 格行图宽，但每行内图等大、间距/外沿全 9）。
// 图高 = W×9/16 等比例。实现：不重建 DOM、不动格子结构（底衬连片/负 margin/FLIP/
// 拖拽/右键全兼容），每格设 --frame-w 变量 + 每张图 inline margin-left 精确排布。
const FRAME_EDGE = 9;    // 固定间隔：图间距 = 外沿（用户定值）
const GRID_GAP = 12;     // 宫格 gap（与 zoom.js 的 GAP 一致）

function computeExpandedLayout() {
    const shots = state.shots;
    const expanded = shots.filter(s => (s.frames || []).length > 1 && state.expandedShotIds.has(s.id));
    if (expanded.length === 0) return null;
    const colW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-min'));
    if (!colW || colW <= 0) return null;
    const cols = (() => {
        try {
            return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
        } catch { return 1; }
    })();
    // 每镜头的行分段（与 buildExpandedCards 同逻辑：startIdx + 前面展开镜头占位补偿）
    const infos = expanded.map(shot => {
        const frames = shot.frames || [];
        const startIdx = shots.findIndex(s => s.id === shot.id);
        let extra = 0;
        for (let i = 0; i < startIdx; i++) {
            const s = shots[i];
            if ((s.frames || []).length > 1 && state.expandedShotIds.has(s.id)) extra += s.frames.length - 1;
        }
        const rowStart = startIdx === -1 ? 0 : (startIdx + extra) % cols;
        const rowOf = [], rowCounts = [];
        let curRow = 0, colInRow = rowStart;
        frames.forEach((f, i) => {
            if (i > 0 && colInRow >= cols) { curRow++; colInRow = 0; }
            rowOf[i] = curRow;
            rowCounts[curRow] = (rowCounts[curRow] || 0) + 1;
            colInRow++;
        });
        return { shot, frames, rowOf, rowCounts };
    });
    // 每行独立图宽 + 外沿（行内图等大，跨行行间允许不同——用户拍板 D）
    const rowWs = [];
    infos.forEach(info => info.rowCounts.forEach((k, r) => {
        const B = k * colW + (k - 1) * GRID_GAP;
        const W = (B - FRAME_EDGE * (k + 1)) / k;
        if (!isFinite(W) || W <= 0) return;
        rowWs.push({ shotId: info.shot.id, row: r, k, B, W });
    }));
    if (rowWs.length === 0) return null;
    return { colW, infos, rowWs };
}

// 应用展开态布局（渲染后 / 缩放、预览调宽后都调，幂等）：
// 设 --frame-w + 每图 margin-left + 行分段类同步（缩放列数变后差分复用的旧类跟随）
export function applyExpandedLayout() {
    const lay = computeExpandedLayout();
    if (!lay) return;
    const { colW, infos, rowWs } = lay;
    // 行 → {W, E} 映射；外沿 E = 余量对称均分（公式下 ≈ 9，浮点取整误差 ±0.5px）
    const rowMap = {};
    rowWs.forEach(x => {
        rowMap[x.shotId + ':' + x.row] = {
            W: x.W,
            E: (x.B - x.k * x.W - (x.k - 1) * FRAME_EDGE) / 2
        };
    });
    infos.forEach(({ shot, frames, rowOf }) => {
        const cells = grid.querySelectorAll(`.shot-card.frame-cell[data-id="${shot.id}"]`);
        frames.forEach((f, i) => {
            const cell = cells[i];
            if (!cell) return;
            const r = rowOf[i];
            const { W, E } = rowMap[shot.id + ':' + r] || { W: colW - 2 * FRAME_EDGE, E: FRAME_EDGE };
            let j = 0;
            for (let t = 0; t < i; t++) if (rowOf[t] === r) j++;
            // 图左缘（相对行底衬左）= 外沿 + j×(图宽+间距)；格左缘 = j×(列宽+gap)；
            // margin-left = 差值（首图 = 外沿；后续图可能为负 = 相对格子左移，底衬连片内可见）
            const marginLeft = E + j * (W + FRAME_EDGE) - j * (colW + GRID_GAP);
            cell.style.setProperty('--frame-w', W + 'px');
            const img = cell.querySelector('.frame-img');
            if (img) img.style.marginLeft = marginLeft + 'px';
            // 行分段类同步（缩放/预览改列数后，复用 cell 的旧类要跟随新布局）
            const isRowHead = i === 0 || rowOf[i] !== rowOf[i - 1];
            const isRowTail = i === frames.length - 1 || rowOf[i] !== rowOf[i + 1];
            cell.classList.toggle('frame-first', isRowHead);
            cell.classList.toggle('frame-row-last', isRowTail);
        });
    });
}

function buildCard(shot, eager) {
    const sel = state.selectedIds.has(shot.id) ? 'selected' : '';
    const wrap = document.createElement('div');
    if (state.viewMode === 'list') {
        const updated = (shot.updated_at || '').replace('T', ' ').slice(5, 16);
        const content = shot.content || '';
        const dialogue = shot.dialogue || '';
        const frames = shot.frames || [];
        const isMulti = frames.length > 1;
        const expanded = isMulti && state.expandedShotIds.has(shot.id);
        const toggleId = shot.id.replace(/[^a-zA-Z0-9]/g,'');
        const multiBadge = isMulti ? `<button class="multi-badge${expanded ? ' expanded' : ''}" onclick="window.__sb.toggleListMulti('${shot.id}');event.stopPropagation();">${frames.length}帧${expanded ? ' ◀' : ' ▶'}</button>` : '';
        // v0.8.4: 所有镜头折叠态缩略图 = 封面帧图（统一 frames 模型，单图=1 帧镜头；
        // 封面变更立即跟随；thumb.jpg 仅作 legacy 兜底）
        const coverFrame = frames.find(f => f.isCover) || frames[0];
        const thumbHtml = coverFrame && coverFrame.imageUrl
            ? `<img class="shot-thumb" draggable="false" src="${coverFrame.imageUrl}" loading="${eager ? 'eager' : 'lazy'}" onerror="this.src='${SVG_NOIMG}'">`
            : thumbImgHtml(shot, eager);
        // 展开态：封面图保持行高，帧缩略图浮层叠加
        let framesOverlay = '';
        if (expanded) {
            // v0.9.2：列表展开态子帧单焦点（与宫格 frame-focused 同语义）：
            // focusedFrameId 属于本镜头才标框，否则无框——同一时间全局只有一个选中框
            // （v0.9.4 展开默认焦点=第一帧 focusFirstFrame，不 fallback 封面帧，防多展开镜头幽灵蓝框）
            const focusId = (state.focusedFrameId && frames.some(fr => fr.id === state.focusedFrameId))
                ? state.focusedFrameId : null;
            const frameThumbs = frames.map(f => {
                const imgUrl = f.imageUrl || '';
                const cls = [f.isCover ? 'is-cover' : '', f.id === focusId ? 'frame-focused' : '']
                    .filter(Boolean).join(' ');
                return `<div class="frame-thumb ${cls}" data-frame-id="${f.id}" data-frame-no="${f.frame_no}" data-shot-id="${shot.id}">
                    ${imgUrl ? `<img src="${imgUrl}" loading="eager" draggable="false">` : '<div class="frame-missing">f' + f.frame_no + '</div>'}
                </div>`;
            }).join('');
            framesOverlay = `<div class="list-frames">${frameThumbs}${multiBadge}</div>`;
        }
        wrap.innerHTML = `
            <div class="shot-card list-item ${sel}${isMulti ? ' multi' : ''}${expanded ? ' expanded' : ''}" draggable="false" data-id="${shot.id}">
                <div class="thumb-wrap">
                    ${thumbHtml}
                    ${framesOverlay}
                </div>
                <div class="shot-name" data-field="name">${esc(shot.name)}${expanded ? '' : multiBadge}</div>
                <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                <div class="cell-text cell-edit ${content ? '' : 'empty'}" data-field="content">${esc(content) || '内容…'}</div>
                <div class="cell-text cell-edit ${dialogue ? '' : 'empty'}" data-field="dialogue">${esc(dialogue) || '台词…'}</div>
                <div class="shot-updated">${updated}</div>
            </div>`;
    } else {
        const frames = shot.frames || [];
        const isMulti = frames.length > 1;
        const expanded = state.expandedShotIds.has(shot.id);
        // #8: 宫格的时长也可以双击就地编辑
        if (isMulti && !expanded) {
            // 折叠态多图：一叠牌
            wrap.innerHTML = `
                <div class="shot-card multi ${sel}" draggable="false" data-id="${shot.id}">
                    ${stackHtml(shot, eager)}
                    <div class="shot-info">
                        <div class="shot-name" data-field="name">${esc(shot.name)}</div>
                        <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                    </div>
                </div>`;
        } else {
            // v0.8.4: 单图 = 1 帧镜头，卡片图统一用封面帧图（与列表/展开态同源）
            const coverFrame = frames.find(f => f.isCover) || frames[0];
            const coverImgHtml = coverFrame && coverFrame.imageUrl
                ? `<img class="shot-thumb" draggable="false" src="${coverFrame.imageUrl}" loading="${eager ? 'eager' : 'lazy'}" onerror="this.src='${SVG_NOIMG}'">`
                : thumbImgHtml(shot, eager);
            wrap.innerHTML = `
                <div class="shot-card ${sel}" draggable="false" data-id="${shot.id}">
                    ${coverImgHtml}
                    <div class="shot-info">
                        <div class="shot-name" data-field="name">${esc(shot.name)}</div>
                        <div class="shot-meta cell-edit" data-field="duration">${shot.duration.toFixed(1)}s</div>
                    </div>
                </div>`;
        }
    }
    // 用 wrap 返回，让 renderGrid 处理多子元素（列表视图的 list-item + list-frames）
    const key = cardKey(shot);
    for (const child of wrap.children) {
        if (child.dataset) child.dataset.key = key;
    }
    return wrap;
}

// 骨架屏 (#1/#3)：独立覆盖层盖在真实宫格上，揭幕时交叉淡化，全程无黑屏
export function showSkeleton() {
    const n = Math.min(screenCardCount(3), 90);
    const layer = document.createElement('div');
    layer.id = 'skelLayer';
    for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.className = 'skel-card';
        d.innerHTML = '<div class="skel-thumb"></div><div class="skel-line"></div>';
        layer.appendChild(d);
    }
    document.getElementById('gridWrap').appendChild(layer);
}

function removeSkeleton() {
    const layer = document.getElementById('skelLayer');
    if (!layer) return;
    layer.classList.add('out');
    setTimeout(() => layer.remove(), 420);
}
export function renderGrid() {
    // v0.9.3：差分重建会经过"grid 短暂变空"的中间态（复用节点移入 fragment 再挂回），
    // 浏览器在渲染帧把 scrollY clamp 掉 = 页面跳顶。任务内保存并在末尾恢复滚动位置，
    // 恢复后渲染帧时内容已完整、scrollY 有效，浏览器不再调整。
    let savedScrollY = window.scrollY;  // v0.9.18：let——锚定滚动（pendingAnchor）后更新，防末尾恢复逻辑滚回去
    const oldRects = captureRects();
    const isList = state.viewMode === 'list';
    // v0.9.4：增量维护 class——整体重设 className 会冲掉其它模块挂的 class
    // （预览框的 preview-on/preview-right/preview-left，展开多图 renderGrid 后预览布局丢）
    grid.classList.toggle('list-mode', isList);
    document.getElementById('listHeader').classList.toggle('on', isList && state.shots.length > 0);

    if (state.shots.length === 0) {
        // 空态：必须先揭掉骨架层，否则提示被盖住 = 卡骨架屏（v0.8.2）
        removeSkeleton();
        grid.innerHTML = state.trashMode
            ? '<div class="empty-state"><p>垃圾桶是空的</p></div>'
            : '<div class="empty-state"><p>No shots yet. Create one in Blender.</p></div>';
        updateStats();
        return;
    }

    // DOM 差分：按 id 复用未变化的卡片，只重建变了的
    // 展开态多图：一个 shot 渲染 N 个格位，复用键 = shotId 或 shotId:frameId
    const existing = new Map();
    grid.querySelectorAll('.shot-card').forEach(el => {
        const key = el.dataset.frameId ? `${el.dataset.id}:${el.dataset.frameId}` : el.dataset.id;
        existing.set(key, el);
    });

    const eagerCount = screenCardCount(3);
    const fragment = document.createDocumentFragment();
    const newCards = [];
    let idx = 0;
    for (const shot of state.shots) {
        const key = cardKey(shot);
        const isExpandedMulti = state.viewMode !== 'list' &&
            (shot.frames || []).length > 1 && state.expandedShotIds.has(shot.id);

        // 展开态：一个 shot 产 N 个格位，逐个走复用/重建
        const produced = isExpandedMulti ? buildExpandedCards(shot, true) : [...buildCard(shot, state.firstLoadDone ? true : idx < eagerCount).children];

        for (const el of produced) {
            const reuseKey = el.dataset.frameId ? `${el.dataset.id}:${el.dataset.frameId}` : el.dataset.id;
            const oldEl = existing.get(reuseKey);
            // 复用条件：差分键一致 且 卡片里没有残留输入框（编辑会话的安全网）
            if (oldEl && oldEl.dataset.key === key && !oldEl.querySelector('input')) {
                existing.delete(reuseKey);
                oldEl.classList.toggle('selected', state.selectedIds.has(shot.id));
                // v0.9.4 展开态底衬跟随重排：其它镜头展开/折叠会改变本镜头的
                // 实际行分段（换行），行首/行尾 class 必须按新分段重算，
                // 否则底衬按旧分段画 → 同镜头帧格间 12px 断层
                if (el.classList.contains('frame-first')) oldEl.classList.add('frame-first');
                else oldEl.classList.remove('frame-first');
                if (el.classList.contains('frame-row-last')) oldEl.classList.add('frame-row-last');
                else oldEl.classList.remove('frame-row-last');
                fragment.appendChild(oldEl);
                continue;
            }
            // 卡片被强制重建时，若它正挂着输入框，说明编辑会话已被打断，解锁编辑态
            if (oldEl && oldEl.querySelector('input') && state.editingId === shot.id) {
                state.editingId = null;
            }
            if (oldEl) {
                // img 移植：src 没变就把加载好的旧 img 直接挪过来，零闪烁；
                // src 变了（新拍屏）只给新 img 做透明度渐变，卡片本身不动
                const oldImg = oldEl.querySelector('img.shot-thumb, img.frame-img.cover, img.frame-img');
                const newImg = el.querySelector('img.shot-thumb, img.frame-img.cover, img.frame-img');
                if (oldImg && newImg) {
                    if (newImg.src === oldImg.src && oldImg.complete) {
                        newImg.replaceWith(oldImg);
                    } else if (newImg.src !== oldImg.src) {
                        newImg.style.opacity = '0';
                        newImg.style.transition = 'opacity 0.25s';
                        const show = () => { newImg.style.opacity = '1'; };
                        if (newImg.complete) show();
                        else {
                            newImg.addEventListener('load', show, { once: true });
                            newImg.addEventListener('error', show, { once: true });
                        }
                    }
                }
            } else {
                newCards.push(el);  // 只有真正新来的卡片才播入场动画
            }
            fragment.appendChild(el);
        }
        idx++;
    }
    existing.forEach(el => el.remove());  // 已删除/移出当前视图的镜头
    // v0.9.3：empty-state（初始 "Loading shots..."）不参与 .shot-card 差分，
    // 删 grid.innerHTML='' 后必须显式移除，否则残留 = 宫格左上角/列表第一行永远挂占位提示。
    // （空态提示只在 shots=0 分支通过 innerHTML 重建，此处 shots>0，移除安全）
    const staleEmpty = grid.querySelector('.empty-state');
    if (staleEmpty) staleEmpty.remove();
    // v0.9.3：不能 grid.innerHTML = '' —— 清空滚动内容会让浏览器同步把 scrollY clamp 到 0
    // （同一任务内立即重建也不恢复），展开/折叠/任何 renderGrid 都会把页面弹回顶部。
    // 差分语义已由 existing.remove + fragment.append 完整覆盖（旧节点要么被复用移入
    // fragment，要么被 remove，grid 此时已无残留），无需全量清空。
    grid.appendChild(fragment);
    // v0.9.5：展开态帧图等大布局（--frame-w + margin-left）——必须在 FLIP 测量前应用，
    // 否则动画从旧图宽的位置起飞；差分复用路径也靠这里重算（列宽/列数变化后）
    applyExpandedLayout();

    // v0.9.9：台词条父条增删/归位必须赶在 FLIP 播放前——父条占整行，
    // 增删引起的全页卡片位移要被同一轮 FLIP 吸收（原 v0.9.8 在 animateFrom
    // 之后调用，台词条消失时卡片会先按"父条还在"布局飞完再跳一下）
    updateDialogue();

    // v0.9.18：锚定滚动提前到 FLIP 之前（台词开关以焦点镜头为中心，v0.9.17 的
    // restoreAnchorDlg 原在 renderGrid 返回后滚动——FLIP transform 起点是文档 offset 差，
    // 滚动与动画同帧叠加时起点帧焦点不在原位：页面末尾镜头（c0960）上方多排父条增删
    // 布局位移 ±476px，开关台词实测焦点上跳 356px/下掉 476px 再飞回 = 上下抖）。
    // 滚动先落定 → animateFrom 的 dy 补偿 (captureScrollY - 当前scrollY) → 起点=旧视口位置、
    // 终点=新视口位置（=旧 rel）→ 焦点全程钉住，周围卡片围绕它垂直扩散。
    if (state.pendingAnchor) {
        const a = state.pendingAnchor;
        state.pendingAnchor = null;
        const sel = grid.querySelector(`.shot-card[data-id="${a.id}"]`);
        if (sel) {
            const target = a.gridDocTop + sel.offsetTop + sel.offsetHeight / 2
                         - window.innerHeight / 2 - a.rel;
            savedScrollY = Math.max(0, Math.round(target));
            window.scrollTo(0, savedScrollY);
        }
    }

    // 首屏门控：首屏缩略图就位后波浪式揭幕 (#1)
    if (!state.firstLoadDone) {
        state.firstLoadDone = true;
        gateFirstReveal();
    } else {
        // 新出现/有变化的卡片：淡入 + 缩略图加载完再淡显
        newCards.forEach(el => {
            if (state.animatingShots.has(el.dataset.id)) return;  // 弹簧编排接管中，别播入场
            el.classList.add('fade-in');
            // 入场播完立刻摘类——类留着的话，下次重排 DOM 动画会重播 = 闪黑 (#R6-1)
            el.addEventListener('animationend', () => el.classList.remove('fade-in'), {once: true});
            const img = el.querySelector('img.shot-thumb');
            if (img && !img.complete) {
                img.style.opacity = '0';
                img.style.transition = 'opacity 0.3s';
                const show = () => { img.style.opacity = '1'; };
                img.addEventListener('load', show, { once: true });
                img.addEventListener('error', show, { once: true });
            }
        });
        // v0.9.2 视图切换中心扩散：viewSpreadId 设置时，FLIP 起点统一收敛到选中项
        // 位置再向外扩散——先定位后，视觉上卡片从选中项向四周炸开（丝滑过渡）
        const spreadId = state.viewSpreadId;
        state.viewSpreadId = null;  // 一次性消费
        let spreadCenter = null;
        if (spreadId) {
            const el = grid.querySelector(`.shot-card[data-id="${spreadId}"]`);
            if (el) spreadCenter = { left: el.offsetLeft + el.offsetWidth / 2, top: el.offsetTop + el.offsetHeight / 2 };
        }
        animateFrom(oldRects, spreadCenter);
    }
    updateStats();
    // v0.9.3：恢复滚动位置（见函数头注释）——浏览器在 grid 空中间态的渲染帧把 scrollY
    // clamp 掉了（跳顶/跳到 674 类值），这里同步滚回原值；此时内容已完整，scrollY 有效，
    // 浏览器渲染帧不会再调整。首屏（scrollY=0）与 FLIP 起点帧不受影响。
    if (window.scrollY !== savedScrollY) window.scrollTo(0, savedScrollY);
}

function gateFirstReveal() {
    const firstScreen = screenCardCount(1);
    const cards = [...grid.querySelectorAll('.shot-card')];
    const imgs = cards.slice(0, firstScreen)
        .map(c => c.querySelector('img.shot-thumb')).filter(Boolean);
    const total = Math.max(imgs.length, 1);
    let settled = 0;
    let finished = false;
    // 真实卡片不再隐身——骨架层盖在上面，揭幕时两层交叉淡化，无黑屏 (#3)

    const finish = () => {
        if (finished) return;
        finished = true;
        removeSkeleton();  // 骨架层淡出 350ms，下面真实卡片同步波浪入场
        // 波浪式错峰入场：每张卡片延迟 25ms 递增（上限 700ms）
        cards.forEach((el, i) => {
            el.style.animationDelay = `${Math.min(i * 25, 700)}ms`;
            el.classList.add('fade-in');
        });
        // v0.9.17：台词条比卡片晚 500ms 入场（用户拍板）——首屏新建的父条/box 在
        // fadeIn 挂起为 opacity 0（骨架下播动画用户看不到），揭幕时统一延迟淡入。
        // 注意：不能提前设 opacity 1（delay 期间会先闪出完整台词条再消失重播）；
        // 也不能不定格（动画播完无 fill-mode，内联 opacity 0 会跳回 = 台词条消失）——
        // 定格放在 animationend 回调（动画 to 态就是 1，无视觉跳变）
        const dlgEls = [...grid.querySelectorAll('.dialogue-strip:not(.dialogue-leave), .dialogue-box:not(.dialogue-leave)')];
        dlgEls.forEach(el => {
            el.style.animationDelay = '500ms';
            el.classList.add('dialogue-in');
            el.addEventListener('animationend', () => {
                el.style.opacity = '1';
                el.style.animationDelay = '';
                el.classList.remove('dialogue-in');
            }, { once: true });
        });
        // 播完清掉延迟和类：类不摘的话，卡片下次重排 DOM 会重播入场 = 全屏闪黑 (#R6-1)
        setTimeout(() => {
            cards.forEach(el => { el.style.animationDelay = ''; el.classList.remove('fade-in'); });
        }, 1400);
    };
    const tick = () => {
        if (finished) return;
        settled++;
        if (settled >= total) finish();
    };
    if (!imgs.length) { finish(); return; }
    imgs.forEach(img => {
        if (img.complete) { tick(); return; }
        img.addEventListener('load', tick, { once: true });
        img.addEventListener('error', tick, { once: true });
    });
    setTimeout(finish, 4000);  // 兜底：慢图不挡门
}

// FLIP 动效：记录旧位置 → 渲染后 invert → 播放到新位置
// 键必须与 renderGrid 复用键一致（v0.8.1）：展开态 N 个帧格共享 dataset.id，
// 只按 id 存 rect 会互相覆盖——任何排序都让帧格从错误位置起飞（"多图自己滑一下"的根因）
// 测量用 offsetLeft/offsetTop 而非 getBoundingClientRect（v0.8.1）：
// offset* 是纯布局值，不受 transform 影响——上一轮未播完的 FLIP invert / 进行中的
// transition 不会污染下一轮捕获（getBoundingClientRect 含 transform，会连环污染）
// spreadCenter 非空（v0.9.2 视图切换）：所有卡片起点收敛到该中心（选中项）再向外
// 扩散——卡片 transform 从中心偏移到自身新位置，视觉上以选中项为中心炸开
function rectKeyOf(el) {
    return el.dataset.frameId ? `${el.dataset.id}:${el.dataset.frameId}` : el.dataset.id;
}

function captureRects() {
    const map = new Map();
    const sy = window.scrollY;  // v0.9.18：FLIP 起点补偿滚动差（锚定滚动提前后 animateFrom 需知道滚动量）
    document.querySelectorAll('.shot-card').forEach(c => {
        map.set(rectKeyOf(c), { left: c.offsetLeft, top: c.offsetTop, scrollY: sy });
    });
    return map;
}

function animateFrom(oldRects, spreadCenter = null) {
    if (!oldRects || !oldRects.size) return;
    // v0.9.24：FLIP 动画中间态横向溢出（视图切换实测 scrollWidth 冲到 1976px）→
    // 水平滚动条闪现吃视口高 10px → fixed 底部工具条上下抖一下。
    // 动画期间 body 禁横向滚动条（溢出裁掉即可，本来就在视口外），过渡 0.28s 后恢复。
    const body = document.body;
    body.classList.add('no-hscroll');
    clearTimeout(body._hscrollT);
    body._hscrollT = setTimeout(() => body.classList.remove('no-hscroll'), 320);
    document.querySelectorAll('.shot-card').forEach(c => {
        if (state.animatingShots.has(c.dataset.id)) return;  // 弹簧编排接管中，FLIP 让位
        let dx, dy;
        if (spreadCenter) {
            // 中心扩散模式：起点 = 从选中项中心出发
            dx = spreadCenter.left - (c.offsetLeft + c.offsetWidth / 2);
            dy = spreadCenter.top - (c.offsetTop + c.offsetHeight / 2);
        } else {
            const old = oldRects.get(rectKeyOf(c));
            if (!old) return;
            dx = old.left - c.offsetLeft;
            // v0.9.18：FLIP 起点补偿滚动差——锚定滚动（台词开关）提前到 animateFrom 之前后，
            // transform 起点按"旧视口位置"算（旧布局位置 - 滚动量），滚动与 FLIP 同帧叠加时
            // 焦点镜头不再飞走再飞回（c0960 页面末尾镜头开关台词实测抖 ±476px 的根因）
            dy = old.top - c.offsetTop - (old.scrollY - window.scrollY);
        }
        if (!dx && !dy) return;
        c.style.transition = 'none';
        c.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
            c.style.transition = '';
            c.style.transform = '';
        });
    });
}

// 右下角统计 (#8) + 垃圾桶模式标题同步 (#3) + 标题栏总镜数/总时长 (v0.9.5)
// 标题统一在此渲染：避免各处 innerText/textContent 赋值清掉 statsBar 子节点
export function updateStats() {
    document.getElementById('statTotal').textContent = state.shots.length;
    document.getElementById('statSel').textContent = state.selectedIds.size;
    const pt = document.getElementById('pageTitle');
    if (!pt) return;
    const title = state.trashMode ? `垃圾桶 · ${state.shots.length}` : (state.projectTitle || 'Storyboard Grid');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    pt.innerHTML = esc(title) + '<span id="statsBar" class="stats-bar"></span>';
    const totalSec = state.shots.reduce((a, s) => a + (Number(s.duration) || 0), 0);
    const mm = Math.floor(totalSec / 60);
    const ss = Math.round(totalSec % 60);
    pt.querySelector('#statsBar').textContent = `总镜数 ${state.shots.length} 总时长 ${mm}′${String(ss).padStart(2, '0')}″`;
}

// 视图切换（v0.9.2 丝滑过渡）：先定位到选中项，再以选中项为中心向外扩散 FLIP
// v0.9.22：拆分「宫格视图/列表视图」两个独立按钮（setView 幂等直切），
// toggleView 保留给 Tab 快捷键（keyboard.js）与 __sb 调试句柄
export function setView(mode) {
    if (state.viewMode === mode) return;
    state.viewMode = mode;
    localStorage.setItem('sb-view', state.viewMode);
    syncViewToggleButton();
    grid.querySelectorAll('.shot-card').forEach(el => { el.dataset.key = ''; });
    const selId = [...state.selectedIds][0] || null;
    state.viewSpreadId = selId;  // 扩散 FLIP 中心（renderGrid 内部消费后清空）
    renderGrid();
    // 刷新缩放滑块（列表/宫格各自的范围不同）
    if (window.__zoomApply) window.__zoomApply();
    // 先定位：立即滚到选中镜头（scrollIntoView 按布局位置，不受 FLIP transform 影响；
    // FLIP 用 offset* 计算同样不受滚动影响，定位与扩散互不干扰）
    if (selId) {
        const card = grid.querySelector(`.shot-card[data-id="${selId}"]`);
        if (card) card.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
}

export function toggleView() {
    setView(state.viewMode === 'grid' ? 'list' : 'grid');
}

export function syncViewToggleButton() {
    const g = document.getElementById('viewGridBtn');
    const l = document.getElementById('viewListBtn');
    if (g) g.classList.toggle('active-view', state.viewMode === 'grid');
    if (l) l.classList.toggle('active-view', state.viewMode === 'list');
}
