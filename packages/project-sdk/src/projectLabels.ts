import { InvalidProjectLabelError, RegistryInvalidError } from './errors.js';
import { describeProject } from './projects.js';
import type { Project, Registry } from './types.js';

export const MAX_PROJECT_LABELS = 32;
const MAX_PART_LENGTH = 64;
const PART_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SEPARATOR = '::';
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

function checkPart(input: string, part: string, what: 'key' | 'value'): void {
  if (part === '') {
    throw invalid(input, `the ${what} is empty`);
  }
  if (part.length > MAX_PART_LENGTH) {
    throw invalid(input, `the ${what} has ${part.length} characters, at most ${MAX_PART_LENGTH} are allowed`);
  }
  if (!PART_PATTERN.test(part)) {
    throw invalid(input, `the ${what} '${part}' has characters that are not allowed`);
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

/**
 * Whether the project has a label matching the selector. `key::value` matches exactly; a bare selector matches a bare
 * label of that value and any `key::value` label of that key.
 */
export function hasLabel(project: Pick<Project, 'labels'>, selector: string): boolean {
  const wanted = parseLabel(selector);
  return labelsOf(project).some((label) => {
    if (wanted.key !== undefined) {
      return label.text === wanted.text;
    }
    return label.key === wanted.value || (label.key === undefined && label.value === wanted.value);
  });
}

/** True when the project matches every selector (AND); no selector matches everything. */
export function matchesSelectors(project: Pick<Project, 'labels'>, selectors: readonly string[]): boolean {
  selectors.forEach(parseLabel);
  return selectors.every((selector) => hasLabel(project, selector));
}

export function filterProjects(registry: Registry, selectors: readonly string[]): Project[] {
  // Validate the selectors even when the registry is empty: a typo must not look like "no match".
  selectors.forEach(parseLabel);
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
