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

import { RcScanner } from './lib/rc-scanner/main.js';

export class App extends EventEmitter {
    constructor() {
        super();

        const dirname = path.dirname(url.fileURLToPath(import.meta.url));

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

            this.emit('ready');
        });
    }

    saveConfig() {
        const config = Object.keys(this.config)
            .sort((a, b) => a.localeCompare(b))
            .reduce((conf, key) => {
                conf[key] = this.config[key];
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

function eventTimestamp() {
    return new Date().toISOString();
}
