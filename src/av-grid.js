import React from 'react';
import useResizeAware from 'react-resize-aware';
import {renderInfoInitialState, calcRenderInfo, calcScrollOffset,
    calcScrollOffsetY, calcScrollOffsetX} from './av-grid-renderInfo';

const AvGrid = React.forwardRef(function AvGrid(props, ref){
    const {
        rowCount = 0,
        columnCount = 0,
        renderCell,
        rowHeight = 32, //or function (index) => height;
        columnWidth = 120, //or function (index) => width;
        stickyTop = 0,
        stickyLeft = 0,
        stickyRight = 0,
        stickyBottom = 0,
        overscanColumn = 0,
        overscanRow = 0,
        onRender,
        className,
    } = props;

    const [resizeListener, size] = useResizeAware();
    const containerRef = React.useRef();

    const offsetRef = React.useRef({x: 0, y: 0});
    const [renderInfo, setRenderInfo] = React.useState(renderInfoInitialState);

    // eslint-disable-next-line
    const [rerenderDt, setRerenderDt] = React.useState();
  
    const scrollBarWidth = containerRef.current
        ? containerRef.current.offsetWidth - containerRef.current.clientWidth
        : 0;
    const scrollBarHeight = containerRef.current
        ? containerRef.current.offsetHeight - containerRef.current.clientHeight
        : 0;

    React.useEffect(() => {
        let live = true;
        setTimeout(() => {
            if (live && containerRef.current && (
                renderInfo.input.scrollBarWidth !== (containerRef.current.offsetWidth - containerRef.current.clientWidth) ||
                renderInfo.input.scrollBarHeight !== (containerRef.current.offsetHeight - containerRef.current.clientHeight)
            )){
                setRerenderDt(new Date());
            }
        }, 50)
        return () => live = false;
    }, [renderInfo, setRerenderDt])

    const updateRenderInfo = React.useCallback((oldInfo, rerender, direction) => {
        const newInfo = calcRenderInfo(oldInfo, {
            offset: offsetRef.current, 
            size, 
            rowCount, 
            columnCount, 
            rowHeight, 
            columnWidth, 
            renderCell,
            stickyTop, 
            stickyLeft,
            stickyRight,
            stickyBottom,
            rerender,
            overscanColumn,
            overscanRow,
            direction,
            scrollBarWidth,
            scrollBarHeight,
        })
        if (newInfo !== oldInfo)
        setRenderInfo(newInfo);
    }, [size, rowCount, columnCount, rowHeight, columnWidth, setRenderInfo, renderCell,
        stickyTop, stickyLeft, stickyRight, stickyBottom, overscanColumn, overscanRow,
        scrollBarWidth, scrollBarHeight])

    const scrollTo = React.useCallback((row, col) => {
        if (containerRef.current){
            const newOffset = calcScrollOffset(row, col, renderInfo, offsetRef.current);
            containerRef.current.scrollLeft = newOffset.x;
            containerRef.current.scrollTop = newOffset.y;
        }
    }, [renderInfo])

    const scrollToRow = React.useCallback(row => {
        if (containerRef.current){
            const newOffset = calcScrollOffsetY(row, renderInfo, offsetRef.current);
            containerRef.current.scrollTop = newOffset.y;
        }
    }, [renderInfo])

    const scrollToCol = React.useCallback(col => {
        if (containerRef.current){
            const newOffset = calcScrollOffsetX(col, renderInfo, offsetRef.current);
            containerRef.current.scrollLeft = newOffset.x;
        }
    }, [renderInfo])

    const onScroll = e => {
        const {scrollLeft: x, scrollTop: y} = e.target;
        const direction = {x: x - offsetRef.current.x, y: y - offsetRef.current.y}
        offsetRef.current = {x, y};
        updateRenderInfo(renderInfo, undefined, direction);
    }
    
    React.useEffect(() => {
        updateRenderInfo(renderInfo);
    }, 
    // eslint-disable-next-line
    [updateRenderInfo])

    React.useImperativeHandle(ref, () => ({
        updateRenderInfo: rerender => updateRenderInfo(renderInfo, rerender),
        scrollTo: (row, col) => scrollTo(row, col),
        scrollToRow: row => scrollToRow(row),
        scrollToCol: col => scrollToCol(col),
    }));

    onRender && onRender();

    return (
        <div id="av-grid-root" className={className}
            style={{
                flex: '1 1 auto',
                position: 'relative',
                overflow: 'hidden',
                height: 100,
            }}
        >
            {resizeListener}
            <div id="av-grid-container"
                ref={containerRef}
                style={{
                    width: size.width,
                    height: size.height,
                    overflow: 'auto',
                }}
                onScroll={onScroll}
            >
                <div id="av-grid-render-area"
                    style={{
                        width: renderInfo.innerSize.width,
                        height: renderInfo.innerSize.height,
                        position: 'relative',
                    }}
                >
                    {Boolean(stickyTop) &&
                        <div id="av-grid-sticky-top"
                            style={{
                                top: 0,
                                width: renderInfo.innerSize.width,
                                height: renderInfo.innerSize.stickyTopHeight,
                                position: 'sticky',
                                zIndex: 2,
                                backgroundColor: 'white',
                            }}
                        >
                            {Boolean(stickyLeft) &&
                                <div id="av-grid-sticky-top-left"
                                    style={{
                                        display: 'inline-block',
                                        left: 0,
                                        height: renderInfo.innerSize.stickyTopHeight,
                                        width: renderInfo.innerSize.stickyLeftWidth,
                                        position: 'sticky',
                                        zIndex: 3,
                                        backgroundColor: 'white',
                                    }}
                                >
                                    {renderInfo.stickyTopLeft}
                                </div>
                            }
                            {Boolean(stickyRight) &&
                                <div id="av-grid-sticky-top-right"
                                    style={{
                                        display: 'inline-block',
                                        left: size.width - renderInfo.innerSize.stickyRightWidth - scrollBarWidth,
                                        height: renderInfo.innerSize.stickyTopHeight,
                                        width: renderInfo.innerSize.stickyRightWidth,
                                        position: 'sticky',
                                        zIndex: 3,
                                        backgroundColor: 'white',
                                    }}
                                >
                                    {renderInfo.stickyTopRight}
                                </div>
                            }
                            {renderInfo.stickyTop}
                        </div>
                    }
                    {Boolean(stickyBottom) &&
                        <div id="av-grid-sticky-bottom"
                            style={{
                                top: size.height - renderInfo.innerSize.stickyBottomHeight - scrollBarHeight,
                                width: renderInfo.innerSize.width,
                                height: renderInfo.innerSize.stickyBottomHeight,
                                position: 'sticky',
                                zIndex: 2,
                                backgroundColor: 'white',
                            }}
                        >
                            {Boolean(stickyLeft) &&
                                <div id="av-grid-sticky-bottom-left"
                                    style={{
                                        display: 'inline-block',
                                        left: 0,
                                        height: renderInfo.innerSize.stickyBottomHeight,
                                        width: renderInfo.innerSize.stickyLeftWidth,
                                        position: 'sticky',
                                        zIndex: 3,
                                        backgroundColor: 'white',
                                    }}
                                >
                                    {renderInfo.stickyBottomLeft}
                                </div>
                            }
                            {Boolean(stickyRight) &&
                                <div id="av-grid-sticky-bottom-right"
                                    style={{
                                        display: 'inline-block',
                                        left: size.width - renderInfo.innerSize.stickyRightWidth - scrollBarWidth,
                                        height: renderInfo.innerSize.stickyBottomHeight,
                                        width: renderInfo.innerSize.stickyRightWidth,
                                        position: 'sticky',
                                        zIndex: 3,
                                        backgroundColor: 'white',
                                    }}
                                >
                                    {renderInfo.stickyBottomRight}
                                </div>
                            }
                            {renderInfo.stickyBottom}
                        </div>
                    }
                    {Boolean(stickyLeft) && 
                        <div id="av-grid-sticky-left"
                            style={{
                                display: 'inline-block',
                                left: 0,
                                width: renderInfo.innerSize.stickyLeftWidth,
                                height: renderInfo.innerSize.height - (renderInfo.innerSize.stickyTopHeight + renderInfo.innerSize.stickyBottomHeight),
                                zIndex: 1,
                                position: 'sticky',
                                backgroundColor: 'white',
                                marginTop: -(renderInfo.innerSize.stickyBottomHeight),
                            }}
                        >
                            {renderInfo.stickyLeft}
                        </div>
                    }
                    {Boolean(stickyRight) &&
                        <div id="av-grid-sticky-right"
                            id="stickyRight"
                            style={{
                                display: 'inline-block',
                                left: size.width - renderInfo.innerSize.stickyRightWidth - scrollBarWidth,
                                width: renderInfo.innerSize.stickyRightWidth,
                                height: renderInfo.innerSize.height - (renderInfo.innerSize.stickyTopHeight + renderInfo.innerSize.stickyBottomHeight),
                                zIndex: 1,
                                position: 'sticky',
                                backgroundColor: 'white',
                                marginTop: -renderInfo.innerSize.stickyBottomHeight,
                            }}
                        >
                            {renderInfo.stickyRight}
                        </div>
                    }
                    {renderInfo.cells}
                </div>
            </div>
        </div>
    )
})

export default React.memo(AvGrid);