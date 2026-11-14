import { describeProject, normalizePath, renameSlug, toNativePath } from '@wadeck-app/project-sdk';
import type { TargetCommand } from '../command.js';
import { forJson, projectFolder } from '../format.js';

export const slugCommand: TargetCommand = {
  name: 'slug',
  summary: 'Change the folder name (slug) of a project: moves <registry>/projects/<id>-<slug>; stop the tools using it first',
  target: 'ref',
  args: ['slug'],
  options: {},
  run: async (context, { scope }, [newSlug]) => {
    const before = scope.project.slug;
    const { project, from, to, moved, unchanged } = await renameSlug(context.registryDir, scope.project.id, newSlug!, { lock: context.lock });
    const folder = projectFolder(context.registryDir, project);
    const json = { ...forJson(project), folder, previousFolder: normalizePath(from), moved, unchanged };
    if (unchanged) {
      return { json, lines: [`slug of ${describeProject(project)} is already ${project.slug}, nothing changed`, `  folder: ${toNativePath(folder)}`] };
    }
    return {
      json,
      lines: [
        `slug of ${describeProject(project)}: ${before ?? '(none)'} -> ${project.slug}`,
        moved ? `  folder moved: ${toNativePath(normalizePath(from))} -> ${toNativePath(normalizePath(to))}` : `  folder: ${toNativePath(normalizePath(to))} (not created yet, nothing to move)`,
      ],
      mutation: `slug ${project.name} (${project.id}) ${before ?? '(none)'} -> ${project.slug}`,
    };
  },
};
