import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import {AvGrid} from 'av-grid';
import clsx from 'clsx';

const lineHeight = 36;

const useStyles = makeStyles({
    root: {
        border: 'solid 1px silver',
        position: 'absolute',
        left: 5, 
        right: 5,
        top: 5,
        bottom: 5,
        display: 'flex',
        flexDirection: 'column',
    },
    container: {
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        // border: 'solid 1px blue',
    },
    header: {
        borderBottom: 'solid 1px silver',
        marginBottom: 10,
        position: 'relative',
    },
    cell: {
        borderRight: 'solid 1px silver',
        borderBottom: 'solid 1px silver',
        lineHeight: `${lineHeight}px`,
        padding: '0px 4px',
        boxSizing: 'border-box',
        backgroundColor: 'white',
        "&:hover": {
            backgroundColor: 'rgba(0, 0, 0, 0.05)',
        }
    },
    headerCell: {
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        "&:hover": {
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
        }
    },
    panelCell: {
        backgroundColor: 'rgba(0, 0, 200, 0.1)',
        "&:hover": {
            backgroundColor: 'rgba(0, 0, 200, 0.15)',
        }
    },
    block: {
        display: 'inline-block',
        margin: 4,
        padding: 4,
        border: 'solid 1px silver',
    }
});

export default function App() {
    const classes = useStyles();
    const gridRef = React.useRef();

    const [colCount, setColCount] = React.useState(20);
    const [rowCount, setRowCount] = React.useState(100);

    const [stickyTop, setStickyTop] = React.useState(1);
    const [stickyLeft, setStickyLeft] = React.useState(1);
    const [stickyRight, setStickyRight] = React.useState(1);
    const [stickyBottom, setStickyBottom] = React.useState(1);

    const [columnWidthNum, setColumnWidthNum] = React.useState(120);
    const [rowHeightNum, setRowHeightNum] = React.useState(32);
    const [widthFunction, setWidthFunction] = React.useState(false);
    const [heightFunction, setHeightFunction] = React.useState(false);
    const [scrollToRow, setScrollToRow] = React.useState(0);
    const [scrollToCol, setScrollToCol] = React.useState(0);

    const [renderCount, setRenderCount] = React.useState(0);

    const renderCell = React.useCallback(data => {
        const {col, row, style, key} = data;
        const isHeader = (row < stickyTop || row >= (rowCount - stickyBottom));
        const isPanel = (col < stickyLeft || col >= (colCount - stickyRight));

        return (
            <div 
                style={style} 
                key={key} 
                className={clsx(classes.cell, {
                    [classes.panelCell]: isPanel && !isHeader,
                    [classes.headerCell]: isHeader,
                })}
            >
                {row}:{col}
            </div>
        )
    }, [classes, colCount, rowCount, stickyTop, stickyLeft, stickyRight, stickyBottom])

    const onRender = React.useCallback(() => {
        setTimeout(() => setRenderCount(old => old + 1), 5);
    }, [setRenderCount]);

    const columnWidth = React.useCallback(idx => (idx % 2 === 0) ? columnWidthNum * 2 : columnWidthNum, [columnWidthNum]);
    const rowHeight = React.useCallback(idx => (idx % 2 === 0) ? rowHeightNum * 2 : rowHeightNum, [rowHeightNum]);

    const renderHeader = () => (
        <div className={classes.header}>
            <div className={classes.block}>
                Row Count: <input value={rowCount} onChange={e => setRowCount(Number(e.target.value) || 0)} style={{width: 60}}/>
                <br/>
                Column Count: <input value={colCount} onChange={e => setColCount(Number(e.target.value) || 0)} style={{width: 60}}/>
            </div>
            <div className={classes.block}>
                Sticky Top: <input value={stickyTop} onChange={e => setStickyTop(Number(e.target.value) || 0)} style={{width: 60}}/>
                Sticky Right: <input value={stickyRight} onChange={e => setStickyRight(Number(e.target.value) || 0)} style={{width: 60}}/>
                <br/>
                Sticky Left: <input value={stickyLeft} onChange={e => setStickyLeft(Number(e.target.value) || 0)} style={{width: 60}}/>
                Sticky Bottom: <input value={stickyBottom} onChange={e => setStickyBottom(Number(e.target.value) || 0)} style={{width: 60}}/>
            </div>
            <div className={classes.block}>
                Column Width: <input value={columnWidthNum} onChange={e => setColumnWidthNum(Number(e.target.value) || 0)} style={{width: 60}}/>
                <input type='checkbox' value={widthFunction} onChange={e => setWidthFunction(e.target.checked)}/> width function
                <br/>
                Row Height: <input value={rowHeightNum} onChange={e => setRowHeightNum(Number(e.target.value) || 0)} style={{width: 60}}/>
                <input type='checkbox' value={heightFunction} onChange={e => setHeightFunction(e.target.checked)}/> height function
            </div>
            <div className={classes.block}>
                <button onClick={() => {
                    gridRef.current && gridRef.current.scrollTo(scrollToRow, scrollToCol);
                }}>
                    Scroll To:
                </button>
                <br/>
                <button onClick={() => gridRef.current && gridRef.current.scrollToRow(scrollToRow)}>Row:</button> 
                <input value={scrollToRow} onChange={e => setScrollToRow(Number(e.target.value) || 0)} style={{width: 40}}/>
                <button onClick={() => gridRef.current && gridRef.current.scrollToCol(scrollToCol)}>Coll:</button> 
                <input value={scrollToCol} onChange={e => setScrollToCol(Number(e.target.value) || 0)} style={{width: 40}}/>
            </div>

            <div 
                style={{position: 'absolute', top: 4, right: 4, cursor: 'pointer'}}
                title="Click to zero"
                onClick={() => {setRenderCount(0)}}
            >
                Render Count: {renderCount}
            </div>
        </div>
    )

    return (
        <div className={classes.root}>
            {renderHeader()}
            <div className={classes.container}>
                <AvGrid
                    ref={gridRef}
                    rowCount={rowCount}
                    columnCount={colCount}
                    renderCell={renderCell}
                    stickyTop={stickyTop}
                    stickyLeft={stickyLeft}
                    stickyRight={stickyRight}
                    stickyBottom={stickyBottom}
                    columnWidth={widthFunction ? columnWidth: columnWidthNum}
                    rowHeight={heightFunction ? rowHeight : rowHeightNum}
                    overscanRow={2}
                    overscanColumn={0}
                    onRender={onRender}
                />
            </div>
        </div>
    );
}


