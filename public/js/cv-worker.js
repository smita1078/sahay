// Card detection runs here, off the main thread. OpenCV.js needs eval, so this worker alone is
// served with a Content-Security-Policy that allows it (firebase.json); the page itself does not.
import { analyse } from "./quality.js";

let cvPromise = null;
function opencv() {
  cvPromise ||= (async () => {
    const code = await (await fetch(new URL("../vendor/opencv.js", import.meta.url))).text();
    (0, eval)(code); // defines self.cv
    let cv = self.cv;
    if (cv && typeof cv.then === "function") cv = await cv;
    else if (cv && !cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
    return cv;
  })();
  return cvPromise;
}

self.onmessage = async (e) => {
  const { id, rgba, width, height } = e.data;
  try {
    self.postMessage({ id, q: analyse(await opencv(), rgba, width, height) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
