# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**

## 多图镜头（v0.7.0 进行中）— 接口契约（前后端唯一权威，先锁后做）

**设计文档**：`多图镜头-前端交互设计说明.md`（用户 2026-08-01 提供）。上限 5 张/镜头。

### 数据层

新增 `frames` 表（就放 shots.db，单文件多表）：

```sql
CREATE TABLE IF NOT EXISTS frames (
    id          TEXT PRIMARY KEY,
    shot_id     TEXT NOT NULL REFERENCES shots(id),
    frame_no    INTEGER NOT NULL,   -- 取景坐标：拍屏时所在的 Blender 帧号。纯技术元数据
    image_path  TEXT,               -- NULL 或文件缺失 → 前端渲染红格子
    is_cover    INTEGER DEFAULT 0,  -- 封面标记，每镜头恰一张为 1
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_frames_shot ON frames(shot_id);
```

- `shots.thumb_path/thumb_ver` 保留 = 封面帧的冗余缓存（折叠态/时间线只读它，不 join frames），拍屏/设封面时同步更新
- 旧库迁移：init_db 时给每个现有 shot 补一条 frames 记录（frame_no=0, image_path=still_path, is_cover=1）

### API 返回结构（`/api/shots` 每个 shot 的形状）

```json
{
  "id": "...", "seq": 10, "name": "c0010", "duration": 2.0,
  "thumb_ver": 3,
  "frames": [
    {"frame_no": 0,  "imageUrl": "/shots/c0010_abc/f0001.jpg?v=3", "isCover": true},
    {"frame_no": 48, "imageUrl": null, "isCover": false}
  ]
}
```

- 单图镜头 = `frames` 长度 1；多图按 `frame_no` 升序
- `imageUrl` 带 `?v=thumb_ver` 版本戳（沿用现有缓存策略）
- 前端不接收独立"张数"字段，以 `frames.length` 为准

### 交互约定（用户 2026-08-01 拍板）

| 操作 | 入口 |
|---|---|
| 展开/折叠 | **双击卡片**（统一，不分单图多图）或 **空格键** |
| 打开镜头（Blender） | **右键菜单「打开镜头」** 或 **回车键** |
| 展开态双击某张图 | 跳回该构图（shot_id + frame_no → 切 Scene + 跳帧） |

### DOM/动画约定（用户拍板）

- N 张图的 DOM 节点**折叠态就渲染**（一叠牌 = N 节点叠放 + transform 错位露边），展开只是位移，不增删节点
- 底衬常驻 DOM，折叠态 opacity:0 脱离布局，展开淡入
- 动画只用 transform + opacity（FLIP 已有：`captureRects → animateFrom`）
- 展开态内新增帧 = 帧级增量 append（卡片不动）；折叠态封面变化 = 走现有差分重建 + img 移植
- 预载：3 屏 eager 策略扩展，把多图镜头的全部帧算进预载量

### 待后端落地清单（对应设计文档第 7 节）

1. frames CRUD + `/api/shots` 嵌套返回
2. 多帧拍屏 queue 命令（shot_id + frame_no → 跳到该帧拍屏落 frames 表）
3. 设封面端点（shot_id + frame_no → 更新 is_cover + 同步 shots.thumb_path/thumb_ver）
4. 跳回构图端点（shot_id + frame_no → 切 Scene + `scene.frame_set(frame_no)`）
5. 删除单帧（frames 行 + 磁盘文件，确认由前端发）



## 接手前必读（环境/前置条件）

- 运行环境：Blender 4.5（公司PC/家PC）
- 依赖服务：BlenderMCP addon（9876端口，打补丁版 0.0.0.0+绕timer）+ storyboard_designer HTTP 服务（8089端口）
- 前置操作：启动 Blender → N面板 BlenderMCP → Connect to Claude → N面板 Storyboard → Start Server
- 项目目录：从 `bpy.data.filepath` 推导（`{blend_dir}/{blend_name}_storyboard/`）
- 家 PC 崩溃自愈：`blender.exe <file.blend> --python recover.py`，脚本里调 `bpy.ops.blendermcp.start_server()` + `bpy.ops.storyboard.start_server()`，全自动免点按钮

## 这个项目是干什么的

Blender 4.5 分镜设计插件——面板操作 + 内嵌 HTTP 服务 + SQLite 数据层 + 宫格 H5 页面，实现镜头管理、拍屏出图、宫格浏览/拖拽排序、网页遥控 Blender。

## 刚做完（v0.7.0 多图镜头，Hermes 执行，真机验收全 PASS）

- **frames 数据层**：`core/db.py` 新增 frames 表（shot_id + frame_no + image_path + is_cover，上限 5 张）+ 旧库自动迁移（每个现有 shot 补 cover frame）
- **4 个 queue 命令**：`cmd_render_frame`（跳帧拍屏落 frames 表，upsert 覆盖同帧重拍）/ `cmd_set_cover_frame`（封面切换 + 同步 shots.thumb_*）/ `cmd_jump_to_frame`（切 Scene + frame_set 跳回构图）/ `cmd_delete_frame`（删帧+磁盘清理+封面自动提升）
- **API 嵌套 frames[]**：`/api/shots` 每个 shot 带 frames 数组（imageUrl 带 `?v=thumb_ver` 版本戳，文件缺失→null→前端红格子）
- **折叠态一叠牌**：N 张图叠放，封面在顶 + 3 层错位露边 + 左上角张数角标；悬停横向扫视（X 坐标映射帧索引，即时切换）
- **展开态 N 格连片**：一个 shot 渲染 N 个帧格，帧格深色背景 #111113 连成一体（相邻格去圆角，首尾格圆角），图面内缩 4%，封面蓝框高亮；底衬方案从独立元素改为帧格连片（独立底衬被图完全遮挡，视觉无效）
- **双击/空格 = 展开/折叠**（统一，不分单图多图），**回车/右键 = 打开镜头**；展开态双击某张图 = 跳回构图（shot_id + frame_no）
- **帧级右键菜单**：设为封面 / 重拍此帧 / 跳回构图 / 删除此张（`contextFrameId` 由右键点击位置带入）
- **红格子**：imageUrl=null 或加载失败 → 深红占位格 + 帧号 + 呼吸脉冲（hover 停）
- **跨行底衬分行**：展开态按当前列数把 N 帧分行，每行一个连片组（isRowHead/isRowTail 圆角控制）
- **预载**：3 屏 eager 天然覆盖多图（折叠态全部帧 eager，展开态全 eager）
- **新建 `web/js/frames.js`**：展开状态管理（expandedShotIds，视图态不写库）+ 悬停扫视 + 跳回构图
- 真机验收：DB 层单测全 PASS + API 形状验证 + WebBridge 全流程（一叠牌/双击展开/帧级右键/设封面/跳构图/删帧）+ Blender 侧双端确认（scene+frame 跳对）

## 之前完成（v0.4.0 纯重构，Kimi 执行，零行为变化，已全量验收）

- **前端拆分**：1182 行单文件 `web/index.html` → HTML 骨架 + 13 个原生 ES modules（`web/js/`：state/ui/render/data/selection/dnd/rename/menu/create/marquee/zoom/keyboard/main），inline onclick 全改事件委托，全局状态收进 `state.js`；`<script type="module" src="/js/main.js">` 入口
- **后端路由表化**：`core/server.py` 的 if/elif 链 → ROUTES 表 + `_match_route`（含 `/api/shot/*` 通配）+ 静态文件目录遍历防护
- **业务逻辑下沉 `core/actions.py`**：每端点一函数返回 `(payload, status)`，handler 只做 HTTP 壳；`core/paths.py`（shot_dir/remove_shot_dirs/get_project_dir）、`core/scenes.py`（create_shot_scene 工厂，相机预设一处管）、`core/sync.py`（sync_scenes_with_db 唯一实现，干掉 sys.modules 扫描和 fallback）
- **queue 注册表 + 错误回传**：COMMANDS name→(fn, required_params) 校验缺参；`_recent_errors` deque(10)，`/api/version` 返回 `{version, errors[]}`，前端心跳对新错误弹 error toast（首次心跳只记水位不轰炸）
- **端口独占绑定**：`_ExclusiveThreadingHTTPServer(allow_reuse_address=False)`——Windows 的 SO_REUSEADDR 允许第二个 Blender 实例静默劫持 8089，双实例时请求随机分流、表现为"服务假死"（见坑）
- **多实例端口顺延**：启动从 8089 起扫描（8089→8090→…最多 20 个），每个 Blender 进程独占一个端口和页面；`instances.json`（插件目录）登记 pid/端口/blend 路径，启动时清死 pid（`OpenProcess`+`GetExitCodeProcess` 判 STILL_ACTIVE，光 OpenProcess 对死进程残留对象会误判活）；面板状态/「打开分镜管理器」用实际端口；audit.py 加 `SB_HTTP_PORT` 环境变量
- **audit.py 扩到 21 项**：新增 next_name/project/version(含 errors)/rename(四层)/duplicate 唯一性/rename_seq/set_background alpha=1.0 用例；清理逻辑改为按快照差集删一切测试产物
- 验收方式：audit.py 21/21 PASS + webbridge 全交互回归（弹框/全选/改名/回车/双击/右键滑动/单多选菜单/Ctrl滚轮/列表拖拽排序/错误 toast）+ MCP 双端验证 + 拖图 API 直测

## 之前完成（v0.3.0 第二轮 17 条，已全量验收）

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

- v0.7.0 多图镜头已部署家PC，真机验收全 PASS，待推 GitHub
- 悬停横向扫视手感需用户在真实浏览器里感受（代码就位，未逐帧验证跟手度）
- 跨行底衬分行逻辑代码就位（当前 6 列 4 帧未跨行，调窄窗口可验证）

## 下一步

- 用户验收悬停扫视手感
- 公司 PC 同步部署 v0.7.0

## 第六轮（v0.6.2）清单

1. **几乎所有操作闪黑**：根因=首屏/新卡的 `.fade-in` 类播完没摘——卡片每次 renderGrid 都要经过 fragment 重排 DOM，而**元素重新插入 DOM 会重播 CSS 动画**，于是任何操作都全场重播入场（opacity 0→1）= 闪黑。修复：首屏揭幕 1400ms 后统一摘类、新卡 animationend 即摘。webbridge 实测：强制刷新后 fade-in=0、25/25 img 节点原位保留
2. **缩放改回段落式**（Eagle/Bridge 手感，v0.6.3 修正判定依据）：档位的依据是**每排镜头数 ±1** 而非绝对像素——卡片宽度由可用宽度反算 `(宽-gap*(N-1))/N`（两位小数），每排永远恰好 N 张、**行尾零空位**（实测 leftover=0.00px）；合法列数区间由反算宽度落在 [120,480] 动态决定；窗口 resize 列数不变宽度重算；滑块左=多列右=少列，Ctrl+滚轮跳列；localStorage 存列数 `sb-cols`（老 px 记录就近换算）。**配套坑**：`body` 必须 `overflow-y:scroll` 滚动条常驻，否则内容加载后滚动条出现、可用宽度缩水，反算宽度立刻失真出行尾半格
3. **骨架屏顶部漏一窄条图片**：根因=`#grid` 的 `margin-top:16px` 穿透 `#gridWrap` 塌陷（margin collapsing），骨架层比真实卡片低 16px。修复：`#gridWrap` 加 `display: flow-root` 建 BFC；骨架底部块加高对齐真实卡片 shot-info
4. **弹簧只许弹一下**：阻尼 0.76→0.70，且第一次过墙（符号翻转）即归零落定，不再 oscillate 两下

## 第五轮（v0.6.1）清单

1. **卡片缩放左对齐**：`.grid justify-content: start`
2. **增减镜头整个闪/改名闪两下**：双根因——已有 id 重建也放 fade-in + 改名时 thumb_path 变触发 thumb_ver 误增白白重载图片。修复：`update_shot` 加 `thumb_fresh` 门控（只有拍屏路径显式传 True 才 bump）；renderGrid 已有卡片**静默重建**（不放 fade-in），img 移植（src 没变直接挪旧 img 节点，变了只给新 img 透明度渐变），只有新 id 才播入场。webbridge 验证：两轮视图强重建 21/21 img 节点原位保留
3. **骨架屏与卡片间半秒黑屏**：根因=数据一到骨架即被 innerHTML 清空，真实卡片却在隐身等图。修复：骨架改独立覆盖层 `#skelLayer`（absolute 盖 `#gridWrap`），真实卡片不隐身，揭幕时骨架淡出 350ms + 卡片波浪入场交叉淡化
4. **图片镜头背景图神秘消失 = 改名断链**（主犯）：`cmd_rename_shot` 改目录但不重指相机背景图绝对路径→原目录改名后 bg 图断链被 Blender 丢弃。修复：rename 步骤 3.5 重指 `bg.image.filepath` 到新目录+reload。共犯=duplicate：FULL_COPY 共享图片数据块，源被 purge 副本图也死——复制时 bg 文件 copy2 到新 shot 目录并 `bpy.data.images.load` 独立数据块
5. **橡皮筋重做=iPhone 跟手物理**：过冲量 `ov` 是唯一状态，拖动/惯性/弹簧都读写它。拖动撞墙方向吃 0.45 阻力累加 ov（全程跟手），回拉方向 1:1 先消过冲再滚动；松手 ov≠0 进欠阻尼弹簧（`ovVel += -ov*0.14*dt; *=0.76^dt`，5→12→10 冲线缓出）；惯性撞墙把 `-vy*0.55` 当初速交棒弹簧；**mousedown 取消动画但保留 ov**，重新按住从当前位置无缝接手；上限 ±160px
- **附带修复（ hang 级）**：`cmd_delete_shot`/面板删除改用 `bpy.data.batch_remove` + 临时关 `use_global_undo`——重场景删除会写整文件撤销快照，1.4GB 文件卡死数分钟（本轮清孤儿场景实测复现 3 次）

## 第四轮（v0.6.0）清单

骨架屏（3 屏呼吸微光空卡片 → 首屏图齐波浪式错峰揭幕，干掉顶部细读条）/ **thumb_ver 图片版本戳**（只有拍屏完成才 +1，排序/改文本零图片重载，DOM 差分键剔除 updated_at）/ **垃圾桶页面模式**（整页切换复用宫格/列表/缩放/框选，右键只剩恢复/彻底删除，Delete=彻底删除，Esc 返回，批量恢复/批量彻底删除）/ 固定列宽宫格（`repeat(auto-fill, var(--card-min))` 居中，缩放彻底无段落感）/ **橡皮筋过冲**（撞墙剩余速度→#grid transform 过冲，欠阻尼弹簧 5→12→10，上限 120px）/ 拖图新建区实心化（pointer-events 接管+高亮，不再穿透到下层卡片）/ 列表内容:台词=7:3 / 宫格时长也可双击编辑 / 非交互文本全去光标（user-select:none）

## 性能机制（v0.6.0 起）

- DB 版本号 = `COUNT-meta.rev`：meta 表单行整数，任何写入（含排序）都 +1，心跳 0.8s 缓存，200 镜头无压力
- 图片 URL 只带 `?v=thumb_ver`；`update_shot` 只在显式传 `thumb_fresh=True` 且 thumb_path 非空时 bump（改名也会带 thumb_path 更新，不 bump——v0.6.1 前无门控，改名都白白重载图片）
- 首屏预载窗口：前 3 屏 eager、更远处 lazy；揭幕只等首屏（约一屏卡片），不等全量
- `reorder_shots` 只改 seq 不碰 updated_at——排序不再触发任何卡片重建/图片重载

## 第三轮（v0.5.0）清单

方向键跳格(Shift扩选) / 右键+中键滑动撞墙回弹 / 拖卡片不再误触图片链路(根因:缩略图原生拖拽) / 拖图分区遮罩(卡片区80%+新建区20%,多图置灰) / **软删除+垃圾桶+撤销栈(Ctrl+Z,栈深20,逆操作反打)** / Shift范围选 / 右下统计 / 复制插到原镜头后一位 / 连续无级缩放(rAF节流) / 视图切换挪左下工具条 / 列表缩放只动缩略图列(--list-thumb-w) / content+dialogue 字段(仅列表显示,就地编辑同改名交互) / 列表冻结表头 / 首屏加载门控(进度条+全图就位统一fade-in,5s兜底) / DOM差分渲染(日常刷新不再噼里啪啦) / 插件加载自动起服务(load_post handler,面板删Start/Stop) / sticky标题栏高度折padding消跳动

## 撤销栈设计（core/undo.py）

- deque(maxlen=20)，entry schema：`{db:[(id,fields)], reorder_ids:[], purge:[{id,name,scene_name}], queue:[(cmd,params)]}`
- 映射：改名/排序/批量重命名/字段修改 = 逆操作反打；新建/复制 = purge 逆操作；删除 = 软删(DB deleted=1 + 场景改名 `__trash__<scene>`)其逆操作=restore；**purge(垃圾桶彻底删除)不可撤销**
- 恢复也进栈（逆操作=再删一次）；内存栈，Blender 重启即清空
- `__trash__` 前缀场景天然不被 sync 当孤儿（不以 Shot_ 开头）；`next_c_number` 用 include_deleted=True，垃圾桶占名不放号

## 下一步

- 待补充（问用户）

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

- 架构：Blender 插件 + 内嵌 HTTP（0.0.0.0:8089）+ `bpy.app.timers` 主线程队列
- 后端模块地图：`core/server.py`（ROUTES 表 + 静态服务）→ `core/actions.py`（每端点一函数）→ `core/queue.py`（COMMANDS 注册表 + 错误回传）/ `core/db.py`（含 next_c_name/next_c_number，软删字段 deleted/content/dialogue）/ `core/undo.py`（撤销栈）/ `core/paths.py`（目录）/ `core/scenes.py`（场景工厂）/ `core/sync.py`（同步唯一实现）/ `core/render.py`（拍屏公共函数）
- 前端模块地图：`web/index.html`（骨架+CSS）+ `web/js/`：state（共享状态）/ ui（toast+确认条）/ render（宫格+列表+FLIP+DOM差分+首屏门控）/ data（拉取+心跳+错误toast+undoLast）/ selection / dnd（卡片拖拽+拖图分区）/ rename（改名+字段就地编辑）/ menu（右键/中键滑动+回弹+菜单）/ create（弹框）/ marquee（框选）/ zoom（滑块+Ctrl滚轮连续缩放）/ keyboard（快捷键+方向键）/ trash（垃圾桶弹窗）/ main（入口接线）
- 改名：`cmd_rename_shot`（queue.py）四层联动实现
- 测试：改完跑 `python3 scripts/audit.py`（34 项，含 v0.2-v0.5 全部端点+垃圾桶/撤销链）+ `python3 scripts/audit_context_menu.py`（右键 4 项）；网页 JS 改动另需 webbridge 全交互回归
