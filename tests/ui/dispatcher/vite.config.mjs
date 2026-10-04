import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
 root:path.resolve('tests/ui/dispatcher'),
 resolve:{alias:{'@':path.resolve('src')}},
 esbuild:{jsx:'automatic'},
 css:{postcss:{plugins:[]}},
 server:{host:'127.0.0.1',port:4173,strictPort:true,fs:{allow:[process.cwd()]}},
});
