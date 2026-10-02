import type { Scanner } from '../types.js';
import { brewScanner } from './brew.js';
import { brewCaskScanner } from './brew-cask.js';
import { npmScanner } from './npm.js';
import { pnpmScanner } from './pnpm.js';
import { uvScanner } from './uv.js';
import { pipxScanner } from './pipx.js';
import { cargoScanner } from './cargo.js';
import { gitScanner } from './git.js';
import { githubReleaseScanner } from './github-release.js';
import { claudePluginScanner } from './claude-plugin.js';

export { findGitRepoCandidates } from './git.js';

export const scanners: Scanner[] = [
  brewScanner,
  brewCaskScanner,
  npmScanner,
  pnpmScanner,
  uvScanner,
  pipxScanner,
  cargoScanner,
  gitScanner,
  githubReleaseScanner,
  claudePluginScanner,
];
