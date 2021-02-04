import {renderInfoInitialState, calcRenderInfo, whiteSpace, buildLengthArray,
    calcInnerSize, calcCellRange, calcOffsetRange, buildStarts} from './av-grid-renderInfo';

const renderCell = data => data;

const rowCount = 100;
const columnCount = 20;
const rowHeight = 32;
const columnWidth = 120;
const gridSize = {
    width: 1900,
    height: 900,
}

const testInput = {
    renderCell,
    rowHeight: () => rowHeight,
    columnWidth: () => columnWidth,

    offset: {
        x: 0,
        y: 0
    },
    size: gridSize,
    rowCount,
    columnCount,
    stickyTop: 1,
    stickyLeft: 1,
    stickyRight: 1,
    stickyBottom: 1,
    overscanColumn: 0,
    overscanRow: 2,
    direction: {
        x: 0,
        y: 0
    },
    rerender: {
        columns: [],
        rows: [],
        cells: [],
    },
    columnLength: [],
    rowLength: [],
    scrollBarWidth: 14,
    scrollBarHeight: 14,
}

function testSpeed(getRenderInfo, getInput, maxCall = Number.MAX_VALUE){
    const testLength = 3;
    let start = new Date();
    let until = start.setSeconds(start.getSeconds() + testLength);
    let count = 0;
    let renderInfo = renderInfoInitialState;
    let input = testInput;
    let i = 0;
    while(new Date() < until){
        i++;
        if (i > maxCall){
            break;
        }
        input = getInput(input);
        renderInfo = calcRenderInfo(getRenderInfo(renderInfo), input);
        count++;
    }
    const speed = count / testLength;
    return [speed, renderInfo];
}

function displayRenderInfo(renderInfo){
    renderInfo.cells = renderInfo.cells.length;
    renderInfo.stickyTop = renderInfo.stickyTop.length;
    renderInfo.stickyLeft = renderInfo.stickyLeft.length;
    renderInfo.stickyRight = renderInfo.stickyRight.length;
    renderInfo.stickyBottom = renderInfo.stickyBottom.length;
    renderInfo.stickyTopLeft = renderInfo.stickyTopLeft.length;
    renderInfo.stickyTopRight = renderInfo.stickyTopRight.length;
    renderInfo.stickyBottomRight = renderInfo.stickyBottomRight.length;
    renderInfo.stickyBottomLeft = renderInfo.stickyBottomLeft.length;
    delete renderInfo.map;
    
    console.log(JSON.stringify(renderInfo, 0, 4));
}

const maxOffsetY = (rowCount * rowHeight) + whiteSpace - gridSize.height;

it("calc renderInfo test", () => {
    const columnLength = buildLengthArray(testInput.columnCount, testInput.columnWidth);
    const rowLength = buildLengthArray(testInput.rowCount, testInput.rowHeight);

    expect(JSON.stringify(columnLength)).toBe("[120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120]");

    const newInnerSize = calcInnerSize(
        testInput.rowCount, 
        testInput.columnCount, 
        testInput.stickyTop, 
        testInput.stickyRight, 
        testInput.stickyBottom,
        testInput.stickyLeft,
        columnLength,
        rowLength,
    );
    expect(JSON.stringify(newInnerSize, 0, 4))
.toBe(`{
    "width": 2400,
    "height": 3200,
    "stickyTopHeight": 32,
    "stickyRightWidth": 120,
    "stickyBottomHeight": 32,
    "stickyLeftWidth": 120
}`);

const newRange = calcCellRange(
    newInnerSize,
    testInput.rowCount, 
    testInput.columnCount, 
    testInput.size.width, 
    testInput.size.height, 
    testInput.offset,
    testInput.overscanColumn,
    testInput.overscanRow,
    {x: 0, y: 1}, // testInput.direction,
    columnLength,
    rowLength,
    testInput.scrollBarWidth,
    testInput.scrollBarHeight
);

expect(JSON.stringify(newRange, 0, 4))
.toBe(`{
    "visible": {
        "top": 1,
        "right": 14,
        "bottom": 26,
        "left": 1
    },
    "rendered": {
        "top": 1,
        "right": 14,
        "bottom": 28,
        "left": 1
    }
}`);

    const columnStarts = buildStarts(columnLength); 
    const rowStarts = buildStarts(rowLength);

    expect(JSON.stringify(columnStarts)).toBe(`[0,120,240,360,480,600,720,840,960,1080,1200,1320,1440,1560,1680,1800,1920,2040,2160,2280]`);

    const visibleOffset = calcOffsetRange(
        newRange.visible, 
        rowLength, 
        columnLength, 
        rowStarts, 
        columnStarts, 
        testInput.size,
        newInnerSize,
        testInput.scrollBarWidth,
        testInput.scrollBarHeight
    );

    expect(JSON.stringify(visibleOffset, 0, 4))
.toBe(`{
    "left": 0,
    "right": 34,
    "top": 0,
    "bottom": 10
}`);

});

xit('initial render speed', () => {
    const [speed, renderInfo] = testSpeed(
        info => renderInfoInitialState,
        input => input
    );

    console.log('speed:', speed);
    // displayRenderInfo(renderInfo);

    expect(speed).toBeGreaterThan(4_000);
})

xit('small scroll render speed', () => {
    let directionY = 1;
    const nextOffset = old => {
        if (directionY > 0 && old > maxOffsetY){
            directionY = -1;
        } else if (directionY < 0 && old < 0) {
            directionY = 1;
        }
        return old + directionY;
    };

    const [speed, renderInfo] = testSpeed(
        info => info,
        input => ({
            ...input,
            direction: {x: 0, y: directionY},
            offset: {x: 0, y: nextOffset(input.offset.y)}
        }),
    );

    console.log('speed:', speed);
    // displayRenderInfo(renderInfo);

    expect(speed).toBeGreaterThan(100_000);
})