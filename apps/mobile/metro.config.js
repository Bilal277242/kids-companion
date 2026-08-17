// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits to @kids/ui and @kids/types trigger a
// rebuild rather than serving a stale bundle.
config.watchFolders = [workspaceRoot];

// Resolve from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Do not walk further up the filesystem looking for modules.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
