"""
HTTP server for Storyboard Designer.
Runs in a background thread inside Blender.

Transport only: routing table + JSON/static file plumbing. All endpoint
logic lives in core/actions.py (one function per endpoint).
"""
import json
import os
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

import bpy

from core import actions
from core.db import init_db, get_db_path


class _ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR allows port hijack by a second process; opt out.
    allow_reuse_address = False

WEB_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")

CONTENT_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

# Exact-match API routes: (method, path) -> handler(ctx) -> (payload, status)
# ctx = {"db_path", "project_dir", "shot_id", "data"}
ROUTES = {
    ("GET", "/api/shots"): lambda c: actions.list_shots(c["db_path"]),
    ("GET", "/api/version"): lambda c: actions.get_version(c["db_path"]),
    ("GET", "/api/next_name"): lambda c: actions.get_next_name(c["db_path"]),
    ("GET", "/api/project"): lambda c: actions.get_project(c["project_dir"]),
    ("GET", "/api/shot/*"): lambda c: actions.get_shot_by_id(c["db_path"], c["shot_id"]),
    ("POST", "/api/shots"): lambda c: actions.create_shot_action(c["project_dir"], c["db_path"], c["data"]),
    ("POST", "/api/shots/image"): lambda c: actions.create_image_shots_action(c["project_dir"], c["db_path"], c["data"]),
    ("POST", "/api/sync"): lambda c: actions.sync_action(),
    ("POST", "/api/reorder"): lambda c: actions.reorder_action(c["db_path"], c["data"]),
    ("POST", "/api/batch"): lambda c: actions.batch_action(c["project_dir"], c["db_path"], c["data"]),
    ("POST", "/api/shot/*"): lambda c: actions.shot_action(c["project_dir"], c["db_path"], c["shot_id"], c["data"]),
}


def _match_route(method, path):
    """Exact match first, then the /api/shot/* wildcard."""
    handler = ROUTES.get((method, path))
    if handler:
        return handler, None
    if path.startswith("/api/shot/"):
        handler = ROUTES.get((method, "/api/shot/*"))
        if handler:
            return handler, path.split("/")[-1]
    return None, None


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
        # NOTE: on Windows SO_REUSEADDR lets a second Blender silently hijack
        # the port; disable reuse so a duplicate instance fails loudly instead.
        try:
            self.server = _ExclusiveThreadingHTTPServer(("0.0.0.0", self.port), handler)
        except OSError as e:
            print(f"[Storyboard] ERROR: port {self.port} already bound (another Blender instance?): {e}")
            raise
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
            _unregister_instance()
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

            def _dispatch_api(self, method, data=None):
                path = urlparse(self.path).path
                handler, shot_id = _match_route(method, path)
                if not handler:
                    self.send_error(404)
                    return
                ctx = {
                    "db_path": db_path,
                    "project_dir": project_dir,
                    "shot_id": shot_id,
                    "data": data or {},
                }
                try:
                    payload, status = handler(ctx)
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    payload, status = {"status": "error", "message": str(e)}, 500
                self._send_json(payload, status)

            def _serve_static(self, path):
                if path in ("/", "/index.html"):
                    rel = "index.html"
                else:
                    rel = path.lstrip("/")
                # Contain to WEB_ROOT (no traversal)
                filepath = os.path.normpath(os.path.join(WEB_ROOT, rel))
                if not filepath.startswith(os.path.normpath(WEB_ROOT)):
                    self.send_error(403)
                    return
                ext = os.path.splitext(filepath)[1].lower()
                content_type = CONTENT_TYPES.get(ext)
                if content_type:
                    self._send_file(filepath, content_type)
                else:
                    self.send_error(404)

            def _serve_shot_file(self, path):
                # /shots/{name_id}/{file} — direct hit, then fallback search by
                # shot id (legacy dir naming) across the shots root.
                rel_path = path.lstrip("/")
                filepath = os.path.join(project_dir, rel_path)
                if not os.path.exists(filepath):
                    parts = rel_path.split("/")
                    if len(parts) >= 3:
                        shot_key, filename = parts[1], parts[2]
                        shots_dir = os.path.join(project_dir, "shots")
                        if os.path.isdir(shots_dir):
                            for d in os.listdir(shots_dir):
                                # Match by id (old) or name_id (new)
                                if d == shot_key or d.endswith(f"_{shot_key}"):
                                    candidate = os.path.join(shots_dir, d, filename)
                                    if os.path.exists(candidate):
                                        filepath = candidate
                                        break
                ext = os.path.splitext(filepath)[1].lower()
                content_type = CONTENT_TYPES.get(ext)
                if content_type and content_type.startswith("image/"):
                    self._send_file(filepath, content_type)
                else:
                    self.send_error(404)

            def do_GET(self):
                path = urlparse(self.path).path
                if path.startswith("/api/"):
                    self._dispatch_api("GET")
                elif path.startswith("/shots/"):
                    self._serve_shot_file(path)
                else:
                    self._serve_static(path)

            def do_POST(self):
                path = urlparse(self.path).path
                if not path.startswith("/api/"):
                    self.send_error(404)
                    return
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode() if content_length > 0 else "{}"
                try:
                    data = json.loads(body)
                except json.JSONDecodeError:
                    data = {}
                self._dispatch_api("POST", data)

        return Handler


# Singleton instance
_server_instance = None

# ---------------------------------------------------------------------------
# Instance registry: every Blender process gets its own port (8089+ scanning).
# instances.json lets external tools find which port serves which blend file.
# ---------------------------------------------------------------------------
def _instances_file():
    addon_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(addon_root, "instances.json")


def _pid_alive(pid):
    try:
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not h:
            return False
        # A dead-but-lingering process object still opens; only STILL_ACTIVE counts.
        code = ctypes.c_ulong(0)
        ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(h)
        return code.value == 259  # STILL_ACTIVE
    except Exception:
        return True  # can't tell -> keep entry, probing will sort it out


def _register_instance(project_dir, port):
    try:
        path = _instances_file()
        entries = []
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    entries = json.load(f)
            except Exception:
                entries = []
        entries = [e for e in entries
                   if e.get("pid") != os.getpid() and _pid_alive(e.get("pid", 0))]
        entries.append({
            "pid": os.getpid(),
            "port": port,
            "blend": bpy.data.filepath if bpy else "",
            "project_dir": project_dir,
            "started_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        })
        with open(path, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Storyboard] instance registry write failed (non-fatal): {e}")


def _unregister_instance():
    try:
        path = _instances_file()
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            entries = json.load(f)
        entries = [e for e in entries if e.get("pid") != os.getpid()]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def start_server(project_dir, port=8089, max_tries=20):
    """Start the global HTTP server instance. Kills ALL previous in-process
    instances first, then binds the first free port from `port` upwards, so
    multiple Blender processes each get their own HTTP service."""
    global _server_instance
    # Kill every tracked instance, including zombies from hot reloads
    for srv in list(_all_servers):
        try:
            srv.stop()
        except Exception:
            pass
    _all_servers.clear()
    last_err = None
    for p in range(port, port + max_tries):
        srv = StoryboardHTTPServer(project_dir, p)
        try:
            srv.start()
        except OSError as e:
            last_err = e
            continue
        _server_instance = srv
        _register_instance(project_dir, p)
        if p != port:
            print(f"[Storyboard] port {port} busy, fell through to {p}")
        return srv
    raise OSError(f"[Storyboard] no free port in {port}-{port + max_tries - 1}: {last_err}")


def stop_server():
    """Stop the global HTTP server instance."""
    global _server_instance
    if _server_instance:
        _server_instance.stop()
        _server_instance = None


def get_server():
    """Get current server instance."""
    return _server_instance
