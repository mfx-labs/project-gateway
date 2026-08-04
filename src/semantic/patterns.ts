/** Shared text-pattern helpers for semantic evaluators. */
export const AUTHORITY_RE =
  /\b(authoriz(?:e|ed|ation)|approv(?:e|ed|al)|issu(?:e|ed|ance)|grant(?:s|ed)?|activ(?:at(?:e|ed|ion))|receipt|publish(?:ed|ation)|execute(?:s)? (?:commands?|arbitrary)|trusted ceiling|ceiling:)/i;
export const OBSERVED_RE =
  /\b(observed(?: completion)?|outcome was (?:pass|fail)|(?:has|have) (?:passed|failed|completed)|completed (?:successfully|with pass)|the (?:check|completion) (?:passed|failed|was satisfied))/i;
export const CONTEXT_DELEGATION_RE =
  /\b(follow|obey|apply|execute|treat as (?:instruction|command)) (?:every|all|the|embedded|selected|any)[^.]{0,40}(instruction|command|directive|step)s?[^.]{0,30}(context|selected context|embedded|documented)/i;
export const MIGRATION_RE = /\bmigrat(?:e|ion|ed)\b/i;
export const REWRITE_RE = /\b(rewrit(?:e|ten|ing)|amended?|next attempt|objective is|will now|must now)\b/i;
export const EXTENSION_RELIANCE_RE =
  /\b(apply|use|honor|follow|check|verify|record|report)[^.]{0,60}(tag|classification|extension|conformance-tag|review-evidence)\b/i;
