import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
await build({entryPoints: ['tests/harness.jsx'], outfile: 'build/harness.js', bundle: true, format: 'iife'});
createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'tests/harness.html' : pathname.slice(1);
    const absolute = path.resolve(file);
    if (!['build', 'stickers'].some((dir) => absolute.startsWith(path.resolve(dir) + path.sep)) && file !== 'tests/harness.html') {res.writeHead(404).end(); return;}
    try {
        const data = await readFile(absolute);
        const types = {'.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png'};
        res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}); res.end(data);
    } catch {res.writeHead(404).end();}
}).listen(8766, '127.0.0.1');
