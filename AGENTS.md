# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**
> 2026-08-09 压缩维护：v0.9.38/37 详细保留，更早版本压成一行进历史轮次；坑区保留近三版详细 + 操作型坑，历史方法论坑合并。

## 刚做完（v0.9.39：时间线三连 + 宫格排不满，2026-08-09 已推，跳过全量回归用户拍板）

- **v0.9.38f clip 超高借 stage 空间**（用户需求"撑开上沿不是下沿"）：clip 超高时 timeline 上沿向上撑（分隔条上移）、预览区收缩让空间、页面不滚动；常规 = 分割比例（默认 7:3）不变，clip 缩回自动恢复比例；stage 保底 180px（用户拍板 A 方案），借到保底仍超高才页面滚动兜底。核心 = `stageHeightFor(pct)`（clamp 比例 → 借空间 needH=38+clipH+12 → 保底 180）+ `tlNeedHeight()` 同源；applyTlSplit/setSplitPct/renderTimeline minHeight 统一走它。验证 14/14（高视口/真实视口/矮视口边界/拖动被 needH 钉住/缩回跳回比例）+ PIL divider 像素吻合
- **v0.9.38g 时间线按钮进工具条**（库任务清单项）：header 临时文字按钮 btnTimeline 删除 → 工具条图标按钮 viewTimelineBtn（位置 = 宫格|列表|**时间线**|预览）；时间线视图下预览按钮**锁定高亮不可关闭**（点击/V 键均门控，侧边面板 CSS 隐藏，切回按 previewOn 恢复）；syncViewToggleButton 加 timeline 高亮 + previewBtn 锁定；icons.js 新增 shijianxian 图标（双轨道+三镜头块，线宽 2px——首版 1.3px 太细 PIL 抓出加粗）。验证 23/23 + PIL 三按钮笔画占比
- **v0.9.38h 宫格排不满修复**（用户报告）：sb-cols=3 实际只渲染 2 列 + 右侧 318px 空白。根因两层：①availWidth() 用 clientWidth（整数 941）而 auto-fill 用真实小数宽 940.739（滚动条 10.27px）→ 列宽偏大 0.26px；②--card-min toFixed(2) 四舍五入再超界（305.667→305.67，×3+24=941.01>940.739 差 0.01px 放不下）。修 = availWidth 改 getBoundingClientRect().width + --card-min 减 0.05px 余量（安全区间 (avail+gap)/n(n+1) ≥6px 恒有效）。验证 16/16（983 用户视口 gap 318→0、1280 3/4 列、600 clamp、开预览）+ PIL 右缘 <1px。排查手法：独立复制容器对照 + 列宽二分定位（实验2：305.5 三列 305.6 两列）
- 版本号 0.9.38 → 0.9.39（bl_info + index.html 关于徽章硬编码两处，跳过全量回归用户拍板直接推）

## 刚做完（v0.9.38：时间线五项 + 缩放锚定，2026-08-09 已推，跳过全量回归用户拍板）

- **时间线台词块移到镜头块上方**（库任务清单项）：台词轨道 top 0（高 34），镜头轨道下移 38px；CSS 两行位置对调，JS 零改动
- **时间线缩略图三连**：①显示全（contain + object-position left）②左对齐（宽 100% 跟随 clip）③最小极值缩小 2 倍（clip 宽下限 104→52，档位 52~316 步进 24 共 12 档）；档位常量 export 供 zoom.js 同源
- **时间线缩略图等比缩放**（推翻 v0.9.37"只缩放横轴"）：clip 高动态 = (clipW-2)×0.75+22；坑 292 几何约束结论作废
- **预览区/缩略图区可拖动分割**：#tlDivider 默认 7:3 + localStorage 持久化（sb-tl-split），clamp（stage≥180、timeline≥150，计入 grid gap 12×2 + divider 开销）
- **缩略图下沿对齐 + 区域自适应 + 缩放中心=焦点下沿**：clip bottom:0 贴底放大向上长；timeline min-height = 38+clipH+12；缩放锚定焦点 clip 水平位置；stage 高度改 JS 像素（基准读 computed min-height）
- 版本号 0.9.37 → 0.9.38

## 刚做完（v0.9.37：时间线去时间轴改版 + 快捷键全盘落地 + 宫格缩放两修复，已推）

- **时间线去时间轴改版**（用户三轮拍板）：时间标尺删除；clip 等宽不再∝时长（初始 200px 顺序均布 gap 12）；缩略图统一 4:3（104×78 居中 cover）；缩放只缩放横轴（档位 104~320 步进 24 共 10 档全入口生效）——v0.9.38 已推翻改等比；台词块同宽同位对齐；顶部预览"第 N 镜"
- **时间线快捷键全盘落地**：方向键线性序列（←→ 移动/Shift 扩展/↑↓ 无操作）、空格保持禁用（防 expandedShotIds 污染）、Tab 两态/V 内部 return/Ctrl++- 分流/Esc 维持；SHORTCUTS 同步
- **宫格缩放两修复**：①v0.9.32 range 滑块门控过宽——放行 Ctrl/Meta 组合键（方向键仍门控）②renderGrid 切回宫格摘 timeline-mode class（坑 183）
- **时间线横轴缩放 apply 幂等修复**：以 sb-tl-w 持久化为唯一事实源（档位化写回），滑块仅显示同步（防刷新直落 200→176 污染）
- 验证 19/19 + 12/12 + 22/22；版本号 0.9.36 → 0.9.37

**历史轮次**（详情曾在本文件，已压缩；关键决策见「交互/设计约定」与「坑」）：
- v0.9.35：Blender 面板 UX 四连（帧按钮当前帧高亮/按钮布局/复制后自动切场景/关于文案升级）+ web 八项（垃圾桶其它页互斥竞态【exitOtherMode 未 await 双 fetch 并发会 purge 正常镜头】/其它页 Delete 快捷键/垃圾桶红点角标浮层化/主菜单重构【皮肤二级菜单】/T 快捷键开关台词/空态整页居中/按钮点击焦点残留 blur）/ 版本 0.9.34→0.9.35
- v0.9.34：台词条拖宽手柄视觉系列（SVG 图标/hover 显示/中心锚定）+ 拖拽 scale(0.7) + 预览画幅标准（只能裁上下）+ 面板实时刷新（redraw_view3d+缓存失效）+ 删帧残留清理（坑 249/256-259）
- v0.9.36：时间线视图首版（顶部预览+横向时间线 100px/s+5s 标尺+台词轨道+字幕浮层；clip 复用 .shot-card；垃圾桶其它页互斥自动退；修 4 bug：预览不跟随/写死 img/直落滑块未禁用/残留卡片推飞 48000px；v0.9.37 已按用户拍板去时间轴改版）
- v0.9.33：折叠态多图焦点框语义定稿（selected::after inset:-2px 重画 2px accent 环 z-999）+ 多图层牌右缘伸出修复（水平错位 2px=border 厚）
- v0.9.32：缩放滑块三修（marquee 排除列表补 .zoom-bar / keyboard 门控拆 range / Tab 后 blur）+ 单图封面直角伸出圆角修复 + 多图焦点框两 bug + 列表拖动卡顿调查结论（连续像素缩放贴 16.6ms 预算非 bug）
- v0.9.29~v0.9.31：角标包角大三角 + 全站防文本选中 + Blender 初始化门控 + 面板删当前帧/复制镜头 + 角标四条标准 + 焦点框修复两连（inset box-shadow 在 img 之下不可见→border 方案；折叠态多图焦点落封面帧）
- v0.9.20：PyWebView 双端桌面窗口外壳（_runtime 54MB 自包含/单实例 PID 锁/watchdog/深色标题栏/悬浮化 owner/WebView2 CDP 测试体系）
- v0.9.19：台词条编辑/新建态高度自适应 + 列表多行文本框 + rename 丢图真修复（frames.image_path 四层联动补第 4.5 步）+ 审计两修（undo 深度门控/强制宫格初始态）
- v0.9.18：台词开关 FLIP 锚定滚动补偿 + Ctrl++/- 缩放 + 拖拽指示线消失修复 + 右上角主菜单 + 搜索下拉键盘预选
- v0.9.17：台词开关锚定焦点镜头 + 缩放锚定修复 + 拖宽持久化修复 + 首屏台词条 500ms 入场
- v0.9.16：台词条拖拽移动/互换 + 正名幽灵改名处置（__ghost_ 前缀）+ Blender 4.5 删场景 API 变化（batch_remove 签名移除）
- v0.9.14：审计体系重构（audit 12 段段级 --only + web_audit 23 项 + watch_audit 退役）+ 审计轮询化提速（6min→3m42s）
- v0.9.13：添加台词所见即所得 / 关预览父条高度修复 / audit --only 段级筛选 + audit_run.py
- v0.9.9~v0.9.12：宫格台词条系列（同排合并父条/展开态保留/独立宽度/右键菜单自动大小/卡片菜单添加台词）——v0.9.8 台词能力全保留
- v0.9.7：画幅比/分辨率设置（对话框 + 全 scene 应用 + 新镜头跟随 + 前端动态画幅 + 旧图 cover/letterbox）
- v0.9.6：预览框三件套 / 镜头名白名单 / 路径穿越 / body 上限 / delete 非原子回滚 / undo 锁 / DB 连接泄漏 / XSS esc / 拖拽回滚 / 假成功 toast
- v0.9.5：展开态帧图等大+间距/外沿统一（9px 严格）/ 拖拽插入指示线 / 拖拽改 Pointer Events（根治 DnD 光标）
- v0.9.4：预览框（贴边/调宽/详情/提速）/ 快捷键面板 / 多展开底衬修复 / 拍屏 JPG 化 / 展开焦点落第一帧 / 帧格高度统一 / 折叠按钮移位
- v0.9.3：搜索栏定位 / Tab 切视图 / 列表 Ctrl+滚轮 12 级 / 展开折叠滚动跳顶三层修复 / audit 41+12 / AGENTS.md 精简 49%
- v0.9.2 十一轮：多选右键菜单统一 / 方向键帧格级移动 / 列表子帧单焦点 / 批量动画修复 / 切视图定位+中心扩散 FLIP
- v0.9.1 十轮：拍当前帧去确认直盖 / 多选批量展开折叠 / 展开态拖拽 / 面板帧导航 step_frame / 创建对齐网页端规则
- v0.8.4 九轮（用户拍板）：删 RenderShot/RenderAll / 统一 frames 模型 / duplicate 保帧 / API rerender=重拍封面帧 / 菜单「重拍封面」
- v0.8.3 八轮：帧格间距固定 9px / 列表封面角标 / 悬停扫视恢复 restoreCover / 列表折叠态封面帧图
- 第七轮：面板删除必崩修复（走 cmd_delete_shot）/ 删除确认策略（软删不确认 purge 才确认）/ Delete 帧级删帧
- 第六轮：右键菜单三修 / CSS 孤儿块吞规则排查法 / 列表缩放动态上限公式
- 第五轮：帧级实时刷新（frames.ver 双轨版本戳）
- v0.8.0：连片底衬 margin-right:-12px / 展开折叠弹簧动效 / 面板帧号列表+拍当前帧 / __sb 调试句柄
- v0.7.0：多图镜头（frames 数据层 / 4 queue 命令 / 一叠牌折叠态 / 展开态 N 格连片 / 帧级右键菜单 / 红格子 / 双击空格=展开）
- v0.4.0：纯重构（前端 13 ES modules / 后端 ROUTES 表 / 多实例端口顺延 / instances.json / audit 21 项）
- v0.3.0：拖图建镜头 / 相机背景图 alpha=1.0 / 列表视图+FLIP / 批量重命名两阶段 / Ctrl+滚轮缩放 / 键盘 / header sticky
- v0.2.0：网页大改版（删除 type 字段 / 创建弹框 c0010 编号 / 拖图 / 自动拍屏 / 心跳 / 滑块 / 框选批量 / 右键惯性拖动）
- 第四轮~第二轮：骨架屏揭幕 / thumb_ver 门控 / 垃圾桶模式 / 橡皮筋过冲 / 软删+撤销栈 / 方向键跳格 / DOM 差分渲染 / FLIP 双根因 / 焦点框跟手 / 帧格禁拖 / queue falsy 缺参误杀

## 正在做

- **v0.9.39 已推**（时间线三连 + 宫格排不满，2026-08-09）；等用户指示开新需求（需求池待办见下）
- 需求池（Obsidian Mark/2026_07_31 分镜设计系统-开发任务说明.md）待办，等用户逐项指派：时间线台词可拖拽调宽+字幕浮层、时间线多图镜头展开/折叠（状态与宫格分开保存）、时间线 ↑↓/滚轮=横向滚动、宫格台词操作盘点（调研）、缩略图无边框+两侧透视淡出、列表开预览字体大小一致、列表缩放最大极值×2+镜头名行宽减半

## 下一步

- **稳健性待办（v0.6.3 对抗审计产出，用户已阅，优先级低暂缓）**，按性价比排序：
  1. **主线程预算**：`process_queue` 一次排空全队列，批量重渲染 = UI 冻结整场渲染；改每 tick 1 个重命令
  3. **创建原子化**：makedirs 挪到 DB 写入前（SMB 抖动即孤儿记录，P9 实锤）
  4. **写事务合并**：批量操作共用一条 SQLite 连接+事务，顺手修 seq 分配竞态（P4 实锤 16 并发 12 重复）
  5. **DB 备份**：shots.db 启动时轮备 .bak1/2/3（SMB 单点零备份）
  6. **静态文件 Cache-Control: no-cache**：治"部署了但浏览器跑旧 JS"玄学
  7. **sync 自动对账 name/scene/dir 三元组**：孤儿场景从"只报告"升级为自动收敛（c0030 事件）
  8. **.blend 体积治理**：FULL_COPY 复制重场景让 1.4GB 文件持续膨胀
- 单用户信任环境下已明确**不修**：目录穿越读/写、CSRF、输入类型混淆（v0.6.3 审计 P1/P2/P3，纸老虎）

## 开发铁律

所有需求（增/删/改，单条/列表）按以下循环执行：
```
测试确认 → 修改 → 验证测试 → 有问题继续改 → 全通过才交付
```
列表需求：逐项独立循环，全部做完后回归审计每一项。

## 接手前必读（环境/前置条件）

- 运行环境：Blender 4.5（公司PC/家PC）
- 依赖服务：BlenderMCP addon（9876端口，打补丁版 0.0.0.0+绕timer）+ storyboard_designer HTTP 服务（8089端口）
- 前置操作：启动 Blender → N面板 BlenderMCP → Connect to Claude → N面板 Storyboard → Start Server
- 项目目录：从 `bpy.data.filepath` 推导（`{blend_dir}/{blend_name}_storyboard/`）
- 家 PC 崩溃自愈：`blender.exe <file.blend> --python recover.py`（调 start_server 全自动）
- 部署目录：`~/AppData/Roaming/Blender Foundation/Blender/4.5/scripts/addons/storyboard_designer/`；源码 = 本地 git（GitHub shaobaojia/storyboard-designer），cp -rf 源/. 目标/ 部署（尾斜杠被 MSYS 吞会白部署，坑 227）

## 这个项目是干什么的

Blender 4.5 分镜设计插件——面板操作 + 内嵌 HTTP 服务 + SQLite 数据层 + 宫格 H5 页面，实现镜头管理、拍屏出图、宫格浏览/拖拽排序、网页遥控 Blender。

## 交互/设计约定（用户拍板，v0.7.0 设计文档已全部落地）

### 交互约定
| 操作 | 入口 |
|---|---|
| 展开/折叠 | **双击卡片**（统一，不分单图多图）或 **空格键** |
| 打开镜头（Blender） | **右键菜单「打开镜头」** 或 **回车键** |
| 展开态双击某张图 | 跳回该构图（shot_id + frame_no → 切 Scene + 跳帧） |

### DOM/动画约定
- N 张图 DOM 节点**折叠态就渲染**（一叠牌 = N 节点叠放 + transform 错位露边），展开只是位移；底衬常驻
- 动画只用 transform + opacity（FLIP：captureRects → animateFrom，测量用 offsetLeft/offsetTop 不用 getBoundingClientRect——含 transform 会连环污染）
- 展开态新增帧 = 帧级增量 append；折叠态封面变化 = 差分重建 + img 移植
- 预载：3 屏 eager 策略；交互测试：CDP 真实点击 / `__sb` 直接驱动，不用 evaluate 合成事件

### 预览框（v0.9.4）
- 开关/调宽/切边 = 只动 CSS 变量（--preview-w / --list-scale / --card-min via __zoomApply）+ grid margin class，**零 DOM 重建**；已展开镜头存在时 renderGrid 差分一次
- 宫格开预览：列数尽量保持（MIN_W=120 下限）卡片等比缩小；关预览精确还原 --card-min（savedMin）；列表：--list-scale 等比缩
- grid margin = var(--preview-w) + 16px → 两侧间距对称；--preview-w 持久化 localStorage('sb-preview-w')

### 时间线视图（v0.9.36~38）
- 顶部预览区（stage）+ 分隔条（#tlDivider 可拖动 7:3 默认）+ 底部缩略图区；台词轨道在镜头轨道上方
- clip 等比缩放（宽 52~316 档位，高 = (clipW-2)×0.75+22），下沿对齐（clip bottom:0 放大向上长）
- **clip 超高时借 stage 空间**（v0.9.38f）：stage 收缩、分隔条上移、页面不滚动；stage 保底 180px，借到保底仍超高才页面滚动
- 时间线视图下侧边预览框不参与（决策 3A，CSS 隐藏 + 预览按钮锁定高亮）

### 数据层（frames 表，就放 shots.db）
```sql
CREATE TABLE IF NOT EXISTS frames (
    id          TEXT PRIMARY KEY,
    shot_id     TEXT NOT NULL REFERENCES shots(id),
    frame_no    INTEGER NOT NULL,   -- 取景坐标：拍屏时所在的 Blender 帧号。纯技术元数据
    image_path  TEXT,               -- NULL 或文件缺失 → 前端渲染红格子
    is_cover    INTEGER DEFAULT 0,  -- 封面标记，每镜头恰一张为 1
    ver         INTEGER DEFAULT 0,  -- 帧级版本戳（v0.8.4 第五轮起）：重拍才 +1，改 frame_no/is_cover 不 bump
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_frames_shot ON frames(shot_id);
```
- 单图镜头 = frames 长度 1；多图按 frame_no 升序；前端以 `frames.length` 为准
- `shots.thumb_path/thumb_ver` 保留 = 封面帧冗余缓存（折叠态/时间线只读它）；**双轨版本戳**：封面帧重拍 = 帧 ver+1 + thumb_ver+1，非封面帧只 bump 帧 ver
- 新镜头 f0 输出 `f00000_still.jpg/f00000_thumb.jpg`（v0.9.4 起全尺寸 JPG；老镜头 f0 指 thumb.jpg legacy 兜底，存量 still.png 前端 onerror 兜底）
- API rerender action 语义 = 重拍封面帧；前端菜单「重拍封面」/「重拍此帧」/「批量重渲染」

### 软删 / 撤销栈设计（core/undo.py）
- deque(maxlen=20)，entry schema：`{db:[(id,fields)], reorder_ids:[], purge:[{id,name,scene_name}], queue:[(cmd,params)]}`
- 映射：改名/排序/批量重命名/字段修改 = 逆操作反打；新建/复制 = purge 逆操作；删除 = 软删（DB deleted=1 + 场景改名 `__trash__<scene>`）其逆操作=restore；**purge 不可撤销**
- 恢复也进栈；内存栈，Blender 重启即清空
- `__trash__` 前缀场景天然不被 sync 当孤儿；`next_c_number` 用 include_deleted=True，垃圾桶占名不放号
- 删除路径：所有删场景必须走 queue 的 `cmd_delete_shot`（先切走激活场景再 batch_remove + use_global_undo=False），面板 operator 复用，别自己 batch_remove（必崩）

### 性能机制
- DB 版本号 = `COUNT-meta.rev`：任何写入（含排序）都 +1，心跳 0.8s 缓存
- 图片 URL 只带 `?v=thumb_ver`（封面）/帧级 `?v=frame.ver`；`update_shot` 只在显式传 `thumb_fresh=True` 时 bump
- 首屏预载窗口：前 3 屏 eager、更远处 lazy；`reorder_shots` 只改 seq 不碰 updated_at（排序不触发重建/重载）

## WebBridge 测试速查

| 场景 | 方法 |
|------|------|
| 页面加载/状态 | `find_tab` + `navigate`（不带 `newTab`，复用标签页） |
| DOM 验证 | `evaluate` 读 `window.__sb`、查 class/元素、测尺寸 |
| 普通点击 | CDP 真实 mousePressed+Released（`el.click()` 是隔离世界合成事件，不触发页面监听器） |
| 右键菜单 | CDP `mousePressed+Released`（合成事件被 `preventDefault` 拦截） |
| 模块函数 | 挂到 `window.__sb` 上才能调（ES module 不暴露到 window） |
| Edge | 不杀！开着一直复用 |
| 滑块驱动 | 合成 input 事件（range setter + dispatch input，监听器可达主世界）；CDP 拖不动是通道限制非 bug |
| 视图切换 | `__sb.setView('grid'/'list'/'timeline')` 或 localStorage 直写 + reload（刷新直落路径）；切完 wait 渲染 |

## 坑（已踩过的雷）

### 近期（v0.9.35~v0.9.38，详细）
- **v0.9.38：flex item 的百分比高度在 main size indefinite 时解析为 auto → 塌 0**（.tl-inner height:100% 实测 computed 0px）：正解 = absolute inset:0。诊断：computed height 0 + 父是 flex item
- **v0.9.38：flex-shrink 默认 1 会把内容超高场景的相邻 item 压缩**：flex column 里「某 item 撑开」必须显式 flex-shrink:0 + min-height
- **v0.9.38：ESM import 不存在的导出 = 整链白屏，node --check 测不出**：诊断 = 动态 import('/js/main.js').catch(e => e.message) 抓 "does not provide an export named"；**改 JS 后必须 `node --input-type=module --check`**（CommonJS 模式测不出 ESM 错误，v0.9.9 白屏事故同源）
- **v0.9.38：时间线缩放锚定 scrollLeft clamp 物理限制**——焦点 clip 在视口外时锚定需求为负 scrollLeft（clamp 0）；测锚定必须选视口内 clip
- **v0.9.38：档位化漂移**——TL_W_MIN 104→52 后 320/200 不再是精确档位（52+24k：316/196），持久化值刷新时被 apply 档位化写回；测试还原用档位化后的值
- **v0.9.38：grid gap 12（宫格继承）在 timeline 模式同样生效**——stage/divider/timeline 之间各 12px，分割 clamp/高度公式必须计入（gap×2 + divider 开销）
- **v0.9.38：applyTlSplit 只在 renderTimeline 跑**——改持久化后必须重渲染（renderTimeline/reload）再断言，否则 DOM 残留旧值
- **v0.9.38h：clientWidth 返回整数而 auto-fill 用真实小数宽算列数**（940.739→941 误差 0.26px 临界掉一列 + 右侧大空白）：列宽计算必须用 getBoundingClientRect().width + 减 0.05px 余量；排查 = 独立复制容器对照 + 列宽二分
- **v0.9.37：renderGrid 切回宫格必须摘 timeline-mode class**（v0.9.36 只清了元素）：class 残留 → grid 保持 flex column → auto-fill 列网格失效 = 缩放无视觉反应但变量正常（列数读数 2 假象）。凡"模式切换布局 class"必须双向清理
- **v0.9.37：range 滑块门控放行 Ctrl/Meta 组合键**（拖动滑块后焦点留在 range，Ctrl++/- 全被拦）：`if (e.key !== 'Tab' && !(e.ctrlKey || e.metaKey)) return`；方向键仍门控
- **v0.9.37：时间线横轴缩放 apply 必须幂等**（刷新直落污染持久化档位 200→176）：以 localStorage 为唯一事实源（读→档位化→写回→滑块仅显示同步）
- **v0.9.37：缩放测试断言防 clamp 边界**：滑块点击 track 右端直接跳 max 档，后续"放大"断言恒 FAIL 但功能正常；先腾空间或断言前查 slVal==slMax
- **v0.9.36：独立布局视图（flex 覆盖 grid）必须清残留卡片**——timeline 是 flex column，残留 .shot-card 全宽排开（76 张 ≈48000px）把内容推到页面深处。**DOM 断言全过但视觉全毁**（截图才暴露）。切视图双向清理
- **v0.9.36：惰性容器"已建"标志位会被外部清除 DOM 后失真**（stageBuilt/tlBuilt 在 renderGrid remove 后仍 true → 重建被跳过）：正解 = 纯 DOM 存在性判断
- **v0.9.36：复用模块内函数注意其内部绑定的 DOM 引用**（showPreviewImage 写死模块级 img，timeline 复用后大图永不显示——display 状态能过断言，src 才是判据）：加 target 参数
- **v0.9.36：刷新直落持久化视图时 setView 不执行**——依赖视图状态的一次性副作用放 renderXxx 函数内（每次渲染强制），别只放 setView
- **v0.9.35：async 互斥切换未 await = 双 fetchShots 并发竞态**（垃圾桶/其它页：垃圾桶壳+正常镜头内容，此时点彻底删除会 purge 正常镜头，危险）：互斥切换必须串行——退出方加 silent 参数静默退，只让目标视图发一个请求
- **v0.9.35：mousedown 里 blur 按钮焦点会被浏览器默认聚焦抢回**：须在 click 后 blur，且用 e.detail 区分输入来源（鼠标 detail≥1 / 键盘 detail=0 保留焦点）
- **v0.9.35：合成 KeyboardEvent 不触发 :focus-visible 启发式**——验证焦点框必须 CDP Input.dispatchKeyEvent（真实输入管线）
- **v0.9.35：空态提示 absolute 定位随容器高度塌缩消失**：正解 = 容器转 flex（#grid.grid-empty display:flex + min-height）

### 操作型（仍然适用，精简）
- **Git 推 GitHub：直接走代理不试直连**（2026-08-09 用户拍板）：`git -c http.proxy=socks5h://127.0.0.1:7897 push origin main`；MSYS git 不支持 SOCKS5 认证交互，必须 `git remote set-url "https://TOKEN@github.com/..."` 内嵌 token，推完还原 + 验证本地=远程 HEAD
- **Windows 双 Blender 实例端口劫持**（SO_REUSEADDR 允许双绑 8089/9876，连接随机分流 = 间歇性假死）：排查先 `netstat -ano | findstr :8089` 看多个 PID；MCP 9876 双绑时以最新绑定 PID 为准；BlenderMCP 端口正常启动 9876（recover.py 才 9877），被 Clash 内核抢占时才需改
- **删场景必须走 queue 的 cmd_delete_shot**（先切走激活场景再 batch_remove + use_global_undo=False）：直接 `bpy.data.scenes.remove(s)` 或面板自己 batch_remove 必崩（Blender 4.5 弹窗）；MCP 直调也崩
- **重场景删除 = 整文件撤销快照卡死**：use_global_undo=False + batch_remove 瞬删；手动 MCP 清场景必须同款
- **Blender 4.5 删场景 API 变化**（v0.9.16）：`batch_remove(ids=...)`/`scenes.remove(sc, use_global_undo=False)` 签名已变会 TypeError；无参数 remove 触发 1.2GB 撤销快照卡死崩溃。**处置 = 场景改名 `__ghost_` 前缀**（轻量秒完成）+ **改完存盘**（timer 包装 save_mainfile，防重启复活）
- **API 删场景只删运行时，磁盘文件会复活幽灵**：.blend 没存盘重启后场景原样回来 + sync-on-load 重建 DB 记录；审计清理后必须存一次盘。重启后镜头数莫名变多先怀疑这个
- **MCP 线程无 window context / 写 bpy.data 不稳定**：render/opengl/写场景必须主线程 timer 队列（`bpy.app.timers.register` 包一层）或 `queue_command(...)`；audit 测 operator 创建类一律 timer 包装
- **MCP execute_code 中文路径极易转义错**：一律用 `bpy.data.filepath` 推导 project_dir；MCP 传复杂代码用文件方式 `exec(open(path, encoding='utf-8').read())`
- **MCP 偶发卡死/queue 积压假死**：连续大命令卡 handler（分步小命令恢复）；audit 中断留 queue 积压 → timer 假死 → 重跑 duplicate 类崩（QSIZE 恒定 5s 不动实锤，taskkill 重启）；查 queue 用 `q._command_queue.qsize()`
- **rename 必须四层一起走**：DB name、场景名、相机名、磁盘目录 + DB 里 still_path/thumb_path 绝对路径；**改名会断相机背景图**（bg.image 绝对路径要重指+reload）；**frames.image_path 不随目录改名 = 丢图红格子**（检查存在性查新路径）
- **批量改名必须两阶段**（目标名被占用冲突防御会抛错静默失败）：先全改 `__ren_<id>` 临时名再统一落正式名
- **SMB 盘（N:）mtime 不可靠**（粗粒度+缓存）：版本号要查内容（COUNT+MAX(updated_at)）
- **热重载僵尸线程**：`del sys.modules` 重载后旧 HTTP server 线程杀不掉，新旧 handler 随机抢请求（代码改了没走新路径）；threading.enumerate() 查 serve_forever >1，重启 Blender
- **`importlib.reload` 热修补 queue 层免重启**（纯逻辑模块可用，带线程的 server.py 别玩）
- **`bpy.ops.render.opengl`/`view3d.view_camera()` 只读真实视口状态**：temp_override 无效；直接改 `space.region_3d.view_perspective`；`region_3d.camera` 在 Blender 4.5 不存在
- **面板不自动重绘**（改 DB 后必须 redraw_view3d + 缓存失效，core/queue.py 统一调）
- **cmd_delete_frame 删帧残留 fNNNNN_still.jpg**（JPG 化后旧替换逻辑永不删）：三候选全删（thumb.jpg + still.jpg + still.png）
- **init_db 迁移只在 server 启动/init_project 跑**；纯 Python 验证直接调 init_db；测试建表用 conn.executescript(DB_SCHEMA)（shots 有 seq NOT NULL）
- **大重构（删 operator/改注册表/加迁移）必须重启 Blender 验证**（热修补覆盖不了启动时机代码）；重启是 Agent 的活
- **多实例端口**：socketserver 独占绑定 + 启动顺延扫端口（8089→8090→…）；HTTPServer 必须 ThreadingHTTPServer（keep-alive 心跳独占单线程）

### 测试方法论（WebBridge/audit，精简合并）
- **后台/隐藏标签页**：setTimeout 限流分钟级、rAF 完全不跑、心跳 fetch 暂停（请求挂起是浏览器行为非服务 bug）；测试前 Page.bringToFront 解冻，rAF 类只能前台实测
- **evaluate 隔离世界**：与页面共享 DOM 不共享 JS 状态；合成 DataTransfer/File 走真实链路时 FileReader 永不回调；`el.click()` 不触发页面监听器（CDP 真实点击）；document 上 dispatchEvent 的 e.target 无 closest（TypeError 静默暴毙）——dispatch 在 body/具体元素
- **webbridge tabId 会因页面重建失效**（旧 tabId 读僵尸快照，dispatchEvent 无效不报错）：排查先 list_tabs 拿当前 tabId；evaluate 读 __sb 但事件不触发 = tabId 已死/跨世界
- **CDP 高频 mouseMoved 只送达第一次 / mouseReleased 触发 pointercancel(0,0)**：拖拽类交互用合成 PointerEvent（监听器不校验 isTrusted）或只验单次事件；监听 pointerup 必须容错 pointercancel（用最后 move 坐标）
- **CDP 无法产生 dblclick / 修饰键不可靠 / 无法驱动 range 拖动**：展开折叠 = 单击+空格；多选 = Ctrl+A 或 Shift+方向键；滑块 = 合成 input 事件
- **WebBridge daemon 长跑丢事件**（11h+ 后 mouseMoved 丢失/evaluate 空响应/截图超时）：先查 /status，`kimi-webbridge.exe restart`（Edge 不杀）
- **验证鼠标事件用 DOM 副作用判据**（跨世界计数器为 0 不代表没发生）：读 img.src/dataset 变化
- **ev() 对 undefined 返回值会重试**（void 函数被反复调用污染探针）：驱动 void 函数用一次性 evaluate，读状态用 ev()
- **webbridge navigate 相同 URL 不重载**：强制 `cdp Network.clearBrowserCache` + `cdp Page.reload {ignoreCache:true}` + DOM 标记确认
- **测试动 localStorage 前必须备份、还原精确写回**（用户数据！sb-view/sb-tl-w/sb-tl-split/sb-cols 等）；异步 POST + 心跳 0.8s，断言等 2.5s+；测试脚本收尾不彻底会污染现场（开头重置 expandedShotIds/selectedIds/focusedFrameId）
- **空库跑 web_audit 必 4 FAIL**（无镜头可测）：先跑 make_std_shots.py（STD_ 前缀 10 镜头），造完别重启
- **audit.py 与 audit_context_menu.py 禁并行**（共享 DB 互清）；audit 中断留残留先清；--only 的 taken 快照必须在段执行前取（防 cleanup 误删用户镜头）
- **多图封面测试前先确认封面基准**（data-frame-id，用户可随时改封面）
- **PIL 单点采样小字号文本会采到子像素 AA 条纹**（红/青/蓝三色偏，别当渲染 bug）：crop 区域 Counter 统计主色；**PIL 验证色值先读 computed 再采样，同轮读取**（主题状态可能切换）

### 历史（v0.9.30~v0.9.34 及更早，核心结论）
- **v0.9.34 台词条手柄 data-tip::after 同特异性合并三坑**：left:50% 废 right / bottom:calc(100%+8px) / padding+border 撑大盒子——显式四属性全清；伪元素几何验证用 outline 注入法
- **v0.9.33 折叠态多图焦点框被叠图盖住**：selected 卡片 border 低于子元素 z——正解 = 卡片上重画独立覆盖环（::after inset:-2px z-999 :has(> .frame-stack) 只命中多图折叠态）。**凡"卡片外框被内部叠层盖住"的焦点指示，正解 = 独立覆盖环，别指望元素自身 border**
- **v0.9.33 多图层牌右缘伸出卡片**（translate 7px > border 2px）：水平错位统一 2px（垂直 7/5/3 保留）；验证用 getBoundingClientRect 比较 max(层牌 right) vs 卡片 right
- **v0.9.32 列表折叠态焦点框选择器漏 .shot-thumb / 折叠回丢框**（复用分支不同步）：改语义必须同步 focusFrame 加框/清框选择器、新建/复用分支、CSS 五处
- **v0.9.31 img 是替换元素**：inset box-shadow 在内容之下不可见、::after 不渲染、outline 穿透 z-index——**画"盖在图上"的框唯一边际最低 = border + box-sizing:border-box**
- **v0.9.31 差分渲染复用分支不重建 DOM**：新增 class 语义必须同步进复用分支（只改新建路径会在"初始渲染后状态变化 + renderGrid"静默失效）
- **v0.9.30 CSS 绘制顺序**：outline 是最后统一绘制阶段穿透一切 z-index；外扩 box-shadow 同理——指示层要么 inset 要么接受被盖
- **v0.9.30 overflow:hidden 裁负偏移子元素 / flex 文本 ink 顶比行框高 1px**（对齐类需求 padding 补偿 1px）
- **v0.9.28 Blender 面板**：register() 内写 `import bpy.utils.previews` 静默搞挂注册（bpy 变局部变量 UnboundLocalError）——用 `from bpy.utils import previews as _previews`；UILayout.separator(factor) 子面板不生效（用 column(align=True)）；Blender 按钮图标永远在文本左边
- **v0.9.27 批量行号替换脚本偏移会算错**：用锚点行动态反推，别手算；"同值不同义"的颜色行级映射拆分；CSS rgba(var(...)) 正则嵌套 var 假 miss
- **v0.9.26 icons.js 键名含连字符必须加引号**（ESM 裸键 SyntaxError）；`[data-tip]{position:relative}` 覆盖同特异性 absolute 元素（选择器提特异性）；SVG 图标 1em 跟随 font-size；内联 svg 作 flex item 被 shrink（flex:none）
- **v0.9.25 ESM 函数体引用未 import 符号 = 模块加载不报错，点击才 ReferenceError**（node --check 测不出）：加跨模块调用后 grep 确认 import 行
- **v0.9.24 FLIP 中间态横向溢出 → 水平滚动条闪现 → fixed 底部工具条抖**（body.no-hscroll overflow-x:hidden）；锁定长宽比必须勾选时记录（实时算比例自锁）；菜单文案改必须同步 web_audit expect 列表；按钮 title → data-tip（原生 title 冷启动 1s）
- **v0.9.22 Delete 帧级删除选择器漏列表 class**（误删整镜头）："帧级 vs 镜头级"判定宫格/列表 class 都覆盖；CSS grid 模板必须放实际子元素（几何测量才暴露）；按钮高亮 class = active-view（.size-slider 内 967 行 / 通用 973 行）
- **v0.9.20 PyWebView**：pythonnet 控件属性赋值死锁（假死 + 拖死 Blender 最小化）——纯 ctypes + on_started sleep 1s；WebView2 CDP 限制（drag 无效/403 需 remote-allow-origins/键盘可达）；cairosvg 破坏 rlPyCairo（用 svglib+reportlab）
- **v0.9.19 audit undo 排空误伤审计前操作**（深度门控）；web_audit 假设初始 grid 脆弱（强制初始态）
- **v0.9.13~14 台词条/父条**：关预览 savedMin 路径绕过 zoom 漏 relocateDialogue（父条高度残留）；添加台词 inline top 残留（立即建正式父条）；台词条父条 auto-placement 自锁（updateDialogue 开头先归位）；同排多 box 必须 absolute+relative；测试/还原台词数据别写死值（备份精确原值）
- **v0.9.3 滚动跳顶三层修复**：renderGrid 禁 innerHTML=''（同步 clamp scrollY）/ overflow-anchor:none / savedScrollY 保存恢复；scrollIntoView 先改状态后调用；frame-focused class 手动管理（focusFrame(shotId,null) 清）；键盘全局快捷键跳输入框门控
- **v0.9.2~v0.9.4 FLIP/差分系列**：FLIP 测量用 offset 系（getBoundingClientRect 含 transform 连环污染）；起点必须真实渲染一帧再清（rAF 包）；批量动画目标按 id 精确选；grid.className 整体重设会冲掉其它模块 class（classList 增量维护）；main.js 挂 __sb 新函数必须同步 import（漏了整页崩）
- **v0.9.8~v0.9.12 台词/预览**：多条 strip 共享宽度值 mouseup 别 querySelector 第一条（闭包引用被拖 box）；台词框左偏移用 rect 坐标差；预览框无缝公式 = grid margin = var(--preview-w)（+16 对称），贴左看 panelRight-gridLeft
- **v0.9.6~v0.9.7**：Blender 拉起 blend 路径必须原生路径（MSYS $HOME 解析错）；预览图同尺寸（100%×100% + contain，max-w/h 会跳变）；展开帧格高度统一；画幅比功能"基准比例"假设（混合比例镜头集是近似适配）；宫格单图 .shot-thumb 不在 .thumb-wrap 里（选择器要 .shot-card:not(.list-item):not(.frame-cell) > .shot-thumb）

## 细节指针

- 架构：Blender 插件 + 内嵌 HTTP（0.0.0.0:8089）+ `bpy.app.timers` 主线程队列
- 后端模块地图：`core/server.py`（ROUTES 表 + 静态服务）→ `core/actions.py`（每端点一函数）→ `core/queue.py`（COMMANDS 注册表 + 错误回传 + redraw_view3d）/ `core/db.py`（含 next_c_name/next_c_number）/ `core/undo.py`（撤销栈）/ `core/paths.py` / `core/scenes.py`（场景工厂）/ `core/sync.py`（同步唯一实现）/ `core/render.py`（拍屏公共函数）
- 前端模块地图（20 个 JS）：`web/index.html`（骨架+CSS）+ `web/js/`：state（共享状态）/ ui（toast+确认条）/ render（宫格+列表+FLIP+DOM差分+首屏门控）/ data（拉取+心跳+错误toast+undoLast）/ selection / dnd（卡片拖拽+拖图分区）/ rename（改名+字段就地编辑）/ menu（右键/中键滑动+回弹+菜单）/ create（弹框）/ marquee（框选）/ zoom（滑块+Ctrl滚轮连续缩放）/ keyboard（快捷键+方向键）/ trash（垃圾桶弹窗）/ search（搜索栏定位）/ preview（预览框）/ shortcuts（快捷键面板）/ aspect（画幅比）/ icons（图标表+注入）/ timeline（时间线视图）/ main（入口接线）
- 改名：`cmd_rename_shot`（queue.py）四层联动实现
- 测试：改完跑 `python3 scripts/audit.py`（42 项）+ `python3 scripts/audit_context_menu.py`（12 项）+ 网页 JS 改动 webbridge 全交互回归（web_audit 23 项）
- 基线（2026-08-09）：audit 42 + ctx 12 + web_audit 23
