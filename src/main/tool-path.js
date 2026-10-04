/**
 * The environment handed to every child process that runs a developer tool.
 *
 * An app launched from Finder inherits launchd's PATH, which has git but not
 * Homebrew's gh, so a bare `gh` fails with ENOENT while the same code works
 * from a terminal. The shell dirs are appended, not prepended, so a system
 * binary keeps priority exactly as it did before.
 */
export const TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

export function withToolDirs(path) {
  const parts = (path || '').split(':').filter(Boolean);
  const missing = TOOL_DIRS.filter((d) => !parts.includes(d));
  return [...parts, ...missing].join(':');
}

export function toolEnv(env = process.env) {
  return { ...env, PATH: withToolDirs(env.PATH) };
}
