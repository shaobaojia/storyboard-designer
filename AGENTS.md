# AGENTS.md

> 给下一个 Agent（或下一个自己）的交接备忘录。**收工推送前必须更新「刚做完 / 正在做 / 下一步 / 坑」四个字段。**
> 2026-08-11 维护：v0.9.72 时间线台词条拖宽动态钳制记入刚做完；CSS 拆分方案 A 拍板（下个对话执行）。
> 2026-08-11 二次维护：CSS 2255 行拆分（方案 A）已执行完毕记入刚做完；下一步 CSS 拆分待办划掉。
> 2026-08-11 三次维护：queue.py 拆分（方案 B）执行完毕记入刚做完；下一步 queue 拆分待办划掉；正式工程全量审计两个环境观察记入坑。
> 2026-08-11 四次维护：v0.9.73 已推 GitHub（2026-08-11，干净库全量 89/89 全 PASS）。
> 2026-08-10 十一次维护：预览小图尺寸修复记入刚做完；待推标记合并三项。

## 刚做完（queue.py 拆分 + CSS 2255 行拆分 + v0.9.72 一项 + 屎山治理批 A + v0.9.70 一项 + v0.9.69 一项 + v0.9.68 一项 + v0.9.67 一项 + v0.9.66 一项 + v0.9.65 一项 + v0.9.64 五项，2026-08-11/10，已推 v0.9.73）

**queue.py 953 行拆分（2026-08-11，未推，方案 B 三拆）**：queue.py 瘦身至 ~200 行（队列机制 + COMMANDS 注册表 + re-export 兼容层），命令实现按域拆两个新文件——core/commands_shots.py（镜头域 16 命令 + _cover_frame_no 私有副本，~480 行）+ core/commands_frames.py（帧域 render_frame/set_cover_frame/delete_frame + _switch_scene/_restore_scene，~150 行）。死函数 _render_frame_of（全仓无调用者）按用户拍板删除。依赖方向单向无环（queue → commands_shots → commands_frames → core 叶子；函数内 import 提升到模块级）。**公开 API 面 10 符号全保**（queue_command/ensure_timer/redraw_view3d/panel_db_cache/queue_idle/recent_errors/execute_command/process_queue + cmd_render_frame/cmd_delete_frame/cmd_delete_shot/_cover_frame_no re-export）→ __init__.py / actions.py 零改动。**验证**：ast 保真核对 30 函数（5 个差异全归类为五代退役改动/import 提升/_shutil→shutil 等价改写）+ 机制函数逐行一致 + 干净库全量 89/89 全 PASS（47+12+30）。版本号不升

**CSS 2255 行单文件拆分（2026-08-11，未推，方案 A 执行）**：style.css 切成 style.part1-4.css（593/605/618/439 行），index.html 按原顺序 4 link + 注释「禁止调整 link 顺序」。**切分点必须用块扫描器确认**（行尾括号深度 0 且不在注释/字符串内）——原始边界 600/1200/1800 全落在规则块内部（.list-header/.sc-row kbd/:root 浅色主题变量块），未闭合块 EOF 自动闭合 + 下文件开头属性行与 `}` 被丢弃 = 规则残缺/丢失（首次验证 FAIL：389→386 条且 .list-header 属性不全）；安全点 = 593 空行/1198 块闭合/1816 浅色主题块闭合。**验证链**：去注释拼接字节级一致 + 每文件尾深度 0 注释闭合 + CSSOM 389 条规则序列逐条相等（基线 vs 拆后）+ 21 项视觉特征 computed 全等 + 同条件 reload 截图 0.000% diff（拆前基线截图差异 0.359% 是 navigate no-op 残留滚动位置的环境差异）+ 列表/宫格/时间线三视图冒烟各 74 元素。旧 style.css 无引用已删（源码+部署）。版本号不升

**v0.9.72 时间线台词条拖宽动态钳制（2026-08-11，未推）**：用户报「时间视图台词不能自由拉动」——实测根因：拖宽钳制是常量（下限 120px + 上限可视右缘 85%），最小档 clipW=52 时台词条初始宽 86px < 120，**往短拖反而变宽**（c0030 实测最短只能 120、最长 227）。**改动**：render.js initDialogueResize onMove 时间线分支改动态变量（用户拍板）——最短 = 当前镜头宽 clipW、最长 = 向右 3 个镜头位 3×(clipW+CLIP_GAP)，随缩放实时变化；宫格分支保持原语义（120 下限 + 同排容量 capW/可视右缘）。**验证**：最小档 52/192、最大档 316/984（比例恒定盖镜头数不漂移）、落盘 {m:2,p:0} reload 无回弹、c0030+c0330 双镜头实测、宫格回归 196→436。版本号不升

**预览窗口小图尺寸修复（2026-08-10，未推）**：宫格/列表预览窗口中，小图（320×180 缩略图）阶段以原生尺寸显示、大图（1920×1080）被 max 约束缩放到画幅容器——大小图显示尺寸不一致（用户实测抓包"小图不匹配"）。**根因不是五代退役引入**：aspect.js 动态注入的 `.preview-body img` 规则（v0.9.34 画幅容器改造）用 `width:auto; height:auto; max-width:100%; max-height:100%`，与静态 CSS 1317 行（100%×100%）同特异性 (0,1,1) 后注入覆盖——小图没到 max 约束线就原生显示，大图被 max 缩放。**修复**：aspect.js `.preview-body img` 改回 `width:100%; height:100%`（保留 aspect-ratio + object-fit 画幅裁切语义）——小图阶段放大到容器画幅尺寸与大图一致，切换只有模糊→清晰无尺寸跳变。验证 WebBridge：CSSOM 新规则生效 + 小图 320×180→430×562 + 大图 1920×1080 填满同容器 + 大小图同尺寸 + 老单图镜头（仅 still.png 无 still.jpg）大图 404 停小图放大态（符合"不再读 png"拍板，小图兜底）。改 web/js/aspect.js 一处 4 行。

**五代兼容层退役（2026-08-10，未推，屎山治理批 A④）**：五代格式兜底全删（用户拍板：不存在旧工程/png 不再读取/新镜头一律 {name}_{id}/老格式宽度数据回自动大小无损失）——**代1** db.py init_db 删老库迁移三块（type 列删除/orphan_shots 回填 frames/frames.ver 补列/still.png→thumb.jpg 改指），保留通用补列循环（幂等防御）；**代2** 全链路去 png：preview.js 删 stillFallback 函数+两条 onerror 重试链（showPreviewImage/preloadNeighbors，jpg 404 直接缺图红格）、queue.py 删帧三候选改两候选（不再清 _still.png）+duplicate still_candidates 去 png+改名 still_path 拼 still.jpg（原拼 still.png 永不命中写空串）、render.py/queue.py docstring 修正；**代3** sync.py 删 legacy {id} 目录迁移分支（dirs_migrated 恒 0）+**顺手修既有 bug**：__init__.py Sync Scenes 按钮解构 6 元组 vs sync 返回 7 元组（v0.9.63 加 registered 时漏改调用方，点按钮 ValueError）+报告加 registered 计数；**代4** render.js dlgEntry/getDialogueWidth 删纯数字+旧时间线 {w,base:有值} 换算两条远古分支——现行只两种格式（宫格 {w,base:null} 固定像素/时间线 {m,p} 镜头位，分开存功能语义不动），老数据命中被删格式回自动大小；**代5** render.js 删 thumbImgHtml 函数+两处回退调用（列表/宫格单图）——shots.thumb_path 的 thumb.jpg legacy 兜底退役，imageUrl 缺失统一 SVG_NOIMG 红格子。验证：全量 89/89（47+12+30）+ 代4/5 语义 5/5（宫格固定像素 333/时间线 {m:1,p:0.5}=394 与公式精确吻合/纯数字与 {w,base} 老格式均回自动 clipW=148/缺图 SVG_NOIMG）。版本号不升

**屎山治理批 A 三项（2026-08-10，未推，纯结构重构零行为变化）**：①**编辑模板合一**——新建 web/js/inline_edit.js（73 行共享模板：input/textarea 创建、7 类事件 stopPropagation、Enter/Escape/blur 语义、done 标志 finish 闭包），rename.js（startRename/startFieldEdit）/render.js（startDlgEdit）/timeline.js（startTlDlgEdit）四处入口瘦身成薄封装（各自保留 DOM 定位/commit API/校验，输入框生命周期全走 inlineEdit；timeline 版 rebuildText 改为 textEl.replaceWith——inlineEdit 已还原 targetEl，原 input.replaceWith 对 disconnected 元素无效）。验证 WebBridge 16/16（改名/时长单行/内容多行/宫格台词/时间线台词全链路提交+Escape+还原）。②**审计公共层**——新建 scripts/audit_lib.py（MCP_HOST/PORT/HTTP + blender/api/wait_until/print_record 一份实现），audit.py/audit_context_menu.py/web_audit.py 各删复制段（state() 保留各自——audit 三元组 vs ctx 单元组形状不同不强合；audit.py 的 wait_ok 保留——带 record FAIL 语义）。③**shot_action 拆 handler 表**——actions.py 210 行单函数 14 个 if/elif → 14 个 `_act_xxx(project_dir, db_path, shot_id, data, shot)` 函数 + `_ACTION_HANDLERS` 表（action→(handler, needs_shot)）+ 22 行分发器（update/move_dialogue 自查记录 needs_shot=False 传 None）。验证：本地分发 5/5（unknown 400/update 404/rename 404/move_dialogue 边界 400/update 200）。**推前全量干净库 89/89 全 PASS（47+12+30）**——三脚本运行时 + handler 表化后端全路径 + inlineEdit 前端路径三重验证。版本号不升（无产品功能改动）

**审计脚本增强（2026-08-10，v0.9.70 后追加，已推）**：①audit.py 新增 s13 段 move_dialogue 原子性固化（v0.9.68 漏网 bug 修复进回归网防复发：移动/互换 + 一次撤销全恢复 + 边界拒绝 400/400/404 数据不动，零残留模式操作 N 次撤销 N 次）②web_audit.py 新增 timeline 段 7 项（覆盖最大盲区——此前 web_audit 9 段全测宫格/列表：进时间线 setView/clip 渲染数=API/台词条数/多图展开折叠 expandedShotIdsTl 分流/滑块缩放 clip 宽/切回宫格）③s3 cleanup 时序修复：purge 场景删除是 queue 异步，不等场景消失就 sync 会被 _register_other_scenes 登记成「其它」镜头（name=Shot_ 前缀）→ leftover 假 FAIL（SMB 慢盘 9s 实测）——purge 后 wait_ok 场景消失再继续④restore_all 的 toggleView → setView('grid')（v0.9.55 起 toggleView 是 MRU 最近两视图切换，prev 非 grid 时切不回宫格）。推前全量干净库 89/89 全 PASS（47+12+30，~3min）

**v0.9.70 列表缩放极值×2 + 镜头名减半（2026-08-10）**：需求池 477 行三件套——①zoom.js 列表分支 `maxW = Math.round(listMaxW() * 2)`（旧 350→700，基于「最大帧数镜头展开浮层顶到右缘」公式 ×2；**注意：多图展开浮层在最大档溢出右缘（4 帧实测右缘 2850 vs 视口 1485，溢出 1365px）——×2 的物理自然结果，折叠态不溢出**）②CSS 镜头名列 150→75px（.list-header 与 .shot-card.list-item 两处 grid-template-columns 同步）③fr 列自动吸收腾出的 75px（内容 +52.5 / 台词 +22.5，7:3 保持）；配套 .shot-name 加 ellipsis（减半后长名防溢出盖内容列）。验证：WebBridge 13/13（滑块 max 700 / 镜头名 75 / 内容 707.6 台词 303.3 比例 7:3 / 时长 60 更新时间 110 不变 / 最大档条目不溢视口 / 开预览 ×0.5 一致 / ellipsis scrollW 312>75 / 现场还原）

**v0.9.69 列表开预览字体固定（2026-08-10）**：列表视图开预览时 --list-scale≈0.5 整表等比缩 → .cell-text/.field-input.multiline 的 `calc(12px*var(--list-scale))` 缩到 6px 不可读（需求池 476 行，实测复现 12px→6.0036px）。**改 CSS 两处 font-size 固定 12px**（只缩列宽不缩字；shot-name 13px/shot-meta 11px/表头 11px 本就不随 scale）。验证：WebBridge 6/6（关/开/调宽 400/还原全 12px + scale<1 列宽照缩 + CSSOM 确认新规则）+ 编辑态 4/4（开预览进 textarea 编辑 12px 与显示态一致）

**v0.9.68 台词拖拽撤销消失修复（2026-08-10）**：moveOrSwapDialogue 原两次独立 update 各 push 一条 undo，一次撤销只回放一条（移动场景 dst 恢复空 + src 也空 = 台词凭空消失，需求池 474 行 bug 实测复现；互换场景两边错乱）。**新增原子 action `move_dialogue`**（POST /api/shot/{src} body dst_id：一次写两镜头 + 单条 undo entry 含 db 两条记录，undo_action 的 db 循环一次回放全恢复；写失败回滚第一个写；dst_id 空/等于 src/不存在均拒绝）；前端单请求 + 失败回滚简化（原 done 数组补偿逻辑删除）。验证：API 20/20（移动/互换「操作→一次撤销→全恢复」+ 4 边界拒绝不污染）+ WebBridge 14/14（时间线合成拖拽台词条 → CDP Ctrl+Z（modifiers:2）→ DB/DOM/state 三层全恢复）

**① 标题栏搜索框页面居中（2026-08-10）**：.header flex space-between 改 grid 三列 `minmax(0,1fr) minmax(160px,300px) minmax(0,1fr)`——搜索框严格页面居中（原位置偏右 100px 实测）。**三个方案坑**：①flex auto margin（0 auto）只平分「标题右缘↔按钮左缘」空隙不居中（左右 item 宽不等时中心偏 100px，实测 margin 424.6/424.6）②absolute left:50% 居中正确但窄窗固定 300px 与标题重叠（818px 窗口重叠 14px）③grid minmax 中间列是 non-flex 轨道优先最大化到 300 不收缩 + justify-self:start 阻止 stretch（h1 宽=内容宽溢出列）——最终 = minmax(0,1fr) 允许收缩 + h1 默认 stretch + min-width:0/overflow/ellipsis 窄窗省略。验证 4/4：offset ±0.2px / 搜索下拉对齐 / resize 保持 / 窄窗精确相接。另：patch 大段 old_string 曾误删 .search-wrap input/.search-results/.search-item 系列 10 条规则，grep 计数核对后恢复（patch 后必须核对规则数）。

**v0.9.66（压行，未推，详情曾在本文件）**：时间线垂直 resize 实时匹配（tlResizeLayout 布局重算——先 applyTlSplit 定稿 stage 再读 inner 设 lane，flex 先重排拿中间态坑；resize 监听 timeline 分支改调它绕过 w!==w0 门控）

**v0.9.65（压行，未推，详情曾在本文件）**：时间线缩放中心改画面中心（tlAnchor 返回视口中心所在 clip+frac，finalScroll = 新布局同比例位置 - clientWidth/2；无选中也可锚定；判画面中心移动看 frac 差不是 clip id）

**v0.9.64 五项（压行，未推，详情曾在本文件）**：时间线外部拖图（分区按预览/缩略图实时比例 + 合成 File 真实副作用必还原）/ 时间线右键菜单展开折叠（执行零改动，菜单点完即关）/ 其它视图宫格列表切换修复（renderOtherGrid 管 list-mode + 空态清残留）/ 时间线中键右键横滑（dy 归零 dx 驱动 scrollLeft + 惯性）/ 横滑弹簧（过冲 transform 加滚动容器自身防污染 scrollWidth；同向推墙 delta=0）

**坑（v0.9.64 新增）**：
- **transform 污染滚动边界**（⑤，重点）：滚动容器内容的 transform 让 scrollWidth 减小（实测 -160px → maxSl 3713→3553），Chrome 在滚动区尺寸变化时自动 clamp scrollLeft → 位移类 transform 回弹后内容露出。**过冲/位移 transform 加在滚动容器自身**（容器 transform 不影响自身 scrollWidth，探针验证），别加内容元素
- **同向推墙必须 delta=0**（⑤）：撞墙分支吃阻力后本次位移全转成过冲（宫格 dy=0 同款），漏置 0 会每步重复滚动+过冲叠加（scrollLeft 漂移 40px 实测）
- **合成 File 真实可读**（①，推翻 pitfall 294「FileReader 永不回调」）：WebBridge evaluate 构造 File + FileReader 回调成功 → drop 测试真实执行后端请求（set_background/创建镜头）——拖图类测试必须记录测试前状态并还原副作用
- **菜单点完即关**（②）：menuAction 先 hideContextMenu 清 contextShotId——连续菜单操作（全部展开后再全部折叠）必须重新右键弹菜单；展开后 .multi class 被摘除，定位用 data-id
- **测试拖动方向易反**（④⑤）：合成 mousedown/mousemove 的 dx_step 符号 = 鼠标移动方向；滚动方向与内容位移方向相反（delta=-dx）；撞顶墙 = 鼠标下移（scrollBy 负向）；scrollLeft 断言带 ±2 容差（subpixel 吸附，pitfall 41）

**v0.9.61-63（压行，未推，详情曾在本文件）**：其它/垃圾桶四按钮（时间线/预览/创建/台词）统一灰掉+去蓝底（syncViewToggleButton 收编必经入口）/ 时间线框选批量选中+悬停扫视（clip 补 multi/expanded class + 扫视三形态查找链）/ 时间线双击镜头号改名+时长编辑（.tl-clip-name/.tl-clip-meta cell-edit）/ 宫格卡片事件全集盘点（缺 5 已补 2 剩 3 → v0.9.64 全清）

**历史轮次**（详情曾在本文件，已压缩；关键决策见「交互/设计约定」与「坑」）：

- v0.9.58~60（压行）：台词条只有选中才高亮（v0.9.57 回勾）/ 卡片时长+镜头号字号对齐宫格 / 关台词动画（含 v0.9.53 wrap 重建回归修复）/ 列表+垃圾桶其它创建按钮灰掉（.bar-btn.disabled 体系起始）/ 字幕浮层以画幅定位 / 镜头号上下间隔对称 / 列表台词按钮去蓝底+垃圾桶其它时间线按钮灰掉（61 收编统一）

- v0.9.56：工具条图标归一化（SVG 内容 bbox 统一 800 单位，getCTM 验证）+ 时间线缩放滑块 apply 去重吞交互回归修复 + 中间工具条 1.5 倍放大 + 预览区下缘跳帧工具条（moveTlFocus ±1/±5）+ 工具条按钮组居中 + 快捷键面板 Tab 标签页（scope 全局/时间线）
- v0.9.55：TAB 切最近两视图（prevViewMode MRU，兜底 grid↔list）+ 时间线预览区淡入上升 500ms（50ms 肉眼不可感知拍板）+ 切时间线自动关侧边预览（preview-on 残留挤扁时间线，setPreview 只拦开不拦关）+ 预览区画幅比对齐（同款 cover/contain + aspect.js 选择器合并）+ 预览区间距 16px（按缩放滑条基准两轮拍板）；坑：部署后用户 Edge 跑旧 CSS 先 Ctrl+F5、Element 无 .bottom 属性（getBoundingClientRect）、__aspectApply 是调试句柄
- v0.9.53 需求池 1-2/12：时间线 ↑↓/滚轮横向滚动（一次 3 镜）+ 舞台语义（无边框/两侧 15% 淡出遮罩/滚动极限 15%/85%/内容不足 70% 居中/←→与搜索 tlReveal/台词条拖宽钳 85%）
- v0.9.52：时间线台词条「镜头位」语义 {m,p}（盖 N 镜 + 第 N+1 镜 p%，任何档位比例恒定；旧 {w,base} 渲染换算兜底）
- v0.9.51：时间线帧图区域 16:9（文字条贴画面零露边，非 16:9 图仍 contain 露边拍板保留）
- v0.9.50：时间线展开态文本条透底衬修复（同特异性覆盖插序坑：改本规则别加覆盖）
- v0.9.49：时间线展开态消除两层底（frame-img 露边背景改 --bg-frame-cell 融入总底/选中 --bg-frame-selected，纯 CSS，修复前后同区域对比验证）
- v0.9.48：时间线展开态焦点对齐宫格（:has(.tl-expand-row).selected 隐藏 clip 外框、row 底衬 --bg-frame-cell、选中变色、名字条透底）
- v0.9.47：时间线展开态键盘帧级焦点（宫格同款格子序列 + focusedFrameId 蓝框 + stage 跟随 + Shift 掩码 modifiers:8）
- v0.9.46e：时间线折叠闪大图修复（浮层 cell 挂 body 组合选择器失效 → 关键元素 inline 样式 width/aspect-ratio/object-fit）
- v0.9.46d：时间线折叠 FLIP 时序改宫格同款（帧格 fixed 脱离文档流 → 立即 toggle+renderGrid → 浮层飞回+淡出，其它 clip FLIP 随子帧图同时收回，不等 380ms；target 用 rects[0]）
- v0.9.46c：滑动缩放滑条后 T 键无反应修复（range 滑块门控白名单误伤无修饰键快捷键，改黑名单只拦原生调值键；注释与代码脱节核对）
- v0.9.46b：台词条与镜头块绑定（用户拍板 A+B）——台词条水平 FLIP（重排跟 clip 一起滑，含缩放滚动补偿，跳过 leave/in 块）+ 时间线 clip 拖拽启用（v0.9.36 遗留转正：竖线指示线+半区判定天然适配）+ 拖拽中台词条水平跟手（y 不跟）；DOM 父子化评估否决（破坏 z 层级/轨道语义拍板）
- v0.9.46：时间线缩放 FLIP 以焦点镜头为中心向两侧扩散——锚定并入 renderTimeline(anchor)（finalScroll = 新布局焦点中心 - 锚定 rel，clamp [0,maxScroll]），FLIP 起点 dx = old-new+(finalScroll-prevScroll)；tlAnchor 改布局坐标（offsetLeft+offsetWidth/2-scrollLeft 防 transform 污染）；tlRestoreAnchor 删除
- v0.9.45b：时间线多图展开/折叠（宫格同款交互：双击/空格/右键/折叠按钮/角标；展开=帧格连片 n×(clipW+9)+2，xPos 累计）+ 状态分开保存（expandedShotIdsTl，互不同步）+ 弹簧动画（展开 0.5s SPRING 错峰 40ms / 收起 0.35s ease-in 错峰 30ms）+ 宫格语义对齐 7/7（焦点跟手/stage 跟随焦点帧/Ctrl 多选/FLIP 避让）
- v0.9.45：时间线台词条「前面盖后面」（DOM append 反转，z-index 不动）+ 字幕浮层多行（盖住判定=台词条右缘>后 clip 左缘，多盖住者按序全显，跟随 T 开关）
- v0.9.44b：拖放目标焦点框 :hover 特异性修复（选择器加 .shot-card 提 (0,3,0)）+ ESC 取消卡片/台词拖拽（drag 置 null + 源复位四步）+ 台词条层级下沉（z 1 < clip 2，拖拽态 60 保持）
- v0.9.44：拖拽目标高焦点框（实色 2px accent 环 + 18px 光晕）+ 坑 346 修正（截图垂直偏移随窗口漂移，PIL 必须锚点自校准）
- v0.9.43：时间线台词拖拽移动/互换（宽度 map 跟随）+ 台词开关 FLIP 动画（长出来/收回去，leaving 保护防翻倍）+ 修 moveOrSwap 成功路径不落盘宽度 map 遗留 bug
- v0.9.42：时间线台词自动大小比例跟随（map 值升级 {w, base} 比例语义，旧数字兼容固定像素）
- v0.9.41：时间线卡片菜单补台词三项（添加/编辑/自动大小）+ 台词块拖宽手柄（钳制 #timeline 可视右缘）+ startTlDlgEdit 添加模式（临时块 lastOrder 定位）+ setDialogueAuto 修跳变（固定当前显示宽）——WebBridge T1-T11 全 PASS
- v0.9.40：时间线切换按钮图标更换（用户指定 SVG）+ 预览/缩略图区比例完全自适应（分隔条移除）+ 台词双击就地编辑（单行 input）+ 台词框右键菜单（编辑/自动大小，viewMode 分流修 startDlgEdit 插父条 bug）——推前全量 77/77，版本 0.9.39→0.9.40
- v0.9.39：时间线借空间（clip 超高撑上沿不滚页、stage 保底 180，推翻"撑开=页面滚动"）/ 时间线按钮进工具条（预览锁定高亮不可关）/ 宫格排不满修复（clientWidth 整数舍入 + toFixed 四舍五入差 0.01px 掉一列，改 rect 小数宽 + 0.05px 余量）——用户拍板跳过全量回归直接推
- v0.9.38：时间线五项（台词块上移/缩略图 contain 左对齐+最小极值×2/等比缩放推翻 292/分割条 7:3 可拖/下沿对齐+缩放锚定）+ 档位化/借空间机制雏形（后两版推翻分割条）
- v0.9.37：时间线去时间轴改版（标尺删、clip 等宽不∝时长、4:3 缩略图）+ 快捷键全盘落地（方向键线性/空格禁/门控盘点）+ 宫格缩放两修复（Ctrl/Meta 放行/切回宫格摘 timeline-mode class）
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

- **v0.9.41 ~ v0.9.73 已推 GitHub**（v0.9.73，2026-08-11：推前干净库全量 89/89 全 PASS（47+12+30），版本号 0.9.70→0.9.73（bl_info+index.html 徽章两处）；批次含屎山治理批 A（inline_edit.js + audit_lib.py + handler 表化）+ 五代兼容层退役 + 预览小图修复 + CSS 2255 行拆 4 part + queue.py 三拆 + v0.9.72 拖宽动态钳制；**审计脚本增强已推**（2026-08-10：s13 move_dialogue 段 + timeline 段 + cleanup 时序修复，版本号不升）
- 待办，等用户逐项指派：宫格缩略图下缘黑条（观察项，先不动）；需求池 Phase 2 未勾项已全部回勾（474/476/477/478/473 均 [x]，2026-08-10 开局核对）；Phase 3 四大项（VSE 串片/animatic 预览/垃圾桶其它侧边栏/实时视口零延时）为长期大项，不在当前范围
- 盘点未补 3 项已全部补齐（v0.9.64）：时间线右键菜单展开/折叠、外部图片拖入、中键/右键滑动翻面横滚时间线

## 下一步

- **稳健性待办（v0.6.3 对抗审计产出，用户已阅，优先级低暂缓）**，按性价比排序：
  1. **主线程预算**：`process_queue` 一次排空全队列，批量重渲染 = UI 冻结整场渲染；改每 tick 1 个重命令
  3. **创建原子化**：makedirs 挪到 DB 写入前（SMB 抖动即孤儿记录，P9 实锤）
  4. **写事务合并**：批量操作共用一条 SQLite 连接+事务，顺手修 seq 分配竞态（P4 实锤 16 并发 12 重复）
  5. **DB 备份**：shots.db 启动时轮备 .bak1/2/3（SMB 单点零备份）
  6. **静态文件 Cache-Control: no-cache**：治"部署了但浏览器跑旧 JS"玄学
  7. **sync 自动对账 name/scene/dir 三元组**：孤儿场景从"只报告"升级为自动收敛（c0030 事件）
  8. **.blend 体积治理**：FULL_COPY 复制重场景让 1.4GB 文件持续膨胀
- **减屎山候选（2026-08-10 代码质量静态评估产出；批 A ①②③ 已落地——见刚做完屎山治理批 A）**，剩余按性价比排序：
  1. ~~三份就地编辑 input 模板合一~~ **已落地（批 A ①，inline_edit.js）**
  2. ~~审计三脚本公共模板抽共享模块~~ **已落地（批 A ②，audit_lib.py）**
  3. ~~shot_action 按 action 拆 handler 表~~ **已落地（批 A ③，_ACTION_HANDLERS）**
  4. ~~兼容层退役线~~ **已落地（五代退役，见刚做完）**——五代格式兜底全删（老库迁移/png 读取/目录 {id} 迁移/台词宽度远古格式/thumb.jpg legacy），顺手修 Sync Scenes 按钮解构 ValueError 既有 bug
  5. ~~CSS 2255 行单文件拆分~~ **已落地（2026-08-11 方案 A：切 4 part 按序 link，块扫描器确认切分点，CSSOM 389 条逐条相等验证）**——切分点必须落在规则块间隙（原始 600/1200/1800 边界全在块内会丢规则）；新 CSS 按区域写入对应 part，禁止调整 link 顺序
  6. ~~queue.py 953 行 30 函数拆分~~ **已落地（2026-08-11 方案 B 三拆：queue 机制 + commands_shots + commands_frames）**——公开 API re-export 零调用方改动，干净库全量 89/89 全 PASS
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
- **字幕浮层以画幅为基础定位（v0.9.58）**：.tl-stage-frame 画面容器（画幅形状 + position:relative），字幕 absolute 相对 frame 底 14px（电影字幕位）——画面矮于容器时浮层仍在画面上，不落留边区
- **多图展开/折叠（v0.9.45b）**：双击 / 空格（多选批量）/ 右键菜单 / 折叠按钮 / 帧数角标；展开 = 帧格横排连片（每格 clipW、间距 9px、右缘折叠按钮位，clip 宽 = n×(clipW+9)+2），后续镜头顺移（xPos 累计）；弹簧动画宫格同款；**展开状态与宫格/列表分开保存**（expandedShotIdsTl，刷新全折叠）；帧格点击焦点蓝框跟手 + stage 大图跟随焦点帧 + 帧级右键菜单/双击跳帧

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
| 拖拽驱动 | CDP 真实鼠标 `mousePressed` + `mouseMoved` **带 `buttons:1`**（多次送达，不带 buttons 只送第一次）；ESC 取消验证 = `Input.dispatchKeyEvent` Escape；**合成事件不驱动 CSS :hover**——验证受 :hover 影响的样式必须真实鼠标 + computed |

## 坑（已踩过的雷）

### 近期（v0.9.72，未推）
- **正式工程连续渲染后 OpenGL 挂起**（2026-08-11 全量审计实测，与代码无关）：bpy.ops.render.opengl(write_still=True) 在 timer 主线程调用后**不返回**（主线程栈可见卡在 _op_call）→ timer 停摆 → queue 积压（qsize 可达 50+）→ API 线程饿死假死（先 timeout 后 ConnectionRefused）。重启 Blender 后单次渲染正常，但跑几分钟连续渲染（创建/拍帧/重拍/复制）后又挂——**大场景正式工程触发，干净库小场景不触发**；非最小化/前台窗口无关（IsIconic=False 实测）。处置：全量审计只在干净库跑（推前标准姿势，AGENTS 已有），正式工程只跑段级 --only；挂起后重启 Blender 恢复。诊断手法：MCP（独立线程）查 sys._current_frames()[主线程].stack 定位卡点 + qsize 积压确认。
- **rename_seq 候选名只查 DB 不查场景**（2026-08-11 实测）：_batch_rename_seq 的 name_exists 只查 shots 表 name，cmd_rename_shot 有场景层冲突保护（`Shot_{name} in bpy.data.scenes` raise）——正式工程有**残留场景 Shot_c0010**（DB 无记录，历史删除不彻底）时批量改名候选名撞场景 → rename_shot 报 "Scene Shot_c0010 already exists" → 该镜头停在 __ren_ 前缀（两阶段改名 phase2 失败）。**既有设计缺口非本轮引入**（拆分前后行为一致）；干净库无残留场景不受影响。用户工程可在网页「其它」视图找到残留场景手动处理。
- **时间线台词条 {m,p} 格式物理下限 = clipW+GAP**（拖宽钳制改动态变量时实测）：w < clipW+GAP 落盘 {m:0,p:0} 渲染回 clipW+GAP（≤12px 回弹）——拖宽下限若设 clipW（用户语义「最短=镜头宽」），拖到最左松手会回弹 12px，是格式固有边界非 bug；上限 3×(clipW+GAP) 恰好落 {m:2,p:0} 无回弹
- **initDialogueResize 的 rAF 节流**（拖宽测试两轮假 FAIL）：onMove `if (raf) return` + requestAnimationFrame 应用宽度——同一 evaluate 同步 dispatch 多个 mousemove 只应用第一步（后续被短路），同步读 offsetWidth 必读到未应用值。分步拖宽 = 每步独立 evaluate + sleep 0.07 等 rAF
- **WebBridge evaluate 里 localStorage.setItem 第二参传对象字面量 = 写坏**（`setItem('k', {"a":1})` JS 隐式 toString → "[object Object]"）：恢复持久化状态必须 `setItem(k, JSON.stringify(<JSON文本>))` 包一层；ev() 读 localStorage 返回值 dict/str 不确定（坑 36），写回前先 map_of 归一

### 近期（v0.9.54，未推，详细）
- **zoomApply 的 timeline 分支无条件重渲染 renderTimeline**（v0.9.54 实测两处踩）：setView 末尾/fetchShots 后（data.js 17 行）都会调 __zoomApply——timeline 分支里值没变也照渲（lane.innerHTML 重建）→ 刚播的入场动画/刚设置的内联样式全被清掉（切视图/首屏直落动画假死，探针全 N 排查 4 轮）。**修复 = 分支里算出的档位 w 与持久化 w0 相同（纯同步调用）时跳过 renderTimeline**；滑块/±/Ctrl 滚轮路径都先写 sb-tl-w 再 apply，值必变不受影响。判别：动画起点已提交（computed 有 matrix）但下一帧消失 = 被后续重渲染重建清掉，查调用链里 renderGrid 之后还有没有 zoomApply/renderTimeline
- **一次性标志不能在 renderTimeline 开头清空**：initZoom 初始化在 shots 到达前会先空渲染一次（shots 空分支 return）——开头清标志 = 首屏直落标志被空渲染提前吃掉（首屏动画永远不播）。消费点唯一 = 真正执行动画的入场段内部
- **入场动画内联样式必须 1.1s 后摘除**（transform/opacity/transition/delay 全清）：残留 transform 会污染后续拖拽坐标与 FLIP 测量（坑 346 同源）；动画播完 computed 必须回 none/1

### 近期（v0.9.53，未推，详细）
- **舞台滚动极限必须物理可达——inner 宽 = 内容占位 + 15% 尾部空间**（滚到底 7727 vs 期望 7863 实测）：舞台 max = 末 clip 右缘 - 0.85W，浏览器物理 max = scrollWidth - clientWidth；inner 宽度只算到内容右缘时物理极限不足（差 136 = 15% 视口），setTlScroll 的 max 被浏览器吃掉。**正确公式 `inner = round((base + totalW - 32) + 0.15×clientWidth)`**（totalW 含左右 padding 32；base 替代原 16 起点）
- **tlReveal 方向符号**（reveal 后目标反超 85% 实测）：左缘进带 → `x += L - 0.15W`（向左滚=内容右移）；右缘超界 → `x += R - 0.85W`（向右滚=内容左移）。写反 = 把目标越推越远。scrollLeft 增大 = clip 视口位置减小
- **CSS 变量名写错是静默的**（遮罩渐变 computed backgroundImage=none，z-index/宽高都正常只有渐变消失）：皮肤变量没有 `--bg`——页面背景 = `--bg-body`（#1a1a1a）、卡片 = `--bg-card`（#252525）；`linear-gradient(var(--bg), ...)` 整条声明静默失效。**渐变/背景类视觉改完必须读 computed backgroundImage 验证**
- **舞台滚动的视口坐标判据**：clip 视口位置 = offsetLeft - scrollLeft（offsetLeft 是布局坐标不随滚动）；台词条拖宽钳制同坐标系（scrollLeft + round(0.85×clientWidth) - 16 - box.offsetLeft）
- **搜索定位时间线分支**：locate 调 renderGrid() 会重建时间线 DOM——旧 el 脱离 DOM 直接 scrollIntoView 无效；渲染前记 clip id、渲染后重新 querySelector 再 tlReveal
- **居中场景（内容不足 70% 视口）**：两遍法——先算 totalW（净内容宽），totalW < 0.7×clientWidth 时 base = (W-totalW)/2 居中、否则 base = 0.15W 左贴；tlScrollMinMax 里 totalW < 0.7W 直接 min=max=0（不滚动）
- **CDP 测滚轮位移**：mouseWheel deltaY 通道 ×10/11 换算（120→109.09）——断言用页面探针实际 dy（kimi-webbridge 坑 40）

### 近期（v0.9.52，未推，详细）
- **间隔固定 12px 下「像素比例」≠「镜头位」**（台词条缩放漂移实测）：v0.9.42 {w,base} 像素比例语义，gap 占位随档位变（52 档 18.8%、316 档 3.7%）→ 折算成"盖住几个镜头"漂移（c0030 最小档盖 2.66 位、最大档 3.14 位）。**视觉锚定（盖到第 N 个镜头 p%）必须用镜头位语义**：渲染 w = (m+1)×(clipW+GAP) + p×clipW（m=完整盖住的后面镜头数、p=再下一个百分比）；换算旧 {w,base} 时 ext = w-base、m = floor(ext/(base+GAP))、**p = (ext - m×unit - GAP)/base——剩余要减最后一个 gap**（漏减 = 百分比虚高，实测 0.187 vs 正确 0.149）
- **dlgEntry 只认 w 字段 → 新格式 {m,p} 被判 null = 自动大小回退**（拖宽落盘后 reload 变回 clipW 宽，假象"没存上"）：归一化读取必须显式兼容新格式（`typeof v.m === 'number' && typeof v.p === 'number'`）
- **getDialogueWidth 的 `if (!e.base) return e.w` 误伤无 base 的新格式**：{m,p} 提前 return undefined → 宽变内容撑开（109px 假象）。判断顺序 = 新格式优先 → 宫格固定像素（有 w 无 base）→ 旧 {w,base} 换算
- **scrollIntoView block:center 只居中 box 不保证手柄可见**：台词条手柄在 box 右缘，长条时手柄仍超视口右缘 → CDP 点击静默无效（拖宽假 FAIL）。拖宽前手动 `tl.scrollLeft = box.offsetLeft + box.offsetWidth - tl.clientWidth + 60` 再取坐标

### 近期（v0.9.50，未推，详细）
- **同特异性 CSS 覆盖规则必须插在目标规则之后，或直接改目标规则**（文本条大灰条实测，pitfall 350 同源）：v0.9.48 把 `.timeline-clip .tl-expand-cell .tl-expand-name { background: transparent }` 插在原规则（2036 行）之前——同特异性 (0,3,0) 后定义赢，--bg-card 覆盖 transparent，规则静默无效（用户实测抓包"底衬上有个大灰条"）。**教训：加"覆盖"规则前先查目标规则的 CSS 行号与特异性；验证 CSS 覆盖必须 computed 读目标属性（v0.9.48 只验了 rowBg/imgBg 漏了 nameBg——交付验证清单 = 本轮改动的每个 CSS 属性都要读一遍 computed）**

### 近期（v0.9.47~49，压缩）
- v0.9.49：视觉修复验证用「修复前后同区域截图对比」比绝对色值断言稳（相邻同色背景污染绝对阈值）；帧格间距竖条是纯底衬色干净采样点
- v0.9.48：展开/折叠后再截图必须先重新 scrollIntoView（展开改变元素宽，旧几何滚动失效 → PIL 全背景色假 FAIL）
- v0.9.47：CDP 不维护修饰键按下状态——组合键测试必须目标键事件直接带 modifiers 掩码（Shift=8），先发修饰键 keyDown 无效

### 近期（v0.9.46d~46e，压缩）
- v0.9.46e：DOM 脱离流（fixed 挂 body）后组合选择器全失效 → 临时移动 DOM 必须给关键元素设 inline 样式（width/aspect-ratio/object-fit）
- v0.9.46d：折叠动画必须「先脱离流再重建」（帧格 fixed 脱离文档流 → 立即 toggle+renderGrid → 浮层飞回+淡出），FLIP 随子帧图同时开始；target 用 rects[0]

### 近期（v0.9.46c，未推，详细）
- **range 滑块门控 = 只拦原生调值键，别用白名单**（T 键 bug 实测）：拖动滑块后焦点留在 range，白名单（Tab+Ctrl/Meta）会把所有无修饰键快捷键（T/Enter/Delete/空格/V）误伤；range 的原生行为只有方向键/Home/End/PageUp/PageDown，黑名单拦截即可。另：注释声称"Delete 已放行"但代码没实现——改快捷键门控时核对注释与代码一致

### 近期（v0.9.46/46b，压缩）
- **FLIP 起点必须含滚动补偿 + 锚定测量禁用 getBoundingClientRect**（缩放锚定）：缩放重排+滚动补偿组合中 FLIP 起点 = 纯布局差会让焦点镜头动画滑 i×(w1-w0)；tlRestoreAnchor 用 rect 算补偿被 FLIP 起点 transform 吃掉（924→11.8px）。正解 = 锚定并入渲染 + FLIP dx 含 (finalScroll-prevScroll)；测量用 offsetLeft（不受 transform 影响）。验证判据：焦点中心抖动 = 半宽差
- **台词条 FLIP 门控**：.tl-dlg-in/.tl-dlg-leave 的 animation 覆盖 inline transform——FLIP 循环跳过这两类块（in 块旧 DOM 无记录天然跳过）
- **拖拽中台词条跟手只跟 dx**（台词条属台词轨道，垂直跟飘出）；finishDrag 先清 transform 再 reorder（FLIP 起点 = 布局旧位置不跳）
- **时间线 clip 拖拽适配点**（v0.9.36 遗留转正）：竖线指示线+半区判定天然适配；nearestCard GAP_HIT_MAX=24 对 gap 12 成立；.shot-card.dragging CSS 通用；台词条（.tl-dlg-clip）不是 .shot-card 与 clip 拖拽天然互斥

### 近期（v0.9.44b~45b，压缩）
- **cell 双层嵌套**（对齐测试抓出）：工厂函数返回纯内容（img+name），容器由调用处创建并挂 data-* 属性
- **FLIP 必须 reflow 提交起点**：设起点后 `void c.offsetWidth` 强制 reflow 再恢复 transition + 清 transform（仅 rAF 清在时间线起点从未上屏）
- **xPos 累计排位**：展开镜头占多列宽 → left 公式失效，模块级 xPos Map（renderTimeline 每轮重建，台词条/startTlDlgEdit 复用）
- **focusFrame 选择器补时间线分支**：`.timeline-clip[data-id] .frame-img[data-frame-id]`；清框全局选择器天然覆盖；stage 大图跟随焦点帧（focusedFrameId 优先，无则封面）
- **台词条「前面盖后面」= DOM 反转**（z-index 不动）；⚠️ patch 模糊匹配曾把 reverse 误还原（old_string 带全上下文）
- **字幕浮层多行判定**：盖住 = 台词条 offsetLeft+offsetWidth > 后面 clip offsetLeft（严格大于防紧贴）；多盖住者按镜头顺序全显 + 自己台词最下；跟随 T 开关
- **__sb 无 toggleDialogue**：测试驱动用 CDP 真实按键（KeyT），`__sb.toggleDialogue && ...` 静默无效
- **同特异性后定义 :hover 覆盖吃焦点环**（坑 350）：修复 = 选择器提特异性；凡视觉受 :hover/:active/.selected 影响必须 CDP 真实鼠标 + computed 读最终值（合成事件 PASS 是假象）
- **ESC 取消拖拽模式**（卡片/台词两处同款）：keydown capture drag 置 null + 源复位四步（transition none→清→reflow→恢复）+ 清 dragging/dlg-dragging class + hideDropIndicator()/clearTarget() + userSelect 恢复
- **截图 SY 可 0 可 60-68 漂移**（坑 346/348）：PIL 像素验证必须截图内锚点自校准（扫描 accent 边框行定位），禁止写死偏移；x 不加偏移；诊断「边缘/边框采样不到」先逐行色带扫描定位元素真实边界

### 近期（v0.9.42~44，压缩）
- v0.9.44：拖拽目标高焦点框（实色 2px accent 环+18px 光晕）——同特异性靠后定义覆盖，验证用 computed + PIL
- v0.9.43：台词开关动画 leaving 保护（leave 块在播时跳过 innerHTML 清空、只删非 leave 旧块防翻倍）；moveOrSwapDialogue 成功路径补宽度 map 落盘（原宫格遗留：只改内存不写 localStorage）
- v0.9.42：时间线自定义宽 = `{w, base}` 比例语义（宫格 base=null 固定像素、旧纯数字兼容）；**测试坑：localStorage 直写与模块闭包不同步**（setItem 后闭包旧值覆盖写回，还原/清理必须 reload 重建闭包或走真实路径——坑 288/33 镜像）
- v0.9.41 样式两坑：台词块 overflow:hidden 裁右缘外拖宽手柄图标（overflow 移到 .tl-dlg-text）；拖宽钳制可视右缘用 `#timeline.scrollLeft + clientWidth`（lane.clientWidth 是内容宽，76 clip ≈14000px 假上限）
- 测试坑：宫格卡片右键落在缩略图区 = frameId 命中 → menuAction 帧 switch 吞掉卡片 action；菜单按钮点击用 CDP 真实点击比合成 click 稳

### 近期（v0.9.40，精简）
- **菜单「编辑台词」必须按 viewMode 分流**：宫格版 startDlgEdit 查 grid 的 .dialogue-box，时间线模式下会把 .dialogue-strip 插进时间线 lane（错乱）；时间线走 startTlDlgEdit。凡复用"宫格台词交互"的函数，先查它内部是否 querySelector grid 元素
- **时间线台词编辑 = 单行 input**（用户拍板无换行功能），与宫格 textarea 多行区分；提交共用 commitDialogue（render.js 导出）
- **menu.js 注释与代码会脱节**（注释写"时间线台词编辑保留"实际 isTimeline 排除台词项）：改菜单行为以代码为准，注释随手核对
- **测试脚本状态污染**：诊断脚本点过 dlg-auto 后不还原 = localStorage map 丢条目（用户自定义宽度被删）；测试/诊断脚本对持久化状态的写操作必须收尾还原（含被误删的条目值）

### 近期（v0.9.35~v0.9.38，压缩）
- v0.9.38：flex item 百分比高度在 main size indefinite 塌 0（正解 absolute inset:0）；flex-shrink 默认 1 压缩相邻 item（显式 flex-shrink:0 + min-height）；ESM import 不存在的导出 = 整链白屏（node --check 测不出，动态 import catch 诊断）；时间线缩放锚定 scrollLeft clamp 物理限制（测锚定选视口内 clip）；档位化漂移（持久化为唯一事实源，apply 幂等）；grid gap 12 时间线同样生效；applyTlSplit 只在 renderTimeline 跑；clientWidth 整数 vs 真实小数宽 0.26px 临界掉一列（用 rect 小数宽 - 0.05px 余量）
- v0.9.37：renderGrid 切回宫格必须摘 timeline-mode class（残留 flex column 缩放失效）；range 滑块门控放行 Ctrl/Meta 组合键（方向键仍门控）；横轴缩放 apply 幂等防刷新直落污染档位；缩放断言防 clamp 边界（先查 slVal==slMax）
- v0.9.36：独立布局视图必须清残留卡片（76 张≈48000px 推飞页面）；惰性容器"已建"标志位被外部清 DOM 失真（纯 DOM 存在性判断）；复用模块函数注意内部绑定的 DOM 引用（showPreviewImage 写死模块级 img，加 target 参数）；刷新直落持久化视图时 setView 不执行（副作用放 renderXxx 内）
- v0.9.35：async 互斥切换未 await = 双 fetch 并发竞态（垃圾桶其它页可能 purge 正常镜头，必须串行）；mousedown 里 blur 被浏览器默认聚焦抢回（click 后 blur + e.detail 区分输入来源）；合成 KeyboardEvent 不触发 :focus-visible（CDP 真实输入）；空态提示 absolute 随容器高度塌缩（容器转 flex + min-height）

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
- 后端模块地图：`core/server.py`（ROUTES 表 + 静态服务）→ `core/actions.py`（每端点一函数；shot_action = `_ACTION_HANDLERS` 表分发 14 个 `_act_xxx`，v0.9.71）→ `core/queue.py`（COMMANDS 注册表 + 错误回传 + redraw_view3d）/ `core/db.py`（含 next_c_name/next_c_number）/ `core/undo.py`（撤销栈）/ `core/paths.py` / `core/scenes.py`（场景工厂）/ `core/sync.py`（同步唯一实现）/ `core/render.py`（拍屏公共函数）
- 前端模块地图（22 个 JS）：`web/index.html`（骨架+CSS）+ `web/js/`：state（共享状态）/ ui（toast+确认条）/ render（宫格+列表+FLIP+DOM差分+首屏门控）/ data（拉取+心跳+错误toast+undoLast）/ selection / dnd（卡片拖拽+拖图分区）/ frames（帧级操作）/ rename（改名+字段就地编辑）/ inline_edit（v0.9.71：就地编辑输入框生命周期共享模板）/ menu（右键/中键滑动+回弹+菜单）/ create（弹框）/ marquee（框选）/ zoom（滑块+Ctrl滚轮连续缩放）/ keyboard（快捷键+方向键）/ trash（垃圾桶弹窗）/ search（搜索栏定位）/ preview（预览框）/ shortcuts（快捷键面板）/ aspect（画幅比）/ icons（图标表+注入）/ timeline（时间线视图）/ main（入口接线）
- 改名：`cmd_rename_shot`（queue.py）四层联动实现
- 测试：改完跑 `python3 scripts/audit.py`（47 项）+ `python3 scripts/audit_context_menu.py`（12 项）+ 网页 JS 改动 webbridge 全交互回归（web_audit 30 项）
- 基线（2026-08-10）：audit 47 + ctx 12 + web_audit 30 = 89 项（v0.9.70 后新增 s13 move_dialogue 段 + timeline 段；旧基线 42+12+23=77）
