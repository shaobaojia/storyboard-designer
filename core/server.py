"""
HTTP server for Storyboard Designer.
Runs in a background thread inside Blender.
Serves REST API + static H5 files.
"""
import json
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from .db import (
    init_db, get_db_path, create_shot, update_shot,
    delete_shot, get_shot, get_all_shots, reorder_shots
)
import importlib


def _queue(command, params):
    """Queue a command, always resolving core.queue fresh from sys.modules.

    Survives hot reloads: the module-level 'import core.queue' binding goes
    stale after 'del sys.modules[...]' reloads, so we re-import per call.
    """
    queue_mod = importlib.import_module("core.queue")
    queue_mod.queue_command(command, params)

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
        self.server = HTTPServer(("0.0.0.0", self.port), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.running = True
        _all_servers.append(self)
        print(f"[Storyboard] HTTP server started on 127.0.0.1:{self.port}")

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
                    name = data.get("name", f"SH{len(get_all_shots(db_path))+1:03d}")
                    scene_name = data.get("scene_name", f"Shot_{name}")
                    shot_id = create_shot(db_path, name, scene_name,
                                          camera=data.get("camera", ""),
                                          duration=data.get("duration", 2.0),
                                          shot_type=data.get("type", "3d"))
                    # Queue Blender scene creation
                    try:
                        _queue("create_shot_scene", {
                            "shot_name": name,
                            "scene_name": scene_name,
                            "duration": data.get("duration", 2.0),
                            "shot_type": data.get("type", "3d")
                        })
                        print(f"[Storyboard] Queued create_shot_scene for {name}")
                    except Exception as e:
                        print(f"[Storyboard] Queue error: {e}")
                        import traceback
                        traceback.print_exc()
                    self._send_json({"status": "ok", "id": shot_id})

                elif path == "/api/sync":
                    # Queue sync command to Blender
                    _queue("sync_scenes", {})
                    self._send_json({"status": "ok", "message": "sync queued"})

                elif path == "/api/reorder":
                    shot_ids = data.get("shot_ids", [])
                    reorder_shots(db_path, shot_ids)
                    self._send_json({"status": "ok"})

                elif path.startswith("/api/shot/"):
                    shot_id = path.split("/")[-1]
                    action = data.get("action", "")

                    if action == "update":
                        update_shot(db_path, shot_id, **data.get("fields", {}))
                        self._send_json({"status": "ok"})

                    elif action == "delete":
                        shot = get_shot(db_path, shot_id)
                        if not shot:
                            self._send_json({"status": "error", "message": "not found"}, 404)
                            return
                        delete_shot(db_path, shot_id)
                        _queue("delete_shot", {
                            "scene_name": shot["scene_name"]
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
                        new_name = data.get("new_name", f"{shot['name']}_copy")
                        _queue("duplicate_shot", {
                            "scene_name": shot["scene_name"],
                            "new_name": new_name,
                            "project_dir": project_dir
                        })
                        self._send_json({"status": "ok", "message": "queued"})

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
