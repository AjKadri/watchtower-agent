import type { Evidence } from "../domain/schemas.js";

export type Investigation = {
  observedFacts: string[];
  interpretation: {
    severityRuleId: string;
    text: string;
  };
  limitations: string[];
};

const interpretations = {
  "target-is-zero-address": "The decoded implementation is the zero address. The fixed policy classifies that exact address comparison as high severity.",
  "target-is-not-approved": "The decoded implementation is nonzero and is not in the configured approved target list. The fixed policy classifies that exact address comparison as suspicious.",
  "target-is-approved": "The decoded implementation is in the configured approved target list. The fixed policy classifies that exact address comparison as informational.",
} as const;

export function explainEvidence(evidence: Evidence): Investigation {
  const ruleId = evidence.severity.ruleId;
  const interpretation = interpretations[ruleId as keyof typeof interpretations]
    ?? "The alert severity is the recorded result of the configured deterministic rule.";
  const limitations = [
    "The classification compares configured addresses only. It does not establish identity, intent, causality, or implementation safety.",
  ];

  if (evidence.status === "incomplete") {
    limitations.push("Some required evidence could not be retrieved or verified. Review the recorded evidence errors before relying on this alert.");
  }

  return {
    observedFacts: [...evidence.observedFacts],
    interpretation: { severityRuleId: ruleId, text: interpretation },
    limitations,
  };
}
