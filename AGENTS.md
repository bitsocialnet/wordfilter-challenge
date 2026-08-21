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
