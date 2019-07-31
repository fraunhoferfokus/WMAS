const Route = require("../../data/route");
const Session = require("../../data/session");
const ApiHandler = require("./api-handler");
const SessionManager = require("../../testing/session-manager");
const ResultsManager = require("../../testing/results-manager");
const TestManager = require("../../testing/test-manager");

const { GET } = Route;

class TestApiHandler extends ApiHandler {
  /**
   * @constructor
   * @param {Object} config
   * @param {SessionManager} config.sessionManager
   * @param {ResultsManager} config.resultsManager
   * @param {TestManager} config.testManager
   */
  constructor({
    wavePort,
    wptPort,
    wptSslPort,
    resultsManager,
    sessionManager,
    testManager
  }) {
    super();
    this._wptPort = wptPort;
    this._wptSslPort = wptSslPort;
    this._wavePort = wavePort;
    this._resultsManager = resultsManager;
    this._sessionManager = sessionManager;
    this._testManager = testManager;
  }

  async _nextTest({ request, response }) {
    const { hostname } = request;
    let { token, redirect } = this.parseQueryParameters(request);
    if (!token) {
      token = request.get("token");
    }

    const session = await this._sessionManager.readSession(token);

    switch (session.getStatus()) {
      case Session.PENDING: {
        response.send();
        return;
      }
      case Session.PAUSED: {
        const url = this._generateWaveUrl({
          hostname,
          uri: "/pause.html",
          token
        });
        this._sendUrl({ response, url, redirect });
        return;
      }
      case Session.COMPLETED:
      case Session.ABORTED: {
        const url = this._generateUrl({
          hostname,
          uri: "/complete.html",
          token
        });
        this._sendUrl({ response, url, redirect });
        return;
      }
    }

    let test = this._testManager.nextTest({
      session,
      onTimeout: this._onTestTimeout.bind(this)
    });

    if (!test) {
      if (session.getStatus() !== Session.RUNNING) return;
      const url = this._generateWaveUrl({
        hostname,
        uri: "/complete.html",
        token
      });
      this._sendUrl({ response, url, redirect });
      return;
    }

    const timeouts = session.getTimeouts();
    let testTimeout =
      test.indexOf("manual") !== -1 ? timeouts.manual : timeouts.automatic;
    const timeoutPath = Object.keys(timeouts).find(path =>
      new RegExp("^" + path, "i").test(test)
    );
    if (timeoutPath) {
      testTimeout = timeouts[timeoutPath];
    }
    const url = this._generateTestUrl({ test, token, testTimeout, hostname });

    console.log("TEST", test);
    this._sendUrl({ response, url, redirect });
  }

  _sendUrl({ url, response, redirect }) {
    if (redirect) {
      response.redirect(url);
    } else {
      response.send(url);
    }
  }

  _generateTestUrl({ hostname, test, token, testTimeout }) {
    let protocol = "http";
    let port = this._wptPort;

    if (test.indexOf("https") !== -1) {
      protocol = "https";
      port = this._wptSslPort;
    }

    let query = "?";
    query += "&token=" + token;
    query += "&timeout=" + testTimeout;

    return this._generateUrl({ protocol, hostname, port, uri: test, query });
  }

  _generateWaveUrl({ hostname, token, uri }) {
    return this._generateUrl({
      hostname,
      uri,
      port: this._wavePort,
      query: "?token=" + token
    });
  }

  _generateUrl({ protocol, hostname, port, uri, query }) {
    protocol = protocol || "http";
    port = port || 80;
    uri = uri || "/";
    if (!uri.startsWith("/")) uri = "/" + uri;
    query = query || "";
    return protocol + "://" + hostname + ":" + port + uri + query;
  }

  _onTestTimeout(token, test) {
    console.log("TIMEOUT", test);
    const data = {
      test,
      status: "TIMEOUT",
      message: null,
      subtests: [
        {
          status: "TIMEOUT",
          xstatus: "SERVERTIMEOUT"
        }
      ]
    };
    this._resultsManager
      .createResult({ token, data })
      .catch(error => console.error(error));
  }

  getRoutes() {
    const uri = "/api/next*";
    return [
      new Route({ method: GET, uri, handler: this._handleGet.bind(this) })
    ];
  }

  _handleGet(request, response) {
    const url = this.parseUrl(request);
    switch (url.length) {
      case 1:
        return this._nextTest({ request, response });
    }
    response.status(404).send();
  }
}

module.exports = TestApiHandler;
