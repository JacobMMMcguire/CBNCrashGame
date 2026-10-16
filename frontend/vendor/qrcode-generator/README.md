# qrcode-generator (vendored)

- Package: [qrcode-generator](https://www.npmjs.com/package/qrcode-generator) 1.4.4 by Kazuhiko Arase
- Source: https://github.com/kazuhikoarase/qrcode-generator
- License: MIT (see `LICENSE`; the npm package ships the notice in the file header, not as a separate file)
- File: `qrcode.js`, copied unchanged from the npm tarball (`npm pack qrcode-generator@1.4.4`)
- SHA-256 of `qrcode.js`: `18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780`

Vendored so the host screen can draw the join QR code in the browser with no
build step and no CDN (local Wi-Fi play may have no internet). It is loaded as
a classic script that defines the global `qrcode`; `frontend/js/room/qr.js`
uses only `addData`, `make`, `getModuleCount` and `isDark` and draws the SVG itself.
To update: replace `qrcode.js` with the new release's file and update the version and hash above.
