# Changelog

## [0.3.0](https://github.com/bitsocialnet/wordfilter-challenge/compare/v0.2.0...v0.3.0) (2026-08-22)

### ⚠ BREAKING CHANGES

* wordfilter/v1/fieldNames paths must start with the publication
type. Bare paths such as "content" are rejected. The default field list changed
to comment.content, comment.title, comment.author.displayName,
commentEdit.content, commentEdit.reason, commentEdit.author.displayName and
vote.author.displayName. Clients hardcoding the old defaults must update.

### Features

* prefix wordfilter/v1 field paths with the publication type ([3daefc4](https://github.com/bitsocialnet/wordfilter-challenge/commit/3daefc48f13096729234f83421d8b0e020cfc57b)), closes [#3](https://github.com/bitsocialnet/wordfilter-challenge/issues/3)

## [0.2.0](https://github.com/bitsocialnet/wordfilter-challenge/compare/v0.1.2...v0.2.0) (2026-08-21)

### ⚠ BREAKING CHANGES

* the `wordfilters` and `fieldNames` options are renamed to
`wordfilter/v1/rules` and `wordfilter/v1/fieldNames`, in both `options` and
`publicOptions`. There is no fallback to the old names: a wordfilter that
quietly stops filtering is the failure this package exists to prevent, so an
unmigrated community fails loudly at startup with
ERR_CHALLENGE_OPTION_NOT_DECLARED_IN_OPTION_INPUTS instead. Clients need the
same rename in whatever they copied from the README.

### Features

* key clients off the wordfilter/v1 contract instead of this package ([916f5bf](https://github.com/bitsocialnet/wordfilter-challenge/commit/916f5bf63f5b4ef8f730be0e7a3ac42e93b20bec)), closes [#1](https://github.com/bitsocialnet/wordfilter-challenge/issues/1)

## [0.1.2](https://github.com/bitsocialnet/wordfilter-challenge/compare/v0.1.1...v0.1.2) (2026-08-21)

### Bug Fixes

* use a recognisable wordfilter example in the docs and option placeholder ([3b44c45](https://github.com/bitsocialnet/wordfilter-challenge/commit/3b44c453c929a574fc074a863eabbe9f201ca48e))

## 0.1.1 (2026-08-21)

### Features

* implement the wordfilter challenge and its client-side apply loop ([a936c47](https://github.com/bitsocialnet/wordfilter-challenge/commit/a936c4736df9d40ce0632f97c7c551d5fd199a03))
