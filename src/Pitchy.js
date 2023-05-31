(function (f) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = f();
  } else if (typeof define === "function" && define.amd) {
    define([], f);
  } else {
    var g;
    if (typeof window !== "undefined") {
      g = window;
    } else if (typeof global !== "undefined") {
      g = global;
    } else if (typeof self !== "undefined") {
      g = self;
    } else {
      g = this;
    }
    g.Pitchy = f();
  }
})(function () {
  var define, module, exports;
  return (function () {
    function r(e, n, t) {
      function o(i, f) {
        if (!n[i]) {
          if (!e[i]) {
            var c = "function" == typeof require && require;
            if (!f && c) return c(i, !0);
            if (u) return u(i, !0);
            var a = new Error("Cannot find module '" + i + "'");
            throw ((a.code = "MODULE_NOT_FOUND"), a);
          }
          var p = (n[i] = { exports: {} });
          e[i][0].call(
            p.exports,
            function (r) {
              var n = e[i][1][r];
              return o(n || r);
            },
            p,
            p.exports,
            r,
            e,
            n,
            t
          );
        }
        return n[i].exports;
      }
      for (
        var u = "function" == typeof require && require, i = 0;
        i < t.length;
        i++
      )
        o(t[i]);
      return o;
    }
    return r;
  })()(
    {
      1: [
        function (require, module, exports) {
          "use strict";

          Object.defineProperty(exports, "__esModule", {
            value: true,
          });
          exports.PitchDetector = exports.Autocorrelator = void 0;
          var _fft = _interopRequireDefault(require("fft.js"));
          function _interopRequireDefault(obj) {
            return obj && obj.__esModule ? obj : { default: obj };
          }
          /**
           * @typedef {Float32Array | Float64Array | number[]} Buffer One of the supported
           * buffer types. Other numeric array types may not work correctly.
           */

          /**
           * A class that can perform autocorrelation on input arrays of a given size.
           *
           * The class holds internal buffers so that no additional allocations are
           * necessary while performing the operation.
           *
           * @template {Buffer} T the buffer type to use. While inputs to the
           * autocorrelation process can be any array-like type, the output buffer
           * (whether provided explicitly or using a fresh buffer) is always of this type.
           */
          class Autocorrelator {
            /** @private @readonly @type {number} */
            _inputLength;
            /** @private @type {FFT} */
            _fft;
            /** @private @type {(size: number) => T} */
            _bufferSupplier;
            /** @private @type {T} */
            _paddedInputBuffer;
            /** @private @type {T} */
            _transformBuffer;
            /** @private @type {T} */
            _inverseBuffer;

            /**
             * A helper method to create an {@link Autocorrelator} using
             * {@link Float32Array} buffers.
             *
             * @param inputLength {number} the input array length to support
             * @returns {Autocorrelator<Float32Array>}
             */
            static forFloat32Array(inputLength) {
              return new Autocorrelator(
                inputLength,
                (length) => new Float32Array(length)
              );
            }

            /**
             * A helper method to create an {@link Autocorrelator} using
             * {@link Float64Array} buffers.
             *
             * @param inputLength {number} the input array length to support
             * @returns {Autocorrelator<Float64Array>}
             */
            static forFloat64Array(inputLength) {
              return new Autocorrelator(
                inputLength,
                (length) => new Float64Array(length)
              );
            }

            /**
             * A helper method to create an {@link Autocorrelator} using `number[]`
             * buffers.
             *
             * @param inputLength {number} the input array length to support
             * @returns {Autocorrelator<number[]>}
             */
            static forNumberArray(inputLength) {
              return new Autocorrelator(inputLength, (length) => Array(length));
            }

            /**
             * Constructs a new {@link Autocorrelator} able to handle input arrays of the
             * given length.
             *
             * @param inputLength {number} the input array length to support. This
             * `Autocorrelator` will only support operation on arrays of this length.
             * @param bufferSupplier {(length: number) => T} the function to use for
             * creating buffers, accepting the length of the buffer to create and
             * returning a new buffer of that length. The values of the returned buffer
             * need not be initialized in any particular way.
             */
            constructor(inputLength, bufferSupplier) {
              if (inputLength < 1) {
                throw new Error(`Input length must be at least one`);
              }
              this._inputLength = inputLength;
              // We need to double the input length to get correct results, and the FFT
              // algorithm we use requires a length that's a power of 2
              this._fft = new _fft.default(ceilPow2(2 * inputLength));
              this._bufferSupplier = bufferSupplier;
              this._paddedInputBuffer = this._bufferSupplier(this._fft.size);
              this._transformBuffer = this._bufferSupplier(2 * this._fft.size);
              this._inverseBuffer = this._bufferSupplier(2 * this._fft.size);
            }

            /**
             * Returns the supported input length.
             *
             * @returns {number} the supported input length
             */
            get inputLength() {
              return this._inputLength;
            }

            /**
             * Autocorrelates the given input data.
             *
             * @param input {ArrayLike<number>} the input data to autocorrelate
             * @param output {T} the output buffer into which to write the autocorrelated
             * data. If not provided, a new buffer will be created.
             * @returns {T} `output`
             */
            autocorrelate(input, output = this._bufferSupplier(input.length)) {
              if (input.length !== this._inputLength) {
                throw new Error(
                  `Input must have length ${this._inputLength} but had length ${input.length}`
                );
              }
              // Step 0: pad the input array with zeros
              for (let i = 0; i < input.length; i++) {
                this._paddedInputBuffer[i] = input[i];
              }
              for (
                let i = input.length;
                i < this._paddedInputBuffer.length;
                i++
              ) {
                this._paddedInputBuffer[i] = 0;
              }

              // Step 1: get the DFT of the input array
              this._fft.realTransform(
                this._transformBuffer,
                this._paddedInputBuffer
              );
              // We need to fill in the right half of the array too
              this._fft.completeSpectrum(this._transformBuffer);
              // Step 2: multiply each entry by its conjugate
              const tb = this._transformBuffer;
              for (let i = 0; i < tb.length; i += 2) {
                tb[i] = tb[i] * tb[i] + tb[i + 1] * tb[i + 1];
                tb[i + 1] = 0;
              }
              // Step 3: perform the inverse transform
              this._fft.inverseTransform(
                this._inverseBuffer,
                this._transformBuffer
              );

              // This last result (the inverse transform) contains the autocorrelation
              // data, which is completely real
              for (let i = 0; i < input.length; i++) {
                output[i] = this._inverseBuffer[2 * i];
              }
              return output;
            }
          }

          /**
           * Returns an array of all the key maximum positions in the given input array.
           *
           * In McLeod's paper, a key maximum is the highest maximum between a positively
           * sloped zero crossing and a negatively sloped one.
           *
           * TODO: it may be more efficient not to construct a new output array each time,
           * but that would also make the code more complicated (more so than the changes
           * that were needed to remove the other allocations).
           *
           * @param input {ArrayLike<number>}
           * @returns {number[]}
           */
          exports.Autocorrelator = Autocorrelator;
          function getKeyMaximumIndices(input) {
            // The indices of the key maxima
            /** @type {number[]} */
            const keyIndices = [];
            // Whether the last zero crossing found was positively sloped; equivalently,
            // whether we're looking for a key maximum
            let lookingForMaximum = false;
            // The largest local maximum found so far
            let max = -Infinity;
            // The index of the largest local maximum so far
            let maxIndex = -1;
            for (let i = 1; i < input.length - 1; i++) {
              if (input[i - 1] <= 0 && input[i] > 0) {
                // Positively sloped zero crossing
                lookingForMaximum = true;
                maxIndex = i;
                max = input[i];
              } else if (input[i - 1] > 0 && input[i] <= 0) {
                // Negatively sloped zero crossing
                lookingForMaximum = false;
                if (maxIndex !== -1) {
                  keyIndices.push(maxIndex);
                }
              } else if (lookingForMaximum && input[i] > max) {
                max = input[i];
                maxIndex = i;
              }
            }
            return keyIndices;
          }

          /**
           * Refines the chosen key maximum index chosen from the given data by
           * interpolating a parabola using the key maximum index and its two neighbors
           * and finding the position of that parabola's maximum value.
           *
           * This is described in section 5 of the MPM paper as a way to refine the
           * position of the maximum.
           *
           * @param index {number} the chosen key maximum index. This must be between `1`
           * and `data.length - 2`, inclusive, since it and its two neighbors need to be
           * valid indexes of `data`.
           * @param data {ArrayLike<number>} the input array from which `index` was chosen
           * @returns {[number, number]} a pair consisting of the refined key maximum index and the
           * interpolated value of `data` at that index (the latter of which is used as a
           * measure of clarity)
           */
          function refineResultIndex(index, data) {
            const [x0, x1, x2] = [index - 1, index, index + 1];
            const [y0, y1, y2] = [data[x0], data[x1], data[x2]];

            // The parabola going through the three data points can be written as
            // y = y0(x - x1)(x - x2)/(x0 - x1)(x0 - x2)
            //   + y1(x - x0)(x - x2)/(x1 - x0)(x1 - x2)
            //   + y2(x - x0)(x - x1)/(x2 - x0)(x2 - x1)
            // Given the definitions of x0, x1, and x2, we can simplify the denominators:
            // y = y0(x - x1)(x - x2)/2
            //   - y1(x - x0)(x - x2)
            //   + y2(x - x0)(x - x1)/2
            // We can expand this out and get the coefficients in standard form:
            // a = y0/2 - y1 + y2/2
            // b = -(y0/2)(x1 + x2) + y1(x0 + x2) - (y2/2)(x0 + x1)
            // c = y0x1x2/2 - y1x0x2 + y2x0x1/2
            // The index of the maximum is -b / 2a (by solving for x where the derivative
            // is 0).

            const a = y0 / 2 - y1 + y2 / 2;
            const b =
              -(y0 / 2) * (x1 + x2) + y1 * (x0 + x2) - (y2 / 2) * (x0 + x1);
            const c = (y0 * x1 * x2) / 2 - y1 * x0 * x2 + (y2 * x0 * x1) / 2;
            const xMax = -b / (2 * a);
            const yMax = a * xMax * xMax + b * xMax + c;
            return [xMax, yMax];
          }

          /**
           * A class that can detect the pitch of a note from a time-domain input array.
           *
           * This class uses the McLeod pitch method (MPM) to detect pitches. MPM is
           * described in the paper 'A Smarter Way to Find Pitch' by Philip McLeod and
           * Geoff Wyvill
           * (http://miracle.otago.ac.nz/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf).
           *
           * The class holds internal buffers so that a minimal number of additional
           * allocations are necessary while performing the operation.
           *
           * @template {Buffer} T the buffer type to use internally. Inputs to the
           * pitch-detection process can be any numeric array type.
           */
          class PitchDetector {
            /** @private @type {Autocorrelator<T>} */
            _autocorrelator;
            /** @private @type {T} */
            _nsdfBuffer;
            // TODO: it might be nice if this were configurable
            /** @private @readonly */
            _clarityThreshold = 0.9;

            /**
             * A helper method to create an {@link PitchDetector} using {@link Float32Array} buffers.
             *
             * @param inputLength {number} the input array length to support
             * @returns {PitchDetector<Float32Array>}
             */
            static forFloat32Array(inputLength) {
              return new PitchDetector(
                inputLength,
                (length) => new Float32Array(length)
              );
            }

            /**
             * A helper method to create an {@link PitchDetector} using {@link Float64Array} buffers.
             *
             * @param inputLength {number} the input array length to support
             * @returns {PitchDetector<Float64Array>}
             */
            static forFloat64Array(inputLength) {
              return new PitchDetector(
                inputLength,
                (length) => new Float64Array(length)
              );
            }

            /**
             * A helper method to create an {@link PitchDetector} using `number[]` buffers.
             *
             * @param inputLength {number} the input array length to support
             * @returns {PitchDetector<number[]>}
             */
            static forNumberArray(inputLength) {
              return new PitchDetector(inputLength, (length) => Array(length));
            }

            /**
             * Constructs a new {@link PitchDetector} able to handle input arrays of the
             * given length.
             *
             * @param inputLength {number} the input array length to support. This
             * `PitchDetector` will only support operation on arrays of this length.
             * @param bufferSupplier {(inputLength: number) => T} the function to use for
             * creating buffers, accepting the length of the buffer to create and
             * returning a new buffer of that length. The values of the returned buffer
             * need not be initialized in any particular way.
             */
            constructor(inputLength, bufferSupplier) {
              this._autocorrelator = new Autocorrelator(
                inputLength,
                bufferSupplier
              );
              this._nsdfBuffer = bufferSupplier(inputLength);
            }

            /**
             * Returns the supported input length.
             *
             * @returns {number} the supported input length
             */
            get inputLength() {
              return this._autocorrelator.inputLength;
            }

            /**
             * Returns the pitch detected using McLeod Pitch Method (MPM) along with a
             * measure of its clarity.
             *
             * The clarity is a value between 0 and 1 (potentially inclusive) that
             * represents how "clear" the pitch was. A clarity value of 1 indicates that
             * the pitch was very distinct, while lower clarity values indicate less
             * definite pitches.
             *
             * @param input {ArrayLike<number>} the time-domain input data
             * @param sampleRate {number} the sample rate at which the input data was
             * collected
             * @returns {[number, number]} the detected pitch, in Hz, followed by the clarity
             */
            findPitch(input, sampleRate) {
              this._nsdf(input);
              const keyMaximumIndices = getKeyMaximumIndices(this._nsdfBuffer);
              if (keyMaximumIndices.length === 0) {
                // No key maxima means that we either don't have enough data to analyze or
                // that the data was flawed (such as an input array of zeroes)
                return [0, 0];
              }
              // The highest key maximum
              const nMax = Math.max(
                ...keyMaximumIndices.map((i) => this._nsdfBuffer[i])
              );
              // Following the paper, we return the pitch corresponding to the first key
              // maximum higher than K * nMax. This is guaranteed not to be undefined, since
              // we know of at least one key maximum satisfying this condition (whichever
              // key maximum gave us nMax).
              const resultIndex = keyMaximumIndices.find(
                (i) => this._nsdfBuffer[i] >= this._clarityThreshold * nMax
              );
              const [refinedResultIndex, clarity] = refineResultIndex(
                // @ts-expect-error resultIndex is guaranteed to be defined
                resultIndex,
                this._nsdfBuffer
              );

              // Due to floating point errors, the clarity may occasionally come out to be
              // slightly over 1.0. We can avoid incorrect results by clamping the value.
              return [sampleRate / refinedResultIndex, Math.min(clarity, 1.0)];
            }

            /**
             * Computes the NSDF of the input and stores it in the internal buffer. This
             * is equation (9) in the McLeod pitch method paper.
             *
             * @private
             * @param input {ArrayLike<number>}
             */
            _nsdf(input) {
              // The function r'(tau) is the autocorrelation
              this._autocorrelator.autocorrelate(input, this._nsdfBuffer);
              // The function m'(tau) (defined in equation (6)) can be computed starting
              // with m'(0), which is equal to 2r'(0), and then iteratively modified to
              // get m'(1), m'(2), etc. For example, to get m'(1), we take m'(0) and
              // subtract x_0^2 and x_{W-1}^2. Then, to get m'(2), we take m'(1) and
              // subtract x_1^2 and x_{W-2}^2, and further values are similar (see the
              // note at the end of section 6 in the MPM paper).
              //
              // The resulting array values are 2 * r'(tau) / m'(tau). We use m below as
              // the incremental value of m'.
              let m = 2 * this._nsdfBuffer[0];
              /** @type {number} */
              let i;
              // As pointed out by issuefiler on GitHub, we can take advantage of the fact
              // that m will never increase to avoid division by zero by ending this loop
              // once m === 0. The rest of the array values after m becomes 0 will just be
              // set to 0 themselves. We actually check for m > 0 rather than m === 0
              // because there may be small floating-point errors that cause m to become
              // negative rather than exactly 0.
              for (i = 0; i < this._nsdfBuffer.length && m > 0; i++) {
                this._nsdfBuffer[i] = (2 * this._nsdfBuffer[i]) / m;
                m -= input[i] ** 2 + input[input.length - i - 1] ** 2;
              }
              // If there are any array values remaining, it means m === 0 for those
              // values of tau, so we can just set them to 0
              for (; i < this._nsdfBuffer.length; i++) {
                this._nsdfBuffer[i] = 0;
              }
            }
          }

          /**
           * Rounds up the input to the next power of 2.
           *
           * @param {number} v
           * @returns {number} the next power of 2 at least as large as `v`
           */
          exports.PitchDetector = PitchDetector;
          function ceilPow2(v) {
            // https://graphics.stanford.edu/~seander/bithacks.html#RoundUpPowerOf2
            v--;
            v |= v >> 1;
            v |= v >> 2;
            v |= v >> 4;
            v |= v >> 8;
            v |= v >> 16;
            v++;
            return v;
          }
        },
        { "fft.js": 2 },
      ],
      2: [
        function (require, module, exports) {
          "use strict";

          function FFT(size) {
            this.size = size | 0;
            if (this.size <= 1 || (this.size & (this.size - 1)) !== 0)
              throw new Error(
                "FFT size must be a power of two and bigger than 1"
              );

            this._csize = size << 1;

            // NOTE: Use of `var` is intentional for old V8 versions
            var table = new Array(this.size * 2);
            for (var i = 0; i < table.length; i += 2) {
              const angle = (Math.PI * i) / this.size;
              table[i] = Math.cos(angle);
              table[i + 1] = -Math.sin(angle);
            }
            this.table = table;

            // Find size's power of two
            var power = 0;
            for (var t = 1; this.size > t; t <<= 1) power++;

            // Calculate initial step's width:
            //   * If we are full radix-4 - it is 2x smaller to give inital len=8
            //   * Otherwise it is the same as `power` to give len=4
            this._width = power % 2 === 0 ? power - 1 : power;

            // Pre-compute bit-reversal patterns
            this._bitrev = new Array(1 << this._width);
            for (var j = 0; j < this._bitrev.length; j++) {
              this._bitrev[j] = 0;
              for (var shift = 0; shift < this._width; shift += 2) {
                var revShift = this._width - shift - 2;
                this._bitrev[j] |= ((j >>> shift) & 3) << revShift;
              }
            }

            this._out = null;
            this._data = null;
            this._inv = 0;
          }
          module.exports = FFT;

          FFT.prototype.fromComplexArray = function fromComplexArray(
            complex,
            storage
          ) {
            var res = storage || new Array(complex.length >>> 1);
            for (var i = 0; i < complex.length; i += 2)
              res[i >>> 1] = complex[i];
            return res;
          };

          FFT.prototype.createComplexArray = function createComplexArray() {
            const res = new Array(this._csize);
            for (var i = 0; i < res.length; i++) res[i] = 0;
            return res;
          };

          FFT.prototype.toComplexArray = function toComplexArray(
            input,
            storage
          ) {
            var res = storage || this.createComplexArray();
            for (var i = 0; i < res.length; i += 2) {
              res[i] = input[i >>> 1];
              res[i + 1] = 0;
            }
            return res;
          };

          FFT.prototype.completeSpectrum = function completeSpectrum(spectrum) {
            var size = this._csize;
            var half = size >>> 1;
            for (var i = 2; i < half; i += 2) {
              spectrum[size - i] = spectrum[i];
              spectrum[size - i + 1] = -spectrum[i + 1];
            }
          };

          FFT.prototype.transform = function transform(out, data) {
            if (out === data)
              throw new Error("Input and output buffers must be different");

            this._out = out;
            this._data = data;
            this._inv = 0;
            this._transform4();
            this._out = null;
            this._data = null;
          };

          FFT.prototype.realTransform = function realTransform(out, data) {
            if (out === data)
              throw new Error("Input and output buffers must be different");

            this._out = out;
            this._data = data;
            this._inv = 0;
            this._realTransform4();
            this._out = null;
            this._data = null;
          };

          FFT.prototype.inverseTransform = function inverseTransform(
            out,
            data
          ) {
            if (out === data)
              throw new Error("Input and output buffers must be different");

            this._out = out;
            this._data = data;
            this._inv = 1;
            this._transform4();
            for (var i = 0; i < out.length; i++) out[i] /= this.size;
            this._out = null;
            this._data = null;
          };

          // radix-4 implementation
          //
          // NOTE: Uses of `var` are intentional for older V8 version that do not
          // support both `let compound assignments` and `const phi`
          FFT.prototype._transform4 = function _transform4() {
            var out = this._out;
            var size = this._csize;

            // Initial step (permute and transform)
            var width = this._width;
            var step = 1 << width;
            var len = (size / step) << 1;

            var outOff;
            var t;
            var bitrev = this._bitrev;
            if (len === 4) {
              for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
                const off = bitrev[t];
                this._singleTransform2(outOff, off, step);
              }
            } else {
              // len === 8
              for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
                const off = bitrev[t];
                this._singleTransform4(outOff, off, step);
              }
            }

            // Loop through steps in decreasing order
            var inv = this._inv ? -1 : 1;
            var table = this.table;
            for (step >>= 2; step >= 2; step >>= 2) {
              len = (size / step) << 1;
              var quarterLen = len >>> 2;

              // Loop through offsets in the data
              for (outOff = 0; outOff < size; outOff += len) {
                // Full case
                var limit = outOff + quarterLen;
                for (var i = outOff, k = 0; i < limit; i += 2, k += step) {
                  const A = i;
                  const B = A + quarterLen;
                  const C = B + quarterLen;
                  const D = C + quarterLen;

                  // Original values
                  const Ar = out[A];
                  const Ai = out[A + 1];
                  const Br = out[B];
                  const Bi = out[B + 1];
                  const Cr = out[C];
                  const Ci = out[C + 1];
                  const Dr = out[D];
                  const Di = out[D + 1];

                  // Middle values
                  const MAr = Ar;
                  const MAi = Ai;

                  const tableBr = table[k];
                  const tableBi = inv * table[k + 1];
                  const MBr = Br * tableBr - Bi * tableBi;
                  const MBi = Br * tableBi + Bi * tableBr;

                  const tableCr = table[2 * k];
                  const tableCi = inv * table[2 * k + 1];
                  const MCr = Cr * tableCr - Ci * tableCi;
                  const MCi = Cr * tableCi + Ci * tableCr;

                  const tableDr = table[3 * k];
                  const tableDi = inv * table[3 * k + 1];
                  const MDr = Dr * tableDr - Di * tableDi;
                  const MDi = Dr * tableDi + Di * tableDr;

                  // Pre-Final values
                  const T0r = MAr + MCr;
                  const T0i = MAi + MCi;
                  const T1r = MAr - MCr;
                  const T1i = MAi - MCi;
                  const T2r = MBr + MDr;
                  const T2i = MBi + MDi;
                  const T3r = inv * (MBr - MDr);
                  const T3i = inv * (MBi - MDi);

                  // Final values
                  const FAr = T0r + T2r;
                  const FAi = T0i + T2i;

                  const FCr = T0r - T2r;
                  const FCi = T0i - T2i;

                  const FBr = T1r + T3i;
                  const FBi = T1i - T3r;

                  const FDr = T1r - T3i;
                  const FDi = T1i + T3r;

                  out[A] = FAr;
                  out[A + 1] = FAi;
                  out[B] = FBr;
                  out[B + 1] = FBi;
                  out[C] = FCr;
                  out[C + 1] = FCi;
                  out[D] = FDr;
                  out[D + 1] = FDi;
                }
              }
            }
          };

          // radix-2 implementation
          //
          // NOTE: Only called for len=4
          FFT.prototype._singleTransform2 = function _singleTransform2(
            outOff,
            off,
            step
          ) {
            const out = this._out;
            const data = this._data;

            const evenR = data[off];
            const evenI = data[off + 1];
            const oddR = data[off + step];
            const oddI = data[off + step + 1];

            const leftR = evenR + oddR;
            const leftI = evenI + oddI;
            const rightR = evenR - oddR;
            const rightI = evenI - oddI;

            out[outOff] = leftR;
            out[outOff + 1] = leftI;
            out[outOff + 2] = rightR;
            out[outOff + 3] = rightI;
          };

          // radix-4
          //
          // NOTE: Only called for len=8
          FFT.prototype._singleTransform4 = function _singleTransform4(
            outOff,
            off,
            step
          ) {
            const out = this._out;
            const data = this._data;
            const inv = this._inv ? -1 : 1;
            const step2 = step * 2;
            const step3 = step * 3;

            // Original values
            const Ar = data[off];
            const Ai = data[off + 1];
            const Br = data[off + step];
            const Bi = data[off + step + 1];
            const Cr = data[off + step2];
            const Ci = data[off + step2 + 1];
            const Dr = data[off + step3];
            const Di = data[off + step3 + 1];

            // Pre-Final values
            const T0r = Ar + Cr;
            const T0i = Ai + Ci;
            const T1r = Ar - Cr;
            const T1i = Ai - Ci;
            const T2r = Br + Dr;
            const T2i = Bi + Di;
            const T3r = inv * (Br - Dr);
            const T3i = inv * (Bi - Di);

            // Final values
            const FAr = T0r + T2r;
            const FAi = T0i + T2i;

            const FBr = T1r + T3i;
            const FBi = T1i - T3r;

            const FCr = T0r - T2r;
            const FCi = T0i - T2i;

            const FDr = T1r - T3i;
            const FDi = T1i + T3r;

            out[outOff] = FAr;
            out[outOff + 1] = FAi;
            out[outOff + 2] = FBr;
            out[outOff + 3] = FBi;
            out[outOff + 4] = FCr;
            out[outOff + 5] = FCi;
            out[outOff + 6] = FDr;
            out[outOff + 7] = FDi;
          };

          // Real input radix-4 implementation
          FFT.prototype._realTransform4 = function _realTransform4() {
            var out = this._out;
            var size = this._csize;

            // Initial step (permute and transform)
            var width = this._width;
            var step = 1 << width;
            var len = (size / step) << 1;

            var outOff;
            var t;
            var bitrev = this._bitrev;
            if (len === 4) {
              for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
                const off = bitrev[t];
                this._singleRealTransform2(outOff, off >>> 1, step >>> 1);
              }
            } else {
              // len === 8
              for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
                const off = bitrev[t];
                this._singleRealTransform4(outOff, off >>> 1, step >>> 1);
              }
            }

            // Loop through steps in decreasing order
            var inv = this._inv ? -1 : 1;
            var table = this.table;
            for (step >>= 2; step >= 2; step >>= 2) {
              len = (size / step) << 1;
              var halfLen = len >>> 1;
              var quarterLen = halfLen >>> 1;
              var hquarterLen = quarterLen >>> 1;

              // Loop through offsets in the data
              for (outOff = 0; outOff < size; outOff += len) {
                for (var i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
                  var A = outOff + i;
                  var B = A + quarterLen;
                  var C = B + quarterLen;
                  var D = C + quarterLen;

                  // Original values
                  var Ar = out[A];
                  var Ai = out[A + 1];
                  var Br = out[B];
                  var Bi = out[B + 1];
                  var Cr = out[C];
                  var Ci = out[C + 1];
                  var Dr = out[D];
                  var Di = out[D + 1];

                  // Middle values
                  var MAr = Ar;
                  var MAi = Ai;

                  var tableBr = table[k];
                  var tableBi = inv * table[k + 1];
                  var MBr = Br * tableBr - Bi * tableBi;
                  var MBi = Br * tableBi + Bi * tableBr;

                  var tableCr = table[2 * k];
                  var tableCi = inv * table[2 * k + 1];
                  var MCr = Cr * tableCr - Ci * tableCi;
                  var MCi = Cr * tableCi + Ci * tableCr;

                  var tableDr = table[3 * k];
                  var tableDi = inv * table[3 * k + 1];
                  var MDr = Dr * tableDr - Di * tableDi;
                  var MDi = Dr * tableDi + Di * tableDr;

                  // Pre-Final values
                  var T0r = MAr + MCr;
                  var T0i = MAi + MCi;
                  var T1r = MAr - MCr;
                  var T1i = MAi - MCi;
                  var T2r = MBr + MDr;
                  var T2i = MBi + MDi;
                  var T3r = inv * (MBr - MDr);
                  var T3i = inv * (MBi - MDi);

                  // Final values
                  var FAr = T0r + T2r;
                  var FAi = T0i + T2i;

                  var FBr = T1r + T3i;
                  var FBi = T1i - T3r;

                  out[A] = FAr;
                  out[A + 1] = FAi;
                  out[B] = FBr;
                  out[B + 1] = FBi;

                  // Output final middle point
                  if (i === 0) {
                    var FCr = T0r - T2r;
                    var FCi = T0i - T2i;
                    out[C] = FCr;
                    out[C + 1] = FCi;
                    continue;
                  }

                  // Do not overwrite ourselves
                  if (i === hquarterLen) continue;

                  // In the flipped case:
                  // MAi = -MAi
                  // MBr=-MBi, MBi=-MBr
                  // MCr=-MCr
                  // MDr=MDi, MDi=MDr
                  var ST0r = T1r;
                  var ST0i = -T1i;
                  var ST1r = T0r;
                  var ST1i = -T0i;
                  var ST2r = -inv * T3i;
                  var ST2i = -inv * T3r;
                  var ST3r = -inv * T2i;
                  var ST3i = -inv * T2r;

                  var SFAr = ST0r + ST2r;
                  var SFAi = ST0i + ST2i;

                  var SFBr = ST1r + ST3i;
                  var SFBi = ST1i - ST3r;

                  var SA = outOff + quarterLen - i;
                  var SB = outOff + halfLen - i;

                  out[SA] = SFAr;
                  out[SA + 1] = SFAi;
                  out[SB] = SFBr;
                  out[SB + 1] = SFBi;
                }
              }
            }
          };

          // radix-2 implementation
          //
          // NOTE: Only called for len=4
          FFT.prototype._singleRealTransform2 = function _singleRealTransform2(
            outOff,
            off,
            step
          ) {
            const out = this._out;
            const data = this._data;

            const evenR = data[off];
            const oddR = data[off + step];

            const leftR = evenR + oddR;
            const rightR = evenR - oddR;

            out[outOff] = leftR;
            out[outOff + 1] = 0;
            out[outOff + 2] = rightR;
            out[outOff + 3] = 0;
          };

          // radix-4
          //
          // NOTE: Only called for len=8
          FFT.prototype._singleRealTransform4 = function _singleRealTransform4(
            outOff,
            off,
            step
          ) {
            const out = this._out;
            const data = this._data;
            const inv = this._inv ? -1 : 1;
            const step2 = step * 2;
            const step3 = step * 3;

            // Original values
            const Ar = data[off];
            const Br = data[off + step];
            const Cr = data[off + step2];
            const Dr = data[off + step3];

            // Pre-Final values
            const T0r = Ar + Cr;
            const T1r = Ar - Cr;
            const T2r = Br + Dr;
            const T3r = inv * (Br - Dr);

            // Final values
            const FAr = T0r + T2r;

            const FBr = T1r;
            const FBi = -T3r;

            const FCr = T0r - T2r;

            const FDr = T1r;
            const FDi = T3r;

            out[outOff] = FAr;
            out[outOff + 1] = 0;
            out[outOff + 2] = FBr;
            out[outOff + 3] = FBi;
            out[outOff + 4] = FCr;
            out[outOff + 5] = 0;
            out[outOff + 6] = FDr;
            out[outOff + 7] = FDi;
          };
        },
        {},
      ],
    },
    {},
    [1]
  )(1);
});
