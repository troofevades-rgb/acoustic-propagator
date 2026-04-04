// Re-export window.Cesium (loaded via <script> tag in index.html)
// so that `import * as Cesium from 'cesium'` works in all modules.
export default window.Cesium;

// Proxy all named exports from the global Cesium object
// This allows `import { Cartesian3, Color } from 'cesium'` to work
const handler = {
  get(_, key) {
    return window.Cesium[key];
  },
};
const proxy = new Proxy({}, handler);

// We can't dynamically create named exports, so modules should use:
//   import Cesium from 'cesium'    (default import)
// or:
//   const Cesium = window.Cesium   (direct global access)
//
// The `import * as Cesium from 'cesium'` pattern will give this module,
// where Cesium.default is the full namespace.
