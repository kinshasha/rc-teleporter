import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppRcScannerMessage, AppRcScannerService } from '../../rc-scanner.service';

type Mode = 'am' | 'cw' | 'fm' | 'lsb' | 'usb' | 'wfm';

interface Pcr1000State {
    af: number;
    afc: boolean;
    agc: boolean;
    attenuator: boolean;
    filter: string;
    frequency: number;
    mode: Mode;
    nb: boolean;
    power: boolean;
    squelch: number;
    type: 'pcr1000-state';
}

const FILTERS: Record<Mode, string[]> = {
    am: ['0', '1', '2', '3'],
    cw: ['0', '1'],
    fm: ['1', '2', '3'],
    lsb: ['0', '1'],
    usb: ['0', '1'],
    wfm: ['3', '4'],
};

@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    selector: 'rc-scanner-pcr1000',
    styleUrls: ['./pcr1000.component.scss'],
    templateUrl: './pcr1000.component.html',
})
export class AppRcScannerPcr1000Component implements OnDestroy, OnInit {
    readonly filters = FILTERS;

    readonly modes: Mode[] = ['am', 'cw', 'fm', 'lsb', 'usb', 'wfm'];

    readonly readOnly: boolean;

    frequencyText = '145.000.000';

    linked = false;

    state: Pcr1000State = {
        af: 64,
        afc: false,
        agc: true,
        attenuator: false,
        filter: '2',
        frequency: 145_000_000,
        mode: 'fm',
        nb: false,
        power: true,
        squelch: 0,
        type: 'pcr1000-state',
    };

    private subscription = new Subscription();

    constructor(private changeDetector: ChangeDetectorRef, private rcScannerService: AppRcScannerService) {
        this.readOnly = rcScannerService.readOnly;
    }

    ngOnInit(): void {
        this.subscription.add(this.rcScannerService.message.subscribe((message: AppRcScannerMessage) => {
            if (typeof message.data !== 'string') {
                return;
            }

            try {
                const state = JSON.parse(message.data) as Pcr1000State;

                if (state.type === 'pcr1000-state') {
                    this.state = state;
                    this.frequencyText = this.formatFrequency(state.frequency);
                    this.linked = true;
                    this.changeDetector.markForCheck();
                }
            } catch (error) {
                // Raw PCR serial diagnostics are intentionally not rendered as receiver state.
            }
        }));
    }

    ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    enable(): void {
        void this.rcScannerService.powerOn();
    }

    setFrequency(): void {
        const frequency = Number(this.frequencyText.replace(/[^0-9]/g, ''));
        this.send({ action: 'set-frequency', frequency });
    }

    setMode(mode: Mode): void {
        const filter = this.filters[mode].includes(this.state.filter) ? this.state.filter : this.filters[mode][0];
        this.send({ action: 'set-mode', filter, mode });
    }

    setFilter(filter: string): void {
        this.send({ action: 'set-mode', filter, mode: this.state.mode });
    }

    setLevel(level: 'af' | 'squelch', event: Event): void {
        const value = Number((event.target as HTMLInputElement).value);
        this.send({ action: 'set-level', level, value });
    }

    toggle(name: 'afc' | 'agc' | 'attenuator' | 'nb'): void {
        this.send({ action: 'set-toggle', enabled: !this.state[name], name });
    }

    togglePower(): void {
        this.send({ action: 'set-power', enabled: !this.state.power });
    }

    private formatFrequency(frequency: number): string {
        return frequency.toLocaleString('en-AU').replace(/,/g, '.');
    }

    private send(command: Record<string, unknown>): void {
        if (!this.readOnly) {
            this.rcScannerService.send(JSON.stringify({ ...command, type: 'pcr1000-command' }));
        }
    }
}
