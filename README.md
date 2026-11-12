# Mona's Merge Maze

A 3D maze-chase game starring Mona the Octocat. Collect commits, resolve bugs,
and walk through deployment portals to reach the next repository.

## Origins

Created by Christina Warren ([@filmgirl](https://github.com/filmgirl)),
currently maintained by Jeramiah Dooley
([@jdooley-clt](https://github.com/jdooley-clt)). Original repository:
<https://github.com/filmgirl/mona-maze>.

## Play

Play online at **<https://jdooley-clt.github.io/mona-maze/>**.

Find more games in **[GitHub Arcade](https://jdooley-clt.github.io/arcade/)**.
The game's footer links back to the arcade when played standalone; the link is
hidden inside an iframe so embedded play stays in the cabinet.

Open **[`dist/mona-merge-maze.html`](dist/mona-merge-maze.html)** directly in a
modern browser. The game, original chiptune soundtrack, and Mona Sans font are
embedded in this single file. No network connection is required.

Or run the local server with Node.js 22 or newer:

```sh
npm start
```

Then visit <http://127.0.0.1:4177>.
For a separate preview, use `PORT=4178 npm start`. The server stays loopback-only
and rejects ports outside the integer range 1-65535.

## Controls

| Action | Control |
| --- | --- |
| Arcade movement | WASD or arrow keys; turns queue at junctions |
| First-person movement | Hold W/S or up/down |
| First-person turn | A/D or left/right turns 90 degrees |
| Switch camera | V |
| Pause/resume | P or Escape |
| Start | Enter or the Play button |
| New run | New run button; fresh generated board at level 1 |
| Restart level | Circular arrow button; replay the same board |
| Theme, music, effects | Separate buttons in the header |

Touch controls and the minimap sit outside the game viewport.

## Rules

- Green gems are commits worth 10 points.
- Pull-request power-ups grant eight seconds of Super Merge.
- Each board also has three optional hardware pickups, on their own tiles:
  a computer chip (+250 points), an overclock battery (1.3x movement speed for
  six seconds), and a firewall shield (absorbs one bug hit, expires after eight
  seconds). Their labels and minimap symbols are `C`, `+`, and `F`.
- Overclock, firewall, and Super Merge can be active together. Only Super Merge
  allows captures; a capture does not spend the shield. Absorbing a hit spends
  the shield and protects Mona from overlapping bugs for one second to escape.
- Timers count playing time only, freeze on pause, and survive theme/view
  changes. Death (including game over), restart, and progression clear effects.
  Collected items stay spent after a death; restarting restores them.
- Only **blue bugs marked `+ CATCH`** can be captured. Other bugs are dangerous.
- Captured bugs are visibly held in the central pen for five seconds. After
  release, a one-second grace period prevents an immediate collision.
- Collect every commit to unlock the north deployment portal. Follow the green
  trail and walk through the portal to advance, preserving score and lives.
- Two repository **themes** alternate automatically, with the current repository
  name and a prominent level counter above the board instead of a selector.
  The opening run offers two introductory layouts. Starting at level 3,
  deterministic procedural mazes use the run seed and level number. Open
  plazas, the connected pen-release ring, and the north portal remain.
- Every open tile is checked for reachability with the portal locked. Optional
  items never count toward the commit total or gate deployment.
- **New run** resets to level 1 with zero score and three lives, chooses a new
  seed, and starts immediately on a fresh procedural board, bypassing the fixed
  introductions. Subsequent levels remain procedural. Game over offers the
  same New run action.
- **Restart level** replays the current level's exact board and item placement
  with zero score and three lives. Both actions clear effects, while preserving
  the best score, camera, theme, and audio preferences.
- A page reload returns to the introductory run; later boards may differ
  without making enemies faster.
- For reproducible engine scenarios, use `new Game(index, onEvent, { seed })`.
  `reset(index, level)` rebuilds that exact seeded level. Disconnected generated
  components are joined through interior walls (never the pen or boundary),
  then validated; invalid maps fail explicitly rather than reuse an old board.
- `newRun(seed)` prepares a procedural run at level 1; call `start()` to play.
  For direct replay from construction, pass `{ seed, introLayouts: false }`.
- Best scores and the light/dark preference are saved locally when browser
  storage is available.
- The lilac/aubergine colorway includes light and dark modes, muted lilac maze
  walls, and apricot chip pickups. Green commits and blue catchable bugs retain
  their gameplay colors.

## Develop

```sh
npm ci
npm test
npm run build
npm start
```

The server reads the built file on every request. Rebuild and refresh after
editing source. Commit the updated `dist/mona-merge-maze.html` when shipping a
change so the standalone download stays current.

The build also stamps the page's Content Security Policy hashes (see
[Security](#security)). After editing `style.css`, `main.js`, or an inline
block in `index.html`, run `npm run build` before `npm test`; `csp.test.js`
fails while either committed page carries stale hashes.

## Deploy

Push to `main` to deploy automatically to GitHub Pages, or run **Deploy game to
GitHub Pages** manually from the Actions tab on `main`. **Cabinet compatibility**
runs the Node tests, builds the candidate, and exercises it inside the real
Commit Cabinet before deployment is allowed. The deployment job depends on that
check and publishes the exact tested HTML as `index.html`, without rebuilding.
Pull requests (including forks) run the same gate with read-only repository
permissions and never deploy. Publishing is restricted to `jdooley-clt/mona-maze`;
pushes and manual runs in forks cannot upload a Pages artifact or deploy.
Pages and OIDC write permissions are limited to
the main-only deployment job. Source files and test fixtures are not published.
Every action in the workflow is pinned to a full commit SHA with its version in
a trailing comment, and every checkout uses `persist-credentials: false`.
`.github/dependabot.yml` opens weekly pull requests for newer action pins and
for npm devDependencies, grouping minor and patch updates of the latter.

**Published cabinet smoke** then checks the actual game and
<https://jdooley-clt.github.io/arcade/#game/mona-maze>. It checks the served HTML's
SHA-256 against the tested artifact, a nonblank WebGL board, start, movement,
camera, and pause inside the iframe, not just an iframe load event. There are
at most three smoke attempts, separated by 10 and 20 seconds, to allow Pages
propagation; continued failure fails the workflow. This detects a broken
publication but does not roll it back.

GitHub Pages must use **GitHub Actions** as its publishing source; branch-based
Pages would bypass this deployment gate. Mona's repository already uses Actions.
To block merging incompatible PRs as well as deploying them, an administrator
must separately make **Cabinet compatibility** a required status check on
`main` using a ruleset or branch protection, after the check has run. Adding
this workflow does not configure that repository setting.

## Cabinet compatibility

Run the exact candidate gate locally with Node.js 22 or newer:

```sh
npm ci
npx playwright install chromium
npm run cabinet:setup
npm test
npm run build
npm run test:cabinet
```

CI uses `npx playwright install --with-deps chromium` on Ubuntu. The Playwright
suite retries a failed test only in CI (`retries: process.env.CI ? 2 : 0`), so
local runs surface flakes immediately; it uses one Chromium worker with
software WebGL, emulates `prefers-reduced-motion: reduce` (a browser-context
option, set through `contextOptions`) so transitions are off and the colour
audits never sample a fade, and retains traces/screenshots on failure in
ignored `test-results/`. Inspect a failure with
`npx playwright show-trace test-results/<test>/trace.zip`.
If the main run flakes: `gh run rerun <run-id> --failed`; deploy only happens
after the gate is green.

The harness checks out the real static <https://github.com/jdooley-clt/arcade> at
`cdbd39c365f5daf50f47d06d10644d61d1572aaf` into ignored `.playwright-cabinet/`.
It does not install or build the cabinet. The loopback-only server serves the
unaltered cabinet at `/arcade/` and the freshly built
`dist/mona-merge-maze.html` at `/mona-maze/`, on the **same origin**, as in
production. The tests assert the iframe URL and compare the served candidate
bytes with the built file. They never use the deployed game as the PR gate.

Only the HTTP response for the fixture's `games.json` is changed: Mona's URL
becomes `../mona-maze/`, and an extra **Mona lifecycle fixture** entry points
to the same build to exercise switching without depending on another live
game. The tracked production catalog and cabinet files remain untouched.
Other catalog entries remain intact but are not launched by this suite.

To inspect the harness manually after setup and building:

```sh
npm run cabinet:serve
# http://127.0.0.1:4261/arcade/
```

Set `CABINET_PORT=4263` on either the server or test command if needed.
Playwright starts and stops its own server and refuses to reuse a running
server. The server snapshots the candidate at startup; rebuild and restart
after source changes.

Coverage includes mouse/keyboard launch and iframe focus, Space staying in
the game, nonblank rendered pixels, WASD/arrows (including backward movement),
V camera, P/Escape pause/resume, theme/music/SFX toggles, resizing, accessible
focus exit, reload/return/switch/back navigation with detached old frames,
and touch input at 320px/390px. It checks document overflow and scrolls to
external game/cabinet controls to ensure they are not clipped or covered.
Focus mode is entered before starting because Mona intentionally pauses on
blur. Tests use DOM state, score changes, and rendered pixels: no game-state
backdoor, cropped document, or runtime messaging bridge.

Every launch also asserts the game's strict Content Security Policy meta tag,
and a `securitypolicyviolation` listener installed in every frame turns any
violation during launch, play, pause, preference changes, and return into a
failure. One test proves the policy blocks an injected inline script and
`style` attribute while leaving CSSOM updates working.

`tests/cabinet/accessibility.spec.js` runs [axe-core](https://github.com/dequelabs/axe-core)
through `@axe-core/playwright` on the start screen, help dialog, mid-game,
paused (light and dark theme), first-person, level-complete, and game-over
states, both standalone and inside the cabinet. Any **serious** or
**critical** violation fails the gate; moderate and minor findings and
needs-review items are reported in the results but do not block. The
level-complete and game-over panels are rendered through the same DOM state the
HUD applies, since reaching them depends on the enemy chase. A sanity test
injects an unlabeled link into the game frame and requires the gate to catch
it.

Run a read-only baseline against production separately:

```sh
npm run test:live
# Also require production to match your current built file:
EXPECTED_GAME_SHA256="$(shasum -a 256 dist/mona-merge-maze.html | cut -d ' ' -f 1)" npm run test:live
```

Without `EXPECTED_GAME_SHA256`, this is explicitly a functional live baseline,
not proof that a particular revision deployed. CI always supplies the digest.
Live requests are not mocked. Both suites fail on uncaught exceptions, console
errors, failed local/published requests, and HTTP errors. Only aborted child-frame
navigation requests whose frame is actually detached when health is asserted
are exempted; attached-frame and top-level cancellations still fail.

To update the cabinet pin, review the upstream change, update both
`tests/cabinet/pin.json` and the full checkout SHA in `.github/workflows/pages.yml`,
remove only the disposable `.playwright-cabinet/` directory, and rerun setup and
the entire gate. The server rejects a dirty checkout or a mismatched revision.
Do not substitute a live arcade checkout or an unpinned branch.

Limitations: this is Chromium desktop/touch emulation, not physical-device,
Safari/Firefox, cross-origin sandbox, native-fullscreen, or audible-output
certification. The existing music unit tests cover the audio lifecycle; the
browser suite checks audio controls. WebGL color diversity is a startup
sanity check, not a pixel-perfect visual regression test.

## Security

Report a vulnerability privately through GitHub's Private Vulnerability
Reporting at <https://github.com/jdooley-clt/mona-maze/security/advisories/new>.
[`SECURITY.md`](SECURITY.md) lists the supported versions and the scope.

### Content Security Policy

`index.html` declares `<meta name="referrer" content="strict-origin-when-cross-origin">`
and a meta Content Security Policy. The workflow publishes the built file as
the site's `index.html`, so the same policy protects the published game:

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'none'` | Everything not listed below is blocked: network connections, media, frames, workers, and plugins. |
| `script-src` | one `'sha256-…'` hash per inline `<script>` | The theme scripts and the bundled game are inline. No `'unsafe-inline'`, `'unsafe-eval'`, or host sources. |
| `style-src` | the `'sha256-…'` hash of the inline `<style>` block | The game changes styles only through the CSSOM (`element.style.width`), which a hash-based policy allows. `style` attributes in markup or `setAttribute('style')` would be blocked. |
| `img-src` | `data:` | The favicon is the GitHub mark embedded as a data URL; the header mark is inline SVG. |
| `font-src` | `data:` | Mona Sans is embedded as a data URL inside the style block. |
| `base-uri`, `form-action` | `'none'` | The page has no `<base>` element and no forms. |

WebGL, Web Audio, `localStorage`, and the help `<dialog>` need no directive.
`frame-ancestors`, `sandbox`, and `report-uri` cannot be set from a meta tag,
so the policy does not restrict where the game may be embedded; the cabinet
applies its own iframe `sandbox` attribute. The embedded license text
(`<script type="text/plain">`) is never executed and is not hashed.

`csp.mjs` computes each hash as SHA-256 over the element's text with CRLF
normalized to LF, as browsers do, so LF and CRLF checkouts hash identically.
`build.mjs` stamps the hashes into `dist/mona-merge-maze.html` and refreshes
`index.html`'s own hashes on every `npm run build`. `csp.test.js`, part of
`npm test`, fails if either committed page disagrees with its own inline
blocks, if an unsafe source appears, or if the policy no longer precedes every
script, style, and link. The Playwright gate asserts the policy and fails on
any runtime violation (see [Cabinet compatibility](#cabinet-compatibility)).

## Source layout

| File | Purpose |
| --- | --- |
| `engine.js` | Maze generation, movement, enemy AI, captures, and progression |
| `main.js` | Three.js rendering, input, HUD, theme, and effects |
| `timing.js` | Frame-rate-independent simulation substeps |
| `music.js` | Original synthesized Web Audio soundtrack |
| `index.html`, `style.css` | Responsive interface and theme tokens |
| `build.mjs` | Single-file bundling and asset/license embedding |
| `csp.mjs` | Content Security Policy hashing shared by the build and its tests |
| `server.mjs` | Loopback-only local preview server |
| `.github/workflows/pages.yml` | Test, build, and deploy the game to GitHub Pages |
| `.github/dependabot.yml` | Weekly action-pin and npm devDependency updates |
| `SECURITY.md` | Supported versions, reporting channel, and scope |
| `*.test.js` | Node.js tests for gameplay, timing, audio lifecycle, and the policy |
| `tests/cabinet/`, `playwright*.config.js` | Pinned real-cabinet candidate gate, accessibility gate, and published smoke |

## Credits

An unofficial arcade project, not a GitHub product.

- Mona Sans: [github/mona-sans](https://github.com/github/mona-sans),
  distributed under the [SIL Open Font License](assets/Mona-Sans-OFL.txt).
- GitHub mark: [Primer Octicons](https://github.com/primer/octicons),
  distributed under its [MIT license](assets/Octicons-LICENSE.txt).
- Three.js: MIT-licensed 3D library.
- The procedural game art and synthesized soundtrack were created for this
  project. No external audio tracks are downloaded.

The font and icon license texts are also embedded in the standalone HTML.
