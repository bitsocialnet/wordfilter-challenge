# AGENTS Notes

Reference source files for this repository:

`@pkcprotocol/pkc-js/src/challenges.ts`
`@pkcprotocol/pkc-js/package.json`
`@pkcprotocol/pkc-js/docs/protocol/challenge-authoring.md`
`@pkcprotocol/pkc-js/docs/protocol/challenge-settings.md`

Workflow:

- Before every commit, run `npm run typecheck` and ensure it passes with no errors.
- Before every commit, run `npm test` (vitest) and ensure it passes.
- Never push to a PR branch without first running `npm run typecheck` and `npm test` locally and seeing
  them pass. CI runs the same checks, but a red PR is a round trip that a local run avoids.

Conventions specific to this challenge:

- `README.md` is the spec. Behaviour changes belong there first.
- `src/apply-wordfilters.ts` imports nothing. It runs in a browser, in a publishing client, and its
  behaviour must stay identical to the snippet in the README, which is what most frontends will actually
  copy. They discover the contract through `community.challenges[i].publicOptions` and never install this
  package.
- `WORDFILTER_V1_RULES_OPTION` and `WORDFILTER_V1_FIELD_NAMES_OPTION` are the wire contract, not internal
  names. Clients recognise `wordfilter/v1` by the presence of the rules key in a community's
  `publicOptions`, and most of them never install this package, so renaming either string silently stops
  every such client from filtering. A rename is a new contract version, never an edit to v1. The literals
  are pinned in `test/wordfilter-challenge.test.ts` so this fails a test rather than a live board.
- The `wordfilter/v1` namespace covers exactly the options a publishing client must read. Anything a
  client never reads, `error` today, keeps its plain name and stays free to differ between
  implementations. This package is one implementation of the contract, not its owner.
- `validateChallengeSettings` is sync and does no network. It runs on every community start, so an async
  validator would turn a third party's outage into a startup problem.
- `ChallengeFileFactory` never throws. It runs on load as well as on edit, so a throw fails community
  startup rather than the offending edit.
- Absent publication fields pass. `publication-match` treats a missing property as a failure, which would
  reject every vote. Do not copy that.
- Test fixtures are typed against pkc-js's own challenge-time publication types
  (`GetChallengeArgsInput["challengeRequestMessage"][K]`) through the `build*` helpers in
  `test/wordfilter-challenge.test.ts`. Do not cast a publication through `as unknown as`: that is how a
  `content` on a commentModeration, a field no client can send, once passed as a test. Each publication
  type gets its own test, with the shape it actually has on the wire.

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
