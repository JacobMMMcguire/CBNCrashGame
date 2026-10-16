// Draw a QR code for a URL as an SVG, in the browser.
// Encoding comes from the vendored qrcode-generator (frontend/vendor/qrcode-generator,
// MIT), loaded by host.html as a classic script that defines window.qrcode.
// We only ask it which modules are dark and build the SVG ourselves, so no
// HTML string is ever inserted.

const SVG_NS = "http://www.w3.org/2000/svg";
const QUIET_ZONE = 2; // modules of margin; the .qr container adds white padding too

/** Returns an <svg> for `text`, or null if the encoder is missing. */
export function qrSvg(text, { label } = {}) {
  const encoder = window.qrcode;
  if (typeof encoder !== "function") return null;
  const qr = encoder(0, "M"); // type 0 = smallest version that fits; M = ~15% error correction
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QUIET_ZONE * 2;
  // One path of 1x1 squares: crisp at any size and cheap to draw.
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`;
    }
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  if (label) svg.setAttribute("aria-label", label);
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", size);
  bg.setAttribute("height", size);
  bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000"); // always dark on white, whatever the theme: scanners need contrast
  svg.append(bg, path);
  return svg;
}
