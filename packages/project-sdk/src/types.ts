export interface ProjectPath {
  /** Normalized absolute path (see normalizePath). */
  path: string;
  main: boolean;
}

export interface Project {
  /** 8 lowercase hex chars, immutable. */
  id: string;
  name: string;
  /** Folder-name part (`projects/<id>-<slug>`), kebab-case ASCII, 1 to 20 chars, see slug.ts. Missing in a registry written before slugs existed, or when the name has no ASCII letter or digit. Renaming it moves the folder; renaming the name does not. */
  slug?: string;
  aliases: string[];
  /** Id of the parent project (inheritance link). */
  parent?: string;
  paths: ProjectPath[];
  /** One free string, stored as given. */
  git?: string;
  /** Free labels (`key::value` or a bare `value`), see projectLabels.ts. Missing in a registry written before labels existed: read it as empty. Not inherited. */
  labels?: string[];
  createdAt: string;
}

export interface DeletedProject extends Project {
  deletedAt: string;
}

export interface Registry {
  schemaVersion: 1;
  projects: Project[];
}

export interface DeletedRegistry {
  schemaVersion: 1;
  projects: DeletedProject[];
}
