import { HasChildrenError, MainPathError, NoProjectInScopeError, type ProjectError } from '@wadeck-app/project-sdk';

/** Command-line advice for an SDK error, built from the error data (or carried by it): the SDK messages are neutral and know no flag. */
export function hintFor(error: ProjectError): string | undefined {
  if (error instanceof HasChildrenError) {
    const names = error.children.map((child) => child.name).join(', ');
    return `use --recursive to remove ${error.project.name} together with its ${error.children.length} descendant(s): ${names}`;
  }
  if (error instanceof MainPathError) {
    return "pass --new-main <path> to choose the next main path, or run 'project paths main <path>' first";
  }
  if (error instanceof NoProjectInScopeError) {
    return error.hint;
  }
  return undefined;
}
