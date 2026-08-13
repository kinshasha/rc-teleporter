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

import naudiodon from 'naudiodon2';

import { unknown } from './models.js';

export class Config {
    constructor(app) {
        const config = app.config.rcScanner;

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
            rtscts: (config?.com?.rtscts || '').toLowerCase() === 'true'
                ? true
                : (process.env.RC_COM_RTSCTS || '').toLowerCase() === 'true' ? true : false,
            stopBits: typeof config?.com?.stopBits === 'number'
                ? config.com.stopBits
                : parseInt(process.env.RC_COM_STOPBITS, 10) || 1,
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

            const audioHandler = (data) => res.write(data);

            audio.on('data', audioHandler);
            req.on('close', () => audio.removeListener('data', audioHandler));
        });

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
