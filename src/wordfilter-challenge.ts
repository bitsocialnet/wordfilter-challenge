import type {
  ChallengeFileInput,
  ChallengeInput,
  ChallengeResultInput,
  CommunityChallengeSetting,
  GetChallengeArgsInput,
  PublicationWithCommunityAuthorFromDecryptedChallengeRequest
} from "./types.js";
import {
  DEFAULT_FIELD_NAMES,
  WORDFILTER_V1_FIELD_NAMES_OPTION,
  WORDFILTER_V1_RULES_OPTION,
  type WordfilterRule
} from "./apply-wordfilters.js";

const MAX_RULES = 64;
const MAX_RULE_STRING_LENGTH = 128;

const DEFAULT_ERROR =
  "This community replaces certain words. Please repost with the replacements applied.";

const description =
  "Publications must already have the community's word replacements applied. The community does not rewrite text, it only rejects text that still contains a filtered word.";

const type: ChallengeInput["type"] = "text/plain";

const optionInputs: NonNullable<ChallengeFileInput["optionInputs"]> = [
  {
    option: WORDFILTER_V1_RULES_OPTION,
    label: "Wordfilters",
    default: "[]",
    description:
      "JSON array of {src, dst} replacements, applied in array order, cascading. Matched literally and case-insensitively. Must be listed in publicOptions so publishing clients can read and apply it. The key names the wordfilter/v1 contract rather than this package, so a client written against it works with any implementation.",
    placeholder: '[{"src":"cloud","dst":"butt"},{"src":"spamword","dst":""}]',
    required: true
  },
  {
    option: WORDFILTER_V1_FIELD_NAMES_OPTION,
    label: "Field Names",
    default: JSON.stringify(DEFAULT_FIELD_NAMES),
    description:
      "JSON array of dot-notation paths to check, each starting with the publication type: comment.content, commentEdit.reason, commentModeration.commentModeration.reason and so on. Must be listed in publicOptions when set. Defaults to the text of comments and comment edits plus author.displayName on comments, comment edits and votes.",
    placeholder: JSON.stringify(DEFAULT_FIELD_NAMES)
  },
  {
    // Not namespaced, unlike the two above: the wordfilter/v1 namespace covers exactly what a publishing
    // client has to read, and no client ever reads this. It comes back in the rejection itself, so an
    // implementation is free to name or shape it differently.
    option: "error",
    label: "Error",
    default: DEFAULT_ERROR,
    description: "The error to display to the author when a publication still contains a filtered word.",
    placeholder: DEFAULT_ERROR
  }
];

const publicationFieldNames = [
  "comment",
  "vote",
  "commentEdit",
  "commentModeration",
  "communityEdit"
] as const;

type PublicationType = (typeof publicationFieldNames)[number];
type Publications = Partial<Record<PublicationType, PublicationWithCommunityAuthorFromDecryptedChallengeRequest>>;

// The object field paths are resolved against: the challenge request's publication map, keyed by type. A
// request carries exactly one of these, so `comment.content` is absent, and passes, on a comment edit.
const derivePublicationsFromChallengeRequest = (
  challengeRequestMessage: GetChallengeArgsInput["challengeRequestMessage"]
): Publications | undefined => {
  const publications: Publications = {};
  for (const fieldName of publicationFieldNames) {
    const publication = challengeRequestMessage[fieldName];
    if (publication) {
      publications[fieldName] = publication;
    }
  }

  return Object.keys(publications).length ? publications : undefined;
};

// Dot-notation lookup, the same convention publication-match uses for `propertyName`, except that the
// first segment names the publication type.
const getValueAtPath = (publication: unknown, path: string): unknown => {
  let current: unknown = publication;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const parseRules = (rules: string | undefined): WordfilterRule[] => {
  // Only an absent option means "no rules". An empty string satisfies core's `required` check but is not
  // valid JSON, so it falls through to the parse error rather than silently disabling the filter.
  if (rules === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rules);
  } catch (e) {
    throw new Error(`${WORDFILTER_V1_RULES_OPTION} is not valid JSON: ${(e as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${WORDFILTER_V1_RULES_OPTION} must be a JSON array of {src, dst} objects`);
  }

  return parsed.map((rule, index): WordfilterRule => {
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
      throw new Error(`${WORDFILTER_V1_RULES_OPTION}[${index}] must be an object with src and dst`);
    }
    const { src, dst } = <Partial<WordfilterRule>>rule;
    if (typeof src !== "string") {
      throw new Error(`${WORDFILTER_V1_RULES_OPTION}[${index}].src must be a string`);
    }
    if (typeof dst !== "string") {
      throw new Error(`${WORDFILTER_V1_RULES_OPTION}[${index}].dst must be a string`);
    }
    return { src, dst };
  });
};

const parseFieldNames = (fieldNames: string | undefined): string[] => {
  if (fieldNames === undefined) return [...DEFAULT_FIELD_NAMES];

  let parsed: unknown;
  try {
    parsed = JSON.parse(fieldNames);
  } catch (e) {
    throw new Error(`${WORDFILTER_V1_FIELD_NAMES_OPTION} is not valid JSON: ${(e as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${WORDFILTER_V1_FIELD_NAMES_OPTION} must be a JSON array of dot-notation property paths`);
  }

  return parsed.map((fieldName, index): string => {
    if (typeof fieldName !== "string" || !fieldName) {
      throw new Error(`${WORDFILTER_V1_FIELD_NAMES_OPTION}[${index}] must be a non-empty string`);
    }
    // A path that names no publication type resolves to nothing on every request, which is a wordfilter
    // that has quietly stopped filtering. That is the failure this package exists to prevent, so it is
    // rejected here and, for a config that predates this check, by getChallenge.
    const publicationType = fieldName.split(".")[0] ?? "";
    if (!(publicationFieldNames as readonly string[]).includes(publicationType)) {
      throw new Error(
        `${WORDFILTER_V1_FIELD_NAMES_OPTION}[${index}] must start with a publication type (${publicationFieldNames.join(", ")}), got "${fieldName}"`
      );
    }
    return fieldName;
  });
};

const getChallenge = async ({
  challengeSettings,
  challengeRequestMessage
}: GetChallengeArgsInput): Promise<ChallengeResultInput> => {
  const publications = derivePublicationsFromChallengeRequest(challengeRequestMessage);
  if (!publications) {
    return { success: false, error: "Could not derive publication from challenge request." };
  }

  // validateChallengeSettings rejects an unparseable config at edit time, so reaching this catch means a
  // config that predates the hook. Fail loudly rather than passing everything: a wordfilter that silently
  // stops filtering is worse than one that visibly breaks.
  let rules: WordfilterRule[];
  let fieldNames: string[];
  try {
    rules = parseRules(challengeSettings?.options?.[WORDFILTER_V1_RULES_OPTION]);
    fieldNames = parseFieldNames(challengeSettings?.options?.[WORDFILTER_V1_FIELD_NAMES_OPTION]);
  } catch (e) {
    return { success: false, error: `Invalid wordfilter challenge settings: ${(e as Error).message}` };
  }

  if (!rules.length) {
    return { success: true };
  }

  const error = challengeSettings?.options?.["error"] || DEFAULT_ERROR;

  for (const fieldName of fieldNames) {
    const value = getValueAtPath(publications, fieldName);

    // Absent fields pass cleanly. A vote has no content, and every path that names another publication
    // type is absent on this request. Neither is a failure. publication-match treats a missing property as
    // a failure, which would reject every vote. Do not copy that.
    if (typeof value !== "string") {
      continue;
    }

    const lowerCasedValue = value.toLowerCase();
    for (const rule of rules) {
      if (lowerCasedValue.includes(rule.src.toLowerCase())) {
        return { success: false, error };
      }
    }
  }

  return { success: true };
};

// Everything here is a mistake that would otherwise surface as every author being rejected, long after the
// owner saved the config. Sync and no network, per docs/protocol/challenge-authoring.md.
const validateChallengeSettings = ({
  challengeSettings
}: {
  challengeSettings: CommunityChallengeSetting;
}): void => {
  // A client that cannot read the rules cannot satisfy them, so publication is required rather than the
  // owner's call. See "Require publication when clients need to read it" in challenge-authoring.md.
  if (!challengeSettings.publicOptions?.includes(WORDFILTER_V1_RULES_OPTION)) {
    throw new Error(
      `${WORDFILTER_V1_RULES_OPTION} must be listed in publicOptions: publishing clients apply the replacements before signing, and a client that cannot read the rules cannot satisfy them`
    );
  }

  const rules = parseRules(challengeSettings.options?.[WORDFILTER_V1_RULES_OPTION]);

  if (rules.length > MAX_RULES) {
    throw new Error(`${WORDFILTER_V1_RULES_OPTION} has ${rules.length} rules, the maximum is ${MAX_RULES}`);
  }

  const seenSources = new Map<string, number>();

  for (const [index, { src, dst }] of rules.entries()) {
    if (!src) {
      throw new Error(`${WORDFILTER_V1_RULES_OPTION}[${index}].src must not be empty`);
    }
    if (src.length > MAX_RULE_STRING_LENGTH) {
      throw new Error(
        `${WORDFILTER_V1_RULES_OPTION}[${index}].src is ${src.length} characters, the maximum is ${MAX_RULE_STRING_LENGTH}`
      );
    }
    if (dst.length > MAX_RULE_STRING_LENGTH) {
      throw new Error(
        `${WORDFILTER_V1_RULES_OPTION}[${index}].dst is ${dst.length} characters, the maximum is ${MAX_RULE_STRING_LENGTH}`
      );
    }

    // Matching is case-insensitive, so "AB" and "ab" are the same rule and the same no-op.
    const lowerCasedSrc = src.toLowerCase();
    if (lowerCasedSrc === dst.toLowerCase()) {
      throw new Error(`${WORDFILTER_V1_RULES_OPTION}[${index}].src and dst are both '${src}', which replaces nothing`);
    }

    const firstIndex = seenSources.get(lowerCasedSrc);
    if (firstIndex !== undefined) {
      throw new Error(
        `${WORDFILTER_V1_RULES_OPTION}[${index}].src ('${src}') is already the src of rule ${firstIndex}: the second rule can never match`
      );
    }
    seenSources.set(lowerCasedSrc, index);
  }

  // The rule that guarantees the client's replacement loop terminates. Without it a rule like
  // lol -> lolol produces output that always contains a filtered word, making every post permanently
  // unpublishable. Cross-rule, because rule A's dst is fed to rule B on the next pass.
  for (const [index, { dst }] of rules.entries()) {
    const lowerCasedDst = dst.toLowerCase();
    for (const [otherIndex, { src }] of rules.entries()) {
      if (lowerCasedDst.includes(src.toLowerCase())) {
        throw new Error(
          `${WORDFILTER_V1_RULES_OPTION}[${index}].dst ('${dst}') contains rule ${otherIndex}'s src ('${src}'): the replacement would itself be filtered, so no text could ever pass`
        );
      }
    }
  }

  // Same reasoning as the rules: a client that checks the default fields while the community checks a
  // different set rejects every author, with nothing in the record explaining why.
  if (challengeSettings.options?.[WORDFILTER_V1_FIELD_NAMES_OPTION] !== undefined) {
    parseFieldNames(challengeSettings.options[WORDFILTER_V1_FIELD_NAMES_OPTION]);
    if (!challengeSettings.publicOptions?.includes(WORDFILTER_V1_FIELD_NAMES_OPTION)) {
      throw new Error(
        `${WORDFILTER_V1_FIELD_NAMES_OPTION} must be listed in publicOptions when it is set: a client filtering the default fields cannot satisfy a community checking different ones`
      );
    }
  }
};

function ChallengeFileFactory(_args: {
  challengeSettings: CommunityChallengeSetting;
}): ChallengeFileInput {
  // Deliberately cheap and non-throwing: the factory runs on load as well as on edit, so throwing here
  // would fail community startup rather than the offending edit.
  return { getChallenge, optionInputs, type, description, validateChallengeSettings };
}

export { description, optionInputs, getChallenge, validateChallengeSettings };
export default ChallengeFileFactory;
