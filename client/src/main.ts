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

import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

if (environment.production) {
    enableProdMode();
}

async function clearStaleServiceWorkers(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    try {
        const registrations = await navigator.serviceWorker.getRegistrations();

        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
            const keys = await caches.keys();

            await Promise.all(keys.map((key) => caches.delete(key)));
        }

    } catch (error) {
        console.warn('Unable to clear stale service workers.', error);
    }
}

const boot = window as Window & {
    __rcScannerBoot?: {
        fail: (message: string) => void;
        ready: () => void;
    };
};

platformBrowserDynamic()
    .bootstrapModule(AppModule)
    .then(() => boot.__rcScannerBoot?.ready())
    .catch((err) => {
        console.error(err);
        boot.__rcScannerBoot?.fail(err instanceof Error ? err.message : 'Angular failed to start.');
    });

void clearStaleServiceWorkers();
