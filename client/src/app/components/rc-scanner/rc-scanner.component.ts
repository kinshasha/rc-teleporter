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
import { APP_VERSION } from '../../version';

@Component({
    selector: 'rc-scanner',
    styleUrls: ['./rc-scanner.component.scss'],
    templateUrl: './rc-scanner.component.html',
})
export class AppRcScannerComponent implements OnDestroy {
    readonly appVersion = APP_VERSION;

    audioDevices: AppRcScannerAudioDevice[] = [];

    audioDeviceId = -1;

    audioStatus = 'Loading audio inputs...';

    audioPanelOpen = false;

    model: string = 'unknown';

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
}
