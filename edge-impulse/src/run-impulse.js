// Classifier module
let classifierInitialized = false;
Module.onRuntimeInitialized = function () {
  classifierInitialized = true;
};

class EdgeImpulseClassifier {
  _initialized = false;

  init() {
    if (classifierInitialized === true) return Promise.resolve();

    return new Promise((resolve) => {
      Module.onRuntimeInitialized = () => {
        classifierInitialized = true;
        Module.init();
        resolve();
      };
    });
  }

  getProjectInfo() {
    if (!classifierInitialized) throw new Error("Module is not initialized");
    return Module.get_project();
  }

  classify(rawData, debug = false) {
    if (!classifierInitialized) throw new Error("Module is not initialized");

    let props = Module.get_properties();

    const obj = this._arrayToHeap(rawData);
    let ret = Module.run_classifier(obj.buffer.byteOffset, rawData.length, debug);
    Module._free(obj.ptr);

    if (ret.result !== 0) {
      throw new Error("Classification failed (err code: " + ret.result + ")");
    }

    let jsResult = {
      anomaly: ret.anomaly,
      results: [],
    };

    for (let cx = 0; cx < ret.size(); cx++) {
      let c = ret.get(cx);
      if (props.model_type === "object_detection" || props.model_type === "constrained_object_detection") {
        jsResult.results.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
      } else {
        jsResult.results.push({ label: c.label, value: c.value });
      }
      c.delete();
    }

    if (props.has_visual_anomaly_detection) {
      jsResult.visual_ad_max = ret.visual_ad_max;
      jsResult.visual_ad_mean = ret.visual_ad_mean;
      jsResult.visual_ad_grid_cells = [];
      for (let cx = 0; cx < ret.visual_ad_grid_cells_size(); cx++) {
        let c = ret.visual_ad_grid_cells_get(cx);
        jsResult.visual_ad_grid_cells.push({
          label: c.label,
          value: c.value,
          x: c.x,
          y: c.y,
          width: c.width,
          height: c.height,
        });
        c.delete();
      }
    }

    ret.delete();

    return jsResult;
  }

  classifyContinuous(rawData, enablePerfCal = true) {
    if (!classifierInitialized) throw new Error("Module is not initialized");

    let props = Module.get_properties();

    const obj = this._arrayToHeap(rawData);
    let ret = Module.run_classifier_continuous(obj.buffer.byteOffset, rawData.length, false, enablePerfCal);
    Module._free(obj.ptr);

    if (ret.result !== 0) {
      throw new Error("Classification failed (err code: " + ret.result + ")");
    }

    let jsResult = {
      anomaly: ret.anomaly,
      results: [],
    };

    for (let cx = 0; cx < ret.size(); cx++) {
      let c = ret.get(cx);
      if (props.model_type === "object_detection" || props.model_type === "constrained_object_detection") {
        jsResult.results.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
      } else {
        jsResult.results.push({ label: c.label, value: c.value });
      }
      c.delete();
    }

    if (props.has_visual_anomaly_detection) {
      jsResult.visual_ad_max = ret.visual_ad_max;
      jsResult.visual_ad_mean = ret.visual_ad_mean;
      jsResult.visual_ad_grid_cells = [];
      for (let cx = 0; cx < ret.visual_ad_grid_cells_size(); cx++) {
        let c = ret.visual_ad_grid_cells_get(cx);
        jsResult.visual_ad_grid_cells.push({
          label: c.label,
          value: c.value,
          x: c.x,
          y: c.y,
          width: c.width,
          height: c.height,
        });
        c.delete();
      }
    }

    ret.delete();

    return jsResult;
  }

  getProperties() {
    return Module.get_properties();
  }

  _arrayToHeap(data) {
    let typedArray = new Float32Array(data);
    let numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
    let ptr = Module._malloc(numBytes);
    let heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
    heapBytes.set(new Uint8Array(typedArray.buffer));
    return { ptr: ptr, buffer: heapBytes };
  }
}
