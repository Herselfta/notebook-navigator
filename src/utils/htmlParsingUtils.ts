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

import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { mergeRanges, type NumericRange } from './arrayUtils';

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlParentNode = DefaultTreeAdapterMap['parentNode'];
type HtmlElement = DefaultTreeAdapterMap['element'];
type HtmlTemplate = DefaultTreeAdapterMap['template'];

interface HtmlSourceLocation {
    startOffset: number;
    endOffset: number;
}

const RAW_TEXT_HTML_TAG_NAMES = new Set(['script', 'style']);

function hasChildNodes(node: HtmlNode): node is HtmlParentNode {
    return 'childNodes' in node;
}

function hasTagName(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node;
}

function hasTemplateContent(node: HtmlNode): node is HtmlTemplate {
    return hasTagName(node) && node.tagName === 'template' && 'content' in node;
}

function addSourceRange(ranges: NumericRange[], location: HtmlSourceLocation | null | undefined): void {
    if (!location || location.startOffset >= location.endOffset) {
        return;
    }

    ranges.push({
        start: location.startOffset,
        end: location.endOffset
    });
}

function collectChildRanges(node: HtmlNode, ranges: NumericRange[], collect: (node: HtmlNode, ranges: NumericRange[]) => void): void {
    if (hasTemplateContent(node)) {
        node.content.childNodes.forEach(child => collect(child, ranges));
    }

    if (hasChildNodes(node)) {
        node.childNodes.forEach(child => collect(child, ranges));
    }
}

function collectHtmlTagRanges(node: HtmlNode, ranges: NumericRange[]): void {
    if (hasTagName(node)) {
        addSourceRange(ranges, node.sourceCodeLocation?.startTag);
        addSourceRange(ranges, node.sourceCodeLocation?.endTag);
    }

    collectChildRanges(node, ranges, collectHtmlTagRanges);
}

function collectHtmlPreviewRemovalRanges(node: HtmlNode, ranges: NumericRange[]): void {
    if (hasTagName(node)) {
        const location = node.sourceCodeLocation;
        if (RAW_TEXT_HTML_TAG_NAMES.has(node.tagName)) {
            addSourceRange(ranges, location);
            return;
        }

        addSourceRange(ranges, location?.startTag);
        addSourceRange(ranges, location?.endTag);
    } else if (node.nodeName === '#comment' || node.nodeName === '#documentType') {
        addSourceRange(ranges, node.sourceCodeLocation);
    }

    collectChildRanges(node, ranges, collectHtmlPreviewRemovalRanges);
}

function replaceRangesWithSpaces(text: string, ranges: readonly NumericRange[]): string {
    const mergedRanges = mergeRanges(ranges);
    if (mergedRanges.length === 0) {
        return text;
    }

    let cursor = 0;
    let result = '';

    for (const range of mergedRanges) {
        if (range.start > cursor) {
            result += text.slice(cursor, range.start);
        }

        result += ' ';
        cursor = range.end;
    }

    if (cursor < text.length) {
        result += text.slice(cursor);
    }

    return result;
}

export function findHtmlTagRanges(text: string): NumericRange[] {
    if (!text.includes('<')) {
        return [];
    }

    const fragment = parseFragment(text, { sourceCodeLocationInfo: true });
    const ranges: NumericRange[] = [];
    collectHtmlTagRanges(fragment, ranges);
    return mergeRanges(ranges);
}

export function stripHtmlForPreview(text: string): string {
    if (!text.includes('<')) {
        return text;
    }

    const fragment = parseFragment(text, { sourceCodeLocationInfo: true });
    const ranges: NumericRange[] = [];
    collectHtmlPreviewRemovalRanges(fragment, ranges);
    return replaceRangesWithSpaces(text, ranges);
}
