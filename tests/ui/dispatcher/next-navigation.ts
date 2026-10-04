export function useParams(){return {id:location.pathname.split('/').at(-1) ?? 'synthetic-trip'};}
