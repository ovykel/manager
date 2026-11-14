import { describe,it,expect } from 'vitest';
import {personSchema,uploadSchema,matchesMagic} from '../src/validation';
const valid={nom:'Martin',prenom:'Alice',date_naissance:'1990-03-12',sexe:'Femme',email:'alice@example.com',telephone:'0102030405',adresse:'Paris'};
describe('Personnes',()=>{
 it('accepte les champs requis',()=>expect(personSchema.safeParse(valid).success).toBe(true));
 it('refuse une date impossible',()=>expect(personSchema.safeParse({...valid,date_naissance:'2001-02-29'}).success).toBe(false));
 it('refuse une date future',()=>expect(personSchema.safeParse({...valid,date_naissance:'2999-01-01'}).success).toBe(false));
 it('refuse les octets dans D1',()=>expect(personSchema.safeParse({...valid,photo_key:'data:image/png;base64,AAA'}).success).toBe(false));
});
describe('Fichiers autorisés',()=>{
 for(const type of ['image/jpeg','image/png','image/webp'])it(`accepte ${type}`,()=>expect(uploadSchema.safeParse({kind:'photo',content_type:type,size:100}).success).toBe(true));
 it('accepte un PDF facultatif',()=>expect(uploadSchema.safeParse({kind:'pdf',content_type:'application/pdf',size:100}).success).toBe(true));
 it('refuse SVG',()=>expect(uploadSchema.safeParse({kind:'photo',content_type:'image/svg+xml',size:100}).success).toBe(false));
 it('limite les photos à 5 Mio',()=>expect(uploadSchema.safeParse({kind:'photo',content_type:'image/png',size:5242881}).success).toBe(false));
 it('limite les PDF à 10 Mio',()=>expect(uploadSchema.safeParse({kind:'pdf',content_type:'application/pdf',size:10485761}).success).toBe(false));
 it('détecte un faux PDF',()=>expect(matchesMagic(new TextEncoder().encode('<script>'), 'application/pdf')).toBe(false));
});
