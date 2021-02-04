# av-grid

> Made with create-react-library

[![NPM](https://img.shields.io/npm/v/av-grid.svg)](https://www.npmjs.com/package/av-grid) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save av-grid
```

## Demo
https://codesandbox.io/s/av-grid-demo-lwtgm

## Usage

```jsx
import React from 'react';
import {AvGrid} from 'av-grid';

const columnCount = 20;
const rowCount = 100;
const isSticky = (row, col) => col === 0 || row === 0 || 
    col === columnCount - 1 || row === rowCount - 1
const renderCell = ({row, col, style, key}) => 
    <div
        style={{
            ...style,
            border: 'solid 1px silver',
            backgroundColor: isSticky(row, col) ? 'rgba(0,0,0,0.15)' : undefined,
        }}
        key={key}
    >
        {`${row}:${col}`}
    </div>

export default function App() {
    return (
        <div
            style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <AvGrid
                rowCount={rowCount}
                columnCount={columnCount}
                renderCell={renderCell}
                stickyTop={1}
                stickyLeft={1}
                stickyRight={1}
                stickyBottom={1}
                columnWidth={index => 120}
                rowHeight={index => 32}
                overscanRow={2}
                overscanColumn={0}
            />
        </div>

    );
}
```

## License

MIT © [viyatyk](https://github.com/viyatyk)
