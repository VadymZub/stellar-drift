import sys, http.server, socketserver

# Статик-сервер БЕЗ кэша — чтобы правки .js/.json всегда подхватывались (иначе браузер
# держит старые ES-модули и кажется, что «не обновилось»).
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # silence per-request logs — too noisy with 200+ boot assets


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True   # threads exit when main process exits


with ThreadedServer(('', port), NoCacheHandler) as httpd:
    print(f'Stellar Drift (no-cache) -> http://localhost:{port}')
    httpd.serve_forever()
