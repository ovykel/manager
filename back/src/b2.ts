import { AwsClient } from 'aws4fetch';
export interface B2Env { B2_KEY_ID:string;B2_APPLICATION_KEY:string;B2_ENDPOINT:string;B2_REGION:string;B2_BUCKET:string }
export function b2(env:B2Env) {
 if(!env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET || !env.B2_REGION || env.B2_ENDPOINT.includes('YOUR-')) throw new Error('Stockage B2 non configuré');
 const client = new AwsClient({accessKeyId:env.B2_KEY_ID,secretAccessKey:env.B2_APPLICATION_KEY,region:env.B2_REGION,service:'s3',retries:0});
 const objectUrl = (key:string) => `${env.B2_ENDPOINT.replace(/\/$/,'')}/${encodeURIComponent(env.B2_BUCKET)}/${key.split('/').map(encodeURIComponent).join('/')}`;
 return {
 async signed(key:string,method:'GET'|'PUT',mime?:string,download=false) {
 const url = new URL(objectUrl(key)); url.searchParams.set('X-Amz-Expires','300');
 if(download) url.searchParams.set('response-content-disposition',`attachment; filename="document.${key.endsWith('.pdf')?'pdf':key.split('.').pop()}"`);
 const req = await client.sign(url.toString(),{method,headers:mime?{'Content-Type':mime}:undefined,aws:{signQuery:true,allHeaders:true}});
 return req.url;
 },
 async magic(key:string) {return client.fetch(objectUrl(key),{headers:{Range:'bytes=0-15'}});},
 async remove(key:string) {const res=await client.fetch(objectUrl(key),{method:'DELETE'});if(!res.ok && res.status!==404) throw new Error(`Suppression B2 impossible (${res.status})`);}
 };
}
