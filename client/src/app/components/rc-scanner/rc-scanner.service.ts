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
    injectedAudioLabel?: string;
    model: string;
    reconnectInterval: number;
    sampleRate: number;
    viewOnly?: boolean;
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

    readOnly = false;

    readonly config = new EventEmitter<AppRcScannerConfig>();

    readonly audioStatus = new EventEmitter<string>();

    readonly message = new EventEmitter<AppRcScannerMessage>();

    readonly viewerStreams = new EventEmitter<number>();

    private audioContext: AudioContext | undefined;

    private audioReady = new EventEmitter<void>();

    private audioStartTime = NaN;

    private audioFramesReceived = 0;

    private controlStatusTimer: number | undefined;

    private isPowerOn = false;

    private nativeAudio: HTMLAudioElement | undefined;

    private webRtcAudio: HTMLAudioElement | undefined;

    private webRtcPeer: RTCPeerConnection | undefined;

    private viewerWebRtcSessionId: string | undefined;

    private testToneAudio: HTMLAudioElement | undefined;

    private scannerConfig: AppRcScannerConfig | undefined;

    private wsAudio: WebSocket | undefined;

    private wsControl: WebSocket | undefined;

    private wsViewer: WebSocket | undefined;

    constructor(
        @Inject(DOCUMENT) private document: Document,
        private httpClient: HttpClient,
        private title: Title,
    ) {
        this.bootstrapAudio();

        this.getConfig();
    }

    async powerOn(): Promise<void> {
        await this.enableAudioPlayback();
    }

    async enableAudioPlayback(): Promise<void> {
        try {
            await this.openWebRtcAudioStream();

        } catch (error) {
            console.warn('WebRTC audio unavailable, using MP3 fallback.', error);
            this.audioStatus.emit('WebRTC unavailable. Using buffered MP3 audio.');
            await this.openNativeAudioStream();
        }

        if (!this.isPowerOn) {
            this.isPowerOn = true;

            if (this.readOnly) {
                this.openViewerWebSocket();

            } else {
                this.openControlWebSocket();
                this.startControlStatusFallback();
            }
        }
    }

    async playAudioTestTone(): Promise<void> {
        this.testToneAudio?.pause();
        this.testToneAudio = new Audio(this.getUrl('audio/test.wav'));
        await this.testToneAudio.play();
    }

    ngOnDestroy(): void {
        if (this.audioContext) {
            this.audioContext.close();
        }

        this.config.complete();
        this.audioStatus.complete();
        this.message.complete();
        this.viewerStreams.complete();

        if (this.wsAudio instanceof WebSocket) {
            this.wsAudio.close();
        }

        this.nativeAudio?.pause();
        this.webRtcAudio?.pause();
        this.closeViewerWebRtcSession();
        this.webRtcPeer?.close();
        this.testToneAudio?.pause();

        if (this.wsControl instanceof WebSocket) {
            this.wsControl.close();
        }

        this.closeViewerWebSocket();

        this.stopControlStatusFallback();
    }

    send(message: string): void {
        if (this.readOnly) {
            return;
        }

        if (this.wsControl && this.wsControl.readyState === 1) {
            this.wsControl.send(message);
        }
    }

    sendViewerVfoPush(): void {
        if (this.readOnly && this.wsViewer?.readyState === WebSocket.OPEN) {
            this.wsViewer.send('KEY,^,P');
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

    private closeViewerWebSocket(): void {
        if (this.wsViewer instanceof WebSocket) {
            this.wsViewer.onclose = null;
            this.wsViewer.onerror = null;
            this.wsViewer.onopen = null;

            this.wsViewer.close();

            this.wsViewer = undefined;
        }
    }

    private getConfig(): void {
        const url = this.getUrl('config');

        this.httpClient.get<AppRcScannerConfig>(url).subscribe((config) => {
            this.scannerConfig = config;
            this.readOnly = config.viewOnly === true;

            this.title.setTitle(`${this.title.getTitle()} ↔ ${this.scannerConfig.model.toUpperCase()}`);

            this.config.emit(config);

            if (this.readOnly) {
                this.isPowerOn = true;
                this.openViewerWebSocket();

            } else {
                this.bootstrapControl();
                // Display/status must not depend on a browser granting audio playback.
                this.openControlWebSocket();
                this.startControlStatusFallback();
            }
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

    private async openNativeAudioStream(): Promise<void> {
        if (!this.nativeAudio) {
            this.nativeAudio = new Audio(this.getUrl('audio.mp3'));
            this.nativeAudio.preload = 'none';
            this.nativeAudio.oncanplay = () => this.audioStatus.emit('Scanner audio buffered. Starting playback...');
            this.nativeAudio.onstalled = () => this.audioStatus.emit('Scanner audio stream is buffering...');
            this.nativeAudio.onplaying = () => this.audioStatus.emit('Playing scanner audio.');
            this.nativeAudio.onerror = () => this.audioStatus.emit('Safari could not open the scanner audio stream.');
        }

        await this.nativeAudio.play();
    }

    private async openWebRtcAudioStream(): Promise<void> {
        if (this.webRtcPeer?.connectionState === 'connected') {
            return;
        }

        if (!('RTCPeerConnection' in window)) {
            throw new Error('WebRTC is not available in this browser.');
        }

        const turn = await this.httpClient.get<{ iceServers: RTCIceServer[] }>(this.getUrl('audio/webrtc/ice')).toPromise();

        this.closeViewerWebRtcSession();
        this.webRtcPeer?.close();
        this.webRtcPeer = new RTCPeerConnection({ iceServers: turn?.iceServers || [] });
        this.webRtcPeer.addTransceiver('audio', { direction: 'recvonly' });
        this.audioStatus.emit('Connecting low-latency WebRTC audio...');

        this.webRtcPeer.ontrack = (event) => {
            if (!this.webRtcAudio) {
                this.webRtcAudio = new Audio();
                this.webRtcAudio.autoplay = true;
                this.webRtcAudio.setAttribute('playsinline', '');
                this.webRtcAudio.onplaying = () => this.audioStatus.emit('Playing low-latency scanner audio.');
            }

            this.webRtcAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
            void this.webRtcAudio.play().catch(() => this.audioStatus.emit('Tap Enable iPhone playback again to start WebRTC audio.'));
        };

        const offer = await this.webRtcPeer.createOffer();

        await this.webRtcPeer.setLocalDescription(offer);
        await this.waitForIceGathering(this.webRtcPeer);

        const answer = await this.httpClient.post<{ sdp: string; sessionId?: string; type: RTCSdpType }>(
            this.getUrl('audio/webrtc/offer'),
            { sdp: this.webRtcPeer.localDescription?.sdp },
        ).toPromise();

        if (!answer?.sdp || !answer.type) {
            throw new Error('Gateway returned an invalid WebRTC answer.');
        }

        await this.webRtcPeer.setRemoteDescription(answer);

        if (this.readOnly && typeof answer.sessionId === 'string') {
            this.viewerWebRtcSessionId = answer.sessionId;
        }
    }

    private closeViewerWebRtcSession(): void {
        const sessionId = this.viewerWebRtcSessionId;
        this.viewerWebRtcSessionId = undefined;

        if (!sessionId) {
            return;
        }

        const url = this.getUrl(`audio/webrtc/session/${encodeURIComponent(sessionId)}/close`);

        if (navigator.sendBeacon) {
            navigator.sendBeacon(url, '');

        } else {
            this.httpClient.post(url, {}).subscribe({ error: () => undefined });
        }
    }

    private waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
        if (peer.iceGatheringState === 'complete') {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const timeout = window.setTimeout(resolve, 1000);

            peer.onicegatheringstatechange = () => {
                if (peer.iceGatheringState === 'complete') {
                    window.clearTimeout(timeout);
                    resolve();
                }
            };
        });
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

    private openViewerWebSocket(): void {
        if (!this.readOnly || this.wsViewer instanceof WebSocket) {
            return;
        }

        const url = this.getUrl('display', { ws: true });

        this.wsViewer = new WebSocket(url);

        this.wsViewer.onclose = (ev: CloseEvent) => {
            this.wsViewer = undefined;
            this.message.emit({ close: true });

            if (ev.code !== 1000 && this.isPowerOn) {
                this.reconnectViewer();
            }
        };

        this.wsViewer.onerror = (ev: Event) => this.message.emit({ error: ev });

        this.wsViewer.onopen = () => {
            if (this.wsViewer instanceof WebSocket) {
                this.message.emit({ ready: true });

                this.wsViewer.onmessage = (ev: MessageEvent) => this.handleViewerMessage(ev.data);
            }
        };
    }

    private handleViewerMessage(data: unknown): void {
        if (typeof data === 'string') {
            try {
                const message = JSON.parse(data);

                if (message?.type === 'viewer-state' && Number.isInteger(message.streams)) {
                    this.viewerStreams.emit(message.streams);
                    return;
                }

            } catch (error) {
                // Scanner display frames are plain text, not JSON.
            }

            this.message.emit({ data });
        }
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

    private reconnectViewer(): void {
        this.closeViewerWebSocket();

        timer(this.scannerConfig?.reconnectInterval || 2000).subscribe(() => this.openViewerWebSocket());
    }
}
