# Guide réutilisable pour d’autres projets de la même pile technique

Ce guide sert de point de départ pour **un nouveau projet indépendant** utilisant
une architecture similaire :

- frontend React, TypeScript et Vite ;
- API TypeScript sur Cloudflare Workers ;
- métadonnées dans Cloudflare D1 ;
- fichiers privés dans Backblaze B2 via l’API S3 ;
- déploiements manuels depuis un terminal Windows/PowerShell.

Il ne faut pas copier les identifiants ou les secrets d’un projet existant.
Chaque nouveau projet doit avoir ses propres noms de Worker, de base D1, de
projet Pages et, selon le besoin, de bucket B2. Le code de ce guide est un
modèle à adapter aux routes et au schéma propres à chaque application.

## 1. Comprendre les composants

| Composant | Rôle | Contenu |
|---|---|---|
| Frontend Vite | Interface dans le navigateur | Fichiers statiques publics ; URL de l’API uniquement |
| Worker | API et logique métier | Validation, autorisation, accès à D1 et signatures B2 |
| D1 | Données structurées | Enregistrements, métadonnées et clés de fichiers |
| B2 | Fichiers binaires | Images, documents et autres objets privés |

Ne mettez jamais de clé B2 ou de jeton privé dans le frontend. Tout code ou
variable `VITE_*` peut être lu par les utilisateurs du site. D1 sert aux
métadonnées ; B2 sert aux contenus binaires.

## 2. Prérequis

Installez et préparez :

1. Node.js 22.12 ou plus récent et npm.
2. Git.
3. Un compte Cloudflare avec Workers, D1 et Pages disponibles.
4. Un compte Backblaze si le projet stocke des fichiers.
5. Un dépôt Git propre au nouveau projet.

Vérifiez les commandes :

```powershell
node --version
npm --version
git --version
```

Les services Cloudflare et Backblaze peuvent avoir des limites et des coûts.
Vérifiez les tarifs et les quotas de votre compte avant d’y mettre des données
importantes.

## 3. Créer le nouveau projet

Créez un nouveau dépôt Git, puis clonez **ce nouveau dépôt**, pas le dépôt d’un
autre projet :

```powershell
git clone "https://github.com/VOTRE_COMPTE/NOUVEAU_PROJET.git"
Set-Location 'D:\Projets\NOUVEAU_PROJET'
```

Remplacez l’URL, le compte et le chemin par ceux de votre nouveau projet.
Organisez le code par exemple comme suit :

```text
NOUVEAU_PROJET/
  front/
  back/
    src/
    migrations/
    package.json
    wrangler.toml
    .dev.vars.example
  .gitignore
```

Chaque application possède son propre `package.json`. Installez les dépendances
dans les deux dossiers :

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\back'
npm ci

Set-Location '..\front'
npm ci
```

`npm ci` suppose que le dépôt contient un `package-lock.json`. Pour un projet
nouvellement créé sans fichier lock, utilisez `npm install` une première fois,
puis versionnez le fichier lock généré.

## 4. Choisir des noms propres au projet

Choisissez des noms uniques et cohérents, par exemple :

```text
Nom du projet : catalog-demo
Worker local : catalog-demo-api-local
Worker production : catalog-demo-api
D1 locale : catalog-demo-local
D1 production : catalog-demo
Pages : catalog-demo
Bucket B2 : un bucket privé dédié si le projet stocke des fichiers
```

Ces noms sont des exemples. Évitez de réutiliser par erreur le Worker, la base
D1 ou le bucket d’un autre projet. Avant de créer une ressource, vérifiez dans
les consoles Cloudflare et Backblaze qu’elle n’existe pas déjà et qu’elle ne
contient pas de données à conserver.

## 5. Créer la configuration du Worker

Dans `back\wrangler.toml`, adaptez une configuration de ce type :

```toml
name = "catalog-demo-api-local"
main = "src/index.ts"
compatibility_date = "2026-11-14"

[vars]
FRONT_ORIGIN = "http://localhost:5173"
B2_ENDPOINT = "https://s3.VOTRE-REGION.backblazeb2.com"
B2_REGION = "VOTRE-REGION"
B2_BUCKET = "VOTRE-BUCKET-PRIVE"

[[d1_databases]]
binding = "DB"
database_name = "catalog-demo-local"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"

[env.production]
name = "catalog-demo-api"

[env.production.vars]
FRONT_ORIGIN = "https://catalog-demo.pages.dev"
B2_ENDPOINT = "https://s3.VOTRE-REGION.backblazeb2.com"
B2_REGION = "VOTRE-REGION"
B2_BUCKET = "VOTRE-BUCKET-PRIVE"

[[env.production.d1_databases]]
binding = "DB"
database_name = "catalog-demo"
database_id = "REMPLACER_PAR_LE_DATABASE_ID_DE_PRODUCTION"
migrations_dir = "migrations"
```

Remplacez toutes les valeurs d’exemple, notamment la région et l’endpoint B2.
En production, `database_id` doit être l’identifiant retourné par Cloudflare
pour **la base de ce nouveau projet**. Le UUID zéro de la configuration locale
est un placeholder destiné à D1 local ; ne l’utilisez jamais pour D1 distante.

Si le projet n’utilise pas B2, supprimez les variables et le code B2 inutiles.
Si le projet a besoin d’un cron, configurez ses triggers séparément après avoir
défini précisément la tâche attendue.

## 6. Préparer les migrations D1

Ajoutez les changements de schéma sous forme de fichiers SQL numérotés dans
`back\migrations`, par exemple :

```text
back/migrations/
  0001_initial_schema.sql
  0002_add_catalog_field.sql
```

Une migration appliquée en production ne doit pas être modifiée après coup.
Ajoutez une nouvelle migration pour l’évolution suivante.

Configurez les scripts backend dans `back\package.json`. Exemple de scripts
adaptable :

```json
{
  "scripts": {
    "dev": "npm run db:local && wrangler dev",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:local": "wrangler d1 migrations apply catalog-demo-local --local",
    "db:production": "wrangler d1 migrations apply catalog-demo --remote --env production",
    "deploy": "wrangler deploy --env production",
    "deploy:production": "npm run typecheck && npm test && npm run db:production && npm run deploy"
  }
}
```

Adaptez les noms de bases et conservez seulement les scripts dont le nouveau
projet dispose réellement. Si vous n’avez pas de suite de tests, retirez
`npm test` du script `deploy:production` ou ajoutez d’abord une commande de test
valide ; ne laissez pas un script de production qui échoue parce qu’un script
est absent.

`npm run deploy:production` vérifie les types et les tests avant toute opération
distante, applique les migrations en attente, puis déploie le Worker. Les
commandes reliées par `&&` s’arrêtent à la première erreur. Ce n’est toutefois
pas une transaction : si une migration distante réussit et que le déploiement
Worker échoue ensuite, la base reste migrée.

## 7. Configurer les secrets locaux

Créez `back\.dev.vars.example` sans aucune valeur réelle :

```dotenv
API_TOKEN=
B2_KEY_ID=
B2_APPLICATION_KEY=
```

Créez le fichier local à partir du modèle, s’il n’existe pas :

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\back'
if (-not (Test-Path '.dev.vars')) {
    Copy-Item '.dev.vars.example' '.dev.vars'
}
notepad '.dev.vars'
```

Renseignez localement :

- `API_TOKEN` : code aléatoire fort pour l’accès à l’API ;
- `B2_KEY_ID` : identifiant de la clé d’application B2 ;
- `B2_APPLICATION_KEY` : secret de cette clé B2.

Ces variables ne sont pas les mêmes que `B2_ENDPOINT`, `B2_REGION` et
`B2_BUCKET`, qui sont des paramètres non secrets de Wrangler. `.dev.vars` doit
être ignoré par Git et ne doit jamais être partagé ou versionné.

Pour le frontend local, créez `front\.env.local` :

```dotenv
VITE_API_URL=http://localhost:8787
```

Cette URL est publique ; ne mettez aucun jeton ou secret dans un fichier
`VITE_*`.

## 8. Créer les ressources cloud

### 8.1 Créer D1 en production

Connectez Wrangler au compte Cloudflare du nouveau projet :

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\back'
npx wrangler login
npx wrangler whoami
npx wrangler d1 create catalog-demo
```

Copiez le `database_id` retourné dans la section
`[[env.production.d1_databases]]` de `back\wrangler.toml`. Vérifiez que le nom
de la base et son ID sont ceux du nouveau projet.

### 8.2 Configurer les secrets du Worker

Les secrets de production sont stockés sur Cloudflare, pas dans le dépôt. Après
avoir connecté Wrangler au bon compte :

```powershell
npx wrangler secret put API_TOKEN --env production
npx wrangler secret put B2_KEY_ID --env production
npx wrangler secret put B2_APPLICATION_KEY --env production
```

Wrangler demande les valeurs interactivement. Saisissez un jeton de production
différent du jeton local et une clé B2 dédiée au projet. N’ajoutez pas les
valeurs secrètes à la commande, au TOML ou au frontend. Si le projet n’utilise
pas B2, n’ajoutez pas les deux secrets B2.

### 8.3 Créer le bucket B2, si nécessaire

Dans Backblaze :

1. Créez un bucket **Private** avec un nom dédié au nouveau projet.
2. Notez sa région et son endpoint S3.
3. Créez une clé d’application limitée à ce bucket.
4. Autorisez les opérations minimales réellement utilisées par l’application
   (en général lecture, écriture et suppression de fichiers).
5. Ajoutez les origines locales et Pages du projet dans la configuration CORS.

Exemple à adapter :

```json
[
  {
    "corsRuleName": "catalog-demo",
    "allowedOrigins": [
      "http://localhost:5173",
      "https://catalog-demo.pages.dev"
    ],
    "allowedHeaders": ["content-type", "range"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "exposeHeaders": ["ETag", "Content-Type", "Content-Length"],
    "maxAgeSeconds": 3600
  }
]
```

L’origine Pages doit correspondre exactement à celle utilisée. Les adresses de
prévisualisation sont des origines distinctes. Si la région ou le nom du bucket
change, mettez aussi à jour les variables du Worker.

## 9. Démarrer et vérifier en local

Ouvrez deux fenêtres PowerShell.

**Fenêtre 1 — backend :**

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\back'
npm run dev
```

`npm run dev` applique d’abord les migrations D1 locales en attente, puis
démarre le Worker. Si la migration échoue, le Worker ne démarre pas. Cela ne
modifie jamais la base distante.

**Fenêtre 2 — frontend :**

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\front'
npm run dev
```

Ouvrez `http://localhost:5173`. Si le port change, ajustez l’origine CORS
`FRONT_ORIGIN` côté Worker et l’origine autorisée dans B2. Les fichiers envoyés
depuis le navigateur vont au vrai B2 même pendant un test local ; utilisez
uniquement des fichiers et des données de test.

Avant de publier, exécutez les vérifications disponibles :

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\back'
npm run typecheck
npm test

Set-Location '..\front'
npm run build
```

## 10. Première mise en production

### 10.1 Déployer le Worker

Après avoir créé D1, configuré les secrets et vérifié les variables de
production dans `back\wrangler.toml`, lancez :

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\back'
npm run deploy:production
```

La commande vérifie les types, lance les tests, applique les migrations D1
distantes en attente puis déploie le Worker. Elle doit être exécutée depuis le
dossier `back` du projet concerné. N’exécutez jamais la commande sans vérifier
que sa configuration `--env production` cible le bon compte et la bonne base.

Notez l’URL Worker affichée, par exemple :

```text
https://catalog-demo-api.VOTRE-COMPTE.workers.dev
```

### 10.2 Créer Pages et publier le frontend

Créez le projet Pages une seule fois :

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\back'
npx wrangler pages project create catalog-demo --production-branch main
```

Dans `front\.env.production`, configurez uniquement l’adresse publique du Worker :

```dotenv
VITE_API_URL=https://catalog-demo-api.VOTRE-COMPTE.workers.dev
```

Construisez puis déployez le site :

```powershell
Set-Location 'D:\Projets\NOUVEAU_PROJET\front'
npm run build

Set-Location '..\back'
npx wrangler pages deploy ..\front\dist --project-name catalog-demo --branch main
```

Notez l’URL Pages de production. Vérifiez que cette URL est identique à
`FRONT_ORIGIN` de production dans le TOML et à l’origine déclarée dans le CORS
B2, puis redéployez le Worker si vous avez changé `FRONT_ORIGIN`.

## 11. Suite de déploiement pour les mises à jour

### Cas A — changement backend/API sans changement frontend

1. Modifiez le backend et testez avec l’API et le frontend locaux.
2. Si la structure D1 change, ajoutez et testez une nouvelle migration locale.
3. Depuis `back`, lancez :

   ```powershell
   npm run deploy:production
   ```

4. Vérifiez l’URL Worker et testez l’application.

La commande inclut les migrations D1, même lorsqu’il n’y en a pas en attente.
Dans ce dernier cas, Wrangler indique qu’il n’y a rien à migrer et poursuit le
déploiement.

### Cas B — changement frontend seulement

1. Modifiez et testez le frontend local.
2. Si nécessaire, modifiez `VITE_API_URL` dans `front\.env.production`.
3. Construisez puis déployez Pages :

   ```powershell
   Set-Location 'D:\Projets\NOUVEAU_PROJET\front'
   npm run build

   Set-Location '..\back'
   npx wrangler pages deploy ..\front\dist --project-name catalog-demo --branch main
   ```

Le Worker et D1 n’ont pas besoin d’être redéployés si le changement les
concerne pas.

### Cas C — changement backend et frontend

1. Testez les deux parties localement.
2. Exécutez `npm run deploy:production` depuis `back`.
3. Si le backend est déployé correctement, exécutez le build et le déploiement
   Pages décrits au cas B.
4. Testez l’ensemble sur l’URL Pages de production.

### Cas D — migration de schéma D1

1. Créez un nouveau fichier de migration numéroté ; ne modifiez pas les
   migrations déjà appliquées.
2. Lancez `npm run dev` depuis `back` pour appliquer la migration en local.
3. Testez la fonctionnalité locale et vérifiez le code.
4. Faites une sauvegarde adaptée si les données de production sont importantes.
5. Lancez `npm run deploy:production` depuis `back`. Les tests doivent réussir
   avant que le script tente la migration distante.
6. Après l’application de D1, le script déploie le Worker.
7. Déployez Pages séparément si le frontend a changé.

Si les tests échouent, la migration distante ne démarre pas. Si la migration
réussit mais que le déploiement Worker échoue, la base reste migrée : corrigez
le problème et vérifiez l’état de D1 avant de réessayer. Les modifications de
schéma en production ne sont pas automatiquement annulées.

### Git et déploiement

Vous pouvez enregistrer vos changements dans Git avant ou après le déploiement,
mais `git push` ne lance aucune commande Cloudflare. N’envoyez que les fichiers
du projet et jamais les secrets ou les fichiers ignorés comme `.dev.vars` et
`.env.production`.

## 12. Sécurité et entretien

- Utilisez un Worker et une base D1 distincts pour chaque application.
- Gardez chaque bucket privé et chaque clé B2 limitée au bucket nécessaire.
- Remplacez immédiatement un secret qui a été partagé ou commité.
- Ne mettez jamais de secrets dans le frontend, une variable `VITE_*`, un
  exemple de configuration ou une commande conservée dans l’historique.
- Protégez les données avant toute migration destructive et prévoyez une
  stratégie de sauvegarde adaptée.
- Les fichiers B2 peuvent conserver des versions historiques après suppression ;
  configurez une règle de cycle de vie selon les besoins du projet.
- Vérifiez les URLs, migrations, noms de ressources et environnements avant
  chaque commande de production.

## 13. Problèmes fréquents

| Problème | Vérifications |
|---|---|
| `Accès non configuré` / 503 | Le secret `API_TOKEN` manque dans le Worker de l’environnement ciblé. |
| `Code d’accès invalide` / 401 | Le code saisi ne correspond pas au secret du Worker appelé. Vérifiez aussi l’URL API dans le frontend. |
| D1 introuvable | Vérifiez le `database_id` de la section production et le compte Cloudflare actuellement connecté avec `npx wrangler whoami`. |
| Erreur réseau/CORS | Vérifiez `VITE_API_URL`, `FRONT_ORIGIN`, l’origine réelle de Pages et les règles CORS B2. |
| Envoi B2 refusé | Vérifiez le bucket privé, la région, l’endpoint S3, les droits de la clé et CORS. Recommencez un envoi expiré. |
| `git push` sans mise en ligne | C’est normal dans cette procédure manuelle : exécutez le déploiement Worker et/ou Pages vous-même. |
