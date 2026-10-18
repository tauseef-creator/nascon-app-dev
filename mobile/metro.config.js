// Metro config. expo-sqlite on web runs SQLite as WebAssembly in a worker, which needs
// .wasm assets and cross-origin isolation headers (SharedArrayBuffer). Native builds are unaffected.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(req, res, next);
};

// Per-icon Phosphor imports: "phosphor-icons/House" -> the package's compiled single-icon module,
// so only the icons the app uses end up in the bundle (see src/components/Icon.tsx).
const path = require('path');
const PHOSPHOR_ICONS = path.join(path.dirname(require.resolve('phosphor-react-native')), '..', 'module', 'icons');
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('phosphor-icons/')) {
    return { type: 'sourceFile', filePath: path.join(PHOSPHOR_ICONS, `${moduleName.slice('phosphor-icons/'.length)}.js`) };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
