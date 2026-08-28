#!/usr/bin/env node
'use strict';
import { execSync } from 'child_process';
import path from 'path';
import url from 'url';
const dirname = path.dirname(url.fileURLToPath(import.meta.url));
const clientPath = path.resolve(dirname, 'client');
const serverPath = path.resolve(dirname, 'server');
try {
    const stdio = process.env.DEBUG === 'true' ? 'inherit' : 'pipe';
    process.stdout.write('Pulling new version from github...');
    execSync('git pull --ff-only', { stdio });
    process.stdout.write(' done\n');
    process.stdout.write('Updating node modules...');
    execSync('npm ci', { cwd: clientPath, stdio });
    execSync('npm prune', { cwd: clientPath, stdio });
    execSync('npm ci', { cwd: serverPath, stdio });
    execSync('npm prune', { cwd: serverPath, stdio });
    process.stdout.write(' done\n');
    process.stdout.write('Building client app...');
    execSync('npm run build', { cwd: clientPath, stdio });
    process.stdout.write(' done\n');
    process.stdout.write('Please restart RC Teleporter\n');
} catch (error) {
    process.stderr.write('\nBuild or start failed. Re-run with DEBUG=true node update.js\n');
    if (error && error.message) process.stderr.write(error.message + '\n');
    process.exit(1);
}
