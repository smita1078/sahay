// Image checks that need no model: light, glare, sharpness and finding the card.
// Port of src/sahay/capture/quality.py using OpenCV.js (tested against the Python verdicts).
// Frames are analysed in memory only and never stored (rules register D3).

export const ANALYSIS_WIDTH = 640;
const DARK_MEAN = 55, NO_DOC_DARK_MEAN = 30, GLARE_LEVEL = 250, GLARE_FRACTION = 0.03, BLUR_VARIANCE = 40;
const MIN_DOC_AREA = 0.04, FAR_DOC_AREA = 0.12, BORDER_PX = 4, RECT_FILL = 0.88, TEXT_DENSITY_CLOSE = 0.045;

// Python's round() rounds halves to even; keep sizes identical to the server version.
export function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// rgba: Uint8ClampedArray/Uint8Array of width*height*4, already at analysis size.
export function analyse(cv, rgba, width, height) {
  const src = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();
  try {
    const found = findCard(cv, gray, rgba, width, height);
    const g = gray.data;
    const box = found.box;
    const [x0, y0, x1, y1] = box ? [box.x0, box.y0, box.x1, box.y1] : [0, 0, width, height];
    let sum = 0, glare = 0, n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * width + x;
        sum += g[i]; n += 1;
        const j = i * 4;
        if (rgba[j] >= GLARE_LEVEL && rgba[j + 1] >= GLARE_LEVEL && rgba[j + 2] >= GLARE_LEVEL) glare += 1;
      }
    }
    const mean = n ? sum / n : 0;
    const brightness = box ? mean : mean + (DARK_MEAN - NO_DOC_DARK_MEAN);
    const sharpness = laplacianVariance(g, width, x0, y0, x1, y1);
    const glareFraction = n ? glare / n : 0;
    return {
      width, height, brightness, sharpness, glare_fraction: glareFraction,
      document_found: !!box || found.too_close, box, edges_cut: found.edges, too_close: found.too_close, too_far: found.too_far,
      too_dark: brightness < DARK_MEAN, blurry: sharpness < BLUR_VARIANCE, glare: glareFraction > GLARE_FRACTION,
    };
  } finally {
    gray.delete();
  }
}

export function checksDict(q) {
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    brightness: r1(q.brightness), sharpness: r1(q.sharpness), glare_fraction: Math.round(q.glare_fraction * 1e4) / 1e4,
    document_found: q.document_found, edges_cut: q.edges_cut, too_close: q.too_close, too_far: q.too_far,
    too_dark: q.too_dark, blurry: q.blurry, glare: q.glare,
  };
}

function laplacianVariance(g, width, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0;
  if (w < 3 || h < 3) return 0;
  let sum = 0, sq = 0, n = 0;
  for (let y = y0 + 1; y < y1 - 1; y += 1) {
    for (let x = x0 + 1; x < x1 - 1; x += 1) {
      const i = y * width + x;
      const v = g[i - 1] + g[i + 1] + g[i - width] + g[i + width] - 4 * g[i];
      sum += v; sq += v * v; n += 1;
    }
  }
  const m = sum / n;
  return sq / n - m * m;
}

function canny(cv, gray, lo, hi) {
  const blur = new cv.Mat(), edges = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
  cv.Canny(blur, edges, lo, hi);
  blur.delete();
  return edges;
}

function findCard(cv, gray, rgba, w, h) {
  const raw = canny(cv, gray, 30, 90);
  const textDensity = cv.countNonZero(raw) / (w * h);
  let found = bestRectangle(cv, gray, raw);
  raw.delete();
  if (!found) { // blurred cards lose their outline at full size; try a small copy
    const smallW = 160, smallH = Math.max(1, pyRound((h * smallW) / w));
    const small = new cv.Mat();
    cv.resize(gray, small, new cv.Size(smallW, smallH), 0, 0, cv.INTER_AREA);
    const e = canny(cv, small, 15, 45);
    const hit = bestRectangle(cv, small, e);
    e.delete(); small.delete();
    if (hit) {
      const k = w / smallW;
      const b = hit.box;
      found = { box: { x0: pyRound(b.x0 * k), y0: pyRound(b.y0 * k), x1: pyRound(b.x1 * k), y1: pyRound(b.y1 * k) }, edges: hit.edges, fraction: hit.fraction };
    }
  }
  // A card filling the frame shows dense printed text over pale paper, and no outline at all.
  let paper = 0;
  for (let i = 0; i < w * h; i += 1) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 140 && (mx - mn) / Math.max(mx, 1) < 0.25) paper += 1;
  }
  paper /= w * h;
  if (textDensity > TEXT_DENSITY_CLOSE && paper > 0.6) return { box: null, edges: [], too_close: true, too_far: false };
  if (!found) return { box: null, edges: [], too_close: false, too_far: false };
  if (found.edges.length >= 3) return { box: null, edges: [], too_close: true, too_far: false };
  return { box: found.box, edges: found.edges, too_close: false, too_far: !found.edges.length && found.fraction < FAR_DOC_AREA };
}

function median(gray, x0, y0, x1, y1) {
  const hist = new Uint32Array(256);
  const width = gray.cols, g = gray.data;
  let n = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { hist[g[y * width + x]] += 1; n += 1; }
  const at = (k) => { let c = 0; for (let v = 0; v < 256; v += 1) { c += hist[v]; if (c > k) return v; } return 255; };
  return n % 2 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

function bestRectangle(cv, gray, rawEdges) {
  const h = gray.rows, w = gray.cols;
  const edges = new cv.Mat();
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.morphologyEx(rawEdges, edges, cv.MORPH_CLOSE, kernel);
  kernel.delete();
  cv.rectangle(edges, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), new cv.Scalar(255), 1);
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  let best = null;
  const g = gray.data;
  for (let i = 0; i < contours.size(); i += 1) {
    const c = contours.get(i);
    const hull = new cv.Mat();
    cv.convexHull(c, hull, false, true);
    c.delete();
    try {
      const area = cv.contourArea(hull);
      if (area < MIN_DOC_AREA * w * h || area > 0.97 * w * h) continue;
      const rect = cv.minAreaRect(hull);
      const rw = rect.size.width, rh = rect.size.height;
      if (rw * rh === 0) continue;
      const br = cv.boundingRect(hull);
      const { x, y, width: bw, height: bh } = br;
      const m = BORDER_PX;
      const touching = [["left", x <= m], ["right", x + bw >= w - m], ["top", y <= m], ["bottom", y + bh >= h - m]]
        .filter(([, hit]) => hit).map(([side]) => side);
      if (touching.length === 4) continue;
      const aspect = Math.max(rw, rh) / Math.min(rw, rh);
      if (area / (rw * rh) < RECT_FILL || (!touching.length && !(aspect >= 1.2 && aspect <= 2.3))) continue;
      const ix0 = x + Math.floor(bw / 10), ix1 = x + bw - Math.floor(bw / 10);
      const iy0 = y + Math.floor(bh / 10), iy1 = y + bh - Math.floor(bh / 10);
      let ink = 0;
      if (ix1 > ix0 && iy1 > iy0) {
        const med = median(gray, ix0, iy0, ix1, iy1);
        let dark = 0, n = 0;
        for (let yy = iy0; yy < iy1; yy += 1) for (let xx = ix0; xx < ix1; xx += 1) { if (g[yy * w + xx] < med - 50) dark += 1; n += 1; }
        ink = dark / n;
      }
      if (!(ink >= 0.01 && ink <= 0.5)) continue; // a card carries print; a window or blank sheet does not
      if (!best || area > best.area) best = { area, box: { x0: x, y0: y, x1: x + bw, y1: y + bh }, edges: touching };
    } finally {
      hull.delete();
    }
  }
  contours.delete(); hierarchy.delete(); edges.delete();
  return best ? { box: best.box, edges: best.edges, fraction: best.area / (w * h) } : null;
}
