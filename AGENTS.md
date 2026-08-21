# AGENTS Notes

Reference source files for this repository:

`@pkcprotocol/pkc-js/src/challenges.ts`
`@pkcprotocol/pkc-js/package.json`
`@pkcprotocol/pkc-js/docs/protocol/challenge-authoring.md`
`@pkcprotocol/pkc-js/docs/protocol/challenge-settings.md`

Workflow:

- Before every commit, run `npm run typecheck` and ensure it passes with no errors.
- Before every commit, run `npm test` and ensure it passes.

Conventions specific to this challenge:

- `README.md` is the spec. Behaviour changes belong there first.
- `src/apply-wordfilters.ts` imports nothing. It runs in a browser, in a publishing client, and its
  behaviour must stay identical to the snippet in the README, which is what most frontends will actually
  copy. They discover the challenge through `community.challenges[i].publicOptions` and never install this
  package.
- `validateChallengeSettings` is sync and does no network. It runs on every community start, so an async
  validator would turn a third party's outage into a startup problem.
- `ChallengeFileFactory` never throws. It runs on load as well as on edit, so a throw fails community
  startup rather than the offending edit.
- Absent publication fields pass. `publication-match` treats a missing property as a failure, which would
  reject every vote. Do not copy that.

Releasing:

- Releases are automatic. A push to `master` runs CI, and on success `release.yml` runs release-it, which
  bumps the version from the conventional-commit types, tags it, cuts a GitHub release, and publishes to
  npm with provenance.
- Publishing authenticates with npm trusted publishing (OIDC), not a token. There is no `NPM_TOKEN`
  secret, which is why `release.yml` needs `id-token: write` and why the npm CLI is pinned to `npm@11`.
- Bootstrapping that is a chicken-and-egg: a trusted publisher is configured under npm's *package*
  settings, so the package has to exist first. The first version was published by hand and has no
  provenance attestation. Every version after it is signed by CI.
- Never publish by hand once the trusted publisher is configured. A manual publish produces a version
  with no attestation, and the version numbering comes from release-it.
