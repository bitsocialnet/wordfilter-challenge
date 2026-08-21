// The client side of the challenge. A community can only accept or reject, so the replacement has to
// happen on the side holding the signing key. This file is the loop that side has to run, kept free of
// any pkc-js import so it can be pulled into a browser bundle on its own.
//
// Most frontends will never install this package: they discover the challenge through
// `community.challenges[i].publicOptions` and have no reason to know which package produced it. The
// README carries this same loop as a copy-pasteable snippet for them, and that snippet is the contract.
// This export exists for the minority that does bundle the package, and must stay behaviourally
// identical to the README's version.

export interface WordfilterRule {
  /** The literal string to look for. Never a regex, and matched case-insensitively. */
  src: string;
  /** What to replace it with. May be empty, which deletes the match. */
  dst: string;
}

export const DEFAULT_FIELD_NAMES: readonly string[] = ["content", "title", "author.displayName"];

export const DEFAULT_MAX_PASSES = 8;

export const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const applyOnce = (text: string, rules: readonly WordfilterRule[]): string =>
  rules.reduce(
    (acc, { src, dst }) => acc.replace(new RegExp(escapeRegExp(src), "gi"), () => dst),
    text
  );

/**
 * Apply `rules` to `text` until the output stops changing.
 *
 * A single pass is not enough: a replacement can join with the text around it to create a new match,
 * so `[{src: "ab", dst: "c"}, {src: "x", dst: "b"}]` turns `"ax"` into `"ab"` in one pass, which the
 * community still rejects. Stable output contains no filtered word by definition, which is exactly what
 * the community checks for.
 *
 * @throws if the rules never stabilise. `validateChallengeSettings` rejects the rule sets that can cause
 * this (no `dst` may contain any `src`), so a community configured through pkc-js 0.0.85+ cannot produce
 * one, but a client should still not spin forever on a hostile record.
 */
export function applyWordfilters(
  text: string,
  rules: readonly WordfilterRule[],
  maxPasses: number = DEFAULT_MAX_PASSES
): string {
  let out = text;
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = applyOnce(out, rules);
    if (next === out) return out;
    out = next;
  }
  throw new Error("wordfilter rules did not stabilise");
}
