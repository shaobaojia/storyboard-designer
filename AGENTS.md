# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**

## 接手前必读（环境/前置条件）

- 运行环境：Blender 4.5（公司PC/家PC）
- 依赖服务：BlenderMCP addon（9876端口，打补丁版 0.0.0.0+绕timer）+ storyboard_designer HTTP 服务（8089端口）
- 前置操作：启动 Blender → N面板 BlenderMCP → Connect to Claude → N面板 Storyboard → Start Server
- 项目目录：从 `bpy.data.filepath` 推导（`{blend_dir}/{blend_name}_storyboard/`）
- 家 PC 崩溃自愈：`blender.exe <file.blend> --python recover.py`，脚本里调 `bpy.ops.blendermcp.start_server()` + `bpy.ops.storyboard.start_server()`，全自动免点按钮

## 这个项目是干什么的

Blender 4.5 分镜设计插件——面板操作 + 内嵌 HTTP 服务 + SQLite 数据层 + 宫格 H5 页面，实现镜头管理、拍屏出图、宫格浏览/拖拽排序、网页遥控 Blender。

## 刚做完（v0.3.0 第二轮 17 条，Kimi 执行，已全量验收）

- **拖图落点分流**：落在卡片=设为该镜头相机背景图（新 queue 命令 `cmd_set_camera_background`，原图存 shot 目录），落空白=新建图片镜头
- **相机背景图 100% 不透明**：所有设背景路径补 `bg.alpha=1.0`
- **版本号改从 DB 内容算**：`SELECT COUNT(*), MAX(updated_at)` 替代 mtime——SMB 网络盘（N:）mtime 粗且有缓存，会漏真实写入；带 0.8s 结果缓存防心跳空转
- **页面标题+H1=blend 文件名**（`/api/project`，从 project_dir 反推）
- **改名输入框拖选不拖卡**：编辑态 `card.draggable=false` + 输入框全事件阻断冒泡，Esc/回车/失焦各自正确收尾
- **右键语义重做**：卡片上按住拖 >6px=惯性滑动（采样 8 点算速度，0.94 衰减）；原地松开=弹镜头菜单；浏览器原生菜单全局 `preventDefault`
- **header sticky**：页面向下滚标题栏不丢
- **卡片拖拽不再误弹图片遮罩**：dragstart 打 `text/x-shot-id` 标记，遮罩只对 `Files` 类型出现
- **批量菜单去掉「取消选择」**，新增**批量重命名**：选区首个镜头尾号取整到 10 起 `c%04d` 步进 10；**两阶段改名**（先全改 `__ren_<id>` 临时名再落正式名）防选区内目标名互占导致场景名冲突
- **批量复制重名修复**：`_next_c_number` 循环外预取、本地递增（v0.2.0 每轮重查 DB 导致同批同名的 bug）
- **Ctrl+滚轮缩放卡片**：`--card-min` ±20（120-480），`preventDefault` 顶掉浏览器缩放；与左下角滑块联动
- **键盘**：Delete=删除（确认条）、回车/双击卡片=打开镜头、Ctrl+A=全选
- **Blender 面板加「打开分镜管理器」按钮**：`storyboard.open_manager` → `webbrowser.open(localhost:8089)`
- **列表视图**：宫格/列表切换（localStorage `sb-view`），列表行与卡片共用选择/拖拽/右键逻辑，排序走 `/api/reorder`；**FLIP 动效**（`captureRects`→render→`animateFrom`，0.28s transition）
- **附带修复**：`HTTPServer`→`ThreadingHTTPServer`（见坑）；改名实测 SH777→c0770/SH006→c0780/RENDER_DEBUG_copy→REN_LIVE 四层联动全对
- 验收方式：webbridge 合成事件全链路 + MCP 双端验证 + curl 直测隔离，17 条全 PASS

## 之前完成（v0.2.0 网页端大改版，已验收）

- **type 字段彻底移除**：schema/API/前后端全删，老库 `ALTER TABLE DROP COLUMN` 自动迁移
- **创建镜头对话框**：页内模态框替代浏览器 prompt 三连；编号规则 `c0010`/`c0020` 步进 10（`/api/next_name` 扫现有 c 名 max+10）
- **资源管理器式改名**：双击镜头名就地编辑，回车/点空白确认、Esc 取消；四层联动（DB name → 场景 `Shot_新名` → 相机 `Cam_新名` → 磁盘目录改名 + still/thumb 路径同步）；重名 409 拒绝；新增 queue 命令 `cmd_rename_shot`
- **拖图创建镜头**：图片文件拖进宫格即创建，原图存 shot 目录 + 设为相机背景图，支持多文件；新端点 `/api/shots/image`（base64 JSON）+ queue 命令 `cmd_create_image_shot_scene`
- **创建后自动拍屏**：所有创建路径（网页新建/复制/图片/面板新建）完成后自动渲染 still+thumb
- **心跳刷新**：`/api/version`（db mtime+记录数）每 1.5s 轮询，变了才全量拉；缩略图 URL 带 `?v=updated_at` 治浏览器缓存；Refresh 按钮强制刷新
- **左下角缩略图滑块**：120-480px，localStorage 持久化
- **右键惯性拖动**：空白区右键拖动滚动页面，松手惯性衰减；全局抑制浏览器右键菜单（卡片除外）
- **框选+批量操作**：空白区左键框选/Ctrl 点选；右键批量菜单（批量复制/批量重渲染/批量删除/取消选择）；选中组整组拖拽排序；新端点 `/api/batch`
- **页内确认条**替代浏览器 confirm（删除操作用）
- 附带修复：`__init__.py` 重复 import、`.shot-type.3d` CSS 数字类名失效（随 type 移除消失）、服务文案 127.0.0.1→0.0.0.0
- 部署目录清理：addons 根目录的旧版残留 `queue.py`/`render.py` 已删（会 shadow stdlib `queue`）
- 验收方式：webbridge 真实浏览器点击 + MCP 双端验证 + 磁盘三层对账，全 PASS

## 正在做

- v0.3.0 已部署家 PC Blender 4.5 并全量验收，待用户实际使用反馈
- 公司 PC 部署的是旧版，如反馈良好需同步部署
- 本地 git 有 v0.2.0+v0.3.0 全部改动未 commit（6 文件），等用户发话再推

## 下一步

- 待补充（问用户）

## 坑（已踩过的雷）

- **单线程 `HTTPServer` 被 keep-alive 连接独占**：浏览器 1.5s 心跳持长连接，单线程服务会黏在这条连接上，其它请求（含 curl）全部排队卡死、接口间歇性无响应。解法：`ThreadingHTTPServer` + `daemon_threads=True`。教训：加心跳轮询前先把服务线程化。
- **批量改名必须两阶段**：目标名被选区内靠后的镜头占用时，`cmd_rename_shot` 的场景名冲突防御会抛错、该条改名静默失败（DB 无 UNIQUE 约束不报错更隐蔽）。解法：先全改 `__ren_<id>` 临时名，再统一落正式名。
- **SMB 盘（N:）mtime 不可靠**：粗粒度+缓存，DB 写了 mtime 不变，不能拿来做版本号；要查内容（COUNT+MAX(updated_at)）。
- **webbridge evaluate 是隔离世界**：与页面共享 DOM 但不共享 JS 状态（window.fetch/页面变量都摸不到）；合成 `DataTransfer`/`File` 走真实拖放链路时 FileReader 永不回调（跨世界），拖图类链路要 API 直测补位；常驻 DOM 元素（如 #contextMenu）判断显隐要查 `display`，查存在性会得到假阳性；测试里 `el.remove()` 会真删常驻元素，收拾残局用 `style.display='none'`。
- **Chrome 后台冻结标签页**：定时器（心跳）和 fetch 全被暂停，页面请求"挂起"、抓包只有发没有回——是浏览器行为不是服务 bug，curl 直测可区分；验收时先把标签页激活。

- **热重载僵尸线程**：`del sys.modules` 重载插件后旧 HTTP server 的 `serve_forever` 线程杀不掉，新旧 handler 随机抢请求 → 表现为"代码改了但请求没走新路径"。判断：`threading.enumerate()` 查 serve_forever 数量 >1 就是脏了。解法：重启 Blender。
- **`bpy.ops.render.opengl` 只读真实视口状态**：temp_override 里改 context 对它无效——它读的是你屏幕上实际看到的视口。要切相机视角必须直接改 `space.region_3d.view_perspective`。
- **MCP 线程无 window context**：`bpy.context.window/screen` 为 None，render/opengl 全挂。需要主线程 timer 队列执行（架构⑥的核心模式）。
- **BaseHTTPRequestHandler 的 if/elif 链断裂**：独立 `if` 替代 `elif` 会导致 200 + 404 双响应拼包，JSON 解析报 Extra data。
- **`scene.copy()` 是链接复制**：大纲显示红色，新场景和原场景共享物体数据。用 `bpy.ops.scene.new(type='FULL_COPY')` 才能完全独立。
- **HTML 右键菜单点不动**：document 的 click 监听器 hideContextMenu 先清空 contextShotId，menuAction 才执行——`if(!contextShotId)return` 静默退出，无报错。
- **`region_3d.camera` 在 Blender 4.5 不存在**：设 `view_perspective='CAMERA'` 后相机自动从 `scene.camera` 取，不要手动设 camera 属性。
- **审计脚本测不到浏览器层 JS 问题**：如右键菜单事件冒泡这类纯前端 bug，API 审计全过但用户手动点无效。网页 JS 改动必须硬刷新后人工点一遍。
- **addons 根目录残留旧模块文件会 shadow 标准库**：插件 `sys.path.insert(0, addon_dir)` 后，根目录散落的 `queue.py` 会顶掉 stdlib `queue`（core/queue.py 的 `import queue` 拿到错的模块）。部署目录只留 `__init__.py`/`core/`/`web/`，靠 sys.modules 里 stdlib 已缓存才没炸过，别赌运气。
- **改名必须四层一起走**：DB name、场景名、相机名、磁盘目录 + DB 里 still_path/thumb_path（带旧目录名的绝对路径）——漏任何一层都是脏数据。

## 细节指针

- 架构：Blender 插件 + 内嵌 HTTP（0.0.0.0:8089）+ `bpy.app.timers` 主线程队列（见 `core/server.py` + `core/queue.py`）
- 渲染：`core/render.py` 公共函数，operator 和 queue 共用
- 改名：`cmd_rename_shot`（queue.py）四层联动实现
- 测试：改完跑 `python3 scripts/audit.py`（14项）+ `python3 scripts/audit_context_menu.py`（右键4项）；v0.2.0/v0.3.0 新端点（image/batch/rename/rename_seq/set_background/reorder/version/project）尚未纳入审计脚本，待补
