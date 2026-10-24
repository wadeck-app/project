import { InvalidLabelSelectorError, InvalidProjectLabelError, RegistryInvalidError } from './errors.js';
import { describeProject } from './projects.js';
import type { Project, Registry } from './types.js';

export const MAX_PROJECT_LABELS = 32;
const MAX_PART_LENGTH = 64;
const PART_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SEPARATOR = '::';
const WILDCARD = '*';
const RULE =
  "a label is 'key::value' or a bare 'value', each part matching ^[a-z0-9][a-z0-9._-]*$ (lowercase letters, digits, '.', '_' and '-', starting with a letter or a digit), " +
  `at most ${MAX_PART_LENGTH} characters each, at most one '${SEPARATOR}'`;

/** A parsed label: `state::production` has the key `state`; a bare `sandbox` has none. */
export interface ParsedLabel {
  key?: string;
  value: string;
  /** The stored form: `key::value` or `value`, lowercase. */
  text: string;
}

function invalid(input: string, reason: string): InvalidProjectLabelError {
  return new InvalidProjectLabelError(`label '${input}' is invalid: ${reason}; ${RULE}`, { input, reason });
}

/** Why a key or a value is not valid, or undefined when it is. */
function partProblem(part: string, what: 'key' | 'value'): string | undefined {
  if (part === '') {
    return `the ${what} is empty`;
  }
  if (part.includes(WILDCARD)) {
    return `the ${what} '${part}' contains '${WILDCARD}': wildcards (${WILDCARD}) are only allowed in filter selectors, not in labels`;
  }
  if (part.length > MAX_PART_LENGTH) {
    return `the ${what} has ${part.length} characters, at most ${MAX_PART_LENGTH} are allowed`;
  }
  if (!PART_PATTERN.test(part)) {
    return `the ${what} '${part}' has characters that are not allowed`;
  }
  return undefined;
}

function checkPart(input: string, part: string, what: 'key' | 'value'): void {
  const problem = partProblem(part, what);
  if (problem !== undefined) {
    throw invalid(input, problem);
  }
}

/** Parses a label or a selector: trimmed, lowercased, validated. */
export function parseLabel(input: string): ParsedLabel {
  const text = input.trim().toLowerCase();
  if (text === '') {
    throw invalid(input, 'the label is empty');
  }
  const parts = text.split(SEPARATOR);
  if (parts.length > 2) {
    throw invalid(input, `it has more than one '${SEPARATOR}' separator, at most one is allowed`);
  }
  if (parts.length === 2) {
    checkPart(input, parts[0]!, 'key');
    checkPart(input, parts[1]!, 'value');
    return { key: parts[0]!, value: parts[1]!, text };
  }
  checkPart(input, text, 'value');
  return { value: text, text };
}

export function formatLabel(label: Pick<ParsedLabel, 'key' | 'value'>): string {
  return label.key === undefined ? label.value : `${label.key}${SEPARATOR}${label.value}`;
}

/** The stored form of a label; throws InvalidProjectLabelError. (`normalizeLabel` is about names and aliases.) */
export function normalizeProjectLabel(input: string): string {
  return parseLabel(input).text;
}

/** The labels of a project, parsed. A project of an older registry has none. */
export function labelsOf(project: Pick<Project, 'labels'>): ParsedLabel[] {
  return (project.labels ?? []).map(parseLabel);
}

/** A filter on labels: a bare token, or a key and a value of which either may be a wildcard (null). */
type Selector = { bare: string } | { key: string | null; value: string | null };

const SELECTOR_FORMS =
  "key::value (exactly this label), key::* (any label with this key), *::value (any label with this value, keyed or bare), *::* (any label), " +
  `or a bare token (a bare label of that value, or any label with that key); each part matches ^[a-z0-9][a-z0-9._-]*$ (at most ${MAX_PART_LENGTH} characters), '${WILDCARD}' stands for any part`;

function invalidSelector(input: string, reason: string): InvalidLabelSelectorError {
  return new InvalidLabelSelectorError(`selector '${input}' is invalid: ${reason}; accepted forms: ${SELECTOR_FORMS}`, { input, reason });
}

function selectorPart(input: string, part: string, what: 'key' | 'value'): string | null {
  if (part === WILDCARD) {
    return null;
  }
  const problem = partProblem(part, what);
  if (problem !== undefined) {
    throw invalidSelector(input, part.includes(WILDCARD) ? `the ${what} '${part}' mixes '${WILDCARD}' with other characters, '${WILDCARD}' must stand alone` : problem);
  }
  return part;
}

/** Parses a selector (lowercased, trimmed): wildcards are allowed here and only here. */
function parseSelector(input: string): Selector {
  const text = input.trim().toLowerCase();
  if (text === '') {
    throw invalidSelector(input, 'the selector is empty');
  }
  if (text === WILDCARD) {
    throw invalidSelector(input, `a lone '${WILDCARD}' is ambiguous, use '${WILDCARD}${SEPARATOR}${WILDCARD}' to match any label`);
  }
  const parts = text.split(SEPARATOR);
  if (parts.length > 2) {
    throw invalidSelector(input, `it has more than one '${SEPARATOR}' separator, at most one is allowed`);
  }
  if (parts.length === 2) {
    return { key: selectorPart(input, parts[0]!, 'key'), value: selectorPart(input, parts[1]!, 'value') };
  }
  return { bare: selectorPart(input, text, 'value')! };
}

function matches(selector: Selector, label: ParsedLabel): boolean {
  if ('bare' in selector) {
    return label.key === selector.bare || (label.key === undefined && label.value === selector.bare);
  }
  // key::* wants a keyed label of that key: a bare label has no key.
  const keyMatches = selector.key === null || label.key === selector.key;
  const valueMatches = selector.value === null || label.value === selector.value;
  return keyMatches && valueMatches;
}

/**
 * Whether the project has a label matching the selector:
 * `key::value` exactly this label; `key::*` any label with this key (keyed labels only); `*::value` any label with this value,
 * keyed or bare; `*::*` any label. A bare token is shorthand: a bare label of that value, or any label with that key.
 * Wildcards exist in selectors only, never in stored labels.
 */
export function hasLabel(project: Pick<Project, 'labels'>, selector: string): boolean {
  const wanted = parseSelector(selector);
  return labelsOf(project).some((label) => matches(wanted, label));
}

/** True when the project matches every selector (AND); no selector matches everything. */
export function matchesSelectors(project: Pick<Project, 'labels'>, selectors: readonly string[]): boolean {
  selectors.forEach(parseSelector);
  return selectors.every((selector) => hasLabel(project, selector));
}

export function filterProjects(registry: Registry, selectors: readonly string[]): Project[] {
  // Validate the selectors even when the registry is empty: a typo must not look like "no match".
  selectors.forEach(parseSelector);
  return registry.projects.filter((project) => matchesSelectors(project, selectors));
}

/** Normalizes labels and drops duplicates, keeping the first occurrence (a label set). */
export function normalizeLabelSet(labels: readonly string[]): string[] {
  return [...new Set(labels.map(normalizeProjectLabel))];
}

/** Refuses a set of more than MAX_PROJECT_LABELS labels; `culprit` is the label that goes over the limit. */
export function assertLabelCount(labels: readonly string[], culprit: string): void {
  if (labels.length > MAX_PROJECT_LABELS) {
    const reason = `at most ${MAX_PROJECT_LABELS} labels per project are allowed, this would make ${labels.length}`;
    throw new InvalidProjectLabelError(`label '${culprit}' cannot be added: ${reason}; remove a label first`, { input: culprit, reason });
  }
}

/** Write-time check of the labels of a project: syntax, stored form, duplicates, count. */
export function validateProjectLabels(project: Project): void {
  const labels = project.labels ?? [];
  const fix = 'fix the entry in registry.json or change it with the project command';
  if (labels.length > MAX_PROJECT_LABELS) {
    throw new RegistryInvalidError(`${describeProject(project)} has ${labels.length} labels, at most ${MAX_PROJECT_LABELS} are allowed; ${fix}`);
  }
  const seen = new Set<string>();
  for (const label of labels) {
    let stored: string;
    try {
      stored = parseLabel(label).text;
    } catch (error) {
      throw new RegistryInvalidError(`${describeProject(project)} has an invalid label: ${(error as Error).message}; ${fix}`);
    }
    if (stored !== label) {
      throw new RegistryInvalidError(`${describeProject(project)}: label '${label}' must be stored lowercase and trimmed ('${stored}'); ${fix}`);
    }
    if (seen.has(label)) {
      throw new RegistryInvalidError(`${describeProject(project)} has the label '${label}' twice; ${fix}`);
    }
    seen.add(label);
  }
}
