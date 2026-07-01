#!/usr/bin/env python3
"""
Serves the ROD Database Toolkit locally.

Browsers block fetch() on file:// URLs, so this app needs to be served
over HTTP, even just from localhost. Run this script from this folder,
then open the printed URL in your browser.

Usage:
    python3 serve.py [port]

Default port: 8000
"""
import http.server
import socketserver
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow local fetch() of JSON/PNG without caching surprises during dev
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/index.html"
        print(f"Serving ROD Database Toolkit at {url}")
        print("Press Ctrl+C to stop.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
