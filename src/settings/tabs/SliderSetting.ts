/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
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
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { requireApiVersion } from 'obsidian';
import type { Setting, SliderComponent } from 'obsidian';
import { strings } from '../../i18n';
import { runAsyncAction } from '../../utils/async';

interface SliderSettingOptions {
    name: string;
    desc: string | DocumentFragment;
    value: number;
    defaultValue: number;
    min: number;
    max: number;
    step: number;
    resetTooltip?: string;
    formatValue?: (value: number) => string;
    normalizeValue?: (value: number) => number;
    onChange: (value: number) => Promise<void> | void;
}

export function formatPixelSliderValue(value: number): string {
    return `${value}px`;
}

export function formatSecondsSliderValue(value: number): string {
    return `${Number(value.toFixed(1))}s`;
}

function applyNativeSliderDisplayFormat(slider: SliderComponent, formatValue: (value: number) => string): void {
    const setDisplayFormat: unknown = Reflect.get(slider, 'setDisplayFormat');
    if (typeof setDisplayFormat === 'function') {
        Reflect.apply(setDisplayFormat, slider, [formatValue]);
    }
}

function applyLegacySliderDynamicTooltip(slider: SliderComponent): void {
    const setDynamicTooltip: unknown = Reflect.get(slider, 'setDynamicTooltip');
    if (typeof setDynamicTooltip === 'function') {
        Reflect.apply(setDynamicTooltip, slider, []);
    }
}

/** Renders settings sliders with reset control. */
export function renderSliderSetting(setting: Setting, options: SliderSettingOptions): void {
    const normalizeValue = options.normalizeValue ?? ((value: number) => value);
    const formatValue = options.formatValue ?? ((value: number) => value.toString());
    const initialValue = normalizeValue(options.value);
    const usesNativeSliderValueDisplay = requireApiVersion('1.13.0');
    let sliderComponent: SliderComponent | null = null;

    setting.setName(options.name).setDesc(options.desc);
    setting.controlEl.addClass('nn-slider-control');

    const valueEl = usesNativeSliderValueDisplay ? null : setting.controlEl.createDiv({ cls: 'nn-slider-value' });
    const updateValueLabel = (value: number) => {
        valueEl?.setText(formatValue(value));
    };

    const applyValue = (value: number) => {
        const normalizedValue = normalizeValue(value);
        updateValueLabel(normalizedValue);
        runAsyncAction(() => options.onChange(normalizedValue));
    };

    setting
        .addSlider(slider => {
            const configuredSlider = slider.setLimits(options.min, options.max, options.step).setValue(initialValue).setInstant(false);
            if (usesNativeSliderValueDisplay) {
                applyNativeSliderDisplayFormat(configuredSlider, formatValue);
            } else if (!usesNativeSliderValueDisplay) {
                applyLegacySliderDynamicTooltip(configuredSlider);
            }
            sliderComponent = configuredSlider.onChange(applyValue);
            return slider;
        })
        .addExtraButton(button =>
            button
                .setIcon('lucide-rotate-ccw')
                .setTooltip(options.resetTooltip ?? strings.common.restoreDefault)
                .onClick(() => {
                    if (!sliderComponent) {
                        return;
                    }
                    const defaultValue = normalizeValue(options.defaultValue);
                    sliderComponent.setValue(defaultValue);
                    applyValue(defaultValue);
                })
        );

    updateValueLabel(initialValue);
}
