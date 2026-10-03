# vendor/jsdom.bundle.js

Yeh `jsdom` (v30) ka single-file bundle hai (esbuild se bana, ~6 MB).
Is ki wajah se `test/node_modules` (1800+ files) ki zaroorat nahi — saare tests
seedha `require('./vendor/jsdom.bundle.js')` use karte hain. Bas `node` chahiye:

    cd test && npm test

Note: synchronous XMLHttpRequest (sync XHR) is bundle mein support nahi hota
(async XHR theek chalta hai). Tests mein sync XHR istemal nahi hota.

Dobara banana ho (jsdom upgrade par): `npm i jsdom esbuild`, phir esbuild se
`jsdom` ko bundle karein (css-tree ko CJS se resolve karein, default-stylesheet.css inline karein).
