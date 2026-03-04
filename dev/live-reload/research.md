# Research: Live-Reload Neovim Workflow for Elevator Saga

## Goal

Edit elevator code in neovim in a `solution.js` file, save, and have the browser automatically pick up the new code and restart the simulation — no manual clicking required.

## How Player Code Works Today

1. Player writes JS in the in-browser CodeMirror editor
2. Clicks "Apply" → triggers `editor.trigger("apply_code")` (app.js:106)
3. `app.startChallenge()` tears down old world, creates a new one, calls `editor.getCodeObj()` which reads CodeMirror and runs `eval()` on the code string (base.js:72)
4. `worldController.start()` kicks off the animation loop, calling `codeObj.init()` on the first frame and `codeObj.update()` every subsequent frame
5. Code auto-saves to `localStorage["elevatorCrushCode_v5"]` every 1s (debounced) and restores on page load

**Key integration point**: `editor.setCode(text)` sets the CodeMirror content, and `editor.trigger("apply_code")` restarts the simulation with whatever's in the editor. The editor object is created in `app.js` but not exposed on `window`.

**Required change to app.js**: Expose the editor globally so injected scripts can reach it:

```javascript
// After: var editor = createEditor();
window._elevatorEditor = editor;
```

## Approaches

### Approach 1: browser-sync Full Page Reload (Simplest, Zero Code Changes)

```bash
npx browser-sync start --server --files "solution.js" --no-notify
```

- Watches `solution.js`, triggers full page reload on save
- Code survives reload because the game saves/restores from localStorage
- **Limitation**: Requires manually pasting code from `solution.js` into the editor once initially, since the game loads from localStorage, not from a file. After that, subsequent reloads restore the localStorage version. This means you'd need a different approach to bridge the external file into the editor.
- **Workaround**: Modify `app.js` to fetch `solution.js` on load instead of reading localStorage, then browser-sync reload works end-to-end
- **Pros**: Zero npm install needed (npx), zero code changes for the reload itself
- **Cons**: Full page reload (DOM rebuilds, flicker), still need a way to get the file content into the editor

### Approach 2: WebSocket Hot Injection (Best DX, Small Server)

A custom Node.js server that:

1. Serves the game's static files
2. Watches `solution.js` with chokidar
3. On change, broadcasts file content over WebSocket
4. Injected browser script receives content, sets it into CodeMirror, triggers apply

**Dependencies**: `ws` + `chokidar` (2 packages)

**Server (`dev-server.js`, ~55 lines)**:

```javascript
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const chokidar = require("chokidar");

const PORT = 3000;
const WATCHED_FILE = path.join(__dirname, "solution.js");

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    if (filePath.endsWith(".html")) {
      data = data.toString().replace(
        "</body>",
        `
<script>
(function() {
    var ws = new WebSocket('ws://localhost:${PORT}');
    ws.onmessage = function(e) {
        var msg = JSON.parse(e.data);
        if (msg.type === 'code_update' && window._elevatorEditor) {
            window._elevatorEditor.setCode(msg.code);
            window._elevatorEditor.trigger('apply_code');
        }
    };
})();
</script>
</body>`,
      );
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    } else {
      res.writeHead(200);
      res.end(data);
    }
  });
});

const wss = new WebSocket.Server({ server });

chokidar.watch(WATCHED_FILE).on("change", () => {
  const code = fs.readFileSync(WATCHED_FILE, "utf8");
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN)
      client.send(JSON.stringify({ type: "code_update", code }));
  });
});

server.listen(PORT, () => console.log("http://localhost:" + PORT));
```

**Pros**: No page reload, simulation restarts instantly, DOM stays intact
**Cons**: Requires `npm install ws chokidar`, custom server to maintain

### Approach 3: SSE Hot Injection (Zero npm Dependencies)

Same concept as WebSocket but using Server-Sent Events. SSE is unidirectional (server→browser) which is all we need, and `EventSource` is a browser built-in with auto-reconnect.

**Dependencies**: None — uses only Node.js builtins (`http`, `fs`, `path`)

**Server (`dev-server.js`, ~60 lines)**:

```javascript
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const WATCHED_FILE = path.join(__dirname, "solution.js");
let sseClients = [];

const server = http.createServer((req, res) => {
  if (req.url === "/__reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    sseClients.push(res);
    req.on("close", () => {
      sseClients = sseClients.filter((c) => c !== res);
    });
    return;
  }

  let filePath = path.join(__dirname, req.url === "/" ? "index.html" : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    if (filePath.endsWith(".html")) {
      data = data.toString().replace(
        "</body>",
        `
<script>
(function() {
    var es = new EventSource('/__reload');
    es.addEventListener('code_update', function(e) {
        if (window._elevatorEditor) {
            window._elevatorEditor.setCode(e.data);
            window._elevatorEditor.trigger('apply_code');
        }
    });
})();
</script>
</body>`,
      );
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    } else {
      res.writeHead(200);
      res.end(data);
    }
  });
});

fs.watch(WATCHED_FILE, { persistent: true }, () => {
  const code = fs.readFileSync(WATCHED_FILE, "utf8");
  // SSE multiline: each line must be prefixed with "data: "
  const payload =
    "event: code_update\ndata: " + code.replace(/\n/g, "\ndata: ") + "\n\n";
  sseClients.forEach((res) => res.write(payload));
});

server.listen(PORT, () => console.log("http://localhost:" + PORT));
```

**Pros**: Zero npm dependencies, simpler protocol, browser auto-reconnects
**Cons**: `fs.watch` can fire duplicate events on some platforms (debounce recommended for production use, fine for single-file dev on macOS which uses FSEvents)

### Approach 4: Existing Tool — hot-server

```bash
npm install -g hot-server
hot-server
```

[hot-server](https://github.com/1wheel/hot-server) serves static files, watches for changes, and injects a WebSocket client that `eval()`s received JS directly. This is close to what we need but does a raw `eval()` instead of routing through the game's `apply_code` machinery, so the simulation wouldn't properly restart. Would need forking or wrapping.

### Approach 5: Vite (Not Recommended)

Vite's HMR requires ES modules (`import`/`export`). The entire codebase uses global `<script>` tags and IIFEs. Converting to ESM would be a significant restructuring effort for minimal gain over the SSE/WebSocket approaches above.

## Recommendation

**Approach 3 (SSE)** is the best balance of simplicity and developer experience:

- Zero npm dependencies — just `node dev-server.js`
- No page reload — simulation restarts seamlessly on save
- ~60 lines of code
- Only one line added to `app.js` (`window._elevatorEditor = editor`)

**Required changes to the game**:

1. **app.js**: Add `window._elevatorEditor = editor;` after the editor is created
2. **New file**: `dev-server.js` (the SSE server)
3. **New file**: `solution.js` (your elevator code, edited in neovim)

**Workflow**:

```
# Terminal 1
node dev-server.js

# Terminal 2
nvim solution.js
# Write your elevator code as a bare object literal:
# {
#     init: function(elevators, floors) { ... },
#     update: function(dt, elevators, floors) { ... }
# }
# Save with :w → browser simulation restarts automatically
```

## Edge Cases to Handle in Implementation

- **Challenge selection**: The hot-reload triggers `apply_code` which calls `startChallenge(currentChallengeIndex)`. The player should select the challenge in the browser first, then iterate on code in neovim.
- **Auto-start**: `app.startChallenge(index, true)` with `autoStart=true` means the simulation begins immediately. The `apply_code` handler already passes `true`.
- **Error handling**: If `solution.js` has syntax errors, `getCodeObjFromCode()` throws, the game shows an error in the UI and pauses. Fix the error in neovim, save again, and it retries.
- **MIME types**: The static server should ideally set proper Content-Type headers for `.js`, `.css`, etc. The minimal examples above omit this — browsers are generally forgiving for same-origin requests, but adding a MIME lookup (or using `serve-static`) would be more correct.
- **Initial load**: On first page load, the editor will show whatever is in localStorage. The first save of `solution.js` will overwrite it. To always start from the file, add a fetch to `solution.js` on page load in the injected script.
