"""PLC Trainer - Simple Flask server to serve the static scenarios."""
from flask import Flask, send_from_directory
import os

app = Flask(__name__, static_folder=".", static_url_path="")


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5055))
    print(f"PLC Trainer running at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
