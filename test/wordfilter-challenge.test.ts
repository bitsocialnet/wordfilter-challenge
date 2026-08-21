import { describe, expect, it } from "vitest";
import wordfilterChallenge, {
  description,
  optionInputs,
  validateChallengeSettings
} from "../src/wordfilter-challenge.js";
import {
  applyWordfilters,
  WORDFILTER_V1_FIELD_NAMES_OPTION,
  WORDFILTER_V1_RULES_OPTION,
  type WordfilterRule
} from "../src/apply-wordfilters.js";
import type {
  ChallengeResultInput,
  CommunityChallengeSetting,
  GetChallengeArgsInput
} from "../src/types.js";

const DEFAULT_RULES: WordfilterRule[] = [
  { src: "cloud", dst: "butt" },
  { src: "spamword", dst: "" }
];

const DEFAULT_ERROR =
  "This community replaces certain words. Please repost with the replacements applied.";

const buildSettings = (params: {
  wordfilters?: string;
  fieldNames?: string;
  error?: string;
  publicOptions?: string[];
}): CommunityChallengeSetting => {
  const options: Record<string, string> = {};
  if (params.wordfilters !== undefined) options[WORDFILTER_V1_RULES_OPTION] = params.wordfilters;
  if (params.fieldNames !== undefined) options[WORDFILTER_V1_FIELD_NAMES_OPTION] = params.fieldNames;
  if (params.error !== undefined) options["error"] = params.error;

  return {
    name: "wordfilter",
    options,
    publicOptions: params.publicOptions ?? [WORDFILTER_V1_RULES_OPTION]
  } as CommunityChallengeSetting;
};

const runChallenge = async (params: {
  settings: CommunityChallengeSetting;
  publicationType?: "comment" | "vote" | "commentEdit" | "commentModeration" | "communityEdit";
  publication: Record<string, unknown>;
}): Promise<Extract<ChallengeResultInput, { success: boolean }>> => {
  const challengeFile = wordfilterChallenge({ challengeSettings: params.settings });

  const result = await challengeFile.getChallenge({
    challengeSettings: params.settings,
    challengeRequestMessage: {
      [params.publicationType ?? "comment"]: params.publication
    } as unknown as GetChallengeArgsInput["challengeRequestMessage"],
    challengeIndex: 0,
    community: {} as unknown as GetChallengeArgsInput["community"]
  });

  if (!("success" in result)) {
    throw new Error("Expected a challenge result");
  }

  return result;
};

const runWithRules = (
  publication: Record<string, unknown>,
  rules: WordfilterRule[] = DEFAULT_RULES,
  extra: { fieldNames?: string; error?: string } = {}
) =>
  runChallenge({
    settings: buildSettings({ wordfilters: JSON.stringify(rules), ...extra }),
    publication
  });

describe("the challenge file", () => {
  it("returns the hooks pkc-js expects", () => {
    const challengeFile = wordfilterChallenge({
      challengeSettings: buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES) })
    });

    expect(challengeFile.type).toBe("text/plain");
    expect(challengeFile.description).toBe(description);
    expect(challengeFile.optionInputs).toBe(optionInputs);
    expect(typeof challengeFile.getChallenge).toBe("function");
    expect(typeof challengeFile.validateChallengeSettings).toBe("function");
  });

  it("declares every option the README documents, with the rules required", () => {
    const declared = optionInputs.map((input) => input.option);
    expect(declared).toEqual(["wordfilter/v1/rules", "wordfilter/v1/fieldNames", "error"]);
    expect(optionInputs.find((input) => input.option === WORDFILTER_V1_RULES_OPTION)?.required).toBe(
      true
    );
  });

  // These two strings are the wire contract. Clients recognise wordfilter/v1 by the presence of the rules
  // key in a community's publicOptions, and most of them never install this package, so renaming either
  // constant silently stops every such client from filtering. Asserting the literals here makes a rename
  // a test failure rather than a field report.
  it("pins the contract option keys", () => {
    expect(WORDFILTER_V1_RULES_OPTION).toBe("wordfilter/v1/rules");
    expect(WORDFILTER_V1_FIELD_NAMES_OPTION).toBe("wordfilter/v1/fieldNames");
  });

  // The factory runs on load as well as on edit, so a throw here fails community startup rather than the
  // offending edit.
  it("does not throw on a config validateChallengeSettings would reject", () => {
    expect(() =>
      wordfilterChallenge({ challengeSettings: buildSettings({ wordfilters: "not json" }) })
    ).not.toThrow();
  });
});

describe("getChallenge", () => {
  it("rejects a publication that still contains a filtered word", async () => {
    const result = await runWithRules({ content: "I love the cloud" });
    expect(result).toEqual({ success: false, error: DEFAULT_ERROR });
  });

  it("accepts a publication with the replacements already applied", async () => {
    const content = applyWordfilters("I love the cloud", DEFAULT_RULES);
    const result = await runWithRules({ content });
    expect(result).toEqual({ success: true });
  });

  it("matches case-insensitively", async () => {
    for (const content of ["CLOUD", "Cloud", "cLoUd"]) {
      expect(await runWithRules({ content })).toEqual({ success: false, error: DEFAULT_ERROR });
    }
  });

  it("matches a filtered word inside a larger word", async () => {
    const result = await runWithRules({ content: "cloudflare" });
    expect(result).toEqual({ success: false, error: DEFAULT_ERROR });
  });

  it("checks title and author.displayName by default", async () => {
    expect(await runWithRules({ title: "cloud good" })).toEqual({
      success: false,
      error: DEFAULT_ERROR
    });
    expect(await runWithRules({ author: { displayName: "cloud fan" } })).toEqual({
      success: false,
      error: DEFAULT_ERROR
    });
  });

  it("uses the owner's error message when set", async () => {
    const error = "This board replaces certain words.";
    const result = await runWithRules({ content: "cloud" }, DEFAULT_RULES, { error });
    expect(result).toEqual({ success: false, error });
  });

  it("checks only the configured fieldNames", async () => {
    const fieldNames = JSON.stringify(["title"]);
    expect(await runWithRules({ content: "cloud" }, DEFAULT_RULES, { fieldNames })).toEqual({
      success: true
    });
    expect(await runWithRules({ title: "cloud" }, DEFAULT_RULES, { fieldNames })).toEqual({
      success: false,
      error: DEFAULT_ERROR
    });
  });

  it("resolves dot-notation paths of any depth", async () => {
    const fieldNames = JSON.stringify(["author.displayName"]);
    expect(
      await runWithRules({ author: { displayName: "cloud" } }, DEFAULT_RULES, { fieldNames })
    ).toEqual({ success: false, error: DEFAULT_ERROR });
  });

  // publication-match treats a missing property as a failure, which would reject every vote.
  describe("absent fields pass cleanly", () => {
    it("passes a vote, which has no content or title", async () => {
      const result = await runChallenge({
        settings: buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES) }),
        publicationType: "vote",
        publication: { commentCid: "Qm...", vote: 1, author: { address: "author.bso" } }
      });
      expect(result).toEqual({ success: true });
    });

    it("passes when the whole parent object of a path is missing", async () => {
      expect(await runWithRules({ content: "clean" })).toEqual({ success: true });
    });

    it("passes when a path resolves to a non-string", async () => {
      const fieldNames = JSON.stringify(["author"]);
      expect(
        await runWithRules({ author: { displayName: "cloud" } }, DEFAULT_RULES, { fieldNames })
      ).toEqual({ success: true });
    });
  });

  it("passes every publication type through the same check", async () => {
    for (const publicationType of ["comment", "commentEdit", "commentModeration", "communityEdit"] as const) {
      const result = await runChallenge({
        settings: buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES) }),
        publicationType,
        publication: { content: "cloud" }
      });
      expect(result).toEqual({ success: false, error: DEFAULT_ERROR });
    }
  });

  it("passes when the rule set is empty", async () => {
    expect(await runWithRules({ content: "cloud" }, [])).toEqual({ success: true });
  });

  it("passes when wordfilters is not set at all", async () => {
    const result = await runChallenge({
      settings: buildSettings({}),
      publication: { content: "cloud" }
    });
    expect(result).toEqual({ success: true });
  });

  it("fails loudly on a config that predates validateChallengeSettings", async () => {
    const result = await runChallenge({
      settings: buildSettings({ wordfilters: "not json" }),
      publication: { content: "anything" }
    });
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain("Invalid wordfilter challenge settings");
  });

  it("reports a challenge request carrying no publication", async () => {
    const challengeFile = wordfilterChallenge({
      challengeSettings: buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES) })
    });
    const result = await challengeFile.getChallenge({
      challengeSettings: buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES) }),
      challengeRequestMessage: {} as unknown as GetChallengeArgsInput["challengeRequestMessage"],
      challengeIndex: 0,
      community: {} as unknown as GetChallengeArgsInput["community"]
    });
    expect(result).toEqual({
      success: false,
      error: "Could not derive publication from challenge request."
    });
  });

  it("accepts anything applyWordfilters produced, for a cascading rule set", async () => {
    const cascading: WordfilterRule[] = [
      { src: "ab", dst: "q" },
      { src: "x", dst: "b" }
    ];
    expect(await runWithRules({ content: "ax" }, cascading)).toEqual({
      success: false,
      error: DEFAULT_ERROR
    });
    expect(await runWithRules({ content: applyWordfilters("ax", cascading) }, cascading)).toEqual({
      success: true
    });
  });
});

describe("validateChallengeSettings", () => {
  const expectValid = (settings: CommunityChallengeSetting) =>
    expect(() => validateChallengeSettings({ challengeSettings: settings })).not.toThrow();

  const expectRejected = (settings: CommunityChallengeSetting, message: string | RegExp) =>
    expect(() => validateChallengeSettings({ challengeSettings: settings })).toThrow(message);

  it("accepts the README's example config", () => {
    expectValid(
      buildSettings({
        wordfilters: JSON.stringify(DEFAULT_RULES),
        fieldNames: JSON.stringify(["content", "title", "author.displayName"]),
        error: "This board replaces certain words.",
        publicOptions: [WORDFILTER_V1_RULES_OPTION, WORDFILTER_V1_FIELD_NAMES_OPTION, "error"]
      })
    );
  });

  it("rejects wordfilters missing from publicOptions", () => {
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES), publicOptions: [] }),
      /wordfilter\/v1\/rules must be listed in publicOptions/
    );
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES), publicOptions: ["error"] }),
      /wordfilter\/v1\/rules must be listed in publicOptions/
    );
  });

  // The 0.1.x keys. A community that was never migrated must fail loudly: getChallenge reading no rules
  // would return success for everything, which is a wordfilter that has quietly stopped filtering. In a
  // live community core rejects the undeclared option before this hook is ever reached, so this is the
  // second of two guards, not the only one.
  it("rejects the pre-contract wordfilters and fieldNames keys", () => {
    const legacy = {
      name: "wordfilter",
      options: { wordfilters: JSON.stringify(DEFAULT_RULES), fieldNames: '["content"]' },
      publicOptions: ["wordfilters", "fieldNames"]
    } as CommunityChallengeSetting;

    expectRejected(legacy, /wordfilter\/v1\/rules must be listed in publicOptions/);
  });

  it("rejects unparseable wordfilters JSON", () => {
    expectRejected(buildSettings({ wordfilters: "{not json" }), /wordfilter\/v1\/rules is not valid JSON/);
  });

  it("rejects wordfilters that is not an array of objects", () => {
    expectRejected(buildSettings({ wordfilters: '{"src":"a","dst":"b"}' }), /must be a JSON array/);
    expectRejected(buildSettings({ wordfilters: '["cloud"]' }), /wordfilter\/v1\/rules\[0\] must be an object/);
    expectRejected(buildSettings({ wordfilters: '[{"dst":"b"}]' }), /wordfilter\/v1\/rules\[0\]\.src must be a string/);
    expectRejected(buildSettings({ wordfilters: '[{"src":"a"}]' }), /wordfilter\/v1\/rules\[0\]\.dst must be a string/);
  });

  it("rejects an empty src", () => {
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify([{ src: "", dst: "x" }]) }),
      /wordfilter\/v1\/rules\[0\]\.src must not be empty/
    );
  });

  it("rejects src === dst, case-insensitively", () => {
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify([{ src: "lol", dst: "lol" }]) }),
      /replaces nothing/
    );
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify([{ src: "LOL", dst: "lol" }]) }),
      /replaces nothing/
    );
  });

  it("rejects the same src in more than one rule, case-insensitively", () => {
    expectRejected(
      buildSettings({
        wordfilters: JSON.stringify([
          { src: "a", dst: "b" },
          { src: "A", dst: "c" }
        ])
      }),
      /is already the src of rule 0/
    );
  });

  it("rejects a dst containing its own src, the rule that keeps the client loop terminating", () => {
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify([{ src: "lol", dst: "lolol" }]) }),
      /contains rule 0's src/
    );
  });

  it("rejects a dst containing another rule's src", () => {
    expectRejected(
      buildSettings({
        wordfilters: JSON.stringify([
          { src: "a", dst: "zz" },
          { src: "z", dst: "y" }
        ])
      }),
      /contains rule 1's src/
    );
  });

  it("rejects a dst that contains a src case-insensitively", () => {
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify([{ src: "lol", dst: "LOLOL" }]) }),
      /contains rule 0's src/
    );
  });

  it("rejects more than 64 rules", () => {
    const rules = Array.from({ length: 65 }, (_, index) => ({
      src: `src${index}`,
      dst: `replacement${index}`
    }));
    expectRejected(buildSettings({ wordfilters: JSON.stringify(rules) }), /the maximum is 64/);
    expectValid(buildSettings({ wordfilters: JSON.stringify(rules.slice(0, 64)) }));
  });

  it("rejects a src or dst longer than 128 characters", () => {
    const long = "a".repeat(129);
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify([{ src: long, dst: "x" }]) }),
      /\.src is 129 characters, the maximum is 128/
    );
    expectRejected(
      buildSettings({ wordfilters: JSON.stringify([{ src: "x", dst: "b".repeat(129) }]) }),
      /\.dst is 129 characters, the maximum is 128/
    );
    expectValid(
      buildSettings({ wordfilters: JSON.stringify([{ src: "a".repeat(128), dst: "x" }]) })
    );
  });

  it("accepts an empty dst, which deletes the match", () => {
    expectValid(buildSettings({ wordfilters: JSON.stringify([{ src: "spamword", dst: "" }]) }));
  });

  it("accepts an empty rule set", () => {
    expectValid(buildSettings({ wordfilters: "[]" }));
  });

  // An empty string satisfies core's `required` check, so the hook has to have an opinion on it.
  it("rejects an empty wordfilters string rather than silently disabling the filter", () => {
    expectRejected(buildSettings({ wordfilters: "" }), /wordfilter\/v1\/rules is not valid JSON/);
  });

  it("rejects an empty fieldNames string", () => {
    expectRejected(
      buildSettings({
        wordfilters: JSON.stringify(DEFAULT_RULES),
        fieldNames: "",
        publicOptions: [WORDFILTER_V1_RULES_OPTION, WORDFILTER_V1_FIELD_NAMES_OPTION]
      }),
      /wordfilter\/v1\/fieldNames is not valid JSON/
    );
  });

  it("rejects fieldNames that is set but not published", () => {
    expectRejected(
      buildSettings({
        wordfilters: JSON.stringify(DEFAULT_RULES),
        fieldNames: JSON.stringify(["content"]),
        publicOptions: [WORDFILTER_V1_RULES_OPTION]
      }),
      /wordfilter\/v1\/fieldNames must be listed in publicOptions/
    );
  });

  it("rejects unparseable or malformed fieldNames", () => {
    expectRejected(
      buildSettings({
        wordfilters: JSON.stringify(DEFAULT_RULES),
        fieldNames: "not json",
        publicOptions: [WORDFILTER_V1_RULES_OPTION, WORDFILTER_V1_FIELD_NAMES_OPTION]
      }),
      /wordfilter\/v1\/fieldNames is not valid JSON/
    );
    expectRejected(
      buildSettings({
        wordfilters: JSON.stringify(DEFAULT_RULES),
        fieldNames: '["content", ""]',
        publicOptions: [WORDFILTER_V1_RULES_OPTION, WORDFILTER_V1_FIELD_NAMES_OPTION]
      }),
      /wordfilter\/v1\/fieldNames\[1\] must be a non-empty string/
    );
  });

  it("stays silent about an unset fieldNames", () => {
    expectValid(
      buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES), publicOptions: [WORDFILTER_V1_RULES_OPTION] })
    );
  });

  it("has no opinion on error being published", () => {
    expectValid(
      buildSettings({
        wordfilters: JSON.stringify(DEFAULT_RULES),
        error: "custom",
        publicOptions: [WORDFILTER_V1_RULES_OPTION]
      })
    );
  });

  it("returns undefined rather than a value, per the void hook contract", () => {
    expect(
      validateChallengeSettings({
        challengeSettings: buildSettings({ wordfilters: JSON.stringify(DEFAULT_RULES) })
      })
    ).toBeUndefined();
  });
});
