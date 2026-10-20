# Original REM Lab DAW embed

This is the actual frontend from REM Lab's `cover/daw/web`, embedded in the
DISEASE page with an iframe. Its HTML, CSS, Canvas layout and DAW controls are
preserved. `provenance.json` records source and deployed file hashes.

The public hosting adapter changes only project resource URLs, personal note
persistence (browser local storage instead of writing to the production project),
and playback coordination with the parent film player. Annotation helper text
reflects that storage change. Audio rendering still belongs to the production
pipeline; this is the original audition and review workbench.

The full project contains 11 tracks, 41 versions, 31 comp windows and 45 issue
records. Its 402 referenced resources are hosted in the existing OSS bucket,
including full length encoded audio, peaks, fingerprints, pitch data, spectra
and comp candidates. The original engine loads audio on demand.

To prepare a new immutable data release, run `tools/prepare_daw.py` with the
original project directory and a new output directory outside this repository.
Upload the generated folder preserving its paths, verify every resource, then
set `app/project.js` to the verified prefix. Original source media and private
project annotations must not be modified. There is no public write API.
