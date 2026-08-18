# 📋 LanClip

> Self-hosted LAN clipboard with history, full-text search, and `curl` support. No database — plain files only.

![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Features

- **Paste & share** — Open the web UI from any machine on your LAN and paste text instantly
- **Clip history** — Every entry is stored as a plain `.txt` file; browse or search past clips
- **Full-text search** — Powered by `grep` under the hood, no external service needed
- **Syntax highlighting** — Code is auto-detected and highlighted via highlight.js (JS, Python, SQL, YAML, Bash, and more)
- **Dark / Light / Auto theme** — Follows your OS preference, toggleable manually
- **`curl` compatible** — Copy from stdin or paste to stdout without opening a browser
- **No database** — Data lives in a mounted folder; backup is just `cp`
- **Delete clips** — Remove individual clips from the UI or via the API
- **Responsive** — Works on desktop, tablet, and mobile

---

## Quick start

```bash
git clone https://github.com/adborroto/lanclip.git
cd lanclip
docker compose up -d
```

Open `http://<your-server-ip>:4040` in any browser on your network.

---

## curl Usage

### Copy to server (push)

```bash
# From stdin
cat file.txt | curl -s -X POST http://192.168.1.10:4040/api/clips \
  --data-binary @- -H "Content-Type: text/plain"

# Inline text
curl -s -X POST http://192.168.1.10:4040/api/clips \
  --data-binary "my text here" -H "Content-Type: text/plain"

# From clipboard (macOS)
pbpaste | curl -s -X POST http://192.168.1.10:4040/api/clips \
  --data-binary @- -H "Content-Type: text/plain"
```

### Paste from server (pull)

```bash
# Latest clip
curl -s http://192.168.1.10:4040/api/clips/latest/raw

# Pipe directly to clipboard (macOS)
curl -s http://192.168.1.10:4040/api/clips/latest/raw | pbcopy

# Specific clip by ID
curl -s http://192.168.1.10:4040/api/clips/<id>/raw

# Search
curl -s "http://192.168.1.10:4040/api/clips/search?q=kubectl"
```

### Handy shell aliases

Add to your `~/.zshrc` or `~/.bashrc` (replace the IP):

```bash
export LANCLIP_URL="http://192.168.1.10:4040"

# Copy stdin to LanClip
lcp() { cat | curl -s -X POST "$LANCLIP_URL/api/clips" --data-binary @- -H "Content-Type: text/plain"; }

# Paste latest clip
lpaste() { curl -s "$LANCLIP_URL/api/clips/latest/raw"; }

# Search clips
lsearch() { curl -s "$LANCLIP_URL/api/clips/search?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1")"; }
```

---

## REST API

| Method   | Path                         | Description                    |
|----------|------------------------------|--------------------------------|
| `POST`   | `/api/clips`                 | Create a new clip              |
| `GET`    | `/api/clips`                 | List clips (paginated)         |
| `GET`    | `/api/clips/search?q=<term>` | Full-text search via grep      |
| `GET`    | `/api/clips/latest/raw`      | Latest clip as plain text      |
| `GET`    | `/api/clips/:id`             | Get clip JSON (with content)   |
| `GET`    | `/api/clips/:id/raw`         | Get clip as plain text         |
| `DELETE` | `/api/clips/:id`             | Delete a clip                  |
| `GET`    | `/api/clips/stats`           | Aggregate stats                |
| `GET`    | `/health`                    | Health check                   |

---

## Configuration

All options are set via environment variables in `docker-compose.yml`:

| Variable      | Default       | Description                          |
|---------------|---------------|--------------------------------------|
| `PORT`        | `4040`        | HTTP port                            |
| `DATA_DIR`    | `/data/clips` | Directory where clips are stored     |
| `MAX_CLIPS`   | `500`         | Oldest clips are deleted at this cap |
| `MAX_SIZE_KB` | `512`         | Maximum clip size in KB              |

---

## Storage

Each clip is stored as two files:

```
clips-data/
  1723970000000_abc123.txt    ← raw content
  1723970000000_abc123.meta   ← JSON metadata (id, ip, size, lines, preview)
```

The `clips-data/` folder is a Docker bind mount — you can back it up, move it, or inspect it directly.

---

## Keyboard shortcuts

| Shortcut         | Action               |
|------------------|----------------------|
| `Ctrl + Enter`   | Save current clip    |
| `Escape`         | Close modal / search |
| `/`              | Focus search bar     |

---

## Development

```bash
npm install
npm run dev     # node --watch server.js
```

Visit `http://localhost:4040`.

---

## License

[MIT](LICENSE) © adborroto
