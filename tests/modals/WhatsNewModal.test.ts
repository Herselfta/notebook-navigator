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

import { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { WhatsNewModal } from '../../src/modals/WhatsNewModal';

interface CreateElementOptions {
    cls?: string | string[];
    text?: string;
}

interface WhatsNewModalFormatter {
    renderFormattedText(container: TestElement, text: string): void;
    renderInfoText(container: TestElement, text: string): void;
}

class TestText {
    constructor(readonly text: string) {}

    toMarkup(): string {
        return this.text;
    }
}

class TestElement {
    private attributes = new Map<string, string>();
    private children: (TestElement | TestText)[] = [];
    private classes: string[] = [];

    constructor(readonly tagName = 'div') {}

    appendText(text: string): void {
        this.children.push(new TestText(text));
    }

    createEl(tagName: string, options: CreateElementOptions = {}): TestElement {
        const child = new TestElement(tagName);
        child.applyOptions(options);
        this.children.push(child);
        return child;
    }

    createSpan(options: CreateElementOptions = {}): TestElement {
        const child = new TestElement('span');
        child.applyOptions(options);
        this.children.push(child);
        return child;
    }

    setAttr(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    toMarkup(): string {
        return this.children.map(child => (child instanceof TestText ? child.toMarkup() : child.toElementMarkup())).join('');
    }

    private applyOptions(options: CreateElementOptions): void {
        if (options.cls) {
            this.classes = Array.isArray(options.cls) ? options.cls : [options.cls];
        }

        if (options.text) {
            this.appendText(options.text);
        }
    }

    private formatAttributes(): string {
        const attributes = [...this.attributes.entries()];
        if (this.classes.length > 0) {
            attributes.unshift(['class', this.classes.join(' ')]);
        }

        if (attributes.length === 0) {
            return '';
        }

        return ` ${attributes.map(([name, value]) => `${name}="${value}"`).join(' ')}`;
    }

    private toElementMarkup(): string {
        if (this.tagName === 'br') {
            return '<br>';
        }

        return `<${this.tagName}${this.formatAttributes()}>${this.toMarkup()}</${this.tagName}>`;
    }
}

function createFormatter(): WhatsNewModalFormatter {
    return new WhatsNewModal(new App(), []) as unknown as WhatsNewModalFormatter;
}

describe('WhatsNewModal formatting', () => {
    it('renders newline and br markers as line breaks', () => {
        const formatter = createFormatter();
        const container = new TestElement();

        formatter.renderFormattedText(container, 'First\nSecond<br/>Third<br>Fourth\r\nFifth');

        expect(container.toMarkup()).toBe('First<br>Second<br>Third<br>Fourth<br>Fifth');
    });

    it('renders blank lines as separate info paragraphs', () => {
        const formatter = createFormatter();
        const container = new TestElement();

        formatter.renderInfoText(container, 'First **paragraph**\nwrapped\n\nSecond ==paragraph==');

        expect(container.toMarkup()).toBe(
            '<p class="nn-whats-new-info">First <strong>paragraph</strong><br>wrapped</p><p class="nn-whats-new-info">Second <span class="nn-highlight">paragraph</span></p>'
        );
    });

    it('renders consecutive br markers as separate info paragraphs', () => {
        const formatter = createFormatter();
        const container = new TestElement();

        formatter.renderInfoText(container, 'First paragraph<br/><br>Second paragraph');

        expect(container.toMarkup()).toBe(
            '<p class="nn-whats-new-info">First paragraph</p><p class="nn-whats-new-info">Second paragraph</p>'
        );
    });
});
