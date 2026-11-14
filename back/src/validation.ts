import { z } from 'zod';
export const PHOTO_MAX = 5 * 1024 * 1024;
export const PDF_MAX = 10 * 1024 * 1024;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
 const d = new Date(value + 'T00:00:00Z');
 return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === value && value <= new Date().toISOString().slice(0,10);
}, 'Date de naissance invalide ou future');
const key = z.string().regex(/^(photos|pdfs)\/[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/).nullable();
export const personSchema = z.object({
 nom:z.string().trim().min(1).max(100), prenom:z.string().trim().min(1).max(100),
 date_naissance:date, sexe:z.enum(['Femme','Homme','Autre','Non précisé']),
 email:z.string().trim().email().max(254), telephone:z.string().trim().min(1).max(40),
 adresse:z.string().trim().min(1).max(500), photo_key:key.default(null),pdf_key:key.default(null)
}).strict().superRefine((v,c)=>{
 if(v.photo_key && !v.photo_key.startsWith('photos/')) c.addIssue({code:'custom',path:['photo_key'],message:'Clé photo invalide'});
 if(v.pdf_key && !v.pdf_key.startsWith('pdfs/')) c.addIssue({code:'custom',path:['pdf_key'],message:'Clé PDF invalide'});
});
export const uploadSchema = z.object({kind:z.enum(['photo','pdf']), content_type:z.string(), size:z.number().int().positive()}).strict().superRefine((v,c)=>{
 const types = v.kind === 'photo' ? ['image/jpeg','image/png','image/webp'] : ['application/pdf'];
 if(!types.includes(v.content_type)) c.addIssue({code:'custom',message:'Type de fichier interdit'});
 if(v.size > (v.kind === 'photo' ? PHOTO_MAX : PDF_MAX)) c.addIssue({code:'custom',message:'Fichier trop volumineux'});
});
export type PersonInput = z.infer<typeof personSchema>;
export type Person = PersonInput & {id:string;created_at:string;updated_at:string};
export function matchesMagic(bytes: Uint8Array, mime:string):boolean {
 const starts = (...values:number[]) => values.every((v,i)=>bytes[i]===v);
 if(mime==='image/jpeg') return starts(255,216,255);
 if(mime==='image/png') return starts(137,80,78,71,13,10,26,10);
 if(mime==='application/pdf') return starts(37,80,68,70,45);
 return starts(82,73,70,70) && bytes[8]===87 && bytes[9]===69 && bytes[10]===66 && bytes[11]===80;
}
