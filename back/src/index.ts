import { b2, type B2Env } from './b2';
import { personSchema, uploadSchema, matchesMagic, type Person } from './validation';
interface Env extends B2Env {DB:D1Database; API_TOKEN:string; FRONT_ORIGIN:string}
class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
async function equal(a:string,b:string) {
 const hash = (s:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
 const [x,y]=await Promise.all([hash(a),hash(b)]);return new Uint8Array(x).every((v,i)=>v===new Uint8Array(y)[i]);
}
async function jsonBody(req:Request){if(Number(req.headers.get('content-length')??0)>16384) throw new ApiError(413,'Requête trop volumineuse');const text=await req.text();if(text.length>16384) throw new ApiError(413,'Requête trop volumineuse');try{return JSON.parse(text);}catch{throw new ApiError(400,'JSON invalide');}}
async function find(env:Env,id:string){const p=await env.DB.prepare('SELECT * FROM persons WHERE id=?').bind(id).first<Person>();if(!p)throw new ApiError(404,'Personne introuvable');return p;}
async function verifyUpload(env:Env,key:string|null,old:string|null,kind:string){
 if(!key || key===old)return;
 const upload=await env.DB.prepare('SELECT * FROM uploads WHERE key=? AND kind=?').bind(key,kind).first<{key:string;mime:string;size:number;expires_at:number}>();
 if(!upload || upload.expires_at<Date.now()) throw new ApiError(400,'Envoi expiré ou référence de fichier invalide');
 const store=b2(env);const head=await store.head(key);
 if(!head.ok || Number(head.headers.get('content-length'))!==upload.size || head.headers.get('content-type')?.split(';')[0]!==upload.mime)throw new ApiError(400,'Fichier absent, type ou taille incorrecte');
 const response=await store.magic(key);if(!response.ok) throw new ApiError(502,'Lecture B2 impossible');
 // Cancel after the first chunk to avoid buffering the entire object if Range is ignored.
 const reader=response.body?.getReader();const first=await reader?.read();await reader?.cancel();
 if(!first?.value || !matchesMagic(first.value,upload.mime))throw new ApiError(400,'Contenu de fichier incompatible');
}
async function cleanup(env:Env){
 const expired=await env.DB.prepare('SELECT key FROM uploads WHERE expires_at < ? LIMIT 50').bind(Date.now()).all<{key:string}>();
 const queued=await env.DB.prepare('SELECT key FROM file_gc LIMIT 50').all<{key:string}>();
 for(const {key} of [...expired.results,...queued.results]){
 try {const used=await env.DB.prepare('SELECT id FROM persons WHERE photo_key=? OR pdf_key=?').bind(key,key).first();if(!used)await b2(env).remove(key);
 await env.DB.batch([env.DB.prepare('DELETE FROM uploads WHERE key=?').bind(key),env.DB.prepare('DELETE FROM file_gc WHERE key=?').bind(key)]);
 }catch{console.error('Nettoyage B2 à réessayer');}
 }
}
async function handle(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url);const path=url.pathname;
 const send=(data:unknown,status=200)=>Response.json(data,{status});
 if(path==='/api/persons' && req.method==='GET'){
 const search=(url.searchParams.get('search')??'').trim().slice(0,100);
 const page=Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page')??'1',10)||1));const limit=10;
 const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
 const where="WHERE nom LIKE ? ESCAPE '\\' OR prenom LIKE ? ESCAPE '\\'";
 const rows=await env.DB.prepare(`SELECT * FROM persons ${where} ORDER BY nom COLLATE NOCASE, prenom COLLATE NOCASE, id LIMIT ? OFFSET ?`).bind(pattern,pattern,limit,(page-1)*limit).all<Person>();
 const count=await env.DB.prepare(`SELECT COUNT(*) AS total FROM persons ${where}`).bind(pattern,pattern).first<{total:number}>();
 const stats=await env.DB.prepare('SELECT COUNT(*) AS total, COUNT(photo_key) AS photos, COUNT(pdf_key) AS documents FROM persons').first();
 return send({items:rows.results,total:count?.total??0,page,page_size:limit,stats});
 }
 if(path==='/api/files/upload-url' && req.method==='POST'){
 const result=uploadSchema.safeParse(await jsonBody(req));if(!result.success)throw new ApiError(400,result.error.issues.map(i=>i.message).join(', '));
 const {kind,content_type,size}=result.data;const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
 const key=`${kind==='photo'?'photos':'pdfs'}/${crypto.randomUUID()}.${ext[content_type]}`;
 const upload_url=await b2(env).signed(key,'PUT',content_type);
 await env.DB.prepare('INSERT INTO uploads (key,kind,mime,size,expires_at) VALUES (?,?,?,?,?)').bind(key,kind,content_type,size,Date.now()+15*60*1000).run();
 return send({key,upload_url,expires_in:300});
 }
 const file=path.match(/^\/api\/files\/([^/]+)\/download-url$/);
 if(file && req.method==='GET'){
 const p=await find(env,file[1]);const kind=url.searchParams.get('kind')??'pdf';if(!['photo','pdf'].includes(kind))throw new ApiError(400,'Type de fichier invalide');
 const key=kind==='photo'?p.photo_key:p.pdf_key;if(!key)throw new ApiError(404,'Aucun fichier associé');
 return send({url:await b2(env).signed(key,'GET',undefined,url.searchParams.get('download')==='1'),expires_in:300});
 }
 const match=path.match(/^\/api\/persons\/([^/]+)$/);
 if(match && req.method==='GET')return send(await find(env,match[1]));
 if((path==='/api/persons' && req.method==='POST') || (match && req.method==='PUT')){
 const result=personSchema.safeParse(await jsonBody(req));if(!result.success)throw new ApiError(400,result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join(', '));
 const p=result.data;const old=match?await find(env,match[1]):null;const id=old?.id??crypto.randomUUID();
 await verifyUpload(env,p.photo_key,old?.photo_key??null,'photo');await verifyUpload(env,p.pdf_key,old?.pdf_key??null,'pdf');
 const values=[p.nom,p.prenom,p.date_naissance,p.sexe,p.email,p.telephone,p.adresse,p.photo_key,p.pdf_key];
 const query=old?env.DB.prepare("UPDATE persons SET nom=?,prenom=?,date_naissance=?,sexe=?,email=?,telephone=?,adresse=?,photo_key=?,pdf_key=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(...values,id):env.DB.prepare('INSERT INTO persons (nom,prenom,date_naissance,sexe,email,telephone,adresse,photo_key,pdf_key,id) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(...values,id);
 const statements=[query];
 for(const key of [p.photo_key,p.pdf_key])if(key) statements.push(env.DB.prepare('DELETE FROM uploads WHERE key=?').bind(key));
 for(const key of [old?.photo_key,old?.pdf_key])if(key && key!==p.photo_key && key!==p.pdf_key)statements.push(env.DB.prepare('INSERT OR IGNORE INTO file_gc (key) VALUES (?)').bind(key));
 await env.DB.batch(statements);
 return send(await find(env,id),old?200:201);
 }
 if(match && req.method==='DELETE'){
 const p=await find(env,match[1]);
 // Keep the record until B2 deletion succeeds: a retry can complete partial deletion.
 for(const key of [p.photo_key,p.pdf_key])if(key)await b2(env).remove(key);
 await env.DB.prepare('DELETE FROM persons WHERE id=?').bind(p.id).run();return send({deleted:true});
 }
 throw new ApiError(404,'Route introuvable');
}
export default {
 async fetch(req:Request,env:Env):Promise<Response>{
 const origin=req.headers.get('origin');const allowed=origin===env.FRONT_ORIGIN;
 const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'});
 if(allowed){headers.set('Access-Control-Allow-Origin',env.FRONT_ORIGIN);headers.set('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization,Content-Type');}
 let res:Response;
 try{
 if(origin && !allowed)throw new ApiError(403,'Origine non autorisée');
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!env.API_TOKEN)throw new ApiError(503,'Accès non configuré');
 if(!await equal(req.headers.get('authorization')??'',`Bearer ${env.API_TOKEN}`))throw new ApiError(401,'Code d’accès invalide');
 res=await handle(req,env);
 }catch(error){const status=error instanceof ApiError?error.status:502;res=Response.json({error:error instanceof ApiError?error.message:'Service indisponible : vérifier D1 et B2.'},{status});if(!(error instanceof ApiError))console.error('Échec du service',error instanceof Error?error.message:'inconnu');}
 headers.forEach((v,k)=>res.headers.set(k,v));return res;
 },
 async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(cleanup(env));}
};
