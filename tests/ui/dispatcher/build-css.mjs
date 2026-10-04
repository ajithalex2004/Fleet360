import fs from 'node:fs';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const input='src/app/globals.css';
const result=await postcss([tailwind()]).process(fs.readFileSync(input,'utf8'),{from:input});
fs.writeFileSync('tests/ui/dispatcher/compiled.css',result.css);
