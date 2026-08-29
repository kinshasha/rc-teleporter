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
import fs from 'fs';
import http from 'http';
import { spawn } from 'child_process';
import https from 'https';
import portAudio from 'naudiodon2';

export class Audio extends EventEmitter {
    constructor(ctx) {
        super();

        this.config = ctx.config.audio;

        this.retryTimer = null;
        this.injectRetryTimer = null;
        this.injectedMixer = null;
        this.injectedMixerActive = false;
        this.injectedMetadataRequest = null;
        this.injectedMetadataRetryTimer = null;
        this.injectedStreamTitle = '';
        this.streamUpdatesLogFile = ctx.streamUpdatesLogFile;
        this.stopping = false;

        this.start();
    }

    start() {
        if (this.stream) {
            return;
        }

        this.stopping = false;
        this.startInjectedMixer();

        const newStream = () => {
            let stream;

            try {
                stream = new portAudio.AudioIO({
                    inOptions: {
                        channelCount: 1,
                        closeOnError: false,
                        deviceId: this.config.deviceId,
                        sampleFormat: portAudio.SampleFormat16Bit,
                        sampleRate: this.config.sampleRate,
                    },
                });

                stream.on('data', (data) => {
                    if (this.injectedMixer?.stdin.writable) {
                        const mixerInput = this.config.injectedStream.mode === 'additionalOnly'
                            ? Buffer.alloc(data.length)
                            : data;

                        this.injectedMixer.stdin.write(mixerInput);

                        if (!this.injectedMixerActive && this.config.injectedStream.mode !== 'additionalOnly') {
                            this.emitScannerAudio(data);
                        }

                    } else {
                        this.emitScannerAudio(data);
                    }
                });

                stream.on('error', () => {
                    this.emit('status', 'Audio stream error, restarting...');

                    if (stream && typeof stream.abort === 'function') {
                        stream.abort(() => {
                            this.stream = undefined;
                            this.scheduleRetry(newStream);
                        });

                    } else {
                        this.stream = undefined;
                        this.scheduleRetry(newStream);
                    }
                });

                stream.start();

                return stream;

            } catch (error) {
                return undefined;
            }
        };

        this.stream = newStream();

        if (!this.stream) {
            this.scheduleRetry(newStream);
        }
    }

    stop() {
        this.stopping = true;

        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }

        if (this.stream) {
            this.stream.destroy();
            this.stream = undefined;
        }

        this.stopInjectedMixer();
    }

    restart() {
        this.stop();
        this.start();
    }

    setDeviceId(deviceId) {
        this.config.deviceId = deviceId;
        this.restart();
    }

    setInjectedStreamMode(mode) {
        if (mode !== 'off' && !this.config.injectedStream?.url) {
            return false;
        }

        this.config.injectedStream.mode = mode;
        this.config.injectedStream.enabled = mode !== 'off';

        if (mode === 'off') {
            this.stopInjectedMixer();
            this.emit('status', `Injected audio disabled: ${this.config.injectedStream.label}`);

        } else {
            this.startInjectedMixer();
            this.emit('status', `Injected audio mode ${mode}: ${this.config.injectedStream.label}`);
        }

        return true;
    }

    scheduleRetry(newStream) {
        if (this.retryTimer) {
            return;
        }

        this.retryTimer = setInterval(() => {
            if (this.stream) {
                clearInterval(this.retryTimer);
                this.retryTimer = null;
                return;
            }

            this.stream = newStream();

            if (this.stream) {
                clearInterval(this.retryTimer);
                this.retryTimer = null;
            }
        }, this.config.reconnectInterval);
    }

    emitScannerAudio(data) {
        const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));

        if (this.config.squelch > 0 && !samples.some((pcm) => Math.abs(pcm) >= this.config.squelch)) {
            return;
        }

        this.emit('data', toArrayBuffer(data));
    }

    getInjectedStreamLabel() {
        const injectedStream = this.config.injectedStream;

        return injectedStream?.useStreamTitle && this.injectedStreamTitle
            ? this.injectedStreamTitle
            : injectedStream?.label;
    }

    resetInjectedStreamTitle() {
        this.injectedStreamTitle = '';
    }

    startInjectedMixer() {
        const injectedStream = this.config.injectedStream;

        if (!injectedStream?.enabled || this.injectedMixer) {
            return;
        }

        const sampleRate = String(this.config.sampleRate);
        const streamUrl = formatInjectedStreamUrl(injectedStream.url);
        this.startInjectedMetadataMonitor(injectedStream.url);
        const mixer = spawn('ffmpeg', [
            '-hide_banner', '-loglevel', 'error',
            '-f', 's16le', '-ar', sampleRate, '-ac', '1', '-i', 'pipe:0',
            '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', injectedStream.url,
            '-filter_complex', `[1:a]aresample=${sampleRate},aformat=channel_layouts=mono:sample_rates=${sampleRate}[remote];[0:a][remote]amix=inputs=2:weights='1 ${injectedStream.volume}':normalize=0:dropout_transition=0[mixed]`,
            '-map', '[mixed]', '-f', 's16le', '-ar', sampleRate, '-ac', '1', 'pipe:1',
        ], { stdio: ['pipe', 'pipe', 'ignore'] });

        mixer.stdin.on('error', () => undefined);
        mixer.stdout.on('data', (data) => {
            if (!this.injectedMixerActive) {
                this.injectedMixerActive = true;
                this.emit('status', `Injected audio active: ${this.getInjectedStreamLabel()} (${streamUrl})`);
            }

            this.emit('data', toArrayBuffer(data));
        });
        mixer.on('error', (error) => this.handleInjectedMixerStop(error.message));
        mixer.on('close', (code) => this.handleInjectedMixerStop(`exit ${code ?? 'unknown'}`));

        this.injectedMixer = mixer;
        this.emit('status', `Injected audio connecting: ${this.getInjectedStreamLabel()} (${streamUrl})`);
    }

    startInjectedMetadataMonitor(streamUrl) {
        if (!this.config.injectedStream?.useStreamTitle || this.injectedMetadataRequest) {
            return;
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(streamUrl);
        } catch (error) {
            return;
        }

        const client = parsedUrl.protocol === 'https:' ? https : http;
        const request = client.get(parsedUrl, {
            headers: {
                'Icy-MetaData': '1',
                'User-Agent': 'RC Teleporter',
            },
        });

        request.on('response', (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                this.injectedMetadataRequest = null;
                this.startInjectedMetadataMonitor(new URL(response.headers.location, parsedUrl).toString());
                return;
            }

            const streamName = String(response.headers['icy-name'] || '').trim();
            if (streamName && !this.injectedStreamTitle) {
                this.updateInjectedStreamTitle(streamName, true);
            }

            const metadataInterval = Number.parseInt(response.headers['icy-metaint'], 10);

            if (!Number.isInteger(metadataInterval) || metadataInterval <= 0) {
                response.resume();
                return;
            }

            let pending = Buffer.alloc(0);
            let metadataOffset = 0;

            response.on('data', (chunk) => {
                pending = Buffer.concat([pending, chunk]);

                while (pending.length >= metadataOffset + metadataInterval + 1) {
                    const metadataLength = pending[metadataOffset + metadataInterval] * 16;
                    const metadataEnd = metadataOffset + metadataInterval + 1 + metadataLength;

                    if (pending.length < metadataEnd) {
                        break;
                    }

                    const metadata = pending.subarray(metadataOffset + metadataInterval + 1, metadataEnd).toString('utf8');
                    metadataOffset = metadataEnd;

                    this.updateInjectedStreamTitle(metadata);

                    if (metadataOffset > metadataInterval * 2) {
                        pending = pending.subarray(metadataOffset);
                        metadataOffset = 0;
                    }
                }
            });

            response.on('end', () => this.handleInjectedMetadataDisconnect(request));
            response.on('error', () => this.handleInjectedMetadataDisconnect(request));
        });

        request.on('error', () => this.handleInjectedMetadataDisconnect(request));
        this.injectedMetadataRequest = request;
    }

    handleInjectedMetadataDisconnect(request) {
        if (this.injectedMetadataRequest !== request) {
            return;
        }

        this.injectedMetadataRequest = null;
        this.scheduleInjectedMetadataRetry();
    }

    scheduleInjectedMetadataRetry() {
        if (this.stopping || !this.config.injectedStream?.enabled
            || !this.config.injectedStream?.useStreamTitle
            || this.injectedMetadataRequest || this.injectedMetadataRetryTimer) {
            return;
        }

        this.injectedMetadataRetryTimer = setTimeout(() => {
            this.injectedMetadataRetryTimer = null;
            this.startInjectedMetadataMonitor(this.config.injectedStream.url);
        }, this.config.reconnectInterval);
    }

    stopInjectedMetadataMonitor() {
        if (this.injectedMetadataRetryTimer) {
            clearTimeout(this.injectedMetadataRetryTimer);
            this.injectedMetadataRetryTimer = null;
        }

        if (this.injectedMetadataRequest) {
            this.injectedMetadataRequest.destroy();
            this.injectedMetadataRequest = null;
        }
    }

    updateInjectedStreamTitle(metadata, directTitle = false) {
        const match = metadata.match(/StreamTitle=['\"]([^'\"]*)['\"]/i);
        const title = (directTitle ? metadata : match?.[1])?.trim();

        if (!title || title === this.injectedStreamTitle) {
            return false;
        }

        this.injectedStreamTitle = title;
        if (this.streamUpdatesLogFile && title.toLowerCase() !== 'scanning') {
            fs.appendFile(this.streamUpdatesLogFile, `${new Date().toISOString()} ${title}\n`, () => undefined);
        }
        this.emit('status', `Injected stream title: ${title}`);
        return true;
    }

    stopInjectedMixer() {
        if (this.injectRetryTimer) {
            clearTimeout(this.injectRetryTimer);
            this.injectRetryTimer = null;
        }

        if (this.injectedMixer) {
            this.injectedMixer.removeAllListeners();
            this.injectedMixer.stdin.end();
            this.injectedMixer.kill();
            this.injectedMixer = null;
        }

        this.injectedMixerActive = false;
        this.stopInjectedMetadataMonitor();
    }

    handleInjectedMixerStop(reason) {
        if (!this.injectedMixer) {
            return;
        }

        this.injectedMixer = null;
        this.injectedMixerActive = false;

        if (this.stopping || !this.config.injectedStream?.enabled || this.injectRetryTimer) {
            return;
        }

        this.emit('status', `Injected audio stopped (${reason}); retrying...`);
        this.injectRetryTimer = setTimeout(() => {
            this.injectRetryTimer = null;
            this.startInjectedMixer();
        }, this.config.reconnectInterval);
    }
}

function toArrayBuffer(data) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export function formatInjectedStreamUrl(value) {
    try {
        const url = new URL(value);

        return `${url.protocol}//${url.host}${url.pathname}`;
    } catch (error) {
        return 'invalid stream URL';
    }
}
