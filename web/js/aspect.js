// 画幅比/分辨率设置（v0.9.7）：
// ①applyAspect 运行时注入画幅 CSS（--aspect 变量 + 旧图适配规则，零 DOM 重建，丝滑原则）
// ②aspectModal 对话框（复用 createModal 模式：Enter 提交 / Esc·点遮罩关闭）
// 显示规则（用户拍板）：已有图以 16:9 为基准——新比例更宽→裁上下（cover），
// 更高→上下留空（letterbox 居中，容器底色 #111113 与底衬一致）；预览框同款（决策 A）。
// Blender 侧（决策 B）：宽高直改所有 Scene 的 resolution_x/y，新镜头按此设置（scenes.py）。
import { state, SRC_ASPECT } from './state.js';
import { toast } from './ui.js';

const STYLE_ID = 'aspectStyle';

// 常用长宽比预设（v0.9.22）：电影工业 + 屏幕 + 摄影 + 竖屏，点击填充 W/H
// （保持当前 H 不变，W = round(H × ratio)；H 无效时按 1080 兜底）
export const ASPECT_PRESETS = [
    { label: '1:1', ratio: 1 },
    { label: '4:3', ratio: 4 / 3 },
    { label: '5:4', ratio: 5 / 4 },
    { label: '3:2', ratio: 3 / 2 },
    { label: '16:10', ratio: 16 / 10 },
    { label: '16:9', ratio: 16 / 9 },
    { label: '21:9', ratio: 21 / 9 },
    { label: '1.37:1', ratio: 1.37 },   // 学院比例（有声电影）
    { label: '1.66:1', ratio: 1.66 },   // 欧洲宽银幕
    { label: '1.85:1', ratio: 1.85 },   // 美国学院宽银幕
    { label: '2.20:1', ratio: 2.2 },    // 70mm
    { label: '2.35:1', ratio: 2.35 },   // 变形宽银幕 35mm
    { label: '2.38:1', ratio: 2.38 },   // 变形宽银幕（通用发行）
    { label: '2.39:1', ratio: 2.39 },   // 变形宽银幕（现行标准）
    { label: '2.55:1', ratio: 2.55 },   // CinemaScope 初代
    { label: '2.76:1', ratio: 2.76 },   // Ultra Panavision 70
    { label: '4:5', ratio: 4 / 5 },
    { label: '3:4', ratio: 3 / 4 },
    { label: '9:16', ratio: 9 / 16 },
];

// 宽高比数字 → 最简分数显示（1.7778 → "16:9"，1.3333 → "4:3"，除不尽 → "2.39:1"）
export function aspectLabel(a) {
    for (let d = 1; d <= 100; d++) {
        const n = a * d;
        if (Math.abs(n - Math.round(n)) < 0.005) return `${Math.round(n)}:${d}`;
    }
    return `${a.toFixed(2)}:1`;
}

// 运行时画幅 CSS：--aspect 变量供 base 规则的 var(--aspect, ...) 兜底链使用，
// 其余选择器用具体数值（后者优先级 = 等 specificity 后定义胜出，无需 !important）。
// fit 规则只加在 img 上：红格子占位 div（.frame-missing）保持铺满格子。
export function applyAspect() {
    const a = state.aspect || 16 / 9;
    const wider = a > SRC_ASPECT + 0.001;   // 比 16:9 宽 → 裁上下（cover）
    const h = a > 0 ? +(1 / a).toFixed(5) : 0.5625;  // 高宽比（9/16 的动态版）
    document.documentElement.style.setProperty('--aspect', a);
    document.documentElement.style.setProperty('--aspect-h', h);
    let s = document.getElementById(STYLE_ID);
    if (!s) {
        s = document.createElement('style');
        s.id = STYLE_ID;
        document.head.appendChild(s);
    }
    s.textContent = `
.shot-thumb, .frame-stack, .thumb-wrap,
.shot-card.list-item .shot-thumb, .shot-card.list-item .list-frames .frame-thumb img,
.shot-card.list-item .frame-thumb, .list-frames .frame-thumb {
    aspect-ratio: ${a};
}
.shot-card.frame-cell .frame-img { height: calc(var(--frame-w, var(--card-min)) * ${h}); }
.shot-card:not(.list-item):not(.frame-cell) > .shot-thumb,
.frame-stack .frame-img, .thumb-wrap .shot-thumb {
    object-fit: ${wider ? 'cover' : 'contain'};
    background: #111113;
}
.shot-card.list-item .shot-thumb, .shot-card.list-item .list-frames .frame-thumb img {
    object-fit: ${wider ? 'cover' : 'contain'};
    background: #111113;
}
.preview-body img {
    object-fit: ${wider ? 'cover' : 'contain'};
    background: #111113;
}`;
}

// ---- 对话框 ----
export async function openAspectModal() {
    const modal = document.getElementById('aspectModal');
    // 预填当前项目分辨率（state 缓存优先，首次打开从 API 拉）
    let rx = state.resolution && state.resolution.x;
    let ry = state.resolution && state.resolution.y;
    if (!rx || !ry) {
        try {
            const res = await fetch('/api/project');
            const data = await res.json();
            if (data.status === 'ok') {
                rx = data.resolution_x; ry = data.resolution_y;
                state.resolution = { x: rx, y: ry };
                state.aspect = data.aspect || 16 / 9;
            }
        } catch (e) { /* 用默认 */ }
    }
    document.getElementById('aspectW').value = rx || 1920;
    document.getElementById('aspectH').value = ry || 1080;
    modal.style.display = 'flex';
    const input = document.getElementById('aspectW');
    input.focus();
    input.select();
}

export function closeAspectModal() {
    document.getElementById('aspectModal').style.display = 'none';
}

export async function submitAspect() {
    const w = parseInt(document.getElementById('aspectW').value, 10);
    const h = parseInt(document.getElementById('aspectH').value, 10);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 16384 || h > 16384) {
        toast('宽/高需为 16~16384 的整数', true);
        return;
    }
    closeAspectModal();
    try {
        const res = await fetch('/api/project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ width: w, height: h })
        });
        const data = await res.json();
        if (data.status !== 'ok') {  // v0.9.6 基线：检查返回值再 toast
            toast(data.message || '设置失败', true);
            return;
        }
        state.aspect = data.aspect;
        state.resolution = { x: data.resolution_x, y: data.resolution_y };
        applyAspect();
        toast(`画幅 ${w}×${h}（${aspectLabel(data.aspect)}）· 已应用到全部场景`);
    } catch (e) {
        toast('设置请求失败', true);
    }
}

export function initAspect() {
    applyAspect();  // 默认 16:9 注入（API 拉到真实值后 loadProjectTitle 会再调）
    document.getElementById('aspectBtn').addEventListener('click', openAspectModal);
    // v0.9.22：预设比例 chips —— 点击只填 W/H（保持当前 H），不自动提交
    const presetsEl = document.getElementById('aspectPresets');
    presetsEl.innerHTML = ASPECT_PRESETS.map(p =>
        `<button type="button" class="preset-chip" data-ratio="${p.ratio}" title="填充 ${p.label}">${p.label}</button>`
    ).join('');
    presetsEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.preset-chip');
        if (!chip) return;
        const ratio = parseFloat(chip.dataset.ratio);
        const h = parseInt(document.getElementById('aspectH').value, 10);
        const baseH = Number.isInteger(h) && h >= 16 ? h : 1080;
        document.getElementById('aspectW').value = Math.round(baseH * ratio);
        document.getElementById('aspectH').value = baseH;
    });
    const modal = document.getElementById('aspectModal');
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitAspect();
        else if (e.key === 'Escape') closeAspectModal();
    });
    modal.addEventListener('click', (e) => {
        if (e.target.id === 'aspectModal') closeAspectModal();
    });
    modal.querySelector('.btn-cancel').addEventListener('click', closeAspectModal);
    modal.querySelector('.btn-primary').addEventListener('click', submitAspect);
}
