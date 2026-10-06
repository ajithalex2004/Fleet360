export function useParams(){return {id:location.pathname.split('/').at(-1) ?? 'synthetic-trip'};}
export function useSearchParams(){return new URLSearchParams(location.search);}
export function useRouter(){return {replace:(url:string)=>location.assign(url),push:(url:string)=>location.assign(url),refresh:()=>location.reload(),back:()=>history.back()};}
