var http = require("http");
var fs = require("fs");
var path = require("path");

var PORT = 3000;
var ROOT = __dirname;
var WATCHED_FILE = path.join(ROOT, "solution.js");

var MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".json": "application/json"
};

var CLIENT_SCRIPT = [
    "<script>",
    "(function() {",
    "    fetch('/solution.js').then(function(r) {",
    "        return r.text();",
    "    }).then(function(code) {",
    "        if (window._elevatorApp) {",
    "            try { window._elevatorApp.startChallengeWithCode(code); }",
    "            catch(err) { console.error('Code error:', err); }",
    "        }",
    "    });",
    "    var es = new EventSource('/__reload');",
    "    es.addEventListener('code_update', function(e) {",
    "        if (window._elevatorApp) {",
    "            try { window._elevatorApp.startChallengeWithCode(e.data); }",
    "            catch(err) { console.error('Code error:', err); }",
    "        }",
    "    });",
    "})();",
    "</script>"
].join("\n");

var sseClients = [];

var server = http.createServer(function(req, res) {
    if (req.url === "/__reload") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        });
        res.write("retry: 1000\n\n");
        sseClients.push(res);
        req.on("close", function() {
            sseClients = sseClients.filter(function(c) { return c !== res; });
        });
        return;
    }

    var urlPath = req.url.split("?")[0];
    var filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

    if (filePath.indexOf(ROOT) !== 0) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, function(err, data) {
        if (err) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }
        var ext = path.extname(filePath).toLowerCase();
        var contentType = MIME_TYPES[ext] || "application/octet-stream";

        if (ext === ".html") {
            data = data.toString().replace("</body>", CLIENT_SCRIPT + "\n</body>");
        }

        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
    });
});

var lastChange = 0;
function broadcastCode() {
    var now = Date.now();
    if (now - lastChange < 100) return;
    lastChange = now;

    var code;
    try {
        code = fs.readFileSync(WATCHED_FILE, "utf8");
    } catch(e) {
        return;
    }
    var lines = code.split("\n");
    var payload = "event: code_update\ndata: " + lines.join("\ndata: ") + "\n\n";
    sseClients.forEach(function(client) {
        client.write(payload);
    });
}

if (fs.existsSync(WATCHED_FILE)) {
    fs.watch(WATCHED_FILE, { persistent: true }, broadcastCode);
    console.log("Watching solution.js for changes...");
} else {
    console.log("Warning: solution.js not found. Create it to get started.");
    fs.watch(ROOT, { persistent: true }, function(eventType, filename) {
        if (filename === "solution.js" && fs.existsSync(WATCHED_FILE)) {
            fs.watch(WATCHED_FILE, { persistent: true }, broadcastCode);
            console.log("Found solution.js, now watching for changes...");
        }
    });
}

server.listen(PORT, function() {
    console.log("Elevator Saga dev server running at http://localhost:" + PORT);
    console.log("Edit solution.js with your favorite editor, save, and watch changes live in the browser.");
});
