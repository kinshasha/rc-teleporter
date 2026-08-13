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
import portAudio from 'naudiodon2';

export class Audio extends EventEmitter {
    constructor(ctx) {
        super();

        this.config = ctx.config.audio;

        this.retryTimer = null;

        this.start();
    }

    start() {
        if (this.stream) {
            return;
        }

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
                    if (this.config.squelch > 0) {
                        const array = new Int16Array(data.buffer);

                        if (array.some((pcm) => Math.abs(pcm) >= this.config.squelch)) {
                            this.emit('data', data.buffer);
                        }

                    } else {
                        this.emit('data', data.buffer);
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
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }

        if (this.stream) {
            this.stream.destroy();
            this.stream = undefined;
        }
    }

    restart() {
        this.stop();
        this.start();
    }

    setDeviceId(deviceId) {
        this.config.deviceId = deviceId;
        this.restart();
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
}
