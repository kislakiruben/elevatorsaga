# Implementation Plan: SSE Live-Reload Dev Server

## Overview

Build a zero-dependency Node.js dev server that watches `solution.js` for changes and pushes the new code to the browser via Server-Sent Events. The browser receives the code, parses it with `getCodeObjFromCode()`, and starts the simulation directly. The CodeMirror editor is removed entirely — code is edited only in neovim (or any external editor).

## Files to Create/Modify

| File            | Action  | Purpose                                                              |
| --------------- | ------- | -------------------------------------------------------------------- |
| `app.js`        | Rewrite | Remove editor, replace with `startChallengeWithCode()` driven by SSE |
| `index.html`    | Modify  | Remove editor DOM, CodeMirror script tags, and editor buttons        |
| `dev-server.js` | Create  | SSE static server + file watcher                                     |
| `solution.js`   | Create  | Starter elevator code for editing in neovim                          |

## Step 1: Strip the Editor from index.html

### 1a: Remove CodeMirror script tags

Remove these three `<script>` tags from `<head>` (lines 16-18):

```html
<script type="text/javascript" src="libs/codemirror/codemirror.js"></script>
<script
  type="text/javascript"
  src="libs/codemirror/addon/edit/closebrackets.js"
></script>
<script
  type="text/javascript"
  src="libs/codemirror/mode/javascript/javascript.js"
></script>
```

Also remove the CodeMirror CSS links (lines 8-9):

```html
<link rel="stylesheet" href="libs/codemirror/codemirror.css" />
<link rel="stylesheet" href="libs/codemirror/themes/solarized.css" />
```

### 1b: Remove editor DOM elements

Remove lines 168-181 — the editor textarea, buttons, save/fitness messages, and help link:

```html
<div class="codestatus"></div>
<div class="code">
  <textarea name="Code" id="code"></textarea>
</div>
<button id="button_reset" style="float: left">Reset</button>
<button id="button_resetundo" style="float: left">Undo reset</button>
<button id="button_apply" style="float: right">Apply</button>
<button id="button_save" style="float: right">Save</button>
<span id="save_message" style="float: right"></span>
<span id="fitness_message" style="float: right"></span>
<div style="clear:both;"></div>

<div style="margin-top: 20px">
  <h3>
    Confused? Open the
    <a href="documentation.html">Help and API documentation</a> page
  </h3>
</div>
```

### 1c: Remove the default code template scripts

Remove the two `<script type="text/plain">` blocks (lines 86-134) — `#default-elev-implementation` and `#devtest-elev-implementation`. These were only used by the editor's reset/devtest features.

## Step 2: Rewrite app.js — Remove Editor, Add Code Injection

Replace `app.js` entirely. The new version:

- Removes `createEditor()` and all editor-related code (CodeMirror setup, localStorage persistence, save/reset/apply buttons, auto-saver)
- Removes `createParamsUrl()` (only used for editor-related URL params)
- Keeps the core: world creation, challenge system, presenters, world controller, route handling
- Adds `app.startChallengeWithCode(codeString)` as the primary way to run code
- Exposes `app` on `window._elevatorApp`

### New app.js structure:

```javascript
$(function () {
  var tsKey = "elevatorTimeScale";

  var $world = $(".innerworld");
  var $stats = $(".statscontainer");
  var $feedback = $(".feedbackcontainer");
  var $challenge = $(".challenge");

  var floorTempl = document.getElementById("floor-template").innerHTML.trim();
  var elevatorTempl = document
    .getElementById("elevator-template")
    .innerHTML.trim();
  var elevatorButtonTempl = document
    .getElementById("elevatorbutton-template")
    .innerHTML.trim();
  var userTempl = document.getElementById("user-template").innerHTML.trim();
  var challengeTempl = document
    .getElementById("challenge-template")
    .innerHTML.trim();
  var feedbackTempl = document
    .getElementById("feedback-template")
    .innerHTML.trim();

  var app = riot.observable({});
  app.worldController = createWorldController(1.0 / 60.0);
  app.worldController.on("usercode_error", function (e) {
    console.log("World raised code error", e);
  });

  app.worldCreator = createWorldCreator();
  app.world = undefined;
  app.currentChallengeIndex = 0;

  app.startStopOrRestart = function () {
    if (app.world.challengeEnded) {
      app.startChallengeWithCode(app._lastCode);
    } else {
      app.worldController.setPaused(!app.worldController.isPaused);
    }
  };

  app.startChallengeWithCode = function (codeString) {
    app._lastCode = codeString;
    if (typeof app.world !== "undefined") {
      app.world.unWind();
    }
    var challengeIndex = app.currentChallengeIndex;
    app.world = app.worldCreator.createWorld(
      challenges[challengeIndex].options,
    );
    window.world = app.world;

    clearAll([$world, $feedback]);
    presentStats($stats, app.world);
    presentChallenge(
      $challenge,
      challenges[challengeIndex],
      app,
      app.world,
      app.worldController,
      challengeIndex + 1,
      challengeTempl,
    );
    presentWorld(
      $world,
      app.world,
      floorTempl,
      elevatorTempl,
      elevatorButtonTempl,
      userTempl,
    );

    app.worldController.on("timescale_changed", function () {
      localStorage.setItem(tsKey, app.worldController.timeScale);
      presentChallenge(
        $challenge,
        challenges[challengeIndex],
        app,
        app.world,
        app.worldController,
        challengeIndex + 1,
        challengeTempl,
      );
    });

    app.world.on("stats_changed", function () {
      var challengeStatus = challenges[challengeIndex].condition.evaluate(
        app.world,
      );
      if (challengeStatus !== null) {
        app.world.challengeEnded = true;
        app.worldController.setPaused(true);
        if (challengeStatus) {
          presentFeedback(
            $feedback,
            feedbackTempl,
            app.world,
            "Success!",
            "Challenge completed",
            "#challenge=" + (challengeIndex + 2),
          );
        } else {
          presentFeedback(
            $feedback,
            feedbackTempl,
            app.world,
            "Challenge failed",
            "Maybe your program needs an improvement?",
            "",
          );
        }
      }
    });

    var codeObj = getCodeObjFromCode(codeString);
    app.worldController.start(
      app.world,
      codeObj,
      window.requestAnimationFrame,
      true,
    );
  };

  window._elevatorApp = app;

  // Handle challenge selection from URL hash
  riot.route(function (path) {
    var params = _.reduce(
      path.split(","),
      function (result, p) {
        var match = p.match(/(\w+)=(\w+$)/);
        if (match) {
          result[match[1]] = match[2];
        }
        return result;
      },
      {},
    );
    var timeScale = parseFloat(localStorage.getItem(tsKey)) || 2.0;
    _.each(params, function (val, key) {
      if (key === "challenge") {
        var requested = _.parseInt(val) - 1;
        if (requested >= 0 && requested < challenges.length) {
          app.currentChallengeIndex = requested;
        }
      } else if (key === "timescale") {
        timeScale = parseFloat(val);
      }
    });
    app.worldController.setTimeScale(timeScale);
    // If we have code already (from SSE/fetch), restart with it
    if (app._lastCode) {
      app.startChallengeWithCode(app._lastCode);
    }
  });
});
```

Key differences from the original:

- **No `createEditor()`** — the entire function and its 110 lines are gone
- **No `createParamsUrl()`** — success feedback uses a simple hash string directly
- **No `editor.on("apply_code")` / `editor.on("code_success")` / `editor.on("usercode_error")` / `editor.on("change")`** — all removed
- **`app._lastCode`** — stores the most recent code string so `startStopOrRestart()` can restart the current challenge (e.g., after completion) and so route changes re-run with the current code
- **`riot.route` handler** — only handles `challenge` and `timescale` params (removed `autostart`, `devtest`, `fullscreen` which were editor-specific). Calls `startChallengeWithCode` only if code has already been received
- **No initial `startChallenge()` call** — the page waits for the SSE client script to fetch `solution.js` and call `startChallengeWithCode()`. No double-start.

### Removed template reference

The `codeStatusTempl` variable and `codestatus-template` script tag are no longer needed (they were for showing code parse errors in the UI). Remove the template from `index.html` (lines 82-84):

```html
<script type="text/template" id="codestatus-template">
  <h5 class="error" style="display: {errorDisplay}"><i class="fa fa-warning error-color"></i> There is a problem with your code: {errorMessage}</h5>
</script>
```

## Step 3: Create the Dev Server (dev-server.js)

**File**: `dev-server.js` (new, project root)

### 3a: Static File Server

Serve all files from the project root with proper MIME types. Use a lookup map:

```javascript
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
};
```

Default to `application/octet-stream` for unknown extensions.

### 3a-ii: Startup Message

On `server.listen`, print a helpful message to the console:

```
Elevator Saga dev server running at http://localhost:3000
Edit solution.js with your favorite editor, save, and watch changes live in the browser.
Watching solution.js for changes...
```

### 3b: SSE Endpoint (`/__reload`)

When the browser requests `GET /__reload`:

- Respond with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Write `retry: 1000\n\n` (tells browser to auto-reconnect after 1s)
- Hold the response open, add to `sseClients` array
- On request close, remove from array

### 3c: File Watcher

Use `fs.watch()` on `solution.js` (Node builtin).

On change:

1. Read file with `fs.readFileSync()`
2. Format as SSE: `event: code_update\ndata: <line1>\ndata: <line2>\n...\n\n`
3. Write to all connected clients

Add timestamp-based debounce (~100ms) to handle duplicate `fs.watch` events.

### 3d: HTML Injection

When serving `index.html`, inject a `<script>` tag before `</body>` that:

```javascript
(function () {
  // On initial load, fetch solution.js and start the simulation
  fetch("/solution.js")
    .then(function (r) {
      return r.text();
    })
    .then(function (code) {
      if (window._elevatorApp) {
        try {
          window._elevatorApp.startChallengeWithCode(code);
        } catch (err) {
          console.error("Code error:", err);
        }
      }
    });

  // On file changes, restart simulation with new code
  var es = new EventSource("/__reload");
  es.addEventListener("code_update", function (e) {
    if (window._elevatorApp) {
      try {
        window._elevatorApp.startChallengeWithCode(e.data);
      } catch (err) {
        console.error("Code error:", err);
      }
    }
  });
})();
```

## Step 4: Create Starter solution.js

**File**: `solution.js` (new, project root)

Copy the default implementation:

```javascript
{
    init: function(elevators, floors) {
        var elevator = elevators[0];

        elevator.on("idle", function() {
            elevator.goToFloor(0);
            elevator.goToFloor(1);
        });
    },
    update: function(dt, elevators, floors) {
    }
}
```

## Step 5: Add to .gitignore

Add `solution.js` to `.gitignore`.

## Execution Flow (End to End)

```
Terminal 1:  node dev-server.js
             → "Elevator Saga dev server running at http://localhost:3000"
             → "Edit solution.js with your favorite editor, save, and watch changes live in the browser."
             → "Watching solution.js for changes..."

Terminal 2:  nvim solution.js
             → edit code, :w

Browser:     open http://localhost:3000
             → game loads (no editor visible — it's been removed from DOM)
             → riot.route fires, sets challenge index but no code yet — nothing starts
             → injected script fetches /solution.js
             → calls app.startChallengeWithCode(code)
             → simulation starts

On save:     fs.watch fires
             → server reads solution.js
             → SSE pushes code_update event to browser
             → injected script calls app.startChallengeWithCode(newCode)
             → game tears down old world, creates new one with updated code
             → simulation restarts immediately
```

## Error Handling

- **Syntax errors in solution.js**: `getCodeObjFromCode()` throws during eval. The `try/catch` in the injected script catches it and logs to browser console. The old simulation keeps running (or stays ended). Fix the error in neovim, save → next SSE push retries.
- **solution.js doesn't exist yet**: Server should handle gracefully — log a message, and either create `solution.js` with default code or watch the directory for the file to appear.
- **SSE connection drops**: `EventSource` auto-reconnects (retry: 1000ms).
- **Challenge selection**: Player selects a challenge via the URL hash (e.g., `#challenge=3`). The route handler updates `currentChallengeIndex` and restarts with `_lastCode`. The challenge bar with Start/Pause and time scale controls remains visible.

## TODO

### Phase 1: Strip the editor from the frontend

- [x] Remove CodeMirror CSS links from `index.html` `<head>` (`codemirror.css`, `solarized.css`)
- [x] Remove CodeMirror `<script>` tags from `index.html` `<head>` (`codemirror.js`, `closebrackets.js`, `javascript.js`)
- [x] Remove `#codestatus-template` script block from `index.html`
- [x] Remove `#default-elev-implementation` script block from `index.html`
- [x] Remove `#devtest-elev-implementation` script block from `index.html`
- [x] Remove editor DOM: `.codestatus` div, `.code` div with `#code` textarea, all buttons (`#button_reset`, `#button_resetundo`, `#button_apply`, `#button_save`), `#save_message`, `#fitness_message`, clearfix div, and help link div
- [x] Verify `index.html` still has all the required template scripts (`floor-template`, `elevator-template`, `elevatorbutton-template`, `user-template`, `challenge-template`, `feedback-template`)

### Phase 2: Rewrite app.js

- [x] Remove the `createEditor()` function (lines 2-110)
- [x] Remove the `createParamsUrl()` function (lines 113-117)
- [x] Remove `var editor = createEditor();` from the `$(function() { ... })` block
- [x] Remove all `editor.on(...)` handlers (`apply_code`, `code_success`, `usercode_error`, `change`)
- [x] Remove `var codeStatusTempl` and the `presentCodeStatus` calls
- [x] Remove `editor.trigger("change")` call
- [x] Add `window._elevatorApp = app;` after `var app = riot.observable({});`
- [x] Add `app._lastCode` property for storing the most recent code string
- [x] Add `app.startChallengeWithCode(codeString)` method that calls `getCodeObjFromCode()` directly and starts the world with auto-start
- [x] Modify `app.startStopOrRestart()` to use `app.startChallengeWithCode(app._lastCode)` instead of `app.startChallenge()`
- [x] Simplify `riot.route` handler: keep only `challenge` and `timescale` params, remove `autostart`/`devtest`/`fullscreen`
- [x] Change `riot.route` handler to call `app.startChallengeWithCode(app._lastCode)` only if `_lastCode` exists (don't start without code)
- [x] Replace `createParamsUrl()` usage in success feedback with simple `"#challenge=" + (challengeIndex + 2)` string

### Phase 3: Create the dev server

- [x] Create `dev-server.js` in project root
- [x] Implement static file server with MIME type lookup map
- [x] Implement `/__reload` SSE endpoint (event-stream headers, client tracking, cleanup on disconnect)
- [x] Implement `fs.watch()` file watcher on `solution.js` with timestamp-based debounce (~100ms)
- [x] Implement SSE broadcast: read file, format as `event: code_update\ndata: ...\n\n`, send to all clients
- [x] Implement HTML injection: when serving `.html` files, inject `<script>` before `</body>` with fetch-on-load and EventSource listener
- [x] Add startup console message: server URL, instruction to edit `solution.js`, watching status
- [x] Handle missing `solution.js` gracefully on server start (log a message or create with default code)

### Phase 4: Create solution.js and .gitignore

- [x] Create `solution.js` with the default elevator implementation (bare object literal with `init` and `update`)
- [x] Add `solution.js` to `.gitignore`

### Phase 5: Test end-to-end

- [x] Start dev server with `node dev-server.js`, verify startup message prints
- [x] Open `http://localhost:3000` in browser, verify simulation starts with `solution.js` content
- [x] Verify no editor, buttons, or code textarea visible — just simulation and challenge bar
- [x] Edit `solution.js` externally, save — verify simulation restarts in browser without page reload
- [ ] Introduce a syntax error in `solution.js`, save — verify error in browser console, simulation doesn't crash (manual browser test)
- [ ] Fix the syntax error, save — verify simulation recovers (manual browser test)
- [ ] Close and reopen browser tab — verify it fetches `solution.js` on load (manual browser test)
- [ ] Kill and restart dev server — verify `EventSource` auto-reconnects (manual browser test)
- [ ] Navigate to `#challenge=3` — verify challenge changes and runs with current code (manual browser test)
- [ ] Test Start/Pause button and time scale controls still work (manual browser test)

## Testing the Implementation

1. Start server: `node dev-server.js`
2. Open `http://localhost:3000` in browser
3. Verify game loads and simulation starts with `solution.js` content
4. Verify no editor, no buttons, no code textarea visible — just the simulation and challenge bar
5. Edit `solution.js` in neovim, save
6. Verify simulation restarts in browser without page reload
7. Introduce a syntax error in `solution.js`, save — verify error in browser console, simulation doesn't crash
8. Fix the error, save — verify simulation recovers
9. Close and reopen browser tab — verify it fetches `solution.js` on load
10. Kill and restart server — verify `EventSource` reconnects automatically
11. Navigate to `#challenge=3` — verify challenge changes and runs with current code
