# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**

## 刚做完（v0.9.37：时间线去时间轴改版 + 快捷键全盘落地 + 宫格缩放两修复，2026-08-09 已部署实测，跳过全量回归用户拍板直接推）

- **时间线去时间轴改版**（用户三轮拍板确认）：时间标尺去掉（.tl-ruler/.tl-tick 规则+生成逻辑全删）；clip 等宽不再∝时长（初始 200px，顺序均布 gap 12，left = 16 + idx×(clipW+12)）；缩略图统一 4:3（104×78 居中 cover，clip 高 100 固定）；缩放只缩放横轴（clip 宽档位 104~320 步进 24 共 10 档，滑块/Ctrl滚轮/Ctrl++-/±按钮全入口生效，纵向纹丝不动）；台词块与 clip 同宽同位对齐；顶部预览区时间区间显示改"第 N 镜"；sb-tl-w localStorage 持久化
- **时间线快捷键全盘落地**（用户拍板"先全盘挪过来再逐项调整"）：方向键放开——arrowMove timeline 分支 = 线性序列（←→ 移动选中/Shift 扩展选区/↑↓ 无操作/不设帧焦点防 focusedFrameId 残留污染宫格蓝框）；空格保持禁用（时间线无展开语义 + 放开会 toggleExpand 污染 expandedShotIds 触发无意义整树重渲染）；Tab 两态/V 内部 return/Ctrl++- 走 zoom 分流/Esc 语义全维持；SHORTCUTS 面板方向键描述同步
- **宫格缩放两修复**：①v0.9.32 range 滑块门控过宽——焦点在滑块时 Ctrl++/- 被拦（用户拖完滑块按快捷键无反应），改放行 Ctrl/Meta 组合键（方向键仍门控保原生调值、Tab 仍放行）②renderGrid 切回宫格不摘 timeline-mode class（v0.9.36 只清 stage/timeline 元素）→ grid 保持 flex column（.timeline-mode { display:flex; height 固定; overflow:hidden }）→ auto-fill 列网格失效 = 缩放无视觉反应（列数读数 2 假象、变量正常）
- **时间线横轴缩放 apply 幂等修复**：刷新直落 timeline 时 initZoom 的 apply() 读未同步滑块值污染持久化档位（实测 200→176）；改以 sb-tl-w 持久化为唯一事实源（档位化后写回），滑块只做显示同步，stepZoom/input 入口先写持久化再 apply
- 验证：时间线快捷键 19/19（CDP 真实键盘）+ 宫格缩放四入口 + timeline-mode 往返修复 12/12 + 改版 22/22（标尺消失/clip 等宽/thumb 4:3/横轴缩放全入口/clamp/持久化刷新直落/台词对齐/stage 序号/切回宫格回归）+ 滑块聚焦修复 5/5；测试残留全清
- 版本号 0.9.36 → 0.9.37（bl_info + index.html 关于徽章硬编码两处，跳过全量回归用户拍板直接推）

## 刚做完（v0.9.35：Blender 面板 UX 四连 + web 八项，2026-08-09 已部署实测，推前全量回归干净文件跑）

- **Blender 面板帧按钮当前帧高亮**：`jump_frame` 按钮加 `depress=(frame_no == scene.frame_current)`——当前帧号对上呈按下高亮；视觉验证（PIL 蓝底按钮）+ 联动验证（切帧后高亮消失）
- **Blender 面板按钮布局**：创建|复制 并排（高频相邻）、删除独立一行防误触、删除与拍/删当前帧之间 body.separator() 分隔（Blender 无横线 API，separator 即标准做法）
- **复制镜头后自动切场景**：queue 异步执行，duplicate_shot.execute 注册 0.2s 轮询 timer 等 `Shot_<新编号>` 场景出现后 window.scene 切换（同步切不到——queue 在独立线程）
- **Blender 关于面板文案升级**（用户"再装逼再上档次"）：产品定位 + slogan「一镜一世界，帧帧皆故事」+ 功能诗化 + 署名
- **垃圾桶/其它页互斥切换竞态修复**（用户报告"其它视图点垃圾桶没切过去"）：trashBtn click 里 `exitOtherMode()` 未 await + `enterTrashMode()` 未 await → 两个 fetchShots(true) 并发，/api/shots 响应后到覆盖 trash 数据 = **垃圾桶壳+正常镜头内容，此时点彻底删除会 purge 正常镜头**（危险）；修 = exitOtherMode/exitTrashMode 加 silent 参数（互斥切换静默退出不拉数据，目标视图单一请求），main.js 反向互斥监听器同修（坑 260）
- **其它页 Delete 快捷键**（用户需求）：原 `!state.otherMode` 门控全拦；修 = 分支内特判，复用右键「删除场景」语义（askConfirm 确认 + postOtherScene 硬删，不可恢复），单选/多选都支持；正常视图帧级/镜头级删除逻辑一行未动
- **垃圾桶红点角标浮层化**（用户方案，拍板右上角挂角）：#trashCount 流内 span → absolute top/right -6px 挂按钮右上角（.bar-btn 已有 position:relative，零新增定位上下文；pointer-events:none 点击穿透）；JS 零改动，图标不再被挤压（PIL 验证红点 bbox 与 DOM rect 吻合）
- **主菜单重构**（用户需求）：去掉「主菜单」「皮肤」纯文本标题项；皮肤 → hover 二级子菜单（深色✓/浅色，勾选跟随，向左展开 right:100% 防视口溢出，子菜单是 .menu-item 子元素 hover 链不中断）；顺序皮肤在前关于在后
- **T 快捷键开关台词**（用户需求）：台词开关逻辑从按钮 click 内联抽成 render.js `toggleDialogue()` 导出（按钮+T 共用，锚定动画/localStorage/按钮高亮同步全保留）；SHORTCUTS 面板加「T 开关台词显示」；dialogueBtn data-tip 加（T）
- **空态提示整页居中**（用户需求）：垃圾桶/其它/正常空态 .empty-state 从"挤在第一格"改 flex 双轴居中——`#grid.grid-empty { display:flex; align-items:center; justify-content:center; min-height: calc(100vh - var(--header-h) - 90px) }`（absolute 方案会随容器高度塌缩，坑 263）；三模式实测偏差 hz≤5px/vt≤2px
- **按钮点击残留焦点修复**（用户报告"按 T 键出现焦点框"）：根因 = 鼠标点击焦点残留 + 键盘输入触发 :focus-visible 启发式给按钮套默认 outline（CDP 复现 focusVisible false→true）；修 = 全局 click 里鼠标点击（e.detail≥1）的按钮立即 blur，键盘 Enter/Space（detail=0）焦点保留（无障碍不破坏）；mousedown blur 会被浏览器默认聚焦抢回，须 click 后（坑 261/262）
- 版本号 0.9.34 → 0.9.35（bl_info；关于徽章动态取 bl_info.version 无需单独改）

## 刚做完（v0.9.34：台词条手柄图标 + 拖拽缩放 + 预览画幅标准 + 面板实时刷新，2026-08-09 已部署实测，跳过全量回归用户拍板直接推）

- **台词条拖宽手柄视觉系列**（用户连轮指定）：默认 2px 竖线 → 用户 SVG 图标（星形 #707070 → 双右箭头 » #bfbfbf），14px→28px→19.6px（70%）；默认 opacity 0、台词条 hover 显示（opacity 1，0.15s 过渡）；中心锚定公式 `right = containing block 右缘偏移 - N/2`；光标去 col-resize 全程默认（同 v0.9.5 约定）。坑：[data-tip]::after 同特异性合并三坑（left/bottom/padding/border 显式清，坑 249）
- **拖拽中卡片 scale(0.7)**（dnd.js 一行：transform 加 scale(0.7)，释放自动清）
- **预览窗口画幅标准（用户拍板：只能裁上下不能裁左右）**：原 .preview-body img 100%×100% 填满竖的预览区域 → cover 裁左右（21:9 预设左右各裁 336px 实测）；修 = 预览 img 容器 aspect-ratio 跟随画幅（max-w/max-h 100% + auto，区域内最大居中），与缩略图同构；19 预设全测：容器比例=画幅、cover 只裁上下、永不裁左右（坑 256/257）
- **Blender 面板实时刷新（帧按钮 hover 才刷新事故）**：根因 = 改 DB 的 operator 无 tag_redraw + 面板读缓存（1s TTL）未失效；修 = core/queue.py 新增 redraw_view3d()（失效 panel_db_cache + 遍历 VIEW_3D tag_redraw，缓存对象移 queue.py 跨模块共享）+ 4 个同步 operator（拍帧/删帧/创建/删除镜头）尾部调用 + process_queue 成功路径统一调（覆盖 web 命令）；MCP 验证：拍帧后 cache key/ts 变化（无鼠标环境重绘只能来自 tag_redraw）（坑 258）
- **cmd_delete_frame 删帧残留 fNNNNN_still.jpg**：删文件还按旧格式 replace _still.png（v0.9.4 JPG 化后永不删）；修 = 三候选全删（thumb.jpg + still.jpg + still.png 兼容）；验证删帧后目录 fNNNNN_* 全空（坑 259）
- 版本号 0.9.33 → 0.9.34（bl_info + 关于徽章）

**历史轮次**（详情曾在本文件，已压缩；关键决策见「交互/设计约定」与「坑」）：
- v0.9.36：时间线视图首版（顶部预览+横向时间线 100px/s+5s 标尺+台词轨道+字幕浮层；clip 复用 .shot-card 选中/右键/改名/Delete；垃圾桶其它页互斥自动退；修 4 bug：预览不跟随/写死 img/直落滑块未禁用/残留卡片推飞 48000px；验证 25/25+6/6+8/8+8 区域；v0.9.37 已按用户拍板去时间轴改版）
- v0.9.33：折叠态多图焦点框语义定稿（封面蓝框→只外框→外框盖叠图：`.shot-card:has(> .frame-stack).selected::after` inset:-2px 重画 2px accent 环 z-999）+ 多图层牌右缘伸出修复（水平错位收进 2px=border 厚，垂直露边保留）
- v0.9.32：缩放滑块三修（marquee 排除列表补 .zoom-bar / keyboard 门控拆 range / Tab 后 blur 修焦点框常驻）+ 单图封面直角伸出卡片圆角修复 + 多图焦点框两 bug（列表折叠态点击无框/折叠回丢框）+ 列表拖动卡顿调查结论（连续像素缩放贴 16.6ms 预算非 bug）
- v0.9.29~v0.9.31：角标包角大三角（用户 SVG 直角三角+CSS 圆角）+ 全站防文本选中（user-select none + marquee preventDefault 修框选蓝块）+ Blender 初始化门控（未初始化不建目录/DB/服务）+ 面板删当前帧/复制镜头 + 角标四条标准（展开/折叠完全一致、宽=卡宽15%、数字左上角=圆角轴心）+ 焦点框修复两连（inset box-shadow 绘制在 img 替换内容之下不可见 → border 方案；折叠态多图点击焦点落封面帧，选择器放宽 + 折叠保留焦点）

- v0.9.20：PyWebView 双端桌面窗口外壳（_runtime 54MB 自包含/单实例 PID 锁/watchdog 盯 Blender/深色标题栏/悬浮化 owner/WebView2 CDP 测试体系）
- v0.9.19：台词条编辑/新建态高度自适应 + 列表多行文本框 + rename 丢图真修复（frames.image_path 四层联动补第 4.5 步）+ 审计两修（undo 深度门控/强制宫格初始态）
- v0.9.18：台词开关 FLIP 锚定滚动补偿 + Ctrl++/- 缩放 + 拖拽指示线消失修复（nearestCard 几何兜底）+ 右上角主菜单 + 标题栏垂直对齐 + 搜索下拉键盘预选
- v0.9.17：台词开关锚定焦点镜头 + 缩放锚定修复（restoreAnchor 挪到最终布局后）+ 拖宽持久化修复（上限对齐 capW）+ 首屏台词条 500ms 入场
- v0.9.16：台词条拖拽移动/互换 + 正名幽灵改名处置（__ghost_ 前缀）+ Blender 4.5 删场景 API 变化（batch_remove 签名移除，场景改名替代）
- v0.9.14：审计体系重构（audit 12 段段级 --only 筛选 + web_audit 前端 23 项 + watch_audit watchdog 已退役）+ 审计轮询化提速（6min→3m42s）
- v0.9.13：添加台词所见即所得 / 关预览父条高度修复 / 审计 --only 段级筛选 + 降噪包装器（audit_run.py）
- v0.9.9~0.9.12：宫格台词条系列（同排合并父条/展开态保留/每条独立宽度/右键菜单自动大小/卡片菜单添加台词）——v0.9.8 的台词能力（全局开关、双击就地编辑、隐藏规则、marquee 排除、cardKey 'D'）在重构中全部保留
- v0.9.7：画幅比/分辨率设置（对话框 + 全 scene 应用 + 新镜头跟随 + 前端动态画幅 + 旧图 cover/letterbox 适配）
- v0.9.6：预览框三件套 / 镜头名白名单 / 路径穿越 / body 上限 / delete 非原子回滚 / undo 锁 / DB 连接泄漏 / XSS esc / 拖拽回滚 / 假成功 toast
- v0.9.5：展开态帧图等大+间距/外沿统一（每行独立 W 公式/9px 严格）/ 拖拽插入指示线（宫格竖线/列表横线/半区判定）/ 拖拽改 Pointer Events（根治 DnD 光标问题）/ audit_context_menu JPG 化断言
- v0.9.4：预览框（贴边/调宽/详情/提速）/ 快捷键面板 / 多展开底衬修复 / 拍屏 JPG 化 / 展开焦点落第一帧 / 帧格高度统一 / 折叠按钮移位
- v0.9.3：搜索栏定位（名称/内容/台词）/ Tab 切视图 / 列表 Ctrl+滚轮 12 级 / 展开折叠滚动跳顶三层修复（删 innerHTML 全清 + overflow-anchor:none + savedScrollY 恢复）/ empty-state 残留 / 搜索定位帧焦点残留 / audit 41+12 / AGENTS.md 精简 49%
- v0.9.2 十一轮：多选右键菜单统一 / 方向键帧格级移动 / 列表子帧单焦点 / 批量动画修复（按 id 精确选 target）/ 切视图定位+中心扩散 FLIP
- v0.9.1 十轮：拍当前帧去确认直盖 / 多选批量展开折叠 / 展开态拖拽 / 面板帧导航 step_frame / 创建对齐网页端规则
- v0.8.4 九轮（用户拍板）：删 RenderShot/RenderAll（大工程必崩随删解决）/ 统一 frames 模型（单图=1帧）/ duplicate 保帧 / API rerender=重拍封面帧 / 菜单「重拍封面」
- v0.8.3 八轮：帧格间距固定 9px / 列表封面角标 / 悬停扫视恢复 restoreCover / 列表折叠态显示封面帧图
- 第七轮：面板删除必崩修复（走 cmd_delete_shot）/ 删除确认策略（软删不确认，purge 才确认）/ Delete 帧级删帧
- 第六轮：右键菜单三修（折叠态帧级误弹/「展开」项/列表 frame-thumb 帧级）/ CSS 孤儿块吞规则排查法 / 列表缩放动态上限公式
- 第五轮：帧级实时刷新（frames.ver 双轨版本戳，封面=帧ver+thumb_ver，非封面只帧ver）
- v0.8.0：连片底衬 margin-right:-12px / 展开折叠弹簧动效 / 面板帧号列表+拍当前帧 / __sb 调试句柄

## 正在做

- 无（v0.9.36 已部署实测，跳过全量回归用户拍板直接推——推完待用户指示开新需求）- v0.7.0：多图镜头（frames 数据层 / 4 queue 命令 / 一叠牌折叠态 / 展开态 N 格连片 / 帧级右键菜单 / 红格子 / 双击空格=展开）
- v0.4.0：纯重构（前端 13 ES modules / 后端 ROUTES 表 / 多实例端口顺延 / instances.json / audit 21 项）
- v0.3.0：拖图建镜头 / 相机背景图 alpha=1.0 / 列表视图+FLIP / 批量重命名两阶段 / Ctrl+滚轮缩放 / 键盘 / header sticky
- v0.2.0：网页大改版（删除 type 字段 / 创建弹框 c0010 编号 / 拖图 / 自动拍屏 / 心跳 / 滑块 / 框选批量 / 右键惯性拖动）
- 第四轮~第二轮：骨架屏揭幕 / thumb_ver 门控 / 垃圾桶模式 / 橡皮筋过冲 / 软删+撤销栈（见「撤销栈设计」）/ 方向键跳格 / DOM 差分渲染 / FLIP 双根因（offset 系测量+复合键）/ 焦点框跟手 / 帧格禁拖 / queue falsy 缺参误杀


## 下一步

- **稳健性待办（v0.6.3 对抗审计产出，用户已阅，优先级低暂缓）**，按性价比排序：
  1. **主线程预算**：`process_queue` 一次排空全队列，批量重渲染 = UI 冻结整场渲染；改每 tick 1 个重命令
  3. **创建原子化**：makedirs 挪到 DB 写入前（SMB 抖动即孤儿记录，P9 实锤）
  4. **写事务合并**：批量操作共用一条 SQLite 连接+事务，顺手修 seq 分配竞态（P4 实锤 16 并发 12 重复）
  5. **DB 备份**：shots.db 启动时轮备 .bak1/2/3（SMB 单点零备份）
  6. **静态文件 Cache-Control: no-cache**：治"部署了但浏览器跑旧 JS"玄学
  7. **sync 自动对账 name/scene/dir 三元组**：孤儿场景从"只报告"升级为自动收敛（c0030 事件）
  8. **.blend 体积治理**：FULL_COPY 复制重场景让 1.4GB 文件持续膨胀，镜头场景轻量化或定期瘦身
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
- 家 PC 崩溃自愈：`blender.exe <file.blend> --python recover.py`，脚本里调 `bpy.ops.blendermcp.start_server()` + `bpy.ops.storyboard.start_server()`，全自动免点按钮

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
- N 张图 DOM 节点**折叠态就渲染**（一叠牌 = N 节点叠放 + transform 错位露边），展开只是位移，不增删节点；底衬常驻，折叠态 opacity:0 脱离布局
- 动画只用 transform + opacity（FLIP：`captureRects → animateFrom`，测量用 offsetLeft/offsetTop 不用 getBoundingClientRect）
- 展开态新增帧 = 帧级增量 append（卡片不动）；折叠态封面变化 = 差分重建 + img 移植
- 预载：3 屏 eager 策略，多图镜头全部帧算进预载量
- 交互测试：CDP 真实点击 / `__sb` 直接驱动，不用 evaluate 合成事件（不触发监听器）

### 预览框（v0.9.4）
- 开关/调宽/切边 = 只动 CSS 变量（--preview-w / --list-scale / --card-min via __zoomApply）+ grid margin class，**零 DOM 重建**（丝滑原理）；已展开镜头存在时 renderGrid 差分一次重算底衬分段
- 宫格开预览：列数尽量保持（MIN_W=120 下限）卡片等比缩小；关预览精确还原 --card-min（savedMin）；列表：--list-scale 等比缩（固定列 + 缩略图宽度都乘 scale）
- grid margin = var(--preview-w) + 16px → 两侧间距对称；--preview-w 持久化 localStorage('sb-preview-w')

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
- 新镜头 f0 输出 `f00000_still.jpg/f00000_thumb.jpg`（v0.9.4 起全尺寸改 JPG，不再拍 PNG；老镜头迁移后 f0 指 thumb.jpg（legacy 兜底），存量 still.png 前端 onerror 兜底）
- API rerender action 语义 = 重拍封面帧（`_cover_frame_no` → cmd_render_frame）；前端菜单「重拍封面」/「重拍此帧」/「批量重渲染」

### 软删 / 撤销栈设计（core/undo.py）
- deque(maxlen=20)，entry schema：`{db:[(id,fields)], reorder_ids:[], purge:[{id,name,scene_name}], queue:[(cmd,params)]}`
- 映射：改名/排序/批量重命名/字段修改 = 逆操作反打；新建/复制 = purge 逆操作；删除 = 软删（DB deleted=1 + 场景改名 `__trash__<scene>`）其逆操作=restore；**purge（垃圾桶彻底删除）不可撤销**
- 恢复也进栈（逆操作=再删一次）；内存栈，Blender 重启即清空
- `__trash__` 前缀场景天然不被 sync 当孤儿（不以 Shot_ 开头）；`next_c_number` 用 include_deleted=True，垃圾桶占名不放号
- 删除路径：所有删场景必须走 queue 的 `cmd_delete_shot`（先切走激活场景再 batch_remove + use_global_undo=False），面板 operator 复用，别自己 batch_remove（必崩）

### 性能机制
- DB 版本号 = `COUNT-meta.rev`：meta 表单行整数，任何写入（含排序）都 +1，心跳 0.8s 缓存，200 镜头无压力
- 图片 URL 只带 `?v=thumb_ver`（封面）/帧级 `?v=frame.ver`；`update_shot` 只在显式传 `thumb_fresh=True` 且 thumb_path 非空时 bump（改名带 thumb_path 不 bump）
- 首屏预载窗口：前 3 屏 eager、更远处 lazy；揭幕只等首屏
- `reorder_shots` 只改 seq 不碰 updated_at——排序不再触发任何卡片重建/图片重载

## WebBridge 测试速查

| 场景 | 方法 |
|------|------|
| 页面加载/状态 | `find_tab` + `navigate`（不带 `newTab`，复用标签页） |
| DOM 验证 | `evaluate` 读 `window.__sb`、查 class/元素、测尺寸 |
| 普通点击 | CDP 真实 mousePressed+Released（`el.click()` 是隔离世界合成事件，不触发页面监听器——pitfall 实测） |
| 右键菜单 | CDP `mousePressed+Released`（合成事件被 `preventDefault` 拦截） |
| 模块函数 | 挂到 `window.__sb` 上才能调（ES module 不暴露到 window） |
| Edge | 不杀！开着一直复用 |

## 坑（已踩过的雷）

- **v0.9.37：renderGrid 切回宫格必须摘 timeline-mode class**（v0.9.36 只清了 stage/timeline 元素）：class 残留 → grid 保持 flex column（.timeline-mode { display:flex; height 固定; overflow:hidden }）→ grid-template-columns auto-fill 失效 = 缩放无视觉反应但 CSS 变量/滑块值正常（列数读数 2 假象、卡片 1007px 全宽排开）。凡"模式切换布局 class"必须双向清理（renderTimeline 加 class、renderGrid 摘 class），别只清元素
- **v0.9.37：range 滑块门控放行 Ctrl/Meta 组合键**（v0.9.32 只放行 Tab 的坑）：拖动滑块后焦点留在 range，Ctrl++/- 等组合键全被 `if (e.key !== 'Tab') return` 拦掉（用户按了没反应）；正解 = `if (e.key !== 'Tab' && !(e.ctrlKey || e.metaKey)) return`；方向键仍门控（原生调值保护，v0.9.32 拍板语义）
- **v0.9.37：时间线横轴缩放 apply 必须幂等**（刷新直落 timeline 污染持久化档位 200→176 实测）：initZoom 的 apply() 在 timeline 分支读未同步的滑块 value 写 sb-tl-w → 用户档位被覆盖；正解 = 以 localStorage 持久化为唯一事实源（读→档位化→写回→滑块仅显示同步），stepZoom/input 入口先写持久化再 apply
- **v0.9.37：缩放测试断言防 clamp 边界**：滑块 CDP 点击 track 右端直接跳到 max 档，后续"放大"断言恒 FAIL 但功能正常（clamp）；测试序列先腾空间（zoomOut）或断言前查 slVal==slMax 跳过；同坑还踩过 Ctrl+= 被误判失效（实际是 value 已到 max）
- **v0.9.36：独立布局视图（flex 覆盖 grid）必须清残留卡片**——renderTimeline 没清 grid 里宫格卡片：timeline 是 flex column，残留 .shot-card 以全宽 flex item 排开（每张 ~830px 高，76 张 ≈ 48000px）把 stage/timeline 推到页面深处。**DOM 断言全过但视觉全毁**（元素存在、数量正确，唯独布局飞了——截图才暴露）。切视图双向清理：renderTimeline 清 grid 直接子元素（保留 stage/timeline 自身）、renderGrid 清 stage/timeline
- **v0.9.36：惰性容器"已建"标志位会被外部清除 DOM 后失真**——buildStage/buildTimeline 的 stageBuilt/tlBuilt 标志在 renderGrid remove 容器后仍 true → 重建被跳过（空预览区/无时间线，且无报错）。正解 = 纯 DOM 存在性判断（getElementById 存在即复用），别用标志位
- **v0.9.36：复用模块内函数必须注意其内部绑定的 DOM 引用**——preview.js 的 showPreviewImage 内部写死模块级 img（侧边预览框 #previewImg），timeline 复用后 stage 大图永不显示（img display=block 但 src 空、naturalW=0——**display 状态能过断言，src 才是判据**）；修 = 加 target 参数（默认原 img）。凡跨模块复用带 DOM 副作用的函数，先看它内部引用了哪些模块级元素
- **v0.9.36：刷新直落持久化视图时 setView 不执行**——localStorage 直读 viewMode='timeline' 走初始渲染（renderGrid→renderTimeline），setView 的副作用（缩放控件禁用）全部缺失（实测滑块可用）。**依赖视图状态的一次性副作用放 renderXxx 函数内（每次渲染强制），别只放 setView**
- **v0.9.35：async 互斥切换未 await = 双 fetchShots 并发竞态**（垃圾桶/其它页）：trashBtn click 里 `exitOtherMode()` 不 await 紧接 `enterTrashMode()`——两个 fetchShots(true) 并发，后到的 /api/shots 响应按当前 state（trashMode=true）渲染 = **垃圾桶壳 + 正常镜头内容，此时点「彻底删除」会 purge 正常镜头**（危险）。互斥切换（A 模式退出 + B 模式进入）必须串行：退出方加 silent 参数静默退（不拉数据），只让目标视图发一个请求
- **v0.9.35：mousedown 里 blur 按钮焦点会被浏览器默认聚焦行为抢回**——mousedown 默认行为（聚焦最近可聚焦祖先）在 capture blur 之后执行；须在 **click 后 blur**，且用 `e.detail` 区分输入来源（鼠标点击 detail≥1；键盘 Enter/Space 激活 detail=0——键盘路径的焦点必须保留，否则无障碍导航断）
- **v0.9.35：合成 KeyboardEvent（dispatchEvent）不触发 :focus-visible 启发式**——验证"按快捷键是否冒焦点框"必须用 CDP Input.dispatchKeyEvent（真实输入管线）才复现 focusVisible false→true（合成事件永远 false）
- **v0.9.35：空态提示 absolute 定位会随容器高度塌缩消失**——空态时 #grid 高度=0（absolute 脱离文档流），#gridWrap 高度塌成 0，inset:0 的浮层 = 0 高不可见；正解 = 容器转 flex（`#grid.grid-empty { display:flex; align-items:center; justify-content:center; min-height: calc(100vh - var(--header-h) - 90px) }`）
- **v0.9.33：折叠态多图焦点框被叠图盖住左右缘——selected 卡片 border 是元素自身绘制（低于子元素层），层牌 z1-3 盖右缘 border（层牌右缘=卡片右缘）、cover 阴影(0 2px 6px 黑)向左扩散 6px 压暗左缘 border（PIL 实测：右缘 border 区=图内容色 127-137、左缘=52,110,178 非纯 accent）**。正解 = 卡片上重画同位置环 `.shot-card:has(> .frame-stack).selected::after { inset:-2px; border:2px solid var(--accent); border-radius:8px; z-index:999; pointer-events:none }`（inset:-2px = border box 与卡片 border 完全重合、位置不变；z-999 盖过层牌/封面/角标；:has(> .frame-stack) 只命中多图折叠态——单图/展开帧格/列表不误伤）。**凡「卡片外框被内部叠层盖住」的焦点/选中指示，正解 = 在卡片上画独立覆盖环（z 高），别指望元素自身 border**（border 永远在子元素 z 之下）
- **v0.9.33：多图层牌错位水平分量 > 卡片 border 厚 → 右缘伸出卡片（v0.9.30 overflow:visible 回归）**：层牌 translate(7px,7px) 右缘 = 卡片右缘 - border(2px) + 7px = 伸出 5px（4帧实测）；v0.9.30 前 overflow:hidden 裁掉伸出部分所以没暴露，v0.9.32 只修了单图 .shot-thumb 圆角，多图 frame-stack 层牌漏修（AGENTS 曾判断「同心数学上不伸出」是错的）。修 = 水平错位统一 2px（=border 厚，右缘贴卡片右缘 0 伸出），垂直 7/5/3 保留。**验证「图片是否伸出容器」用 getBoundingClientRect 比较 max(层牌 right) vs 卡片 right，别只信 CSS 注释**
- **v0.9.33：列表折叠态封面内框语义撤销**（v0.9.32 加的 .shot-thumb frame-focused + data-frame-id 移除）——折叠态统一「只 selected 外框」；改语义必须同步 focusFrame 加框/清框选择器、main.js 单图清框、render.js 新建/复用分支、CSS 规则五处，漏一处就是残留/假 FAIL
- **v0.9.32 候选：多图焦点框两真 bug（用户要求检查"折叠只有外框/展开只有内框"顺带揪出）**（2026-08-09 实测修复）：①**列表折叠态多图点击后焦点框不显示**——focusFrame 加框选择器只覆盖 .frame-img/.frame-thumb，列表折叠态封面是 .shot-thumb（无 data-frame-id）；修 = 缩略图加 data-frame-id/frame-no + 新建路径带 frame-focused + 加框/清框/Delete/复用同步 6 个选择器点全补（坑 239）。②**列表折叠回焦点框丢失**——renderGrid 的 img 移植（src 相同零闪烁 replaceWith）用旧无框 img 顶掉新建带框 img（同一状态复用路径有框/新建路径无框）；修 = 移植前同步 frame-focused + dataset（坑 238）。验证 8/8：宫格折叠=封面框/展开=帧格框/折叠回恢复/列表同矩阵/视图往返差分复用保留/单图点击清焦点。坑 238/239 详见 skill pitfalls-v0.9.30b.md
- **v0.9.32 候选：单图封面直角伸出卡片圆角 = v0.9.30 overflow:visible 的连锁反应**（2026-08-09 实测修复）：v0.9.30 为救角标把 `.shot-card` overflow 改 visible，但单图 `.shot-thumb` 自身 border-radius 0——原来图片直角靠卡片 overflow hidden 裁进 8px 圆角，改后直角伸出（图角距圆角圆心 8.49px > 8px 弧线；用户报告"图片两个角支出去了"）。修 = `.shot-thumb { border-radius: 8px }`（与卡片同值同心贴合）；多图 frame-stack 6px 因同心数学上不伸出未动；列表 .thumb-wrap .shot-thumb 4px 更高特异性不受影响。坑 237 详见 skill pitfalls-v0.9.30b.md
- **v0.9.32 候选：Tab 切视图后滑块焦点框常驻 = :focus-visible + 焦点滞留**（2026-08-09 实测修复）：拖动滑块（鼠标路径无框）→ 按 Tab 切视图（preventDefault 阻断焦点循环，焦点留在滑块）→ Tab 是键盘导航触发 `:focus-visible` → 滑块常驻浏览器默认焦点框。修两层：①keyboard.js Tab 分支切完视图后 blur 掉 range 焦点（连续 Tab 不受影响，handler 在 document keydown）；②style.css `.zoom-bar input[type="range"]` 加 `outline: none`（输入框 Tab 循环键盘聚焦到滑块的路径兜底；滑块有 accent-color 手柄反馈不需要 ring）。坑 236 详见 skill pitfalls-v0.9.30b.md
- **v0.9.32 候选：拖动滑块后 Tab 切不了视图 = keyboard.js 输入框门控没区分 range**（2026-08-09 实测修复）：v0.9.3 门控 `tag === 'INPUT'` 把滑块（`<input type="range">`）也拦了——拖动后焦点留在滑块，按 Tab 被门控 return，视图不切且焦点被浏览器默认 Tab 循环跳走（实测跳 zoomIn）。修 = 门控拆细：TEXTAREA 全拦 / INPUT 非 range 全拦 / **range 只放行 Tab**（←/→ 原生调值行为不能放行方向键快捷键）。坑 235 详见 skill pitfalls-v0.9.30b.md
- **v0.9.32 候选：缩放滑块"拖不动"真根因 = marquee.js 排除列表过时**（2026-08-09 实测修复）：v0.9.24 重构把滑块从 `.size-slider` 挪到 `.zoom-bar` 容器，marquee.js 的 document mousedown 排除列表没同步 → 滑块 mousedown 被 `e.preventDefault()` 拦截 → 原生 range 拖动/点击 track 全失效（用户怎么拖都没反应）。修 = 排除列表补 `closest('.zoom-bar')`。**v0.9.30b/31 两次"滑块失灵"诊断都归因 CDP 通道限制/边界 clamp，实际主因是这条**（修复后 CDP 真实点击 track 直接跳值 0→4）。验证手法：合成 mousedown 到滑块读 `e.defaultPrevented`。坑 234 详见 skill pitfalls-v0.9.30b.md
- **v0.9.31：img 是替换元素——inset box-shadow 绘制在替换内容之下不可见、::after/::before 伪元素 computed 有值但不渲染**（实测双击确认）。凡要在 img 上画"盖在图上"的框，唯一边际成本最低的方案 = **border + 全局 box-sizing: border-box**（元素尺寸不变、内容区缩 4px 由 object-fit cover 吸收，同列表 frame-thumb 焦点框语义）；outline 穿透 z-index（v0.9.30 已踩）也不行。替换元素上做视觉层三连坑：outline（E.2 最后绘制）✗ / inset box-shadow（内容之下）✗ / ::after（不渲染）✗ / border（唯一正解）✓
- **v0.9.31：差分渲染复用分支不重建 DOM——新增 class 语义（如折叠态封面焦点框）必须同步进复用分支**，只改新建路径（stackHtml）会在"初始渲染后状态变化 + renderGrid"场景静默失效（复用旧元素不走新建模板）；判别：手动 toggle + renderGrid 新建路径有效、实际交互路径无效 = 复用分支漏同步
- **v0.9.31：CDP 无法驱动原生 range 滑块拖动**（mousePressed 不触发跳值、mouseMoved 只送达第一次、release 变 pointercancel——重启 daemon 复测仍无效，非抖动）：滑块类交互自动化验证 = 合成 input 事件（setter + dispatch input 监听器可达主世界）驱动 JS 逻辑 + elementFromPoint 命中检测，真实拖拽路径留用户实测；CDP 拖动滑块失败**不是产品 bug 证据**（⚠️ 2026-08-09 修正：该轮"CDP 点击/拖动全无效"实为 marquee 排除列表过时拦截 mousedown 所致，修复后 CDP 真实点击 track 跳值生效——见上方 v0.9.32 候选坑；通道限制只影响拖动流，不影响单点点击 track）
- **v0.9.31：滑块初始 value = nMax - cols（宫格模式）——打开页面即最大值档**（localStorage sb-cols 持久化），放大方向天然 clamp 无效果，v0.9.26 去滑块文字后用户看不出已到顶，易被报"缩放条失灵"；诊断先读 sizeSlider.value/max/min 三件套，别对着"拖不动"改 JS

- **v0.9.30：CSS 绘制顺序（附录 E.2）——outline 是所有元素最后统一绘制的阶段，穿透一切 z-index（实测 z=9999 压不住）；外扩 box-shadow 同理**。凡"画在元素外边缘"的指示层（焦点框/选中框），要么用 inset（画进元素内，被更高 z 元素正常盖住），要么接受会被盖。宫格 frame-focused 焦点框已改 inset box-shadow（列表 border 焦点框无此问题——border 在元素内）
- **v0.9.30：.shot-card overflow: hidden 会裁掉 absolute 负偏移子元素**（折叠角标 top/left -2px 被裁 2px，视觉 38px vs 展开 40px，"展开/折叠角标动了"的隐藏根因）——overflow 容器内负偏移定位元素必查裁切
- **v0.9.30：flex 容器内文本的 ink 顶比行框顶高 1px（字体负 half-leading）**——"数字左上角对齐"类需求（Range.getClientRects 实测 relY=7 vs padding 8），要 padding-top 补偿 1px 才能让 ink 左上角精确落在目标点
- **v0.9.28：register() 函数内写 `import bpy.utils.previews` 会静默搞挂插件注册**——import 语句让 bpy 变函数级局部变量，函数内前面的 `bpy.utils.register_class(cls)` 反炸 `UnboundLocalError: cannot access local variable 'bpy'`；症状 = addons 显示已启用但 sys.modules 无模块、8089 不起 9876 正常。修 = `from bpy.utils import previews as _previews`。诊断 = 拉起时 stdout 重定向（`blender.exe file.blend > log 2>&1`）抓 register Traceback，别对着模块顶层代码猜
- **v0.9.28：UILayout.separator(factor) 在子 Panel 面板里视觉不生效**（调了不报错但间隔无变化；hasattr 也查不到 separator）——收紧两行按钮垂直间距用 `column(align=True)` 包两行（align 列内行距比默认小），别换 factor 值试
- **v0.9.28：Blender 按钮图标永远渲染在文本左边**——要"图标在右"（如导航 ◀/▶ 方向语义）只能文本内嵌字符，去掉 icon 参数
- **v0.9.28：MCP 线程无 window context，自截图用 `bpy.app.timers.register` 包 `bpy.ops.screen.screenshot(filepath=...)`**，sleep 3s 后读文件；PIL 亮度/边缘分析对深色 UI 按钮边界分辨力差，布局微调以用户目检为准
- **v0.9.27：WS_EX_TOOLWINDOW 的窗口标题栏 DWM 不绘制图标**（pywebview 窗口实测，深浅色无关）——悬浮化别用 TOOLWINDOW，owner 关系（owned 窗口默认不进任务栏/Alt+Tab）+ 去 WS_EX_APPWINDOW 已足够；仅无 owner 时才退回落 toolwindow。v0.9.26 的"深色重绘不重读 WM_SETICON"结论是错的（回设无效），真正的用户线索 = 创建瞬间（on_started sleep 1.0 期间）还是普通窗口所以有图标
- **v0.9.27：PrintWindow(PW_RENDERFULLCONTENT) 拿不到 DWM 标题栏图标层**（恒输出白色占位块）——诊断"图标画没画"必须 ImageGrab 屏幕真实像素（PrintWindow 只适用于客户区内容）
- **v0.9.27：批量行号替换脚本的行号偏移会算错**——文件插入/删除后旧行号→新行号偏移必须用**锚点行动态反推**（找文件中唯一标志串定位），别手算插入行数（两次踩坑：差 3、差 1）。且"同值不同义"的颜色必须行级映射拆分，值级默认映射会混语义
- **v0.9.27：CSS rgba(var(--accent-rgb), 0.08) 里正则 `rgba?\([^)]*\)` 只匹配到第一个 `)`（嵌套 var）**——替换验证脚本的"剩余色值"统计会出现假 miss（实际已替换），别误判
- **v0.9.27：其它页 enterOtherMode 的 1500ms 硬等是切换慢根因**——sync 是异步入队（/api/sync 立即返回 queued），前端等 sync 完成不该用固定 sleep；正确姿势 = 先渲染当前数据 + sync fire-and-forget + 心跳（rev 变化自动刷新）
- **v0.9.26：`[data-tip] { position: relative }` 会覆盖同特异性（0,1,0）且定义更靠前的 absolute 元素**（.collapse-btn/.stack-badge 实测被拉回流内）：带 data-tip 的 absolute 定位元素选择器必须提特异性（button 前缀），新增此类元素时先查 style.css 801 行 data-tip 规则
- **v0.9.26：DWM 深色标题栏应用后标题栏图标消失**（pywebview 窗口）：DWMWA_USE_IMMERSIVE_DARK_MODE 重绘不重读 WM_SETICON（图标句柄在，只是不绘制）——深色应用后回设 WM_SETICON（SMALL/SMALL2/BIG）强制重绘
- **v0.9.26：SVG 图标 1em 跟随 font-size，按钮 font-size 被通用规则覆盖时图标尺寸错**：.ic 在 .header .actions button（font-size:13px, 0,1,2）内的 hamburger（0,1,0）图标变 13px——需同级特异性补回（.header .actions button.hamburger）
- **v0.9.26：icons.js 对象键名含连字符（td-tp-ylt/a-chuangjian1）必须加引号**——ESM 对象字面量裸键带连字符 SyntaxError，node --check 能抓到
- **v0.9.26：--background --python 造库脚本 quit_blender 后进程仍残留**（180s 超时）：造完手动 tasklist 对比杀残留（无端口占用未注册插件，仅占内存）；下次脚本改用 save + sys.exit 或延迟退出
- **v0.9.25：ESM 函数体内引用未 import 符号 = 模块加载不报错，运行时点击才 ReferenceError**（trash.js 漏 `import { exitOtherMode }`，症状"点了没反应"且 handler 后续代码中断——enterTrashMode 没跑）。加跨模块调用后 grep 确认 import 行存在；node --check 测不出（语法合法）（skill pitfall 176）
- **v0.9.25：空库跑 web_audit 必 4 FAIL**（无镜头可测：展开/右键/搜索/台词）——web_audit 不造数据，空库隔离验证前先跑 make_std_shots.py（STD_ 前缀 10 镜头），造完别重启（.blend 不存盘重启即清）
- **v0.9.25：adopt（转镜头）undo 后镜头目录残留磁盘**——undo 只改场景名+DB 还原，目录由下次启动完整 sync 的目录清理自愈
- **v0.9.25：cp -r 部署 web/ 尾斜杠被 MSYS 吞 → web/web 嵌套 + 旧文件不更新（白部署）**——必须 `cp -rf 源/. 目标/`（skill 部署模板已改）
- **v0.9.24：FLIP 动画中间态横向溢出 → 水平滚动条闪现 → fixed 底部工具条上下抖**（宫格/列表切换实测 scrollWidth 冲到 1976px、sliderTop 967→957）：根因 = 切换 FLIP 动画中间态内容横向溢出，水平滚动条出现/消失吃掉视口底 10px，fixed bottom 元素跳。修 = animateFrom（所有 FLIP 统一入口）开头 body.no-hscroll（overflow-x:hidden）+ 320ms 后自动移除（0.28s 过渡+余量）。**凡 fixed 底部组件垂直跳动，先查水平滚动条出没**（v0.9.21 缩放抖动同根因）
- **v0.9.24：锁定长宽比比例必须在勾选时记录**（aspect.js）：用当前 W/H 实时算比例会自锁——改 W 瞬间 H 还是旧值，比例=新W/旧H，H 算回来恒等。勾选 change 时固定 lockRatio，取消清空
- **v0.9.24：.aspect-lock 的 display:flex 被 .modal label 覆盖**（优先级 0,1,1 > 0,1,0）：子选择器必须写 .modal label.aspect-lock
- **v0.9.24：内联 svg 作 flex item 被 flex-shrink 收缩**（主菜单图标 16px 变 10px 实测）：须 flex:none（或 display:block）
- **v0.9.24：web_audit 菜单断言过时**——菜单中文化后旧断言查 'Open Shot/Rename/Duplicate' 必 FAIL（Delete 因快捷键标注含 'Delete' 碰巧过）。**改菜单文案必须同步 scripts/web_audit.py 的 expect 列表**（已改中文断言 23/23）
- **v0.9.24：按钮 title → data-tip 替换**（原生 title 首次 hover 冷启动 ~1s）：全站 16 静态 + 5 动态（main.js 关于 / render.js 台词框手柄/红格子/角标/折叠钮）title 已清；trash.js 进出垃圾桶改 dataset.tip 切换；**新增动态按钮 title 一律 data-tip**
- **v0.9.22：Delete 帧级删除选择器漏列表 class**（已修，用户实测确认）：keyboard.js `querySelector('.frame-img.frame-focused')` 只匹配宫格——列表展开态蓝框是 `.frame-thumb.frame-focused`（v0.9.2 双 class 机制），命中不到 → 落 deleteSelection() 误删整镜头（实测 3 镜头进垃圾桶）。修 = 双选择器 + shotId 双来源（宫格 closest('.frame-cell').dataset.id / 列表 frame-thumb.dataset.shotId 兜底）。**凡"帧级 vs 镜头级"判定，宫格/列表两视图 class 都要覆盖**（skill pitfall 172）
- **v0.9.22：CSS grid 分列模板必须放实际子元素**（关于面板）：`.about-body { display:grid; grid-template-columns }` 对内部 `.about-row`（label/value 的直接父）不生效——row 内仍是 inline 流，label 和值连排一行。DOM 断言查不出（30/30 全 PASS），几何测量（label 列左缘交替/行高参差）才暴露（skill pitfall 169）
- **v0.9.22：PIL 单点采样小字号文本会采到子像素 AA 条纹**（红/青/蓝三色偏，别当渲染 bug）：crop 区域 Counter 统计主色判定 + elementFromPoint/computed 交叉（skill pitfall 170）
- **v0.9.20：pythonnet 控件属性赋值死锁（PyWebView 窗口假死 + 拖死 Blender 最小化）**：`native.ShowInTaskbar = False`（跨线程属性赋值）与 WebView2 初始化竞争 → UI 线程死锁 → 窗口外观正常但 WM_NULL 无响应（假死）；**作为 owned 窗口还会拖死 Blender 最小化**（ShowWindow 同步等 owned 窗口响应）。处置：纯 ctypes（SetWindowLongPtrW/SetWindowLongW）+ on_started 里 shown 后 sleep 1s 错开初始化。诊断：SendMessageTimeout(WM_NULL, SMTO_ABORTIFHUNG) 0=假死，立即 taskkill launcher 恢复 Blender
- **v0.9.20：WebView2 CDP 限制三条**：①`Input.dispatchDragEvent` 完全无效（拖图测试用合成 DragEvent+File 主世界 dispatch，真建镜头）；②CDP 拒非 DevTools origin 的 WebSocket（403）→ 必须 `--remote-allow-origins=*`（pywebview 的 REMOTE_DEBUGGING_PORT 带不了额外参数 → 环境变量 + edgechromium.py 补丁合并）；③CDP 键盘事件可达主世界（keydown 计数实测），空格展开测试必须选多图镜头（单图被 multiShots 过滤静默跳过）
- **v0.9.20：cairosvg 破坏 rlPyCairo**：装 cairosvg（带 cairocffi）后 rlPyCairo 优先走 cairocffi → 找不到 libcairo DLL 全崩；SVG→ICO 转换用 svglib + reportlab `drawToPIL(backendFmt='RGBA')`（drawToFile 无 alpha）+ PIL 存多尺寸 ICO；转换后必须自查（角落 alpha=0）
- **v0.9.19：rename 丢图根因 = frames.image_path 不随目录改名重指**（已修，cmd_rename_shot 第 4.5 步）：改名四层联动只更新 name/scene/camera/still/thumb，**frames 表绝对路径仍指旧目录 → 前端 imageUrl 全丢红格子**（多图镜头改名必现）。修复注意：**检查文件存在性必须查新路径**（目录已改名，查旧路径恒 False，白改一轮）；update_frame 重指顺带 bump 帧 ver = 前端恰好刷新
- **v0.9.19：audit.py undo 排空循环误伤审计前操作**（已修，深度门控）：undo 栈全局共享（core/undo.py deque maxlen=20），R3 段"撤销栈排空"无条件弹到 empty 会回放审计前 push 的逆操作（实测：审计前 API 造数据 → STD_S10 被 purge、台词被清；**真实用户场景 = 审计前刚拖拽/改台词会被审计撤销**，2026-08-06"顺序变倒序"之谜即此）。修 = 审计开始前 MCP 记 undo depth，排空只弹到该深度
- **v0.9.19：web_audit 假设初始 grid 的脆弱性**（已修，强制初始态）：localStorage 'sb-view' 残留 list（用户切过视图）时，多图折叠态帧格/台词条/--card-min 断言全查不到 → 连环假 FAIL（本次 6 FAIL 根因，非功能 bug）。修 = reload 后强制 viewMode='grid' + localStorage 同步
- **v0.9.14：web_audit 开发六坑**：①**restore_all/重置把 Set 赋值成 [] = 页面运行时 state 污染**（expandedShotIds/selectedIds 是 Set，必须 .clear()——曾导致全页面 .has 炸、误判"跑旧 JS"）；②**浏览器无 ETag/Last-Modified 时 no-cache 也启发式缓存旧 JS**——web_audit 强制 clearBrowserCache+reload+版本探针；③**reload 后必须 bringToFront**（setTimeout/rAF 冻结 → 搜索 debounce 不跑/事件不触发）；④**合成事件可达主世界**（input/click dispatch 有效，CDP 真实输入非必需——但合成 mousedown/up 目标必须在视口内，elementFromPoint 视口外返回 null）；⑤**展开态帧格是独立卡片**（.shot-card.frame-cell 兄弟节点，不在折叠卡内部）；⑥**__zoomApply 无参**（读闭包 cols，滑块 sizeSlider 合成 input 才是驱动入口）
- **v0.9.14：审计段拆分的两个坑**：拆函数后段内变量作用域独立（s4/s5 需自取 shot，原 s2 单函数共享变量）；SEG_REG 依赖声明漏写（s3/s4 依赖 s2，漏了段级 --only=open/rerender 会 StopIteration——全量不受影响因顺序天然对）
- **v0.9.14：搜索是下拉结果列表，不过滤卡片**（search.js onInput → #searchResults 最多 12 条 search-item，点击 locate 定位）；**菜单项文本英文混中文**（Open Shot/Rename/Duplicate/Delete + 重拍封面/编辑台词/自动台词大小）
- **v0.9.13：关预览父条高度残留**：setPreview(false) 的 savedMin 还原路径**绕过 zoom apply → relocateDialogue 漏调** → 父条残留窄宽时的高度（158px 残留，下一排被多推 72px）。修 = savedMin 分支补 relocateDialogue()。凡"绕过 zoom 直接改 CSS 变量"的路径都要检查父条重算
- **v0.9.13：添加台词 inline top 残留**（v0.9.12 遗留）：临时 box 无父条分支设 `style.top=排尾+gap`（相对 grid 的 absolute 坐标），提交后 updateDialogue 复用 box 进父条（relative containing block）**不清 inline top** → 台词条掉到 1545+1545=3090px。修 = 立即建正式父条（box 直接 top:0 进父条，所见即所得）
- **v0.9.13：audit.py 段拆分重构四坑**：①三引号字符串内部的行不能加缩进（blender() 代码原样传给 Blender 执行）；②s3 段必须剥掉原 main 的 `return summary()`（否则 SUMMARY 打两次）；③s0 段保持 main 顶层缩进（别掉进 `if only:` 块——无 --only 时 connectivity 静默不跑）；④**--only 的 taken 快照必须在段执行前取**（跳过 s2h 时为空 set，cleanup 会把用户 c00xx 镜头当测试残留误删）。转换脚本非幂等（重跑需从备份恢复原始 audit.py）
- **WebBridge v1.11.5 CDP 无法产生 dblclick**（2026-08 实测六轮）：CDP 双击 4 变体 + 扩展 mouse_click 连点全不触发；合成 dblclick dispatch 也无效，但合成 mousedown/mouseup/click dispatch 到元素（bubbles）可达主世界。绕法：展开/折叠 = 单击选中+空格键（keyboard.js 需 selectedIds>=1）；编辑台词 = 右键菜单「编辑台词/添加台词」按钮（与 startDlgEdit 同函数）
- **v0.9.6：Blender 拉起时 blend 路径必须用原生路径**：MSYS `$HOME` 在 `python -c` 里解析成 `/c/Users/...` 导致 `instances.json` 找不到，blend 变量为空，Blender 把当前目录当 blend 文件报 Permission denied。正确姿势：`cat` 原生路径给 python 读，或直接用 MSYS 路径 `/c/Users/...` 拼完整路径。BlenderMCP 端口：正常启动默认 9876（recover.py 的 9877 只在 recover 流程生效），9876 被 Clash 内核 verge-mihomo 抢占时才需要 recover.py 改 9877——先 `netstat -ano | findstr :9876` 看是不是 Blender 自己绑的。
- **Windows 双 Blender 实例端口劫持**：`socketserver` 默认 `allow_reuse_address=True`，在 Windows 上 SO_REUSEADDR 语义 = 允许第二个进程绑同一端口——两个 Blender 都"成功"监听 8089/9876，连接被随机分流，表现为服务间歇性假死、curl 空响应、MCP 超时，进程却活得好好的。解法：独占绑定 + 启动顺延扫端口（v0.4.0 起 8089→8090→…）。排查先 `netstat -ano | findstr :8089` 看是否有多个 PID 绑同一端口。**注意 BlenderMCP 插件（9876）没做同样处理，多开时 9876 仍会双绑**——MCP 调试前先确认只有一个实例，或以 `netstat` 里最新绑定的 PID 为准。
- **直接 MCP 删场景会崩 Blender**：`bpy.data.scenes.remove(s)` 与插件 queue 定时器并发时（拍屏/遍历场景中途场景没了）Blender 4.5 整个进程闪退。测试要制造孤儿镜头用**改名场景**（`s.name="Shot_X"`）代替删除；删场景永远走插件自己的 queue delete 路径。
- **Chrome 冻结标签页 setTimeout 也被限流**：后台标签页的 `setTimeout` 被钳到分钟级，webbridge evaluate 里 `await sleep(400)` 会挂到超时——测试代码全部同步断言，异步结果（预填/toast）拆成多次 evaluate 分开读；先 `cdp Page.bringToFront` 解冻。
- **单线程 `HTTPServer` 被 keep-alive 连接独占**：浏览器 1.5s 心跳持长连接，单线程服务会黏在这条连接上，其它请求（含 curl）全部排队卡死、接口间歇性无响应。解法：`ThreadingHTTPServer` + `daemon_threads=True`。教训：加心跳轮询前先把服务线程化。
- **批量改名必须两阶段**：目标名被选区内靠后的镜头占用时，`cmd_rename_shot` 的场景名冲突防御会抛错、该条改名静默失败（DB 无 UNIQUE 约束不报错更隐蔽）。解法：先全改 `__ren_<id>` 临时名，再统一落正式名。
- **SMB 盘（N:）mtime 不可靠**：粗粒度+缓存，DB 写了 mtime 不变，不能拿来做版本号；要查内容（COUNT+MAX(updated_at)）。
- **webbridge evaluate 是隔离世界**：与页面共享 DOM 但不共享 JS 状态（window.fetch/页面变量都摸不到）；合成 `DataTransfer`/`File` 走真实拖放链路时 FileReader 永不回调（跨世界），拖图类链路要 API 直测补位；常驻 DOM 元素（如 #contextMenu）判断显隐要查 `display`，查存在性会得到假阳性；测试里 `el.remove()` 会真删常驻元素，收拾残局用 `style.display='none'`。
- **Chrome 后台冻结标签页**：定时器（心跳）和 fetch 全被暂停，页面请求"挂起"、抓包只有发没有回——是浏览器行为不是服务 bug，curl 直测可区分；验收时先把标签页激活。**rAF 同样不跑**：依赖 requestAnimationFrame 的功能（惯性滑行、连续缩放节流）在后台标签页测试时表现为"没反应"，必须 bringToFront 后测。
- **DOM 差分复用 × 就地编辑 = 孤儿输入框**：编辑会话 blur/取消后若只调 renderGrid，差分键没变会原样复用卡片元素——输入框留在卡片里且监听器已 done 失效，同时 editingId 卡死阻塞键盘快捷键。解法：finish 里先 `input.replaceWith(原元素)` 还原 DOM；renderGrid 复用条件加 `!el.querySelector('input')`，强制重建时顺手解锁 editingId。
- **webbridge 合成事件 dispatched 在 document 上 target 没有 closest**：`document.dispatchEvent(new MouseEvent(...))` 的 `e.target` 是 document，`e.target.closest()` 直接 TypeError，监听器静默暴毙。凡是 handler 里用 closest 的（滑动/框选），事件要 dispatch 在 `document.body` 或具体元素上。
- **合成 DataTransfer+File 的 drop 是真链路**：`dt.items.add(new File(...))` 走 drop 会真实写文件进镜头目录、真实给相机挂背景图。测试拖图一律用 REF_/AUDIT_ 前缀镜头，别拿用户镜头当落点；万一污染了：MCP 删 background_images + 删文件 + API rerender 三连。
- **API 删场景只删运行时，磁盘文件会复活幽灵**：queue delete/purge 删的是当前进程的场景，.blend 没存盘的话重启后场景原样回来，sync-on-load 还会给它们重建 DB 记录——审计清理并不等于磁盘干净。要真正除根：运行干净后存一次盘。重启后镜头数莫名变多，先怀疑这个。
- **updated_at 不能进图片 URL/差分键**：它会被排序、改文本等任何写操作刷新，一刷就是全卡片重建+全图片重载（"噼里啪啦"的根因）。图片版本要用独立的 thumb_ver（只在拍屏完成时 +1）；差分键同理只放内容字段。
- **hidden 标签页 rAF 直接不跑**：`document.visibilityState==='hidden'` 时 requestAnimationFrame 完全停摆——惯性滑行、橡皮筋、rAF 节流的缩放在后台标签页测试全表现为"没反应"，`Page.bringToFront` 也救不回（用户切走就失效）。这类动效只能前台实测或数学离线验证。
- **重场景删除 = 整文件撤销快照卡死**：`bpy.data.scenes.remove(s)` 在全局撤销开启时会给整个 .blend 写一份撤销快照，1.4GB 文件直接卡死数分钟（MCP/HTTP 全假死，进程活着）。解法：`use_global_undo=False` + `bpy.data.batch_remove(ids=(s,))`，0.0s 瞬删；`cmd_delete_shot` 和面板删除已改此路径。手动 MCP 清场景必须同款写法。
- **改名会断相机背景图**：bg.image 是绝对路径，`cmd_rename_shot` 改完目录不重指 `bg.image.filepath`，原目录没了图就被 Blender 静默丢弃（"图片镜头背景神秘消失"的根因）；rename 必须顺手重指+reload。同理 `FULL_COPY` 复制的场景共享图片数据块，purge 源镜头会带走副本的图——duplicate 时 bg 文件要 copy2 到新目录 + `images.load` 独立数据块。
- **骨架屏不能"先撤再播"**：数据一到就 innerHTML 清掉骨架、真实卡片还在隐身等图 = 半秒黑屏。正确姿势：骨架是独立覆盖层，真实卡片一直在底下，揭幕=覆盖层淡出+卡片入场交叉淡化。
- **CSS 动画类播完必须摘**：元素被移除再插回 DOM 会**重播**它身上的 CSS 动画。renderGrid 每次都要经过 fragment 重排所有卡片，`fade-in` 类不摘的话任何操作都全场重播入场 = 闪黑（v0.6.1 的大坑）。入场播完立即 remove 类。
- **覆盖层对齐小心 margin 塌陷**：`#grid` 的 margin-top 会穿透无边框的 `#gridWrap` 塌陷，absolute 覆盖层（`top:16px`）因此比真实内容低 16px 漏图。父容器 `display: flow-root` 建 BFC 即解，别用 overflow:hidden（会裁掉橡皮筋过冲）。

- **热重载僵尸线程**：`del sys.modules` 重载插件后旧 HTTP server 的 `serve_forever` 线程杀不掉，新旧 handler 随机抢请求 → 表现为"代码改了但请求没走新路径"。判断：`threading.enumerate()` 查 serve_forever 数量 >1 就是脏了。解法：重启 Blender。
- **`bpy.ops.view3d.view_camera()` 在 `temp_override` 循环里只生效一个 area**：多视口场景下每次只会有第一个视口切到相机视角。改用 `area.spaces.active.region_3d.view_perspective = 'CAMERA'` 直接设所有视口（v0.7.0 多图跳帧 + v0.3.0 打开镜头都用过此坑）。
- **`bpy.ops.render.opengl` 只读真实视口状态**：temp_override 里改 context 对它无效——它读的是你屏幕上实际看到的视口。要切相机视角必须直接改 `space.region_3d.view_perspective`。
- **Git 推 GitHub：先直连，失败再 SOCKS5 兜底**：2026-08 实测 Clash 未开时直连 push 成功（无需代理）；被墙时 Edge 走系统代理 `127.0.0.1:7897`（SOCKS5）。MSYS2 git 不支持 SOCKS5 认证交互，必须 `git remote set-url "https://TOKEN@github.com/..."` 内嵌 token 跳过 credential helper，失败时 `git config http.proxy socks5://127.0.0.1:7897`。推完记得还原 remote URL（去掉 token）。
- **MCP 线程无 window context**：`bpy.context.window/screen` 为 None，render/opengl 全挂。需要主线程 timer 队列执行（架构⑥的核心模式）。
- **BaseHTTPRequestHandler 的 if/elif 链断裂**：独立 `if` 替代 `elif` 会导致 200 + 404 双响应拼包，JSON 解析报 Extra data。
- **`scene.copy()` 是链接复制**：大纲显示红色，新场景和原场景共享物体数据。用 `bpy.ops.scene.new(type='FULL_COPY')` 才能完全独立。
- **ES module 函数不在 window 上**：`toggleView`、`__zoomApply` 等是模块导出，WebBridge evaluate 调不到。每个需要测试入口的函数都必须显式挂到 `window.__sb` 或 `window.__zoomApply`。忘记挂载 → 调不动 → 误以为功能坏了。
- **CSS 孤儿声明块会吞掉后续规则**：选择器行被删/改坏后残留 `属性: 值; }` 无头尾巴（v0.8.2 衬底失效根因），CSS 解析器错误恢复时把紧跟其后的整条规则（如 `.shot-card.frame-cell` 的 background/margin）丢掉，浏览器 computed 静默回退。curl 看服务器文件完好、浏览器 cssRules 却缺规则 = 前面有语法破坏。排查法：对比 `document.styleSheets[0].cssRules.length` 与本地 `grep -c "{"` 规则块数，差的就是被吞的；改完 CSS 顺手跑一次该对比。
- **面板 delete_shot 直接 batch_remove 当前激活场景必崩**（v0.8.2 修复）：queue 的 `cmd_delete_shot` 有"先切走当前场景再删"的保护（Safe: switches away first if active），但面板 operator 是独立实现、直接 `bpy.data.batch_remove(ids=(scene,))`——删除正在激活的场景时 window 仍引用被删 datablock → Blender 4.5 必崩（"Blender has stopped working"弹窗）。修复：面板路径复用 `cmd_delete_shot`。**教训：所有删场景路径必须走 queue 的 cmd_delete_shot，别自己 batch_remove**。
- **render_all 大工程必崩（v0.8.4 已随功能删除解决）**：86 镜头工程跑 `render_all`（同步遍历逐个 `render_shot`），内存飙到 3.9GB 后 Blender 崩溃弹窗。~~疑似：重渲染 + queue auto_sync timer 并发、或长时间主线程占用 + Windows 内存压力。尚未修复~~——v0.8.4 用户拍板删除 Render All（90+ 镜头下无意义），批量重渲染由前端右键走队列逐 tick 重拍封面帧，天然不崩。
- **duplicate 必须复制 frames 数据，不能只拍一张**（v0.8.4 修）：旧 `cmd_duplicate_shot` 复制场景后只拍 legacy still+thumb，**多图镜头复制后 frames 表为空** → 前端按单图显示、展开不了。统一模型下改为逐帧 copy2 帧文件 + add_frame（保留 is_cover）+ update_shot 同步封面；封面 still 文件名推导：`thumb.jpg/still.png → still.png`、`fNNNNN_thumb.jpg → fNNNNN_still.png`（别用 replace("_thumb.jpg","_still.png")——thumb.jpg 会变 thumb_still.png）。源镜头无帧行时兜底拍 f0。
- **render_shot_files(frame_no=0) 输出 f00000_still.png/f00000_thumb.jpg，不是 still.png/thumb.jpg**（v0.8.4 坑）：frame_no is not None 分支走 `f{frame_no:05d}_*` 命名。创建镜头/重拍封面帧后目录里没有 still.png/thumb.jpg（除非旧文件残留）——audit 检查文件、duplicate 的 still 推导、前端兜底路径都要按 f00000_* 预期。shot 级 thumb_path 被 cmd_render_frame 封面同步指到帧文件，前端只消费 frames。
- **init_db 迁移只在 server 启动 / init_project 时跑**（v0.8.4 测试翻车）：`get_db_path` 只拼路径不触发迁移。纯 Python 验证迁移逻辑要直接调 `init_db(db_path)`；测试库建表用 `conn.executescript(DB_SCHEMA)` 而非手写简化表（shots 有 seq NOT NULL 列，手写会 IntegrityError）。迁移必须幂等。
- **MCP 线程测 operator 必须 timer 包装**（v0.8.4 audit 翻车）：`bpy.ops.storyboard.create_shot()` 从 MCP execute_code 直调走后台线程，operator 内 auto-render（cmd_render_frame → render_shot_files）需要主线程 window context——静默失败（try/except 吞掉），创建成功但 frames=0 缩略图没出，误判成"自动拍屏坏了"。正确姿势：`bpy.app.timers.register(run, first_interval=0.2)` 包一层让 execute 在主线程跑（与面板点击同路径）。**凡 audit 里测面板 operator 的用例，创建类操作一律 timer 包装**。
- **大重构（删 operator / 改注册表 / 加迁移）必须重启 Blender 验证**（v0.8.4 教训）：operator 注册表删除、init_db 迁移都在启动时机执行，`importlib.reload` 热重载覆盖不了（热修补只适用纯逻辑模块）。改完这类代码 = 部署 + taskkill blender + 重启（读 instances.json 拿当前 blend 路径恢复现场）+ audit + WebBridge 回归。重启是 Agent 的活，别让用户自己重启。
- **`region_3d.camera` 在 Blender 4.5 不存在**：设 `view_perspective='CAMERA'` 后相机自动从 `scene.camera` 取，不要手动设 camera 属性。
- **审计脚本测不到浏览器层 JS 问题**：如右键菜单事件冒泡这类纯前端 bug，API 审计全过但用户手动点无效。网页 JS 改动必须硬刷新后人工点一遍。
- **WebBridge CDP 对高频 mouseMoved 只送达第一次**（v0.9.5 发现）：普通状态下 15 次 `Input.dispatchMouseEvent mouseMoved` 页面只收到 1 次 mousemove（慢速 0.2s/步也一样）；**HTML5 DnD 测试时 dragover 正常是浏览器 DnD 状态机内部跟踪掩盖了此缺陷**（不依赖 mousemove 派发）。CDP 验证拖拽类交互要用**合成 PointerEvent**（evaluate dispatchEvent，监听器不校验 isTrusted 即可驱动逻辑）或接受"事件流不完整"只验单次事件。
- **CDP mouseReleased 触发 pointercancel 且坐标 (0,0)**（v0.9.5）：CDP 合成序列的 release 不派发 pointerup/mouseup，而是 pointercancel(x=0,y=0)——凡监听 pointerup 做落点判定的代码必须容错（用最后一次 pointermove 坐标，`e.type==='pointercancel' && lastMove`），否则 elementFromPoint(0,0)=BODY 落点全丢。
- **audit.py 与 audit_context_menu.py 共享 DB 不能并行跑**（v0.9.5 教训）：并行时互相清掉对方刚创建的测试镜头（AUDIT_POS 丢失 → ValueError）。audit 被 Ctrl+C 中断会留 AUDIT_*/c0970 等残留，重跑前先清（delete+purge），否则后续断言被残留干扰。
- **addons 根目录残留旧模块文件会 shadow 标准库**：插件 `sys.path.insert(0, addon_dir)` 后，根目录散落的 `queue.py` 会顶掉 stdlib `queue`（core/queue.py 的 `import queue` 拿到错的模块）。部署目录只留 `__init__.py`/`core/`/`web/`，靠 sys.modules 里 stdlib 已缓存才没炸过，别赌运气。
- **改名必须四层一起走**：DB name、场景名、相机名、磁盘目录 + DB 里 still_path/thumb_path（带旧目录名的绝对路径）——漏任何一层都是脏数据。
- **FLIP 测量不能用 getBoundingClientRect**：它含 transform——上一轮未播完的 invert（后台标签页 rAF 冻结时必然残留）或进行中的 transition 都会被当成"旧位置"捕获，算出 bogus 位移再叠新 transform，连环污染、越翻越离谱（用户看到"拖任何镜头多图都滑一下"/"卡片飞回顶部"）。测量布局一律用 `offsetLeft/offsetTop`（纯布局值，transform 免疫），v0.8.1 已根治。
- **`importlib.reload` 热修补 queue 层免重启**：`is_dirty=True` 不能重启 Blender 时的手段——reload 原地刷新模块命名空间，bpy.app.timers 里旧回调函数经 `__globals__` 读到新 COMMANDS/新队列，服务端线程同理；`_recent_errors` 历史会清零（可接受）。仅限纯逻辑模块，带线程的 server.py 别这么玩（僵尸线程坑）。
- **webbridge tabId 会因页面重建失效**：浏览器标签页重开/崩溃换新 target 后，旧 tabId 仍能对"僵尸快照"读值（甚至读到看似 live 的 DOM），但 dispatchEvent/点击全部无效也不报错——排查先 `list_tabs` 拿当前 tabId（v0.8.0 实测旧 tabId 耗了一小时）。症状识别：自建监听器+同节点 dispatchEvent 都不触发 = tabId 已死。
- **webbridge evaluate 能读 `window.__sb` 但 dispatchEvent 不触发监听器**：v0.8.0 实测 evaluate 跑在页面主世界（读得到 main.js 挂的 window.__sb、调编排函数全正常），但 `new MouseEvent('dblclick')`/`new Event()` 分发后连当次 evaluate 自挂的同节点监听器都不 fire（机制未查明，疑似扩展更新后的行为变化）。交互测试改用：`__sb` 直接驱动 + webbridge 原生 `click`/`mouse_click` 动作，别再用 evaluate 合成事件。
- **`bpy.ops.x()` 从 MCP/脚本调用走 EXEC 不走 invoke**：operator 的 invoke 负责解析参数（场景→shot→帧号）时，裸 `bpy.ops.x()` 会带着空属性直接进 execute——sqlite `connect(空路径shots.db)` 还会顺手在 CWD/项目根造出 0 字节野库且文件句柄锁到进程退出（"Device or resource busy"删不掉，重启 Blender 才能删）。解法：execute 里做属性空值兜底重解析（v0.8.0 snap_frame 的 `_resolve` 模式）；显式 `'INVOKE_DEFAULT'` 在 MCP 里会因 `Missing 'window' in context` 被拒（invoke_confirm 需要真窗口），面板按钮点击不受影响。
- **MCP 直调含 bpy.data 写的链路不稳定**：`bpy.ops.storyboard.snap_frame()` 直调 `cmd_render_frame` 时随机炸 `Writing to ID classes in this context is not allowed`（线程上下文限制，同一代码时好时坏）。凡是写场景的测试，一律走 `queue_command(...)` 主线程 timer 队列，UI 按钮（天然主线程）无此问题。
- **WebBridge navigate 到相同 URL 不重载页面**（v0.8.3 实测）：复用标签页 `navigate` 到 http://127.0.0.1:8089 时可能是 no-op——页面保持旧 JS/旧 DOM 状态，之后所有测试"跑在旧代码上"，改代码后验证假通过/假失败。强制刷新必须 `cdp Network.clearBrowserCache` + `cdp Page.reload {ignoreCache:true}`，再用 DOM 标记（如 body.dataset 探针）确认重载了。
- **多图封面测试前必须先确认封面基准**（v0.8.3 实测翻车）：用户可随时右键改封面（f0→f00053），扫视/封面类测试的"初始图应该是什么"判断前，先读 cover img 的 `data-frame-id` 确认当前封面是哪帧——拿旧基准判断会得出"没恢复/显示错"的假 FAIL（曾因此误判宫格恢复逻辑坏了）。
- **WebBridge daemon 长跑会丢事件**（v0.8.3 实测）：运行 11 小时后 CDP `Input.dispatchMouseEvent` 移动事件开始丢失（扫视不触发）、evaluate 偶发空响应、screenshot 超时——表现为"测试结果随机"。先查 `/status`，`kimi-webbridge.exe restart` 恢复（Edge 不杀，扩展自动重连；session 需 find_tab/navigate 重建）。
- **验证主世界鼠标事件用 DOM 副作用判据**：evaluate 里 addEventListener 计数收不到 CDP 事件（跨世界），计数器为 0 不代表事件没发生；判断扫视/恢复是否执行，读主世界 DOM 状态（img.src、dataset.frameId/hoverOrigSrc 变化）为准。
- **FLIP 起点必须被浏览器真实渲染一帧再清空**（v0.9.1 批量展开静默无动画的根因）：`expandAnimated` 的"设起点 transform → `void grid.offsetWidth` reflow → 清 transform + 设 transition"在单独展开时正常，但**批量/连续调用时第二个镜头静默无动画**——后面的 renderGrid() 重建 DOM 后新元素已以自然位置渲染过（前一个镜头的动画播放推动浏览器持续渲染），随后同任务内"设起点→reflow→清空"对比的上一渲染帧是自然位置 → 从 none 到 none 无过渡。修复：清 transform + 设 transition 包进 `requestAnimationFrame`（起点渲染一帧后再清空）。**排查特征：inline transform 设置了但 computed 全程 none；同步采样起点 matrix 有值、后续帧全是 none**。教训：reflow（offsetWidth 强制）不算渲染，CSS transition 起点 = 上一渲染帧而非上次样式计算。
- **FLIP 动画期间禁止用 getBoundingClientRect 做定位测量**（v0.9.2 视图切换定位偏差的根因）：`.shot-card` 有 `transition: transform 0.28s`，renderGrid 的 FLIP 播放期间 getBoundingClientRect 含 transform 偏移——切换后立即 scrollIntoView 会偏 765px+。解法：scrollIntoView 按布局位置（内部用 offset 系）不受 transform 影响可立即执行；但**手动 getBoundingClientRect 算滚动目标必须等 FLIP 结束或改用 offsetLeft/offsetTop**。
- **批量循环内动画目标必须按 id 精确选择**（v0.9.2 列表批量动画错乱的根因）：`grid.querySelector('.list-frames')` 只取第一个 panel，批量展开/折叠时第二个镜头动画作用到第一个的 panel（静默无动画）。改 `.shot-card.list-item[data-id="xxx"] .list-frames`。同类问题：宫格版 expandAnimated 的 cells 已按 shotId 选（_frameCells），列表版此前漏了。

- **renderGrid 删 innerHTML='' 后 empty-state 残留**（v0.9.3 实测回归）：`.empty-state`（初始 "Loading shots..."）不是 `.shot-card`，不参与差分重建，以前靠 `grid.innerHTML=''` 全清被带走；删掉后必须显式 `grid.querySelector('.empty-state').remove()`（shots>0 分支），否则占位提示永远挂在宫格左上角/列表第一行。
- **`grid.innerHTML=''` 会同步把 scrollY clamp 到 0**（v0.9.3 滚动跳顶第一层根因）：清空滚动内容瞬间浏览器同步 clamp（即使同一任务内立即重建也不恢复）。renderGrid 禁止全量清空。
- **Chrome scroll anchoring 会让差分重建跳顶**（v0.9.3 第二层根因）：差分移除视口内锚点节点（被展开的折叠卡）时滚动位置被重置。CSS 已加 `html, body { overflow-anchor: none }`（视觉稳定由 FLIP 自己管）。
- **fragment 差分必经 grid 空中间态**（v0.9.3 第三层根因）：复用节点移入 fragment 再挂回，任务内 grid 短暂变空（高度≈header），浏览器渲染帧把 scrollY clamp 掉（实测 3497→674）。解法：renderGrid 任务内 `savedScrollY` 开头保存、末尾不等才 `scrollTo` 恢复。
- **scrollIntoView 的滚动是渲染帧才提交的**（v0.9.3 搜索定位坑）：先 scrollIntoView 再 renderGrid，后者保存/恢复的 scrollY 会把未提交的滚动覆盖回原值（页面纹丝不动）。解法：先改状态+renderGrid，再 scrollIntoView。
- **focusFrame 的 class 是手动管理的，差分不重算**（v0.9.3 帧蓝框残留坑）：只清 `state.focusedFrameId` 不清 DOM 的 `.frame-focused` 会残留蓝框（复用帧格不重建 class）。清帧焦点一律用 `focusFrame(shotId, null)`（状态+DOM 一起清，宫格 frame-img / 列表 frame-thumb 都覆盖）。
- **键盘全局快捷键必须跳过输入框聚焦**（v0.9.3 搜索框坑）：document keydown 监听在搜索框聚焦时也会触发——Delete 删镜头/空格展开/Tab 切视图都是误操作。keyboard.js 顶部加 `INPUT/TEXTAREA` 门控（editingId/createModal 门控之后）。
- **webbridge ev() 对 undefined 返回值会重试**（v0.9.3 探针污染坑）：调 void 函数（renderGrid 等）返回值 undefined → ev() 自动重试 4 次 = 函数被反复调用，探针数据全污染。驱动 void 函数用一次性 evaluate（不重试），读状态用 ev()。
- **CDP 修饰键模拟不可靠**（v0.9.3 测试限制）：`Input.dispatchMouseEvent` 带 modifiers:2 的 Ctrl+click 在页面里 e.ctrlKey 不一定为 true（实测 selected 不 +1）；多选链路测试用 Ctrl+A 或 Shift+方向键代替，功能本身用真实浏览器验证过。
- **Python 偶发 `SystemError: Negative size passed to PyUnicode_New`**（v0.9.3 踩到 2 次）：特定文件内容触发 CPython 3.11 解析崩溃（write_file lint 和 python 运行都崩，文件本身字节正常）。规避：文件重写为纯 ASCII（中文注释去掉）即恢复。
- **测试脚本收尾不彻底会污染现场**（v0.9.3 教训）：展开态/选中/帧焦点没还原就结束，下一个测试开场就"找不到卡片/状态不对"。WebBridge 测试脚本开头一律重置 `expandedShotIds/selectedIds/focusedFrameId` + renderGrid。
- **MCP execute_code 里写中文路径极易转义错**（第五轮实测）：`N:\\Projects\\...` 反斜杠/unicode 双转义（`\u8bf7` 变字面量或 `N:\\` 双反斜杠）→ sqlite "unable to open database file" 假象。测试一律用 `bpy.data.filepath` 推导 project_dir（`os.path.join(dirname, basename_noext + "_storyboard")`），零转义。
- **MCP 偶发卡死**（第五轮实测）：连续 execute_code 大命令（init_db/reload 组合）会卡 handler（空响应），分步小命令可恢复；查 queue 状态用 `q._command_queue.qsize()` 别用 `len(bpy.app.timers)`（timers 是模块不是列表，len 报错）。
- **多图多展开并存 = 底衬断层**（v0.9.4 修）：buildExpandedCards 的 rowStart 用数组索引 % cols，不含前面已展开镜头多占的格位（每个展开镜头占 frames.length 格）→ 行分段算错 → 同镜头帧格间 12px 断层（圆角/负 margin 错位）；renderGrid 差分复用只 toggle 'selected' 不重算 frame-first/frame-row-last → 已展开镜头被其它镜头展开挤换行后底衬不跟随。修复：rowStart 加 extra（前面已展开多图镜头 (帧数-1) 求和）+ 复用分支同步行首/行尾 class。验证：gaps 恒 0（1px 亚像素取整噪声除外）。
- **renderGrid 整体重设 grid.className 会冲掉其它模块 class**（v0.9.4）：`grid.className = isList ? 'grid list-mode' : 'grid'` 把预览框的 preview-on/preview-right/preview-left 全抹掉（展开多图 renderGrid 后预览布局丢、列数回全宽）。凡多模块共享的元素 class 一律 classList 增量维护。
- **main.js 给 window.__sb 挂新函数必须同步 import**（v0.9.4 整页崩）：漏 import 直接顶层 ReferenceError → 整个 ES module 链失败（__sb 消失、卡片 0、页面空白，硬刷新也没用）。排查：先查 `!!window.__sb`。
- **预览框无缝公式**（v0.9.4）：grid margin = var(--preview-w)（预览框宽）才无缝；body padding 16 推导易错（首版 50vw-32 重叠 16px）。间距对称 = margin 再加 16px。测量：贴右看 panelLeft-gridRight、**贴左看 panelRight-gridLeft**（用错边误判 gap=-1381 假 FAIL）。
- **列表缩略图宽度必须乘 --list-scale**（v0.9.4）：.thumb-wrap/.shot-thumb 固定 var(--list-thumb-w)（80px）在预览开启时溢出列宽（40px）盖住镜头名。列表列模板的所有固定 px 列 + 缩略图元素宽度都要 calc(×scale)。
- **marquee 框选排除列表必须覆盖展示型浮层**（v0.9.4）：预览框/快捷键面板内点击会触发 document mousedown 框选 → mouseup 清空选中（点预览框的 flip 按钮把选中清了）。排除列表加 .preview-panel/.shortcuts-panel。
- **预览开关顺序坑**（v0.9.4）：先 applyLayout（grid 变窄）再 __zoomApply（用新宽度重算 --card-min）；反了 apply 用旧全宽算 → 卡片不缩放。列表 --list-scale 的 wFull 基准必须在 applyLayout 前记录（否则拿到窄宽 scale≈1）。关预览保存/恢复 --card-min 防列数漂移（zoom cols 状态被窄宽 clamp 后不还原）。
- **setPreviewW 实时缩放用 __zoomApply 自带锚定**（v0.9.4）：拖拽调宽每帧调 apply → anchor/restore 自动保持选中卡在视口位置；拖拽 mousemove 用 rAF 节流（一帧一次防 reflow 风暴）。
- **still 双轨 jpg/png**（v0.9.4）：拍屏改 still.jpg 后，老数据 still.png 仍在——前端 stillUrl 推 jpg、onerror 兜底 png；duplicate 帧文件推导 jpg 优先 png 兜底（candidates 列表）；audit 断言已改 jpg。改后端（render.py 等 Python 代码）必须重启 Blender 才生效，重启前新断言会失败（旧代码仍拍 png）。
- **预览图同尺寸**（v0.9.4）：.preview-body img 固定 100%×100% + object-fit contain——小图(320px)放大到大图同尺寸显示，切换只有模糊→清晰区别；若用 max-width/max-height 自然尺寸，小图 320px vs 大图 698px 切换尺寸跳变。
- **展开帧格高度**（v0.9.4）：frame-first 伸出 12px → aspect-ratio 16/9 的图更高（210 vs 203）→ 跨行行高不一致；统一 .frame-img 高度 calc(var(--card-min)×9/16) + object-fit cover；shot-info 无名字帧 min-height 46px 补齐。
- **折叠按钮定位**（v0.9.4）：卡片 padding 9px 导致 left:0 悬在图外 9px；垂直相对卡片居中 vs 相对图居中差 23px（= padding 9 - info 半高 32，与列宽无关恒成立）——贴图右缘用 right:9px + top:calc(50% - 23px)。
- **画幅比功能的"基准比例"假设**（v0.9.7）：已有帧图以 16:9 为基准（用户拍板）——宽比裁上下（cover）、高比上下留空（contain）；但**改比例后新拍的帧已经是新比例**（拍屏跟 scene resolution 走），contain 下新帧会四周留空——混合比例镜头集的显示是近似适配，真要多比例共存需给帧存原始比例元数据（未做）。
- **宫格单图镜头的 .shot-thumb 是卡片的裸直接子级，不在 .thumb-wrap 里**（v0.9.7 实测）：`.thumb-wrap` 是列表视图的结构——给它写的 object-fit/样式规则对宫格单图不生效。覆盖规则要带 `.shot-card:not(.list-item):not(.frame-cell) > .shot-thumb`；v0.9.7 首版漏了这条，高比 contain 对宫格单图静默失效（fit 仍 cover），PIL 采样没采到留空条才暴露。
- **多条台词 strip 共享同一宽度值，mouseup 持久化别 querySelector 第一条**（v0.9.8 实测）：拖某条的手柄改宽后，`document.querySelector('.dialogue-strip .dialogue-box')` 拿到的是 DOM 里**第一条**（别的镜头没拖的条，还是旧宽）→ 把拖出来的宽度覆盖回旧值、localStorage 存错。修复：onUp 闭包里用**被拖的那个 box 引用**（`box.isConnected ? box.getBoundingClientRect().width : dlgWidth`）。
- **audit 中断会让 queue 积压 → timer 假死 → 重跑 audit 在 duplicate 类用例崩**（v0.9.8 实测两次）：audit 中途 Ctrl+C/异常退出时，已入队的命令（create/duplicate 等）滞留在 `_command_queue` 不被消费（QSIZE 恒定、5s 不动），重跑 audit 时 duplicate 命令排队不执行 → `AUDIT_WEB_COPY` 找不到 StopIteration / 撞名 409。判别：MCP 查 `core.queue._command_queue.qsize()` 长期 >0 即实锤。处置：taskkill 重启 Blender（队列清空）再跑 audit——**不是 audit 脚本 bug，别对着改脚本**。
- **台词框左偏移别用 16+offsetLeft**（v0.9.8 用户发现）：card.offsetLeft 相对 offsetParent（grid 有 will-change:transform 是 offsetParent，但别的容器下语义会变），加 body padding 16 是错的（grid 内容区左缘 = body padding 后，strip 的 marginLeft 相对 grid 内容区，再 +16 就右偏）。正确 = `Math.round(card.getBoundingClientRect().left - grid.getBoundingClientRect().left)`（视口坐标差，滚动时同滚，任何 offsetParent 都成立）。
- **测试/还原台词数据别写死值**（v0.9.8 事故）：还原时用备份的精确原值（`backup[sid]`），别用"当前第一条 strip 的 id + 写死的另一个镜头台词"——会覆盖别的镜头（本次把用户加的 c0130 台词误覆盖成 c0020 的，靠测试输出里残留的原值救回）。页面数据可能有用户手工加的测试台词（c0250/c0330/c0120），清理时只动自己建的。
- **node --check 是 CommonJS 模式，测不出 ESM 语法错误**（v0.9.9 白屏事故）：`forEach((shot, si) => {` 缺 `)` 时 node --check 显示通过、浏览器 ESM 解析直接 SyntaxError → 整页白屏（__sb undefined、cards 0、performance 显示 19 个 JS 全传输、window error 监听也捕获不到 module 编译错）。**改 JS 后必须 `node --input-type=module --check < file`**（stdin 按 ESM 解析报行号）；白屏诊断链：动态 import('/js/main.js').catch 拿错误 → 逐个 import 模块定位（级联 FAIL 只查第一个）
- **台词条父条 auto-placement 自锁 + box 全局对账**（v0.9.9 实测）：①缩放后旧父条未归位占旧行 → 卡片排布被挤乱 → row.last 算错 → 父条插错位置每轮自锁（**症状：reload 首帧永远对、一缩放就错且持续**）——updateDialogue 开头先把现有父条移到 grid 末尾（布局净化）再分组；②同排多 box 不能 inline-block+margin-left（流式累加溢出换行，父条高 = 2×box 高实锤）——必须 absolute + 父条 relative + 高度 JS 显式设；③box 多余判断必须全局化（先归位后删除，per-strip 判断 4 列缩放时除首排外全清空）
- **右键菜单测试：CDP 真右键会派生 click 把菜单立即隐藏**（v0.9.11 实测）——右键测试 = 合成事件弹菜单（mousedown/mouseup button=2）+ CDP 真左键点菜单项；reload 恢复滚动位置会让台词框 rect.top 为负 → 菜单定位视口外（先 window.scrollTo(0,0)）；台词框右键 = rDown.dlgBox 单独分支（台词框不在卡片内，closest('.shot-card') 为 null）
- **localStorage 也是用户数据**（v0.9.12 事故）：用户拖宽自定义值存 sb-dialogue-w-map，测试后 removeItem 全清——测试动 localStorage 前必须备份、还原精确写回；**commit 断言时机**：异步 POST + 心跳 0.8s，Enter 后等 2.5s+ 再断言（1.2s 内断言假 FAIL）
- **"添加台词"临时编辑框定位**（v0.9.12 用户追问驱动）：absolute 无 left/top 的静态位置落在卡片内部左上角（盖卡片内容）——该排已有父条 → 进父条并排；无父条 → 显式 left=card.offsetLeft、top=排尾卡片.offsetTop+offsetHeight+rowGap（读 getComputedStyle(grid).rowGap 兜底 12）
- **审计轮询化四坑**（v0.9.14 续，2026-08-07 实测）：audit.py 固定 sleep → wait_ok 轮询（完成即继续）后：①queue 命令分步执行（DB 先写场景后动）→ 轮询条件满足瞬间可能命中命令执行中途 → 假 FAIL（Soft delete scene parked=False）——wait_until 条件 True 后必须 0.3s 稳定确认再返回；②轮询间隔 0.25s，别用 50ms——高频 GET /api/shots 与 rename_seq 的 SQLite 连续写抢锁，拖到 60s 超时都不够；③rename_seq 两阶段（先全改 __ren_ 临时名再统一转正式名）超时给 60s（3 镜头×2 阶段×SMB 余量），20s 必炸；④cleanup 清理条件必须含 __ren 前缀（rename_seq 失败残留 __ren_xxx 不含 AUDIT 也不以 c 开头 → 漏网逐轮累积恶性循环）
- **正名幽灵场景破坏 rename_seq**（v0.9.14 实测 3 轮 FAIL 元凶）：场景里有 Shot_c0970-c1000（DB 无记录，sync 遗留），rename_seq 阶段 2 生成编号 c0970+ 撞场景名冲突 → 改名抛错卡 __ren_ 临时名（部分转正部分卡住，位置随机）。__ghost_ 前缀不干扰改名。处置：MCP batch_remove 删正名幽灵必须 use_global_undo=False（否则 1.2GB 撤销快照卡死假死——进程活着端口监听但 MCP 拒绝/HTTP 空响应，重启才恢复）+ **删完存盘**（purge/删除场景不存盘，重启后场景复活继续撞名）
- **Blender 4.5 删场景 API 变化（v0.9.16 实测，坑 257 方法已失效）**：`bpy.data.batch_remove(ids=..., use_global_undo=False)` 和 `bpy.data.scenes.remove(sc, use_global_undo=False)` 都报 TypeError（签名 batch_remove(ids) / remove(scene, do_unlink)）；**无参数 remove 触发全局撤销快照（1.2GB 文件卡死数分钟 → 崩溃弹窗 C 档：进程活着+端口监听+MCP/HTTP 全拒）**；`preferences.edit.use_global_undo=False` 临时关撤销后 remove 依然卡死崩溃（实测）。**正确处置 = 场景改名 `__ghost_` 前缀**（`sc.name = new` 轻量秒完成，MCP 线程稳定）：正名幽灵改名后 rename_seq 不再撞名，AUDIT/CTX 残留改名后不干扰 audit 创建（同名场景会 .001）；**改完必须存盘**（timer 包装 save_mainfile + 日志文件验证，防重启复活）。排查链：rename_seq 超时 → MCP 列场景 vs DB scene_name 差集查 orphans → 正名幽灵即元凶（本次 c0060/c0110 漏网教训：删幽灵要按差集全查，别只删已知编号）。另：MCP 传复杂代码用文件方式 `exec(open(path, encoding='utf-8').read())` 避免转义坑
- **Blender 面板不自动重绘，改 DB 后必须 redraw_view3d + 先失效面板读缓存**（v0.9.34）：面板 draw 现读 DB 但无 tag_redraw 就不重绘（帧按钮 hover 才刷新事故）；修 = core/queue.py redraw_view3d()（panel_db_cache["ts"]=0 + 遍历 VIEW_3D area tag_redraw，缓存对象移 queue.py 跨模块共享）+ 同步 operator 尾部调用 + process_queue 成功路径统一调；验证 = MCP timer 拍帧后 cache key/ts 变化（无鼠标环境重绘只能来自 tag_redraw）（坑 258）
- **cmd_delete_frame 删帧残留 fNNNNN_still.jpg**（v0.9.34）：删文件还按旧格式 replace _still.png（v0.9.4 JPG 化后永不删）；修 = 三候选全删（thumb.jpg + still.jpg + still.png 兼容）；验证删帧后目录 fNNNNN_* 全空（坑 259）
- **预览窗口 cover 裁左右**（v0.9.34 用户拍板标准：只能裁上下不能裁左右）：.preview-body img 100%×100% 填满竖的预览区域（0.79）→ 16:9 图 cover 裁左右；修 = 预览 img 容器 aspect-ratio 跟随画幅（max-w/max-h 100% + auto）与缩略图同构；两处显示规则一致必须核对容器形状不能只看 fit 判定（坑 256）
- **台词条手柄 [data-tip]::after 同特异性合并三坑**（v0.9.34）：left:50% 废 right / bottom:calc(100%+8px) / padding+border 撑大盒子（14→32px）——显式 left/bottom/padding/border 四条全清；伪元素几何验证用 outline 注入法（computed 伪元素值不可信）（坑 249/250）

## 细节指针

- 架构：Blender 插件 + 内嵌 HTTP（0.0.0.0:8089）+ `bpy.app.timers` 主线程队列
- 后端模块地图：`core/server.py`（ROUTES 表 + 静态服务）→ `core/actions.py`（每端点一函数）→ `core/queue.py`（COMMANDS 注册表 + 错误回传）/ `core/db.py`（含 next_c_name/next_c_number，软删字段 deleted/content/dialogue）/ `core/undo.py`（撤销栈）/ `core/paths.py`（目录）/ `core/scenes.py`（场景工厂）/ `core/sync.py`（同步唯一实现）/ `core/render.py`（拍屏公共函数）
- 前端模块地图（20 个 JS）：`web/index.html`（骨架+CSS）+ `web/js/`：state（共享状态）/ ui（toast+确认条）/ render（宫格+列表+FLIP+DOM差分+首屏门控）/ data（拉取+心跳+错误toast+undoLast）/ selection / dnd（卡片拖拽+拖图分区）/ rename（改名+字段就地编辑）/ menu（右键/中键滑动+回弹+菜单）/ create（弹框）/ marquee（框选）/ zoom（滑块+Ctrl滚轮连续缩放）/ keyboard（快捷键+方向键）/ trash（垃圾桶弹窗）/ search（搜索栏定位）/ preview（预览框：开关/贴边/调宽/详情）/ shortcuts（快捷键面板）/ aspect（画幅比：applyAspect 注入 + 对话框）/ timeline（时间线视图：顶部预览+横向时间线+台词轨道+字幕，v0.9.36）/ main（入口接线）
- 改名：`cmd_rename_shot`（queue.py）四层联动实现
- 测试：改完跑 `python3 scripts/audit.py`（42 项，含 v0.2-v0.5 全部端点+垃圾桶/撤销链+多图保帧/rename 四层/时长对齐）+ `python3 scripts/audit_context_menu.py`（12 项：打开/重拍封面/复制/软删+purge）；网页 JS 改动另需 webbridge 全交互回归
- 152. **rename_seq 撞 Blender scene 名而非 DB 名**：candidate 生成只查 DB name_exists，scene 层撞名查不到（幽灵场景 DB 无记录）→ `Scene Shot_cXXX0 already exists` → phase 2 卡死镜头停 `__ren_` 临时名 → audit 超时。清理：孤儿场景改名 `__ghost_` 前缀 + 存盘
- 153. **MCP timer 回调 print 不回传**（只含 REGISTERED）；`print(chr(1).join(...))` 尾随 \n 让 split 最后一项带换行 → 场景名比对误判幽灵——strip 后再比
