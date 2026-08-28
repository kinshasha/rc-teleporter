#!/usr/bin/env node
'use strict';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import url from 'url';
const dirname = path.dirname(url.fileURLToPath(import.meta.url));
const clientPath = path.resolve(dirname, 'client');
const serverPath = path.resolve(dirname, 'server');
const clientIndex = path.resolve(clientPath, 'dist/rc-teleporter/index.html');
try {
    const stdio = process.env.DEBUG === 'true' ? 'inherit' : 'pipe';
    if (!existsSync(path.resolve(clientPath, 'node_modules')) || !existsSync(path.resolve(serverPath, 'node_modules'))) {
        process.stdout.write('Installing node modules...');
        if (!existsSync(path.resolve(clientPath, 'node_modules'))) execSync('npm ci', { cwd: clientPath, stdio });
        if (!existsSync(path.resolve(serverPath, 'node_modules'))) execSync('npm ci', { cwd: serverPath, stdio });
        process.stdout.write(' done\n');
    }
    if (!existsSync(clientIndex)) {
        process.stdout.write('Building client app...');
        execSync('npm run build', { cwd: clientPath, stdio });
        process.stdout.write(' done\n');
    }
    const args = process.argv.slice(2).join(' ');
    execSync(`node . ${args}`, { cwd: serverPath, stdio: 'inherit' });
} catch (error) {
    process.stderr.write('\nBuild or start failed. Re-run with DEBUG=true node run.js\n');
    if (error && error.message) process.stderr.write(error.message + '\n');
    process.exit(1);
}
