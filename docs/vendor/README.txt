dicomParser.js is a locally bundled ESM wrapper around the minified distribution
from npm dicom-parser@1.8.21, retrieved on 2026-10-23:
https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js

Official project: https://github.com/cornerstonejs/dicomParser
License: MIT; full license in LICENSE.dicom-parser.txt.
The upstream distributed file itself carries a 1.8.12 banner; this is preserved.
Changes: an ESM export wrapper and disabled Node zlib import; removed source-map
reference. Deflated datasets are rejected before parsing by ../dicom.js.
The application makes no CDN requests at runtime.
