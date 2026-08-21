# @bitsocial/wordfilter-challenge

A [pkc-js](https://github.com/pkcprotocol/pkc-js) challenge that makes community wordfilters a real rule instead of a cosmetic display filter.

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

## For UI client developers

This is the section that matters if you are building a frontend that publishes to communities using this challenge.

### 1. Read the rules off the community

The rules are published in the community record, in the challenge's `publicOptions`. Collect them from every wordfilter challenge the community has configured, in challenge order.

The challenge's `name` is **not** in the published record: `path`, `name` and `options` are all stripped when `community.settings.challenges[i]` becomes `community.challenges[i]`. The presence of a `wordfilters` public option is the only thing a client can key off, which is exactly why the challenge requires it to be published.

```js
function getWordfilterConfigs(community) {
    return (community.challenges ?? [])
        .filter((challenge) => challenge.publicOptions?.wordfilters)
        .map((challenge) => {
            try {
                return {
                    rules: JSON.parse(challenge.publicOptions.wordfilters),
                    fieldNames: challenge.publicOptions.fieldNames
                        ? JSON.parse(challenge.publicOptions.fieldNames)
                        : ["content", "title", "author.displayName"]
                };
            } catch {
                // A rule set you cannot parse is skipped, never fatal. Worst case the community
                // rejects the publication with a readable error.
                return undefined;
            }
        })
        .filter(Boolean);
}
```

Skip anything you cannot parse. Never throw, and never refuse to load the community: a malformed rule set must cost the filter, not the whole board.

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
for (const { rules, fieldNames } of configs) {
    if (fieldNames.includes("content") && content) content = applyWordfilters(content, rules);
    if (fieldNames.includes("title") && title) title = applyWordfilters(title, rules);
}
const comment = await pkc.createComment({ content, title, communityAddress, signer });
await comment.publish();
```

`fieldNames` entries are dot-notation paths on the publication, the same convention `publication-match` uses for `propertyName`. So `content` covers both a comment and a comment edit without the config naming publication types.

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
  '--settings.challenges[0].options.wordfilters' '[{"src":"cloud","dst":"butt"}]' \
  '--settings.challenges[0].publicOptions[0]' wordfilters
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
                    wordfilters: JSON.stringify([
                        { src: "cloud", dst: "butt" },
                        { src: "millennials", dst: "snake people" },
                        { src: "spamword", dst: "" }
                    ]),
                    fieldNames: JSON.stringify(["content", "title", "author.displayName"]),
                    error: "This board replaces certain words. Please repost with the replacements applied."
                },
                publicOptions: ["wordfilters", "fieldNames", "error"]
            }
        ]
    }
});
```

`publicOptions` is **required**, not decorative. Options are private by default in pkc-js, and a client that cannot read the rules cannot satisfy them. The challenge's `validateChallengeSettings` hook rejects the edit if `wordfilters` is missing from `publicOptions`, so the failure surfaces when you save rather than when every author starts getting rejected.

### Options

| Option | Required | Must be in `publicOptions` | Description |
|---|---|---|---|
| `wordfilters` | yes | yes | JSON array of `{ src, dst }`, applied in array order, cascading |
| `fieldNames` | no | when set | JSON array of dot-notation paths. Defaults to `content`, `title`, `author.displayName` |
| `error` | no | owner's call | Message shown to the author when a publication is rejected |

An option has to be public when a client cannot satisfy the challenge without reading it. That covers `wordfilters` always, and `fieldNames` whenever the owner sets it: a client filtering the three default fields cannot satisfy a community checking a different set, and nothing in the published record would explain the rejections. `error` is returned in the rejection itself, so publishing it is transparency rather than a requirement.

### Validation

`validateChallengeSettings` rejects at edit time:

- `wordfilters` missing from `publicOptions`, or unparseable JSON, or not an array of `{ src, dst }` strings
- an empty `src`
- `src === dst`
- the same `src` in more than one rule
- any `dst` containing any `src`
- more than 64 rules, or a `src` or `dst` longer than 128 characters
- `fieldNames`, when set, unparseable, not an array of non-empty strings, or missing from `publicOptions`

The `src === dst`, duplicate `src` and `dst`-contains-`src` checks all compare case-insensitively, because matching is case-insensitive: `{src: "LOL", dst: "lol"}` replaces nothing just as surely as `{src: "lol", dst: "lol"}` does.

The `dst` containing `src` rule is what guarantees the client's loop terminates. Without it a rule like `lol` becomes `lolol` produces output that always contains a filtered word, making every post permanently unpublishable.

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
| `src/apply-wordfilters.ts` | The client-side replacement loop. Imports nothing, so it bundles for a browser |
| `src/types.ts` | Re-exports of the pkc-js challenge types |

## License

GPL-3.0-or-later, the same as pkc-js.
