(this["webpackJsonpav-grid-example"]=this["webpackJsonpav-grid-example"]||[]).push([[0],{18:function(t,e,i){"use strict";i.r(e);i(9);var n=i(0),r=i.n(n),o=i(4),c=i.n(o),a=i(1),l=i(28),u=i(5),s=i.n(u);function h(){return(h=Object.assign||function(t){for(var e=1;e<arguments.length;e++){var i=arguments[e];for(var n in i)Object.prototype.hasOwnProperty.call(i,n)&&(t[n]=i[n])}return t}).apply(this,arguments)}var d=function(t,e){return Array.from({length:e-t+1},(function(e,i){return t+i}))},f=function(t,e){return d(0,e.stickyLeft-1).forEach((function(e){return t.columns[e]=!0}))},y=function(t,e){return d(e.columnCount-e.stickyRight,e.columnCount-1).forEach((function(e){return t.columns[e]=!0}))},m=function(t,e){return d(0,e.stickyTop-1).forEach((function(e){return t.rows[e]=!0}))},g=function(t,e){return d(1,e.stickyBottom).forEach((function(i){return t.rows[e.rowCount-i]=!0}))};function k(t,e,i){d(e.rendered.left,e.rendered.right).forEach((function(e){return t.columns[e]=!0})),f(t,i),y(t,i)}function p(t,e,i){for(var n=e.rendered.top;n<=e.rendered.bottom;n++)t.rows[n]=!0;m(t,i),g(t,i)}function v(t,e,i,n,r){var o,c;if(t){var a=(t.rows||[]).filter((function(t){return t>=e.rendered.top&&t<=e.rendered.bottom})),l=(t.columns||[]).filter((function(t){return t>=e.rendered.left&&t<=e.rendered.right})),u=(t.cells||[]).filter((function(t){var i=t.row,n=t.col;return i>=e.rendered.top&&i<=e.rendered.bottom&&n>=e.rendered.left&&n<=e.rendered.right}));c=!(a.length||l.length||u.length),o={rows:a.reduce((function(t,e){return t[e]=!0,t}),{}),columns:l.reduce((function(t,e){return t[e]=!0,t}),{}),cells:u.reduce((function(t,e){return t[e.row+"_"+e.col]=!0,t}),{})}}else o={rows:{},columns:{},cells:{}},c=!0;return e.input.stickyTop!==i.stickyTop&&(!function(t,e,i){d(Math.min(e.input.stickyTop,i.stickyTop)+1,Math.max(e.input.stickyTop,i.stickyTop)).forEach((function(e){return t.rows[e-1]=!0}))}(o,e,i),f(o,i),y(o,i),c=!1),e.input.stickyBottom!==i.stickyBottom&&(!function(t,e,i){d(1,Math.max(e.input.stickyBottom,i.stickyBottom)).forEach((function(e){return t.rows[i.rowCount-e]=!0}))}(o,e,i),c=!1),e.input.stickyLeft!==i.stickyLeft&&(!function(t,e,i){d(Math.min(e.input.stickyLeft,i.stickyLeft)+1,Math.max(e.input.stickyLeft,i.stickyLeft)).forEach((function(e){return t.columns[e-1]=!0}))}(o,e,i),c=!1),e.input.stickyRight!==i.stickyRight&&(!function(t,e,i){d(1,Math.max(e.input.stickyRight,i.stickyRight)).forEach((function(e){return t.columns[i.columnCount-e]=!0}))}(o,e,i),c=!1),e.input.rowCount!==i.rowCount&&(g(o,e.input),g(o,i),c=!1),e.input.columnCount!==i.columnCount&&(y(o,e.input),y(o,i),c=!1),"number"===typeof e.columnLength^"number"===typeof n?(k(o,e,i),c=!1):"number"===typeof n?e.columnLength!==n&&(k(o,e,i),c=!1):function(t,e,i){var n=!1,r=e.columnLength.findIndex((function(t,e){return t!==i[e]}));return!(r<0)&&(r<e.rendered.right&&(d(Math.max(r,e.rendered.left),e.rendered.right).forEach((function(e){return t.columns[e]=!0})),n=!0),r<e.input.stickyLeft&&(f(t,e.input),n=!0),e.input.stickyRight&&r<=e.input.columnCount-e.input.stickyRight&&(y(t,e.input),n=!0),n)}(o,e,n)&&(c=!1),"number"===typeof e.rowLength^"number"===typeof r?(p(o,e,i),c=!1):"number"===typeof r?e.rowLength!==r&&(p(o,e,i),c=!1):function(t,e,i){var n=!1,r=e.rowLength.findIndex((function(t,e){return t!==i[e]}));return!(r<0)&&(r<e.rendered.bottom&&(d(Math.max(r,e.rendered.top),e.rendered.bottom).forEach((function(e){return t.rows[e]=!0})),n=!0),r<e.input.stickyTop&&(m(t,e.input),n=!0),e.input.stickyBottom&&r<=e.input.rowCount-e.input.stickyBottom&&(g(t,e.input),n=!0),n)}(o,e,r)&&(c=!1),c?null:o}var b={visible:{top:0,right:0,bottom:0,left:0},rendered:{top:0,right:0,bottom:0,left:0},visibleOffset:{top:0,right:0,bottom:0,left:0},innerSize:{width:0,height:0,stickyTopHeight:0,stickyRightWidth:0,stickyBottomHeight:0,stickyLeftWidth:0},columnLength:[],rowLength:[],columnStarts:[],rowStarts:[],input:{size:{width:0,height:0},rowCount:0,columnCount:0,stickyTop:0,stickyRight:0,stickyBottom:0,stickyLeft:0,scrollBarWidth:0,scrollBarHeight:0},cells:[],stickyTop:[],stickyLeft:[],stickyRight:[],stickyBottom:[],stickyTopLeft:[],stickyTopRight:[],stickyBottomRight:[],stickyBottomLeft:[],map:{}};function w(t,e){return"number"===typeof e?e:Array.from({length:t},(function(t,i){return e(i)}))}function C(t){if("number"===typeof t)return t;var e=[].concat(t);return e.forEach((function(i,n){e[n]=0===n?0:e[n-1]+t[n-1]})),e}function S(t,e,i){if(void 0===i&&(i=1),"number"===typeof t)return i*t;for(var n=0,r=e;r<e+i;r++)n+=t[r];return n}function B(t,e){return"number"===typeof t?t:t[e]}function x(t,e){return"number"===typeof t?e*t:t[e]}function z(t,e,i){if(void 0===i&&(i=!0),"number"===typeof t)return Math.trunc(e/t);for(var n=i?t.length-1:-1,r=0,o=0;o<t.length;o++)if((r+=t[o])>e){n=o;break}return n}var R=function(t,e,i,n,r){void 0===n&&(n=0),void 0===r&&(r=0);var o=t.renderCell,c=t.old,a=t.newInfo,l=t.rerender,u=t.rowLength,s=t.columnLength,h=t.rowStarts,d=t.columnStarts,f=e+"_"+i,y=c.map[f];return(!y||l&&(l.cells[f]||l.columns[i]||l.rows[e]))&&(y=o({col:i,row:e,style:{display:"inline-block",position:"absolute",left:r?S(s,r,i-r):x(d,i),width:B(s,i),top:n?S(u,n,e-n):x(h,e),height:B(u,e)},key:f})),a.map[f]=y,y};function L(t,e){var i=e.offset,n=e.size,r=e.rowCount,o=e.columnCount,c=e.rowHeight,a=e.columnWidth,l=e.renderCell,u=e.stickyTop,s=void 0===u?0:u,d=e.stickyLeft,f=void 0===d?0:d,y=e.stickyRight,m=void 0===y?0:y,g=e.stickyBottom,k=void 0===g?0:g,p=e.overscanColumn,b=e.overscanRow,B=e.scrollBarWidth,L=e.scrollBarHeight,E=e.direction,T=void 0===E?{x:0,y:0}:E,H=e.rerender;if((T.x||T.y)&&i.x>=t.visibleOffset.left&&i.x<=t.visibleOffset.right&&i.y>=t.visibleOffset.top&&i.y<=t.visibleOffset.bottom)return t;var W=w(o,a),O=w(r,c),M=function(t,e,i,n,r,o,c,a){return{width:S(c,0,e)+(n?0:20),height:S(a,0,t)+(r?0:20),stickyTopHeight:S(a,0,i),stickyRightWidth:S(c,e-n,n),stickyBottomHeight:S(a,t-r,r),stickyLeftWidth:S(c,0,o)}}(r,o,s,m,k,f,W,O),N=function(t,e,i,n,r,o,c,a,l,u,s,h,d){var f=z(u,o.x+t.stickyLeftWidth),y=z(u,o.x+n-t.stickyRightWidth-h);f=Math.max(0,f),y=Math.min(y,i-1);var m=z(s,o.y+t.stickyTopHeight),g=z(s,o.y+r-t.stickyBottomHeight-d);return{visible:{top:m=Math.max(0,m),right:y,bottom:g=Math.min(g,e-1),left:f},rendered:{top:l.y<0?Math.max(0,m-a):m,right:l.x>0?Math.min(i-1,y+c):y,bottom:l.y>0?Math.min(e-1,g+a):g,left:l.x<0?Math.max(0,f-c):f}}}(M,r,o,n.width,n.height,i,p,b,T,W,O,B,L);if(t.rendered.top||t.rendered.bottom){if(!(H=v(H,t,e,W,O))&&N.visible.left>=t.visible.left&&N.visible.right<=t.visible.right&&N.visible.top>=t.visible.top&&N.visible.bottom<=t.visible.bottom&&M.width===t.innerSize.width&&M.height===t.innerSize.height&&M.stickyTopHeight===t.innerSize.stickyTopHeight&&M.stickyRightWidth===t.innerSize.stickyRightWidth&&M.stickyBottomHeight===t.innerSize.stickyBottomHeight&&M.stickyLeftWidth===t.innerSize.stickyLeftWidth)return t}else H=null;var j=C(W),I=C(O);N.visibleOffset=function(t,e,i,n,r,o,c,a,l){return{left:x(r,t.left)-c.stickyLeftWidth,right:S(i,0,t.right+1)-(o.width-c.stickyRightWidth-a),top:x(n,t.top)-c.stickyTopHeight,bottom:S(e,0,t.bottom+1)-(o.height-c.stickyBottomHeight-l)}}(N.visible,O,W,I,j,n,M,B,L);for(var A=h({},N,{innerSize:M,columnLength:W,rowLength:O,columnStarts:j,rowStarts:I,input:{size:n,rowCount:r,columnCount:o,stickyTop:s,stickyRight:m,stickyBottom:k,stickyLeft:f,scrollBarWidth:B,scrollBarHeight:L},cells:[],stickyTop:[],stickyLeft:[],stickyRight:[],stickyBottom:[],stickyTopLeft:[],stickyTopRight:[],stickyBottomRight:[],stickyBottomLeft:[],map:{}}),D={renderCell:l,old:t,newInfo:A,rerender:H,rowLength:O,columnLength:W,rowStarts:I,columnStarts:j},J=A.rendered.top;J<=A.rendered.bottom;J++)for(var _=A.rendered.left;_<=A.rendered.right;_++)J<s||_<f||J>=r-k||_>=o-m||A.cells.push(R(D,J,_));for(var P=0;P<s;P++){for(var q=0;q<f;q++)A.stickyTopLeft.push(R(D,P,q));for(var F=Math.max(f,A.rendered.left);F<=Math.min(A.rendered.right,o-m-1);F++)A.stickyTop.push(R(D,P,F));for(var G=o-m;G<o;G++)A.stickyTopRight.push(R(D,P,G,0,o-m))}for(var K=r-k;K<r;K++){for(var Q=0;Q<f;Q++)A.stickyBottomLeft.push(R(D,K,Q,r-k,0));for(var U=Math.max(f,A.rendered.left);U<=Math.min(A.rendered.right,o-m-1);U++)A.stickyBottom.push(R(D,K,U,r-k,0));for(var V=o-m;V<o;V++)A.stickyBottomRight.push(R(D,K,V,r-k,o-m))}for(var X=Math.max(s,A.rendered.top);X<=Math.min(A.rendered.bottom,r-k-1);X++){for(var Y=0;Y<f;Y++)A.stickyLeft.push(R(D,X,Y,s,0));for(var Z=o-m;Z<o;Z++)A.stickyRight.push(R(D,X,Z,s,o-m))}return A}function E(t,e,i){var n=x(e.columnStarts,t),r=S(e.columnLength,0,t+1),o=e.input.size,c=h({},i),a=o.width-e.innerSize.stickyRightWidth-e.input.scrollBarWidth;return c.x+a<r?c.x=r-a:c.x>n-e.innerSize.stickyLeftWidth&&(c.x=n-e.innerSize.stickyLeftWidth),c}function T(t,e,i){var n=x(e.rowStarts,t),r=S(e.rowLength,0,t+1),o=e.input.size,c=h({},i),a=o.height-e.innerSize.stickyBottomHeight-e.input.scrollBarHeight;return c.y+a<r?c.y=r-a:c.y>n-e.innerSize.stickyTopHeight&&(c.y=n-e.innerSize.stickyTopHeight),c}var H=Object(l.a)({root:{flex:"1 1 auto",border:"solid 1px silver",position:"relative",overflow:"hidden",height:100},container:{overflow:"auto"},renderArea:{position:"relative"}}),W=r.a.forwardRef((function(t,e){var i=t.rowCount,n=t.columnCount,o=t.renderCell,c=t.rowHeight,a=void 0===c?32:c,l=t.columnWidth,u=void 0===l?120:l,h=t.stickyTop,d=void 0===h?0:h,f=t.stickyLeft,y=void 0===f?0:f,m=t.stickyRight,g=void 0===m?0:m,k=t.stickyBottom,p=void 0===k?0:k,v=t.overscanColumn,w=void 0===v?0:v,C=t.overscanRow,S=void 0===C?0:C,B=t.onRender,x=H(),z=s()(),R=z[0],W=z[1],O=r.a.useRef(),M=r.a.useRef({x:0,y:0}),N=r.a.useState(b),j=N[0],I=N[1],A=r.a.useState()[1],D=O.current?O.current.offsetWidth-O.current.clientWidth:0,J=O.current?O.current.offsetHeight-O.current.clientHeight:0;r.a.useEffect((function(){var t=!0;return setTimeout((function(){t&&O.current&&(j.input.scrollBarWidth!==O.current.offsetWidth-O.current.clientWidth||j.input.scrollBarHeight!==O.current.offsetHeight-O.current.clientHeight)&&A(new Date)}),50),function(){return t=!1}}),[j,A]);var _=r.a.useCallback((function(t,e,r){var c=L(t,{offset:M.current,size:W,rowCount:i,columnCount:n,rowHeight:a,columnWidth:u,renderCell:o,stickyTop:d,stickyLeft:y,stickyRight:g,stickyBottom:p,rerender:e,overscanColumn:w,overscanRow:S,direction:r,scrollBarWidth:D,scrollBarHeight:J});c!==t&&I(c)}),[W,i,n,a,u,I,o,d,y,g,p,w,S,D,J]),P=r.a.useCallback((function(t,e){if(O.current){var i=function(t,e,i,n){return T(t,i,E(e,i,n))}(t,e,j,M.current);O.current.scrollLeft=i.x,O.current.scrollTop=i.y}}),[j]),q=r.a.useCallback((function(t){if(O.current){var e=T(t,j,M.current);O.current.scrollTop=e.y}}),[j]),F=r.a.useCallback((function(t){if(O.current){var e=E(t,j,M.current);O.current.scrollLeft=e.x}}),[j]);return r.a.useEffect((function(){_(j)}),[_]),r.a.useImperativeHandle(e,(function(){return{updateRenderInfo:function(t){return _(j,t)},scrollTo:function(t,e){return P(t,e)},scrollToRow:function(t){return q(t)},scrollToCol:function(t){return F(t)}}})),B&&B(),r.a.createElement("div",{className:x.root},R,r.a.createElement("div",{ref:O,className:x.container,style:{width:W.width,height:W.height},onScroll:function(t){var e=t.target,i=e.scrollLeft,n=e.scrollTop,r={x:i-M.current.x,y:n-M.current.y};M.current={x:i,y:n},_(j,void 0,r)}},r.a.createElement("div",{className:x.renderArea,style:{width:j.innerSize.width,height:j.innerSize.height}},Boolean(d)&&r.a.createElement("div",{style:{top:0,width:j.innerSize.width,height:j.innerSize.stickyTopHeight,position:"sticky",zIndex:2,backgroundColor:"white"}},Boolean(y)&&r.a.createElement("div",{style:{display:"inline-block",left:0,height:j.innerSize.stickyTopHeight,width:j.innerSize.stickyLeftWidth,position:"sticky",zIndex:3,backgroundColor:"white"}},j.stickyTopLeft),Boolean(g)&&r.a.createElement("div",{style:{display:"inline-block",left:W.width-j.innerSize.stickyRightWidth-D,height:j.innerSize.stickyTopHeight,width:j.innerSize.stickyRightWidth,position:"sticky",zIndex:3,backgroundColor:"white"}},j.stickyTopRight),j.stickyTop),Boolean(p)&&r.a.createElement("div",{style:{top:W.height-j.innerSize.stickyBottomHeight-J,width:j.innerSize.width,height:j.innerSize.stickyBottomHeight,position:"sticky",zIndex:2,backgroundColor:"white"}},Boolean(y)&&r.a.createElement("div",{style:{display:"inline-block",left:0,height:j.innerSize.stickyBottomHeight,width:j.innerSize.stickyLeftWidth,position:"sticky",zIndex:3,backgroundColor:"white"}},j.stickyBottomLeft),Boolean(g)&&r.a.createElement("div",{style:{display:"inline-block",left:W.width-j.innerSize.stickyRightWidth-D,height:j.innerSize.stickyBottomHeight,width:j.innerSize.stickyRightWidth,position:"sticky",zIndex:3,backgroundColor:"white"}},j.stickyBottomRight),j.stickyBottom),Boolean(y)&&r.a.createElement("div",{style:{display:"inline-block",left:0,width:j.innerSize.stickyLeftWidth,height:j.innerSize.height-(j.innerSize.stickyTopHeight+j.innerSize.stickyBottomHeight),zIndex:1,position:"sticky",backgroundColor:"white",marginTop:-j.innerSize.stickyBottomHeight}},j.stickyLeft),Boolean(g)&&r.a.createElement("div",{id:"stickyRight",style:{display:"inline-block",left:W.width-j.innerSize.stickyRightWidth-D,width:j.innerSize.stickyRightWidth,height:j.innerSize.height-(j.innerSize.stickyTopHeight+j.innerSize.stickyBottomHeight),zIndex:1,position:"sticky",backgroundColor:"white",marginTop:-j.innerSize.stickyBottomHeight}},j.stickyRight),j.cells)))})),O=r.a.memo(W),M=i(6);const N=Object(l.a)({root:{border:"solid 1px silver",position:"absolute",left:5,right:5,top:5,bottom:5,display:"flex",flexDirection:"column"},container:{flex:"1 1 auto",display:"flex",flexDirection:"column"},header:{borderBottom:"solid 1px silver",marginBottom:10,position:"relative"},cell:{borderRight:"solid 1px silver",borderBottom:"solid 1px silver",lineHeight:"".concat(36,"px"),padding:"0px 4px",boxSizing:"border-box",backgroundColor:"white","&:hover":{backgroundColor:"rgba(0, 0, 0, 0.05)"}},headerCell:{backgroundColor:"rgba(0, 0, 0, 0.1)","&:hover":{backgroundColor:"rgba(0, 0, 0, 0.15)"}},panelCell:{backgroundColor:"rgba(0, 0, 200, 0.1)","&:hover":{backgroundColor:"rgba(0, 0, 200, 0.15)"}},block:{display:"inline-block",margin:4,padding:4,border:"solid 1px silver"}});function j(){const t=N(),e=r.a.useRef(),i=r.a.useState(20),n=Object(a.a)(i,2),o=n[0],c=n[1],l=r.a.useState(100),u=Object(a.a)(l,2),s=u[0],h=u[1],d=r.a.useState(1),f=Object(a.a)(d,2),y=f[0],m=f[1],g=r.a.useState(1),k=Object(a.a)(g,2),p=k[0],v=k[1],b=r.a.useState(1),w=Object(a.a)(b,2),C=w[0],S=w[1],B=r.a.useState(1),x=Object(a.a)(B,2),z=x[0],R=x[1],L=r.a.useState(120),E=Object(a.a)(L,2),T=E[0],H=E[1],W=r.a.useState(32),j=Object(a.a)(W,2),I=j[0],A=j[1],D=r.a.useState(!1),J=Object(a.a)(D,2),_=J[0],P=J[1],q=r.a.useState(!1),F=Object(a.a)(q,2),G=F[0],K=F[1],Q=r.a.useState(0),U=Object(a.a)(Q,2),V=U[0],X=U[1],Y=r.a.useState(0),Z=Object(a.a)(Y,2),$=Z[0],tt=Z[1],et=r.a.useState(0),it=Object(a.a)(et,2),nt=it[0],rt=it[1],ot=r.a.useCallback(e=>{const i=e.col,n=e.row,c=e.style,a=e.key,l=n<y||n>=s-z,u=i<p||i>=o-C;return r.a.createElement("div",{style:c,key:a,className:Object(M.a)(t.cell,{[t.panelCell]:u&&!l,[t.headerCell]:l})},n,":",i)},[t,o,s,y,p,C,z]),ct=r.a.useCallback(()=>{setTimeout(()=>rt(t=>t+1),5)},[rt]),at=r.a.useCallback(t=>t%2===0?2*T:T,[T]),lt=r.a.useCallback(t=>t%2===0?2*I:I,[I]);return r.a.createElement("div",{className:t.root},r.a.createElement("div",{className:t.header},r.a.createElement("div",{className:t.block},"Row Count: ",r.a.createElement("input",{value:s,onChange:t=>h(Number(t.target.value)||0),style:{width:60}}),r.a.createElement("br",null),"Column Count: ",r.a.createElement("input",{value:o,onChange:t=>c(Number(t.target.value)||0),style:{width:60}})),r.a.createElement("div",{className:t.block},"Sticky Top: ",r.a.createElement("input",{value:y,onChange:t=>m(Number(t.target.value)||0),style:{width:60}}),"Sticky Right: ",r.a.createElement("input",{value:C,onChange:t=>S(Number(t.target.value)||0),style:{width:60}}),r.a.createElement("br",null),"Sticky Left: ",r.a.createElement("input",{value:p,onChange:t=>v(Number(t.target.value)||0),style:{width:60}}),"Sticky Bottom: ",r.a.createElement("input",{value:z,onChange:t=>R(Number(t.target.value)||0),style:{width:60}})),r.a.createElement("div",{className:t.block},"Column Width: ",r.a.createElement("input",{value:T,onChange:t=>H(Number(t.target.value)||0),style:{width:60}}),r.a.createElement("input",{type:"checkbox",value:_,onChange:t=>P(t.target.checked)})," width function",r.a.createElement("br",null),"Row Height: ",r.a.createElement("input",{value:I,onChange:t=>A(Number(t.target.value)||0),style:{width:60}}),r.a.createElement("input",{type:"checkbox",value:G,onChange:t=>K(t.target.checked)})," height function"),r.a.createElement("div",{className:t.block},r.a.createElement("button",{onClick:()=>{e.current&&e.current.scrollTo(V,$)}},"Scroll To:"),r.a.createElement("br",null),r.a.createElement("button",{onClick:()=>e.current&&e.current.scrollToRow(V)},"Row:"),r.a.createElement("input",{value:V,onChange:t=>X(Number(t.target.value)||0),style:{width:40}}),r.a.createElement("button",{onClick:()=>e.current&&e.current.scrollToCol($)},"Coll:"),r.a.createElement("input",{value:$,onChange:t=>tt(Number(t.target.value)||0),style:{width:40}})),r.a.createElement("div",{style:{position:"absolute",top:4,right:4,cursor:"pointer"},title:"Click to zero",onClick:()=>{rt(0)}},"Render Count: ",nt)),r.a.createElement("div",{className:t.container},r.a.createElement(O,{ref:e,rowCount:s,columnCount:o,renderCell:ot,stickyTop:y,stickyLeft:p,stickyRight:C,stickyBottom:z,columnWidth:_?at:T,rowHeight:G?lt:I,overscanRow:2,overscanColumn:0,onRender:ct})))}c.a.render(r.a.createElement(j,null),document.getElementById("root"))},8:function(t,e,i){t.exports=i(18)},9:function(t,e,i){}},[[8,1,2]]]);
//# sourceMappingURL=main.a7626a2f.chunk.js.map