export * from './errors.js';
export type { DeletedProject, DeletedRegistry, Project, ProjectPath, Registry } from './types.js';

export { defaultRegistryDir } from './registryDir.js';
export { generateId, isIdLike } from './ids.js';
export { type LabelKind, deriveName, normalizeLabel } from './labels.js';
export { describeProject, isVirtual, mainPath } from './projects.js';
export {
  type ParsedLabel,
  filterProjects,
  formatLabel,
  hasLabel,
  labelsOf,
  matchesSelectors,
  normalizeProjectLabel,
  parseLabel,
} from './projectLabels.js';
export { MAX_PROJECT_LABELS } from './projectLabels.js';
export { addLabels, removeLabels } from './labelMutations.js';
export { assertDirectory, isSameOrInside, normalizePath, pathKey } from './paths.js';

export { writeFileAtomic, type AtomicWriteOptions } from './atomicWrite.js';
export { type LockHandle, type LockOptions, type LockWaitInfo, lockFilePath, withRegistryLock } from './lock.js';

export { REGISTRY_SCHEMA_VERSION, deletedFilePath, loadDeleted, loadRegistry, registryFilePath } from './registryIo.js';
export { type ValidateOptions, validateRegistry } from './validate.js';
export type { MutationOptions } from './update.js';
export { type AddProjectInput, addAlias, addProject, removeAlias, renameProject, setGit, setParent } from './projectMutations.js';
export { addPath, movePath, removePath, setMain } from './pathMutations.js';
export { removeProject } from './removal.js';

export { levenshtein, resolveReference } from './references.js';
export {
  type PathMatch,
  type ResolveScopeInput,
  type Scope,
  type ScopeSource,
  describeResolution,
  findProjectForPath,
  requirePath,
  resolveScope,
} from './resolution.js';

export { getChain } from './chain.js';
export { type ConfigLayer, type ToolDirKind, getConfigLayers, projectDir, projectToolDir } from './toolDirs.js';
export {
  type ConfigScope,
  type ConfigSchema,
  type ConfigSection,
  type MergeStrategy,
  type MergedConfig,
  type NamedLayer,
  mergeLayers,
  validateLayer,
} from './config.js';
