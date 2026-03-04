
$(function() {
    var tsKey = "elevatorTimeScale";

    var $world = $(".innerworld");
    var $stats = $(".statscontainer");
    var $feedback = $(".feedbackcontainer");
    var $challenge = $(".challenge");

    var floorTempl = document.getElementById("floor-template").innerHTML.trim();
    var elevatorTempl = document.getElementById("elevator-template").innerHTML.trim();
    var elevatorButtonTempl = document.getElementById("elevatorbutton-template").innerHTML.trim();
    var userTempl = document.getElementById("user-template").innerHTML.trim();
    var challengeTempl = document.getElementById("challenge-template").innerHTML.trim();
    var feedbackTempl = document.getElementById("feedback-template").innerHTML.trim();

    var app = riot.observable({});
    window._elevatorApp = app;

    app.worldController = createWorldController(1.0 / 60.0);
    app.worldController.on("usercode_error", function(e) {
        console.log("World raised code error", e);
    });

    app.worldCreator = createWorldCreator();
    app.world = undefined;
    app.currentChallengeIndex = 0;
    app._lastCode = null;

    app.startStopOrRestart = function() {
        if(app.world.challengeEnded) {
            app.startChallengeWithCode(app._lastCode);
        } else {
            app.worldController.setPaused(!app.worldController.isPaused);
        }
    };

    app.startChallengeWithCode = function(codeString) {
        app._lastCode = codeString;
        if(typeof app.world !== "undefined") {
            app.world.unWind();
        }
        var challengeIndex = app.currentChallengeIndex;
        app.world = app.worldCreator.createWorld(challenges[challengeIndex].options);
        window.world = app.world;

        clearAll([$world, $feedback]);
        presentStats($stats, app.world);
        presentChallenge($challenge, challenges[challengeIndex], app, app.world, app.worldController, challengeIndex + 1, challengeTempl);
        presentWorld($world, app.world, floorTempl, elevatorTempl, elevatorButtonTempl, userTempl);

        app.worldController.on("timescale_changed", function() {
            localStorage.setItem(tsKey, app.worldController.timeScale);
            presentChallenge($challenge, challenges[challengeIndex], app, app.world, app.worldController, challengeIndex + 1, challengeTempl);
        });

        app.world.on("stats_changed", function() {
            var challengeStatus = challenges[challengeIndex].condition.evaluate(app.world);
            if(challengeStatus !== null) {
                app.world.challengeEnded = true;
                app.worldController.setPaused(true);
                if(challengeStatus) {
                    presentFeedback($feedback, feedbackTempl, app.world, "Success!", "Challenge completed", "#challenge=" + (challengeIndex + 2));
                } else {
                    presentFeedback($feedback, feedbackTempl, app.world, "Challenge failed", "Maybe your program needs an improvement?", "");
                }
            }
        });

        eval(codeString);
        var codeObj = solution;
        app.worldController.start(app.world, codeObj, window.requestAnimationFrame, true);
    };

    riot.route(function(path) {
        var params = _.reduce(path.split(","), function(result, p) {
            var match = p.match(/(\w+)=(\w+$)/);
            if(match) { result[match[1]] = match[2]; } return result;
        }, {});
        var timeScale = parseFloat(localStorage.getItem(tsKey)) || 2.0;
        _.each(params, function(val, key) {
            if(key === "challenge") {
                var requested = _.parseInt(val) - 1;
                if(requested >= 0 && requested < challenges.length) {
                    app.currentChallengeIndex = requested;
                }
            } else if(key === "timescale") {
                timeScale = parseFloat(val);
            }
        });
        app.worldController.setTimeScale(timeScale);
        if(app._lastCode) {
            app.startChallengeWithCode(app._lastCode);
        }
    });
});
