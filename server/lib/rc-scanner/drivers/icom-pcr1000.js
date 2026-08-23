/*
 * Icom IC-PCR1000 serial control based on Hamlib's PCR backend.
 * The receiver has limited readback, so state represents last accepted commands.
 */

'use strict';

import { DriverInterface } from './interface.js';

const FREQUENCY_MIN = 10_000;
const FREQUENCY_MAX = 1_300_000_000;

const MODES = {
    am: { code: '2', filters: ['0', '1', '2', '3'] },
    cw: { code: '3', filters: ['0', '1'] },
    fm: { code: '5', filters: ['1', '2', '3'] },
    lsb: { code: '0', filters: ['0', '1'] },
    usb: { code: '1', filters: ['0', '1'] },
    wfm: { code: '6', filters: ['3', '4'] },
};

const FILTERS = new Set(['0', '1', '2', '3', '4']);

export class IcomPcr1000 extends DriverInterface {
    constructor(ctx) {
        super();

        this.com = ctx.com;
        this.state = {
            af: 64,
            agc: true,
            afc: false,
            attenuator: false,
            filter: '2',
            frequency: 145_000_000,
            mode: 'fm',
            nb: false,
            power: true,
            squelch: 0,
        };

        // PCR replies and automatic status events are exposed for diagnostics.
        this.com.on('data', (data) => this.emit('data', JSON.stringify({ raw: data.toString(), type: 'pcr1000-serial' })));
    }

    start() {
        this.publishState();
    }

    write(data) {
        const command = this.parseCommand(data);

        if (!command) {
            return;
        }

        switch (command.action) {
        case 'set-frequency':
            this.setFrequency(command.frequency);
            break;
        case 'set-mode':
            this.setMode(command.mode, command.filter);
            break;
        case 'set-level':
            this.setLevel(command.level, command.value);
            break;
        case 'set-toggle':
            this.setToggle(command.name, command.enabled);
            break;
        case 'set-power':
            this.setPower(command.enabled);
            break;
        default:
            return;
        }

        this.publishState();
    }

    parseCommand(data) {
        try {
            const command = JSON.parse(data.toString());
            return command?.type === 'pcr1000-command' ? command : null;
        } catch (error) {
            return null;
        }
    }

    setFrequency(frequency) {
        if (!Number.isInteger(frequency) || frequency < FREQUENCY_MIN || frequency > FREQUENCY_MAX) {
            return;
        }

        this.state.frequency = frequency;
        this.writeTuneCommand();
    }

    setMode(mode, filter) {
        if (!Object.hasOwn(MODES, mode) || !FILTERS.has(filter) || !MODES[mode].filters.includes(filter)) {
            return;
        }

        this.state.mode = mode;
        this.state.filter = filter;
        this.writeTuneCommand();
    }

    setLevel(level, value) {
        if (!['af', 'squelch'].includes(level) || !Number.isInteger(value) || value < 0 || value > 255) {
            return;
        }

        this.state[level] = value;
        this.com.write(`${level === 'af' ? 'J40' : 'J41'}${value.toString(16).padStart(2, '0').toUpperCase()}`);
    }

    setToggle(name, enabled) {
        const commands = {
            afc: (value) => `LD820${value ? '00' : '01'}`,
            agc: (value) => `J45${value ? '01' : '00'}`,
            attenuator: (value) => `J47${value ? '01' : '00'}`,
            nb: (value) => `J46${value ? '01' : '00'}`,
        };

        if (!Object.hasOwn(commands, name) || typeof enabled !== 'boolean') {
            return;
        }

        this.state[name] = enabled;
        this.com.write(commands[name](enabled));
    }

    setPower(enabled) {
        if (typeof enabled !== 'boolean') {
            return;
        }

        this.state.power = enabled;
        this.com.write(enabled ? 'H101' : 'H100');
    }

    writeTuneCommand() {
        const mode = MODES[this.state.mode];
        const frequency = String(this.state.frequency).padStart(10, '0');

        this.com.write(`K0${frequency}0${mode.code}0${this.state.filter}00`);
    }

    publishState() {
        this.emit('data', JSON.stringify({ ...this.state, type: 'pcr1000-state' }));
    }
}
