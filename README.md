# @bitsocial/wordfilter-challenge

A [pkc-js](https://github.com/pkcprotocol/pkc-js) challenge that makes community wordfilters a real rule instead of a cosmetic display filter. It implements the [`wordfilter/v1` contract](#the-wordfilterv1-contract), which is what publishing clients actually code against.

> **Status: implemented.** This README is the spec, and `src/` follows it. Tracked in [pkc-js#281](https://github.com/pkcprotocol/pkc-js/issues/281).

## What it does

A community configures a list of replacements, for example `cloud` becomes `butt`. Publishing clients apply those replacements before signing, so the signed comment, its CID, and what every client renders all contain `butt`. The original text does not exist anywhere.

The community node does not do the replacing. It only checks: if a publication still contains a filtered word, it is rejected.

## Why clients have to do the replacing

This is the part that surprises people coming from imageboard software, so it is worth being explicit.

On a traditional imageboard the server owns the post text and rewrites it freely at submission time. [jschan](https://gitgud.io/fatchan/jschan/-/blob/master/lib/post/filteractions.js) mutates `req.body` before the insert; vichan calls `wordfilters($post['body'])` in `post.php` before `body_nomarkup` is even derived. Neither keeps the pre-filter original.

pkc-js cannot work that way. The author signs the publication, and the signature covers `content`. If the community rewrote `content` afterwards, the signature would no longer verify and every client would reject the comment as forged.

So the replacement has to happen on the side holding the signing key, which is the publishing client. The community's only available action is to accept or reject. In other words this package does not implement a wordfilter, it implements **a proof that a wordfilter was applied**.

A client that does not implement the replacement cannot publish unfiltered text. It simply gets rejected, which is the intended failure mode.

## The `wordfilter/v1` contract

A publishing client has to recognise "this community wants word replacements applied before I sign" from the published community record alone. The record deliberately does not say which challenge produced it: `path`, `name` and `options` are all stripped when `community.settings.challenges[i]` becomes the public `community.challenges[i]`. Only `publicOptions`, the subset the owner opted into publishing, survives.

So the signal a client keys off is an option key that names a **contract** rather than a package:

| Public option | Required | Meaning |
|---|---|---|
| `wordfilter/v1/rules` | yes | JSON array of `{ src, dst }`. Its presence is what identifies the contract |
| `wordfilter/v1/fieldNames` | no | JSON array of dot-notation paths, each starting with the publication type. Defaults to the list under [Default fields](#default-fields) |

This package is one implementation. Anything that publishes `wordfilter/v1/rules` with the semantics below claims the contract, and a client written against it keeps working with implementations that did not exist when the client was written. Keying on a package name instead, whether through a hardcoded `@bitsocial/wordfilter-challenge` or a generic `wordfilters` option, would enshrine one implementation in every UI and lock out every fork, competitor and in-house variant that behaves identically. See [issue #1](https://github.com/bitsocialnet/wordfilter-challenge/issues/1).

The namespace covers exactly what a publishing client must read, and nothing else. `error` is not in it, because no client reads `error`: the community returns it in the rejection. An implementation is free to name or shape that option however it likes.

`wordfilter/v2/rules` would be a different key. A client that understands both reads both, and a community can publish both during a transition without either side guessing.

### Default fields

When a community does not publish `wordfilter/v1/fieldNames`, both sides check this list. Every path starts with the publication type, followed by the field's path inside that publication exactly as it is on the wire.

| Publication type | Default paths |
|---|---|
| `comment` | `comment.content`, `comment.title`, `comment.author.displayName` |
| `commentEdit` | `commentEdit.content`, `commentEdit.reason`, `commentEdit.author.displayName` |
| `vote` | `vote.author.displayName` |

The defaults cover what an ordinary author publishes. Moderator and owner text is not in them: a moderation's reason and a community edit's title and description can be filtered by naming their paths in `wordfilter/v1/fieldNames`, as `commentModeration.commentModeration.reason`, `communityEdit.communityEdit.title` and `communityEdit.communityEdit.description`. The doubled segment is the wire shape, not a typo: the publication type is `commentModeration`, and pkc-js puts the moderation's fields under a `commentModeration` property of it; likewise for `communityEdit`.

Naming the publication type in every path is deliberate. `content` on a comment and `content` on a comment edit are the same field today, but nothing guarantees they stay that way, and a bare `content` could not tell them apart. A path whose first segment is not one of the five publication types is rejected by `validateChallengeSettings`, and by `getChallenge` for a config that predates that check, because it would match nothing on any request and the wordfilter would have quietly stopped filtering.


## For UI client developers

This is the section that matters if you are building a frontend that publishes to communities using this contract.

### 1. Read the rules off the community

Collect the rules from every challenge on the community that publishes `wordfilter/v1/rules`, in challenge order. A community may have more than one.

```js
const isRule = (rule) => typeof rule?.src === "string" && typeof rule?.dst === "string";
const isFieldName = (name) => typeof name === "string";

function getWordfilterConfigs(community) {
    return (community.challenges ?? [])
        .filter((challenge) => challenge.publicOptions?.["wordfilter/v1/rules"])
        .map((challenge) => {
            try {
                const rules = JSON.parse(challenge.publicOptions["wordfilter/v1/rules"]);
                const fieldNames = challenge.publicOptions["wordfilter/v1/fieldNames"]
                    ? JSON.parse(challenge.publicOptions["wordfilter/v1/fieldNames"])
                    : [
                          "comment.content",
                          "comment.title",
                          "comment.author.displayName",
                          "commentEdit.content",
                          "commentEdit.reason",
                          "commentEdit.author.displayName",
                          "vote.author.displayName"
                      ];
                // JSON.parse is happy to hand back null, an object or an array of numbers, and
                // applyWordfilters would throw on any of them. Treat the wrong shape like bad JSON.
                if (!Array.isArray(rules) || !rules.every(isRule)) return undefined;
                if (!Array.isArray(fieldNames) || !fieldNames.every(isFieldName)) return undefined;
                return { rules, fieldNames };
            } catch {
                // A rule set you cannot parse is skipped, never fatal. Worst case the community
                // rejects the publication with a readable error.
                return undefined;
            }
        })
        .filter(Boolean);
}
```

Note what this function does not do: it never looks at which challenge implementation produced the options, because the record does not say and it does not need to.

Skip anything you cannot parse, and anything that parses to the wrong shape. Never throw, and never refuse to load the community: a malformed rule set must cost the filter, not the whole board. This package's own `validateChallengeSettings` will not let a community publish a malformed rule set, but the contract is open to other implementations and your client cannot know which one it is talking to.

### 2. Apply the rules, looping until the text stops changing

**Do not apply the rules once.** A replacement can create a new match by joining with the text around it. With rules `[{src: "ab", dst: "c"}, {src: "x", dst: "b"}]`, the input `"ax"` becomes `"ab"` in a single pass, which still contains a filtered word, and the community will reject it.

Loop until the output is stable:

```js
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The `() => dst` replacer, not a plain `dst`: `String.replace` reads `$&` and friends out of a string
// replacement, and rules are literal on both sides.
const applyOnce = (text, rules) =>
    rules.reduce((acc, { src, dst }) => acc.replace(new RegExp(escapeRegExp(src), "gi"), () => dst), text);

export function applyWordfilters(text, rules, maxPasses = 8) {
    let out = text;
    for (let pass = 0; pass < maxPasses; pass++) {
        const next = applyOnce(out, rules);
        if (next === out) return out;
        out = next;
    }
    throw new Error("wordfilter rules did not stabilise");
}
```

Stable output contains no filtered word by definition, which is exactly what the community checks for.

Copying that function is the expected path: your client sees the challenge through `community.challenges` and has no reason to depend on the package that produced it. If you do already bundle npm packages, the same function is exported as `applyWordfilters` from `@bitsocial/wordfilter-challenge`, with nothing from pkc-js behind it.

### 3. Apply it before creating the publication

Filter the text before it reaches `pkc.createComment()`, so the transformation happens before any signature exists. Nothing needs to re-sign, and there is no window where an unfiltered draft is signed.

```js
const configs = getWordfilterConfigs(community);

// One call per field, carrying the rules of every challenge that covers that field. Do not apply the
// challenges one at a time: a later challenge's replacement can reintroduce an earlier challenge's
// src, and the earlier challenge would then reject the publication. The loop inside applyWordfilters
// only sees that interaction when both rule sets are in the same call.
const rulesFor = (fieldName) =>
    configs.filter(({ fieldNames }) => fieldNames.includes(fieldName)).flatMap(({ rules }) => rules);

if (content) content = applyWordfilters(content, rulesFor("comment.content"));
if (title) title = applyWordfilters(title, rulesFor("comment.title"));
if (displayName) displayName = applyWordfilters(displayName, rulesFor("comment.author.displayName"));

const comment = await pkc.createComment({ content, title, author: { displayName }, communityAddress, signer });
await comment.publish();
```

The challenge runs on every publication type, not only new comments. The [default field list](#default-fields) also names the text of a comment edit and the display name on a vote, so the same `rulesFor` call applies before each of these, with the path prefixed by the publication type:

```js
// Comment edit: content and reason are top-level on the edit, displayName is under author.
const edit = await pkc.createCommentEdit({
    commentCid,
    content: applyWordfilters(newContent, rulesFor("commentEdit.content")),
    reason: applyWordfilters(reason, rulesFor("commentEdit.reason")),
    author: { displayName: applyWordfilters(displayName, rulesFor("commentEdit.author.displayName")) },
    communityAddress,
    signer
});

// Vote: the only text on it is the display name.
const vote = await pkc.createVote({
    commentCid,
    vote: 1,
    author: { displayName: applyWordfilters(displayName, rulesFor("vote.author.displayName")) },
    communityAddress,
    signer
});

```

Those paths are the defaults, so they are the minimum. If a community publishes other paths in `wordfilter/v1/fieldNames`, run the same call on whatever your client puts at those paths; the community checks exactly the configured paths and nothing else, so an unfiltered custom field is a rejection just like an unfiltered display name. The paths a community is most likely to add are moderator and owner text, which `rulesFor` returns empty for unless the community names them:

```js
// Comment moderation: the moderator's reason lives under the publication's commentModeration property,
// hence the doubled segment.
const moderation = await pkc.createCommentModeration({
    commentCid,
    commentModeration: {
        removed: true,
        reason: applyWordfilters(reason, rulesFor("commentModeration.commentModeration.reason"))
    },
    communityAddress,
    signer
});

// Community edit: title and description live under the publication's communityEdit property.
const communityEdit = await pkc.createCommunityEdit({
    communityEdit: {
        title: applyWordfilters(title, rulesFor("communityEdit.communityEdit.title")),
        description: applyWordfilters(description, rulesFor("communityEdit.communityEdit.description"))
    },
    communityAddress,
    signer
});
```

The `wordfilter/v1/fieldNames` entries are dot-notation paths, the same convention `publication-match` uses for `propertyName`, resolved against the challenge request's publication map rather than the publication itself. So the first segment names the publication type, and a path is simply absent, and passes, on a request carrying a different type: `commentEdit.content` never sees a new comment, and `comment.content` never sees an edit.

Two challenges on the same community whose rules undo each other, `foo → bar` in one and `bar → foo` in another, cannot be caught by either challenge's `validateChallengeSettings`, which sees only its own settings. The merged call then either throws `did not stabilise` or settles on text that one of the challenges still rejects, and the community returns that challenge's `error`. Both are the right outcome: no text containing either word can satisfy both challenges, so the board is misconfigured and the owner has to fix it. Handle it the same way as any other rejection, in step 5.

### 4. Show the user what happened

Nothing in the protocol requires it, but the author is signing text they did not type. Showing the filtered result before publishing, or a note afterwards, avoids the surprise. This is a UX decision, not a correctness one.

### 5. Handle rejection

Your copy of the community record can be older than the community's current settings. An owner who adds a rule starts enforcing it immediately, while your client keeps publishing against the rules it last saw.

When that happens the publication is rejected with the challenge's `error` message. Refresh the community, re-apply, and let the author retry. **Do not re-sign automatically:** that would silently publish text the author never reviewed, which is the exact failure this design exists to prevent.

## Requirements

- pkc-js `>=0.0.85`, for `publicOptions` ([pkc-js#282](https://github.com/pkcprotocol/pkc-js/issues/282)) and `validateChallengeSettings` ([pkc-js#283](https://github.com/pkcprotocol/pkc-js/issues/283))
- Node.js `>=22`
- ESM-only environment

## Install

### With bitsocial-cli

```bash
bitsocial challenge install @bitsocial/wordfilter-challenge
```

```bash
bitsocial community edit your-community.bso \
  '--settings.challenges[0].name' @bitsocial/wordfilter-challenge \
  '--settings.challenges[0].options.wordfilter/v1/rules' '[{"src":"cloud","dst":"butt"}]' \
  '--settings.challenges[0].publicOptions[0]' wordfilter/v1/rules
```

### With pkc-js over RPC

Install the challenge on the RPC server, then set it on your community by name. Nothing has to be installed on the client side:

```bash
bitsocial challenge install @bitsocial/wordfilter-challenge
```

### With pkc-js (TypeScript)

Running your own node locally, without RPC:

```bash
npm install @bitsocial/wordfilter-challenge
```

```ts
import PKC from "@pkcprotocol/pkc-js";
import { wordfilterChallenge } from "@bitsocial/wordfilter-challenge";

PKC.challenges["@bitsocial/wordfilter-challenge"] = wordfilterChallenge;
```

## Configuration

For community owners, set in `settings.challenges`:

```js
await community.edit({
    settings: {
        challenges: [
            {
                name: "@bitsocial/wordfilter-challenge",
                options: {
                    "wordfilter/v1/rules": JSON.stringify([
                        { src: "cloud", dst: "butt" },
                        { src: "millennials", dst: "snake people" },
                        { src: "spamword", dst: "" }
                    ]),
                    "wordfilter/v1/fieldNames": JSON.stringify([
                        "comment.content",
                        "comment.title",
                        "comment.author.displayName",
                        "commentEdit.content",
                        "commentEdit.reason",
                        "commentEdit.author.displayName",
                        "vote.author.displayName"
                    ]),
                    error: "This board replaces certain words. Please repost with the replacements applied."
                },
                publicOptions: ["wordfilter/v1/rules", "wordfilter/v1/fieldNames", "error"]
            }
        ]
    }
});
```

`publicOptions` is **required**, not decorative. Options are private by default in pkc-js, and a client that cannot read the rules cannot satisfy them. The challenge's `validateChallengeSettings` hook rejects the edit if `wordfilter/v1/rules` is missing from `publicOptions`, so the failure surfaces when you save rather than when every author starts getting rejected.

### Options

| Option | Required | Must be in `publicOptions` | Description |
|---|---|---|---|
| `wordfilter/v1/rules` | yes | yes | JSON array of `{ src, dst }`, applied in array order, cascading |
| `wordfilter/v1/fieldNames` | no | when set | JSON array of dot-notation paths, each starting with the publication type. Defaults to the list under [Default fields](#default-fields) |
| `error` | no | owner's call | Message shown to the author when a publication is rejected |

An option has to be public when a client cannot satisfy the challenge without reading it. That covers `wordfilter/v1/rules` always, and `wordfilter/v1/fieldNames` whenever the owner sets it: a client filtering the default fields cannot satisfy a community checking a different set, and nothing in the published record would explain the rejections. Those two are also exactly the options the contract namespaces, for the same reason. `error` is returned in the rejection itself, so publishing it is transparency rather than a requirement, and it keeps its plain name.

### Validation

`validateChallengeSettings` rejects at edit time:

- `wordfilter/v1/rules` missing from `publicOptions`, or unparseable JSON, or not an array of `{ src, dst }` strings
- an empty `src`
- `src === dst`
- the same `src` in more than one rule
- any `dst` containing any `src`
- more than 64 rules, or a `src` or `dst` longer than 128 characters
- `wordfilter/v1/fieldNames`, when set, unparseable, not an array of non-empty strings, containing a path whose first segment is not a publication type (`comment`, `vote`, `commentEdit`, `commentModeration`, `communityEdit`), or missing from `publicOptions`

The `src === dst`, duplicate `src` and `dst`-contains-`src` checks all compare case-insensitively, because matching is case-insensitive: `{src: "LOL", dst: "lol"}` replaces nothing just as surely as `{src: "lol", dst: "lol"}` does.

The `dst` containing `src` rule is what guarantees the client's loop terminates. Without it a rule like `lol` becomes `lolol` produces output that always contains a filtered word, making every post permanently unpublishable.

## Migrating from 0.1.x and 0.2.0

0.2.0 already uses the `wordfilter/v1` option keys; only the paths inside `wordfilter/v1/fieldNames` change for it, see below. 0.1.x used bare `wordfilters` and `fieldNames` option names, which made the package rather than the contract the thing clients keyed off. Rename both, in `options` and in `publicOptions`:

| 0.1.x | Now |
|---|---|
| `wordfilters` | `wordfilter/v1/rules` |
| `fieldNames` | `wordfilter/v1/fieldNames` |
| `error` | `error`, unchanged |

The paths inside `fieldNames` change too, for 0.2.0 as much as 0.1.x. Both resolved them against the publication, so `content` meant "content on whatever was published". `wordfilter/v1/fieldNames` now resolves them against the challenge request's publication map, so every path starts with the publication type, and a bare `content` is rejected rather than silently matching nothing:

| 0.1.x / 0.2.0 path | Now |
|---|---|
| `content` | `comment.content`, and `commentEdit.content` if edits should be filtered too |
| `title` | `comment.title` |
| `author.displayName` | one entry per publication type: `comment.author.displayName`, `commentEdit.author.displayName`, `vote.author.displayName` |

If 0.1.x or 0.2.0 ran with the default field list, dropping `fieldNames` entirely and taking the new defaults is the closest equivalent. A 0.2.0 community that set `wordfilter/v1/fieldNames` with bare paths fails loudly at the next start, `validateChallengeSettings` naming the offending path, until the paths are prefixed.

There is no fallback to the old names, on purpose. A wordfilter that quietly stops filtering is the exact failure this package exists to prevent, so an unmigrated community fails loudly instead: pkc-js rejects the now-undeclared option at community start with `ERR_CHALLENGE_OPTION_NOT_DECLARED_IN_OPTION_INPUTS`, naming the offending option, and `validateChallengeSettings` rejects the edit if you try to save it.

Clients written against 0.1.x need the same rename in whatever they copied from this README.

## Matching semantics

- **Literal, never regex.** vichan supports arbitrary PCRE, but only because its config is a server-local file the operator wrote. Here the rules ship inside a signed record that every browser client downloads and executes, so patterns are literal strings.
- **Case-insensitive**, following vichan's `str_ireplace`. `cloud`, `Cloud`, and `CLOUD` are all replaced. Casing is not preserved: all three become `butt`.
- **Cascading in array order**, and rules from multiple wordfilter challenges compose in challenge order.
- **Absent fields pass cleanly.** A vote has no `content`, and that is not a failure. (`publication-match` treats a missing property as a failure, which would reject every vote. Do not copy that.)

## What this does not catch

Deliberate evasion. `c l o u d`, `clοud` (with a Greek omicron), and zero-width-joined variants pass straight through.

That is a hard limit, not an oversight. jschan has a `strictFiltering` mode that matches against NFD-stripped, zero-width-stripped and alphanumeric-only permutations of the post, and it is necessarily **detect-only**: normalisation is not invertible, so once you have matched a normalised form you no longer know where in the original text to splice a replacement. Evasion-resistant matching and replacement are mutually exclusive.

For blocking evasive spam and slurs outright, use pkc-js's built-in `publication-match` challenge. Rejecting a publication does not require knowing where the match was. Note that `exclude` can skip a challenge for moderators or high-karma authors, which applies to this package too.

## Prior art

- jschan, which powers soyjak.party: [`checkfilters.js`](https://gitgud.io/fatchan/jschan/-/blob/master/lib/post/checkfilters.js), [`filteractions.js`](https://gitgud.io/fatchan/jschan/-/blob/master/lib/post/filteractions.js), [`getfilterstrings.js`](https://gitgud.io/fatchan/jschan/-/blob/master/lib/post/getfilterstrings.js)
- vichan: [`wordfilters()`](https://github.com/vichan-devel/vichan/blob/master/inc/functions.php#L1798)

Both rewrite server-side at post time and keep no copy of the original.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

| Path | What it is |
|---|---|
| `src/wordfilter-challenge.ts` | The `ChallengeFileFactory`: `optionInputs`, `getChallenge`, `validateChallengeSettings` |
| `src/apply-wordfilters.ts` | The client-side replacement loop and the `wordfilter/v1` option keys. Imports nothing, so it bundles for a browser |
| `src/types.ts` | Re-exports of the pkc-js challenge types |

## License

GPL-3.0-or-later, the same as pkc-js.
