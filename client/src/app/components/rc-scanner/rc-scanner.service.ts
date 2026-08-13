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

import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { EventEmitter, Inject, Injectable, OnDestroy } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { timer } from 'rxjs';

declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

export interface AppRcScannerConfig {
    audioDeviceId: number;
    model: string;
    reconnectInterval: number;
    sampleRate: number;
}

export interface AppRcScannerAudioDevice {
    defaultSampleRate: number;
    hostAPIName: string;
    id: number;
    maxInputChannels: number;
    name: string;
}

export interface AppRcScannerMessage {
    close?: boolean;
    data?: string;
    error?: Event;
    ready?: boolean;
}

@Injectable({
    providedIn: 'root',
})
export class AppRcScannerService implements OnDestroy {
    rootElement: HTMLElement = this.document.documentElement;

    readonly config = new EventEmitter<AppRcScannerConfig>();

    readonly audioStatus = new EventEmitter<string>();

    readonly message = new EventEmitter<AppRcScannerMessage>();

    private audioContext: AudioContext | undefined;

    private audioReady = new EventEmitter<void>();

    private audioStartTime = NaN;

    private audioFramesReceived = 0;

    private controlStatusTimer: number | undefined;

    private isPowerOn = false;

    private scannerConfig: AppRcScannerConfig | undefined;

    private wsAudio: WebSocket | undefined;

    private wsControl: WebSocket | undefined;

    constructor(
        @Inject(DOCUMENT) private document: Document,
        private httpClient: HttpClient,
        private title: Title,
    ) {
        this.bootstrapAudio();

        this.bootstrapControl();

        this.getConfig();
    }

    async powerOn(): Promise<void> {
        await this.enableAudioPlayback();
    }

    async enableAudioPlayback(): Promise<void> {
        const audioContext = this.getAudioContext();

        // iOS needs an actual source to start during the user gesture, not just resume().
        const unlockBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
        const unlockSource = audioContext.createBufferSource();
        unlockSource.buffer = unlockBuffer;
        unlockSource.connect(audioContext.destination);
        unlockSource.start();

        await audioContext.resume();

        if (!this.isPowerOn) {
            this.isPowerOn = true;

            this.openAudioWebSocket();

            this.openControlWebSocket();

            this.startControlStatusFallback();

        } else if (!(this.wsAudio instanceof WebSocket)) {
            this.openAudioWebSocket();
        }
    }

    async playAudioTestTone(): Promise<void> {
        const audioContext = this.getAudioContext();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.frequency.value = 880;
        gain.gain.value = 0.08;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.2);

        await this.enableAudioPlayback();
    }

    ngOnDestroy(): void {
        if (this.audioContext) {
            this.audioContext.close();
        }

        this.config.complete();
        this.audioStatus.complete();
        this.message.complete();

        if (this.wsAudio instanceof WebSocket) {
            this.wsAudio.close();
        }

        if (this.wsControl instanceof WebSocket) {
            this.wsControl.close();
        }

        this.stopControlStatusFallback();
    }

    send(message: string): void {
        if (this.wsControl && this.wsControl.readyState === 1) {
            this.wsControl.send(message);
        }
    }

    toggleFullscreen(): void {
        if (this.document.fullscreenElement) {
            const el: {
                exitFullscreen?: () => void;
                mozCancelFullScreen?: () => void;
                msExitFullscreen?: () => void;
                webkitExitFullscreen?: () => void;
            } = this.document;

            if (el.exitFullscreen) {
                el.exitFullscreen();
            } else if (el.mozCancelFullScreen) {
                el.mozCancelFullScreen();
            } else if (el.msExitFullscreen) {
                el.msExitFullscreen();
            } else if (el.webkitExitFullscreen) {
                el.webkitExitFullscreen();
            }

        } else {
            const el: {
                requestFullscreen?: () => void;
                mozRequestFullScreen?: () => void;
                msRequestFullscreen?: () => void;
                webkitRequestFullscreen?: () => void;
            } = this.rootElement || this.document;

            if (el.requestFullscreen) {
                el.requestFullscreen();
            } else if (el.mozRequestFullScreen) {
                el.mozRequestFullScreen();
            } else if (el.msRequestFullscreen) {
                el.msRequestFullscreen();
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            }
        }
    }

    private bootstrapAudio(): void {
        const events = ['keydown', 'mousedown', 'pointerdown', 'touchstart'];

        const bootstrap = async () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    latencyHint: 'balanced',
                    sampleRate: this.scannerConfig?.sampleRate,
                });
            }

            if (this.audioContext) {
                const resume = () => {
                    if (this.audioContext?.state === 'suspended') {
                        this.audioContext.resume().then(() => resume());
                    }
                };

                events.forEach((event) => this.document.body.removeEventListener(event, bootstrap));

                await this.audioContext.resume();

                this.audioContext.onstatechange = () => resume();

                timer(500).subscribe(() => this.audioReady.complete());
            }
        };

        events.forEach((event) => this.document.body.addEventListener(event, bootstrap));
    }

    private bootstrapControl(): void {
        ['pageshow', 'focus', 'blur', 'visibilitychange', 'resume'].forEach((event) => {
            this.document.addEventListener(event, () => {
                if (this.isPowerOn) {
                    if (this.document.hidden) {
                        this.closeControlWebSocket();

                    } else if (!(this.wsControl instanceof WebSocket)) {
                        this.openControlWebSocket();
                    }
                }
            });
        });
    }

    private closeAudioWebSocket(): void {
        if (this.wsAudio instanceof WebSocket) {
            this.wsAudio.onclose = null;
            this.wsAudio.onerror = null;
            this.wsAudio.onopen = null;

            this.wsAudio.close();

            this.wsAudio = undefined;
        }
    }

    private closeControlWebSocket(): void {
        if (this.wsControl instanceof WebSocket) {
            this.wsControl.onclose = null;
            this.wsControl.onerror = null;
            this.wsControl.onopen = null;

            this.wsControl.close();

            this.wsControl = undefined;
        }
    }

    private getConfig(): void {
        const url = this.getUrl('config');

        this.httpClient.get<AppRcScannerConfig>(url).subscribe((config) => {
            this.scannerConfig = config;

            this.title.setTitle(`${this.title.getTitle()} ↔ ${this.scannerConfig.model.toUpperCase()}`);

            this.config.emit(config);
        });
    }

    getAudioDevices() {
        return this.httpClient.get<AppRcScannerAudioDevice[]>(this.getUrl('audio/devices'));
    }

    setAudioDevice(deviceId: number) {
        return this.httpClient.post<{ deviceId: number }>(this.getUrl('audio/device'), { deviceId });
    }

    private getUrl(path: string, options: { ws?: boolean } = {}): string {
        const url = new URL(path.replace(/^\//, ''), `${window.location.origin}/`);

        if (options.ws) {
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        }

        return url.toString();
    }

    private openAudioWebSocket(): void {
        const url = this.getUrl('audio', { ws: true });

        this.audioStartTime = this.audioContext ? this.audioContext.currentTime : 0;

        this.wsAudio = new WebSocket(url);

        this.audioStatus.emit('Connecting to scanner audio...');

        this.wsAudio.binaryType = 'arraybuffer';

        this.wsAudio.onclose = (ev: CloseEvent) => {
            this.audioStatus.emit(`Scanner audio disconnected (${ev.code}). Retrying...`);

            if (ev.code !== 1000) {
                this.reconnectAudio();
            }
        };

        this.wsAudio.onerror = () => this.audioStatus.emit('Safari could not open the scanner audio stream.');

        this.wsAudio.onopen = () => {
            if (this.wsAudio instanceof WebSocket) {
                this.audioFramesReceived = 0;
                this.audioStatus.emit('Connected. Waiting for scanner audio...');

                this.wsAudio.onmessage = (ev: MessageEvent) => this.playAudioFrame(ev.data);
            }
        };
    }

    private async playAudioFrame(data: unknown): Promise<void> {
        if (!this.audioContext || !this.scannerConfig) {
            return;
        }

        try {
            const arrayBuffer = await this.toAudioArrayBuffer(data);

            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                this.audioStatus.emit('Received an unreadable scanner audio frame.');
                return;
            }

            if (this.audioFramesReceived === 0) {
                this.audioStatus.emit(`Decoding ${arrayBuffer.byteLength} bytes of scanner audio...`);
            }

            const arrayBufferView = new Int16Array(arrayBuffer);
            const audioBuffer = this.audioContext.createBuffer(1, arrayBufferView.length, this.scannerConfig.sampleRate);
            const audioChannel = audioBuffer.getChannelData(0);
            const audioSource = this.audioContext.createBufferSource();

            for (let i = 0; i < arrayBufferView.length; i++) {
                audioChannel[i] = arrayBufferView[i] / 32768;
            }

            audioSource.buffer = audioBuffer;
            audioSource.connect(this.audioContext.destination);

            const scheduledStart = Number.isFinite(this.audioStartTime)
                ? this.audioStartTime
                : this.audioContext.currentTime;

            this.audioStartTime = Math.max(this.audioContext.currentTime, scheduledStart);
            audioSource.start(this.audioStartTime);
            this.audioStartTime += audioBuffer.duration;

            this.audioFramesReceived++;

            if (this.audioFramesReceived === 1) {
                this.audioStatus.emit('Receiving scanner audio.');
            }

        } catch (error) {
            console.warn('Unable to play scanner audio.', error);
            const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
            this.audioStatus.emit(`Safari audio error${detail}`);
        }
    }

    private toAudioArrayBuffer(data: unknown): Promise<ArrayBuffer | null> {
        if (data instanceof ArrayBuffer) {
            return Promise.resolve(data);
        }

        if (!(data instanceof Blob)) {
            return Promise.resolve(null);
        }

        // FileReader works on older iOS releases that lack Blob.arrayBuffer().
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onerror = () => reject(reader.error || new Error('Unable to read audio frame.'));
            reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? reader.result : null);
            reader.readAsArrayBuffer(data);
        });
    }

    private getAudioContext(): AudioContext {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'balanced',
                sampleRate: this.scannerConfig?.sampleRate,
            });
        }

        return this.audioContext;
    }

    private openControlWebSocket(): void {
        const url = this.getUrl('control', { ws: true });

        this.wsControl = new WebSocket(url);

        this.wsControl.onclose = (ev: CloseEvent) => {
            if (ev.code !== 1000) {
                this.reconnectControl();
            }

            this.message.emit({ close: true });

            this.startControlStatusFallback();
        };

        this.wsControl.onerror = (ev: Event) => this.message.emit({ error: ev });

        this.wsControl.onopen = () => {
            if (this.wsControl instanceof WebSocket) {
                this.message.emit({ ready: true });

                this.wsControl.onmessage = (ev: MessageEvent) => {
                    this.stopControlStatusFallback();
                    this.message.emit({ data: ev.data });
                };
            }
        };
    }

    private startControlStatusFallback(): void {
        if (this.controlStatusTimer !== undefined) {
            return;
        }

        const poll = () => {
            this.httpClient.get(this.getUrl('status'), { responseType: 'text' }).subscribe({
                next: (data) => this.message.emit({ data }),
                error: () => undefined,
            });
        };

        poll();
        this.controlStatusTimer = window.setInterval(poll, 1000);
    }

    private stopControlStatusFallback(): void {
        if (this.controlStatusTimer !== undefined) {
            window.clearInterval(this.controlStatusTimer);
            this.controlStatusTimer = undefined;
        }
    }

    private reconnectAudio(): void {
        this.closeAudioWebSocket();

        timer(this.scannerConfig?.reconnectInterval || 2000).subscribe(() => this.openAudioWebSocket());
    }

    private reconnectControl(): void {
        this.closeControlWebSocket();

        timer(this.scannerConfig?.reconnectInterval || 2000).subscribe(() => this.openControlWebSocket());
    }
}
