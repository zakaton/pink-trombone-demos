!(function (t, e) {
  "object" == typeof exports && "object" == typeof module
    ? (module.exports = e())
    : "function" == typeof define && define.amd
    ? define([], e)
    : "object" == typeof exports
    ? (exports.Markov = e())
    : (t.Markov = e());
})("undefined" != typeof self ? self : this, function () {
  return (function (t) {
    var e = {};
    function r(i) {
      if (e[i]) return e[i].exports;
      var o = (e[i] = { i: i, l: !1, exports: {} });
      return t[i].call(o.exports, o, o.exports, r), (o.l = !0), o.exports;
    }
    return (
      (r.m = t),
      (r.c = e),
      (r.d = function (t, e, i) {
        r.o(t, e) || Object.defineProperty(t, e, { enumerable: !0, get: i });
      }),
      (r.r = function (t) {
        "undefined" != typeof Symbol &&
          Symbol.toStringTag &&
          Object.defineProperty(t, Symbol.toStringTag, { value: "Module" }),
          Object.defineProperty(t, "__esModule", { value: !0 });
      }),
      (r.t = function (t, e) {
        if ((1 & e && (t = r(t)), 8 & e)) return t;
        if (4 & e && "object" == typeof t && t && t.__esModule) return t;
        var i = Object.create(null);
        if (
          (r.r(i),
          Object.defineProperty(i, "default", { enumerable: !0, value: t }),
          2 & e && "string" != typeof t)
        )
          for (var o in t)
            r.d(
              i,
              o,
              function (e) {
                return t[e];
              }.bind(null, o)
            );
        return i;
      }),
      (r.n = function (t) {
        var e =
          t && t.__esModule
            ? function () {
                return t.default;
              }
            : function () {
                return t;
              };
        return r.d(e, "a", e), e;
      }),
      (r.o = function (t, e) {
        return Object.prototype.hasOwnProperty.call(t, e);
      }),
      (r.p = ""),
      r((r.s = 0))
    );
  })([
    function (t, e) {
      function r(t) {
        return (r =
          "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
            ? function (t) {
                return typeof t;
              }
            : function (t) {
                return t &&
                  "function" == typeof Symbol &&
                  t.constructor === Symbol &&
                  t !== Symbol.prototype
                  ? "symbol"
                  : typeof t;
              })(t);
      }
      function i(t) {
        return (
          (function (t) {
            if (Array.isArray(t)) {
              for (var e = 0, r = new Array(t.length); e < t.length; e++)
                r[e] = t[e];
              return r;
            }
          })(t) ||
          (function (t) {
            if (
              Symbol.iterator in Object(t) ||
              "[object Arguments]" === Object.prototype.toString.call(t)
            )
              return Array.from(t);
          })(t) ||
          (function () {
            throw new TypeError(
              "Invalid attempt to spread non-iterable instance"
            );
          })()
        );
      }
      function o(t, e) {
        for (var r = 0; r < e.length; r++) {
          var i = e[r];
          (i.enumerable = i.enumerable || !1),
            (i.configurable = !0),
            "value" in i && (i.writable = !0),
            Object.defineProperty(t, i.key, i);
        }
      }
      var n = (function () {
        function t() {
          var e =
            arguments.length > 0 && void 0 !== arguments[0]
              ? arguments[0]
              : "text";
          if (
            ((function (t, e) {
              if (!(t instanceof e))
                throw new TypeError("Cannot call a class as a function");
            })(this, t),
            "text" === e)
          )
            this.type = e;
          else {
            if ("numeric" !== e)
              throw new Error(
                "The Markov Chain can only accept the following types: numeric or text"
              );
            this.type = e;
          }
          (this.states = []),
            (this.possibilities = {}),
            (this.order = 3),
            "text" === this.type && (this.start = []);
        }
        var e, n, s;
        return (
          (e = t),
          (n = [
            {
              key: "addStates",
              value: function (t) {
                Array.isArray(t)
                  ? (this.states = Array.from(t))
                  : this.states.push(t);
              },
            },
            {
              key: "clearChain",
              value: function () {
                (this.states = []),
                  "text" === this.type && (this.start = []),
                  (this.possibilities = {}),
                  (this.order = 3);
              },
            },
            {
              key: "clearState",
              value: function () {
                (this.states = []), "text" === this.type && (this.start = []);
              },
            },
            {
              key: "clearPossibilities",
              value: function () {
                this.possibilities = {};
              },
            },
            {
              key: "getStates",
              value: function () {
                return this.states;
              },
            },
            {
              key: "setOrder",
              value: function () {
                var t =
                  arguments.length > 0 && void 0 !== arguments[0]
                    ? arguments[0]
                    : 3;
                "number" != typeof t &&
                  (console.error(
                    "Markov.setOrder: Order is not a number. Defaulting to 3."
                  ),
                  (t = 3)),
                  t <= 0 &&
                    console.error(
                      "Markov.setOrder: Order is not a positive number. Defaulting to 3."
                    ),
                  "numeric" === this.type &&
                    console.warn(
                      "The Markov Chain only accepts numerical data. Therefore, the order does not get used.\nThe order may be used by you to simulate an ID for the Markov Chain if required"
                    ),
                  (this.order = t);
              },
            },
            {
              key: "getOrder",
              value: function () {
                return (
                  "numeric" === this.type &&
                    console.warn(
                      "The Markov Chain only accepts numerical data. Therefore, the order does not get used.\nThe order may be used by you to simulate an ID for the Markov Chain if required"
                    ),
                  this.order
                );
              },
            },
            {
              key: "getPossibilities",
              value: function (t) {
                if (t) {
                  if (void 0 !== this.possibilities[t])
                    return this.possibilities[t];
                  throw new Error("There is no such possibility called " + t);
                }
                return this.possibilities;
              },
            },
            {
              key: "train",
              value: function (t) {
                if (
                  (this.clearPossibilities(),
                  t && (this.order = t),
                  "text" === this.type)
                )
                  for (var e = 0; e < this.states.length; e++) {
                    this.start.push(this.states[e].substring(0, this.order));
                    for (
                      var r = 0;
                      r <= this.states[e].length - this.order;
                      r++
                    ) {
                      var o = this.states[e].substring(r, r + this.order);
                      this.possibilities[o] || (this.possibilities[o] = []),
                        this.possibilities[o].push(
                          this.states[e].charAt(r + this.order)
                        );
                    }
                  }
                else if ("numeric" === this.type)
                  for (var n = 0; n < this.states.length; n++) {
                    var s,
                      a = this.states[n],
                      u = a.state,
                      l = a.predictions;
                    this.possibilities[u] || (this.possibilities[u] = []),
                      (s = this.possibilities[u]).push.apply(s, i(l));
                  }
              },
            },
            {
              key: "generateRandom",
              value: function () {
                var t =
                  arguments.length > 0 && void 0 !== arguments[0]
                    ? arguments[0]
                    : 15;
                if ("text" === this.type) {
                  for (
                    var e = this.random(this.start, "array"),
                      r = e,
                      i = e,
                      o = "",
                      n = 0;
                    n < t - this.order &&
                    (o = this.random(this.possibilities[i], "array"));
                    n++
                  )
                    i = (r += o).substring(r.length - this.order, r.length);
                  return r;
                }
                if ("numeric" === this.type) {
                  for (var s = [], a = 0; a < t; ++a) {
                    var u = this.random(this.possibilities, "object");
                    Math.random() < 0.5
                      ? s.push(parseInt(u))
                      : s.push(parseInt(this.predict(u)));
                  }
                  return s;
                }
              },
            },
            {
              key: "random",
              value: function (t, e) {
                if (Array.isArray(t) && "array" === e)
                  return t[Math.floor(Math.random() * t.length)];
                if ("object" === r(t) && "object" === e) {
                  var i = Object.keys(t);
                  return i[Math.floor(Math.random() * i.length)];
                }
              },
            },
            {
              key: "predict",
              value: function (t) {
                if ("numeric" !== this.type)
                  throw new Error(
                    "The predict function only works with numerical values - for now"
                  );
                if (this.possibilities[t])
                  return this.random(this.possibilities[t], "array");
                console.error("The markov chain could not find a possibility");
              },
            },
            {
              key: "getType",
              value: function () {
                return this.type;
              },
            },
            {
              key: "setType",
              value: function () {
                var t =
                  arguments.length > 0 && void 0 !== arguments[0]
                    ? arguments[0]
                    : "text";
                if ("text" !== t && "numeric" !== t)
                  throw new Error("Invalid type: " + t);
                this.clearChain(), (this.type = t);
              },
            },
          ]) && o(e.prototype, n),
          s && o(e, s),
          t
        );
      })();
      t.exports = n;
    },
  ]);
});
