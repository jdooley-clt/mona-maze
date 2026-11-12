# Security policy

## Supported versions

Mona's Merge Maze is a static, client-side browser game published from this
repository to GitHub Pages. Only the `main` branch and the build it publishes
at <https://jdooley-clt.github.io/mona-maze/> receive security fixes.

| Version                                      | Supported |
| -------------------------------------------- | --------- |
| `main` and the live GitHub Pages site        | Yes       |
| Older commits, forks, and downloaded copies  | No        |

## Reporting a vulnerability

Please report security problems privately through GitHub's private
vulnerability reporting for this repository:

<https://github.com/jdooley-clt/mona-maze/security/advisories/new>

Do not open a public issue or pull request for a security problem. Include the
page or file affected, the browser you used, and steps to reproduce. You will
hear back in the advisory thread, and fixes ship through the normal
`main` deploy once the compatibility gate passes.

## Scope

The game is a single self-contained HTML file. It has no server component, no
accounts, and no network requests of its own after the page loads. The only
data it keeps is in the browser's `localStorage` on your device: the best score
(`mona-merge-maze-best`) and the light/dark theme preference
(`mona-merge-maze-theme`). Clearing site data removes both.

In scope: the game code in this repository, its build (`build.mjs`), the GitHub
Actions deploy workflow, and the published site. Vulnerabilities in third-party
dependencies such as Three.js should go to those projects; dependency updates
here are tracked by Dependabot. Issues in GitHub Pages or in web browsers
belong with their respective maintainers.
