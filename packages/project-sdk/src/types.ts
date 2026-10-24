export interface ProjectPath {
  /** Normalized absolute path (see normalizePath). */
  path: string;
  main: boolean;
}

export interface Project {
  /** 8 lowercase hex chars, immutable. */
  id: string;
  name: string;
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
