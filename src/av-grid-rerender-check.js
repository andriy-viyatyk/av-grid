const range = (left, right) => Array.from({length: right - left + 1}, (_, i) => left + i);

const  markStickyLeftDirty = (rerender, input) => range(0, input.stickyLeft - 1)
    .forEach(i => rerender.columns[i] = true);

const markStickyRightDirty = (rerender, input) => range(input.columnCount - input.stickyRight, input.columnCount - 1)
    .forEach(i => rerender.columns[i] = true);

const markStickyTopDirty = (rerender, input) => range(0, input.stickyTop - 1)
    .forEach(i => rerender.rows[i] = true);

const markStickyBottomDirty = (rerender, input) => range(1, input.stickyBottom)
    .forEach(i => rerender.rows[input.rowCount - i] = true);

const markStickyTopDiffDirty = (rerender, old, input) => 
    range(Math.min(old.input.stickyTop, input.stickyTop) + 1, Math.max(old.input.stickyTop, input.stickyTop))
    .forEach(i => rerender.rows[i - 1] = true);

const markStickyBottomDiffDirty = (rerender, old, input) => range(1, Math.max(old.input.stickyBottom, input.stickyBottom))
    .forEach(i => rerender.rows[input.rowCount - i] = true);

const markStickyLeftDiffDirty = (rerender, old, input) =>
    range(Math.min(old.input.stickyLeft, input.stickyLeft) + 1, Math.max(old.input.stickyLeft, input.stickyLeft))
    .forEach(i => rerender.columns[i - 1] = true);

const markStickyRightDiffDirty = (rerender, old, input) => range(1, Math.max(old.input.stickyRight, input.stickyRight))
    .forEach(i => rerender.columns[input.columnCount - i] = true);

function markVisibleColumnDirty(rerender, old, input){
    range(old.rendered.left, old.rendered.right).forEach(i => rerender.columns[i] = true);
    markStickyLeftDirty(rerender, input);
    markStickyRightDirty(rerender, input);
}

function markVisibleRowDirty(rerender, old, input){
    for (let i = old.rendered.top; i <= old.rendered.bottom; i++){
        rerender.rows[i] = true;
    }
    markStickyTopDirty(rerender, input);
    markStickyBottomDirty(rerender, input);
}

function markDirtyWidth(rerender, old, columnLength){
    let res = false;

    let dirtyIndex = old.columnLength.findIndex((oldLength, idx) => oldLength !== columnLength[idx]);
    if (dirtyIndex < 0){
        return false;
    }

    if (dirtyIndex < old.rendered.right){
        range(Math.max(dirtyIndex, old.rendered.left), old.rendered.right).forEach(i => rerender.columns[i] = true);
        res = true;
    }
    if (dirtyIndex < old.input.stickyLeft){
        markStickyLeftDirty(rerender, old.input);
        res = true;
    }
    if (old.input.stickyRight && dirtyIndex <= old.input.columnCount - old.input.stickyRight){
        markStickyRightDirty(rerender, old.input);
        res = true;
    }
    
    return res;
}

function markDirtyHeight(rerender, old, rowLength){
    let res = false;

    let dirtyIndex = old.rowLength.findIndex((oldLength, idx) => oldLength !== rowLength[idx]);
    if (dirtyIndex < 0){
        return false;
    }

    if (dirtyIndex < old.rendered.bottom){
        range(Math.max(dirtyIndex, old.rendered.top), old.rendered.bottom).forEach(i => rerender.rows[i] = true);
        res = true;
    }
    if (dirtyIndex < old.input.stickyTop){
        markStickyTopDirty(rerender, old.input);
        res = true;
    }
    if (old.input.stickyBottom && dirtyIndex <= old.input.rowCount - old.input.stickyBottom){
        markStickyBottomDirty(rerender, old.input);
        res = true;
    }
    
    return res;
}

export function prepareRerender(rerender, old, input, columnLength, rowLength){
    let res;
    let empty;

    if (!rerender){
        res = {
            rows: {},
            columns: {},
            cells: {}
        }
        empty = true;
    } else {
        const rows = (rerender.rows || []).filter(r => r >= old.rendered.top && r <= old.rendered.bottom);
        const columns = (rerender.columns || []).filter(c => c >= old.rendered.left && c <= old.rendered.right);
        const cells = (rerender.cells || [])
            .filter(({row, col}) => row >= old.rendered.top && row <= old.rendered.bottom &&
                col >= old.rendered.left && col <= old.rendered.right
            );

        empty = !(rows.length || columns.length || cells.length);
        res = {
            rows: rows.reduce((acc, r) => {acc[r] = true; return acc}, {}),
            columns: columns.reduce((acc, c) => {acc[c] = true; return acc}, {}),
            cells: cells.reduce((acum, {row, col}) => {
                acum[`${row}_${col}`] = true;
                return acum;
            }, {}),
        }
    }

    if (old.input.stickyTop !== input.stickyTop){
        markStickyTopDiffDirty(res, old, input);
        markStickyLeftDirty(res, input);
        markStickyRightDirty(res, input);
        empty = false;
    }

    if (old.input.stickyBottom !== input.stickyBottom){
        markStickyBottomDiffDirty(res, old, input);
        empty = false;
    }

    if (old.input.stickyLeft !== input.stickyLeft){
        markStickyLeftDiffDirty(res, old, input);
        empty = false;
    }

    if (old.input.stickyRight !== input.stickyRight){
        markStickyRightDiffDirty(res, old, input);
        empty = false;
    }

    if (old.input.rowCount !== input.rowCount){
        markStickyBottomDirty(res, old.input);
        markStickyBottomDirty(res, input);
        empty = false;
    }

    if (old.input.columnCount !== input.columnCount){
        markStickyRightDirty(res, old.input);
        markStickyRightDirty(res, input);
        empty = false;
    }

    if ( (typeof old.columnLength === 'number') ^ (typeof columnLength === 'number') ){
        markVisibleColumnDirty(res, old, input);
        empty = false;
    } else {
        if (typeof columnLength === 'number'){
            if (old.columnLength !== columnLength){
                markVisibleColumnDirty(res, old, input);
                empty = false;
            }
        } else {
            if (markDirtyWidth(res, old, columnLength)){
                empty = false;
            }
        } 
    }

    if ( (typeof old.rowLength === 'number') ^ (typeof rowLength === 'number') ){
        markVisibleRowDirty(res, old, input);
        empty = false;
    } else {
        if (typeof rowLength === 'number'){
            if (old.rowLength !== rowLength){
                markVisibleRowDirty(res, old, input);
                empty = false;
            }
        } else {
            if (markDirtyHeight(res, old, rowLength)){
                empty = false;
            }
        } 
    }
    
    if (empty){
        return null;
    }
    
    return res;
}