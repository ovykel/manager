# Person Manager — Test Cloud

Projet indépendant : React 19 / Vite 7 / TypeScript / Tailwind 4, Worker TypeScript, D1 SQLite et Backblaze B2 privé via S3. Aucun VPS, Docker, PostgreSQL ou stockage binaire en base. Aucun envoi B2 simulé.

## Contenu

- `front/` : tableau de bord français, formulaire, fiche, recherche, pagination de 10, confirmation de suppression, photo et consultation/téléchargement PDF.
- `back/` : API, validation, signature S3 avec aws4fetch, migrations Wrangler et nettoyage des fichiers abandonnés/remplacés.
- `back/test/` : tests des validations.

Les personnes initiales sont **vides**. L’application utilise une API réelle et affiche une erreur si elle est indisponible.

## Prérequis

Node.js 22.12+ et npm (ou Bun), comptes Cloudflare et Backblaze. Les services peuvent facturer stockage, requêtes et transferts. Les accès et déploiements restent à effectuer sur vos comptes.

## 1. Installer

```bash
cd person-manager/front
npm install
cp .env.example .env.local
cd ../back
npm install
cp .dev.vars.example .dev.vars
npx wrangler login
```

Les fichiers `bun.lock` sont fournis pour reproduire avec `bun install --frozen-lockfile`; npm fonctionne aussi. Ne versionnez jamais `.dev.vars` ou les fichiers contenant vos secrets.

## 2. Backblaze B2 réel (local ET production)

Dans Backblaze, créez un bucket **privé** (`allPrivate`). Notez son nom, son endpoint S3 et sa région, puis remplacez `B2_BUCKET`, `B2_ENDPOINT`, `B2_REGION` dans les deux sections de `back/wrangler.toml`. L’endpoint est par exemple `https://s3.us-west-004.backblazeb2.com` : prenez votre région réelle.

Créez une application key restreinte au bucket avec `readFiles`, `writeFiles`, `deleteFiles` (et `listFiles` si nécessaire pour vos outils). Le **keyID** correspond à `B2_KEY_ID`; l’applicationKey correspond à `B2_APPLICATION_KEY`. Renseignez-les dans `.dev.vars`, jamais dans le frontend.

Dans la configuration CORS B2, autorisez les origines `http://localhost:5173` et votre URL Pages exacte. Règle B2 à adapter :

```json
[
  {
    "corsRuleName": "person-manager",
    "allowedOrigins": ["http://localhost:5173", "https://YOUR-PAGES-PROJECT.pages.dev"],
    "allowedHeaders": ["content-type", "range"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head"],
    "exposeHeaders": ["ETag", "Content-Type", "Content-Length"],
    "maxAgeSeconds": 3600
  }
]
```

Les URL PUT/GET sont signées pour **300 secondes**. Les photos sont JPG/PNG/WEBP (5 Mio maximum) et les PDF 10 Mio maximum. Ces limites sont des choix ajoutés pour ce projet. Le serveur vérifie taille, type et signature binaire avant d’attacher le fichier à une personne. Une URL PUT S3 n’impose pas une limite ferme au transfert : un opérateur autorisé peut envoyer un objet incorrect, qui sera refusé à l’enregistrement et nettoyé plus tard.

B2 conserve généralement des versions de fichiers : un DELETE S3 rend la version courante inaccessible mais peut conserver des versions historiques. Dans le bucket, choisissez une règle de cycle de vie supprimant les versions masquées/anciennes après le délai choisi. Pour une purge immédiatement irréversible de toutes les versions, une gestion supplémentaire de versions est nécessaire; elle n’est pas implémentée ici. Pas d’Object Lock/retention bloquant les suppressions pour ce test.

## 3. Code d’accès

Cette application de test est mono-opérateur. Toutes les API sont protégées par `API_TOKEN`. Générez un code aléatoire fort avec votre gestionnaire de mots de passe, mettez-le dans `.dev.vars`, puis saisissez-le dans l’écran d’accès. Il reste uniquement en mémoire du navigateur (perdu au rechargement). Ne définissez **jamais** ce secret en variable `VITE_*` et ne partagez pas cette application comme un système multi-utilisateur. Il n’y a pas de comptes, récupération de mot de passe ni rôles.

## 4. Tester en local

Le binding D1 local utilise SQLite dans `.wrangler/`. Le UUID zéro de la section locale est un identifiant factice de configuration pour le moteur local, pas une connexion à une base distante. Les fichiers, eux, vont **réellement sur B2**, même en local.

```bash
# terminal 1, dans back/
npm run dev
# terminal 2, dans front/
npm run dev
```

`npm run dev` applique d’abord automatiquement toutes les migrations en attente
à la base D1 locale, puis démarre Wrangler. Si une migration échoue, le Worker
ne démarre pas. Ouvrir `http://localhost:5173`. Le service écoute
`http://localhost:8787`. Si Vite change de port, rétablir 5173 ou adapter
`FRONT_ORIGIN` et les règles CORS B2.

```bash
# back/
npm run typecheck
npm test
# front/
npm run build
```

Le nettoyage programmé tourne toutes les 30 minutes en production, pas automatiquement en local. Pour tester localement le cron : démarrer `npx wrangler dev --test-scheduled`, puis appeler `http://localhost:8787/__scheduled` depuis un autre terminal. Les fichiers non attachés expirent après 15 minutes. Les fichiers remplacés sont placés dans `file_gc` et supprimés par le cron. Les échecs restent en file pour une prochaine tentative.

## 5. Créer D1 distant et migrer

```bash
cd back
npx wrangler d1 create person-manager
```

Copier le `database_id` obtenu dans `[[env.production.d1_databases]]`. Ne pas modifier la section locale.

```bash
npm run db:production
```

D1 conserve la table `persons` et seulement les clés B2. Les tables techniques `uploads` et `file_gc` ne contiennent que métadonnées d’envoi et clés de nettoyage.

## 6. Secrets et déploiement Worker

Définir `FRONT_ORIGIN` de production à l’URL Pages finale exacte (sans slash final). Les variables d’environnement Wrangler ne sont pas héritées : renseigner toute la section de production.

```bash
cd back
npx wrangler secret put B2_KEY_ID --env production
npx wrangler secret put B2_APPLICATION_KEY --env production
npx wrangler secret put API_TOKEN --env production
npm run deploy
```

Chaque commande demande le secret sans l’intégrer au code. Noter l’URL Worker affichée, par exemple `https://person-manager-api.VOTRE-SOUS-DOMAINE.workers.dev`.

## 7. Déployer le frontend sur Pages

```bash
cd back
npx wrangler pages project create person-manager --production-branch main
cd ../front
```

Créer `front/.env.production` avec `VITE_API_URL=https://URL-REELLE-DU-WORKER` (pas de token). Puis :

```bash
npm run build
npx wrangler pages deploy dist --project-name person-manager --branch main
```

Pour utiliser Wrangler installé dans back plutôt qu’un téléchargement ponctuel : `../back/node_modules/.bin/wrangler pages deploy dist --project-name person-manager --branch main`.

Renseigner l’URL Pages dans `FRONT_ORIGIN` production et CORS B2, puis redéployer le Worker. Les previews Pages ont des origines distinctes : elles ne sont pas autorisées par défaut. Après modification d’une variable Vite, reconstruire et redéployer le frontend.

## 8. Déploiements manuels

Aucun déploiement de production n’est déclenché par `git push`. Depuis `back/`,
`npm run deploy:production` vérifie les types, lance les tests, applique les
migrations D1 distantes en attente puis déploie le Worker. En cas d’échec, la
chaîne s’arrête. Pour publier le frontend, construisez-le dans `front/` avec
`npm run build`, puis envoyez `front/dist` sur Pages avec Wrangler. Les
migrations locales s’appliquent automatiquement quand vous lancez `npm run dev`
dans `back/`. Les détails sont dans [guideAaZ.md](./guideAaZ.md).

## API

Toutes les requêtes hors preflight nécessitent `Authorization: Bearer <API_TOKEN>`. Les corps sont JSON. Réponses d’erreur : `{ "error": "message" }`.

| Méthode | Route | Fonction |
|---|---|---|
| GET | `/api/persons?search=&page=1` | Liste, total, statistiques; recherche littérale nom/prénom |
| GET | `/api/persons/:id` | Fiche |
| POST | `/api/persons` | Créer |
| PUT | `/api/persons/:id` | Remplacer les champs d’une fiche |
| DELETE | `/api/persons/:id` | Supprimer les objets B2 courants puis la personne |
| POST | `/api/files/upload-url` | `{kind:"photo" ou "pdf",content_type,size}` → `{key,upload_url,expires_in}` |
| GET | `/api/files/:id/download-url?kind=pdf&download=1` | `:id` est l’identifiant de personne; URL signée liée à sa photo/PDF |

Pour envoyer : demander une URL, faire PUT directement vers B2 avec le Content-Type exact et le fichier, puis créer/modifier la personne avec `photo_key`/`pdf_key`. Valeur `null` pour retirer un fichier. Une référence arbitraire ou appartenant à une autre personne est refusée (hors référence inchangée de la fiche). Une date impossible/future est refusée. Les valeurs sexe sont `Femme`, `Homme`, `Autre`, `Non précisé`. Tous les champs texte sont obligatoires; fichiers facultatifs.

SQLite LIKE ne normalise pas tous les accents Unicode : la recherche est simple, insensible à la casse ASCII. Aucune promesse de recherche phonétique.

## Suppression et cohérence

Il n’existe pas de transaction distribuée entre B2 et D1. À la suppression, la personne est conservée si une suppression B2 échoue; réessayer permet de finir. Une suppression partielle peut rendre sa photo inaccessible temporairement. Au remplacement, D1 est mis à jour puis l’ancienne clé est mise en file atomiquement dans D1. Les envois abandonnés sont nettoyés. Garder B2 et le cron actifs pour finir le nettoyage.

## Vérification production (à effectuer sur vos comptes)

1. Saisir le code d’accès sur Pages.
2. Ajouter une personne avec un JPG/PNG/WEBP réel et un PDF réel.
3. Recharger : confirmer la persistance D1 et la photo B2.
4. Rechercher nom puis prénom; ajouter 11 personnes pour vérifier deux pages.
5. Ouvrir la fiche, consulter et télécharger le PDF.
6. Modifier les coordonnées et remplacer les fichiers; vérifier le nettoyage après cron.
7. Essayer SVG, faux PDF, date invalide et fichier trop grand : refus attendu.
8. Annuler une suppression puis confirmer : personne absente de D1, objets courants inaccessibles dans B2; vérifier aussi les anciennes versions selon votre cycle de vie.
9. Vérifier que sans code, l’API renvoie 401; une origine non autorisée reçoit 403.

## État de validation de l’archive

Compilation frontend, types backend, tests de validation et CRUD local sans fichiers vérifiés lors de la préparation. **Pas de déploiement distant ni de test B2 réel effectués**, faute d’accès à vos comptes. Les URL signées et transferts B2 sont du code réel, pas des résultats simulés. Les tests fichiers production restent à faire avec la checklist ci-dessus. Aucun secret n’est inclus dans le ZIP.
