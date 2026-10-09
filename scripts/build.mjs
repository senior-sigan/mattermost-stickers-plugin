import {build} from 'esbuild';
import {cp, lstat, mkdir, readFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const manifest = JSON.parse(await readFile('plugin.json', 'utf8'));
const output = path.resolve('build', manifest.id);
await mkdir(`${output}/webapp`, {recursive: true});
await build({
    entryPoints: ['webapp/main.jsx'], outfile: `${output}/webapp/main.js`, bundle: true, minify: true,
    format: 'iife', target: ['chrome110', 'firefox115', 'safari16'], loader: {'.css': 'text'},
    plugins: [{name: 'mattermost-react', setup(builder) {
        builder.onResolve({filter: /^(react|react-dom)$/}, (args) => ({path: args.path, namespace: 'host'}));
        builder.onLoad({filter: /.*/, namespace: 'host'}, (args) => ({contents: `module.exports = window.${args.path === 'react' ? 'React' : 'ReactDOM'};`, loader: 'js'}));
    }}],
});
await cp('plugin.json', `${output}/plugin.json`);
await rm(`${output}/assets`, {recursive: true, force: true});
await mkdir(`${output}/assets`, {recursive: true});
// Ship only prepared PNG assets, never source images or conversion reports.
await cp('stickers', `${output}/assets/stickers`, {recursive: true, filter: async (source) => {
    const info = await lstat(source);
    return info.isDirectory() || (info.isFile() && path.extname(source).toLowerCase() === '.png');
}});
if (!process.argv.includes('--web-only')) {
    await mkdir(`${output}/server`, {recursive: true});
    for (const arch of ['amd64', 'arm64']) {
        execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', `${output}/server/plugin-linux-${arch}`, './server'], {
            stdio: 'inherit', env: {...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: arch},
        });
    }
    await mkdir('dist', {recursive: true});
    const archive = `dist/${manifest.id}-${manifest.version}.tar.gz`;
    // macOS tar otherwise emits AppleDouble siblings and extended attributes.
    // Keep plugin.json directly at archive root, as the installer expects.
    execFileSync('tar', [
        '--format=ustar', ...(process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : []),
        '-czf', archive, '-C', output, 'plugin.json', 'server', 'webapp', 'assets',
    ], {env: {...process.env, COPYFILE_DISABLE: '1'}});
    execFileSync('go', ['test', './tests', '-run', '^TestInstallableBundle$', '-count=1'], {
        stdio: 'inherit', env: {...process.env, PLUGIN_BUNDLE: path.resolve(archive)},
    });
    console.log(archive);
}
