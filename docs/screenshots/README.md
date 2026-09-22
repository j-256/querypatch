# Project cover

The cover shows the actual unpacked extension in an isolated Chromium profile. A synthetic wildcard rule sets `debug=1` for `example.com`, and the capture verifies the URL tester's result before writing the image. The example URL is never visited.

```sh
npm ci
npx playwright install chromium
npm run capture:cover
```

The popup viewport is 440 x 620 at 4x pixel density. The temporary browser profile is deleted afterward. Playwright is a development dependency; the extension still ships without a build step or runtime dependencies.

CI regenerates this image from source after verification, uploads it for review, and commits a changed `docs/screenshots/cover.png` on `main`. Pull requests only produce the review artifact. The weekly schedule and manual CI dispatch can refresh the image without an application change. A superseded build does not overwrite a newer source commit.

The project cover is rendered at 4x pixel density while preserving its logical viewport, so enlarged previews retain more detail. Higher density does not increase the displayed text size; use zoom to inspect small labels.
