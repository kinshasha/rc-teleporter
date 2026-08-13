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

import { Component, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import {
    AppRcScannerAudioDevice,
    AppRcScannerConfig,
    AppRcScannerService,
} from './rc-scanner.service';

@Component({
    selector: 'rc-scanner',
    styleUrls: ['./rc-scanner.component.scss'],
    templateUrl: './rc-scanner.component.html',
})
export class AppRcScannerComponent implements OnDestroy {
    audioDevices: AppRcScannerAudioDevice[] = [];

    audioDeviceId = -1;

    audioStatus = 'Loading audio inputs...';

    audioPanelOpen = false;

    model: string = 'unknown';

    screenWakeLockActive = false;

    screenWakeLockStatus: 'off' | 'on' | 'unavailable' = 'off';

    private screenWakeLock: {
        addEventListener?: (type: 'release', listener: () => void) => void;
        release: () => Promise<void>;
    } | undefined;

    private screenWakeLockVideo: HTMLVideoElement | undefined;

    private subscription = new Subscription();

    constructor(ngElementRef: ElementRef, private rcScannerService: AppRcScannerService) {
        this.subscription.add(this.rcScannerService.config.subscribe((config: AppRcScannerConfig) => {
            this.model = config.model || 'unknown';
            this.audioDeviceId = typeof config.audioDeviceId === 'number' ? config.audioDeviceId : -1;
        }));

        this.subscription.add(this.rcScannerService.audioStatus.subscribe((status: string) => {
            this.audioStatus = status;
        }));

        rcScannerService.rootElement = ngElementRef.nativeElement;

        this.loadAudioDevices();
    }

    @HostListener('window:beforeunload', ['$event'])
    exitNotification(event: BeforeUnloadEvent): void {
        event.preventDefault();

        event.returnValue = 'Do you really want to leave?';
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
        void this.releaseScreenWakeLock();
    }

    loadAudioDevices(): void {
        this.audioStatus = 'Loading audio inputs...';

        this.subscription.add(this.rcScannerService.getAudioDevices().subscribe({
            next: (devices) => {
                this.audioDevices = devices;

                if (devices.length > 0) {
                    this.audioStatus = 'Select the Mac input that carries scanner audio.';

                } else {
                    this.audioStatus = 'No Mac input devices were found.';
                }
            },
            error: () => {
                this.audioStatus = 'Unable to load Mac audio inputs.';
            },
        }));
    }

    selectAudioDevice(nextDeviceId: number): void {
        this.audioDeviceId = nextDeviceId;
        this.audioStatus = 'Saving audio input...';

        this.subscription.add(this.rcScannerService.setAudioDevice(nextDeviceId).subscribe({
            next: () => {
                this.audioStatus = 'Audio input saved.';
            },
            error: () => {
                this.audioStatus = 'Unable to save audio input.';
            },
        }));
    }

    refreshAudioDevices(): void {
        this.loadAudioDevices();
    }

    enableAudioPlayback(): void {
        this.audioStatus = 'Enabling audio playback...';

        this.rcScannerService.enableAudioPlayback()
            .then(() => this.audioStatus = 'Audio playback is enabled.')
            .catch(() => this.audioStatus = 'Safari blocked audio playback. Tap this button again.');
    }

    playAudioTestTone(): void {
        this.rcScannerService.playAudioTestTone()
            .then(() => this.audioStatus = 'Test tone played through the iPhone speaker.')
            .catch(() => this.audioStatus = 'Safari could not play the test tone.');
    }

    toggleAudioPanel(): void {
        this.audioPanelOpen = !this.audioPanelOpen;

        if (this.audioPanelOpen) {
            this.loadAudioDevices();
        }
    }

    async toggleScreenWakeLock(): Promise<void> {
        if (this.screenWakeLockActive) {
            await this.releaseScreenWakeLock();
            return;
        }

        const wakeLock = navigator as Navigator & {
            wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };

        if (wakeLock.wakeLock) {
            try {
                this.screenWakeLock = await wakeLock.wakeLock.request('screen');
                this.screenWakeLockActive = true;
                this.screenWakeLockStatus = 'on';
                this.screenWakeLock.addEventListener?.('release', () => {
                    this.screenWakeLock = undefined;
                    this.screenWakeLockActive = false;
                    this.screenWakeLockStatus = 'off';
                });
                return;

            } catch (error) {
                console.warn('Native screen wake lock unavailable; using media fallback.', error);
            }
        }

        try {
            await this.enableVideoScreenWakeLock();
            this.screenWakeLockActive = true;
            this.screenWakeLockStatus = 'on';

        } catch (error) {
            console.warn('Unable to keep the screen awake.', error);
            this.screenWakeLockStatus = 'unavailable';
        }
    }

    private async releaseScreenWakeLock(): Promise<void> {
        const wakeLock = this.screenWakeLock;
        this.screenWakeLock = undefined;

        if (wakeLock) {
            await wakeLock.release();
        }

        if (this.screenWakeLockVideo) {
            this.screenWakeLockVideo.pause();
            this.screenWakeLockVideo.removeAttribute('src');
            this.screenWakeLockVideo.load();
            this.screenWakeLockVideo.remove();
            this.screenWakeLockVideo = undefined;
        }

        this.screenWakeLockActive = false;
        this.screenWakeLockStatus = 'off';
    }

    private async enableVideoScreenWakeLock(): Promise<void> {
        const video = document.createElement('video');

        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = 'assets/screen-wake.mp4';
        video.className = 'screen-wake-video';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        document.body.appendChild(video);
        this.screenWakeLockVideo = video;

        try {
            // Calling play directly from the toggle tap keeps this eligible for iOS playback.
            await video.play();

        } catch (error) {
            video.remove();
            this.screenWakeLockVideo = undefined;
            throw error;
        }
    }
}
