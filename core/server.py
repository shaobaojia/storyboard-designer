"""
HTTP server for Storyboard Designer.
Runs in a background thread inside Blender.
Serves REST API + static H5 files.
"""
import json
import os
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from .db import (
    init_db, get_db_path, get_db_version, create_shot, update_shot,
    delete_shot, get_shot, get_all_shots, reorder_shots, name_exists
)
import importlib


def _queue(command, params):
    """Queue a command, always resolving core.queue fresh from sys.modules.

    Survives hot reloads: the module-level 'import core.queue' binding goes
    stale after 'del sys.modules[...]' reloads, so we re-import per call.
    """
    queue_mod = importlib.import_module("core.queue")
    queue_mod.queue_command(command, params)


def _next_c_name(db_path):
    """Next c-numbered shot name: c0010, c0020, ... (max existing + 10)."""
    import re
    best = 0
    for s in get_all_shots(db_path):
        m = re.fullmatch(r"c(\d+)", s["name"] or "")
        if m:
            best = max(best, int(m.group(1)))
    return f"c{best + 10:04d}"


def _next_c_number(db_path):
    """Next free c-number as int (base for local increments)."""
    return int(_next_c_name(db_path)[1:])


def _project_name(project_dir):
    """Blend file name, derived from the project dir ({blend}_storyboard)."""
    base = os.path.basename(project_dir.rstrip("/\\"))
    suffix = "_storyboard"
    return base[:-len(suffix)] if base.endswith(suffix) else base


_all_servers = []


class StoryboardHTTPServer:
    def __init__(self, project_dir, port=8089):
        self.project_dir = project_dir
        self.port = port
        self.db_path = get_db_path(project_dir)
        self.server = None
        self.thread = None
        self.running = False

        # Ensure project structure
        os.makedirs(os.path.join(project_dir, "shots"), exist_ok=True)
        os.makedirs(os.path.join(project_dir, "animatic"), exist_ok=True)
        init_db(self.db_path)

    def start(self):
        """Start HTTP server in background thread."""
        if self.running:
            return
        handler = self._make_handler()
        # Threading: a keep-alive browser connection (1.5s heartbeat) must not
        # monopolize a single-threaded server — one thread per connection.
        self.server = ThreadingHTTPServer(("0.0.0.0", self.port), handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.running = True
        _all_servers.append(self)
        print(f"[Storyboard] HTTP server started on 0.0.0.0:{self.port} (LAN accessible)")

    def stop(self):
        """Stop HTTP server."""
        if self.server:
            try:
                self.server.shutdown()
                self.server.server_close()
            except Exception:
                pass
            self.running = False
            print("[Storyboard] HTTP server stopped")

    def _make_handler(self):
        db_path = self.db_path
        project_dir = self.project_dir

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass  # Suppress logs

            def _send_json(self, data, status=200):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def _send_file(self, filepath, content_type):
                if not os.path.exists(filepath):
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                with open(filepath, "rb") as f:
                    self.wfile.write(f.read())

            def do_GET(self):
                parsed = urlparse(self.path)
                path = parsed.path

                if path == "/api/shots":
                    shots = get_all_shots(db_path)
                    self._send_json({"status": "ok", "shots": shots})

                elif path == "/api/version":
                    # Heartbeat: cheap change marker for client polling
                    self._send_json({"status": "ok", "version": get_db_version(db_path)})

                elif path == "/api/next_name":
                    self._send_json({"status": "ok", "name": _next_c_name(db_path)})

                elif path == "/api/project":
                    self._send_json({"status": "ok", "name": _project_name(project_dir)})

                elif path.startswith("/api/shot/"):
                    shot_id = path.split("/")[-1]
                    shot = get_shot(db_path, shot_id)
                    if shot:
                        self._send_json({"status": "ok", "shot": shot})
                    else:
                        self._send_json({"status": "error", "message": "not found"}, 404)

                elif path.startswith("/shots/"):
                    # Serve shot images - support both old (id) and new (name_id) dir naming
                    rel_path = path.lstrip("/")
                    filepath = os.path.join(project_dir, rel_path)
                    if os.path.exists(filepath):
                        if path.endswith(".png"):
                            self._send_file(filepath, "image/png")
                        elif path.endswith(".jpg") or path.endswith(".jpeg"):
                            self._send_file(filepath, "image/jpeg")
                        else:
                            self.send_error(404)
                    else:
                        # Try to find by shot_id in any directory
                        parts = rel_path.split("/")
                        if len(parts) >= 3:
                            shot_id_or_name = parts[1]
                            filename = parts[2]
                            shots_dir = os.path.join(project_dir, "shots")
                            if os.path.exists(shots_dir):
                                for d in os.listdir(shots_dir):
                                    # Match by id (old) or name_id (new)
                                    if d == shot_id_or_name or d.endswith(f"_{shot_id_or_name}"):
                                        filepath = os.path.join(shots_dir, d, filename)
                                        if os.path.exists(filepath):
                                            if filename.endswith(".png"):
                                                self._send_file(filepath, "image/png")
                                            elif filename.endswith(".jpg") or filename.endswith(".jpeg"):
                                                self._send_file(filepath, "image/jpeg")
                                            else:
                                                self.send_error(404)
                                            return
                        self.send_error(404)

                elif path == "/" or path == "/index.html":
                    # Serve grid H5 page
                    html_path = os.path.join(os.path.dirname(__file__), "..", "web", "index.html")
                    self._send_file(html_path, "text/html")

                elif path.endswith(".css"):
                    css_path = os.path.join(os.path.dirname(__file__), "..", "web", path.lstrip("/"))
                    self._send_file(css_path, "text/css")

                elif path.endswith(".js"):
                    js_path = os.path.join(os.path.dirname(__file__), "..", "web", path.lstrip("/"))
                    self._send_file(js_path, "application/javascript")

                else:
                    self.send_error(404)

            def do_POST(self):
                parsed = urlparse(self.path)
                path = parsed.path
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode() if content_length > 0 else "{}"
                try:
                    data = json.loads(body)
                except json.JSONDecodeError:
                    data = {}

                if path == "/api/shots":
                    # Create new shot - also create Blender scene via queue
                    name = data.get("name", _next_c_name(db_path))
                    if name_exists(db_path, name):
                        self._send_json({"status": "error", "message": f"name taken: {name}"}, 409)
                        return
                    scene_name = f"Shot_{name}"
                    shot_id = create_shot(db_path, name, scene_name,
                                          camera=f"Cam_{name}",
                                          duration=data.get("duration", 2.0))
                    os.makedirs(os.path.join(project_dir, "shots", f"{name}_{shot_id}"), exist_ok=True)
                    try:
                        _queue("create_shot_scene", {
                            "shot_name": name,
                            "scene_name": scene_name,
                            "shot_id": shot_id,
                            "project_dir": project_dir,
                        })
                        print(f"[Storyboard] Queued create_shot_scene for {name}")
                    except Exception as e:
                        print(f"[Storyboard] Queue error: {e}")
                        import traceback
                        traceback.print_exc()
                    self._send_json({"status": "ok", "id": shot_id})

                elif path == "/api/shots/image":
                    # Create shot(s) from dropped external images.
                    # data: {items: [{name, duration, filename, data_base64}]}
                    import base64
                    results = []
                    for item in data.get("items", []):
                        name = item.get("name") or _next_c_name(db_path)
                        if name_exists(db_path, name):
                            results.append({"name": name, "status": "error", "message": "name taken"})
                            continue
                        scene_name = f"Shot_{name}"
                        shot_id = create_shot(db_path, name, scene_name,
                                              camera=f"Cam_{name}",
                                              duration=item.get("duration", 2.0))
                        shot_dir = os.path.join(project_dir, "shots", f"{name}_{shot_id}")
                        os.makedirs(shot_dir, exist_ok=True)
                        # Save source image into the shot directory
                        filename = item.get("filename") or "source.png"
                        safe_name = os.path.basename(filename)
                        img_path = os.path.join(shot_dir, safe_name)
                        try:
                            raw = base64.b64decode(item.get("data_base64", ""))
                            with open(img_path, "wb") as f:
                                f.write(raw)
                        except Exception as e:
                            print(f"[Storyboard] Image save failed: {e}")
                            img_path = None
                        _queue("create_image_shot_scene", {
                            "shot_name": name,
                            "scene_name": scene_name,
                            "image_path": img_path,
                            "shot_id": shot_id,
                            "project_dir": project_dir,
                        })
                        results.append({"name": name, "status": "ok", "id": shot_id})
                    self._send_json({"status": "ok", "results": results})

                elif path == "/api/sync":
                    _queue("sync_scenes", {})
                    self._send_json({"status": "ok", "message": "sync queued"})

                elif path == "/api/reorder":
                    shot_ids = data.get("shot_ids", [])
                    reorder_shots(db_path, shot_ids)
                    self._send_json({"status": "ok"})

                elif path == "/api/batch":
                    # Batch ops on a set of shots: delete / rerender / duplicate / rename_seq
                    action = data.get("action", "")
                    shot_ids = data.get("shot_ids", [])
                    done, errors = 0, []
                    # Pre-allocate c-numbers locally. DB records are created
                    # asynchronously by the queue, so re-querying per iteration
                    # would hand out the SAME name every time (v0.2.0 bug).
                    next_num = _next_c_number(db_path)
                    for sid in shot_ids:
                        shot = get_shot(db_path, sid)
                        if not shot:
                            errors.append(f"{sid}: not found")
                            continue
                        try:
                            if action == "delete":
                                delete_shot(db_path, sid)
                                _queue("delete_shot", {
                                    "scene_name": shot["scene_name"],
                                    "shot_name": shot["name"],
                                    "shot_id": sid,
                                    "project_dir": project_dir,
                                })
                            elif action == "rerender":
                                _queue("rerender_shot", {
                                    "scene_name": shot["scene_name"],
                                    "shot_id": sid,
                                    "project_dir": project_dir,
                                })
                            elif action == "duplicate":
                                new_name = f"c{next_num:04d}"
                                next_num += 10
                                _queue("duplicate_shot", {
                                    "scene_name": shot["scene_name"],
                                    "new_name": new_name,
                                    "project_dir": project_dir,
                                })
                            elif action == "rename_seq":
                                # Renumber selection into c-series: first shot's
                                # number is the base, +10 each, conflicts skip ahead.
                                pass  # handled below (needs two passes)
                            else:
                                self._send_json({"status": "error", "message": "unknown action"}, 400)
                                return
                            done += 1
                        except Exception as e:
                            errors.append(f"{shot['name']}: {e}")

                    if action == "rename_seq":
                        import re
                        ordered = [get_shot(db_path, sid) for sid in shot_ids]
                        ordered = [s for s in ordered if s]
                        if ordered:
                            m = re.search(r"(\d+)$", ordered[0]["name"] or "")
                            base = int(m.group(1)) if m else 10
                            # Round base down to a multiple of 10 for clean c-numbers
                            base = max(10, (base // 10) * 10)
                            # Collect names owned by the selection itself (they'll be freed)
                            selected_names = {s["name"] for s in ordered}
                            n = base
                            assignments = []
                            for shot in ordered:
                                while True:
                                    candidate = f"c{n:04d}"
                                    n += 10
                                    if candidate in selected_names:
                                        break  # freeing this name anyway, safe
                                    if not name_exists(db_path, candidate, exclude_id=shot["id"]):
                                        break  # free name
                                if candidate == shot["name"]:
                                    continue  # already the right number, no-op
                                assignments.append((shot, candidate))
                            # Two-phase rename: phase 1 moves every shot to a unique
                            # temp name, phase 2 lands them on the finals. Otherwise a
                            # target name still owned by a later shot in the selection
                            # makes cmd_rename_shot raise "Scene already exists".
                            done = 0
                            for shot, candidate in assignments:
                                _queue("rename_shot", {
                                    "shot_id": shot["id"],
                                    "old_name": shot["name"],
                                    "new_name": f"__ren_{shot['id']}",
                                    "project_dir": project_dir,
                                })
                            for shot, candidate in assignments:
                                _queue("rename_shot", {
                                    "shot_id": shot["id"],
                                    "old_name": f"__ren_{shot['id']}",
                                    "new_name": candidate,
                                    "project_dir": project_dir,
                                })
                                done += 1

                    self._send_json({"status": "ok", "done": done, "errors": errors})

                elif path.startswith("/api/shot/"):
                    shot_id = path.split("/")[-1]
                    action = data.get("action", "")

                    if action == "update":
                        update_shot(db_path, shot_id, **data.get("fields", {}))
                        self._send_json({"status": "ok"})

                    elif action == "rename":
                        shot = get_shot(db_path, shot_id)
                        if not shot:
                            self._send_json({"status": "error", "message": "not found"}, 404)
                            return
                        new_name = (data.get("new_name") or "").strip()
                        if not new_name:
                            self._send_json({"status": "error", "message": "empty name"}, 400)
                            return
                        if new_name == shot["name"]:
                            self._send_json({"status": "ok", "message": "unchanged"})
                            return
                        if name_exists(db_path, new_name, exclude_id=shot_id):
                            self._send_json({"status": "error", "message": f"name taken: {new_name}"}, 409)
                            return
                        _queue("rename_shot", {
                            "shot_id": shot_id,
                            "old_name": shot["name"],
                            "new_name": new_name,
                            "project_dir": project_dir,
                        })
                        self._send_json({"status": "ok", "message": "queued"})

                    elif action == "set_background":
                        # Drop image onto a card: save to shot dir, set as the
                        # shot camera's background (100% opacity), auto-render.
                        import base64
                        shot = get_shot(db_path, shot_id)
                        if not shot:
                            self._send_json({"status": "error", "message": "not found"}, 404)
                            return
                        filename = os.path.basename(data.get("filename") or "background.png")
                        shot_dir = os.path.join(project_dir, "shots", f"{shot['name']}_{shot_id}")
                        os.makedirs(shot_dir, exist_ok=True)
                        img_path = os.path.join(shot_dir, filename)
                        try:
                            raw = base64.b64decode(data.get("data_base64", ""))
                            with open(img_path, "wb") as f:
                                f.write(raw)
                        except Exception as e:
                            self._send_json({"status": "error", "message": f"save failed: {e}"}, 500)
                            return
                        _queue("set_camera_background", {
                            "scene_name": shot["scene_name"],
                            "image_path": img_path,
                            "shot_id": shot_id,
                            "shot_name": shot["name"],
                            "project_dir": project_dir,
                        })
                        self._send_json({"status": "ok", "message": "queued"})

                    elif action == "delete":
                        shot = get_shot(db_path, shot_id)
                        if not shot:
                            self._send_json({"status": "error", "message": "not found"}, 404)
                            return
                        delete_shot(db_path, shot_id)
                        _queue("delete_shot", {
                            "scene_name": shot["scene_name"],
                            "shot_name": shot["name"],
                            "shot_id": shot_id,
                            "project_dir": project_dir,
                        })
                        self._send_json({"status": "ok"})

                    elif action == "open":
                        shot = get_shot(db_path, shot_id)
                        if not shot:
                            self._send_json({"status": "error", "message": "not found"}, 404)
                            return
                        _queue("open_shot", {"scene_name": shot["scene_name"]})
                        self._send_json({"status": "ok", "message": "queued"})

                    elif action == "rerender":
                        shot = get_shot(db_path, shot_id)
                        if not shot:
                            self._send_json({"status": "error", "message": "not found"}, 404)
                            return
                        _queue("rerender_shot", {
                            "scene_name": shot["scene_name"],
                            "shot_id": shot_id,
                            "project_dir": project_dir
                        })
                        self._send_json({"status": "ok", "message": "queued"})

                    elif action == "duplicate":
                        shot = get_shot(db_path, shot_id)
                        if not shot:
                            self._send_json({"status": "error", "message": "not found"}, 404)
                            return
                        new_name = data.get("new_name") or _next_c_name(db_path)
                        _queue("duplicate_shot", {
                            "scene_name": shot["scene_name"],
                            "new_name": new_name,
                            "project_dir": project_dir
                        })
                        self._send_json({"status": "ok", "message": "queued", "new_name": new_name})

                    else:
                        self._send_json({"status": "error", "message": "unknown action"}, 400)

                else:
                    self.send_error(404)

        return Handler


# Singleton instance
_server_instance = None


def start_server(project_dir, port=8089):
    """Start the global HTTP server instance. Kills ALL previous instances first."""
    global _server_instance
    # Kill every tracked instance, including zombies from hot reloads
    for srv in list(_all_servers):
        try:
            srv.stop()
        except Exception:
            pass
    _all_servers.clear()
    _server_instance = StoryboardHTTPServer(project_dir, port)
    _server_instance.start()
    return _server_instance


def stop_server():
    """Stop the global HTTP server instance."""
    global _server_instance
    if _server_instance:
        _server_instance.stop()
        _server_instance = None


def get_server():
    """Get current server instance."""
    return _server_instance
