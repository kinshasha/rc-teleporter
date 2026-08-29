/*
 * *****************************************************************************
 * Copyright (C) 2019-2021 Chrystian Huot <chrystian.huot@saubeo.solutions>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>
 * ****************************************************************************
 */

'use strict';

import { spawnSync } from 'child_process';
import compression from 'compression';
import cors from 'cors';
import EventEmitter from 'events';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import http from 'http';
import https from 'https';
import path from 'path';
import url from 'url';

import { validateTurnCredentials } from './lib/rc-teleporter/config.js';
import { RcScanner } from './lib/rc-teleporter/main.js';

const dirname = path.dirname(url.fileURLToPath(import.meta.url));
const startupLog = path.resolve(process.env.APP_DATA || dirname, 'npm-start.log');

function recordStartup(message) {
    try {
        fs.appendFileSync(startupLog, `${new Date().toISOString()} pid=${process.pid} ${message}\n`);
    } catch (error) {
        process.stderr.write(`Unable to write startup log: ${error.message}\n`);
    }
}

process.on('uncaughtException', (error) => {
    recordStartup(`server uncaughtException: ${error.stack || error.message}`);
    process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    recordStartup(`server unhandledRejection: ${message}`);
    process.exitCode = 1;
});

process.on('exit', (code) => {
    recordStartup(`server exit code=${code}`);
});

recordStartup(`server process begin args=${JSON.stringify(process.argv.slice(2))}`);

export class App extends EventEmitter {
    constructor() {
        super();

        const configFile = path.resolve(process.env.APP_DATA || dirname, 'config.json');

        const staticFile = 'index.html';

        const staticDir = fs.existsSync(path.resolve(dirname, `../client/${staticFile}`))
            ? path.resolve(dirname, '../client')
            : path.resolve(dirname, '../client/dist/rc-scanner');

        const openssl = !spawnSync('openssl', ['version']).error;

        dotenv.config();

        if (fs.existsSync(configFile)) {
            this.config = JSON.parse(fs.readFileSync(configFile));
        }

        if (this.config === null || typeof this.config !== 'object') {
            this.config = {};
        }

        const nodejs = this.config.nodejs || {};

        this.config.nodejs = {
            env: typeof nodejs.env === 'string' && nodejs.env.length ? nodejs.env : process.env.NODE_ENV || 'production',
            host: typeof nodejs.host === 'string' && nodejs.host.length ? nodejs.host : process.env.NODE_HOST || '0.0.0.0',
            port: typeof nodejs.port === 'number' ? nodejs.port : process.env.NODE_PORT || 3000,
            ssl: typeof nodejs.ssl === 'boolean' ? nodejs.ssl : false,
            sslCa: typeof nodejs.sslCa === 'string' && nodejs.sslCa.length ? nodejs.sslCa : 'ca.crt',
            sslCert: typeof nodejs.sslCert === 'string' && nodejs.sslCert.length ? nodejs.sslCert : 'server.crt',
            sslKey: typeof nodejs.sslKey === 'string' && nodejs.sslKey.length ? nodejs.sslKey : 'server.key',
        };

        const viewer = nodejs.viewer || {};

        this.config.nodejs.viewer = {
            enabled: typeof viewer.enabled === 'boolean'
                ? viewer.enabled
                : (process.env.NODE_VIEWER_ENABLED || 'true').toLowerCase() !== 'false',
            host: typeof viewer.host === 'string' && viewer.host.length ? viewer.host : this.config.nodejs.host,
            port: typeof viewer.port === 'number' ? viewer.port : parseInt(process.env.NODE_VIEWER_PORT, 10) || 3001,
        };

        const sslCaCert = path.resolve(process.env.APP_DATA || dirname, this.config.nodejs.sslCa);
        const sslServerCert = path.resolve(process.env.APP_DATA || dirname, this.config.nodejs.sslCert);
        const sslServerKey = path.resolve(process.env.APP_DATA || dirname, this.config.nodejs.sslKey);

        if (openssl && !(fs.existsSync(sslCaCert) && fs.existsSync(sslServerCert) && fs.existsSync(sslServerKey))) {
            const sslCaKey = sslCaCert.replace(/\..*$/, '.key');
            const sslCaSerial = sslCaCert.replace(/\..*$/, '.srl');
            const sslServerCsr = sslServerCert.replace(/\..*$/, '.csr');

            spawnSync('openssl', [
                'req', '-new', '-newkey', 'rsa:4096', '-batch', '-nodes', '-x509', '-days', '7305',
                '-subj', '/CN=Rc Scanner CA', '-keyout', sslCaKey, '-out', sslCaCert
            ]);

            spawnSync('openssl', [
                'req', '-new', '-newkey', 'rsa:4096', '-batch', '-nodes', '-subj', '/CN=Rc Scanner',
                '-keyout', sslServerKey, '-out', sslServerCsr,
            ]);

            spawnSync('openssl', [
                'x509', '-in', sslServerCsr, '-days', '7305', '-req', '-CA', sslCaCert,
                '-CAkey', sslCaKey, '-CAcreateserial', '-CAserial', sslCaSerial, '-out', sslServerCert,
            ]);

            fs.rmSync(sslCaSerial);
            fs.rmSync(sslServerCsr);
        }

        this.configFile = configFile;

        this.router = express();
        this.streamUpdateClients = new Set();
        this.router.disable('x-powered-by');
        this.router.use(compression());
        this.router.use(cors());
        this.router.use(express.json());
        this.router.use(express.urlencoded({ extended: false }));
        this.router.use(helmet({ contentSecurityPolicy: false }));
        this.router.use(createBrowserConnectionLogger(3000));
        this.router.use((req, res, next) => {
            if (req.path === '/' || req.path === '/index.html') {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }

            next();
        });
        registerStreamUpdatesRoutes(this.router, configFile, this.streamUpdateClients);
        this.router.use(express.static(staticDir));
        this.router.use((req, res, next) => {
            if (['/', '/index.html'].includes(req.path)) {
                if (fs.existsSync(path.join(staticDir, staticFile))) {
                    return res.sendFile(staticFile, { root: staticDir });

                } else {
                    return res.send('A new build is being prepared. Please check back in a few minutes.');
                }

            } else {
                return next();
            }
        });
        this.router.set(this.config.nodejs.port);

        if (this.config.nodejs.viewer.enabled) {
            this.viewerRouter = express();
            this.viewerRouter.disable('x-powered-by');
            this.viewerRouter.use(compression());
            this.viewerRouter.use(express.json());
            this.viewerRouter.use(helmet({ contentSecurityPolicy: false }));
            this.viewerRouter.use(createBrowserConnectionLogger(this.config.nodejs.viewer.port));
            this.viewerRouter.use((req, res, next) => {
                if (req.path === '/' || req.path === '/index.html') {
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                }

                next();
            });
            registerStreamUpdatesRoutes(this.viewerRouter, configFile, this.streamUpdateClients);
            this.viewerRouter.use(express.static(staticDir));
            this.viewerRouter.use((req, res, next) => {
                if (['/', '/index.html'].includes(req.path)) {
                    if (fs.existsSync(path.join(staticDir, staticFile))) {
                        return res.sendFile(staticFile, { root: staticDir });

                    } else {
                        return res.send('A new build is being prepared. Please check back in a few minutes.');
                    }

                } else {
                    return next();
                }
            });
        }

        if (
            this.config.nodejs.env !== 'development' && this.config.nodejs.ssl === true &&
            fs.existsSync(sslServerCert) && fs.existsSync(sslServerKey)
        ) {
            const options = {
                cert: fs.readFileSync(sslServerCert),
                key: fs.readFileSync(sslServerKey),
            };

            if (fs.existsSync(this.config.nodejs.sslCA)) {
                options.ca = fs.readFileSync(sslCaCert);
            }

            this.httpServer = https.createServer(options, this.router);

        } else {
            this.httpServer = http.createServer(this.router);
        }

        if (this.viewerRouter) {
            if (this.httpServer instanceof https.Server) {
                const options = {
                    cert: fs.readFileSync(sslServerCert),
                    key: fs.readFileSync(sslServerKey),
                };

                if (fs.existsSync(this.config.nodejs.sslCA)) {
                    options.ca = fs.readFileSync(sslCaCert);
                }

                this.viewerHttpServer = https.createServer(options, this.viewerRouter);

            } else {
                this.viewerHttpServer = http.createServer(this.viewerRouter);
            }
        }

        this.once('ready', () => this.saveConfig());

        this.rcScanner = new RcScanner(this);

        this.rcScanner.audio.on('title', (line) => {
            const event = `data: ${JSON.stringify(line)}\n\n`;

            this.streamUpdateClients.forEach((res) => res.write(event));
        });

        this.rcScanner.on('config', () => this.saveConfig());

        this.rcScanner.on('ready', () => {
            this.httpServer.listen(this.config.nodejs.port, this.config.nodejs.host, () => {
                const scheme = this.httpServer instanceof https.Server ? 'https' : 'http';

                this.url = `${scheme}://${this.config.nodejs.host}:${this.config.nodejs.port}`;

                console.log(`Server is running at ${this.url}`);
            });

            if (this.viewerHttpServer) {
                this.viewerHttpServer.listen(this.config.nodejs.viewer.port, this.config.nodejs.viewer.host, () => {
                    const scheme = this.viewerHttpServer instanceof https.Server ? 'https' : 'http';
                    const viewerUrl = `${scheme}://${this.config.nodejs.viewer.host}:${this.config.nodejs.viewer.port}`;

                    console.log(`View-only server running at ${viewerUrl}`);
                });
            }

            logTurnStartupStatus();

            this.emit('ready');
        });
    }

    saveConfig() {
        const persistedConfig = JSON.parse(JSON.stringify(this.config));
        const persistedScanner = persistedConfig.rcScanner;
        const persistedStream = persistedConfig.rcScanner?.audio?.injectedStream;
        const scannerConfig = this.rcScanner?.config;

        if (persistedScanner) {
            delete persistedScanner.streamList;
            delete persistedScanner.viewerSessions;
            delete persistedScanner.activeFallbackStreams;
            delete persistedScanner.activeWebRtcStreams;
        }

        if (persistedStream) {
            delete persistedStream.streamNumber;

            if (scannerConfig) {
                persistedStream.url = scannerConfig.directInjectedStreamUrl;
                persistedStream.label = scannerConfig.directInjectedStreamLabel;
            }
        }

        const config = Object.keys(persistedConfig)
            .sort((a, b) => a.localeCompare(b))
            .reduce((conf, key) => {
                conf[key] = persistedConfig[key];
                return conf;
            }, {});

        try {
            fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));

        } catch (error) {
            console.error(error.message);
        }
    }
}

export const app = new App();

function createBrowserConnectionLogger(port) {
    return (req, res, next) => {
        if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
            console.log(`${eventTimestamp()} [web ${port}] browser opened from ${getClientAddress(req)}`);
        }

        next();
    };
}

function getClientAddress(req) {
    const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
    const address = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0].trim();

    return address || req.socket?.remoteAddress || 'unknown';
}

async function logTurnStartupStatus() {
    const result = await validateTurnCredentials();

    if (!result.configured) {
        console.warn(colorizeStartupStatus('[TURN] credentials not configured; direct WebRTC only', '\x1b[33m'));
    } else if (result.accepted) {
        console.log(colorizeStartupStatus(`[TURN] credentials accepted (${result.serverCount} ICE server entries)`, '\x1b[32m'));
    } else {
        console.error(colorizeStartupStatus(`[TURN] credentials rejected: ${result.error}`, '\x1b[31m'));
    }
}

function colorizeStartupStatus(message, color) {
    return `${color}${message}\x1b[0m`;
}

function eventTimestamp() {
    return new Date().toISOString();
}

function registerStreamUpdatesRoutes(router, configFile, clients) {
    const logFile = path.resolve(path.dirname(configFile), 'streamupdates.log');

    router.get('/streamupdates.html', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        return res.type('html').send(streamUpdatesPage());
    });

    router.get('/streamupdates/history', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        return res.send(readStreamUpdates(logFile));
    });

    router.get('/streamupdates/events', (req, res) => {
        res.status(200);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        clients.add(res);

        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);

        req.on('close', () => {
            clearInterval(keepAlive);
            clients.delete(res);
        });
    });
}

function readStreamUpdates(logFile) {
    try {
        return fs.readFileSync(logFile, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-1000);

    } catch (error) {
        return [];
    }
}

function streamUpdatesPage() {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Stream updates</title>
    <style>
        :root { color-scheme: dark; font-family: system-ui, sans-serif; }
        body { background: #1e1e1e; color: #f3f3f3; margin: 0; padding: 24px; }
        main { margin: 0 auto; max-width: 900px; }
        h1 { font-size: 22px; margin: 0 0 16px; }
        #status { color: #a9e59d; font-size: 13px; margin-bottom: 12px; }
        #controls { align-items: center; display: flex; gap: 10px; margin-bottom: 12px; }
        #controls button, #controls select { background: #333; border: 1px solid #555; border-radius: 5px; color: #fff; padding: 7px 10px; }
        #controls button:disabled { opacity: .4; }
        #page-label { color: #bbb; font-size: 13px; margin-left: auto; }
        #active-stream { color: #888; font-size: 13px; }
        #active-stream.live { color: #a9e59d; }
        #updates { background: #111; border: 1px solid #444; border-radius: 8px; font: 14px/1.5 ui-monospace, monospace; min-height: 240px; overflow-wrap: anywhere; padding: 14px; white-space: pre-wrap; }
        .line { border-bottom: 1px solid #292929; padding: 5px 0; }
        .line:last-child { border-bottom: 0; }
    </style>
</head>
<body>
<main>
    <h1>Stream updates</h1>
    <div id="status">Connecting...</div>
    <div id="controls">
        <label for="page-size">Events per page</label>
        <select id="page-size">
            <option value="50" selected>50</option>
            <option value="100">100</option>
            <option value="1000">1000</option>
        </select>
        <button id="previous" type="button">Newer</button>
        <button id="next" type="button">Older</button>
        <span id="page-label"></span>
        <span id="active-stream">Stream --</span>
    </div>
    <section id="updates" aria-live="polite"></section>
</main>
<script>
    const updates = document.getElementById('updates');
    const status = document.getElementById('status');
    const pageSizeControl = document.getElementById('page-size');
    const previous = document.getElementById('previous');
    const next = document.getElementById('next');
    const pageLabel = document.getElementById('page-label');
    const activeStream = document.getElementById('active-stream');
    let lines = [];
    let pageSize = 50;
    let page = 0;
    const titleOnly = (line) => {
        const match = line.match(/^(\\S+)\\s+(.*)$/);
        return match ? match[2] : line;
    };
    const render = () => {
        updates.replaceChildren();
        lines.slice(page * pageSize, (page + 1) * pageSize).forEach((line) => {
            const item = document.createElement('div');
            item.className = 'line';
            item.textContent = titleOnly(line);
            updates.appendChild(item);
        });
        const pageCount = Math.max(1, Math.ceil(lines.length / pageSize));
        page = Math.min(page, pageCount - 1);
        pageLabel.textContent = 'Page ' + (page + 1) + ' / ' + pageCount + ' (' + lines.length + ' events)';
        previous.disabled = page === 0;
        next.disabled = page >= pageCount - 1;
    };
    const addLine = (line) => {
        lines.unshift(line);
        lines = lines.slice(0, 1000);
        render();
    };
    pageSizeControl.addEventListener('change', () => {
        pageSize = Number(pageSizeControl.value);
        page = 0;
        render();
    });
    previous.addEventListener('click', () => { page = Math.max(0, page - 1); render(); });
    next.addEventListener('click', () => { page++; render(); });
    const startEvents = () => {
        const events = new EventSource('streamupdates/events');
        events.onopen = () => { status.textContent = 'Live'; };
        events.onmessage = (event) => addLine(JSON.parse(event.data));
        events.onerror = () => { status.textContent = 'Reconnecting...'; };
    };
    const refreshActiveStream = () => fetch('audio/injected-status', { cache: 'no-store' })
        .then((response) => response.json())
        .then((stream) => {
            activeStream.textContent = 'Stream ' + (stream.streamNumber || '--') + '/' + (stream.streamCount || '--');
            activeStream.classList.toggle('live', stream.active === true);
        })
        .catch(() => {
            activeStream.textContent = 'Stream --';
            activeStream.classList.remove('live');
        });
    fetch('streamupdates/history', { cache: 'no-store' })
        .then((response) => response.json())
        .then((history) => {
            lines = history.reverse().slice(0, 1000);
            render();
        })
        .catch(() => { status.textContent = 'Unable to load history'; })
        .then(startEvents);
    refreshActiveStream();
    setInterval(refreshActiveStream, 1000);
</script>
</body>
</html>`;
}
