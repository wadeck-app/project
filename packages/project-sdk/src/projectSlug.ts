import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectFolderInUseError, SlugFolderExistsError, SlugRenameFailedError } from './errors.js';
import { withRegistryLock } from './lock.js';
import { describeProject } from './projects.js';
import { resolveReference } from './references.js';
import { loadRegistry, registryFilePath, saveRegistry } from './registryIo.js';
import { validateSlug } from './slug.js';
import { resolveProjectDir } from './toolDirs.js';
import type { Project } from './types.js';
import type { MutationOptions } from './update.js';
import { validateRegistry } from './validate.js';

export interface RenameSlugOptions extends MutationOptions {
  /** Test seam: replaces fs.renameSync for the forward move (the rollback always uses the real one). */
  rename?: (from: string, to: string) => void;
}

export interface RenameSlugResult {
  project: Project;
  /** Folder before the call (the path it would have had when it did not exist yet). */
  from: string;
  /** Folder after the call: `<registryDir>/projects/<id>-<slug>`. */
  to: string;
  /** True when a folder was moved on disk. */
  moved: boolean;
  /** True when nothing at all was written (same slug, folder already named so). */
  unchanged: boolean;
}

const REFUSED = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

/**
 * Sets the slug of a live project and MOVES its folder `projects/<id>[-<old>]` to `projects/<id>-<newSlug>` (the name of the project is not touched
 * and never moves the folder). Under the registry lock: same slug and folder already named so is a no-op; a missing folder only updates the registry;
 * an existing target is SlugFolderExistsError; an OS refusal of the move (a daemon of task, queue or flow holds files there: EBUSY, EPERM, EACCES,
 * ENOTEMPTY) is ProjectFolderInUseError and nothing changed. When registry.json cannot be written after the move, the folder is moved back
 * (best effort) and SlugRenameFailedError says where it is. Folders of removed projects are not moved.
 */
export function renameSlug(registryDir: string, ref: string, newSlug: string, options: RenameSlugOptions = {}): Promise<RenameSlugResult> {
  const { rename = renameSync, ...mutation } = options;
  return withRegistryLock(
    registryDir,
    (lock) => {
      validateSlug(newSlug);
      const registry = loadRegistry(registryDir);
      const project = resolveReference(registry, ref);
      const from = resolveProjectDir(registryDir, project.id, project);
      const to = join(registryDir, 'projects', `${project.id}-${newSlug}`);
      if (from === to && project.slug === newSlug) {
        return { project, from, to, moved: false, unchanged: true };
      }
      const moved = from !== to && existsSync(from);
      if (moved && existsSync(to)) {
        throw new SlugFolderExistsError(
          `cannot rename the slug of ${describeProject(project)} to '${newSlug}': the folder '${to}' already exists; merge it by hand with '${from}' or choose another slug; nothing was changed`,
          { folder: to },
        );
      }
      project.slug = newSlug;
      validateRegistry(registry);
      if (moved) {
        try {
          rename(from, to);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? '';
          if (!REFUSED.has(code)) {
            throw error;
          }
          throw new ProjectFolderInUseError(
            `nothing was changed: the folder '${from}' cannot be moved to '${to}' (${code}), it is in use; a tool of the project may hold it ` +
              '(the daemons of task, queue or flow): stop them, then run the command again',
            { from, to, osCode: code },
          );
        }
      }
      try {
        saveRegistry(registryDir, registry, lock);
      } catch (error) {
        const reason = (error as Error).message;
        if (!moved) {
          throw error;
        }
        let restored = true;
        try {
          renameSync(to, from);
        } catch {
          restored = false;
        }
        throw new SlugRenameFailedError(
          restored
            ? `${registryFilePath(registryDir)} could not be written (${reason}); the folder was moved back to '${from}', nothing changed`
            : `${registryFilePath(registryDir)} could not be written (${reason}) and the folder could not be moved back: its data is now in '${to}', ` +
                `while the registry still expects '${from}'; move it back by hand`,
          { from, to, restored },
        );
      }
      return { project, from, to, moved, unchanged: false };
    },
    mutation.lock,
  );
}
