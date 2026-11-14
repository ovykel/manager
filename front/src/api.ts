export type Person = {id:string;nom:string;prenom:string;date_naissance:string;sexe:string;email:string;telephone:string;adresse:string;photo_key:string|null;pdf_key:string|null;created_at:string;updated_at:string};
export type Input = Omit<Person,'id'|'created_at'|'updated_at'>;
export type List = {items:Person[];total:number;page:number;page_size:number;stats:{total:number;photos:number;documents:number}};
const base=(import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/,'');
export async function api<T>(token:string,path:string,options:RequestInit={}):Promise<T>{
 const res=await fetch(base+path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...options.headers}});
 const data=await res.json();if(!res.ok)throw new Error(data.error || `Erreur ${res.status}`);return data;
}
export async function upload(token:string,file:File,kind:'photo'|'pdf'){
 const signed=await api<{key:string;upload_url:string}>(token,'/api/files/upload-url',{method:'POST',body:JSON.stringify({kind,content_type:file.type,size:file.size})});
 const res=await fetch(signed.upload_url,{method:'PUT',headers:{'Content-Type':file.type},body:file});
 if(!res.ok)throw new Error(`Envoi B2 impossible (${res.status}). Vérifiez les règles CORS du bucket.`);return signed.key;
}
export async function fileUrl(token:string,id:string,kind:'photo'|'pdf',download=false){return (await api<{url:string}>(token,`/api/files/${encodeURIComponent(id)}/download-url?kind=${kind}&download=${download?1:0}`)).url;}
