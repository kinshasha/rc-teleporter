/*
 * *****************************************************************************
 * Copyright (C) 2019-2021 Chrystian Huot
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

import EventEmitter from 'events';
import { URL } from 'url';
import WebSocket from 'ws';

// This is the sole command deliberately exposed by the view-only listener.
const VIEWER_VFO_PUSH = 'KEY,^,P';
const VIEWER_COMMAND_COOLDOWN_MS = 350;

export class Ws extends EventEmitter {
    constructor(ctx) {
        super();

        this.config = ctx.config.webSocket;

        this.audio = ctx.audio;

        this.audioSocket = new WebSocket.Server({ noServer: true });

        this.audioSocket.on('connection', (ws) => {
            const audioHandler = (data) => ws.send(data);

            this.audio.on('data', audioHandler);

            ws.isAlive = true;

            ws.on('close', () => {
                this.audio.removeListener('data', audioHandler);
            });

            ws.on('pong', () => ws.isAlive = true);
        });

        this.observerCount = 0;

        this.lastControlData = null;

        this.controlSocket = new WebSocket.Server({ noServer: true });

        this.controlSocket.on('connection', (ws) => {
            let previousData;

            const driverHandler = (data) => {
                if (data !== previousData) {
                    previousData = data;

                    ws.send(data);
                }
            };

            this.addObserver(driverHandler);

            ws.isAlive = true;

            ws.on('close', () => this.removeObserver(driverHandler));

            ws.on('message', (message) => this.driver.write(message));

            ws.on('pong', () => {
                ws.isAlive = true;
            });
        });

        this.viewerSocket = new WebSocket.Server({ noServer: true });

        this.viewerStreamCount = 0;

        this.viewerSocket.on('connection', (ws) => {
            let previousData;
            let lastViewerCommandAt = 0;

            const driverHandler = (data) => {
                if (data !== previousData && ws.readyState === WebSocket.OPEN) {
                    previousData = data;
                    ws.send(data);
                }
            };

            this.addObserver(driverHandler);
            ws.isAlive = true;
            this.sendViewerState(ws);

            if (this.lastControlData) {
                driverHandler(this.lastControlData);
            }

            // DOM/CSS changes cannot expand this server-side allowlist.
            ws.on('message', (message, isBinary) => {
                if (isBinary || message.toString() !== VIEWER_VFO_PUSH) {
                    return;
                }

                const now = Date.now();

                if (now - lastViewerCommandAt < VIEWER_COMMAND_COOLDOWN_MS) {
                    return;
                }

                lastViewerCommandAt = now;
                this.driver.write(VIEWER_VFO_PUSH);
            });
            ws.on('close', () => this.removeObserver(driverHandler));
            ws.on('pong', () => ws.isAlive = true);
        });

        this.driver = ctx.driver;

        this.driver.on('data', (data) => {
            this.lastControlData = data;
        });

        this.attachUpgradeHandler(ctx.httpServer, false);

        if (ctx.viewerHttpServer) {
            this.attachUpgradeHandler(ctx.viewerHttpServer, true);
        }

        setInterval(() => {
            const check = (ws) => {
                if (!ws.isAlive) {
                    ws.terminate();
                }

                ws.isAlive = false;

                ws.ping();
            };

            this.audioSocket.clients.forEach(check);
            this.controlSocket.clients.forEach(check);
            this.viewerSocket.clients.forEach(check);
        }, this.config.keepAlive);
    }

    addObserver(handler) {
        this.observerCount++;
        this.driver.on('data', handler);

        if (this.observerCount === 1) {
            this.driver.start();
        }
    }

    removeObserver(handler) {
        this.observerCount = Math.max(0, this.observerCount - 1);
        this.driver.removeListener('data', handler);

        if (this.observerCount === 0) {
            this.driver.stop();
        }
    }

    addViewerStream() {
        this.viewerStreamCount++;
        this.broadcastViewerState();
    }

    removeViewerStream() {
        this.viewerStreamCount = Math.max(0, this.viewerStreamCount - 1);
        this.broadcastViewerState();
    }

    broadcastViewerState() {
        this.viewerSocket.clients.forEach((ws) => this.sendViewerState(ws));
    }

    sendViewerState(ws) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ streams: this.viewerStreamCount, type: 'viewer-state' }));
        }
    }

    attachUpgradeHandler(httpServer, viewOnly) {
        httpServer.on('upgrade', (req, socket, head) => {
            const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

            if (viewOnly && pathname === '/display') {
                this.viewerSocket.handleUpgrade(req, socket, head, (ws) => this.viewerSocket.emit('connection', ws, req));

            } else if (!viewOnly && pathname === '/audio') {
                this.audioSocket.handleUpgrade(req, socket, head, (ws) => this.audioSocket.emit('connection', ws, req));

            } else if (!viewOnly && pathname === '/control') {
                this.controlSocket.handleUpgrade(req, socket, head, (ws) => this.controlSocket.emit('connection', ws, req));

            } else {
                socket.destroy();
            }
        });
    }

    getControlStatus() {
        return new Promise((resolve) => {
            let settled = false;

            const finish = (data) => {
                if (!settled) {
                    settled = true;
                    resolve(data || this.lastControlData);
                }
            };

            this.driver.once('data', finish);
            this.driver.write('STS');

            setTimeout(() => {
                this.driver.removeListener('data', finish);
                finish(this.lastControlData);
            }, 1000);
        });
    }
}
