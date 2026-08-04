# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**

## 刚做完（第十轮 v0.9.1：批量展开/折叠 + 展开态拖拽 + 面板帧导航 + 创建规则对齐，Kimi 执行，audit 38/38）

**需求 1：拍当前帧去掉覆盖确认（用户拍板）**——`STORYBOARD_OT_snap_frame.invoke` 删掉 `invoke_confirm` 分支，同帧号直接覆盖；docstring 同步。`overwrite` 属性保留（满 5 张软提示 + 完成文案用）。MCP timer 验证：帧 56 v=3→4 帧数不变直接覆盖 ✓

**需求 2：多选批量展开/折叠**——①空格键（keyboard.js）从单选扩到多选：选中多图镜头全部已展开→全部折叠，否则→全部展开，单图跳过 ②右键多选菜单（menu.js）从二选一 toggle 改为「全部展开」「全部折叠」**两个独立按钮并存**（batch-expand 只展开未展开的、batch-collapse 只折叠已展开的，幂等）——单图镜头展开无意义，选中全是单图时不渲染这两项。

**需求 3（重大 bug 修复）：批量展开时第二个镜头静默无动画**——实测批量展开 c0090+c0120：c0090 弹簧正常，c0120 起点 transform 设置了（inline `translate(1160px,-190px) scale(1)`）但 computed 全程 none，动画从未播放。
- **根因**：`expandAnimated` 的 FLIP 编排是"设起点 transform → `void grid.offsetWidth` reflow → 清 transform + 设 transition"——单独展开时起点 transform 在同一任务内先被浏览器渲染（transition 起点=起点姿态）所以正常；**批量时第二个镜头的 renderGrid() 重建 DOM 后，新 frame-cell 已以自然位置渲染过**（c0090 动画播放推动浏览器持续渲染帧），随后同帧"设起点→reflow→清空"对比的上一渲染帧是自然位置（none）→ 从 none 到 none 无过渡 → 静默无动画
- **修复**：清 transform + 设 transition 包进 `requestAnimationFrame`——起点 transform 先渲染一帧，下一帧再清空，transition 起点=起点姿态。验证：时间序列采样 c0120 从 0 帧移动 → 11 帧移动（1160→1056→612→205→20→回弹→0 完整弹簧曲线）
- **教训**：FLIP 起点必须被浏览器真实渲染过一帧再清空，同任务内 reflow 不算渲染——批量/连续调用时尤其致命（后面的 renderGrid 会抢在起点前渲染新元素）

**需求 4：面板已拍帧左右导航按钮**——新增 `STORYBOARD_OT_step_frame`（direction ±1）：按已拍帧号排序跳上/下一个，到头回绕（56→+1→0、0→-1→56）。v0.9.1 用户反馈按钮太小：帧号行保持原样，**下方新增独立一行** `◀ 上一个 | 下一个 ▶`（scale_y=1.4 放大）。

**需求 5：展开态折叠角标移到第一个图片帧左上角**——原来 `expanded-badge` 挂在 **isCover 帧**上（用户改封面后角标跟着封面跑，不在第一帧）且定位 4px 悬在图外（图在底衬内 9px padding）。改：render.js 挂载条件 `f.isCover` → `first`（第一个帧），CSS `top/left: 4px → 9px`（= 图片左上角，偏移 0/0 完全重合）。cover-chip「封面」保持 isCover 语义不动。像素验证：角标中心 rgb(72,150,239) = rgba(74,158,255,.92) 叠底 ✓

**需求 6：创建镜头对齐网页端规则**——①命名：invoke 预填 `next_c_name`（max c 编号+10，与网页端一致，用户可改）②时间：execute 按 duration 设 `frame_start=1, frame_end=max(1,int(duration*fps))`（与 cmd_create_shot_scene 同规则）。验证：3.0s × 24fps → frame_end=72 ✓

**需求 7：展开态帧格可拖拽排序**——dnd.js 原禁止 frame-cell 拖拽（v0.8.1 曾因"拖帧格把整镜头排到末尾"加的禁令，该 bug 已被 reorderShots 的 `movingIds.includes(dstId)` 落点保护修复）。改：frame-cell `draggable="false"→"true"` + dnd.js 移除 frame-cell 禁令。CDP 真实拖拽验证：c0120 帧格 → c0010 卡片，顺序成功改变 ✓

**验证**：audit 38/38；WebBridge 菜单两按钮 ✓ 批量展开/折叠动画全镜头 ✓ 展开态拖拽 ✓；MCP step_frame 跳转 ✓

## 刚做完（第九轮 v0.8.4：拍当前帧全面接管 RenderShot——用户拍板三项，Kimi 执行，audit 38/38）

**用户决策（2026-08 拍板）**：①接受统一模型——单图=1 帧镜头，不分单帧/多帧镜头（"结构上更清爽，逻辑上自恰"）②MAX_FRAMES_PER_SHOT=5 不变 ③Render All 果断删（90+ 镜头下是笑话）。

- **删**：`STORYBOARD_OT_render_shot` / `STORYBOARD_OT_render_all` + 面板两按钮 + 注册表（operator 删除必须重启 Blender，热重载覆盖不了注册表）；`__init__.py` 清 update_shot 死 import
- **删**：`cmd_rerender_shot` / `_render_and_update`；新增 `_cover_frame_no(db_path, shot_id)`（封面帧号，无帧行兜底 0）
- **API rerender 语义 = 重拍封面帧**（actions.py 两处转 `render_frame` + `frame_no=_cover_frame_no`）
- **四处自动拍屏改走 cmd_render_frame**：面板 create（f0）/ queue create_shot_scene（f0）/ create_image_shot_scene（f0）/ set_camera_background（封面帧）；**duplicate 升级为复制 frames 行 + 帧文件拷贝**（保留全部帧 + 封面标记 + 封面 still 同步；无帧行兜底拍 f0）——顺带修了"复制多图镜头丢帧"隐藏 bug
- **db.py init_db 迁移**：frames 行 image_path 以 still.png 结尾 → 改指同目录 thumb.jpg（统一展示用缩略图，卡片不加载 1920 大图；幂等，纯 Python 已测）
- **前端**：单图卡片渲染统一走封面帧图（列表/宫格同源 `coverFrame.imageUrl`，thumb.jpg 仅 legacy 兜底）；菜单「Re-render」→「重拍封面」
- **audit 同步**：1a 改 timer 包装（auto-render 需主线程，MCP 线程静默失败）；1b 改验"创建自动拍 f0 + frames 行"；2c 改验"重拍封面帧"（f00000_* 文件）；2k 期望帧数 1→2（创建自动 f0 + render_frame）
- **遗留语义**：新镜头 f0 输出 `f00000_still.png/f00000_thumb.jpg`（frame_no=0 走 frame_no is not None 分支），老镜头迁移后 f0 指 `thumb.jpg`——两者都是 320 缩略图、内容同源，可接受；重拍 f0 后统一为 f00000_thumb.jpg
- **验证**：audit 38/38；WebBridge 单图卡片（宫格/列表）显示封面帧图 ✓ 右键"重拍封面" ✓ 多图展开正常 ✓；duplicate 保帧（c0090 3 帧 → 副本 3 帧 [0,37,53] 封面标记保留）✓
- **render_all 崩溃随删除解决**（86 镜头 3.9GB 必崩的历史遗留不再存在）；批量重渲染（前端右键）走队列逐 tick 重拍封面帧，天然不崩

## 刚做完（第八轮 v0.8.3：帧格间距固定 + 列表封面角标 + 悬停扫视恢复 + 列表封面帧图，Kimi 执行，audit 38/38）

**需求 1：多帧展开最后一张图"矮一截"（用户实测）。**
- 根因（两阶段）：①frame-row-last 的 margin-right:0 让行尾格窄 12px（不吃 gap），图 width:100%+aspect-ratio 等比缩水（宽-12 高-7，顶部对齐视觉像"矮一截"）②补偿方案（图右伸 12px）用户否了——图怼出底衬不优雅
- 用户定稿：**图到底衬四边间距固定死**（取第一张图左/上沿间距），图大小随底衬动态适配。实施：frame-cell padding 4% → 固定 9px；删掉 frame-row-last 的图外伸补偿（overflow 复原）；frame-row-last 保持 margin-right:0 底衬不出界
- 结果：三帧图到各自底衬四边 9/9/9px、图间距 18px 均匀、行尾底衬 220 不出界；最后一张图 202×114（比前两张小 12px）是固定间距下的几何必然，视觉整齐非找补

**需求 2：列表展开态多图浮层加封面角标。**
- `.list-frames .frame-thumb` 加 position:relative；`.frame-thumb.is-cover::after` 画"封面"chip（与宫格 cover-chip 同风格：10px/蓝底/padding 3px 6px），纯 CSS 未动 JS

**需求 3：悬停扫视后封面回不去（用户实测）。**
- 两处根因：①移出卡片无恢复逻辑（扫视改了 coverImg.src 就停在那）②列表文字区 hover 也触发扫视——X 在缩略图右侧被 clamp 到 1，显示末帧，用户以为"没碰图却变了"
- 修复（frames.js）：抽 `restoreCover(card)`（首次扫视把原始 src/frameId 存 card.dataset，mouseout 且 relatedTarget 不在卡内时还原）；mousemove 加范围检查——鼠标不在缩略图（宫格=卡片）范围内直接 restoreCover+return；列表 .shot-thumb 无 data-frame-id，存 '' 防恢复出 "undefined" 字符串
- 验证：CDP 真实鼠标，列表 4 场景（右端/封面/扫过封面/横扫）+ 宫格（左端/中间/移出）全 PASS

**需求 4：列表折叠态多图缩略图显示旧封面（用户实测：宫格对列表不对）。**
- 根因：列表缩略图一直用 thumb.jpg（shot 级旧图），用户右键改封面（f0→f00053）后 thumb.jpg 不更新；宫格显示封面帧图所以对
- 修复（render.js）：列表 buildCard 多图分支缩略图直接渲染封面帧 imageUrl（`frames.find(f=>f.isCover)`，与宫格同源），封面变更立即跟随；单图仍用 thumb.jpg
- 验证：c0090/c0010/c0380 列表缩略图 = 各自封面帧图，与宫格一致

## 刚做完（第七轮：面板删除崩溃修复 + 删除确认策略调整 + Delete 删帧，Kimi 执行，audit 38/38）

**需求 1：Blender 面板删除镜头必崩（用户实测确认）。**
- 根因：两条删除路径不一致——queue 的 `cmd_delete_shot` 有"先切走当前激活场景再 batch_remove"的保护（Safe: switches away first if active），面板 operator `STORYBOARD_OT_delete_shot` 是独立实现、直接 `bpy.data.batch_remove(ids=(scene,))`，删除正在激活的场景时 window 仍引用被删 datablock → Blender 4.5 必崩（"Blender has stopped working"弹窗）
- 修复：面板路径复用 `cmd_delete_shot`（切走 + batch_remove + 删目录），不再自己 batch_remove
- 验证：删当前激活场景三清 + 不崩；连续删 3 个场景压力测试无残留不崩
- **教训：所有删场景路径必须走 queue 的 cmd_delete_shot，别自己 batch_remove**

**需求 2：删除镜头/删帧不再确认，只保留垃圾桶彻底删除的确认。**
- menu.js：删帧（frame-delete）、删镜头（delete）、批量删（batch-delete）去掉 askConfirm，直接执行 + toast
- selection.js：Delete 键软删（单个/批量）去掉确认；垃圾桶 purge 确认保留
- 保留 4 处 askConfirm 全是「彻底删除…不可恢复」（menu.js purge/batch-purge + selection.js trashMode purge）

**需求 3：Delete 键在帧级焦点（蓝框）时删帧而非删镜头。**
- keyboard.js：Delete 分支先查 `.frame-img.frame-focused` + `state.focusedFrameId`，命中则 `delete_frame` + 清焦点 + toast，否则走 `deleteSelection()`
- 验证：帧 96 蓝框 → Delete → 只删帧 96 镜头完好；无焦点 → Delete → 软删镜头，其它镜头帧不受影响

## 刚做完（第六轮：右键菜单三修 + CSS 衬底复活 + 列表缩放动态上限，Kimi 执行，audit 38/38）

**需求 1：多图镜头折叠态右键菜单与单图一致。**
- 实测确认宫格折叠态多图误弹**帧级菜单**（展开/设封面/重拍/跳构图/删帧），单图是普通菜单
- 根因：menu.js 帧级判定只看 `e.target.closest('.frame-img')` 不看展开态；宫格折叠态=一叠牌，N 帧图叠放，右键落在帧图上就误命中
- 修复：帧级判定加展开态门控 `const frameImg = isExpanded(shotId) ? e.target.closest('.frame-img, .frame-thumb') : null;`

**需求 2：所有多图镜头右键菜单加「展开」项，位于 Open Shot 上面。**
- menu.js else 分支 toggle-expand 挪到 open 之前，去掉 expanded 门控（折叠态显示「展开」、展开态显示「折叠」）；单图不渲染该按钮
- 帧级菜单本就带 toggle-expand 在顶部，无需改

**需求 3（顺带补全）：列表展开态帧图右键弹帧级菜单。**
- 之前列表展开态右键帧图弹普通菜单——列表帧图 class 是 `.frame-thumb`（render.js），而帧级判定只认 `.frame-img`（v0.7.0 只给宫格做了）
- 修复：closest 选择器扩为 `.frame-img, .frame-thumb`（同一处）

**需求 4：宫格多图展开态衬底检查 → 发现衬底失效并修复。**
- 实测：帧格 computed background=#252525（应为 #111113）、margin-right=0（应为 -12px）、padding=0（应为 4%）——连片底衬完全不生效
- 根因：**CSS 孤儿声明块**（第四轮 22b385f 重写 `.stack-badge` 时残留 `font-weight: 700; ... pointer-events: none; }` 无选择器尾巴）→ CSS 解析器错误恢复吞掉紧跟其后的 `.shot-card.frame-cell` 规则（background/margin-right/padding 全没进浏览器）
- 修复：删孤儿块，`.stack-badge` 补回 font-weight: 700（pointer-events:none 不加，按钮要可点击）
- 排查法：浏览器 cssRules 总数(148) < 本地规则块数(154)，差的就是被吞的；curl 看服务器文件完好但浏览器缺规则 = 解析被前面语法破坏

**需求 5：列表缩放最大极值 = 多图镜头展开浮层刚顶到页面右缘（第四轮只做了固定 55%）。**
- 实测：55%（760px）下展开 3 帧浮层右缘 2338 vs 页面 1413，**溢出 925px**
- 修复（zoom.js）：maxW 动态公式 `(availWidth - 24 - (N-1)*2 - 43 + 7.11*N) / N`，N=当前最大帧数（fetchShots 后经 `__zoomApply` 重算，未来加 4/5 帧镜头上限自动收紧）；data.js fetchShots 成功后调 `window.__zoomApply?.()`
- 实测：3 帧项目 max 444px（原 760），展开浮层右缘 1390 vs 1413，溢出 -23px（刚顶到）
- 常数：LIST_FLOAT_OFFSET=24（grid左16+浮层left4+padding4）、LIST_BADGE_W=43（角标）、LIST_FRAME_DELTA=7.11（listThumbW→帧宽 aspect 链实测差）

- 验证：WebBridge 真实右键两视图×五场景全过（列表/宫格 × 折叠/展开/单图）；衬底 computed+几何连片零 gap；缩放线性 step=1；audit **38/38 PASS**

## 刚做完（第五轮：多图帧级实时刷新，Kimi 执行，audit 38/38）

**需求：多图镜头在 Blender 重拍某一帧，网页端要实时更新（尤其非封面帧）。**

- **根因**：`cmd_render_frame` 里只有 `if is_cover` 才 `thumb_fresh=True` bump shot 级 `thumb_ver`（queue.py）；非封面帧重拍只走 `update_frame`（bump DB rev 但不动 thumb_ver）→ 前端心跳拉到新数据但 imageUrl 的 `?v=` 不变 → render.js 差分键 `f.id:f.imageUrl:f.isCover` 不变 → DOM 不重建 → img src 不变 → 浏览器缓存旧图。第四轮第 1 项只验证了封面帧（v=8→v=9），多图非封面帧链路是断的。
- **修复（帧级版本戳）**：
  - `core/db.py`：frames 表加 `ver INTEGER DEFAULT 0` 列（DB_SCHEMA + init_db 老库迁移 `ALTER TABLE frames ADD COLUMN ver`）；`update_frame` 带 `image_path` 时 `ver = COALESCE(ver, 0) + 1`（重拍才 bump，改 frame_no/is_cover 不 bump）
  - `core/actions.py`：`_frame_to_api` 的 imageUrl 缓存戳从 shot 级 `thumb_ver` 改为帧级 `frame.ver`
- **双轨语义**：封面帧重拍 = 帧 ver+1（展开态帧图刷新）+ shot.thumb_ver+1（折叠缩略图刷新）各自独立；非封面帧重拍只 bump 帧 ver——精确刷新重拍那一帧，其它帧零重载
- 验证：DB 层单测（新库建表/老库迁移/重拍+1/非重拍不变）全过；MCP 重拍非封面帧 URL `?v=0→1`、封面帧双轨 `frame 0→1 + thumb_ver 11→12`；WebBridge 实测不刷新页面、心跳 2s 内页面 img src 自动 `v=1→2→3`；audit **38/38 PASS**

### 顺带处理（环境问题，非代码改动）

- **rename_seq 审计失败**（`Scene Shot_c0040 already exists`）：Blender 里有 5 个幽灵场景 `Shot_c0040/c0160/c0310/c0470/c0840`（DB 无记录、磁盘无目录，sync 只报告不处理——AGENTS.md 待办第 7 项）撞掉批量改名名字分配。处理：改名 `__ghost_<name>` 保留数据释放 c 名，audit 恢复 38/38。**这些幽灵场景是历史遗留（重启 Blender 复活），下次再遇 rename 撞名先查这个**
- **MCP 测试路径转义坑**：MCP execute_code 里写 `N:\\Projects\\...` 中文路径，反斜杠/unicode 转义极易错（`\\u8bf7` 变字面量或 `N:\\` 双反斜杠）→ sqlite "unable to open database file" 假象。**测试一律用 `bpy.data.filepath` 推导 project_dir**（`os.path.join(dirname, basename_noext + "_storyboard")`），零转义
- **MCP 偶发卡死**：连续 execute_code 大命令（init_db/reload 组合）会卡 handler（空响应），分步小命令可恢复；查 queue 状态用 `q._command_queue.qsize()` 别用 `len(bpy.app.timers)`（timers 是模块不是列表，len 报错）



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

## 刚做完（第四轮，9 项需求修复，Kimi 执行，审计 21/21）

### 第四轮修复

1. **拍屏覆盖不更新** — 确认心跳+rev 链正确，API 路径自动刷新（v=8→v=9），Blender 面板同走 `cmd_render_frame`→`update_frame`→`_bump_rev`，未动代码
2. **折叠态右键菜单一致** — `menu.js` 里 `isMulti && expanded` 替代 `isMulti`，折叠态不再显示「展开」按钮，与单图菜单完全一致
3. **宫格折叠小圆标可点击** — `stack-badge` 从 `<div>` 改 `<button>`，`onclick="window.__sb.toggleListMulti(...)"`；展开态封面帧格上加 `.expanded-badge`，展开后不消失可折叠
4. **列表线性缩放** — `zoom.js` 分离宫格/列表两条路径：宫格保持列数段落式，列表用独立 `listThumbW` 变量 + 无极滑块（step=1，范围 40px→页面宽的 55%）；`toggleView` 调用 `window.__zoomApply` 刷新滑块；`toggleView` 挂到 `window.__sb`
5. **空项目提示** — 已有实现（`empty-state` div + `removeSkeleton()`），无需改动
6. **新建镜头设 Blender 时长** — `actions.py` 传 `duration` 到 queue；`cmd_create_shot_scene` 设 `scene.frame_start=1` + `scene.frame_end=max(1, int(duration*fps))`
7. **跳构图相机跳视口** — `cmd_jump_to_frame` 和 `cmd_open_shot` 的 `temp_override` 循环只生效一个视口，改用 `space.region_3d.view_perspective='CAMERA'` 直接设所有 3D 视口
8. **自动同步** — `__init__.py` 新增 `_auto_sync()` timer（首次 5s，之后每 30s 调用 `sync_scenes_with_db()`），防意外退出丢数据；`_on_file_loaded` 注册
9. **中键滑动惯性** — 用户确认暂不动，当前效果对

### CSS 架构重构

- `index.html` 831 行 → 84 行：`<style>` 747 行 CSS 完整提取到 `web/css/style.css`
- HTML 替换为 `<link rel="stylesheet" href="css/style.css">`
- `server.py` 已注册 `.css` MIME type + 静态递归路径（200 OK）
- 拆分后全功能回归 15/15 PASS

### 验收

WebBridge 21/21 PASS：宫格卡片/展开折叠/帧格焦点/列表行/浮层面板/徽标按钮/线性缩放/悬停扫视/切换回归

### GitHub 推送

- HTTPS 直连被墙，系统代理 `127.0.0.1:7897` 为 SOCKS5
- `git config http.proxy socks5://127.0.0.1:7897` + token 内嵌 URL 推成功
- commit `22b385f`，`61070a0..22b385f main -> main`

### 第三轮（之前完成未记，列表视图多图展开 + 悬停扫视 + 弹簧动画）

**列表浮层面板**：
- 多图展开态帧缩略图横排在行内 `.list-frames`（`position:absolute; display:inline-flex`）
- 浮层高度匹配缩略图（`bottom:4px`），宽度自由延伸
- 面板严丝合缝覆盖缩略图区域（`left:4px; top:4px`，用 `.thumb-wrap` 容器 + 直接定位）
- 帧缩略图 `width:auto; height:100%; aspect-ratio:16/9`——展开态覆盖通用 `width:56px` 规则

**徽标按钮**：`3帧 ▶` 改成 `<button class="multi-badge">`，可点击展开/折叠；展开态变 `3帧 ◀` 位于浮层 flex 容器右侧；`window.__sb.toggleListMulti(shotId)` 驱动

**悬停扫视**（列表视图）：`initStackHover` 用 `.shot-thumb` 的 `getBoundingClientRect()` 替代卡片 rect，扫视只在缩略图范围内生效

**弹簧动画**（列表视图）：
- `expandAnimated` 列表分支：`scaleX(0)→scaleX(1)` + opacity fade，450ms spring curve，带 `_animToken` 防护
- `collapseAnimated` 列表分支：`scaleX(1)→scaleX(0.8)` + fade，320ms `setTimeout` 后 `toggleExpand+renderGrid`（不用 `transitionend`——不可靠）
- 只横向弹，Y 轴不动

**其他第三轮修复**：
- `overflow: hidden` 裁切浮层 → `.list-item.expanded { overflow: visible }`
- `pointer-events: none` 阻止按钮点击 → `.multi-badge { pointer-events: auto }`
- 折叠后浮层复活 → `expandAnimated` 加 `_animToken` 令牌防护
- 点其他卡片清帧焦点 → click handler 加 else 分支清 `.frame-focused`
- 列表行高缩放一致 → 封面图始终保留行内，浮层 `position:absolute` 不占布局



- **FLIP 双根因根治（用户报"拖任何镜头多图都滑一下"+"拖拽回顶"）**：①`captureRects/animateFrom` 改按 `id:frameId` 复合键（展开态 N 帧格共享 dataset.id 互相覆盖 rect，任何排序都让帧格从错误位置起飞）②测量从 `getBoundingClientRect` 改 `offsetLeft/offsetTop`——纯布局值不受 transform 影响，上一轮未播完的 invert/进行中的 transition 不再污染下一轮捕获（污染会连环放大，后台标签页 rAF 冻结时尤为明显）
- **焦点框跟手（用户报"选中框不动"）**：那个"选中框"其实是封面 `is-cover` 蓝描边。改为：封面降级为右上角「封面」角标（`.cover-chip`），蓝框变焦点框 `frame-focused` 点击哪张跟到哪张（`state.focusedFrameId` + `frames.js focusFrame`，默认落封面）；帧格选中态用连片底衬底色 `#182431` 表达（`.selected` 的 border/box-shadow 被帧格 `border:none+box-shadow:none` 吞掉是历史遗留）
- **帧格禁拖（用户报"一拖整镜头排到最后"）**：帧格 `draggable="false"` + dragstart 守卫 + `reorderShots` 落点在移动组内直接 no-op（自落曾 splice 到末尾）
- **queue 缺参校验 falsy 误杀（用户报"双击帧图报错"）**：`not params.get(k)` 把 `frame_no=0`（F0 帧）判成缺参，改 `is None`
- **运行时热修补**：`importlib.reload(core.queue)` 免重启生效（reload 原地刷新模块命名空间，旧 timer 回调经 `__globals__` 读到新 COMMANDS；`.blend` 有未保存改动时的免重启手段）
- 验收：webbridge 结构断言——帧格全 `draggable:false`、焦点框点击跟手+持久化、选中底衬三格齐亮、连续两次 renderGrid 帧格零变换（修复前连环污染必现）、audit **38/38 PASS**、curl 直测 F0 跳帧成功（场景切换+frame_current=0）
- 待用户前台复核："拖拽回顶"若还复现则是 Chrome 拖拽原生自动滚屏（视口边缘触发），与本 bug 无关，需另行处理

## 刚做完（v0.8.0 连片底衬+弹簧动效+面板帧号列表，Kimi 执行，audit 38/38）

- **连片底衬修复（A）**：帧格 `margin-right:-12px` 吃掉宫格 gap，同行帧格深色背景真正贴在一起连片；`.frame-row-last` 还原 margin 防吸住下一个普通卡片；删除 `.frame-backing` 死 CSS（Hermes 第一版独立底衬残留，a5ff1d0 起 JS 已不生成）
- **展开/收起双向弹簧动效（B，frames.js 编排）**：`expandAnimated`/`collapseAnimated`，曲线 `cubic-bezier(0.34,1.56,0.64,1)`，transform+opacity only。展开=每帧格从折叠卡 rect 缩弹回自己格位（错峰 40ms）；收起=帧格逐张飞向第一格（远处先收 35ms、非首格淡出），470ms 后才 toggle+renderGrid，折叠卡恰好在收敛点出现。动画期 shotId 挂 `state.animatingShots`，renderGrid 的 FLIP(`animateFrom`) 和 fade-in 对它们让位；`_animToken` 代数防快速连点时旧 setTimeout 清掉新动画。触发点：main.js 双击 + keyboard.js 空格
- **main.js 新增 `window.__sb` 调试句柄**（state/renderGrid/expandAnimated/collapseAnimated/isExpanded）——webbridge evaluate 能直接驱动页面主世界函数，e2e 必备
- **Blender 面板多图区（C）**：「拍当前帧」`storyboard.snap_frame`（停哪个帧拍哪个帧；同帧号→invoke_confirm 覆盖确认；满 5 张且新帧号→WARNING 软提示；execute 带 `_resolve` 兜底防空 project_dir 造野库）+ 已拍帧号列表 `F0 F48 F96`（`storyboard.jump_frame` 点帧号跳时间轴；封面='IMAGE_DATA' 图标、文件缺失='ERROR' 图标；`_panel_db_read` 1s TTL 缓存防 draw 高频打 SMB 盘）
- **顺手修 v0.7.1 遗留 bug**：面板 sync 按钮解包 5 值 vs `sync_scenes_with_db` 返回 6 值（frames_removed）→ ValueError，面板 Sync Scenes 必崩，已改 6 值+报告带 frames_removed
- 验收：audit **38/38 PASS**；webbridge 结构断言（`__sb` 驱动）：展开 3 帧格弹簧 transform/错峰/无 fade-in/总数 90→92 全对，收起中间态（齐飞+非首格淡出+z 序 30/31/32）全对，最终折叠还原 90 张无残留；MCP 实测 snap_frame 覆盖路径（F48 重拍出图）+ queue render_frame 新帧路径（F60 入表出文件，测后已清理）+ jump_frame 跳帧 + `_panel_db_read` 缓存读取
- 待用户前台验收：弹簧动效手感（后台标签页验不了视觉）；面板「拍当前帧」按钮+覆盖确认弹窗+帧号列表真实点击（invoke_confirm 需 window context，MCP 测不了）

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

- 第九轮（v0.8.4：拍当前帧全面接管 RenderShot——删 RenderShot/Render All + 统一 frames 模型 + duplicate 保帧 + f0 缩略图迁移）已完成，audit 38/38，**待用户发话再推 GitHub**（当前即待推状态）
- 第八轮（v0.8.3）已推 GitHub（7184485）
- 测试现场：c0410 测试中被删了帧 70/96（只剩 0/111），如需恢复用面板 snap_frame 重拍即可；测试残留镜头已清（c0010111/c001011 已 purge）

## 下一步

- 用户前台验收第十轮：面板「拍当前帧」无确认直接覆盖 / 已拍帧下方放大导航行 ◀ ▶ / 创建镜头弹窗默认名自动编号 + 帧范围按 duration / 多选右键「全部展开·全部折叠」/ 展开态拖帧格排序 / 展开态折叠角标在第一个帧左上角
- 幽灵场景累计 12 个 `__ghost_*`（第五轮 5 个 + 第七轮 7 个：c0050/c0100/c0230/c0340/c0480/c0560/c0970）待用户确认是否彻底删除（含 .blend 存盘防复活）；**反复出现说明 sync 待办第 7 项（孤儿场景自动收敛）值得优先做**
- 第 9 项惯性功能按需重新启动
- 后续可开工的优化项：稳健性待办列表（见下方）

## 开发铁律

所有需求（增/删/改，单条/列表）按以下循环执行：

```
测试确认 → 修改 → 验证测试 → 有问题继续改 → 全通过才交付
```

列表需求：逐项独立循环，全部做完后回归审计每一项。

## WebBridge 测试速查

| 场景 | 方法 |
|------|------|
| 页面加载/状态 | `find_tab` + `navigate`（不带 `newTab`，复用标签页） |
| DOM 验证 | `evaluate` 读 `window.__sb`、查 class/元素、测尺寸 |
| 普通点击 | `el.click()`（CDP 坐标常偏，展开帧格会遮挡） |
| 右键菜单 | CDP `mousePressed+Released`（合成事件被 `preventDefault` 拦截） |
| 模块函数 | 挂到 `window.__sb` 上才能调（ES module 不暴露到 window） |
| Edge | 不杀！开着一直复用 |



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

- ~~待补充（问用户）~~
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
- 公司 PC 部署的是旧版，如反馈良好需同步部署

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
- **Git 推 GitHub 用 SOCKS5 代理**：本机网络直连 GitHub 超时（被墙），Edge 通过系统代理 `127.0.0.1:7897`（SOCKS5）可通。MSYS2 git 不支持 SOCKS5 认证交互，必须 `git remote set-url "https://TOKEN@github.com/..."` 内嵌 token 跳过 credential helper，然后 `git config http.proxy socks5://127.0.0.1:7897`。推完记得还原 remote URL（去掉 token）。
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

## 细节指针

- 架构：Blender 插件 + 内嵌 HTTP（0.0.0.0:8089）+ `bpy.app.timers` 主线程队列
- 后端模块地图：`core/server.py`（ROUTES 表 + 静态服务）→ `core/actions.py`（每端点一函数）→ `core/queue.py`（COMMANDS 注册表 + 错误回传）/ `core/db.py`（含 next_c_name/next_c_number，软删字段 deleted/content/dialogue）/ `core/undo.py`（撤销栈）/ `core/paths.py`（目录）/ `core/scenes.py`（场景工厂）/ `core/sync.py`（同步唯一实现）/ `core/render.py`（拍屏公共函数）
- 前端模块地图：`web/index.html`（骨架+CSS）+ `web/js/`：state（共享状态）/ ui（toast+确认条）/ render（宫格+列表+FLIP+DOM差分+首屏门控）/ data（拉取+心跳+错误toast+undoLast）/ selection / dnd（卡片拖拽+拖图分区）/ rename（改名+字段就地编辑）/ menu（右键/中键滑动+回弹+菜单）/ create（弹框）/ marquee（框选）/ zoom（滑块+Ctrl滚轮连续缩放）/ keyboard（快捷键+方向键）/ trash（垃圾桶弹窗）/ main（入口接线）
- 改名：`cmd_rename_shot`（queue.py）四层联动实现
- 测试：改完跑 `python3 scripts/audit.py`（34 项，含 v0.2-v0.5 全部端点+垃圾桶/撤销链）+ `python3 scripts/audit_context_menu.py`（右键 4 项）；网页 JS 改动另需 webbridge 全交互回归
