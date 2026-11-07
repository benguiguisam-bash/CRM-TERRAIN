# CRM Terrain — V1 (métrage de façades)

Application web installable sur téléphone (PWA), sans abonnement ni serveur.

## Ce que fait la V1
- **Tournée** : clients du jour, recherche, filtres, stats.
- **Fiche client** : adresse, appel, itinéraire, données IGN automatiques
  (hauteur, niveaux, matériaux des murs), surface de référence.
- **Photo + tracé au doigt** : mur (4 coins), pignon (3 points, aimantés au mur),
  fenêtres/portes. Loupe pour viser, points déplaçables.
- **Cotes** : on touche un côté, on tape le métrage laser, on photographie
  l'écran du laser. Côtés opposés et pignon symétrique déduits automatiquement.
- **Résultat** : surface brute, ouvertures, surface nette, et contrôles
  (4 sources de hauteur, surface de référence, valeurs plausibles, preuves).
  Explication obligatoire si l'écart est rouge. Export PDF via « Imprimer ».

## Lancer en local
```bash
python3 -m http.server 8765 --directory crm-terrain
```
Puis ouvrir http://localhost:8765

## Mettre sur les téléphones
Il faut un hébergement HTTPS (gratuit : Netlify, Vercel, Cloudflare Pages,
GitHub Pages). On y dépose le dossier tel quel, puis sur le téléphone :
« Ajouter à l'écran d'accueil ».

## Limites connues de la V1
- Les données restent **sur chaque téléphone** (pas encore de synchronisation
  ni de vue manager). Prochaine étape : une base partagée (ex. Supabase).
- L'IGN demande du réseau au moment de la recherche ; le reste marche hors ligne.
- Les matériaux IGN sont décodés à partir des codes des fichiers fonciers.

## Réglages
Seuils dans `js/checks.js` (`SEUILS` et `TOL`) : 5 % / 15 % pour la surface
de référence, 2,8 m par niveau, tolérances photo 20 %, niveaux 25 %, IGN 15 %.
