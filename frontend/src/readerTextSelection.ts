export type TextRange = {
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
};

export type SelectionLayout = {
  rects: Array<{ top: number; left: number; width: number; height: number }>;
  startHandle: { x: number; y: number; height: number };
  endHandle: { x: number; y: number; height: number };
  toolbar: { top: number; left: number; width: number };
};

const SELECTION_TOOLBAR_HEIGHT = 44;
const SELECTION_TOOLBAR_GAP = 8;

export function rangeKey(chapterId: string, range: TextRange) {
  const normalized = normalizeRange(range);
  return `${chapterId}:${normalized.startParagraphIndex}:${normalized.startOffset}:${normalized.endParagraphIndex}:${normalized.endOffset}`;
}

export function compareRangePoints(
  aParagraphIndex: number,
  aOffset: number,
  bParagraphIndex: number,
  bOffset: number
) {
  if (aParagraphIndex !== bParagraphIndex) {
    return aParagraphIndex - bParagraphIndex;
  }
  return aOffset - bOffset;
}

export function normalizeRange(range: TextRange): TextRange {
  const order = compareRangePoints(
    range.startParagraphIndex,
    range.startOffset,
    range.endParagraphIndex,
    range.endOffset
  );

  if (order <= 0) {
    return range;
  }

  return {
    startParagraphIndex: range.endParagraphIndex,
    startOffset: range.endOffset,
    endParagraphIndex: range.startParagraphIndex,
    endOffset: range.startOffset
  };
}

export function getParagraphElement(bookPage: HTMLElement, paragraphIndex: number) {
  return bookPage.querySelector<HTMLElement>(`[data-paragraph-index="${paragraphIndex}"]`);
}

function getTextNodesInElement(element: HTMLElement) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  return nodes;
}

export function getParagraphLength(element: HTMLElement) {
  return getTextNodesInElement(element).reduce((total, node) => total + node.length, 0);
}

function offsetToDomPosition(element: HTMLElement, offset: number) {
  const nodes = getTextNodesInElement(element);
  let remaining = offset;

  for (const node of nodes) {
    if (remaining <= node.length) {
      return { node, offset: remaining };
    }
    remaining -= node.length;
  }

  const lastNode = nodes[nodes.length - 1];
  return { node: lastNode, offset: lastNode?.length ?? 0 };
}

function domPositionToOffset(element: HTMLElement, targetNode: Node, nodeOffset: number) {
  const nodes = getTextNodesInElement(element);
  let offset = 0;

  for (const node of nodes) {
    if (node === targetNode) {
      return offset + nodeOffset;
    }
    offset += node.length;
  }

  return offset;
}

export function createDomRange(bookPage: HTMLElement, range: TextRange) {
  const normalized = normalizeRange(range);
  const startElement = getParagraphElement(bookPage, normalized.startParagraphIndex);
  const endElement = getParagraphElement(bookPage, normalized.endParagraphIndex);

  if (!startElement || !endElement) {
    return null;
  }

  const startPosition = offsetToDomPosition(startElement, normalized.startOffset);
  const endPosition = offsetToDomPosition(endElement, normalized.endOffset);
  const domRange = document.createRange();

  domRange.setStart(startPosition.node, startPosition.offset);
  domRange.setEnd(endPosition.node, endPosition.offset);
  return domRange;
}

function caretRangeFromPoint(clientX: number, clientY: number) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(clientX, clientY);
  }

  const caretPositionFromPoint = (
    document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    }
  ).caretPositionFromPoint;

  if (!caretPositionFromPoint) {
    return null;
  }

  const position = caretPositionFromPoint(clientX, clientY);
  if (!position) {
    return null;
  }

  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function clampOffset(element: HTMLElement, offset: number) {
  return Math.max(0, Math.min(offset, getParagraphLength(element)));
}

export function getCaretPointFromPointer(
  bookPage: HTMLElement,
  clientX: number,
  clientY: number,
  paragraphCount: number
) {
  const caretRange = caretRangeFromPoint(clientX, clientY);

  if (caretRange) {
    for (let paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex += 1) {
      const paragraphElement = getParagraphElement(bookPage, paragraphIndex);
      if (!paragraphElement?.contains(caretRange.startContainer)) {
        continue;
      }

      return {
        paragraphIndex,
        offset: clampOffset(
          paragraphElement,
          domPositionToOffset(paragraphElement, caretRange.startContainer, caretRange.startOffset)
        )
      };
    }
  }

  let fallbackParagraphIndex = 0;

  for (let paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex += 1) {
    const paragraphElement = getParagraphElement(bookPage, paragraphIndex);
    if (!paragraphElement) {
      continue;
    }

    const rect = paragraphElement.getBoundingClientRect();
    if (clientY >= rect.top) {
      fallbackParagraphIndex = paragraphIndex;
    }
  }

  const paragraphElement = getParagraphElement(bookPage, fallbackParagraphIndex);
  if (!paragraphElement) {
    return null;
  }

  const rect = paragraphElement.getBoundingClientRect();
  if (clientY <= rect.top) {
    return { paragraphIndex: fallbackParagraphIndex, offset: 0 };
  }

  if (clientY >= rect.bottom) {
    return {
      paragraphIndex: fallbackParagraphIndex,
      offset: getParagraphLength(paragraphElement)
    };
  }

  const caretAtLine = caretRangeFromPoint(clientX, Math.min(Math.max(clientY, rect.top + 1), rect.bottom - 1));
  if (!caretAtLine) {
    return { paragraphIndex: fallbackParagraphIndex, offset: 0 };
  }

  return {
    paragraphIndex: fallbackParagraphIndex,
    offset: clampOffset(
      paragraphElement,
      domPositionToOffset(paragraphElement, caretAtLine.startContainer, caretAtLine.startOffset)
    )
  };
}

export function getTextFromRange(
  paragraphs: Array<Array<{ text: string }>>,
  range: TextRange
) {
  const normalized = normalizeRange(range);
  const parts: string[] = [];

  for (
    let paragraphIndex = normalized.startParagraphIndex;
    paragraphIndex <= normalized.endParagraphIndex;
    paragraphIndex += 1
  ) {
    const paragraphText = paragraphs[paragraphIndex].map((segment) => segment.text).join('');
    const startOffset =
      paragraphIndex === normalized.startParagraphIndex ? normalized.startOffset : 0;
    const endOffset =
      paragraphIndex === normalized.endParagraphIndex
        ? normalized.endOffset
        : paragraphText.length;

    parts.push(paragraphText.slice(startOffset, endOffset));
  }

  return parts.join('');
}

function getCaretClientRect(range: Range | null) {
  if (!range) {
    return null;
  }

  const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
  if (rects.length > 0) {
    return rects[0];
  }

  const boundingRect = range.getBoundingClientRect();
  if (boundingRect.height <= 0) {
    return null;
  }

  return boundingRect;
}

export function computeSelectionLayout(bookPage: HTMLElement, range: TextRange): SelectionLayout | null {
  const normalized = normalizeRange(range);
  const domRange = createDomRange(bookPage, normalized);

  if (!domRange) {
    return null;
  }

  const pageRect = bookPage.getBoundingClientRect();
  const rawRects = Array.from(domRange.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  const visibleRects = rawRects.filter((rect, rectIndex) => {
    return !rawRects.some((candidate, candidateIndex) => {
      if (candidateIndex === rectIndex) return false;

      const tolerance = 0.75;
      const containsRect =
        candidate.left <= rect.left + tolerance &&
        candidate.top <= rect.top + tolerance &&
        candidate.right >= rect.right - tolerance &&
        candidate.bottom >= rect.bottom - tolerance;
      if (!containsRect) return false;

      const sameGeometry =
        Math.abs(candidate.left - rect.left) <= tolerance &&
        Math.abs(candidate.top - rect.top) <= tolerance &&
        Math.abs(candidate.right - rect.right) <= tolerance &&
        Math.abs(candidate.bottom - rect.bottom) <= tolerance;

      return !sameGeometry || candidateIndex < rectIndex;
    });
  });
  const rects = visibleRects
    .map((rect) => ({
      top: rect.top - pageRect.top,
      left: rect.left - pageRect.left,
      width: rect.width,
      height: rect.height
    }));

  const startRange = createDomRange(bookPage, {
    startParagraphIndex: normalized.startParagraphIndex,
    startOffset: normalized.startOffset,
    endParagraphIndex: normalized.startParagraphIndex,
    endOffset: normalized.startOffset
  });
  const endRange = createDomRange(bookPage, {
    startParagraphIndex: normalized.endParagraphIndex,
    startOffset: normalized.endOffset,
    endParagraphIndex: normalized.endParagraphIndex,
    endOffset: normalized.endOffset
  });

  const startRect = getCaretClientRect(startRange);
  const endRect = getCaretClientRect(endRange);

  if (!startRect || !endRect) {
    return null;
  }

  const endLineRects = endRange ? Array.from(endRange.getClientRects()).filter((rect) => rect.height > 0) : [];
  const endLineRect = endLineRects[endLineRects.length - 1] ?? endRect;

  const boundsLeft = rects.reduce((min, rect) => Math.min(min, rect.left), rects[0]?.left ?? 0);
  const boundsRight = rects.reduce(
    (max, rect) => Math.max(max, rect.left + rect.width),
    rects[0] ? rects[0].left + rects[0].width : 0
  );
  const toolbarWidth = Math.max(boundsRight - boundsLeft, 168);
  const toolbarLeft = boundsLeft + (boundsRight - boundsLeft) / 2 - toolbarWidth / 2;
  const toolbarTop = Math.max(
    0,
    (rects[0]?.top ?? startRect.top - pageRect.top) - SELECTION_TOOLBAR_HEIGHT - SELECTION_TOOLBAR_GAP
  );

  return {
    rects,
    startHandle: {
      x: startRect.left - pageRect.left,
      y: startRect.top - pageRect.top,
      height: startRect.height
    },
    endHandle: {
      x: endLineRect.right - pageRect.left,
      y: endLineRect.top - pageRect.top,
      height: endLineRect.height
    },
    toolbar: {
      top: toolbarTop,
      left: toolbarLeft,
      width: toolbarWidth
    }
  };
}
