bl_info = {
    "name": "Storyboard Designer",
    "author": "邵保家",
    "version": (0, 9, 27),
    "blender": (4, 5, 0),
    "location": "View3D > Sidebar > Storyboard",
    "description": "Quick previs/storyboard design system",
    "category": "3D View",
    "email": "shaobaojia_313@163.com",
}

import bpy
import os
import sys
import json
import threading
from bpy.props import StringProperty, FloatProperty, EnumProperty

# Add core module to path
addon_dir = os.path.dirname(os.path.abspath(__file__))
if addon_dir not in sys.path:
    sys.path.insert(0, addon_dir)

from core.db import init_db, get_db_path, create_shot, delete_shot, get_all_shots, get_shot
from core.server import start_server, stop_server, get_server
from core.queue import queue_command, ensure_timer
from core.paths import get_project_dir as _get_project_dir
from core.sync import sync_scenes_with_db


class STORYBOARD_OT_sync_scenes(bpy.types.Operator):
    """Sync Blender scenes with storyboard database"""
    bl_idname = "storyboard.sync_scenes"
    bl_label = "Sync Scenes"
    bl_options = {'REGISTER'}

    def execute(self, context):
        removed, orphans, deduped, dirs_removed, dirs_migrated, frames_removed = sync_scenes_with_db()
        msg = f"Removed {removed} orphan records"
        if deduped:
            msg += f", deduped {deduped} duplicates"
        if dirs_removed:
            msg += f", cleaned {dirs_removed} orphan dirs"
        if dirs_migrated:
            msg += f", migrated {dirs_migrated} legacy dirs"
        if frames_removed:
            msg += f", cleaned {frames_removed} orphan frames"
        if orphans:
            msg += f", found {len(orphans)} unmanaged scenes"
        self.report({'INFO'}, msg)
        return {'FINISHED'}


class STORYBOARD_OT_init_project(bpy.types.Operator):
    """Initialize storyboard project in current blend file directory"""
    bl_idname = "storyboard.init_project"
    bl_label = "Init Project"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        os.makedirs(project_dir, exist_ok=True)
        db_path = init_db(os.path.join(project_dir, "shots.db"))

        # Create project.json if not exists
        project_json = os.path.join(project_dir, "project.json")
        if not os.path.exists(project_json):
            with open(project_json, "w") as f:
                json.dump({
                    "name": os.path.splitext(os.path.basename(bpy.data.filepath))[0],
                    "fps": context.scene.render.fps,
                    "resolution_x": context.scene.render.resolution_x,
                    "resolution_y": context.scene.render.resolution_y,
                }, f, indent=2)

        self.report({'INFO'}, f"Project initialized: {project_dir}")
        return {'FINISHED'}


class STORYBOARD_OT_start_server(bpy.types.Operator):
    """Start HTTP server for storyboard grid"""
    bl_idname = "storyboard.start_server"
    bl_label = "Start Server"
    bl_options = {'REGISTER'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        server = start_server(project_dir, port=8089)
        # Register timer in main thread BEFORE starting server thread
        ensure_timer()
        self.report({'INFO'}, f"Server on 0.0.0.0:{server.port} (LAN accessible)")
        return {'FINISHED'}


class STORYBOARD_OT_stop_server(bpy.types.Operator):
    """Stop HTTP server"""
    bl_idname = "storyboard.stop_server"
    bl_label = "Stop Server"
    bl_options = {'REGISTER'}

    def execute(self, context):
        stop_server()
        self.report({'INFO'}, "Server stopped")
        return {'FINISHED'}


class STORYBOARD_OT_open_manager(bpy.types.Operator):
    """Open the storyboard grid page in the default browser"""
    bl_idname = "storyboard.open_manager"
    bl_label = "打开分镜管理器"
    bl_options = {'REGISTER'}

    def execute(self, context):
        import webbrowser
        server = get_server()
        if not (server and server.running):
            # 服务没起就当场拉起（正常情况下插件加载已自动起好）
            project_dir = _get_project_dir()
            if not project_dir:
                self.report({'ERROR'}, "Save blend file first")
                return {'CANCELLED'}
            server = start_server(project_dir, port=8089)
            ensure_timer()
        webbrowser.open(f"http://localhost:{server.port}")
        self.report({'INFO'}, f"Opened http://localhost:{server.port}")
        return {'FINISHED'}


class STORYBOARD_OT_open_manager_webview(bpy.types.Operator):
    """Open the storyboard grid page in a desktop window (PyWebView shell, same codebase as browser)"""
    bl_idname = "storyboard.open_manager_webview"
    bl_label = "打开分镜管理器"
    bl_description = ("在独立桌面窗口中打开分镜管理器（PyWebView 外壳，"
                      "与浏览器端共用同一套代码）。再次点击 = 关闭旧窗口开新窗口；"
                      "Blender 关闭时窗口随之消失")
    bl_options = {'REGISTER'}

    def execute(self, context):
        import subprocess
        server = get_server()
        if not (server and server.running):
            # 服务没起就当场拉起（与 open_manager 同逻辑）
            project_dir = _get_project_dir()
            if not project_dir:
                self.report({'ERROR'}, "Save blend file first")
                return {'CANCELLED'}
            server = start_server(project_dir, port=8089)
            ensure_timer()

        runtime = os.path.join(addon_dir, '_runtime')
        pyw = os.path.join(runtime, 'python', 'pythonw.exe')
        launcher = os.path.join(runtime, 'launcher.py')
        if not (os.path.exists(pyw) and os.path.exists(launcher)):
            self.report({'ERROR'},
                        f"PyWebView runtime missing: {runtime}（跑 scripts/make_runtime.py 制作）")
            return {'CANCELLED'}

        cmd = [pyw, launcher,
               '--url', f'http://localhost:{server.port}',
               '--blender-pid', str(os.getpid())]
        # 标题栏带插件版本号（bl_info.version）
        ver = '.'.join(str(x) for x in bl_info.get('version', ()))
        if ver:
            cmd += ['--title', f'分镜管理器 v{ver}']
        subprocess.Popen(cmd, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.report({'INFO'}, "Opening manager window (PyWebView)")
        return {'FINISHED'}


# --- Shot Management ---

class STORYBOARD_OT_create_shot(bpy.types.Operator):
    """Create new shot: new Scene + camera + metadata"""
    bl_idname = "storyboard.create_shot"
    bl_label = "Create Shot"
    bl_options = {'REGISTER', 'UNDO'}

    shot_name: StringProperty(name="Shot Name", default="c0010")
    duration: FloatProperty(name="Duration", default=2.0, min=0.1)

    def execute(self, context):
        from core.scenes import create_shot_scene
        from core.paths import shot_dir as _shot_dir

        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        scene_name = f"Shot_{self.shot_name}"
        new_scene = create_shot_scene(self.shot_name, scene_name,
                                      template_scene=context.scene)
        if not new_scene:
            self.report({'ERROR'}, f"Scene {scene_name} already exists")
            return {'CANCELLED'}

        # Create DB record
        db_path = get_db_path(project_dir)
        shot_id = create_shot(db_path, self.shot_name, scene_name,
                              camera=new_scene.camera.name, duration=self.duration)

        # 按填写的时间设置场景帧范围（v0.9.0，与网页端 cmd_create_shot_scene 同规则）
        fps = new_scene.render.fps
        new_scene.frame_start = 1
        new_scene.frame_end = max(1, int(self.duration * fps))

        # Create shot directory with readable name: {shot_name}_{shot_id}/
        dir_path = _shot_dir(project_dir, self.shot_name, shot_id)
        os.makedirs(dir_path, exist_ok=True)

        # Auto-render the new shot as frame 0 (create-path auto 拍屏, v0.8.4:
        # 统一 frames 模型，第一帧自动成为封面)；失败不得影响创建本身
        try:
            from core.queue import cmd_render_frame
            cmd_render_frame({
                "scene_name": new_scene.name,
                "shot_id": shot_id,
                "project_dir": project_dir,
                "frame_no": 0,
            })
        except Exception as e:
            print(f"[Storyboard] Auto-render after panel create failed: {e}")

        self.report({'INFO'}, f"Created shot: {self.shot_name} ({shot_id})")
        return {'FINISHED'}

    def invoke(self, context, event):
        # v0.9.0：默认名按网页端规则自动编号（max c 编号 + 10），用户可改
        try:
            from core.db import next_c_name, get_db_path
            project_dir = _get_project_dir()
            if project_dir:
                self.shot_name = next_c_name(get_db_path(project_dir))
        except Exception as e:
            print(f"[Storyboard] next_c_name prefill failed: {e}")
        return context.window_manager.invoke_props_dialog(self)


class STORYBOARD_OT_snap_frame(bpy.types.Operator):
    """拍当前帧：时间轴停在哪个帧就拍哪个帧，图按帧号自动排序（v0.8.0）。
    同帧号已有图 → 直接覆盖；满 5 张且是新帧号 → 软提示，不入队。"""
    bl_idname = "storyboard.snap_frame"
    bl_label = "拍当前帧"
    bl_options = {'REGISTER'}

    frame_no: bpy.props.IntProperty()
    shot_id: StringProperty()
    project_dir: StringProperty()
    overwrite: bpy.props.BoolProperty(default=False)

    def _resolve(self, context):
        """按当前场景/时间轴解析 shot 与帧号；失败时 report 并返回 False。"""
        from core.db import get_frames, MAX_FRAMES_PER_SHOT
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return False
        scene = context.scene
        if not scene.camera:
            self.report({'ERROR'}, "No camera in scene")
            return False
        db_path = get_db_path(project_dir)
        shot = next((s for s in get_all_shots(db_path) if s["scene_name"] == scene.name), None)
        if not shot:
            self.report({'ERROR'}, f"Scene {scene.name} not in storyboard DB")
            return False
        self.project_dir = project_dir
        self.shot_id = shot["id"]
        self.frame_no = scene.frame_current
        frames = get_frames(db_path, shot["id"])
        self.overwrite = any(f["frame_no"] == self.frame_no for f in frames)
        if not self.overwrite and len(frames) >= MAX_FRAMES_PER_SHOT:
            self.report({'WARNING'},
                        f"最多 {MAX_FRAMES_PER_SHOT} 张：跳到已有帧号上覆盖重拍，或先到网页端删一帧")
            return False
        return True

    def invoke(self, context, event):
        if not self._resolve(context):
            return {'CANCELLED'}
        return self.execute(context)

    def execute(self, context):
        from core.queue import cmd_render_frame
        # 兜底：execute 被直接调用（脚本/快捷键/EXEC 上下文）且未带属性时，现场解析，
        # 否则空 project_dir 会让 sqlite 在 CWD 造出一个空白 shots.db
        if not self.project_dir or not self.shot_id:
            if not self._resolve(context):
                return {'CANCELLED'}
        try:
            cmd_render_frame({
                "scene_name": context.scene.name,
                "shot_id": self.shot_id,
                "project_dir": self.project_dir,
                "frame_no": self.frame_no,
            })
        except Exception as e:
            self.report({'ERROR'}, f"拍屏失败: {e}")
            return {'CANCELLED'}
        verb = "覆盖重拍" if self.overwrite else "拍屏"
        self.report({'INFO'}, f"F{self.frame_no} {verb}完成")
        return {'FINISHED'}


class STORYBOARD_OT_jump_frame(bpy.types.Operator):
    """时间轴跳到该帧：查看构图 / 停在该帧重拍（v0.8.0）"""
    bl_idname = "storyboard.jump_frame"
    bl_label = "Jump to Frame"
    bl_options = {'REGISTER', 'UNDO'}

    frame_no: bpy.props.IntProperty()

    def execute(self, context):
        context.scene.frame_set(self.frame_no)
        return {'FINISHED'}


class STORYBOARD_OT_step_frame(bpy.types.Operator):
    """时间轴跳到上/下一个已拍帧（v0.9.0）"""
    bl_idname = "storyboard.step_frame"
    bl_label = "上/下一个已拍帧"
    bl_options = {'REGISTER', 'UNDO'}

    direction: bpy.props.IntProperty(default=1)  # -1 上一个, +1 下一个

    def execute(self, context):
        from core.db import get_db_path, get_all_shots, get_frames
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}
        db_path = get_db_path(project_dir)
        shot = next((s for s in get_all_shots(db_path) if s["scene_name"] == context.scene.name), None)
        if not shot:
            self.report({'ERROR'}, f"Scene {context.scene.name} not in storyboard DB")
            return {'CANCELLED'}
        frames = get_frames(db_path, shot["id"])
        if not frames:
            self.report({'INFO'}, "还没有已拍帧")
            return {'CANCELLED'}
        nos = sorted(f["frame_no"] for f in frames)
        cur = context.scene.frame_current
        if self.direction > 0:
            nxt = next((n for n in nos if n > cur), nos[0])      # 下一个，到头回绕
        else:
            nxt = next((n for n in reversed(nos) if n < cur), nos[-1])  # 上一个，到头回绕
        context.scene.frame_set(nxt)
        self.report({'INFO'}, f"F{nxt}")
        return {'FINISHED'}


class STORYBOARD_OT_delete_shot(bpy.types.Operator):
    """Delete current shot: remove Scene + DB record + files"""
    bl_idname = "storyboard.delete_shot"
    bl_label = "Delete Shot"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        project_dir = _get_project_dir()
        if not project_dir:
            self.report({'ERROR'}, "Save blend file first")
            return {'CANCELLED'}

        scene = context.scene
        db_path = get_db_path(project_dir)
        shots = get_all_shots(db_path)
        shot = next((s for s in shots if s["scene_name"] == scene.name), None)
        if not shot:
            self.report({'ERROR'}, "Scene not in storyboard DB")
            return {'CANCELLED'}

        # Delete files (new {name}_{id} format, with old-format fallback)
        from core.paths import remove_shot_dirs
        remove_shot_dirs(project_dir, shot["name"], shot["id"])

        # Delete DB record
        delete_shot(db_path, shot["id"])

        # Delete scene —— 复用 queue 的安全删除路径（v0.8.2 崩溃修复）：
        # cmd_delete_shot 会先把当前激活场景切走再 batch_remove。
        # 面板路径之前直接 batch_remove，删除"正在激活的场景"时
        # window 仍引用被删的 datablock → Blender 4.5 必崩。
        from core.queue import cmd_delete_shot
        cmd_delete_shot({
            "scene_name": scene.name,
            "shot_name": shot["name"],
            "shot_id": shot["id"],
            "project_dir": project_dir,
        })

        self.report({'INFO'}, f"Deleted shot: {shot['name']}")
        return {'FINISHED'}


# --- Panel ---

# 面板 DB 读取缓存（v0.8.0）：draw 频率极高，DB 可能在 SMB 盘上，1s TTL 足够跟手
_panel_db_cache = {"ts": 0.0, "key": None, "shot": None, "frames": []}


def _panel_db_read(project_dir, scene_name):
    import time
    now = time.monotonic()
    c = _panel_db_cache
    if c["key"] == (project_dir, scene_name) and now - c["ts"] < 1.0:
        return c["shot"], c["frames"]
    shot, frames = None, []
    try:
        from core.db import get_frames
        db_path = get_db_path(project_dir)
        shot = next((s for s in get_all_shots(db_path) if s["scene_name"] == scene_name), None)
        if shot:
            frames = get_frames(db_path, shot["id"])
    except Exception as e:
        print(f"[Storyboard] panel DB read failed: {e}")
    c.update(ts=now, key=(project_dir, scene_name), shot=shot, frames=frames)
    return shot, frames


class STORYBOARD_PT_panel(bpy.types.Panel):
    bl_idname = "VIEW3D_PT_storyboard"
    # v0.9.21：标题 = Blender分镜系统 v{版本号}（bl_info 同源，升版自动跟随）
    bl_label = f"Blender分镜系统 v{'.'.join(str(x) for x in bl_info.get('version', ()))}"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Storyboard"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        # ── 标题行：作品署名（v0.9.27 布局改版：三分区，署名压小）──
        author = bl_info.get('author', '')
        email = bl_info.get('email', '')
        layout.label(text=f"作者：{author}", icon='USER')
        if email:
            layout.label(text=email, icon='URL')

        # ── 插件信息 ──
        box = layout.box()
        row = box.row()
        row.label(text="插件信息", icon='INFO')
        box.separator()
        project_dir = _get_project_dir()
        if project_dir and os.path.exists(project_dir):
            row = box.row(align=True)
            row.label(text=f"项目：{os.path.basename(project_dir)}", icon='FILE_FOLDER')
            server = get_server()
            if server and server.running:
                row.label(text=f"服务：{server.port}", icon='URL')
            else:
                row.label(text="服务：启动中…", icon='TIME')
        else:
            row = box.row(align=True)
            row.label(text="请先保存 .blend 文件", icon='ERROR')
            row.operator("storyboard.init_project", text="初始化", icon='FILE_NEW')

        # ── 面板开关 ──
        box = layout.box()
        row = box.row()
        row.label(text="面板开关", icon='WINDOW')
        box.separator()
        # 双端打开：桌面窗口「分镜管理器」（主）/ 浏览器「网页版」（次），tooltip 区分
        row = box.row(align=True)
        row.scale_y = 1.5
        row.operator("storyboard.open_manager_webview", text="分镜管理器", icon='WINDOW')
        row.operator("storyboard.open_manager", text="网页版", icon='URL')

        # ── 镜头操作 ──
        box = layout.box()
        row = box.row()
        row.label(text="镜头操作", icon='TOOL_SETTINGS')
        box.separator()
        row = box.row(align=True)
        row.operator("storyboard.create_shot", text="创建镜头", icon='ADD')
        row.operator("storyboard.delete_shot", text="删除", icon='TRASH')

        # Current scene info
        if scene.camera:
            row = box.row(align=True)
            row.label(text=f"镜头：{scene.name}", icon='SCENE_DATA')
            row.label(text=f"相机：{scene.camera.name}", icon='CAMERA_DATA')
        else:
            row = box.row()
            row.label(text="无相机", icon='ERROR')

        # 多图镜头（v0.8.0）：拍当前帧 + 已拍帧号列表（点帧号跳转查看/重拍）
        if project_dir and os.path.exists(project_dir) and scene.camera:
            shot, frames = _panel_db_read(project_dir, scene.name)
            if shot:
                row = box.row()
                row.scale_y = 1.3
                row.operator("storyboard.snap_frame", text="拍当前帧", icon='RENDER_STILL')
                if frames:
                    from core.db import MAX_FRAMES_PER_SHOT
                    col = box.column(align=True)
                    col.label(text=f"已拍帧 ({len(frames)}/{MAX_FRAMES_PER_SHOT}):", icon='SEQUENCE')
                    row = col.row(align=True)
                    for f in frames:
                        missing = not f["image_path"] or not os.path.exists(f["image_path"])
                        icon = 'ERROR' if missing else ('IMAGE_DATA' if f["is_cover"] else 'NONE')
                        row.operator("storyboard.jump_frame",
                                     text=f"F{f['frame_no']}", icon=icon).frame_no = f["frame_no"]
                    # 上/下一个已拍帧导航：单独一行、按钮放大（v0.9.1 用户要求）
                    nav = col.row(align=True)
                    nav.scale_y = 1.4
                    nav.operator("storyboard.step_frame", text="◀ 上一个", icon='BACK').direction = -1
                    nav.operator("storyboard.step_frame", text="下一个 ▶", icon='FORWARD').direction = 1


# --- Registration ---

classes = (
    STORYBOARD_OT_sync_scenes,
    STORYBOARD_OT_init_project,
    STORYBOARD_OT_start_server,
    STORYBOARD_OT_stop_server,
    STORYBOARD_OT_open_manager,
    STORYBOARD_OT_open_manager_webview,
    STORYBOARD_OT_create_shot,
    STORYBOARD_OT_snap_frame,
    STORYBOARD_OT_jump_frame,
    STORYBOARD_OT_step_frame,
    STORYBOARD_OT_delete_shot,
    STORYBOARD_PT_panel,
)


# --- Auto-start server: 插件加载即服务，跟随文件加载/首次保存 ---
def _auto_start_server():
    try:
        project_dir = _get_project_dir()
        if not project_dir:
            return None  # 文件还没保存过，等 save_post
        server = get_server()
        if server and server.running and server.project_dir == project_dir:
            return None
        start_server(project_dir, port=8089)
        ensure_timer()
        print(f"[Storyboard] auto-started on port {get_server().port}")
        # 启动完整 sync 一次：目录清理/迁移（心跳对账不碰磁盘，rmtree 只在这跑）
        try:
            from core.sync import sync_scenes_with_db
            sync_scenes_with_db()
        except Exception:
            pass
    except Exception as e:
        print(f"[Storyboard] auto-start failed: {e}")
    return None  # timer 只跑一次


# --- Auto-sync: 心跳对账（v0.9.25）——每 5s 场景 ↔ DB 双向收敛，全自动无需手动 Sync ---
# DB 孤儿记录直接删；Blender 新场景（手动/幽灵/正名幽灵）自动登记 origin='other'
# 进「其它」页；__trash__ 垃圾桶场景跳过。磁盘目录清理只留在启动完整 sync。
_auto_sync_registered = False


def _auto_sync():
    """轻量对账心跳：5s 一轮。queue 非空时跳过本轮（创建竞态保护——
    DB 记录先行、场景后建，队列里还有 create/rename 命令时不能删记录）。"""
    try:
        from core.queue import queue_idle
        if queue_idle():
            from core.sync import sync_scenes_light
            sync_scenes_light()
    except Exception:
        pass  # 静默失败，不打扰用户（timer 抛异常会被 Blender 取消注册）
    return 5.0  # 每 5 秒对账一次


@bpy.app.handlers.persistent
def _on_file_loaded(*_args):
    global _auto_sync_registered
    bpy.app.timers.register(_auto_start_server, first_interval=0.5)
    # persistent=True + 标志防重复：save_post 也触发本 handler，重复注册会跑双份
    if not _auto_sync_registered:
        bpy.app.timers.register(_auto_sync, first_interval=5.0, persistent=True)
        _auto_sync_registered = True


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.app.handlers.load_post.append(_on_file_loaded)
    bpy.app.handlers.save_post.append(_on_file_loaded)
    # 插件在已打开文件里启用时立即尝试
    bpy.app.timers.register(_auto_start_server, first_interval=0.5)


def unregister():
    stop_server()
    global _auto_sync_registered
    try:
        bpy.app.timers.unregister(_auto_sync)
    except Exception:
        pass
    _auto_sync_registered = False
    for h in (bpy.app.handlers.load_post, bpy.app.handlers.save_post):
        if _on_file_loaded in h:
            h.remove(_on_file_loaded)
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
