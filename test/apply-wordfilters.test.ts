import { describe, expect, it } from "vitest";
import { applyWordfilters, escapeRegExp, type WordfilterRule } from "../src/apply-wordfilters.js";

describe("escapeRegExp", () => {
  it("escapes regex metacharacters so rules stay literal", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(new RegExp(escapeRegExp("a.c")).test("abc")).toBe(false);
    expect(new RegExp(escapeRegExp("a.c")).test("a.c")).toBe(true);
  });
});

describe("applyWordfilters", () => {
  const rules: WordfilterRule[] = [{ src: "cloud", dst: "butt" }];

  it("replaces every occurrence", () => {
    expect(applyWordfilters("cloud and cloud", rules)).toBe("butt and butt");
  });

  it("replaces case-insensitively without preserving casing", () => {
    expect(applyWordfilters("Cloud CLOUD cloud", rules)).toBe("butt butt butt");
  });

  it("deletes the match when dst is empty", () => {
    expect(applyWordfilters("a spamword b", [{ src: "spamword", dst: "" }])).toBe("a  b");
  });

  it("treats src literally, never as a regex", () => {
    expect(applyWordfilters("abc", [{ src: "a.c", dst: "x" }])).toBe("abc");
    expect(applyWordfilters("a.c", [{ src: "a.c", dst: "x" }])).toBe("x");
  });

  it("treats dst literally, so a $& in a replacement is not a backreference", () => {
    expect(applyWordfilters("hi bob", [{ src: "bob", dst: "[$&]" }])).toBe("hi [$&]");
  });

  it("loops until stable, catching a match created by an earlier replacement", () => {
    const cascading: WordfilterRule[] = [
      { src: "ab", dst: "c" },
      { src: "x", dst: "b" }
    ];
    // One pass turns "ax" into "ab", which still contains a filtered word.
    expect(applyWordfilters("ax", cascading)).toBe("c");
  });

  it("applies rules in array order, cascading", () => {
    const cascading: WordfilterRule[] = [
      { src: "one", dst: "two" },
      { src: "two", dst: "three" }
    ];
    expect(applyWordfilters("one", cascading)).toBe("three");
  });

  it("handles two challenges' rules in one call, as the README's client snippet merges them", () => {
    // Challenge A alone turns "baz" into nothing it rejects, but challenge B's replacement reintroduces
    // A's src. Applied one challenge at a time the text ends as "foo" and A rejects it; concatenated
    // into one call the loop carries on to "bar", which both accept.
    const challengeA: WordfilterRule[] = [{ src: "foo", dst: "bar" }];
    const challengeB: WordfilterRule[] = [{ src: "baz", dst: "foo" }];
    expect(applyWordfilters(applyWordfilters("baz", challengeA), challengeB)).toBe("foo");
    expect(applyWordfilters("baz", [...challengeA, ...challengeB])).toBe("bar");
  });

  it("settles on text one challenge still rejects when two challenges undo each other", () => {
    // Neither challenge's validateChallengeSettings can see the other, so this cannot be caught at edit
    // time. A pass that replaces and then undoes the replacement leaves the string unchanged, which the
    // loop reads as stable, so it returns rather than throws. The community rejects the result and the
    // owner has a misconfigured board to fix; the README says so.
    const challengeA: WordfilterRule[] = [{ src: "foo", dst: "bar" }];
    const challengeB: WordfilterRule[] = [{ src: "bar", dst: "foo" }];
    expect(applyWordfilters("foo", [...challengeA, ...challengeB])).toBe("foo");
    expect(applyWordfilters("bar", [...challengeA, ...challengeB])).toBe("foo");
  });

  it("returns the input untouched when no rule matches", () => {
    expect(applyWordfilters("nothing here", rules)).toBe("nothing here");
  });

  it("returns the input untouched when there are no rules", () => {
    expect(applyWordfilters("cloud", [])).toBe("cloud");
  });

  it("throws when the rules never stabilise", () => {
    // The rule set validateChallengeSettings exists to reject: dst contains src.
    expect(() => applyWordfilters("lol", [{ src: "lol", dst: "lolol" }])).toThrow(
      "wordfilter rules did not stabilise"
    );
  });

  it("respects a custom maxPasses", () => {
    const cascading: WordfilterRule[] = [
      { src: "a", dst: "b" },
      { src: "b", dst: "c" },
      { src: "c", dst: "d" }
    ];
    expect(applyWordfilters("a", cascading, 2)).toBe("d");
    expect(() => applyWordfilters("lol", [{ src: "lol", dst: "lolol" }], 1)).toThrow();
  });

  it("produces output the community accepts, containing no src", () => {
    const filtered = applyWordfilters("Cloud is cloud", rules);
    for (const { src } of rules) {
      expect(filtered.toLowerCase()).not.toContain(src.toLowerCase());
    }
  });
});
