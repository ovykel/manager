# Guide A à Z — installation et déploiement de Person Manager

Ce guide décrit la configuration du projet sur Windows avec PowerShell, son
exécution locale et sa mise en ligne. L’application utilise :

- **Front** : React, TypeScript et Vite, hébergé sur Cloudflare Pages.
- **API** : Cloudflare Worker.
- **Métadonnées** : Cloudflare D1 (personnes et clés des fichiers).
- **Fichiers binaires** : bucket privé Backblaze B2, via son API S3.

Les fichiers et secrets B2 ne doivent jamais être intégrés au bundle Vite.
D1 ne contient que les données des fiches et les références des fichiers.

> **Important — sécurité :** un jeton API et une clé B2 ont déjà été partagés
> dans des échanges. Considérez-les comme compromis : révoquez l’ancienne clé
> B2, créez-en une nouvelle à privilèges minimaux et remplacez le jeton API.
> Ne copiez aucune valeur secrète dans ce guide, dans Git, dans le frontend ou
> dans une capture d’écran.

## 1. Prérequis

Installez :

1. **Node.js 22.12 ou plus récent** (npm est inclus).
2. **Git**, si vous récupérez le dépôt depuis un serveur Git.
3. Un compte **Cloudflare**.
4. Un compte **Backblaze** avec accès à **B2 Cloud Storage**.

Vérifiez les outils dans PowerShell :

```powershell
node --version
npm --version
git --version
```

Le dossier de travail utilisé dans les exemples est :

```powershell
D:\ETUDE\person-manager
```

Adaptez ce chemin si le dépôt se trouve ailleurs.

## 2. Récupérer et installer le projet

Si le dépôt est déjà présent sur l’ordinateur, ouvrez PowerShell et placez-vous
à sa racine :

```powershell
Set-Location 'D:\ETUDE\person-manager'
```

Sinon, clonez le dépôt Git, puis entrez dans le dossier créé :

```powershell
git clone https://github.com/ovykel/manager.git
Set-Location '.\manager'
```

Installez les dépendances des deux applications :

```powershell
Set-Location '.\back'
npm ci

Set-Location '..\front'
npm ci
```

`npm ci` installe les versions enregistrées dans les fichiers `package-lock.json`.
Ne remplacez pas ces fichiers par des versions provenant d’un autre projet.

## 3. Créer/configurer le stockage Backblaze B2

### 3.1 Créer un bucket privé

Dans la console Backblaze :

1. Ouvrez **B2 Cloud Storage** puis **Buckets**.
2. Créez un bucket au nom souhaité.
3. Choisissez **Private** comme accès.
4. Notez le nom du bucket, la région et l’endpoint S3 affiché pour cette région.

Pour la configuration actuellement présente dans ce dépôt, les valeurs publiques
du bucket sont :

```text
B2_BUCKET=lesa2002
B2_REGION=us-east-005
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
```

Si vous créez un autre bucket ou si sa région diffère, utilisez ses propres
valeurs partout dans ce guide et dans `back\wrangler.toml`. L’endpoint et la
région doivent correspondre à la région de ce bucket.

### 3.2 Créer une clé d’application B2 limitée

Dans la console B2, ouvrez **Application Keys** et créez une clé restreinte au
bucket de l’application. Accordez uniquement les opérations nécessaires :

- lecture de fichiers ;
- écriture/envoi de fichiers ;
- suppression de fichiers.

Notez le `keyID` et l’`applicationKey` au moment de leur création. La clé secrète
n’est généralement visible qu’une seule fois. Cette application ne demande pas
un accès général à tous les buckets.

Ne mettez pas ces valeurs dans le frontend, dans `wrangler.toml`, ou dans Git.
Elles seront utilisées uniquement par le Worker.

### 3.3 Configurer le CORS du bucket

Dans les paramètres CORS du bucket B2, ajoutez une règle autorisant les deux
origines suivantes :

- `http://localhost:5173` pour les essais locaux ;
- `https://person-manager.pages.dev` pour le site de production.

Exemple de règle B2 à adapter à l’interface de votre compte :

```json
[
  {
    "corsRuleName": "person-manager",
    "allowedOrigins": [
      "http://localhost:5173",
      "https://person-manager.pages.dev"
    ],
    "allowedHeaders": ["content-type", "range"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "exposeHeaders": ["ETag", "Content-Type", "Content-Length"],
    "maxAgeSeconds": 3600
  }
]
```

Si vous utilisez une URL Pages différente, remplacez-la. Une URL de prévisualisation
Pages possède une origine différente : elle doit être ajoutée explicitement si
vous voulez l’utiliser pour tester des transferts.

Les transferts du navigateur vers B2 sont directs et utilisent des URL signées
temporaires. L’API accepte les photos JPEG/PNG/WEBP jusqu’à 5 Mio et les PDF
jusqu’à 10 Mio. Les fichiers stockés restent privés.

## 4. Créer/configurer Cloudflare

### 4.1 Créer un compte et connecter Wrangler

Créez ou ouvrez le compte Cloudflare qui hébergera l’API, D1 et Pages. Depuis
PowerShell :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npx wrangler login
npx wrangler whoami
```

Le navigateur s’ouvre pour autoriser Wrangler. `whoami` doit afficher le compte
attendu. Ne partagez pas le jeton OAuth Wrangler ni le fichier de configuration
local de Wrangler.

### 4.2 Créer la base D1 de production

Créez la base une seule fois :

```powershell
npx wrangler d1 create person-manager
```

La commande affiche un `database_id`. Dans `back\wrangler.toml`, remplacez le
`database_id` de la section `[env.production.d1_databases]` par cet identifiant.
Ne mettez pas cet identifiant dans la section locale à la place du placeholder :
la base locale est gérée par Wrangler.

La configuration de production doit conserver le nom correspondant :

```toml
[[env.production.d1_databases]]
binding = "DB"
database_name = "person-manager"
database_id = "REMPLACER_PAR_LE_DATABASE_ID_RETOURNE"
migrations_dir = "migrations"
```

Le dépôt est actuellement configuré pour la base distante `person-manager`.
Ne recréez pas cette base si vous utilisez déjà l’installation existante.

### 4.3 Appliquer les migrations distantes

Après avoir vérifié le nom et l’identifiant D1 :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run db:production
```

La migration crée les tables nécessaires. Réappliquez cette commande après
l’ajout d’une nouvelle migration au projet. Ne lancez pas une migration locale
avec l’option `--remote` par erreur.

## 5. Configurer les variables locales

### 5.1 Configurer le Worker local

Depuis `back`, créez le fichier local à partir du modèle s’il n’existe pas :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
if (-not (Test-Path '.dev.vars')) {
    Copy-Item '.dev.vars.example' '.dev.vars'
}
notepad '.dev.vars'
```

Renseignez ces trois variables dans `back\.dev.vars` :

```dotenv
API_TOKEN=GENERER_UN_JETON_LOCAL_LONG_ET_ALEATOIRE
B2_KEY_ID=VOTRE_KEY_ID_B2
B2_APPLICATION_KEY=VOTRE_APPLICATION_KEY_B2
```

`API_TOKEN` est le code demandé par l’écran de connexion. Générez un jeton
long, aléatoire et distinct du jeton de production. Les deux valeurs B2 doivent
correspondre à la clé restreinte créée à l’étape 3.

Le fichier `.dev.vars` est ignoré par Git. Ne le copiez pas dans un ticket ou
un message.

### 5.2 Configurer le frontend local

Dans `front`, créez le fichier local s’il n’existe pas :

```powershell
Set-Location 'D:\ETUDE\person-manager\front'
if (-not (Test-Path '.env.local')) {
    Copy-Item '.env.example' '.env.local'
}
```

Vérifiez que `front\.env.local` contient :

```dotenv
VITE_API_URL=http://localhost:8787
```

Ne placez aucun jeton API ou secret B2 dans une variable `VITE_*` : les variables
Vite sont incluses dans les fichiers accessibles au navigateur.

### 5.3 Vérifier `back\wrangler.toml`

La section locale doit avoir des valeurs cohérentes avec votre bucket et :

```toml
[vars]
FRONT_ORIGIN = "http://localhost:5173"
B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
B2_REGION = "us-east-005"
B2_BUCKET = "lesa2002"
```

Le binding D1 local utilise le nom `person-manager-local` et un identifiant
placeholder. C’est normal pour Wrangler en mode local. Ne déployez pas le
Worker sans environnement en pensant utiliser la base distante : utilisez
toujours `--env production` ou le script `npm run deploy`.

## 6. Lancer et tester en local

Ouvrez deux fenêtres PowerShell.

**Fenêtre 1 — API/Worker :**

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run db:local
npm run dev
```

Le Worker local écoute normalement sur `http://localhost:8787`.

**Fenêtre 2 — frontend :**

```powershell
Set-Location 'D:\ETUDE\person-manager\front'
npm run dev
```

Ouvrez `http://localhost:5173`, puis saisissez le `API_TOKEN` local dans l’écran
d’accès. Le jeton reste en mémoire dans le navigateur et n’est pas enregistré
dans `localStorage` ou `sessionStorage`.

Même en local, les transferts de fichiers sont envoyés au vrai bucket B2. Le
compte, la clé B2 et la règle CORS doivent donc être configurés.

Pour vérifier le code :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run typecheck
npm test

Set-Location '..\front'
npm run build
```

## 7. Configurer et déployer le Worker en production

### 7.1 Vérifier les variables publiques de production

Dans `back\wrangler.toml`, vérifiez les variables de `[env.production.vars]`.
L’origine frontend doit correspondre exactement au domaine Pages, sans slash
final :

```toml
[env.production.vars]
FRONT_ORIGIN = "https://person-manager.pages.dev"
B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
B2_REGION = "us-east-005"
B2_BUCKET = "lesa2002"
```

Vérifiez également le `database_id` et le `database_name` de la base D1 de
production. Les variables de l’environnement `production` sont déclarées
séparément : elles ne sont pas automatiquement héritées des variables locales.

### 7.2 Enregistrer les secrets de production

Depuis `back`, exécutez les commandes ci-dessous. Wrangler demande chaque valeur
de façon interactive ; saisissez-la à l’invite sans l’ajouter à la commande :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npx wrangler secret put API_TOKEN --env production
npx wrangler secret put B2_KEY_ID --env production
npx wrangler secret put B2_APPLICATION_KEY --env production
```

Utilisez un `API_TOKEN` de production long, aléatoire et différent du jeton
local. Utilisez les identifiants de la nouvelle clé B2 restreinte. Ne mettez
pas ces valeurs dans `[vars]` du fichier TOML.

### 7.3 Déployer

Après avoir appliqué les migrations D1 et configuré les secrets :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run deploy
```

Le script exécute `wrangler deploy --env production`. Notez l’URL Worker
affichée. L’URL actuellement utilisée par le frontend de ce projet est :

```text
https://person-manager-api.test-353.workers.dev
```

Si Cloudflare affiche une autre URL pour votre compte ou votre nom de Worker,
utilisez l’URL réellement affichée dans le fichier de configuration du frontend.

## 8. Créer et publier le frontend Cloudflare Pages

### 8.1 Créer le projet Pages une seule fois

Si le projet Pages n’existe pas encore :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npx wrangler pages project create person-manager --production-branch main
```

Le projet `person-manager` existe déjà dans l’installation actuelle : ne relancez
pas la création pour une mise à jour normale.

### 8.2 Configurer l’URL API de production

Créez `front\.env.production` s’il n’existe pas :

```powershell
Set-Location 'D:\ETUDE\person-manager\front'
if (-not (Test-Path '.env.production')) {
    Copy-Item '.env.example' '.env.production'
}
notepad '.env.production'
```

Mettez l’URL publique du Worker, sans slash final :

```dotenv
VITE_API_URL=https://person-manager-api.test-353.workers.dev
```

Cette variable n’est pas un secret. Le jeton d’accès n’est jamais mis dans ce
fichier.

### 8.3 Construire et envoyer le frontend

Construisez les fichiers statiques :

```powershell
Set-Location 'D:\ETUDE\person-manager\front'
npm run build
```

Puis déployez le dossier `dist` avec Wrangler installé dans `back` :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npx wrangler pages deploy ..\front\dist --project-name person-manager --branch main
```

L’adresse de production actuelle est :

```text
https://person-manager.pages.dev
```

Le déploiement Pages par branche peut aussi afficher une adresse de déploiement
spécifique. Pour l’application publique, vérifiez l’URL de production du projet
Pages.

## 9. Relier Pages, Worker et B2

Après avoir obtenu l’URL finale Pages :

1. Dans `back\wrangler.toml`, définissez `FRONT_ORIGIN` de production à cette
   origine exacte (`https://...`, sans slash final).
2. Dans les règles CORS du bucket B2, autorisez cette même origine.
3. Redéployez le Worker :

   ```powershell
   Set-Location 'D:\ETUDE\person-manager\back'
   npm run deploy
   ```

Un changement de `VITE_API_URL` nécessite une nouvelle compilation et un nouveau
déploiement Pages. Un changement de `FRONT_ORIGIN` nécessite un nouveau
déploiement du Worker.

## 10. Vérifier la mise en ligne

1. Ouvrez `https://person-manager.pages.dev`.
2. Saisissez le `API_TOKEN` de production (pas le jeton local).
3. Créez une fiche de test avec une image réelle et un PDF réel.
4. Rechargez la page et vérifiez que les données et les pièces jointes sont
   encore accessibles.
5. Testez la recherche, la modification, le téléchargement et la suppression.

Un appel API non authentifié qui répond `401` signifie que le Worker répond,
mais que le code d’accès manque ou est incorrect. Ne mettez pas le jeton dans
une URL, une capture ou une commande enregistrée dans l’historique.

Le nettoyage des envois abandonnés et des anciens fichiers s’exécute en
production toutes les 30 minutes. Le Worker doit donc conserver son déclencheur
programmé.

## 11. Mettre à jour le site plus tard

### 11.1 Ce que fait (et ne fait pas) `git push`

Dans la configuration actuelle, pousser du code avec `git push` **ne déploie
pas** le site et **n’applique pas** les migrations D1. Le dépôt ne contient pas
de workflow GitHub Actions configuré pour ces opérations. Git enregistre et
transmet l’historique du code ; les déploiements et migrations se lancent
séparément avec les commandes Wrangler de ce guide.

### 11.2 Procédure normale pour une mise à jour

1. Modifiez le code sur votre ordinateur.
2. Lancez les vérifications correspondant aux fichiers modifiés (voir 11.3).
3. Vérifiez les fichiers à envoyer et créez un commit :

   ```powershell
   Set-Location 'D:\ETUDE\person-manager'
   git status --short
   git add back/src/index.ts front/src/main.tsx
   git commit -m "Décrire la mise à jour"
   git push origin main
   ```

   Les chemins montrés sont des exemples : remplacez-les par les vrais fichiers
   modifiés. Ne faites pas `git add .` sans vérifier `git status` : ne poussez
   jamais `.dev.vars`, `.env.local`, `.env.production` ni aucune clé.
4. Déployez manuellement le ou les composants modifiés en suivant les cas
   ci-dessous.
5. Ouvrez le site en production et vérifiez le comportement mis à jour.

Si le dépôt utilise une autre branche que `main`, remplacez `main` par cette
branche dans les commandes Git et Pages. Le `git push` peut précéder ou suivre
un déploiement manuel, mais à lui seul il ne provoque aucun déploiement.

### 11.3 Quel déploiement faire selon le changement

| Changement | Vérification locale | Action de production |
|---|---|---|
| Documentation seulement | Relire le diff | Commit et `git push` seulement. |
| Frontend seulement | `npm run build` depuis `front` | Après le commit/push, lancer la commande Pages ci-dessous. |
| Worker/API seulement | `npm run typecheck` et `npm test` depuis `back` | Après le commit/push, lancer `npm run deploy` depuis `back`. |
| Schéma D1 et Worker/API | Tester la migration en local, puis `npm run typecheck` et `npm test` depuis `back` | Commit/push, appliquer d’abord `npm run db:production`, puis déployer le Worker avec `npm run deploy`. |
| Frontend et Worker/API | Vérifier le build frontend et les tests/typecheck backend | Déployer le Worker et Pages ; appliquer toute migration D1 avant le Worker qui en dépend. |
| Secret Worker seulement | Vérifier le nom de secret et l’environnement | Remplacer le secret avec `npx wrangler secret put NOM_DU_SECRET --env production`; aucune valeur secrète ne va dans Git. |

**Déployer Pages après une modification du frontend :**

```powershell
Set-Location 'D:\ETUDE\person-manager\front'
npm run build

Set-Location '..\back'
npx wrangler pages deploy ..\front\dist --project-name person-manager --branch main
```

**Déployer le Worker après une modification de l’API :**

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run typecheck
npm test
npm run deploy
```

Un changement de configuration de build `VITE_*` doit être présent dans
`front\.env.production` avant `npm run build`. Puisque Vite incorpore cette
valeur au frontend, il faut reconstruire et redéployer Pages.

### 11.4 Procédure détaillée si une migration D1 est nécessaire

Une migration est nécessaire lorsqu’une fonctionnalité modifie la structure de
la base (par exemple une nouvelle colonne ou table). Modifier uniquement le
code API ou le frontend ne lance pas et ne crée pas une migration.

1. Ajoutez un nouveau fichier SQL numéroté dans `back\migrations`, après le
   dernier existant, par exemple `0002_description_changement.sql`. Ne modifiez
   pas une ancienne migration déjà appliquée en production.
2. Testez la migration et l’application localement :

   ```powershell
   Set-Location 'D:\ETUDE\person-manager\back'
   npm run db:local
   npm run dev
   ```

   Vérifiez la fonctionnalité avec l’application locale. La base locale n’est
   pas la base de production.
3. Committez et poussez le code et le fichier de migration :

   ```powershell
   Set-Location 'D:\ETUDE\person-manager'
   git status --short
   git add back/migrations/0002_description_changement.sql back/src/index.ts
   git commit -m "Ajouter la migration et la fonctionnalité"
   git push origin main
   ```

   Adaptez les deux chemins à la migration et au code réellement modifiés. Si
   d’autres changements sans rapport sont présents, ne les ajoutez pas au commit.
4. Appliquez la migration à la base distante :

   ```powershell
   Set-Location 'D:\ETUDE\person-manager\back'
   npm run db:production
   ```

5. Si la commande échoue, **arrêtez-vous** : ne déployez pas le Worker qui
   dépend de cette migration. Vérifiez l’erreur et l’état de la base avant toute
   nouvelle tentative.
6. Après le succès de la migration, déployez le Worker :

   ```powershell
   npm run typecheck
   npm test
   npm run deploy
   ```

7. Déployez Pages aussi si le frontend a changé, puis testez la fonctionnalité
   sur `https://person-manager.pages.dev`.

`npm run db:production` applique les migrations distantes en attente. Il faut
lancer cette commande explicitement : un `git push` ou un déploiement Worker ne
l’exécute pas automatiquement. Une migration distante modifie réellement les
données ; faites une sauvegarde adaptée avant un changement destructif.

Pour limiter les interruptions, préférez des migrations compatibles avec
l’ancienne version : ajoutez d’abord une colonne ou table, déployez le code qui
l’utilise, migrez les données si besoin, puis supprimez l’ancien schéma lors
d’une mise à jour ultérieure. Évitez de supprimer ou renommer directement une
colonne encore utilisée par la version actuellement déployée.

## 12. Problèmes fréquents

| Message/problème | Vérifications |
|---|---|
| `Accès non configuré` / HTTP 503 | Le secret `API_TOKEN` est absent de l’environnement Worker ciblé. Configurez-le pour `production`, puis redéployez ou vérifiez les secrets de cet environnement. |
| `Code d’accès invalide` / HTTP 401 | Le code saisi ne correspond pas au `API_TOKEN` du Worker appelé. Vérifiez que le frontend vise le bon Worker et utilisez le jeton de cet environnement. |
| Erreur réseau | Vérifiez l’URL `VITE_API_URL`, que le Worker est déployé, que `FRONT_ORIGIN` correspond exactement au domaine courant et que la prérequête CORS passe. |
| D1 introuvable au déploiement | Vérifiez le `database_id` dans la section production. N’utilisez pas l’ID placeholder local comme ID distant. |
| `Fichier absent`, 403 B2 ou transfert refusé | Vérifiez la nouvelle clé B2, le bucket, l’endpoint, la région, les règles CORS et le type exact du fichier. Recommencez un nouvel envoi : les références d’envoi expirent après 15 minutes. |
| `Fichier trop volumineux` ou type incorrect | Photos : JPEG/PNG/WEBP, 5 Mio maximum. PDF : 10 Mio maximum. Une extension renommée ne change pas réellement le type du fichier. |
| CORS refusé après déploiement Pages | Autorisez l’origine Pages exacte dans B2 et dans `FRONT_ORIGIN`, puis redéployez le Worker. Les URL de prévisualisation sont des origines distinctes. |
| Avertissement `pages_build_output_dir` | Pour ce projet, déployez le dossier `front\dist` avec `wrangler pages deploy`. N’utilisez pas le `wrangler.toml` du Worker comme configuration Pages. |

## 13. Règles à respecter

- Ne versionnez jamais `back\.dev.vars`, `front\.env.local` ou
  `front\.env.production`.
- Ne placez jamais `API_TOKEN`, `B2_KEY_ID` ou `B2_APPLICATION_KEY` dans le
  frontend, dans `VITE_*`, dans Git ou dans une commande en clair.
- Gardez le bucket B2 privé et la clé B2 limitée à ce bucket.
- Utilisez exclusivement les commandes de déploiement qui ciblent explicitement
  l’environnement `production`.
- Faites une sauvegarde adaptée des données avant toute opération destructive
  sur D1 ou B2.
- Cette application utilise un code partagé mono-opérateur ; ce n’est pas un
  système de comptes multi-utilisateurs ou de gestion de rôles.
