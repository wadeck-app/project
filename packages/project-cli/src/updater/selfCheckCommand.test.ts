import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UpdaterSetupError, selfCheckCommand } from './selfCheckCommand.js';

describe('selfCheckCommand', () => {
  it('runs the bundle of the globally installed package with "cli self-check", paths quoted', () => {
    const command = selfCheckCommand(() => `${join('C:', 'Program Files', 'npm', 'node_modules')}\n`, join('C:', 'Program Files', 'nodejs', 'node.exe'));
    expect(command).toBe(
      `"${join('C:', 'Program Files', 'nodejs', 'node.exe')}" "${join('C:', 'Program Files', 'npm', 'node_modules', '@wadeck-app', 'project-cli', 'project.cjs')}" cli self-check`,
    );
  });

  it('fails loudly, with the reason and what it means, when npm root -g fails', () => {
    const failing = () => {
      throw new Error('spawn npm ENOENT');
    };
    expect(() => selfCheckCommand(failing, 'node')).toThrow(UpdaterSetupError);
    expect(() => selfCheckCommand(failing, 'node')).toThrow(/npm root -g.*spawn npm ENOENT.*no update was attempted/s);
  });

  it('fails loudly when npm root -g prints nothing', () => {
    expect(() => selfCheckCommand(() => '  \n', 'node')).toThrow(/npm root -g printed nothing.*no update was attempted/s);
  });
});
