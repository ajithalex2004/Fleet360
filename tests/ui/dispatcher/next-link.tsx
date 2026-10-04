import React from 'react';
/** Only the Next navigation wrapper is replaced; actual dispatcher/trip components render. */
export default function Link(props:React.AnchorHTMLAttributes<HTMLAnchorElement>){return <a {...props}/>;}
