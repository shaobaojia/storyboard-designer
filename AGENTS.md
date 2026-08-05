# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**

## 刚做完（v0.9.3 攒批中：搜索栏 / Tab 切视图 / 列表 12 级缩放 / 滚动三层修复 / 搜索帧焦点修复 / audit 41+12 项，Kimi 执行，audit 41/41 + 右键 12/12 + WebBridge 全回归）

1. **搜索栏**（search.js 新模块）：header 内嵌输入框，匹配镜头名/内容/台词（名称优先），200ms 防抖下拉最多 12 条（带类型徽标+摘要），点击/Enter 定位（滚动居中+单选蓝框+清空收起），Esc/点外部收起，宫格/列表通用；keyboard.js 加输入框聚焦门控（防 Delete/空格/Tab 误触发）
2. **Tab 键切换视图**（keyboard.js）：与 #viewToggle 同效，垃圾桶模式也生效；编辑态/弹窗/输入框聚焦时不触发
3. **列表 Ctrl+滚轮全程 12 级**（zoom.js）：步距=(maxW-40)/12 按档位序号对齐（40px→maxW 恰好 12 下），抽 listMaxW() 共用公式
4. **展开/折叠滚动跳顶三层修复**（render.js + style.css）：删 `grid.innerHTML=''`（同步 clamp scrollY）+ `overflow-anchor:none`（scroll anchoring 重置）+ renderGrid `savedScrollY` 任务内恢复（fragment 空中间态渲染帧 clamp）——三场景（顶/中/底）scrollY 全稳定
5. **empty-state 残留修复**（render.js）：删 innerHTML 后显式移除 `.empty-state`（宫格左上角/列表第一行不再挂 "Loading shots..."）
6. **搜索定位帧蓝框残留修复**（search.js）：locate 用 `focusFrame(shotId, null)` 清状态+DOM class
7. **audit 扩展**：audit.py 38→41（create 时长对齐 / duplicate 多图保帧 / rename 四层含目录+bg 重指），清死代码+过时文案；audit_context_menu.py 8/10→12/12（适配 v0.8.4 重拍封面语义+软删保留目录+purge 清目录+防占名 409）

**历史轮次**（详情曾在本文件，已压缩；关键决策见「交互/设计约定」与「坑」）：
- v0.9.2 十一轮：多选右键菜单统一 / 方向键帧格级移动 / 列表子帧单焦点 / 批量动画修复（按 id 精确选 target）/ 切视图定位+中心扩散 FLIP
- v0.9.1 十轮：拍当前帧去确认直盖 / 多选批量展开折叠 / 展开态拖拽 / 面板帧导航 step_frame / 创建对齐网页端规则
- v0.8.4 九轮（用户拍板）：删 RenderShot/RenderAll（大工程必崩随删解决）/ 统一 frames 模型（单图=1帧）/ duplicate 保帧 / API rerender=重拍封面帧 / 菜单「重拍封面」
- v0.8.3 八轮：帧格间距固定 9px / 列表封面角标 / 悬停扫视恢复 restoreCover / 列表折叠态显示封面帧图
- 第七轮：面板删除必崩修复（走 cmd_delete_shot）/ 删除确认策略（软删不确认，purge 才确认）/ Delete 帧级删帧
- 第六轮：右键菜单三修（折叠态帧级误弹/「展开」项/列表 frame-thumb 帧级）/ CSS 孤儿块吞规则排查法 / 列表缩放动态上限公式
- 第五轮：帧级实时刷新（frames.ver 双轨版本戳，封面=帧ver+thumb_ver，非封面只帧ver）
- v0.8.0：连片底衬 margin-right:-12px / 展开折叠弹簧动效 / 面板帧号列表+拍当前帧 / __sb 调试句柄
- v0.7.0：多图镜头（frames 数据层 / 4 queue 命令 / 一叠牌折叠态 / 展开态 N 格连片 / 帧级右键菜单 / 红格子 / 双击空格=展开）
- v0.4.0：纯重构（前端 13 ES modules / 后端 ROUTES 表 / 多实例端口顺延 / instances.json / audit 21 项）
- v0.3.0：拖图建镜头 / 相机背景图 alpha=1.0 / 列表视图+FLIP / 批量重命名两阶段 / Ctrl+滚轮缩放 / 键盘 / header sticky
- v0.2.0：网页大改版（删除 type 字段 / 创建弹框 c0010 编号 / 拖图 / 自动拍屏 / 心跳 / 滑块 / 框选批量 / 右键惯性拖动）
- 第四轮~第二轮：骨架屏揭幕 / thumb_ver 门控 / 垃圾桶模式 / 橡皮筋过冲 / 软删+撤销栈（见「撤销栈设计」）/ 方向键跳格 / DOM 差分渲染 / FLIP 双根因（offset 系测量+复合键）/ 焦点框跟手 / 帧格禁拖 / queue falsy 缺参误杀

## 正在做

- v0.9.3 已推 GitHub（搜索栏 / Tab 切视图 / 列表 12 级缩放 / 滚动三层修复 / 帧焦点修复 / audit 41+12）
- 幽灵场景累计 12 个 `__ghost_*`（第五轮 5 个 + 第七轮 7 个：c0050/c0100/c0230/c0340/c0480/c0560/c0970 等）待用户确认是否彻底删除（含 .blend 存盘防复活）；**反复出现说明 sync 自动对账（稳健性待办 7）值得优先做**
- 测试现场：测试镜头均已清理（AUDIT/CTX 残留已 purge）；c0410 曾测试删帧 70/96，如需恢复面板 snap_frame 重拍即可

## 下一步

- 用户前台验收 v0.9.3（搜索栏 / Tab 切视图 / 12 级缩放 / 滚动稳定）；确认后推送 GitHub（更新本文件四字段）
- 幽灵场景确认删除 → sync 自动对账（稳健性待办 7）优先级可提前
- **稳健性待办（v0.6.3 对抗审计产出，用户已阅，优先级低暂缓）**，按性价比排序：
  1. **拍屏副作用还原**：`render_shot_files` 改完 `scene.render.filepath/file_format/engine` 不还原，污染用户正式渲染设置（最阴险，建议最先修）
  2. **主线程预算**：`process_queue` 一次排空全队列，批量重渲染 = UI 冻结整场渲染；改每 tick 1 个重命令
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
- 新镜头 f0 输出 `f00000_still.png/f00000_thumb.jpg`（不是 still.png/thumb.jpg）；老镜头迁移后 f0 指 thumb.jpg（legacy 兜底）
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

## 细节指针

- 架构：Blender 插件 + 内嵌 HTTP（0.0.0.0:8089）+ `bpy.app.timers` 主线程队列
- 后端模块地图：`core/server.py`（ROUTES 表 + 静态服务）→ `core/actions.py`（每端点一函数）→ `core/queue.py`（COMMANDS 注册表 + 错误回传）/ `core/db.py`（含 next_c_name/next_c_number，软删字段 deleted/content/dialogue）/ `core/undo.py`（撤销栈）/ `core/paths.py`（目录）/ `core/scenes.py`（场景工厂）/ `core/sync.py`（同步唯一实现）/ `core/render.py`（拍屏公共函数）
- 前端模块地图：`web/index.html`（骨架+CSS）+ `web/js/`：state（共享状态）/ ui（toast+确认条）/ render（宫格+列表+FLIP+DOM差分+首屏门控）/ data（拉取+心跳+错误toast+undoLast）/ selection / dnd（卡片拖拽+拖图分区）/ rename（改名+字段就地编辑）/ menu（右键/中键滑动+回弹+菜单）/ create（弹框）/ marquee（框选）/ zoom（滑块+Ctrl滚轮连续缩放）/ keyboard（快捷键+方向键）/ trash（垃圾桶弹窗）/ search（搜索栏定位）/ main（入口接线）
- 改名：`cmd_rename_shot`（queue.py）四层联动实现
- 测试：改完跑 `python3 scripts/audit.py`（41 项，含 v0.2-v0.5 全部端点+垃圾桶/撤销链+多图保帧/rename 四层/时长对齐）+ `python3 scripts/audit_context_menu.py`（12 项：打开/重拍封面/复制/软删+purge）；网页 JS 改动另需 webbridge 全交互回归
