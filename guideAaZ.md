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

La migration crée les tables nécessaires. Pour la première mise en production,
vous pouvez laisser `npm run deploy:production` (section 7.3) appliquer les
migrations après les vérifications. `npm run db:production` reste disponible
pour appliquer uniquement les migrations distantes, par exemple si vous
souhaitez les exécuter séparément du déploiement. Ne lancez pas une migration
locale avec l’option `--remote` par erreur.

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
npm run dev
```

`npm run dev` applique automatiquement à D1 locale les migrations qui ne l’ont
pas encore été, puis démarre Wrangler. S’il n’y a rien de nouveau, il démarre
normalement ; si une migration échoue, le Worker ne démarre pas. Pour appliquer
les migrations sans lancer le Worker, utilisez `npm run db:local`. Le Worker
local écoute normalement sur `http://localhost:8787`.

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

Pour la première mise en production, après avoir créé D1 et configuré les
secrets, lancez :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run deploy:production
```

Cette commande vérifie les types, lance les tests backend, applique les
migrations D1 distantes en attente et déploie le Worker. Notez l’URL Worker
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

### 8.4 Déploiement manuel

Le projet n’a pas de CI/CD configuré : `git push` ne déploie pas l’application
et n’applique aucune migration en production. Après avoir vérifié et poussé vos
changements, exécutez vous-même les commandes de migration et de déploiement de
la section 11. Les migrations locales sont, elles, appliquées automatiquement
par `npm run dev`.

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

## 11. Mettre à jour le site et les migrations

### 11.1 Ce qui se passe au démarrage local

Depuis `back`, `npm run dev` lance d’abord `npm run db:local`. Wrangler compare
les migrations présentes dans `back\migrations` aux migrations déjà appliquées
à la base locale, applique celles qui manquent, puis démarre le Worker. Cela ne
touche jamais D1 de production. Si une migration échoue, le serveur local ne
démarre pas.

### 11.2 Ce qui se passe après un push

`git push` enregistre vos changements sur le dépôt Git, mais ne déploie rien et
n’applique pas de migration distante. Vous devez lancer les commandes de
production manuellement depuis le terminal. Pousser le code est recommandé pour
garder une copie versionnée, mais cela ne remplace pas le déploiement.

### 11.3 Procédure complète pour déployer une mise à jour

Suivez cet ordre pour une mise à jour du backend, une nouvelle fonctionnalité
ou un changement qui peut inclure une migration. Les commandes de production
doivent être lancées manuellement : `git push` ne lance ni migration ni
déploiement.

#### Étape 1 — Modifier et tester en local

Faites vos changements dans le projet. Si la fonctionnalité change le schéma
D1, créez une nouvelle migration SQL dans `back\migrations`; ne modifiez pas
une ancienne migration déjà appliquée.

Ouvrez deux fenêtres PowerShell :

**Fenêtre 1 — démarrer l’API locale :**

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run dev
```

Cette commande applique d’abord toutes les migrations en attente à la base D1
locale, puis démarre le Worker sur `http://localhost:8787`. Elle ne touche
jamais la base distante. Laissez cette fenêtre ouverte.

**Fenêtre 2 — démarrer le frontend local :**

```powershell
Set-Location 'D:\ETUDE\person-manager\front'
npm run dev
```

Ouvrez `http://localhost:5173`, testez votre changement et corrigez les
problèmes avant de continuer. Si une migration locale échoue, arrêtez-vous et
corrigez-la. Ne passez pas à la migration distante tant que le test local n’est
pas satisfaisant.

#### Étape 2 — Vérifier l’état des fichiers

Depuis la racine du dépôt, vérifiez les fichiers modifiés :

```powershell
Set-Location 'D:\ETUDE\person-manager'
git status --short
```

Si vous utilisez Git, ajoutez uniquement les fichiers du changement, puis
committez et poussez. Exemple à adapter :

```powershell
git add back/src/index.ts back/migrations/0002_description_changement.sql front/src/main.tsx
git commit -m "Ajouter la nouvelle fonctionnalité"
git push origin main
```

Le commit et le push servent à sauvegarder/versionner les changements ; ils ne
déploient rien. N’ajoutez pas `.dev.vars`, `.env.local`, `.env.production` ou
des secrets. Si vous ne souhaitez pas publier les sources sur Git à ce moment,
vous pouvez déployer vos fichiers locaux directement avec les commandes
ci-dessous.

#### Étape 3 — Vérifier et déployer le backend

Depuis `back`, lancez la commande combinée :

```powershell
Set-Location 'D:\ETUDE\person-manager\back'
npm run deploy:production
```

Elle effectue ces opérations dans l’ordre :

1. `npm run typecheck` vérifie les types TypeScript ;
2. `npm test` lance les tests backend ;
3. `npm run db:production` applique à D1 distante les migrations en attente ;
4. `npm run deploy` publie le Worker de production.

Les étapes sont reliées par `&&` : dès qu’une commande échoue, les suivantes ne
s’exécutent pas. Une erreur de typecheck ou de test arrête donc la commande
avant tout changement distant. Si aucune migration n’est en attente, Wrangler
l’indique et continue avec le déploiement Worker.

#### Étape 4 — Déployer le frontend si celui-ci a changé

Si vous avez modifié `front`, ou si vous avez changé `VITE_API_URL`, reconstruisez
et publiez Pages après le Worker :

```powershell
Set-Location 'D:\ETUDE\person-manager\front'
npm run build

Set-Location '..\back'
npx wrangler pages deploy ..\front\dist --project-name person-manager --branch main
```

Le build utilise `front\.env.production`. Cette variable `VITE_API_URL` est
publique et est incorporée au frontend pendant le build ; elle ne doit contenir
aucun jeton ni secret. Si vous changez la configuration Pages/Worker/CORS, voir
la section 9.

#### Étape 5 — Vérifier la production

Ouvrez `https://person-manager.pages.dev`, reconnectez-vous avec le code d’accès
de production, puis vérifiez la fonctionnalité modifiée. Si des fichiers sont
concernés, testez aussi leur envoi, leur affichage et leur téléchargement.

**Raccourcis selon le type de changement :**

- **Backend/API seulement :** exécutez `npm run deploy:production` depuis
  `back`.
- **Frontend seulement :** exécutez `npm run build` depuis `front`, puis la
  commande Pages ci-dessus. Il n’est pas nécessaire de migrer D1.
- **Backend et frontend :** exécutez d’abord `npm run deploy:production`, puis
  construisez et déployez Pages.
- **Nouvelle migration D1 :** testez-la localement avec `npm run dev`, puis
  `npm run deploy:production` l’applique en production avant de déployer le
  Worker.

Si vous changez seulement des fichiers de documentation, aucune commande de
déploiement n’est nécessaire.

### 11.4 Procédure pour une nouvelle migration D1

Une migration est nécessaire quand une fonctionnalité change le schéma de la
base (nouvelle table, colonne, index, etc.). Un changement de code seul ne crée
pas de migration.

1. Ajoutez un nouveau fichier SQL numéroté dans `back\migrations`, après le
   dernier existant, par exemple `0002_description_changement.sql`. Ne modifiez
   pas une ancienne migration déjà appliquée en production.
2. Depuis `back`, exécutez `npm run dev`. Les migrations locales en attente
   s’appliquent automatiquement au démarrage. Testez ensuite la fonctionnalité
   avec le frontend local. Vous pouvez aussi lancer uniquement
   `npm run db:local` pour appliquer les migrations sans démarrer le Worker.
3. Exécutez les tests et contrôlez les fichiers à envoyer :

   ```powershell
   Set-Location 'D:\ETUDE\person-manager\back'
   npm run typecheck
   npm test

   Set-Location 'D:\ETUDE\person-manager'
   git status --short
   ```

4. Committez la migration et le code associé, puis poussez-les sur votre
   branche si vous utilisez Git :

   ```powershell
   git add back/migrations/0002_description_changement.sql back/src/index.ts
   git commit -m "Ajouter la migration et la fonctionnalité"
   git push origin main
   ```

   Adaptez les chemins aux fichiers réellement modifiés et n’ajoutez pas de
   changements sans rapport au commit.
5. Après avoir confirmé que le code et la migration sont ceux que vous voulez
   mettre en production, lancez la commande combinée depuis `back` :

   ```powershell
   Set-Location 'D:\ETUDE\person-manager\back'
   npm run deploy:production
   ```

6. La commande vérifie les types et les tests avant de toucher la production.
   Si ces contrôles échouent, elle s’arrête avant la migration. Après leur
   succès, elle applique les migrations distantes, puis déploie le Worker. Si le
   frontend a changé, construisez-le puis publiez Pages comme indiqué à
   la section 11.3. Vérifiez enfin le résultat sur le site en production.

Si une étape échoue, `&&` arrête la chaîne et les étapes suivantes ne sont pas
lancées. Les contrôles de types/tests ne modifient pas les fichiers du projet.
Important : si la migration distante réussit mais que le déploiement Worker
échoue ensuite, le schéma D1 reste migré ; ces opérations de production ne sont
pas une transaction annulable. Vérifiez l’erreur avant toute nouvelle tentative.
Si une migration elle-même échoue, vérifiez l’état de D1 avant de la relancer :
les migrations précédentes de la même commande peuvent déjà avoir réussi.

Une migration distante modifie réellement les données. Faites une sauvegarde
adaptée avant tout changement destructif. Préférez les migrations compatibles
avec l’ancienne version : ajoutez d’abord une colonne/table, déployez le code
qui l’utilise, migrez les données si nécessaire, puis supprimez l’ancien schéma
lors d’une mise à jour ultérieure. Évitez de supprimer ou renommer directement
une colonne utilisée par la version déployée.

### 11.5 Rappels de déploiement

- `npm run deploy:production` exécute dans l’ordre les contrôles de types,
  les tests, `npm run db:production` et `npm run deploy`.
- Le Worker et Pages ne se déploient que lorsque vous lancez leurs commandes
  Wrangler. Un commit ou un push Git ne déclenche aucune action Cloudflare.
- Les secrets runtime `API_TOKEN`, `B2_KEY_ID` et `B2_APPLICATION_KEY` restent
  configurés dans Cloudflare Worker. Ne les mettez pas dans Git ou dans le
  frontend.

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
