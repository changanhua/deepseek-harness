# Third-party notices

`puppeteer.js` is generated from `puppeteer-core` 24.31.0. Its local build patch makes `ExtensionTransport.close()` return Chrome's `debugger.detach()` promise so the driver can await a normal detach. The complete upstream Apache-2.0 license is in [puppeteer.LICENSE](puppeteer.LICENSE).

Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0. You may obtain a copy of the
license at <https://www.apache.org/licenses/LICENSE-2.0>. The generated bundle
also carries esbuild's linked legal-comment file beside `puppeteer.js`.
