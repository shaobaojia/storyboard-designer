# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**

## 接手前必读（环境/前置条件）

- 运行环境：Blender 4.5（公司PC/家PC）
- 依赖服务：BlenderMCP addon（9876端口，打补丁版 0.0.0.0+绕timer）+ storyboard_designer HTTP 服务（8089端口）
- 前置操作：启动 Blender → N面板 BlenderMCP → Connect to Claude → N面板 Storyboard → Start Server
- 项目目录：从 `bpy.data.filepath` 推导（`{blend_dir}/{blend_name}_storyboard/`）

## 这个项目是干什么的

Blender 4.5 分镜设计插件——面板操作 + 内嵌 HTTP 服务 + SQLite 数据层 + 宫格 H5 页面，实现镜头管理、拍屏出图、宫格浏览/拖拽排序、网页遥控 Blender。

## 刚做完

- 完整复制镜头（FULL_COPY，不再共享数据导致大纲视图红色）
- 拍屏改用 OpenGL 视图渲染（「视图渲染图像」），去掉 Workbench 渲染
- 拍屏前强制切换到相机视角（`region_3d.view_perspective='CAMERA'`），拍完恢复——防止透视图直接拍
- 网页端 rerender 前先切到目标场景，避免拍错镜头
- 右键菜单修复（点击事件冒泡到 document 清空了 contextShotId 导致静默失败）
- Delete 操作补充磁盘目录清理
- 双向审计脚本 `scripts/audit.py`（14项）+ 右键菜单专项审计 `scripts/audit_context_menu.py`
- 渲染逻辑抽取公共函数 `core/render.py`，operator 和 queue 共用
- 公司 PC Blender 4.5 部署完成（含 BlenderMCP addon）

## 正在做

- OpenGL 拍屏相机视角切换：已验证 `region_3d.view_perspective='CAMERA'` 可行（`view3d.view_camera()` operator 在 temp_override 里 poll 失败）
- 公司 PC 已部署，待用户实际使用反馈

## 下一步

- 待补充

## 坑（已踩过的雷）

- **热重载僵尸线程**：`del sys.modules` 重载插件后旧 HTTP server 的 `serve_forever` 线程杀不掉，新旧 handler 随机抢请求 → 表现为"代码改了但请求没走新路径"。判断：`threading.enumerate()` 查 serve_forever 数量 >1 就是脏了。解法：重启 Blender。
- **`bpy.ops.render.opengl` 只读真实视口状态**：temp_override 里改 context 对它无效——它读的是你屏幕上实际看到的视口。要切相机视角必须直接改 `space.region_3d.view_perspective`。
- **MCP 线程无 window context**：`bpy.context.window/screen` 为 None，render/opengl 全挂。需要主线程 timer 队列执行（架构⑥的核心模式）。
- **BaseHTTPRequestHandler 的 if/elif 链断裂**：独立 `if` 替代 `elif` 会导致 200 + 404 双响应拼包，JSON 解析报 Extra data。
- **`scene.copy()` 是链接复制**：大纲显示红色，新场景和原场景共享物体数据。用 `bpy.ops.scene.new(type='FULL_COPY')` 才能完全独立。
- **HTML 右键菜单点不动**：document 的 click 监听器 hideContextMenu 先清空 contextShotId，menuAction 才执行——`if(!contextShotId)return` 静默退出，无报错。
- **`region_3d.camera` 在 Blender 4.5 不存在**：设 `view_perspective='CAMERA'` 后相机自动从 `scene.camera` 取，不要手动设 camera 属性。
- **审计脚本测不到浏览器层 JS 问题**：如右键菜单事件冒泡这类纯前端 bug，API 审计全过但用户手动点无效。网页 JS 改动必须硬刷新后人工点一遍。

## 细节指针

- 架构：Blender 插件 + 内嵌 HTTP（0.0.0.0:8089）+ `bpy.app.timers` 主线程队列（见 `core/server.py` + `core/queue.py`）
- 渲染：`core/render.py` 公共函数，operator 和 queue 共用
- 测试：改完跑 `python3 scripts/audit.py`（14项）+ `python3 scripts/audit_context_menu.py`（右键4项）
