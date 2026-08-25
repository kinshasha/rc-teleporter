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

import { spawn } from 'child_process';
import naudiodon from 'naudiodon2';
import wrtc from '@roamhq/wrtc';

import { unknown } from './models.js';

export class Config {
    constructor(app) {
        const config = app.config.rcScanner;

        this.viewerSessions = new Map();
        this.activeFallbackStreams = 0;
        this.activeWebRtcStreams = 0;

        this.audio = {
            deviceId: typeof config?.audio?.deviceId === 'number'
                ? config.audio.deviceId
                : parseInt(process.env.RC_AUDIO_DEVICE_ID, 10) || -1,
            reconnectInterval: typeof config?.audio?.reconnectInterval === 'number'
                ? config.audio.reconnectInterval
                : parseInt(process.env.RC_AUDIO_RECONNECT_INTERVAL, 10) || 2000,
            sampleRate: typeof config?.audio?.sampleRate === 'number'
                ? config.audio.sampleRate
                : parseInt(process.env.RC_AUDIO_SAMPLE_RATE, 10) || 44100,
            squelch: typeof config?.audio?.squelch === 'number'
                ? config.audio.squelch
                : parseInt(process.env.RC_AUDIO_SQUELCH, 10) || 100,
        };

        this.com = {
            baudRate: typeof config?.com?.baudRate === 'number'
                ? config.com.baudRate
                : parseInt(process.env.RC_COM_BAUDRATE, 10) || 115200,
            dataBits: typeof config?.com?.dataBits === 'number'
                ? config.com.dataBits
                : parseInt(process.env.RC_COM_DATABITS, 10) || 8,
            parity: typeof config?.com?.parity === 'string'
                ? config.com.parity
                : process.env.RC_COM_PARITY || 'none',
            pollingInterval: typeof config?.com?.pollingInterval === 'number'
                ? config.com.pollingInterval
                : parseInt(process.env.RC_COM_POLLING_INTERVAL, 10) || 500,
            port: typeof config?.com?.port === 'string'
                ? config.com.port
                : process.env.RC_COM_PORT || (
                    process.platform === 'darwin'
                        ? 'auto'
                        : process.platform === 'win32'
                            ? 'com1'
                            : '/dev/ttyACM0'
                ),
            reconnectInterval: typeof config?.com?.reconnectInterval === 'number'
                ? config.com.reconnectInterval
                : parseInt(process.env.RC_RECONNECT_INTERVAL, 10) || 5000,
            rtscts: String(config?.com?.rtscts || '').toLowerCase() === 'true'
                ? true
                : (process.env.RC_COM_RTSCTS || '').toLowerCase() === 'true' ? true : false,
            stopBits: typeof config?.com?.stopBits === 'number'
                ? config.com.stopBits
                : parseInt(process.env.RC_COM_STOPBITS, 10) || 1,
            terminator: typeof config?.com?.terminator === 'string'
                ? config.com.terminator
                : process.env.RC_COM_TERMINATOR || '\r',
        };

        this.hideSerialNumber = typeof config?.hideSerialNumber === 'boolean'
            ? config.hideSerialNumber
            : (process.env.RC_HIDE_SERIAL_NUMBER || '').toLowerCase() === 'true' ? true : false;

        this.model = typeof config?.model === 'string' && config.model.length
            ? config.model.toLowerCase()
            : process.env.RC_MODEL || unknown;

        this.webSocket = {
            keepAlive: typeof config?.webSocket?.keepAlive === 'number'
                ? config.webSocket.keepAlive
                : parseInt(process.env.RC_WEBSOCKET_KEEP_ALIVE, 10) || 30000,
            reconnectInterval: typeof config?.webSocket?.reconnectInterval === 'number'
                ? config.webSocket.reconnectInterval
                : parseInt(process.env.RC_WEBSOCKET_RECONNECT_INTERVAL, 10) || 2000,
        };

        app.router.get('/config', (req, res) => {
            res.send({
                audioDeviceId: this.audio.deviceId,
                model: this.model,
                reconnectInterval: this.webSocket.reconnectInterval,
                sampleRate: this.audio.sampleRate,
            });
        });

        app.router.get('/audio/devices', (req, res) => {
            const devices = naudiodon.getDevices()
                .filter((device) => Number(device.maxInputChannels) > 0)
                .map((device) => ({
                    defaultSampleRate: device.defaultSampleRate,
                    hostAPIName: device.hostAPIName,
                    id: device.id,
                    maxInputChannels: device.maxInputChannels,
                    name: device.name,
                }));

            res.send(devices);
        });

        app.router.get('/audio.wav', (req, res) => {
            const audio = app.rcScanner?.audio;

            if (!audio) {
                return res.status(503).send({ error: 'Audio input is unavailable' });
            }

            res.set({
                'Cache-Control': 'no-store',
                'Content-Type': 'audio/wav',
                'Transfer-Encoding': 'chunked',
            });

            res.write(createWavHeader(this.audio.sampleRate));

            const audioHandler = (data) => {
                if (!res.writableEnded && !res.destroyed) {
                    res.write(Buffer.from(data));
                }
            };

            audio.on('data', audioHandler);

            const close = () => audio.removeListener('data', audioHandler);

            req.on('close', close);
            res.on('close', close);
            res.on('error', close);
        });

        app.router.get('/audio.mp3', (req, res) => {
            const audio = app.rcScanner?.audio;

            if (!audio) {
                return res.status(503).send({ error: 'Audio input is unavailable' });
            }

            const clientAddress = getClientAddress(req);

            this.activeFallbackStreams++;
            logFallback(`[audio 3000] MP3 fallback connected from ${clientAddress} (${this.activeFallbackStreams} active)`);

            const encoder = spawn('ffmpeg', [
                '-hide_banner', '-loglevel', 'error',
                '-f', 's16le', '-ar', String(this.audio.sampleRate), '-ac', '1', '-i', 'pipe:0',
                '-c:a', 'libmp3lame', '-b:a', '64k', '-flush_packets', '1', '-f', 'mp3', 'pipe:1',
            ], { stdio: ['pipe', 'pipe', 'ignore'] });

            res.set({
                'Cache-Control': 'no-store',
                'Content-Type': 'audio/mpeg',
                'Transfer-Encoding': 'chunked',
            });

            encoder.stdout.pipe(res);

            const audioHandler = (data) => {
                if (encoder.stdin.writable && !res.writableEnded && !res.destroyed) {
                    encoder.stdin.write(Buffer.from(data));
                }
            };

            audio.on('data', audioHandler);

            let closed = false;

            const close = () => {
                if (closed) {
                    return;
                }

                closed = true;
                audio.removeListener('data', audioHandler);
                encoder.stdin.end();
                encoder.kill();
                this.activeFallbackStreams = Math.max(0, this.activeFallbackStreams - 1);
                logEvent(`[audio 3000] MP3 fallback disconnected from ${clientAddress} (${this.activeFallbackStreams} active)`);
            };

            req.on('close', close);
            res.on('close', close);
            encoder.on('error', () => res.end());
        });

        this.registerWebRtcRoutes(app.router, app, false);

        app.router.get('/audio/test.wav', (req, res) => {
            const sampleRate = 44100;
            const samples = Math.round(sampleRate * 0.25);
            const pcm = Buffer.alloc(samples * 2);

            for (let i = 0; i < samples; i++) {
                const value = Math.round(Math.sin((2 * Math.PI * 880 * i) / sampleRate) * 8192);
                pcm.writeInt16LE(value, i * 2);
            }

            res.set({
                'Cache-Control': 'no-store',
                'Content-Type': 'audio/wav',
            });
            res.send(Buffer.concat([createWavHeader(sampleRate, pcm.length), pcm]));
        });

        app.router.get('/status', async (req, res) => {
            const status = await app.rcScanner?.ws?.getControlStatus();

            res.setHeader('Cache-Control', 'no-store');

            if (typeof status !== 'string' || status.length === 0) {
                return res.status(503).send({ error: 'Scanner status is unavailable' });
            }

            return res.type('text/plain').send(status);
        });

        app.router.post('/audio/device', (req, res) => {
            const deviceId = Number.parseInt(req.body?.deviceId, 10);
            const devices = naudiodon.getDevices().filter((device) => Number(device.maxInputChannels) > 0);

            if (!Number.isInteger(deviceId)) {
                return res.status(400).send({ error: 'Invalid deviceId' });
            }

            if (deviceId !== -1 && !devices.some((device) => device.id === deviceId)) {
                return res.status(400).send({ error: 'Unknown audio device' });
            }

            if (this.audio.deviceId === deviceId) {
                return res.send({ deviceId });
            }

            this.audio.deviceId = deviceId;

            if (app.rcScanner?.audio?.setDeviceId instanceof Function) {
                app.rcScanner.audio.setDeviceId(deviceId);
            }

            app.saveConfig();

            return res.send({ deviceId });
        });

        if (app.viewerRouter) {
            app.viewerRouter.get('/config', (req, res) => {
                res.setHeader('Cache-Control', 'no-store');
                return res.send({
                    model: this.model,
                    reconnectInterval: this.webSocket.reconnectInterval,
                    sampleRate: this.audio.sampleRate,
                    viewOnly: true,
                });
            });

            this.registerWebRtcRoutes(app.viewerRouter, app, true);
        }
    }

    registerWebRtcRoutes(router, app, viewOnly) {
        if (viewOnly) {
            router.post('/audio/webrtc/session/:sessionId/close', (req, res) => {
                const close = this.viewerSessions.get(req.params.sessionId);

                if (!close) {
                    return res.status(404).end();
                }

                close();
                return res.status(204).end();
            });
        }

        router.get('/audio/webrtc/ice', async (req, res) => {
            const iceServers = await getIceServers();

            res.setHeader('Cache-Control', 'no-store');
            return res.send({ iceServers });
        });

        router.post('/audio/webrtc/offer', async (req, res) => {
            const audio = app.rcScanner?.audio;
            const offer = req.body?.sdp;
            const port = viewOnly ? app.config.nodejs.viewer.port : app.config.nodejs.port;
            const clientAddress = getClientAddress(req);

            if (!audio || typeof offer !== 'string' || offer.length === 0) {
                return res.status(400).send({ error: 'A WebRTC offer and audio input are required' });
            }

            const iceServers = await getIceServers();

            const peer = new wrtc.RTCPeerConnection({ iceServers });
            const source = new wrtc.nonstandard.RTCAudioSource();
            const track = source.createTrack();
            let closed = false;
            let streamTracked = false;
            let viewerSessionId;
            let viewerStreamTracked = false;

            peer.addTrack(track);

            const audioHandler = createWebRtcAudioHandler(source, this.audio.sampleRate);

            audio.on('data', audioHandler);

            const close = () => {
                if (closed) {
                    return;
                }

                closed = true;
                audio.removeListener('data', audioHandler);
                track.stop();
                peer.close();

                if (streamTracked) {
                    this.activeWebRtcStreams = Math.max(0, this.activeWebRtcStreams - 1);
                    logEvent(`[audio ${port}] WebRTC disconnected from ${clientAddress} (${this.activeWebRtcStreams} active)`);
                }

                if (viewerStreamTracked) {
                    app.rcScanner?.ws?.removeViewerStream();
                }

                if (viewerSessionId) {
                    this.viewerSessions.delete(viewerSessionId);
                }
            };

            const closeIfStopped = () => {
                if (['closed', 'failed', 'disconnected'].includes(peer.connectionState)) {
                    close();
                }
            };

            peer.onconnectionstatechange = closeIfStopped;
            peer.oniceconnectionstatechange = closeIfStopped;

            try {
                await peer.setRemoteDescription(new wrtc.RTCSessionDescription({ type: 'offer', sdp: offer }));
                const answer = await peer.createAnswer();

                await peer.setLocalDescription(answer);
                await waitForIceGathering(peer);

                streamTracked = true;
                this.activeWebRtcStreams++;
                logEvent(`[audio ${port}] WebRTC connected from ${clientAddress} (${this.activeWebRtcStreams} active)`);

                if (viewOnly && !viewerStreamTracked) {
                    viewerStreamTracked = true;
                    viewerSessionId = crypto.randomUUID();
                    this.viewerSessions.set(viewerSessionId, close);
                    app.rcScanner?.ws?.addViewerStream();
                }

                return res.send({
                    sdp: peer.localDescription?.sdp,
                    sessionId: viewerSessionId,
                    type: peer.localDescription?.type,
                });

            } catch (error) {
                close();
                logEvent(`[audio ${port}] WebRTC failed for ${clientAddress}: ${error.message || 'unknown error'}`, true);
                return res.status(500).send({ error: error.message || 'Unable to establish WebRTC audio' });
            }
        });
    }
}

function createWebRtcAudioHandler(source, inputSampleRate) {
    const outputSampleRate = 48000;
    let pending = new Int16Array(0);

    return (data) => {
        const input = new Int16Array(data);
        const outputLength = Math.floor((input.length * outputSampleRate) / inputSampleRate);
        const resampled = new Int16Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            resampled[i] = input[Math.min(input.length - 1, Math.floor((i * inputSampleRate) / outputSampleRate))];
        }

        const combined = new Int16Array(pending.length + resampled.length);

        combined.set(pending);
        combined.set(resampled, pending.length);

        let offset = 0;

        while (combined.length - offset >= 480) {
            const samples = combined.slice(offset, offset + 480);

            source.onData({
                bitsPerSample: 16,
                channelCount: 1,
                numberOfFrames: 480,
                sampleRate: outputSampleRate,
                samples,
            });

            offset += 480;
        }

        pending = combined.slice(offset);
    };
}

function waitForIceGathering(peer) {
    if (peer.iceGatheringState === 'complete') {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(resolve, 1000);

        peer.onicegatheringstatechange = () => {
            if (peer.iceGatheringState === 'complete') {
                clearTimeout(timeout);
                resolve();
            }
        };
    });
}

async function getTurnIceServers() {
    const keyId = getEnvSecret('CF_TURN_KEY_ID');
    const apiToken = getEnvSecret('CF_TURN_API_TOKEN');

    if (!keyId || !apiToken) {
        return [];
    }

    const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
            body: JSON.stringify({ ttl: 3600 }),
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            method: 'POST',
        },
    );

    if (!response.ok) {
        throw new Error(`Cloudflare TURN credential request failed (${response.status})`);
    }

    const payload = await response.json();

    return Array.isArray(payload?.iceServers)
        ? payload.iceServers.map((server) => ({
            ...server,
            urls: Array.isArray(server.urls)
                ? server.urls.filter((url) => !String(url).includes(':53'))
                : server.urls,
        }))
        : [];
}

function getEnvSecret(name) {
    return (process.env[name] || '').trim().replace(/^['"]+|['"]+$/g, '');
}

function getClientAddress(req) {
    const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
    const address = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0].trim();

    return address || req.socket?.remoteAddress || 'unknown';
}

function logEvent(message, warning = false) {
    console[warning ? 'warn' : 'log'](`${new Date().toISOString()} ${message}`);
}

function logFallback(message) {
    console.warn(formatFallbackLog(message));
}

export function formatFallbackLog(message, timestamp = new Date().toISOString()) {
    return `\x1b[31m${timestamp} ${message}\x1b[0m`;
}

async function getIceServers() {
    try {
        return await getTurnIceServers();
    } catch (error) {
        // Keep local WebRTC working if the optional external TURN key is stale.
        logEvent(`Cloudflare TURN unavailable; using direct WebRTC: ${error.message}`, true);
        return [{ urls: 'stun:stun.cloudflare.com:3478' }];
    }
}

function createWavHeader(sampleRate, dataLength = 0xffffffff) {
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(Math.min(0xffffffff, 36 + dataLength), 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
}
