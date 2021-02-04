import {prepareRerender} from './av-grid-rerender-check';

export const renderInfoInitialState = {
    visible: {top: 0, right: 0, bottom: 0, left: 0},
    rendered: {top: 0, right: 0, bottom: 0, left: 0},
    visibleOffset: {top: 0, right: 0, bottom: 0, left: 0},
    innerSize: {
        width: 0, 
        height: 0,
        stickyTopHeight: 0,
        stickyRightWidth: 0,
        stickyBottomHeight: 0,
        stickyLeftWidth: 0,
    },
    columnLength: [],
    rowLength: [],
    columnStarts: [],
    rowStarts: [],
    input: {
        size: {width: 0, height: 0},
        rowCount: 0,
        columnCount: 0,
        stickyTop: 0,
        stickyRight: 0, 
        stickyBottom: 0,
        stickyLeft: 0,
        scrollBarWidth: 0,
        scrollBarHeight: 0,
    },

    cells: [],
    stickyTop: [],
    stickyLeft: [],
    stickyRight: [],
    stickyBottom: [],
    stickyTopLeft: [],
    stickyTopRight: [],
    stickyBottomRight: [],
    stickyBottomLeft: [],
    map: {},
}

export const whiteSpace = 20;

export function buildLengthArray(elementCount, elementLength){
    return typeof elementLength === 'number' 
        ? elementLength
        : Array.from({length: elementCount}, (v, i) => elementLength(i));
}

export function buildStarts(length){
    if (typeof length === 'number'){
        return length;
    }

    const starts = [...length];
    starts.forEach((_, i) => {
        starts[i] = i === 0
            ? 0
            : starts[i - 1] + length[i - 1];
    })

    return starts;
}

function calcLength(length, from, count = 1){
    if (typeof length === 'number'){
        return count * length;
    }

    let res = 0;
    for (let i = from; i < from + count; i++){
        res += length[i];
    }
    return res;
}

function getLength(length, elementIndex){
    return (typeof length === 'number') ? length : length[elementIndex];
}

function getStarts(starts, elementIndex){
    if (typeof starts === 'number'){
        return elementIndex * starts;
    }
    return starts[elementIndex];
}

function elementAt(length, x, lastByDefault = true){
    if (typeof length === 'number'){
        return Math.trunc(x / length);
    }

    let res = lastByDefault ? length.length - 1 : -1;
    let sum = 0;
    for (let i = 0; i < length.length; i++){
        sum += length[i];
        if (sum > x){
            res = i;
            break;
        }
    }
    return res;
}

export const calcInnerSize = (
    rowCount, 
    columnCount, 
    stickyTop, 
    stickyRight, 
    stickyBottom,
    stickyLeft,
    columnLength,
    rowLength,
) => ({
    width: calcLength(columnLength, 0, columnCount) + (stickyRight ? 0 : whiteSpace),
    height: calcLength(rowLength, 0, rowCount) + (stickyBottom ? 0 : whiteSpace),
    stickyTopHeight: calcLength(rowLength, 0, stickyTop),
    stickyRightWidth: calcLength(columnLength, columnCount - stickyRight, stickyRight),
    stickyBottomHeight: calcLength(rowLength, rowCount - stickyBottom, stickyBottom),
    stickyLeftWidth: calcLength(columnLength, 0, stickyLeft),
})

export function calcCellRange(
    innerSize,
    rowCount, 
    columnCount, 
    width, 
    height, 
    offset,
    overscanColumn,
    overscanRow,
    direction,
    columnLength,
    rowLength,
    scrollBarWidth,
    scrollBarHeight
){
    let left = elementAt(columnLength, offset.x + innerSize.stickyLeftWidth);
    let right = elementAt(columnLength, offset.x + width - innerSize.stickyRightWidth - scrollBarWidth);
    left = Math.max(0, left);
    right = Math.min(right, columnCount - 1);

    let top = elementAt(rowLength, offset.y + innerSize.stickyTopHeight);
    let bottom = elementAt(rowLength, offset.y + height - innerSize.stickyBottomHeight - scrollBarHeight);
    top = Math.max(0, top);
    bottom = Math.min(bottom, rowCount - 1);

    const rendered = {
        top: direction.y < 0 ? Math.max(0, top - overscanRow) : top,
        right: direction.x > 0 ? Math.min(columnCount - 1, right + overscanColumn) : right,
        bottom: direction.y > 0 ? Math.min(rowCount - 1, bottom + overscanRow) : bottom,
        left: direction.x < 0 ? Math.max(0, left - overscanColumn) : left,
    }

    return {
        visible: {top, right, bottom, left},
        rendered,
    };
}

export const calcOffsetRange = (
    cellsRange, 
    rowLength, 
    columnLength, 
    rowStarts, 
    columnStarts, 
    size, 
    innerSize,
    scrollBarWidth,
    scrollBarHeight
) => ({
    left: getStarts(columnStarts, cellsRange.left) - innerSize.stickyLeftWidth,
    right: calcLength(columnLength, 0, cellsRange.right + 1) - (size.width - innerSize.stickyRightWidth - scrollBarWidth),
    top: getStarts(rowStarts, cellsRange.top) - innerSize.stickyTopHeight,
    bottom: calcLength(rowLength, 0, cellsRange.bottom + 1) - (size.height - innerSize.stickyBottomHeight - scrollBarHeight),
})

const _renderCell = (renderData, row, col, startRow = 0, startCol = 0) => {
    const {
        renderCell, 
        old, 
        newInfo, 
        rerender,
        rowLength,
        columnLength,
        rowStarts,
        columnStarts,
    } = renderData;

    const key = `${row}_${col}`;
    let cell = old.map[key];
    if (!cell || 
        (rerender && 
            (rerender.cells[key] || rerender.columns[col] || rerender.rows[row])
        )
    ) 
    {
        cell = renderCell({
            col, 
            row, 
            style: {
                display: 'inline-block',
                position: 'absolute',
                left: startCol ? calcLength(columnLength, startCol, col - startCol) : getStarts(columnStarts, col),
                width: getLength(columnLength, col),
                top: startRow ? calcLength(rowLength, startRow, row - startRow) : getStarts(rowStarts, row),
                height: getLength(rowLength, row),
            }, 
            key
        });
    }
    newInfo.map[key] = cell;
    return cell;
};

export function calcRenderInfo(old, input) {
    const {
        offset, 
        size,
        rowCount, 
        columnCount, 
        rowHeight, 
        columnWidth, 
        renderCell,
        stickyTop = 0, 
        stickyLeft = 0, 
        stickyRight = 0,
        stickyBottom = 0,
        overscanColumn,
        overscanRow,
        scrollBarWidth,
        scrollBarHeight,
        direction = {x: 0, y: 0},
    } = input;

    let {
        rerender,
    } = input;

    if (direction.x || direction.y){
        //check rendered scroll offset
        if (offset.x >= old.visibleOffset.left &&
            offset.x <= old.visibleOffset.right &&
            offset.y >= old.visibleOffset.top &&
            offset.y <= old.visibleOffset.bottom)
        {
            return old;
        }
    }

    const columnLength = buildLengthArray(columnCount, columnWidth);
    const rowLength = buildLengthArray(rowCount, rowHeight);

    const newInnerSize = calcInnerSize(
        rowCount, 
        columnCount, 
        stickyTop, 
        stickyRight, 
        stickyBottom,
        stickyLeft,
        columnLength,
        rowLength,
    );

    const newRange = calcCellRange(
        newInnerSize,
        rowCount, 
        columnCount, 
        size.width, 
        size.height, 
        offset,
        overscanColumn,
        overscanRow,
        direction,
        columnLength,
        rowLength,
        scrollBarWidth,
        scrollBarHeight
    );

    if (old.rendered.top || old.rendered.bottom){
        rerender = prepareRerender(rerender, old, input, columnLength, rowLength);
        if  (!rerender &&
            newRange.visible.left >= old.visible.left && 
            newRange.visible.right <= old.visible.right && 
            newRange.visible.top >= old.visible.top &&
            newRange.visible.bottom <= old.visible.bottom &&
            newInnerSize.width === old.innerSize.width && 
            newInnerSize.height === old.innerSize.height &&
            newInnerSize.stickyTopHeight === old.innerSize.stickyTopHeight &&
            newInnerSize.stickyRightWidth === old.innerSize.stickyRightWidth &&
            newInnerSize.stickyBottomHeight === old.innerSize.stickyBottomHeight &&
            newInnerSize.stickyLeftWidth === old.innerSize.stickyLeftWidth)
        {
            return old;
        }
    } else {
        rerender = null;
    }

    const columnStarts = buildStarts(columnLength); 
    const rowStarts = buildStarts(rowLength);

    newRange.visibleOffset = calcOffsetRange(
        newRange.visible, 
        rowLength, 
        columnLength, 
        rowStarts, 
        columnStarts, 
        size,
        newInnerSize,
        scrollBarWidth,
        scrollBarHeight
    );

    const newInfo = {
        ...newRange,
        innerSize: newInnerSize,
        columnLength,
        rowLength,
        columnStarts,
        rowStarts,
        input: {
            size,
            rowCount,
            columnCount,
            stickyTop, 
            stickyRight, 
            stickyBottom,
            stickyLeft,
            scrollBarWidth,
            scrollBarHeight,
        },

        cells: [],
        stickyTop: [],
        stickyLeft: [],
        stickyRight: [],
        stickyBottom: [],
        stickyTopLeft: [],
        stickyTopRight: [],
        stickyBottomRight: [],
        stickyBottomLeft: [],
        map: {}
    }   

    const rd = {
        renderCell, 
        old, 
        newInfo, 
        rerender,
        rowLength,
        columnLength,
        rowStarts,
        columnStarts,
    };

    for (let r = newInfo.rendered.top; r <= newInfo.rendered.bottom; r++){
        for (let c = newInfo.rendered.left; c <= newInfo.rendered.right; c++){
            if (r < stickyTop || c < stickyLeft || 
                r >= (rowCount - stickyBottom) || 
                c >= (columnCount - stickyRight))
            {
                continue;
            }
            newInfo.cells.push(_renderCell(rd, r, c));
        }
    }

    //sticky top
    for (let r = 0; r < stickyTop; r++){
        for (let c = 0; c < stickyLeft; c++){
            newInfo.stickyTopLeft.push(_renderCell(rd, r, c));
        }
        for (let c = Math.max(stickyLeft, newInfo.rendered.left); c <= Math.min(newInfo.rendered.right, columnCount - stickyRight - 1); c++){
            newInfo.stickyTop.push(_renderCell(rd, r, c));
        }
        for (let c = (columnCount - stickyRight); c < columnCount; c++){
            newInfo.stickyTopRight.push(_renderCell(rd, r, c, 0, columnCount - stickyRight));
        }
    }

    //sticky bottom
    for (let r = rowCount - stickyBottom; r < rowCount; r++){
        for (let c = 0; c < stickyLeft; c++){
            newInfo.stickyBottomLeft.push(_renderCell(rd, r, c, rowCount - stickyBottom, 0));
        }
        for (let c = Math.max(stickyLeft, newInfo.rendered.left); c <= Math.min(newInfo.rendered.right, columnCount - stickyRight - 1); c++){
            newInfo.stickyBottom.push(_renderCell(rd, r, c, rowCount - stickyBottom, 0));
        }
        for (let c = (columnCount - stickyRight); c < columnCount; c++){
            newInfo.stickyBottomRight.push(_renderCell(rd, r, c, rowCount - stickyBottom, columnCount - stickyRight));
        }
    }

    //sticky left and right
    for (let r = Math.max(stickyTop, newInfo.rendered.top); r <= Math.min(newInfo.rendered.bottom, rowCount - stickyBottom - 1); r++){
        for (let c = 0; c < stickyLeft; c++){
            newInfo.stickyLeft.push(_renderCell(rd, r, c, stickyTop, 0));
        }
        for (let c = (columnCount - stickyRight); c < columnCount; c++){
            newInfo.stickyRight.push(_renderCell(rd, r, c, stickyTop,  columnCount - stickyRight));
        }
    }

    return newInfo;
}

export function calcScrollOffsetX(col, renderInfo, currOffset){
    const cell = {
        left: getStarts(renderInfo.columnStarts, col),
        right: calcLength(renderInfo.columnLength, 0, col + 1),
    }

    const size = renderInfo.input.size;
    let res = {...currOffset};

    const visibleWidth = size.width - renderInfo.innerSize.stickyRightWidth - renderInfo.input.scrollBarWidth;
    if (res.x + visibleWidth < cell.right){
        res.x = cell.right - visibleWidth;
    } else if (res.x > cell.left - renderInfo.innerSize.stickyLeftWidth){
        res.x = cell.left - renderInfo.innerSize.stickyLeftWidth;
    }

    return res;
}

export function calcScrollOffsetY(row, renderInfo, currOffset){
    const cell = {
        top: getStarts(renderInfo.rowStarts, row),
        bottom: calcLength(renderInfo.rowLength, 0, row + 1),
    }

    const size = renderInfo.input.size;
    let res = {...currOffset};

    const visibleHeight = size.height - renderInfo.innerSize.stickyBottomHeight - renderInfo.input.scrollBarHeight
    if (res.y + visibleHeight < cell.bottom){
        res.y = cell.bottom - visibleHeight;
    } else if (res.y > cell.top - renderInfo.innerSize.stickyTopHeight){
        res.y = cell.top - renderInfo.innerSize.stickyTopHeight;
    }

    return res;
}

export function calcScrollOffset(row, col, renderInfo, currOffset){
    return calcScrollOffsetY(row, renderInfo, calcScrollOffsetX(col, renderInfo, currOffset));
}