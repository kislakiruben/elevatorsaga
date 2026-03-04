Elevator Saga
===================
The elevator programming game

[Play it now!](http://play.elevatorsaga.com/)

Or [Run the unit tests](http://play.elevatorsaga.com/test/)

![Image of Elevator Saga in browser](https://raw.githubusercontent.com/magwo/elevatorsaga/master/images/screenshot.png)

## Dev Server

A live-reload dev server lets you edit elevator code in your editor of choice and see changes instantly in the browser — no in-browser editor, no manual clicking.

### Setup

No dependencies to install. Just Node.js.

```bash
node dev-server.js
```

Then open http://localhost:3000 in your browser.

### Usage

Edit `solution.js` with any editor (neovim, VS Code, etc.). Every time you save, the simulation restarts automatically in the browser with your new code.

```javascript
// solution.js
var solution = {
  init: function (elevators, floors) {
    var elevator = elevators[0];

    elevator.on("idle", function () {
      elevator.goToFloor(0);
      elevator.goToFloor(1);
    });
  },
  update: function (dt, elevators, floors) {},
};
```

The file must define a `var solution` with `init` and `update` functions. See the [API documentation](http://play.elevatorsaga.com/documentation.html) for available methods.

### How it works

The dev server serves the game statically, watches `solution.js` for changes, and pushes updates to the browser via Server-Sent Events (SSE). No npm packages required — uses only Node.js builtins.
